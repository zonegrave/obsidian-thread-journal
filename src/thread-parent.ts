import {
	App,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	TFile,
	type FuzzyMatch,
} from 'obsidian';
import type { ThreadIndex } from './thread-index';
import {
	availableThreadParentIds,
	type ThreadParentNode,
} from './thread-parent-model';
import { isOperationalThreadStatus, threadStatusLabel } from './thread-status-model';

interface ThreadParentChoice {
	file?: TFile;
	title: string;
	detail: string;
	current: boolean;
}

class ThreadParentModal extends FuzzySuggestModal<ThreadParentChoice> {
	constructor(
		app: App,
		private readonly choices: ThreadParentChoice[],
		private readonly onChoose: (parent?: TFile) => Promise<void>,
	) {
		super(app);
		this.setPlaceholder('选择新的父 thread');
	}

	getItems(): ThreadParentChoice[] {
		return this.choices;
	}

	getItemText(item: ThreadParentChoice): string {
		return `${item.title} ${item.detail}`;
	}

	renderSuggestion(match: FuzzyMatch<ThreadParentChoice>, el: HTMLElement): void {
		el.createDiv({ text: `${match.item.title}${match.item.current ? ' · 当前' : ''}` });
		el.createDiv({ cls: 'suggestion-note', text: match.item.detail });
	}

	onChooseItem(item: ThreadParentChoice): void {
		void this.onChoose(item.file);
	}
}

export class ThreadParentManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
	) {}

	getCurrentThreadFile(): TFile | undefined {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		return file ? this.index.getThreadFile(file) : undefined;
	}

	openCurrentParentModal(): void {
		const threadFile = this.getCurrentThreadFile();
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		if (!threadFile || !thread) {
			new Notice('当前文件不属于 thread。');
			return;
		}
		const currentParent = this.index.getParentFile(threadFile);
		const allThreads = this.index.getAllThreads();
		const nodes: ThreadParentNode[] = allThreads.map((item) => {
			const parent = this.index.getParentFile(item.file);
			return {
				id: item.id,
				status: item.status,
				parent: parent ? this.index.getThread(parent)?.id : undefined,
			};
		});
		const allowed = new Set(availableThreadParentIds(nodes, thread.id));
		const choices: ThreadParentChoice[] = [
			{
				title: '无父 thread',
				detail: '设为根节点',
				current: !currentParent,
			},
			...allThreads
				.filter((item) => allowed.has(item.id) || item.file.path === currentParent?.path)
				.sort((left, right) => left.title.localeCompare(right.title))
				.map((item) => ({
					file: item.file,
					title: item.title,
					detail: `${item.status} — ${threadStatusLabel(item.status)} · ${item.file.path}`,
					current: item.file.path === currentParent?.path,
				})),
		];
		new ThreadParentModal(this.app, choices, async (parent) => {
			try {
				await this.setParent(threadFile, parent);
			} catch (error) {
				console.error('Thread Journal failed to update thread parent', error);
				new Notice(`调整 thread parent 失败：${String(error)}`);
			}
		}).open();
	}

	async setParent(threadFile: TFile, parent?: TFile): Promise<void> {
		const thread = this.index.getThread(threadFile);
		if (!thread) throw new Error('只能调整有效 thread meta 的父节点。');
		const currentParent = this.index.getParentFile(threadFile);
		if (currentParent?.path === parent?.path || (!currentParent && !parent)) {
			new Notice('Thread parent 没有变化。');
			return;
		}
		if (parent) {
			const parentThread = this.index.getThread(parent);
			if (!parentThread || !isOperationalThreadStatus(parentThread.status)) {
				throw new Error('父 thread 必须是 active 或 dormant。');
			}
			const descendants = this.descendantPaths(threadFile);
			if (parent.path === threadFile.path || descendants.has(parent.path)) {
				throw new Error('不能把当前 thread 或其后代设为父节点。');
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
		await this.app.fileManager.processFrontMatter(threadFile, (frontmatter) => {
			const metadata = frontmatter as Record<string, unknown>;
			if (parentLink) metadata.parent = parentLink;
			else delete metadata.parent;
		});
		new Notice(parent
			? `已将 ${thread.title} 的父 thread 设为 ${this.index.getDisplayName(parent)}。`
			: `已将 ${thread.title} 设为根 thread。`);
	}

	private descendantPaths(threadFile: TFile): Set<string> {
		const result = new Set<string>();
		const pending = [...this.index.getDirectChildren(threadFile)];
		while (pending.length > 0) {
			const next = pending.shift();
			if (!next || result.has(next.file.path)) continue;
			result.add(next.file.path);
			pending.push(...this.index.getDirectChildren(next.file));
		}
		return result;
	}
}
