import {
	App,
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TFile,
	moment,
	normalizePath,
	type FuzzyMatch,
} from 'obsidian';
import {
	THREAD_STATUS_CHOICES,
	isOperationalThreadStatus,
	isThreadStatus,
	threadStatusUsesMembers,
	threadStatusLabel,
	threadStatusOptionLabel,
	type ThreadStatus,
} from './thread-status-model';
import type { ThreadIndex } from './thread-index';
import type { ThreadFileManager, ThreadRoleTemplate } from './thread-files';
import { t } from './i18n';
import type { ThreadJournalSettings } from './types';

function stableThreadId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalized = normalizePath(folder);
	if (!normalized) return;
	let cursor = '';
	for (const segment of normalized.split('/')) {
		cursor = cursor ? `${cursor}/${segment}` : segment;
		if (!app.vault.getAbstractFileByPath(cursor)) {
			await app.vault.createFolder(cursor);
		}
	}
}

function stringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
	return typeof value === 'string' && value ? [value] : [];
}

class NewThreadModal extends Modal {
	private title = '';
	private status: ThreadStatus = 'idea';
	private creating = false;

	constructor(
		app: App,
		private readonly parent: TFile | undefined,
		private readonly templates: ThreadRoleTemplate[],
		private readonly onSubmit: (
			title: string,
			status: ThreadStatus,
			template?: ThreadRoleTemplate,
		) => Promise<void>,
	) {
		super(app);
		this.templatePath = templates[0]?.file.path ?? '';
	}

	private templatePath: string;

