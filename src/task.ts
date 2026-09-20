import {
	App,
	type Editor,
	Modal,
	Notice,
	Setting,
	TFile,
} from 'obsidian';
import { t } from './i18n';
import { cursorLineIsFrontmatter } from './checkpoint-core';
import {
	buildTaskLine,
	EMPTY_TASK,
	parseTaskLine,
	taskInsertionEdit,
	taskValidationError,
	type ParsedTaskLine,
	type TaskData,
	type TaskEffort,
	type TaskScheduleMode,
} from './task-model';
import type { ThreadIndex } from './thread-index';
import { create24HourTimeSelect, is24HourTime } from './time-input';

type TaskSubmit = (data: TaskData) => void;

class TaskModal extends Modal {
	private data: TaskData;
	private saving = false;
	private windowStartIncomplete = false;
	private windowEndIncomplete = false;

	constructor(
		app: App,
		private readonly mode: 'create' | 'edit',
		initial: TaskData,
		private readonly onSubmit: TaskSubmit,
	) {
		super(app);
		this.data = { ...initial };
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-task-modal');
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.setTitle(this.mode === 'create' ? t('Create task') : t('Edit task'));
		let focusTarget: HTMLInputElement | undefined;

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

		const choiceFields = this.contentEl.createDiv({
			cls: 'thread-journal-task-choice-fields',
		});
		new Setting(choiceFields)
			.setClass('thread-journal-task-form-field')
			.setName(t('Schedule mode'))
			.addDropdown((dropdown) => dropdown
				.addOption('flexible', t('Flexible'))
				.addOption('fixed', t('Fixed'))
				.setValue(this.data.scheduleMode)
				.onChange((value) => {
					this.data.scheduleMode = value as TaskScheduleMode;
					if (this.data.scheduleMode === 'fixed') this.data.effort = '';
					this.render();
				}));

		if (this.data.scheduleMode === 'flexible') {
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
		}

		const timeFields = this.contentEl.createDiv({ cls: 'thread-journal-task-time-fields' });
		this.addDateTimeField(
			timeFields,
			t('Window start'),
			this.data.windowStart,
			(value, incomplete) => {
				this.data.windowStart = value;
				this.windowStartIncomplete = incomplete;
			},
		);
		this.addDateTimeField(
			timeFields,
			t('Window end'),
			this.data.windowEnd,
			(value, incomplete) => {
				this.data.windowEnd = value;
				this.windowEndIncomplete = incomplete;
			},
		);

		const actions = new Setting(this.contentEl).setClass('thread-journal-task-actions');
		actions.addButton((button) => button
			.setButtonText(t('Cancel'))
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText(this.mode === 'create' ? t('Create task') : t('Save changes'))
			.setCta()
			.onClick(() => {
				if (this.saving) return;
				if (this.windowStartIncomplete || this.windowEndIncomplete) {
					new Notice(t('Enter both a date and a 24-hour time, or clear the boundary.'));
					return;
				}
				const error = taskValidationError(this.data);
				if (error === 'content') new Notice(t('Enter task content.'));
				else if (error === 'fixed-window') new Notice(t('A fixed task requires both a start and an end.'));
				else if (error === 'window-order') new Notice(t('The window end must be later than its start.'));
				if (error) return;
				this.saving = true;
				this.onSubmit({ ...this.data });
				this.close();
			}));

		window.setTimeout(() => focusTarget?.focus(), 0);
	}

	private addDateTimeField(
		parent: HTMLElement,
		name: string,
		value: string,
		onChange: (value: string, incomplete: boolean) => void,
	): void {
		let date = value.slice(0, 10);
		let time = value.slice(11, 16);
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) date = '';
		if (!is24HourTime(time)) time = '';
		let timeIncomplete = false;
		const setting = new Setting(parent)
			.setClass('thread-journal-task-form-field')
			.setClass('is-datetime')
			.setName(name);
		const emit = (): void => {
			const incomplete = timeIncomplete || Boolean(date) !== Boolean(time);
			onChange(date && time ? `${date}T${time}` : '', incomplete);
		};
		const dateInput = setting.controlEl.createEl('input', {
			attr: { type: 'date', 'aria-label': t('Date') },
		});
		dateInput.value = date;
		dateInput.addEventListener('input', () => {
			date = dateInput.value;
			emit();
		});
		const timeControl = create24HourTimeSelect(
			setting.controlEl,
			time,
			(nextTime, incomplete) => {
				time = nextTime;
				timeIncomplete = incomplete;
				emit();
			},
			{ hour: t('Hour'), minute: t('Minute') },
			true,
		);
		const clear = setting.controlEl.createEl('button', {
			text: t('Clear'),
			attr: { type: 'button' },
		});
		clear.addEventListener('click', () => {
			date = '';
			time = '';
			timeIncomplete = false;
			dateInput.value = '';
			timeControl.setValue('');
			emit();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class TaskManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
	) {}

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
		this.openEditModal(editor, line, parsed);
	}

	private openEditModal(editor: Editor, line: number, parsed: ParsedTaskLine): void {
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
