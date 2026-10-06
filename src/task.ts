import { HoldingQueueModal, renderHoldingFields, TASK_STATUS_LABELS } from './task-holding-ui';
import { holdingGraphError, scanTaskLines } from './task-holding-model';
import { readTaskLocations, taskLookup } from './task-holding';
import {
	App,
	type Editor,
	Modal,
	Notice,
	Setting,
	TFile,
	moment,
	setIcon,
} from 'obsidian';
import { t } from './i18n';
import { cursorLineIsFrontmatter } from './commit-core';
import { taskLineWithPin } from './thread-attention-model';
import {
	advanceTaskLine,
	completeTaskData,
	releaseTaskHolding,
	type TaskStatus,
	buildTaskLine,
	createTaskId,
	EMPTY_TASK,
	parseTaskLine,
	taskDraftFromTextLine,
	taskValidationError,
	taskWindowLabel,
	type ParsedTaskLine,
	type TaskData,
	type TaskEffort,
	type TaskRepeatFrequency,
} from './task-model';
import { openTaskDatePicker, openTaskWindowPicker } from './task-window-picker';
import type { ThreadIndex } from './thread-index';

type TaskSubmit = (data: TaskData) => void | Promise<void>;

export interface FileTaskLocation {
	file: TFile;
	line: number;
	sourceLine: string;
	parsed: ParsedTaskLine;
}

export interface TaskCommitRequest {
	file: TFile;
	line: number;
	sourceLine: string;
	data: TaskData;
	threadFile?: TFile;
	onUpdated?: () => void;
}

type TaskCommitHandler = (request: TaskCommitRequest) => void;

function currentDate(): string {
	return moment().format('YYYY-MM-DD');
}

function dayOfMonth(value: string): number {
	const parsed = Number(value.slice(8, 10));
	return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : 1;
}

class TaskModal extends Modal {
	private data: TaskData;
	private saving = false;
	private closed = false;
	private closeWindowPicker?: () => void;

	constructor(
		app: App,
		private readonly mode: 'create' | 'edit',
		initial: TaskData,
		private readonly onSubmit: TaskSubmit,
	) {
		super(app);
		this.data = {
			...initial,
			taskId: initial.taskId || createTaskId(),
		};
	}

	onOpen(): void {
		this.closed = false;
		this.modalEl.addClass('thread-journal-task-modal');
		this.render(true);
	}

