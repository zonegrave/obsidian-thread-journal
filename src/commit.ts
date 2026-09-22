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
	appendCommitEntry,
	buildCommitEntry,
	commitEditState,
	commitInsertionEdit,
	cursorLineIsFrontmatter,
	deleteCommitEntry,
	insertCommitAfterTask,
	replaceCommitEntry,
	type CommitValue,
	type ParsedCommitEntry,
} from './commit-core';
import {
	activeCommitFields,
	commitFieldsForThread,
} from './commit-model';
import {
	COMMIT_PANEL_VIEW_TYPE,
	CommitPanelView,
	type CommitPanelRequest,
} from './commit-panel';
import { CommitTemplateModal } from './commit-template';
import type { ThreadIndex } from './thread-index';
import { THREAD_STATUS_CHOICES, type ThreadStatus } from './thread-status-model';
import { t } from './i18n';
import type { CommitFieldSpec, ThreadJournalSettings } from './types';
import { create24HourTimeSelect, is24HourTime } from './time-input';
import { resolveSourceLine, type TaskCommitRequest } from './task';

function commitBlockId(): string {
	const suffix = Math.random().toString(36).slice(2, 7);
	return `cm-${moment().format('YYYYMMDD-HHmmss')}-${suffix}`;
}

function valueIsPresent(value: CommitValue | undefined): boolean {
	return value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
}

function commitStatus(value: CommitValue | undefined): ThreadStatus | undefined {
	if (typeof value !== 'string') return undefined;
	return THREAD_STATUS_CHOICES.some((choice) => choice.value === value)
		? value as ThreadStatus
		: undefined;
}

function threadCommitFields(app: App, file: TFile): unknown {
	const frontmatter: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
	if (typeof frontmatter !== 'object' || frontmatter === null) return undefined;
	return (frontmatter as Record<string, unknown>).commit_fields;
}

interface CommitModalInitialState {
	date: string;
	time: string;
	values: Record<string, CommitValue | undefined>;
	mode?: 'create' | 'edit';
}

type CommitSubmit = (
	date: string,
	time: string,
	values: Record<string, CommitValue | undefined>,
) => Promise<void>;

