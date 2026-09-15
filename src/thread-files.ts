import {
	App,
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TFile,
	moment,
	normalizePath,
	parseYaml,
	type Editor,
	type FuzzyMatch,
	type WorkspaceLeaf,
} from 'obsidian';
import { buildThreadFileName } from './core';
import { buildInlineLogEdit } from './inline-log';
import { t } from './i18n';
import type { ThreadIndex } from './thread-index';
import {
	DEFAULT_THREAD_ROLE_TEMPLATE,
	renderThreadFileTemplate,
} from './thread-template';
import { nextActiveThreadRolePath } from './thread-switcher-model';
import { threadStatusUsesMembers } from './thread-status-model';
import type {
	ThreadJournalSettings,
	ThreadMemberInfo,
	ThreadRoleStatus,
} from './types';
import { leafFilePath } from './workspace-leaf';

export interface ThreadRoleTemplate {
	file: TFile;
	role: string;
	label: string;
}

export interface ThreadFileCreationContext {
	id: string;
	title: string;
	status: string;
	parentLink?: string;
	parentTitle?: string;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalized = normalizePath(folder);
	if (!normalized) return;
	let cursor = '';
	for (const segment of normalized.split('/')) {
		cursor = cursor ? `${cursor}/${segment}` : segment;
		if (!app.vault.getAbstractFileByPath(cursor)) await app.vault.createFolder(cursor);
	}
}

function scalarText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function templateRole(source: string): string {
	const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(source);
	if (!match?.[1]) return 'workspace';
	try {
		const parsed: unknown = parseYaml(match[1]);
		if (typeof parsed !== 'object' || parsed === null) return 'workspace';
		return scalarText((parsed as Record<string, unknown>).thread_role) || 'workspace';
	} catch {
		return 'workspace';
	}
}

class ThreadRoleTemplateModal extends FuzzySuggestModal<ThreadRoleTemplate> {
	constructor(
		app: App,
		private readonly templates: ThreadRoleTemplate[],
		private readonly onChoose: (template: ThreadRoleTemplate) => void,
	) {
		super(app);
		this.setPlaceholder(t('Select a thread file template'));
	}

	getItems(): ThreadRoleTemplate[] {
		return this.templates;
	}

	getItemText(item: ThreadRoleTemplate): string {
		return `${item.label} ${item.role} ${item.file.path}`;
	}

	renderSuggestion(match: FuzzyMatch<ThreadRoleTemplate>, el: HTMLElement): void {
		el.createDiv({ text: match.item.label });
		el.createDiv({ cls: 'suggestion-note', text: `${match.item.role} · ${match.item.file.path}` });
	}

	onChooseItem(item: ThreadRoleTemplate): void {
		this.onChoose(item);
	}
}

class NewThreadFileModal extends Modal {
	private title: string;
	private saving = false;

	constructor(
		app: App,
		threadTitle: string,
		private readonly template: ThreadRoleTemplate,
		private readonly onSubmit: (title: string) => Promise<void>,
	) {
		super(app);
		this.title = `${threadTitle} · ${template.label}`;
	}

