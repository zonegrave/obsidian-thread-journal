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
import { buildThreadFileName } from './core';
import {
	DEFAULT_THREAD_TEMPLATE,
	renderThreadTemplate,
} from './thread-template';
import type { ThreadIndex, ThreadParentCandidate } from './thread-index';
import type { ThreadWorkspaceManager } from './thread-workspace';
import type { ThreadJournalSettings, ThreadKind } from './types';

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
	private kind: ThreadKind = 'normal';

	constructor(
		app: App,
		private readonly parent: TFile | undefined,
		private readonly onSubmit: (title: string, kind: ThreadKind) => Promise<void>,
	) {
		super(app);
	}

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
			.setName('Thread 形态')
			.setDesc('Normal 为默认；area 持续维护；project 表示阶段性结果。')
			.addDropdown((dropdown) => dropdown
				.addOption('normal', 'Normal')
				.addOption('area', 'Area')
				.addOption('project', 'Project')
				.setValue(this.kind)
				.onChange((value) => {
					this.kind = value === 'area' || value === 'project'
						? value
						: 'normal';
				}));

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('创建')
				.setCta()
				.onClick(async () => {
					const title = this.title.trim();
					if (!title) {
						new Notice('请先输入 thread 标题。');
						return;
					}
					try {
						await this.onSubmit(title, this.kind);
						this.close();
					} catch (error) {
						console.error('Thread Journal failed to create thread', error);
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
		private readonly workspaces: ThreadWorkspaceManager,
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
			preferred.push({
				file: cursor,
				title: thread.title,
				detail: `${depth === 0 ? '当前 thread' : '祖先 thread'} · ${thread.kind} · ${cursor.path}`,
			});
			cursor = this.index.getParentFile(cursor);
			depth += 1;
		}

		const others = this.index.getParentCandidates()
			.filter((candidate) => !seen.has(candidate.file.path))
			.map((candidate: ThreadParentCandidate) => ({
				file: candidate.file,
				title: candidate.title,
				detail: `${candidate.kind} · ${candidate.file.path}`,
			}));
		return [
			...preferred,
			{ title: '无父 thread', detail: '创建根节点' },
			...others,
		];
	}

	private openDetailsModal(parent?: TFile): void {
		new NewThreadModal(this.app, parent, async (title, kind) => {
			await this.createThread(title, kind, parent);
		}).open();
	}

	async createThread(title: string, kind: ThreadKind, parent?: TFile): Promise<TFile> {
		const settings = this.getSettings();
		const folder = settings.threadsFolder;
		await ensureFolder(this.app, folder);
		const fileName = buildThreadFileName(title, moment().format('YYMMDD'));
		if (!fileName) throw new Error('Thread title does not produce a valid file name.');
		const path = normalizePath(`${folder}/${fileName}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`已存在同名文件：${path}`);
			throw new Error(`File already exists: ${path}`);
		}
		const parentLink = parent
			? this.app.fileManager.generateMarkdownLink(
				parent,
				path,
				undefined,
				this.index.getDisplayName(parent),
			)
			: undefined;
		const templateFile = await this.getOrCreateTemplateFile();
		const template = await this.app.vault.cachedRead(templateFile);
		const threadId = stableThreadId();
		const created = moment().format('YYYY-MM-DD');
		const body = renderThreadTemplate(template, {
			title,
			fileName,
			threadId,
			kind,
			parentLink,
			parentTitle: parent ? this.index.getDisplayName(parent) : undefined,
			created,
		}, (format) => moment(created, 'YYYY-MM-DD').format(format));
		const file = await this.app.vault.create(path, body);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const metadata = frontmatter as Record<string, unknown>;
			metadata.type = 'thread';
			metadata.thread_id = threadId;
			metadata.title = title;
			metadata.aliases = [...new Set([title, ...stringList(metadata.aliases)])];
			metadata.tags = [...new Set(['线程', ...stringList(metadata.tags)])];
			metadata.kind = kind;
			metadata.status = 'active';
			metadata.created = created;
			if (parentLink) metadata.parent = parentLink;
			else delete metadata.parent;
		});
		await this.workspaces.ensureForThread(file, {
			id: threadId,
			title,
			created,
		});
		await this.app.workspace.getLeaf(false).openFile(file);
		new Notice(`已创建 ${title}`);
		return file;
	}

	private async getOrCreateTemplateFile(): Promise<TFile> {
		const path = this.getSettings().threadTemplatePath;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) throw new Error(`Thread template path is not a file: ${path}`);
		const separator = path.lastIndexOf('/');
		if (separator > 0) await ensureFolder(this.app, path.slice(0, separator));
		const file = await this.app.vault.create(path, DEFAULT_THREAD_TEMPLATE);
		new Notice(`已创建 Thread 模板：${path}`);
		return file;
	}
}
