import {
	App,
	MarkdownView,
	Modal,
	Notice,
	Setting,
	TFile,
	moment,
} from 'obsidian';
import {
	appendCheckpointEntry,
	buildCheckpointEntry,
	checkpointEditState,
	checkpointInsertionEdit,
	cursorLineIsFrontmatter,
	deleteCheckpointEntry,
	replaceCheckpointEntry,
	type CheckpointValue,
	type ParsedCheckpointEntry,
} from './checkpoint-core';
import {
	activeCheckpointFields,
	checkpointFieldsForThread,
} from './checkpoint-model';
import {
	CHECKPOINT_PANEL_VIEW_TYPE,
	CheckpointPanelView,
	type CheckpointPanelRequest,
} from './checkpoint-panel';
import { CheckpointTemplateModal } from './checkpoint-template';
import type { ThreadIndex } from './thread-index';
import { THREAD_STATUS_CHOICES, type ThreadStatus } from './thread-status-model';
import { t } from './i18n';
import type { CheckpointFieldSpec, ThreadJournalSettings } from './types';
import { create24HourTimeSelect, is24HourTime } from './time-input';

function checkpointBlockId(): string {
	const suffix = Math.random().toString(36).slice(2, 7);
	return `cp-${moment().format('YYYYMMDD-HHmmss')}-${suffix}`;
}

function valueIsPresent(value: CheckpointValue | undefined): boolean {
	return value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
}

function checkpointStatus(value: CheckpointValue | undefined): ThreadStatus | undefined {
	if (typeof value !== 'string') return undefined;
	return THREAD_STATUS_CHOICES.some((choice) => choice.value === value)
		? value as ThreadStatus
		: undefined;
}

function threadCheckpointFields(app: App, file: TFile): unknown {
	const frontmatter: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
	if (typeof frontmatter !== 'object' || frontmatter === null) return undefined;
	return (frontmatter as Record<string, unknown>).checkpoint_fields;
}

interface CheckpointModalInitialState {
	date: string;
	time: string;
	values: Record<string, CheckpointValue | undefined>;
}

type CheckpointSubmit = (
	date: string,
	time: string,
	values: Record<string, CheckpointValue | undefined>,
) => Promise<void>;

function checkpointFormValues(
	fields: CheckpointFieldSpec[],
	date: string,
	time: string,
	initial?: Record<string, CheckpointValue | undefined>,
): Record<string, CheckpointValue | undefined> {
	const values: Record<string, CheckpointValue | undefined> = {
		...initial,
		checkpoint_date: date,
		checkpoint_time: time,
	};
	for (const field of fields) {
		if (values[field.key] !== undefined) continue;
		if (field.control === 'toggle') values[field.key] = false;
		else if (field.control === 'select' && field.required && field.options[0]) {
			values[field.key] = field.options[0];
		}
		else if (field.control === 'date' && field.required) values[field.key] = date;
	}
	return values;
}

class CheckpointModal extends Modal {
	private date: string;
	private time: string;
	private readonly values: Record<string, CheckpointValue | undefined>;
	private saving = false;