	private render(focusContent = false): void {
		this.closeWindowPicker?.();
		this.closeWindowPicker = undefined;
		this.contentEl.empty();
		this.setTitle(this.mode === 'create' ? t('Create task') : t('Edit task'));
		let focusTarget: HTMLInputElement | undefined;
		const meta = this.contentEl.createDiv({ cls: 'thread-journal-task-meta' });
		const pin = meta.createEl('button', {
			cls: 'clickable-icon thread-journal-task-meta-pin',
			attr: { type: 'button' },
		});
		const updatePin = (): void => {
			pin.toggleClass('is-pinned', this.data.pinned);
			pin.setAttribute('aria-pressed', String(this.data.pinned));
			const label = this.data.pinned ? t('Unpin task') : t('Pin task');
			pin.setAttribute('aria-label', label);
			pin.setAttribute('title', label);
			pin.empty();
			setIcon(pin, 'pin');
		};
		pin.addEventListener('click', () => {
			this.data.pinned = !this.data.pinned;
			updatePin();
		});
		updatePin();
		meta.createSpan({
			cls: 'thread-journal-task-meta-id',
			text: this.data.taskId,
			attr: { title: t('Task ID'), 'aria-label': t('Task ID') },
		});

		new Setting(this.contentEl)
			.setClass('thread-journal-task-form-field')
			.setClass('is-wide')
			.setName(t('Task content'))
			.addText((text) => {
				text.setValue(this.data.content).onChange((value) => {
					this.data.content = value;
				});
				focusTarget = text.inputEl;
			});

		const choiceFields = this.contentEl.createDiv({ cls: 'thread-journal-task-choice-fields' });
		new Setting(choiceFields)
			.setClass('thread-journal-task-form-field')
			.setName(t('Estimated effort'))
			.addDropdown((dropdown) => dropdown
				.addOption('', t('Not selected'))
				.addOption('quick', t('Quick'))
				.addOption('light', t('Light'))
				.addOption('normal', t('Normal effort'))
				.addOption('deep', t('Deep'))
				.setValue(this.data.effort)
				.onChange((value) => {
					this.data.effort = value as TaskEffort;
				}));
		new Setting(choiceFields).setClass('thread-journal-task-form-field').setName(t('Task status'))
			.addDropdown(dropdown => {
				for (const [value, label] of Object.entries(TASK_STATUS_LABELS)) dropdown.addOption(value, t(label));
				dropdown.setValue(this.data.status).onChange(value => { this.data.status = value as TaskStatus; });
			});
		this.addWindowField(choiceFields);
		this.renderRepeatFields();
		renderHoldingFields(this.app, this.contentEl, this.data, () => this.render());

		const actions = new Setting(this.contentEl).setClass('thread-journal-task-actions');
		actions.addButton((button) => button
			.setButtonText(t('Cancel'))
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText(this.mode === 'create' ? t('Create task') : t('Save changes'))
			.setCta()
			.onClick(async () => {
				if (this.saving) return;
				if (!this.data.taskId) this.data.taskId = createTaskId();
				const error = taskValidationError(this.data);
				if (error === 'content') new Notice(t('Enter task content.'));
				else if (error === 'window-order') new Notice(t('The window end must be on or after its start.'));
				else if (error === 'repeat-current') new Notice(t('Choose the current repeat date.'));
				else if (error === 'repeat-interval') new Notice(t('Enter a repeat interval of at least 2 days.'));
				else if (error === 'holding-date') new Notice(t('Choose a valid review date.'));
				if (error) return;
				this.saving = true;
				const snapshot = { ...this.data, holdingFor: [...this.data.holdingFor], completedOccurrences: [...this.data.completedOccurrences] };
				try {
					const locations = snapshot.holding && snapshot.holdingFor.length ? await readTaskLocations(this.app) : [];
					if (this.closed) return;
					if (snapshot.holding && holdingGraphError(snapshot, taskLookup(locations))) {
						throw new Error(t('Dependencies must exist and must not form a cycle.'));
					}
					await this.onSubmit(snapshot);
					this.close();
				} catch (error) { new Notice(String(error)); }
				finally { this.saving = false; }
			}));

		if (focusContent) window.setTimeout(() => focusTarget?.focus(), 0);
	}

	private addWindowField(parent: HTMLElement): void {
		const setting = new Setting(parent)
			.setClass('thread-journal-task-form-field')
			.setClass('is-window')
			.setName(t('Window'));
		const label = taskWindowLabel(this.data) || t('Select dates');
		const trigger = setting.controlEl.createEl('button', {
			cls: 'thread-journal-task-window-trigger',
			text: label,
			attr: {
				type: 'button',
				'aria-expanded': 'false',
				'aria-label': t('Select task window'),
			},
		});
		trigger.addEventListener('click', () => {
			if (this.closeWindowPicker) {
				this.closeWindowPicker();
				this.closeWindowPicker = undefined;
				return;
			}
			trigger.setAttribute('aria-expanded', 'true');
			this.closeWindowPicker = openTaskWindowPicker(
				trigger,
				this.data.windowStart,
				this.data.windowEnd,
				(start, end) => {
					this.data.windowStart = start;
					this.data.windowEnd = end;
					this.render();
				},
				() => {
					this.closeWindowPicker = undefined;
					if (trigger.isConnected) trigger.setAttribute('aria-expanded', 'false');
				},
			);
		});
	}

