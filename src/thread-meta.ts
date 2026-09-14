import {
	App,
	MarkdownView,
	Modal,
	Notice,
	Setting,
	TFile,
} from 'obsidian';
import type { CheckpointManager } from './checkpoint';
import type { ThreadFileManager } from './thread-files';
import type { ThreadIndex } from './thread-index';
import { replaceThreadDisplayAlias } from './thread-meta-model';
import type { ThreadParentManager } from './thread-parent';
import { t } from './i18n';
import {
	THREAD_STATUS_CHOICES,
	isThreadStatus,
	threadStatusOptionLabel,
	type ThreadStatus,
} from './thread-status-model';
import type { ThreadInfo, ThreadMemberInfo } from './types';

interface ThreadMetaFormData {
	title: string;
	status: ThreadStatus;
	parentId: string;
	entryPath: string;
}

interface ThreadMetaModalContext {
	thread: ThreadInfo;
	parent?: ThreadInfo;
	entry?: TFile;
	parentCandidates: ThreadInfo[];
	entryCandidates: ThreadMemberInfo[];
	memberCount: number;
	checkpointTemplate: string;
}

class ThreadMetaModal extends Modal {
	private title: string;
	private status: ThreadStatus;
	private parentId: string;
	private entryPath: string;
	private saving = false;