	constructor(
		app: App,
		private readonly threadTitle: string,
		private readonly fields: CheckpointFieldSpec[],
		private readonly onSubmit: CheckpointSubmit,
		private readonly initial?: CheckpointModalInitialState,
	) {
		super(app);
		this.date = initial?.date || moment().format('YYYY-MM-DD');
		this.time = initial?.time || moment().format('HH:mm');
		this.values = checkpointFormValues(fields, this.date, this.time, initial?.values);
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-checkpoint-modal');
		this.setTitle(this.initial ? t('Edit checkpoint') : t('Create checkpoint'));
		this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-target',
			text: this.threadTitle,
		});

		const systemFields = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-system-fields',
		});
		new Setting(systemFields)
			.setClass('thread-journal-checkpoint-form-field')
			.setClass('is-compact')
			.setName(t('Date'))
			.setDesc(t('The date when the checkpoint occurred.'))
			.addText((text) => {
				text.inputEl.type = 'date';
				text.setValue(this.date).onChange((value) => {
					this.date = value;
				});
			});

		const timeSetting = new Setting(systemFields)
			.setClass('thread-journal-checkpoint-form-field')
			.setClass('is-compact')
			.setName(t('Time'))
			.setDesc(t('The time when the checkpoint occurred, in 24-hour HH:mm format.'));
		create24HourTimeSelect(
			timeSetting.controlEl,
			this.time,
			(value) => { this.time = value; },
			{ hour: t('Hour'), minute: t('Minute') },
		);

		let focusTarget: HTMLInputElement | HTMLTextAreaElement | undefined;
		const customFields = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-custom-fields',
		});
		for (const field of this.fields) {
			const wide = field.control === 'text' || field.control === 'textarea';
			const setting = new Setting(customFields)
				.setClass('thread-journal-checkpoint-form-field')
				.setClass(wide ? 'is-wide' : 'is-compact')
				.setClass(`is-${field.control}`)
				.setName(`${field.label}${field.required ? ' *' : ''}`)
				.setDesc(field.storage === 'inline'
					? t('Queryable field · {key}', { key: field.key })
					: t('Checkpoint body · {key}', { key: field.key }));
				switch (field.control) {
				case 'textarea':
					setting.addTextArea((text) => {
						const current = this.values[field.key];
						text.setValue(typeof current === 'string' ? current : '')
							.setPlaceholder(field.label).onChange((value) => {
							this.values[field.key] = value;
						});
						text.inputEl.rows = 6;
						focusTarget ??= field.required ? text.inputEl : undefined;
					});
					break;
				case 'toggle':
					setting.addToggle((toggle) => toggle
						.setValue(Boolean(this.values[field.key]))
						.onChange((value) => {
							this.values[field.key] = value;
						}));
					break;
				case 'select':
					setting.addDropdown((dropdown) => {
						if (!field.required) dropdown.addOption('', t('Not selected'));
						for (const option of field.options) dropdown.addOption(option, option);
						const current = this.values[field.key];
						if (
							typeof current === 'string'
							&& current
							&& !field.options.includes(current)
						) {
							dropdown.addOption(current, current);
						}
						dropdown.setValue(typeof current === 'string' ? current : '');
						dropdown.onChange((value) => {
							this.values[field.key] = value;
						});
					});
					break;
				default:
					setting.addText((text) => {
						if (field.control === 'date') text.inputEl.type = 'date';
						if (field.control === 'number') text.inputEl.type = 'number';
						const current = this.values[field.key];
						text.setValue(typeof current === 'string' ? current : '')
							.setPlaceholder(field.label)
							.onChange((value) => {
								this.values[field.key] = value;
							});
						focusTarget ??= field.required ? text.inputEl : undefined;
					});
			}
		}

		const actions = new Setting(this.contentEl)
			.setClass('thread-journal-checkpoint-actions');
		actions.addButton((button) => button
			.setButtonText(this.initial ? t('Save changes') : t('Save checkpoint'))
			.setCta()
			.onClick(async () => {
				if (this.saving) return;
				if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) {
					new Notice(t('Enter a valid checkpoint date.'));
					return;
				}
				if (!is24HourTime(this.time)) {
					new Notice(t('Enter a valid checkpoint time.'));
					return;
				}
				const missing = this.fields.find((field) =>
					field.required && !valueIsPresent(this.values[field.key]));
				if (missing) {
					new Notice(t('Enter {field}.', { field: missing.label }));
					return;
				}
				this.saving = true;
				button.setDisabled(true);
				try {
					await this.onSubmit(this.date, this.time, { ...this.values });
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to save checkpoint', error);
					new Notice(t('Failed to save checkpoint: {error}', { error: String(error) }));
					this.saving = false;
					button.setDisabled(false);
				}
			}));

		window.setTimeout(() => focusTarget?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class CheckpointDeleteModal extends Modal {
	private deleting = false;

	constructor(
		app: App,
		private readonly threadFile: TFile,
		private readonly entry: ParsedCheckpointEntry,
		private readonly onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t('Delete checkpoint'));
		const date = this.entry.values.checkpoint_date || t('No date entered');
		const time = this.entry.values.checkpoint_time;
		this.contentEl.createEl('p', {
			text: t('Delete the checkpoint from {timestamp}?', {
				timestamp: `${date}${time ? ` ${time}` : ''}`,
			}),
		});
		this.contentEl.createEl('p', {
			cls: 'mod-warning',
			text: t('Only this checkpoint block in {file} will be deleted.', {
				file: this.threadFile.basename,
			}),
		});
		const actions = new Setting(this.contentEl)
			.setClass('thread-journal-checkpoint-actions');
		actions.addButton((button) => button
			.setButtonText(t('Cancel'))
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText(t('Delete checkpoint'))
			.setDestructive()
			.setCta()
			.onClick(async () => {
				if (this.deleting) return;
				this.deleting = true;
				button.setDisabled(true);
				try {
					await this.onConfirm();
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to delete checkpoint', error);
					new Notice(t('Failed to delete checkpoint: {error}', { error: String(error) }));
					this.deleting = false;
					button.setDisabled(false);
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class CheckpointManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	getCurrentThreadFile(): TFile | undefined {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return undefined;
		return this.index.getThreadFile(file);
	}

	canCreateCurrentCheckpoint(): boolean {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return false;
		if (this.index.getThread(file)) return true;
		const member = this.index.getMember(file);
		return member?.roleStatus === 'active' && Boolean(this.index.getThreadForMember(file));
	}

	private openCheckpointForm(
		threadFile: TFile,
		fields: CheckpointFieldSpec[],
		onSubmit: CheckpointSubmit,
		initial?: CheckpointModalInitialState,
	): void {
		const date = initial?.date || moment().format('YYYY-MM-DD');
		const time = initial?.time || moment().format('HH:mm');
		const threadTitle = this.index.getThread(threadFile)?.title ?? threadFile.basename;
		const values = checkpointFormValues(fields, date, time, initial?.values);
		const request: CheckpointPanelRequest = {
			mode: initial ? 'edit' : 'create',
			threadTitle,
			fields,
			date,
			time,
			values,
			onSubmit,
		};
		void this.openCheckpointPanel(request).catch((error: unknown) => {
			console.error('Thread Journal failed to open checkpoint side panel', error);
			new Notice(t('Failed to open the checkpoint side panel; using the fallback form.'));
			this.openFallbackCheckpointForm(threadTitle, fields, onSubmit, initial);
		});
	}

	private async openCheckpointPanel(request: CheckpointPanelRequest): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(
			CHECKPOINT_PANEL_VIEW_TYPE,
			'right',
			{ active: true, reveal: true },
		);
		await leaf.loadIfDeferred();
		if (!(leaf.view instanceof CheckpointPanelView)) {
			throw new Error(t('The checkpoint side panel did not load correctly.'));
		}
		leaf.view.setForm(request);
		await this.app.workspace.revealLeaf(leaf);
	}

	private openFallbackCheckpointForm(
		threadTitle: string,
		fields: CheckpointFieldSpec[],
		onSubmit: CheckpointSubmit,
		initial?: CheckpointModalInitialState,
	): void {
		new CheckpointModal(
			this.app,
			threadTitle,
			fields,
			onSubmit,
			initial,
		).open();
	}

	openCheckpointTemplateModal(threadFile: TFile): void {
		if (!this.index.getThread(threadFile)) {
			new Notice(t('The current file is not a valid thread meta.'));
			return;
		}
		const ownTemplate = threadCheckpointFields(this.app, threadFile);
		const fields = checkpointFieldsForThread(
			ownTemplate,
			this.getSettings().checkpointFields,
		);
		new CheckpointTemplateModal(
			this.app,
			this.index.getThread(threadFile)?.title ?? threadFile.basename,
			fields,
			!Array.isArray(ownTemplate),
			async (nextFields) => {
				await this.app.fileManager.processFrontMatter(threadFile, (metadata) => {
					(metadata as Record<string, unknown>).checkpoint_fields = nextFields;
				});
			},
		).open();
	}

	openCurrentCheckpointModal(): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const activeFile = activeView?.file;
		const threadFile = activeFile ? this.index.getThreadFile(activeFile) : undefined;
		if (!threadFile) {
			new Notice(t('The current file does not belong to a thread.'));
			return;
		}
		const member = activeFile ? this.index.getMember(activeFile) : undefined;
		if (member?.roleStatus === 'terminated') {
			new Notice(t('The current thread role is terminated and cannot create checkpoints.'));
			return;
		}
		const originMember = activeFile && member?.roleStatus === 'active'
			&& this.index.getThreadForMember(activeFile)
			? activeFile
			: undefined;
		const originView = originMember && activeView?.getMode() === 'source'
			? activeView
			: undefined;
		void this.openNewCheckpointForm(threadFile, originMember, originView);
	}

	private async openNewCheckpointForm(
		threadFile: TFile,
		originMember?: TFile,
		originView?: MarkdownView,
	): Promise<void> {
		const targetFile = originMember ?? this.index.getEntry(threadFile);
		if (!targetFile) {
			new Notice(t('The current thread has no valid entry file for saving the checkpoint.'));
			return;
		}
		const ownTemplate = threadCheckpointFields(this.app, threadFile);
		const fields = activeCheckpointFields(checkpointFieldsForThread(
			ownTemplate,
			this.getSettings().checkpointFields,
		));
		this.openCheckpointForm(threadFile, fields, async (date, time, values) => {
			const entry = buildCheckpointEntry({
				date,
				time,
				blockId: checkpointBlockId(),
				fields,
				values,
			});
			if (originView) {
				if (
					!originView.containerEl.isConnected
					|| originView.file?.path !== targetFile.path
					|| originView.getMode() !== 'source'
				) {
					throw new Error(t('Keep the target thread file open in editing view until saving.'));
				}
				if (this.index.getMember(targetFile)?.roleStatus !== 'active') {
					throw new Error(t('The current thread role is terminated and cannot create checkpoints.'));
				}
				const editor = originView.editor;
				const lines = Array.from({ length: editor.lineCount() }, (_, line) => editor.getLine(line));
				const cursorLine = editor.getCursor().line;
				if (cursorLineIsFrontmatter(lines, cursorLine)) {
					throw new Error(t('Move the cursor into the document body first.'));
				}
				const edit = checkpointInsertionEdit(lines, entry, cursorLine);
				editor.replaceRange(edit.replacement, edit.from, edit.to);
				await originView.save();
			} else {
				await this.app.vault.process(targetFile, (content) =>
					appendCheckpointEntry(content, entry));
			}
			const nextStatus = checkpointStatus(values.status_after);
			if (nextStatus) {
				try {
					await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
						const metadata = frontmatter as Record<string, unknown>;
						metadata.status = nextStatus;
					});
				} catch (error) {
					console.error('Thread Journal failed to update status after checkpoint', error);
					new Notice(t('Checkpoint saved, but the status update failed: {error}', { error: String(error) }));
					return;
				}
			}
			const title = this.index.getThread(threadFile)?.title ?? threadFile.basename;
			new Notice(t('Created a checkpoint for {title}.', { title }));
		});
	}

	openCheckpointEditModal(sourceFile: TFile, entry: ParsedCheckpointEntry): void {
		if (!entry.blockId) {
			new Notice(t('This checkpoint has no block ID and cannot be edited safely.'));
			return;
		}
		const threadFile = this.index.getThreadForMember(sourceFile);
		if (!threadFile) {
			new Notice(t('Cannot locate the thread meta from the thread ID.'));
			return;
		}
		const ownTemplate = threadCheckpointFields(this.app, threadFile);
		const templateFields = checkpointFieldsForThread(
			ownTemplate,
			this.getSettings().checkpointFields,
		);
		const editState = checkpointEditState(templateFields, entry);
		this.openCheckpointForm(
			threadFile,
			editState.fields,
			async (date, time, values) => {
				const replacement = buildCheckpointEntry({
					date,
					time,
					blockId: entry.blockId ?? '',
					fields: editState.fields,
					values,
				});
				await this.app.vault.process(sourceFile, (content) =>
					replaceCheckpointEntry(content, entry.blockId ?? '', replacement));
				const title = this.index.getThread(threadFile)?.title ?? threadFile.basename;
				new Notice(t('Updated the checkpoint for {title}.', { title }));
			},
			{
				date: entry.values.checkpoint_date || moment().format('YYYY-MM-DD'),
				time: entry.values.checkpoint_time || moment().format('HH:mm'),
				values: editState.values,
			},
		);
	}

	openCheckpointDeleteModal(sourceFile: TFile, entry: ParsedCheckpointEntry): void {
		if (!entry.blockId) {
			new Notice(t('This checkpoint has no block ID and cannot be deleted safely.'));
			return;
		}
		const threadFile = this.index.getThreadForMember(sourceFile);
		if (!threadFile) {
			new Notice(t('Cannot locate the thread meta from the thread ID.'));
			return;
		}
		new CheckpointDeleteModal(this.app, sourceFile, entry, async () => {
			await this.app.vault.process(sourceFile, (content) =>
				deleteCheckpointEntry(content, entry.blockId ?? ''));
			const title = this.index.getThread(threadFile)?.title ?? threadFile.basename;
			new Notice(t('Deleted the checkpoint for {title}.', { title }));
		}).open();
	}
}