	onOpen(): void {
		this.setTitle(t('New thread file'));
		new Setting(this.contentEl)
			.setName(t('Template'))
			.setDesc(`${this.template.label} · ${this.template.role}`);
		new Setting(this.contentEl)
			.setName(t('File name'))
			.addText((text) => {
				text.setValue(this.title).onChange((value) => {
					this.title = value;
				});
				window.setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.select();
				}, 0);
			});
		new Setting(this.contentEl).addButton((button) => button
			.setButtonText(t('Create'))
			.setCta()
			.onClick(async () => {
				if (this.saving) return;
				const title = this.title.trim();
				if (!title) {
					new Notice(t('Enter a file name.'));
					return;
				}
				this.saving = true;
				button.setDisabled(true);
				try {
					await this.onSubmit(title);
					this.close();
				} catch (error) {
					console.error('Thread Journal failed to create thread member', error);
					new Notice(t('Failed to create thread file: {error}', { error: String(error) }));
					this.saving = false;
					button.setDisabled(false);
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

interface ThreadMemberCandidate {
	member: ThreadMemberInfo;
	entry: boolean;
}

class ThreadFilesModal extends FuzzySuggestModal<ThreadMemberCandidate> {
	constructor(
		app: App,
		title: string,
		private readonly candidates: ThreadMemberCandidate[],
		private readonly onOpenFile: (file: TFile) => void,
		private readonly onSetEntry: (file: TFile) => void,
		private readonly onSetStatus: (file: TFile, status: ThreadRoleStatus) => void,
	) {
		super(app);
		this.setPlaceholder(t('Manage files for {title}', { title }));
	}

	getItems(): ThreadMemberCandidate[] {
		return this.candidates;
	}

	getItemText(item: ThreadMemberCandidate): string {
		return [
			item.member.file.basename,
			item.member.role,
			item.member.roleStatus,
			item.entry ? t('Entry') : '',
		].join(' ');
	}

	renderSuggestion(match: FuzzyMatch<ThreadMemberCandidate>, el: HTMLElement): void {
		const candidate = match.item;
		el.addClass('thread-journal-thread-file-suggestion');
		const copy = el.createDiv({ cls: 'thread-journal-thread-file-copy' });
		copy.createDiv({ text: `${candidate.member.file.basename}${candidate.entry ? ` · ${t('Entry')}` : ''}` });
		copy.createDiv({
			cls: 'suggestion-note',
			text: `${candidate.member.role} · ${candidate.member.roleStatus}`,
		});
		if (!candidate.entry && candidate.member.roleStatus === 'active') {
			const entry = el.createEl('button', {
				cls: 'thread-journal-thread-file-entry',
				text: t('Set as entry'),
				attr: { type: 'button', tabindex: '-1' },
			});
			entry.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			entry.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.close();
				this.onSetEntry(candidate.member.file);
			});
		}
		if (!candidate.entry) {
			const nextStatus: ThreadRoleStatus = candidate.member.roleStatus === 'active'
				? 'terminated'
				: 'active';
			const status = el.createEl('button', {
				cls: 'thread-journal-thread-file-status',
				text: nextStatus === 'active' ? t('Reactivate') : t('Terminate'),
				attr: { type: 'button', tabindex: '-1' },
			});
			status.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			status.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.close();
				this.onSetStatus(candidate.member.file, nextStatus);
			});
		}
	}

	onChooseItem(item: ThreadMemberCandidate): void {
		this.onOpenFile(item.member.file);
	}
}

