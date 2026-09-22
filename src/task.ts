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
	buildTaskLine,
	createTaskId,
	EMPTY_TASK,
	parseTaskLine,
	taskInsertionEdit,
	taskValidationError,
	taskWindowLabel,
	type ParsedTaskLine,
	type TaskData,
	type TaskEffort,
	type TaskRepeatFrequency,
} from './task-model';
import { openTaskDatePicker, openTaskWindowPicker } from './task-window-picker';
import type { ThreadIndex } from './thread-index';

type TaskSubmit = (data: TaskData) => void;

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
		this.addWindowField(choiceFields);
		this.renderRepeatFields();

		const actions = new Setting(this.contentEl).setClass('thread-journal-task-actions');
		actions.addButton((button) => button
			.setButtonText(t('Cancel'))
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText(this.mode === 'create' ? t('Create task') : t('Save changes'))
			.setCta()
			.onClick(() => {
				if (this.saving) return;
				if (!this.data.taskId) this.data.taskId = createTaskId();
				const error = taskValidationError(this.data);
				if (error === 'content') new Notice(t('Enter task content.'));
				else if (error === 'window-order') new Notice(t('The window end must be on or after its start.'));
				else if (error === 'repeat-current') new Notice(t('Choose the current repeat date.'));
				else if (error === 'repeat-interval') new Notice(t('Enter a repeat interval of at least 2 days.'));
				if (error) return;
				this.saving = true;
				this.onSubmit({ ...this.data });
				this.close();
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
				const replacement = advanceTaskLine(current, currentDate());
				if (!replacement) throw new Error(t('The task is not a valid repeating task.'));
				lines[resolved] = replacement;
			} else {
				lines[resolved] = buildTaskLine(parsed.data, { ...parsed, marker: 'x' });
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
			const lines = (await this.app.vault.cachedRead(file)).split('\n');
			return lines.flatMap((sourceLine, line) => {
				const parsed = parseTaskLine(sourceLine);
				return parsed?.data.taskId ? [{ file, line, sourceLine, parsed }] : [];
			});
		}));
		for (const location of entries.flat()) {
			const taskId = location.parsed.data.taskId;
			index.set(taskId, [...(index.get(taskId) ?? []), location]);
		}
		return index;
	}

	canCreateTask(editor: Editor, file: TFile | null): boolean {
		if (!file || this.index.getMember(file)?.roleStatus !== 'active') return false;
		const lines = Array.from({ length: editor.lineCount() }, (_, index) => editor.getLine(index));
		return !cursorLineIsFrontmatter(lines, editor.getCursor().line);
	}

	canEditTask(editor: Editor, file: TFile | null): boolean {
		return this.canCreateTask(editor, file)
			&& Boolean(parseTaskLine(editor.getLine(editor.getCursor().line)));
	}

	openCreateTask(editor: Editor): void {
		new TaskModal(this.app, 'create', { ...EMPTY_TASK }, (data) => {
			const cursor = editor.getCursor();
			const lines = Array.from({ length: editor.lineCount() }, (_, index) => editor.getLine(index));
			const edit = taskInsertionEdit(lines, cursor.line, buildTaskLine(data));
			editor.replaceRange(edit.replacement, edit.from, edit.to);
			editor.setCursor(edit.cursor);
		}).open();
	}

	openEditTask(editor: Editor): void {
		const line = editor.getCursor().line;
		const parsed = parseTaskLine(editor.getLine(line));
		if (!parsed) {
			new Notice(t('Move the cursor onto a Markdown task first.'));
			return;
		}
		this.openEditorTaskModal(editor, line, parsed);
	}

	openFileTaskEdit(
		file: TFile,
		line: number,
		sourceLine: string,
		initial: TaskData,
		onSaved?: () => void,
	): void {
		new TaskModal(this.app, 'edit', initial, (data) => {
			void this.app.vault.process(file, (content) => {
				const lines = content.split('\n');
				const resolved = resolveSourceLine(lines, line, sourceLine, initial.taskId);
				const current = lines[resolved];
				const parsed = current === undefined ? undefined : parseTaskLine(current);
				if (!parsed) throw new Error(t('The task changed; reopen the form and try again.'));
				lines[resolved] = buildTaskLine(data, parsed);
				return lines.join('\n');
			}).then(() => {
				this.invalidateTaskIndex();
				onSaved?.();
			}).catch((error: unknown) => {
				console.error('Thread Journal failed to edit task', error);
				new Notice(t('Failed to update task: {error}', { error: String(error) }));
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
				lines[resolved] = buildTaskLine(parsed.data, {
					...parsed,
					marker: completed ? 'x' : ' ',
				});
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
		new TaskModal(this.app, 'edit', parsed.data, (data) => {
			const current = editor.getLine(line);
			const currentTask = parseTaskLine(current);
			if (!currentTask) {
				new Notice(t('The task changed; reopen the form and try again.'));
				return;
			}
			const replacement = buildTaskLine(data, currentTask);
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