	private renderRepeatFields(): void {
		const fields = this.contentEl.createDiv({
			cls: `thread-journal-task-repeat-fields${this.data.repeat ? ' is-active' : ''}`,
		});
		new Setting(fields)
			.setClass('thread-journal-task-form-field')
			.setClass('is-repeat-toggle')
			.setName(t('Repeat'))
			.addToggle((toggle) => toggle
				.setValue(this.data.repeat)
				.onChange((value) => {
					this.data.repeat = value;
					if (value && !this.data.current) this.data.current = currentDate();
					if (value) this.data.repeatMonthDay = dayOfMonth(this.data.current);
					this.render();
				}));
		if (!this.data.repeat) return;
		const frequency = new Setting(fields)
			.setClass('thread-journal-task-form-field')
			.setName(t('Frequency'))
			.addDropdown((dropdown) => dropdown
				.addOption('daily', t('Daily'))
				.addOption('weekly', t('Weekly'))
				.addOption('monthly', t('Monthly'))
				.addOption('custom', t('Every N days'))
				.setValue(this.data.repeatFrequency)
				.onChange((value) => {
					this.data.repeatFrequency = value as TaskRepeatFrequency;
					if (value === 'monthly') this.data.repeatMonthDay = dayOfMonth(this.data.current);
					this.render();
				}));
		if (this.data.repeatFrequency === 'custom') {
			frequency.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '2';
				text.inputEl.step = '1';
				text.inputEl.addClass('thread-journal-task-repeat-interval');
				text.inputEl.setAttribute('aria-label', t('Interval days'));
				text.setPlaceholder(t('Interval days'));
				text.setValue(String(this.data.repeatInterval)).onChange((value) => {
					this.data.repeatInterval = Number(value);
				});
			});
		}
		const current = new Setting(fields)
			.setClass('thread-journal-task-form-field')
			.setClass('is-current-date')
			.setName(t('Current'));
		const trigger = current.controlEl.createEl('button', {
			cls: 'thread-journal-task-current-trigger',
			text: this.data.current,
			attr: {
				type: 'button',
				'aria-expanded': 'false',
				'aria-label': t('Select current date'),
			},
		});
		trigger.addEventListener('click', () => {
			if (this.closeWindowPicker) {
				this.closeWindowPicker();
				this.closeWindowPicker = undefined;
				return;
			}
			trigger.setAttribute('aria-expanded', 'true');
			this.closeWindowPicker = openTaskDatePicker(
				trigger,
				this.data.current,
				(value) => {
					this.data.current = value;
					if (this.data.repeatFrequency === 'monthly') {
						this.data.repeatMonthDay = dayOfMonth(value);
					}
					this.render();
				},
				() => {
					this.closeWindowPicker = undefined;
					if (trigger.isConnected) trigger.setAttribute('aria-expanded', 'false');
				},
			);
		});
	}

	onClose(): void {
		this.closed = true;
		this.closeWindowPicker?.();
		this.closeWindowPicker = undefined;
		this.contentEl.empty();
	}
}