export class ThreadFileManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	async getRoleTemplates(): Promise<ThreadRoleTemplate[]> {
		const settings = this.getSettings();
		await this.ensureDefaultTemplate();
		const folderPrefix = `${normalizePath(settings.threadRoleTemplatesFolder)}/`;
		const files = this.app.vault.getMarkdownFiles().filter((file) =>
			file.path.startsWith(folderPrefix) || file.path === settings.defaultThreadRoleTemplatePath);
		const templates = await Promise.all(files.map(async (file) => {
			const role = templateRole(await this.app.vault.cachedRead(file));
			return { file, role, label: file.basename };
		}));
		return templates.sort((left, right) => {
			const leftDefault = left.file.path === settings.defaultThreadRoleTemplatePath ? 0 : 1;
			const rightDefault = right.file.path === settings.defaultThreadRoleTemplatePath ? 0 : 1;
			return leftDefault - rightDefault || left.label.localeCompare(right.label);
		});
	}

	async createThreadFile(
		threadFile: TFile,
		template: ThreadRoleTemplate,
		title: string,
		created = moment().format('YYYY-MM-DD'),
		creationContext?: ThreadFileCreationContext,
	): Promise<TFile> {
		const thread = creationContext ?? this.index.getThread(threadFile);
		if (!thread) throw new Error(t('Only a valid thread meta can create member files.'));
		const settings = this.getSettings();
		await ensureFolder(this.app, settings.threadFilesFolder);
		const path = this.uniqueFilePath(settings.threadFilesFolder, title, thread.id);
		const templateSource = await this.app.vault.cachedRead(template.file);
		const rendered = renderThreadFileTemplate(templateSource, {
			title,
			fileName: path.split('/').at(-1)?.replace(/\.md$/u, '') ?? title,
			threadId: thread.id,
			role: template.role,
			roleStatus: 'active',
			status: thread.status,
			parentLink: thread.parentLink,
			parentTitle: creationContext?.parentTitle ?? this.index.getParent(threadFile)?.label,
			created,
		}, (format) => moment(created, 'YYYY-MM-DD').format(format));
		const file = await this.app.vault.create(path, rendered);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const metadata = frontmatter as Record<string, unknown>;
			if (metadata.type === 'thread') delete metadata.type;
			metadata.thread_id = thread.id;
			metadata.thread_role = template.role;
			metadata.thread_role_status = 'active';
			metadata.created = scalarText(metadata.created) || created;
			delete metadata.status;
			delete metadata.parent;
			delete metadata.entry;
			delete metadata.checkpoint_fields;
		});
		return file;
	}

	async setEntry(
		threadFile: TFile,
		memberFile: TFile,
		notify = true,
		expectedThreadId?: string,
	): Promise<void> {
		const thread = this.index.getThread(threadFile);
		const threadId = expectedThreadId ?? thread?.id;
		const member = this.index.getMember(memberFile);
		const invalidMeta = thread && thread.id !== threadId;
		const invalidMember = expectedThreadId
			? member && member.threadId !== threadId
			: member?.threadId !== threadId;
		if (!threadId || invalidMeta || invalidMember) {
			throw new Error(t('The entry file must belong to the current thread.'));
		}
		if (member?.roleStatus === 'terminated') {
			throw new Error(t('A terminated thread role cannot be the entry.'));
		}
		const entryLink = this.app.fileManager.generateMarkdownLink(
			memberFile,
			threadFile.path,
			undefined,
			memberFile.basename,
		);
		await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
			(frontmatter as Record<string, unknown>).entry = entryLink;
		});
		if (notify) new Notice(t('Set {file} as the thread entry.', { file: memberFile.basename }));
	}

	async setRoleStatus(
		threadFile: TFile,
		memberFile: TFile,
		status: ThreadRoleStatus,
	): Promise<void> {
		const thread = this.index.getThread(threadFile);
		const member = this.index.getMember(memberFile);
		if (!thread || member?.threadId !== thread.id) {
			throw new Error(t('Only member files of the current thread can be changed.'));
		}
		if (status === 'terminated' && this.index.isEntry(memberFile)) {
			throw new Error(t('The entry file cannot be terminated. Set a new entry first.'));
		}
		await this.app.fileManager.processFrontMatter(memberFile, (frontmatter) => {
			(frontmatter as Record<string, unknown>).thread_role_status = status;
		});
		new Notice(t('Set {file} to {status}.', { file: memberFile.basename, status }));
	}

	async switchActiveThreadRole(file: TFile): Promise<void> {
		const threadFile = this.index.getThreadFile(file);
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		if (!thread || !threadFile) throw new Error(t('The current file does not belong to a thread.'));
		const entry = this.index.getEntry(threadFile);
		const members = this.index.getMembersByThreadId(thread.id)
			.filter((member) => member.roleStatus === 'active')
			.sort((left, right) => {
				const entryOrder = Number(right.file.path === entry?.path)
					- Number(left.file.path === entry?.path);
				return entryOrder || left.file.basename.localeCompare(right.file.basename);
			});
		const targetPath = nextActiveThreadRolePath(
			members.map((member) => ({
				path: member.file.path,
				status: member.roleStatus,
			})),
			file.path,
		);
		const target = members.find((member) => member.file.path === targetPath);
		if (!target) throw new Error(t('The current thread has no active member files.'));
		await this.openFile(target.file);
	}

	async openEntry(file: TFile): Promise<void> {
		const threadFile = this.index.getThreadFile(file);
		const entry = threadFile ? this.index.getEntry(threadFile) : undefined;
		if (!entry) throw new Error(t('The current thread has no valid entry file.'));
		await this.openFile(entry);
	}

	insertInlineLog(editor: Editor, memberFile: TFile): void {
		const member = this.index.getMember(memberFile);
		if (member?.roleStatus !== 'active' || !this.index.getThreadForMember(memberFile)) {
			throw new Error(t('Logs can only be inserted into an active thread role.'));
		}
		const cursor = editor.getCursor();
		const frontmatter = this.app.metadataCache.getFileCache(memberFile)?.frontmatterPosition;
		if (frontmatter && cursor.line <= frontmatter.end.line) {
			throw new Error(t('Move the cursor into the document body first.'));
		}
		const line = editor.getLine(cursor.line);
		const timestamp = moment();
		const blockId = `log-${timestamp.format('YYYYMMDD-HHmmss')}-${Math.random()
			.toString(36)
			.slice(2, 7)}`;
		const edit = buildInlineLogEdit(
			line,
			cursor.ch,
			timestamp.format('YYYY-MM-DDTHH:mm:ss'),
			blockId,
		);
		editor.replaceRange(
			edit.replacement,
			{ line: cursor.line, ch: edit.fromCh },
			{ line: cursor.line, ch: edit.toCh },
		);
		editor.setCursor({
			line: cursor.line + edit.cursorLineOffset,
			ch: edit.cursorCh,
		});
		editor.focus();
	}

	openNewThreadFileModal(file: TFile): void {
		const threadFile = this.index.getThreadFile(file);
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		if (!thread || !threadFile) {
			new Notice(t('The current file does not belong to a thread.'));
			return;
		}
		if (!threadStatusUsesMembers(thread.status)) {
			new Notice(t('Idea or committed threads keep only their meta. Change to an execution status first.'));
			return;
		}
		void this.getRoleTemplates().then((templates) => {
			new ThreadRoleTemplateModal(this.app, templates, (template) => {
				new NewThreadFileModal(this.app, thread.title, template, async (title) => {
					const hasEntry = Boolean(this.index.getEntry(threadFile));
					const member = await this.createThreadFile(threadFile, template, title);
					if (!hasEntry) await this.setEntry(threadFile, member, false, thread.id);
					await this.openFile(member);
					new Notice(t('Created {role} file: {file}', {
						role: template.role,
						file: member.basename,
					}));
				}).open();
			}).open();
		}).catch((error: unknown) => {
			console.error('Thread Journal failed to load role templates', error);
			new Notice(t('Failed to read thread file templates: {error}', { error: String(error) }));
		});
	}

	openThreadFilesModal(file: TFile): void {
		const threadFile = this.index.getThreadFile(file);
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		if (!thread || !threadFile) {
			new Notice(t('The current file does not belong to a thread.'));
			return;
		}
		const entry = this.index.getEntry(threadFile);
		const candidates = this.index.getMembersByThreadId(thread.id)
			.map((member) => ({
				member,
				entry: member.file.path === entry?.path,
			}))
			.sort((left, right) => {
				const entryOrder = Number(right.entry) - Number(left.entry);
				if (entryOrder) return entryOrder;
				const statusOrder = Number(left.member.roleStatus === 'terminated')
					- Number(right.member.roleStatus === 'terminated');
				return statusOrder || left.member.file.basename.localeCompare(right.member.file.basename);
			});
		if (candidates.length === 0) {
			new Notice(t('The current thread has no member files.'));
			return;
		}
		new ThreadFilesModal(
			this.app,
			thread.title,
			candidates,
			(member) => void this.openFile(member),
			(member) => void this.setEntry(threadFile, member).catch((error: unknown) => {
				console.error('Thread Journal failed to set entry', error);
				new Notice(t('Failed to set thread entry: {error}', { error: String(error) }));
			}),
			(member, status) => void this.setRoleStatus(threadFile, member, status)
				.catch((error: unknown) => {
					console.error('Thread Journal failed to update role status', error);
					new Notice(t('Failed to set thread role status: {error}', { error: String(error) }));
				}),
		).open();
	}

	private async ensureDefaultTemplate(): Promise<TFile> {
		const path = this.getSettings().defaultThreadRoleTemplatePath;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) throw new Error(t('The default role template path is not a file: {path}', { path }));
		const separator = path.lastIndexOf('/');
		if (separator > 0) await ensureFolder(this.app, path.slice(0, separator));
		const file = await this.app.vault.create(path, DEFAULT_THREAD_ROLE_TEMPLATE);
		new Notice(t('Created the default thread file template: {path}', { path }));
		return file;
	}

	private uniqueFilePath(folder: string, title: string, threadId: string): string {
		const baseName = buildThreadFileName(title);
		if (!baseName) throw new Error(t('The file name is invalid.'));
		const prefix = normalizePath(folder);
		const at = (name: string): string => normalizePath(prefix ? `${prefix}/${name}.md` : `${name}.md`);
		let path = at(baseName);
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const collisionBase = buildThreadFileName(title, threadId);
		path = at(collisionBase);
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = at(`${collisionBase}-${counter}`);
			counter += 1;
		}
		return path;
	}

	async openFile(file: TFile): Promise<void> {
		const existing = this.findLeafForFile(file);
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			this.app.workspace.setActiveLeaf(existing, { focus: true });
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file, { active: true });
		await this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	private findLeafForFile(file: TFile): WorkspaceLeaf | undefined {
		let result: WorkspaceLeaf | undefined;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!result && leafFilePath(leaf) === file.path) result = leaf;
		});
		return result;
	}
}