function commitFormValues(
	fields: CommitFieldSpec[],
	date: string,
	time: string,
	initial?: Record<string, CommitValue | undefined>,
): Record<string, CommitValue | undefined> {
	const values: Record<string, CommitValue | undefined> = {
		...initial,
		commit_date: date,
		commit_time: time,
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

class CommitModal extends Modal {
	private date: string;
	private time: string;
	private readonly values: Record<string, CommitValue | undefined>;
	private saving = false;

	constructor(
		app: App,
		private readonly threadTitle: string,
		private readonly fields: CommitFieldSpec[],
		private readonly onSubmit: CommitSubmit,
		private readonly initial?: CommitModalInitialState,
	) {
		super(app);
		this.date = initial?.date || moment().format('YYYY-MM-DD');
		this.time = initial?.time || moment().format('HH:mm');
		this.values = commitFormValues(fields, this.date, this.time, initial?.values);
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-commit-modal');
		this.setTitle(this.initial?.mode === 'edit' ? t('Edit commit') : t('Create commit'));
		this.contentEl.createDiv({
			cls: 'thread-journal-commit-target',
			text: this.threadTitle,
		});

		const systemFields = this.contentEl.createDiv({
			cls: 'thread-journal-commit-system-fields',
		});
		new Setting(systemFields)
			.setClass('thread-journal-commit-form-field')
			.setClass('is-compact')
			.setName(t('Date'))
			.setDesc(t('The date when the commit occurred.'))
			.addText((text) => {
				text.inputEl.type = 'date';
				text.setValue(this.date).onChange((value) => {
					this.date = value;
				});
			});

		const timeSetting = new Setting(systemFields)
			.setClass('thread-journal-commit-form-field')
			.setClass('is-compact')
			.setName(t('Time'))
			.setDesc(t('The time when the commit occurred, in 24-hour HH:mm format.'));
		create24HourTimeSelect(
			timeSetting.controlEl,
			this.time,
			(value) => { this.time = value; },
			{ hour: t('Hour'), minute: t('Minute') },
		);

		let focusTarget: HTMLInputElement | HTMLTextAreaElement | undefined;
		const customFields = this.contentEl.createDiv({
			cls: 'thread-journal-commit-custom-fields',
		});
		for (const field of this.fields) {
			const wide = field.control === 'text' || field.control === 'textarea';
			const setting = new Setting(customFields)
				.setClass('thread-journal-commit-form-field')
				.setClass(wide ? 'is-wide' : 'is-compact')
				.setClass(`is-${field.control}`)
				.setName(`${field.label}${field.required ? ' *' : ''}`)
				.setDesc(field.storage === 'inline'
					? t('Queryable field · {key}', { key: field.key })
					: t('Commit body · {key}', { key: field.key }));
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
			.setClass('thread-journal-commit-actions');
		actions.addButton((button) => button
			.setButtonText(this.initial?.mode === 'edit' ? t('Save changes') : t('Save commit'))
			.setCta()
			.onClick(async () => {
				if (this.saving) return;
				if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) {
					new Notice(t('Enter a valid commit date.'));
					return;
				}
				if (!is24HourTime(this.time)) {
					new Notice(t('Enter a valid commit time.'));
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
					console.error('Thread Journal failed to save commit', error);
					new Notice(t('Failed to save commit: {error}', { error: String(error) }));
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

class CommitDeleteModal extends Modal {
	private deleting = false;

	constructor(
		app: App,
		private readonly threadFile: TFile,
		private readonly entry: ParsedCommitEntry,
		private readonly onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t('Delete commit'));
		const date = this.entry.values.commit_date || t('No date entered');
		const time = this.entry.values.commit_time;
		this.contentEl.createEl('p', {
			text: t('Delete the commit from {timestamp}?', {
				timestamp: `${date}${time ? ` ${time}` : ''}`,
			}),
		});
		this.contentEl.createEl('p', {
			cls: 'mod-warning',
			text: t('Only this commit block in {file} will be deleted.', {
				file: this.threadFile.basename,
			}),
		});
		const actions = new Setting(this.contentEl)
			.setClass('thread-journal-commit-actions');
		actions.addButton((button) => button
			.setButtonText(t('Cancel'))
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText(t('Delete commit'))
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
					console.error('Thread Journal failed to delete commit', error);
					new Notice(t('Failed to delete commit: {error}', { error: String(error) }));
					this.deleting = false;
					button.setDisabled(false);
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class CommitManager {
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

	canCreateCurrentCommit(): boolean {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return false;
		if (this.index.getThread(file)) return true;
		const member = this.index.getMember(file);
		return member?.roleStatus === 'active' && Boolean(this.index.getThreadForMember(file));
	}

	private openCommitForm(
		threadFile: TFile,
		fields: CommitFieldSpec[],
		onSubmit: CommitSubmit,
		initial?: CommitModalInitialState,
	): void {
		const date = initial?.date || moment().format('YYYY-MM-DD');
		const time = initial?.time || moment().format('HH:mm');
		const threadTitle = this.index.getThread(threadFile)?.title ?? threadFile.basename;
		const values = commitFormValues(fields, date, time, initial?.values);
		const request: CommitPanelRequest = {
			mode: initial?.mode === 'edit' ? 'edit' : 'create',
			threadTitle,
			fields,
			date,
			time,
			values,
			onSubmit,
		};
		void this.openCommitPanel(request).catch((error: unknown) => {
			console.error('Thread Journal failed to open commit side panel', error);
			new Notice(t('Failed to open the commit side panel; using the fallback form.'));
			this.openFallbackCommitForm(threadTitle, fields, onSubmit, initial);
		});
	}

	private async openCommitPanel(request: CommitPanelRequest): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(
			COMMIT_PANEL_VIEW_TYPE,
			'right',
			{ active: true, reveal: true },
		);
		await leaf.loadIfDeferred();
		if (!(leaf.view instanceof CommitPanelView)) {
			throw new Error(t('The commit side panel did not load correctly.'));
		}
		leaf.view.setForm(request);
		await this.app.workspace.revealLeaf(leaf);
	}

	private openFallbackCommitForm(
		threadTitle: string,
		fields: CommitFieldSpec[],
		onSubmit: CommitSubmit,
		initial?: CommitModalInitialState,
	): void {
		new CommitModal(
			this.app,
			threadTitle,
			fields,
			onSubmit,
			initial,
		).open();
	}

	openCommitTemplateModal(threadFile: TFile): void {
		if (!this.index.getThread(threadFile)) {
			new Notice(t('The current file is not a valid thread meta.'));
			return;
		}
		const ownTemplate = threadCommitFields(this.app, threadFile);
		const fields = commitFieldsForThread(
			ownTemplate,
			this.getSettings().commitFields,
		);
		new CommitTemplateModal(
			this.app,
			this.index.getThread(threadFile)?.title ?? threadFile.basename,
			fields,
			!Array.isArray(ownTemplate),
			async (nextFields) => {
				await this.app.fileManager.processFrontMatter(threadFile, (metadata) => {
					(metadata as Record<string, unknown>).commit_fields = nextFields;
				});
			},
		).open();
	}

	openCurrentCommitModal(): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const activeFile = activeView?.file;
		const threadFile = activeFile ? this.index.getThreadFile(activeFile) : undefined;
		if (!threadFile) {
			new Notice(t('The current file does not belong to a thread.'));
			return;
		}
		const member = activeFile ? this.index.getMember(activeFile) : undefined;
		if (member?.roleStatus === 'terminated') {
			new Notice(t('The current thread role is terminated and cannot create commits.'));
			return;
		}
		const originMember = activeFile && member?.roleStatus === 'active'
			&& this.index.getThreadForMember(activeFile)
			? activeFile
			: undefined;
		const originView = originMember && activeView?.getMode() === 'source'
			? activeView
			: undefined;
		void this.openNewCommitForm(threadFile, originMember, originView);
	}

	private async openNewCommitForm(
		threadFile: TFile,
		originMember?: TFile,
		originView?: MarkdownView,
	): Promise<void> {
		const targetFile = originMember ?? this.index.getEntry(threadFile);
		if (!targetFile) {
			new Notice(t('The current thread has no valid entry file for saving the commit.'));
			return;
		}
		const ownTemplate = threadCommitFields(this.app, threadFile);
		const fields = activeCommitFields(commitFieldsForThread(
			ownTemplate,
			this.getSettings().commitFields,
		));
		this.openCommitForm(threadFile, fields, async (date, time, values) => {
			const entry = buildCommitEntry({
				date,
				time,
				blockId: commitBlockId(),
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
					throw new Error(t('The current thread role is terminated and cannot create commits.'));
				}
				const editor = originView.editor;
				const lines = Array.from({ length: editor.lineCount() }, (_, line) => editor.getLine(line));
				const cursorLine = editor.getCursor().line;
				if (cursorLineIsFrontmatter(lines, cursorLine)) {
					throw new Error(t('Move the cursor into the document body first.'));
				}
				const edit = commitInsertionEdit(lines, entry, cursorLine);
				editor.replaceRange(edit.replacement, edit.from, edit.to);
				await originView.save();
			} else {
				await this.app.vault.process(targetFile, (content) =>
					appendCommitEntry(content, entry));
			}
			const nextStatus = commitStatus(values.status_after);
			if (nextStatus) {
				try {
					await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
						const metadata = frontmatter as Record<string, unknown>;
						metadata.status = nextStatus;
					});
				} catch (error) {
					console.error('Thread Journal failed to update status after commit', error);
					new Notice(t('Commit saved, but the status update failed: {error}', { error: String(error) }));
					return;
				}
			}
			const title = this.index.getThread(threadFile)?.title ?? threadFile.basename;
			new Notice(t('Created a commit for {title}.', { title }));
		});
	}

	openTaskCommitModal(
		request: TaskCommitRequest,
		onTaskCommitted: () => Promise<void>,
	): void {
		const sourceThreadFile = this.index.getThreadFile(request.file);
		const requestedThreadFile = request.threadFile && this.index.getThread(request.threadFile)
			? request.threadFile
			: undefined;
		const linkedThreadFiles = new Map<string, TFile>();
		if (!sourceThreadFile && !requestedThreadFile) {
			for (const link of this.app.metadataCache.getFileCache(request.file)?.links ?? []) {
				if (link.position.start.line !== request.line) continue;
				const target = this.app.metadataCache.getFirstLinkpathDest(link.link, request.file.path);
				const linkedThread = target ? this.index.getThreadFile(target) : undefined;
				if (linkedThread) linkedThreadFiles.set(linkedThread.path, linkedThread);
			}
		}
		if (!sourceThreadFile && !requestedThreadFile && linkedThreadFiles.size > 1) {
			new Notice(t('The task belongs to multiple threads; create its commit from the thread overview.'));
			return;
		}
		const threadFile = sourceThreadFile
			?? requestedThreadFile
			?? [...linkedThreadFiles.values()][0];
		if (!threadFile) {
			new Notice(t('The task does not belong to a thread.'));
			return;
		}
		const thread = this.index.getThread(threadFile);
		if (!thread) {
			new Notice(t('The task does not belong to a thread.'));
			return;
		}
		const member = this.index.getMember(request.file);
		const sourceMember = member?.roleStatus === 'active' && member.threadId === thread.id
			? request.file
			: undefined;
		const targetFile = sourceMember ?? this.index.getEntry(threadFile);
		if (!targetFile) {
			new Notice(t('The task thread has no valid entry file for saving the commit.'));
			return;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const originView = sourceMember
			&& activeView?.file?.path === sourceMember.path
			&& activeView.getMode() === 'source'
			? activeView
			: undefined;
		const fields = activeCommitFields(commitFieldsForThread(
			threadCommitFields(this.app, threadFile),
			this.getSettings().commitFields,
		));
		const values: Record<string, CommitValue | undefined> = {};
		if (fields.some((field) => field.key === 'commit_summary')) {
			values.commit_summary = request.data.content;
		}
		if (request.data.effort && fields.some((field) => field.key === 'effort')) {
			values.effort = request.data.effort;
		}
		const now = moment();
		this.openCommitForm(
			threadFile,
			fields,
			async (date, time, submittedValues) => {
				const entry = buildCommitEntry({
					date,
					time,
					blockId: commitBlockId(),
					fields,
					values: submittedValues,
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
						throw new Error(t('The current thread role is terminated and cannot create commits.'));
					}
					const editor = originView.editor;
					const lines = Array.from(
						{ length: editor.lineCount() },
						(_, line) => editor.getLine(line),
					);
					const cursorLine = editor.getCursor().line;
					if (cursorLineIsFrontmatter(lines, cursorLine)) {
						throw new Error(t('Move the cursor into the document body first.'));
					}
					const edit = commitInsertionEdit(lines, entry, cursorLine);
					editor.replaceRange(edit.replacement, edit.from, edit.to);
					await originView.save();
				} else if (sourceMember) {
					await this.app.vault.process(sourceMember, (content) => {
						const lines = content.split('\n');
						const resolved = resolveSourceLine(
							lines,
							request.line,
							request.sourceLine,
							request.data.taskId,
						);
						return insertCommitAfterTask(content, resolved, entry);
					});
				} else {
					await this.app.vault.process(targetFile, (content) => appendCommitEntry(content, entry));
				}

				const nextStatus = commitStatus(submittedValues.status_after);
				if (nextStatus) {
					try {
						await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
							(frontmatter as Record<string, unknown>).status = nextStatus;
						});
					} catch (error) {
						console.error('Thread Journal failed to update status after task commit', error);
						new Notice(t('Commit saved, but the status update failed: {error}', {
							error: String(error),
						}));
					}
				}
				try {
					await onTaskCommitted();
				} catch (error) {
					console.error('Thread Journal saved the commit but failed to update its task', error);
					request.onUpdated?.();
					new Notice(t('Commit saved, but the task could not be updated: {error}', {
						error: String(error),
					}));
					return;
				}
				new Notice(t('Created a commit for {title}.', { title: thread.title }));
			},
			{
				date: now.format('YYYY-MM-DD'),
				time: now.format('HH:mm'),
				values,
				mode: 'create',
			},
		);
	}

	openCommitEditModal(sourceFile: TFile, entry: ParsedCommitEntry): void {
		if (!entry.blockId) {
			new Notice(t('This commit has no block ID and cannot be edited safely.'));
			return;
		}
		const threadFile = this.index.getThreadForMember(sourceFile);
		if (!threadFile) {
			new Notice(t('Cannot locate the thread meta from the thread ID.'));
			return;
		}
		const ownTemplate = threadCommitFields(this.app, threadFile);
		const templateFields = commitFieldsForThread(
			ownTemplate,
			this.getSettings().commitFields,
		);
		const editState = commitEditState(templateFields, entry);
		this.openCommitForm(
			threadFile,
			editState.fields,
			async (date, time, values) => {
				const replacement = buildCommitEntry({
					date,
					time,
					blockId: entry.blockId ?? '',
					fields: editState.fields,
					values,
				});
				await this.app.vault.process(sourceFile, (content) =>
					replaceCommitEntry(content, entry.blockId ?? '', replacement));
				const title = this.index.getThread(threadFile)?.title ?? threadFile.basename;
				new Notice(t('Updated the commit for {title}.', { title }));
			},
			{
				date: entry.values.commit_date || moment().format('YYYY-MM-DD'),
				time: entry.values.commit_time || moment().format('HH:mm'),
				values: editState.values,
				mode: 'edit',
			},
		);
	}

	openCommitDeleteModal(sourceFile: TFile, entry: ParsedCommitEntry): void {
		if (!entry.blockId) {
			new Notice(t('This commit has no block ID and cannot be deleted safely.'));
			return;
		}
		const threadFile = this.index.getThreadForMember(sourceFile);
		if (!threadFile) {
			new Notice(t('Cannot locate the thread meta from the thread ID.'));
			return;
		}
		new CommitDeleteModal(this.app, sourceFile, entry, async () => {
			await this.app.vault.process(sourceFile, (content) =>
				deleteCommitEntry(content, entry.blockId ?? ''));
			const title = this.index.getThread(threadFile)?.title ?? threadFile.basename;
			new Notice(t('Deleted the commit for {title}.', { title }));
		}).open();
	}
}