export class TaskManager {
	private taskLocationIndex?: Promise<Map<string, FileTaskLocation[]>>;
	private taskCommitHandler?: TaskCommitHandler;

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
	) {}

	openHoldingQueue(): void { new HoldingQueueModal(this.app, this).open(); }

	async releaseHolding(task: FileTaskLocation): Promise<void> {
		await this.app.vault.process(task.file, content => {
			const lines = content.split('\n');
			const line = resolveSourceLine(lines, task.line, task.sourceLine, task.parsed.data.taskId);
			const parsed = parseTaskLine(lines[line] ?? '');
			if (!parsed || lines[line] !== task.sourceLine) throw new Error(t('The task changed; reopen the form and try again.'));
			lines[line] = buildTaskLine(releaseTaskHolding(parsed.data), parsed);
			return lines.join('\n');
		});
		this.invalidateTaskIndex();
	}

	invalidateTaskIndex(): void {
		this.taskLocationIndex = undefined;
	}

	setTaskCommitHandler(handler: TaskCommitHandler): void {
		this.taskCommitHandler = handler;
	}

	openFileTaskCommit(
		file: TFile,
		line: number,
		sourceLine: string,
		data: TaskData,
		threadFile?: TFile,
		onUpdated?: () => void,
	): void {
		if (!this.taskCommitHandler) {
			new Notice(t('Commit creation is not available.'));
			return;
		}
		this.taskCommitHandler({ file, line, sourceLine, data, threadFile, onUpdated });
	}

	async applyCommitOutcome(request: TaskCommitRequest): Promise<void> {
		await this.app.vault.process(request.file, (content) => {
			const lines = content.split('\n');
			const resolved = resolveSourceLine(
				lines,
				request.line,
				request.sourceLine,
				request.data.taskId,
			);
			const current = lines[resolved];
			if (current === undefined) {
				throw new Error(t('The task changed; reopen the form and try again.'));
			}
			const parsed = parseTaskLine(current);
			if (!parsed) throw new Error(t('The task changed; reopen the form and try again.'));
			if (parsed.data.repeat) {
				const replacement = advanceTaskLine(buildTaskLine(completeTaskData(parsed.data), parsed), currentDate());
				if (!replacement) throw new Error(t('The task is not a valid repeating task.'));
				lines[resolved] = replacement;
			} else {
				lines[resolved] = buildTaskLine(completeTaskData(parsed.data), parsed);
			}
			return lines.join('\n');
		});
		this.invalidateTaskIndex();
		request.onUpdated?.();
	}

	async findTasksById(taskId: string): Promise<FileTaskLocation[]> {
		this.taskLocationIndex ??= this.buildTaskLocationIndex();
		return [...((await this.taskLocationIndex).get(taskId) ?? [])];
	}

	private async buildTaskLocationIndex(): Promise<Map<string, FileTaskLocation[]>> {
		const index = new Map<string, FileTaskLocation[]>();
		const entries = await Promise.all(this.app.vault.getMarkdownFiles().map(async (file) => {
			return scanTaskLines(await this.app.vault.cachedRead(file))
				.filter(task => task.parsed.data.taskId).map(task => ({ ...task, file }));
		}));
		for (const location of entries.flat()) {
			const taskId = location.parsed.data.taskId;
			index.set(taskId, [...(index.get(taskId) ?? []), location]);
		}
		return index;
	}

	canOpenTaskEditor(editor: Editor, file: TFile | null): boolean {
		if (!file || this.index.getMember(file)?.roleStatus !== 'active') return false;
		const lines = Array.from({ length: editor.lineCount() }, (_, index) => editor.getLine(index));
		return !cursorLineIsFrontmatter(lines, editor.getCursor().line);
	}

	private openCreateTask(editor: Editor): void {
		new TaskModal(this.app, 'create', { ...EMPTY_TASK }, (data) => {
			const cursor = editor.getCursor();
			const current = editor.getLine(cursor.line);
			if (current.trim()) throw new Error(t('The task changed; reopen the form and try again.'));
			const replacement = buildTaskLine(data, taskDraftFromTextLine(current));
			editor.replaceRange(replacement, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: current.length });
			editor.setCursor({ line: cursor.line, ch: replacement.length });
		}).open();
	}

	openTaskEditor(editor: Editor): void {
		const line = editor.getCursor().line;
		const sourceLine = editor.getLine(line);
		const parsed = parseTaskLine(sourceLine);
		if (parsed) {
			this.openEditorTaskModal(editor, line, parsed);
			return;
		}
		if (!sourceLine.trim()) {
			this.openCreateTask(editor);
			return;
		}
		const draft = taskDraftFromTextLine(sourceLine);
		const replacement = buildTaskLine({ ...draft.data, taskId: createTaskId() }, draft);
		editor.replaceRange(replacement, { line, ch: 0 }, { line, ch: sourceLine.length });
		editor.setCursor({ line, ch: Math.min(replacement.length, draft.prefix.length + 2 + draft.data.content.length) });
		const converted = parseTaskLine(replacement);
		if (converted) this.openEditorTaskModal(editor, line, converted);
	}

	openFileTaskEdit(
		file: TFile,
		line: number,
		sourceLine: string,
		initial: TaskData,
		onSaved?: () => void,
	): void {
		new TaskModal(this.app, 'edit', initial, async (data) => {
			await this.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const resolved = resolveSourceLine(lines, line, sourceLine, initial.taskId);
				const current = lines[resolved];
				const parsed = current === undefined ? undefined : parseTaskLine(current);
				if (!parsed) throw new Error(t('The task changed; reopen the form and try again.'));
				if (current !== sourceLine) throw new Error(t('The task changed; reopen the form and try again.'));
				lines[resolved] = buildTaskLine(data.status === 'completed' ? completeTaskData(data) : data, parsed);
				return lines.join('\n');
			}).then(() => {
				this.invalidateTaskIndex();
				onSaved?.();
			}).catch((error: unknown) => {
				console.error('Thread Journal failed to edit task', error);
				throw error;
			});
		}).open();
	}

	async setFileTaskPinned(
		file: TFile,
		line: number,
		sourceLine: string,
		pinned: boolean,
	): Promise<void> {
		try {
			await this.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const taskId = parseTaskLine(sourceLine)?.data.taskId ?? '';
				const resolved = resolveSourceLine(lines, line, sourceLine, taskId);
				const current = lines[resolved];
				if (current === undefined || !parseTaskLine(current)) {
					throw new Error(t('The task changed; reopen the form and try again.'));
				}
				lines[resolved] = taskLineWithPin(current, pinned);
				return lines.join('\n');
			});
			this.invalidateTaskIndex();
		} catch (error) {
			console.error('Thread Journal failed to update pinned task', error);
			new Notice(t('Failed to update pinned task: {error}', { error: String(error) }));
			throw error;
		}
	}

	async setFileTaskCompleted(
		file: TFile,
		line: number,
		sourceLine: string,
		completed: boolean,
	): Promise<void> {
		try {
			await this.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const taskId = parseTaskLine(sourceLine)?.data.taskId ?? '';
				const resolved = resolveSourceLine(lines, line, sourceLine, taskId);
				const current = lines[resolved];
				const parsed = current === undefined ? undefined : parseTaskLine(current);
				if (!parsed) throw new Error(t('The task changed; reopen the form and try again.'));
				lines[resolved] = buildTaskLine(completed ? completeTaskData(parsed.data) : { ...parsed.data, status: 'open' }, parsed);
				return lines.join('\n');
			});
			this.invalidateTaskIndex();
		} catch (error) {
			console.error('Thread Journal failed to update task completion', error);
			new Notice(t('Failed to update task: {error}', { error: String(error) }));
			throw error;
		}
	}

	moveFileTaskToNext(
		file: TFile,
		line: number,
		sourceLine: string,
		onSaved?: () => void,
	): void {
		void this.app.vault.process(file, (content) => {
			const lines = content.split('\n');
			const taskId = parseTaskLine(sourceLine)?.data.taskId ?? '';
			const resolved = resolveSourceLine(lines, line, sourceLine, taskId);
			const current = lines[resolved];
			const replacement = current === undefined
				? undefined
				: advanceTaskLine(current, currentDate());
			if (!replacement) throw new Error(t('The task is not a valid repeating task.'));
			lines[resolved] = replacement;
			return lines.join('\n');
		}).then(() => {
			this.invalidateTaskIndex();
			onSaved?.();
		}).catch((error: unknown) => {
			console.error('Thread Journal failed to move task to next occurrence', error);
			new Notice(t('Failed to move task to next: {error}', { error: String(error) }));
		});
	}

	private openEditorTaskModal(editor: Editor, line: number, parsed: ParsedTaskLine): void {
		const sourceLine = editor.getLine(line);
		new TaskModal(this.app, 'edit', parsed.data, (data) => {
			const lines = Array.from({ length: editor.lineCount() }, (_, index) => editor.getLine(index));
			line = resolveSourceLine(lines, line, sourceLine, parsed.data.taskId);
			const current = editor.getLine(line);
			if (current !== sourceLine) throw new Error(t('The task changed; reopen the form and try again.'));
			const currentTask = parseTaskLine(current);
			if (!currentTask) {
				new Notice(t('The task changed; reopen the form and try again.'));
				return;
			}
			const replacement = buildTaskLine(data.status === 'completed' ? completeTaskData(data) : data, currentTask);
			editor.replaceRange(replacement, { line, ch: 0 }, { line, ch: current.length });
			editor.setCursor({
				line,
				ch: Math.min(replacement.length, currentTask.prefix.length + 2 + data.content.length),
			});
		}).open();
	}
}

export function resolveSourceLine(
	lines: readonly string[],
	line: number,
	sourceLine: string,
	taskId = '',
): number {
	if (lines[line] === sourceLine) return line;
	if (taskId) {
		const idMatches = lines.flatMap((source, index) =>
			parseTaskLine(source)?.data.taskId === taskId ? [index] : []);
		if (idMatches.length === 1) return idMatches[0] ?? line;
	}
	const matches = lines.flatMap((source, index) => source === sourceLine ? [index] : []);
	if (matches.length !== 1) throw new Error(t('The task changed; reopen the form and try again.'));
	return matches[0] ?? line;
}
