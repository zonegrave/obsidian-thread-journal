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
	threadStatusLabel,
	threadStatusOptionLabel,
	type ThreadStatus,
} from './thread-status-model';
import type { ThreadIndex } from './thread-index';
import type { ThreadFileManager, ThreadRoleTemplate } from './thread-files';
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
			template: ThreadRoleTemplate,
		) => Promise<void>,
	) {
		super(app);
		this.templatePath = templates[0]?.file.path ?? '';
	}

	private templatePath: string;

	onOpen(): void {
		this.setTitle('新建 thread');
		new Setting(this.contentEl)
			.setName('标题')
			.addText((text) => {
				text.setPlaceholder('输入 thread 标题').onChange((value) => {
					this.title = value;
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(this.contentEl)
			.setName('父 thread')
			.setDesc(this.parent?.path ?? '无父 thread（根节点）');

		new Setting(this.contentEl)
			.setName('初始状态')
			.setDesc('状态值使用英文，后附中文含义；默认 idea 不要求填写目标或 todo。')
			.addDropdown((dropdown) => {
				for (const choice of THREAD_STATUS_CHOICES) {
					dropdown.addOption(choice.value, threadStatusOptionLabel(choice));
				}
				dropdown.setValue(this.status).onChange((value) => {
					if (isThreadStatus(value)) this.status = value;
				});
			});

		new Setting(this.contentEl)
			.setName('入口模板')
			.setDesc('模板中的 thread_role 决定入口文件角色。')
			.addDropdown((dropdown) => {
				for (const template of this.templates) {
					dropdown.addOption(template.file.path, `${template.label} · ${template.role}`);
				}
				dropdown.setValue(this.templatePath).onChange((value) => {
					this.templatePath = value;
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('创建')
				.setCta()
				.onClick(async () => {
					if (this.creating) return;
					const title = this.title.trim();
					if (!title) {
						new Notice('请先输入 thread 标题。');
						return;
					}
					const template = this.templates.find((item) => item.file.path === this.templatePath);
					if (!template) {
						new Notice('请选择有效的入口模板。');
						return;
					}
					this.creating = true;
					button.setDisabled(true);
					try {
						await this.onSubmit(title, this.status, template);
						this.close();
					} catch (error) {
						console.error('Thread Journal failed to create thread', error);
						new Notice(`创建 thread 失败：${String(error)}`);
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
		this.setPlaceholder('搜索并选择父 thread');
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
					detail: `${depth === 0 ? '当前 thread' : '祖先 thread'} · ${thread.status} — ${threadStatusLabel(thread.status)} · ${cursor.path}`,
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
			{ title: '无父 thread', detail: '创建根节点' },
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
			new Notice(`无法读取入口模板：${String(error)}`);
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
				new Notice('只有 active 或 dormant thread 可以创建子 thread。');
				throw new Error(`Thread cannot create children in its current status: ${parent.path}`);
			}
		}
		const settings = this.getSettings();
		const folder = settings.threadMetaFolder;
		await ensureFolder(this.app, folder);
		const threadId = stableThreadId();
		const path = normalizePath(`${folder}/${threadId}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Thread meta 已存在：${path}`);
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
		const selectedTemplate = template ?? (await this.files.getRoleTemplates())[0];
		if (!selectedTemplate) throw new Error('没有可用的 thread 文件模板。');
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
		new Notice(`已创建 ${title}`);
		return file;
	}
}