	constructor(
		app: App,
		private readonly context: ThreadMetaModalContext,
		private readonly onSave: (data: ThreadMetaFormData) => Promise<void>,
		private readonly onOpenMeta: () => void,
		private readonly onManageFiles: () => void,
		private readonly onEditCheckpointTemplate: () => void,
	) {
		super(app);
		this.title = context.thread.title;
		this.status = isThreadStatus(context.thread.status) ? context.thread.status : 'idea';
		this.parentId = context.parent?.id ?? '';
		this.entryPath = context.entry?.path ?? '';
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-thread-meta-modal');
		this.setTitle(t('Manage thread'));

		new Setting(this.contentEl)
			.setClass('thread-journal-thread-meta-identity')
			.setName(t('Thread ID'))
			.setDesc(this.context.thread.id);
		new Setting(this.contentEl)
			.setClass('thread-journal-thread-meta-identity')
			.setName(t('Meta file'))
			.setDesc(this.context.thread.file.path)
			.addButton((button) => button
				.setButtonText(t('Open'))
				.onClick(() => {
					this.close();
					this.onOpenMeta();
				}));

		new Setting(this.contentEl)
			.setName(t('Title'))
			.setDesc(t('Updates aliases[0] without renaming files.'))
			.addText((text) => text
				.setPlaceholder(t('Thread title'))
				.setValue(this.title)
				.onChange((value) => {
					this.title = value;
				}));

		new Setting(this.contentEl)
			.setName(t('Status'))
			.addDropdown((dropdown) => {
				for (const choice of THREAD_STATUS_CHOICES) {
					dropdown.addOption(choice.value, threadStatusOptionLabel(choice));
				}
				dropdown.setValue(this.status).onChange((value) => {
					if (isThreadStatus(value)) this.status = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('Parent'))
			.setDesc(t('Only active or dormant threads can become a new parent.'))
			.addDropdown((dropdown) => {
				dropdown.addOption('', t('None — root thread'));
				for (const candidate of this.context.parentCandidates) {
					dropdown.addOption(
						candidate.id,
						`${candidate.title} — ${candidate.status || t('unset')}`,
					);
				}
				dropdown.setValue(this.parentId).onChange((value) => {
					this.parentId = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('Entry'))
			.setDesc(t('The default file opened for this thread.'))
			.addDropdown((dropdown) => {
				dropdown.addOption('', t('None'));
				for (const candidate of this.context.entryCandidates) {
					dropdown.addOption(
						candidate.file.path,
						`${candidate.file.basename} — ${candidate.role}`,
					);
				}
				dropdown.setValue(this.entryPath).onChange((value) => {
					this.entryPath = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('Checkpoint template'))
			.setDesc(this.context.checkpointTemplate)
			.addButton((button) => button
				.setButtonText(t('Edit'))
				.onClick(() => {
					this.close();
					this.onEditCheckpointTemplate();
				}));

		new Setting(this.contentEl)
			.setName(t('Thread files'))
			.setDesc(t('{members} member files · {active} active', {
				members: this.context.memberCount,
				active: this.context.entryCandidates.length,
			}))
			.addButton((button) => button
				.setButtonText(t('Manage'))
				.onClick(() => {
					this.close();
					this.onManageFiles();
				}));

		new Setting(this.contentEl)
			.setClass('thread-journal-thread-meta-actions')
			.addButton((button) => button
				.setButtonText(t('Cancel'))
				.onClick(() => this.close()))
			.addButton((button) => button
				.setButtonText(t('Save changes'))
				.setCta()
				.onClick(async () => {
					if (this.saving) return;
					this.saving = true;
					button.setDisabled(true);
					try {
						await this.onSave({
							title: this.title,
							status: this.status,
							parentId: this.parentId,
							entryPath: this.entryPath,
						});
						this.close();
					} catch (error) {
						console.error('Thread Journal failed to update thread metadata', error);
						new Notice(t('Failed to update thread meta: {error}', { error: String(error) }));
						this.saving = false;
						button.setDisabled(false);
					}
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ThreadMetaManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly parents: ThreadParentManager,
		private readonly files: ThreadFileManager,
		private readonly checkpoints: CheckpointManager,
	) {}

	getCurrentThreadFile(): TFile | undefined {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		return file ? this.index.getThreadFile(file) : undefined;
	}

	openCurrentMetaModal(): void {
		const threadFile = this.getCurrentThreadFile();
		if (!threadFile) {
			new Notice(t('The current file does not belong to a thread.'));
			return;
		}
		this.openMetaModal(threadFile);
	}

	openMetaModal(file: TFile): void {
		const threadFile = this.index.getThreadFile(file);
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		if (!threadFile || !thread) {
			new Notice(t('The current file does not belong to a valid thread.'));
			return;
		}
		const parentFile = this.index.getParentFile(threadFile);
		const frontmatter: unknown = this.app.metadataCache.getFileCache(threadFile)?.frontmatter;
		const ownFields = typeof frontmatter === 'object' && frontmatter !== null
			? (frontmatter as Record<string, unknown>).checkpoint_fields
			: undefined;
		const members = this.index.getMembersByThreadId(thread.id);
		const activeMembers = members
			.filter((member) => member.roleStatus === 'active')
			.sort((left, right) => left.file.basename.localeCompare(right.file.basename));
		const context: ThreadMetaModalContext = {
			thread,
			parent: parentFile ? this.index.getThread(parentFile) : undefined,
			entry: this.index.getEntry(threadFile),
			parentCandidates: this.parents.getCandidates(threadFile),
			entryCandidates: activeMembers,
			memberCount: members.length,
			checkpointTemplate: Array.isArray(ownFields)
				? t('Independent template · {count} fields', { count: ownFields.length })
				: t('Uses the global default template'),
		};
		new ThreadMetaModal(
			this.app,
			context,
			(data) => this.save(threadFile, data),
			() => void this.files.openFile(threadFile),
			() => this.files.openThreadFilesModal(threadFile),
			() => this.checkpoints.openCheckpointTemplateModal(threadFile),
		).open();
	}

	private async save(threadFile: TFile, data: ThreadMetaFormData): Promise<void> {
		const thread = this.index.getThread(threadFile);
		if (!thread) throw new Error(t('Thread meta no longer exists.'));
		const title = data.title.trim();
		if (!title) throw new Error(t('Title cannot be empty.'));

		const parent = data.parentId ? this.index.getThreadById(data.parentId)?.file : undefined;
		if (data.parentId && !parent) throw new Error(t('The selected parent no longer exists.'));
		this.parents.validateParent(threadFile, parent);

		const entry = data.entryPath
			? this.app.vault.getAbstractFileByPath(data.entryPath)
			: undefined;
		if (data.entryPath && !(entry instanceof TFile)) {
			throw new Error(t('The selected entry no longer exists.'));
		}
		if (entry instanceof TFile) {
			const member = this.index.getMember(entry);
			if (member?.threadId !== thread.id || member.roleStatus !== 'active') {
				throw new Error(t('Entry must be an active member of this thread.'));
			}
		}

		const parentLink = parent
			? this.app.fileManager.generateMarkdownLink(
				parent,
				threadFile.path,
				undefined,
				this.index.getDisplayName(parent),
			)
			: undefined;
		const entryLink = entry instanceof TFile
			? this.app.fileManager.generateMarkdownLink(
				entry,
				threadFile.path,
				undefined,
				entry.basename,
			)
			: undefined;
		await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
			const metadata = frontmatter as Record<string, unknown>;
			metadata.aliases = replaceThreadDisplayAlias(metadata.aliases, title);
			metadata.status = data.status;
			if (parentLink) metadata.parent = parentLink;
			else delete metadata.parent;
			if (entryLink) metadata.entry = entryLink;
			else delete metadata.entry;
		});
		new Notice(t('Updated thread meta for {title}.', { title }));
	}
}
