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
import type { ThreadIndex, ThreadParentCandidate } from './thread-index';
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

function threadBody(title: string, kind: ThreadKind, parentLink?: string): string {
	const frontmatter = [
		'---',
		'type: thread',
		`thread_id: ${stableThreadId()}`,
		`title: ${JSON.stringify(title)}`,
		`aliases: [${JSON.stringify(title)}]`,
		'tags: [线程]',
		`kind: ${kind}`,
		'status: active',
		...(parentLink ? [`parent: ${JSON.stringify(parentLink)}`] : []),
		`created: ${moment().format('YYYY-MM-DD')}`,
		'---',
		'',
		'```thread-breadcrumb',
		'```',
		'',
		`# ${title}`,
		'',
		kind === 'area' ? '## 责任范围' : '## 期望结果',
		'',
		kind === 'area' ? '## 维持标准' : '## 完成条件',
		'',
		'- ',
		'',
		'## 子线程',
		'',
		'```thread-children',
		'```',
		'',
		'## 记录',
		'',
		'```thread-records',
		'scope: descendants',
		'days: 30',
		'```',
		'',
	];
	return frontmatter.join('\n');
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
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	openNewThreadModal(): void {
		const choices: ParentChoice[] = [
			{ title: '无父 thread', detail: '创建根节点' },
			...this.index.getParentCandidates().map((candidate: ThreadParentCandidate) => ({
				file: candidate.file,
				title: candidate.title,
				detail: `${candidate.kind} · ${candidate.file.path}`,
			})),
		];
		new ParentThreadModal(this.app, choices, (parent) => {
			this.openDetailsModal(parent);
		}).open();
	}

	openNewChildModal(parent: TFile): void {
		this.openDetailsModal(parent);
	}

	openNewSiblingModal(current: TFile): void {
		const parent = this.index.getParentFile(current);
		this.openDetailsModal(parent);
	}

	private openDetailsModal(parent?: TFile): void {
		new NewThreadModal(this.app, parent, async (title, kind) => {
			await this.createThread(title, kind, parent);
		}).open();
	}

	async createThread(title: string, kind: ThreadKind, parent?: TFile): Promise<TFile> {
		const folder = this.getSettings().threadsFolder;
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
		const file = await this.app.vault.create(path, threadBody(title, kind, parentLink));
		await this.app.workspace.getLeaf(false).openFile(file);
		new Notice(`已创建 ${title}`);
		return file;
	}
}