	onOpen(): void {
		this.setTitle(t('New thread'));
		let entrySetting: Setting | undefined;
		const needsEntry = (): boolean => threadStatusUsesMembers(this.status);
		const updateEntryVisibility = (): void => {
			entrySetting?.settingEl.toggleClass('is-hidden', !needsEntry());
		};
		new Setting(this.contentEl)
			.setName(t('Title'))
			.addText((text) => {
				text.setPlaceholder(t('Enter a thread title')).onChange((value) => {
					this.title = value;
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(this.contentEl)
			.setName(t('Parent thread'))
			.setDesc(this.parent?.path ?? t('No parent thread (root)'));

		new Setting(this.contentEl)
			.setName(t('Initial status'))
			.setDesc(t('Status values remain in English; the localized meaning follows. idea does not require a goal or todo.'))
			.addDropdown((dropdown) => {
				for (const choice of THREAD_STATUS_CHOICES) {
					dropdown.addOption(choice.value, threadStatusOptionLabel(choice));
				}
				dropdown.setValue(this.status).onChange((value) => {
					if (isThreadStatus(value)) {
						this.status = value;
						updateEntryVisibility();
					}
				});
			});

		entrySetting = new Setting(this.contentEl)
			.setName(t('Entry template'))
			.setDesc(t('The template thread_role determines the role of the entry file.'))
			.addDropdown((dropdown) => {
				for (const template of this.templates) {
					dropdown.addOption(template.file.path, `${template.label} · ${template.role}`);
				}
				dropdown.setValue(this.templatePath).onChange((value) => {
					this.templatePath = value;
				});
			});
		updateEntryVisibility();

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText(t('Create'))
				.setCta()
				.onClick(async () => {
					if (this.creating) return;
					const title = this.title.trim();
					if (!title) {
						new Notice(t('Enter a thread title first.'));
						return;
					}
					const template = this.templates.find((item) => item.file.path === this.templatePath);
					if (needsEntry() && !template) {
						new Notice(t('Select a valid entry template.'));
						return;
					}
					this.creating = true;
					button.setDisabled(true);
					try {
						await this.onSubmit(
							title,
							this.status,
							needsEntry() ? template : undefined,
						);
						this.close();
					} catch (error) {
						console.error('Thread Journal failed to create thread', error);
						new Notice(t('Failed to create thread: {error}', { error: String(error) }));
						this.creating = false;
						button.setDisabled(false);
					}
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

interface ParentChoice {
	file?: TFile;
	title: string;
	detail: string;
}

class ParentThreadModal extends FuzzySuggestModal<ParentChoice> {
	constructor(
		app: App,
		private readonly choices: ParentChoice[],
		private readonly onChoose: (parent?: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t('Search and select a parent thread'));
	}

	getItems(): ParentChoice[] {
		return this.choices;
	}

	getItemText(item: ParentChoice): string {
		return `${item.title} ${item.detail}`;
	}

	renderSuggestion(match: FuzzyMatch<ParentChoice>, el: HTMLElement): void {
		el.createDiv({ text: match.item.title });
		el.createDiv({ cls: 'suggestion-note', text: match.item.detail });
	}

	onChooseItem(item: ParentChoice): void {
		this.onChoose(item.file);
	}
}

export class ThreadCreator {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly files: ThreadFileManager,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	openNewThreadModal(): void {
		const activeFile = this.app.workspace.getActiveFile();
		const activeThread = activeFile
			? this.index.getThreadFile(activeFile)
			: undefined;
		const choices = this.parentChoices(activeThread);
		new ParentThreadModal(this.app, choices, (parent) => {
			this.openDetailsModal(parent);
		}).open();
	}

	private parentChoices(activeThread?: TFile): ParentChoice[] {
		const preferred: ParentChoice[] = [];
		const seen = new Set<string>();
		let cursor = activeThread;
		let depth = 0;
		while (cursor && !seen.has(cursor.path)) {
			const thread = this.index.getThread(cursor);
			if (!thread) break;
			seen.add(cursor.path);
			if (isOperationalThreadStatus(thread.status)) {
				preferred.push({
					file: cursor,
					title: thread.title,
					detail: `${depth === 0 ? t('Current thread') : t('Ancestor thread')} · ${thread.status} — ${threadStatusLabel(thread.status)} · ${cursor.path}`,
				});
			}
			cursor = this.index.getParentFile(cursor);
			depth += 1;
		}

		const others = this.index.getAllThreads()
			.filter((thread) => isOperationalThreadStatus(thread.status) && !seen.has(thread.file.path))
			.map((thread) => ({
				file: thread.file,
				title: thread.title,
				detail: `${thread.status} — ${threadStatusLabel(thread.status)} · ${thread.file.path}`,
			}))
			.sort((left, right) => left.title.localeCompare(right.title));
		return [
			...preferred,
			{ title: t('No parent thread'), detail: t('Create a root thread') },
			...others,
		];
	}

	private openDetailsModal(parent?: TFile): void {
		void this.files.getRoleTemplates().then((templates) => {
			new NewThreadModal(this.app, parent, templates, async (title, status, template) => {
				await this.createThread(title, status, parent, template);
			}).open();
		}).catch((error: unknown) => {
			console.error('Thread Journal failed to load entry templates', error);
			new Notice(t('Failed to read entry templates: {error}', { error: String(error) }));
		});
	}

	async createThread(
		title: string,
		status: ThreadStatus,
		parent?: TFile,
		template?: ThreadRoleTemplate,
	): Promise<TFile> {
		if (parent) {
			const parentThread = this.index.getThread(parent);
			if (!parentThread || !isOperationalThreadStatus(parentThread.status)) {
				new Notice(t('Only active or dormant threads can create child threads.'));
				throw new Error(t('The thread cannot create children in its current status: {path}', {
					path: parent.path,
				}));
			}
		}
		const settings = this.getSettings();
		const folder = settings.threadMetaFolder;
		await ensureFolder(this.app, folder);
		const threadId = stableThreadId();
		const path = normalizePath(`${folder}/${threadId}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			throw new Error(t('Thread meta already exists: {path}', { path }));
		}
		const parentLink = parent
			? this.app.fileManager.generateMarkdownLink(
				parent,
				path,
				undefined,
				this.index.getDisplayName(parent),
			)
			: undefined;
		const created = moment().format('YYYY-MM-DD');
		const file = await this.app.vault.create(path, '');
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const metadata = frontmatter as Record<string, unknown>;
			metadata.type = 'thread';
			metadata.thread_id = threadId;
			delete metadata.title;
			metadata.aliases = [...new Set([title, ...stringList(metadata.aliases)])];
			metadata.tags = [...new Set(['线程', ...stringList(metadata.tags)])];
			metadata.status = status;
			metadata.created = created;
			if (parentLink) metadata.parent = parentLink;
			else delete metadata.parent;
		});
		if (!threadStatusUsesMembers(status)) {
			await this.files.openFile(file);
			new Notice(t('Created {title}', { title }));
			return file;
		}
		const selectedTemplate = template ?? (await this.files.getRoleTemplates())[0];
		if (!selectedTemplate) throw new Error(t('No thread file template is available.'));
		const entry = await this.files.createThreadFile(
			file,
			selectedTemplate,
			title,
			created,
			{
				id: threadId,
				title,
				status,
				parentLink,
				parentTitle: parent ? this.index.getDisplayName(parent) : undefined,
			},
		);
		await this.files.setEntry(file, entry, false, threadId);
		await this.files.openFile(entry);
		new Notice(t('Created {title}', { title }));
		return file;
	}
}
