import {
	App,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	TFile,
	type FuzzyMatch,
	type WorkspaceLeaf,
} from 'obsidian';
import type { ThreadFileManager } from './thread-files';
import type { ThreadIndex } from './thread-index';
import {
	describeOpenThreadRoles,
	groupOpenThreadViews,
	orderOpenThreadGroups,
	type OpenThreadGroup,
	type OpenThreadView,
} from './thread-switcher-model';
import { threadStatusLabel } from './thread-status-model';
import type { ThreadInfo } from './types';
import { leafFilePath } from './workspace-leaf';

type ThreadManagerAction = 'entry' | 'files' | 'close';

interface OpenThreadCandidate {
	thread: ThreadInfo;
	breadcrumb: string;
	openSummary: string;
	memberCount: number;
	openCount: number;
	current: boolean;
}

interface ThreadActionChoice {
	action: ThreadManagerAction;
	label: string;
	detail: string;
}

class OpenThreadManagerModal extends FuzzySuggestModal<OpenThreadCandidate> {
	constructor(
		app: App,
		private readonly candidates: OpenThreadCandidate[],
		private readonly onOpenActions: (candidate: OpenThreadCandidate) => void,
		private readonly onAction: (
			candidate: OpenThreadCandidate,
			action: ThreadManagerAction,
		) => void,
	) {
		super(app);
		this.setPlaceholder('管理已打开的 thread');
		this.setInstructions([
			{ command: '↵', purpose: '选择操作' },
			{ command: 'esc', purpose: '关闭' },
		]);
	}

	getItems(): OpenThreadCandidate[] {
		return this.candidates;
	}

	getItemText(candidate: OpenThreadCandidate): string {
		return [
			candidate.breadcrumb,
			candidate.thread.title,
			candidate.thread.id,
			threadStatusLabel(candidate.thread.status),
			candidate.thread.status,
			candidate.openSummary,
		].join(' ');
	}

	renderSuggestion(match: FuzzyMatch<OpenThreadCandidate>, el: HTMLElement): void {
		const candidate = match.item;
		el.addClass('thread-journal-open-thread-suggestion');
		const copy = el.createDiv({ cls: 'thread-journal-open-thread-copy' });
		copy.createDiv({ text: `${candidate.breadcrumb}${candidate.current ? ' · 当前' : ''}` });
		copy.createDiv({
			cls: 'suggestion-note',
			text: `${threadStatusLabel(candidate.thread.status)} · ${candidate.openSummary}`,
		});
		const actions = el.createDiv({ cls: 'thread-journal-open-thread-actions' });
		this.addActionButton(actions, candidate, 'entry', '入口');
		this.addActionButton(actions, candidate, 'files', '文件');
		this.addActionButton(actions, candidate, 'close', '关闭标签');
	}

	onChooseItem(candidate: OpenThreadCandidate): void {
		this.onOpenActions(candidate);
	}

	private addActionButton(
		container: HTMLElement,
		candidate: OpenThreadCandidate,
		action: ThreadManagerAction,
		label: string,
	): void {
		const button = container.createEl('button', {
			cls: [
				'thread-journal-open-thread-action',
				action === 'close' ? 'is-close' : '',
			],
			text: label,
			attr: {
				type: 'button',
				tabindex: '-1',
				'aria-label': action === 'close'
					? `关闭 ${candidate.thread.title} 的所有已打开标签`
					: `${label}：${candidate.thread.title}`,
			},
		});
		button.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.close();
			this.onAction(candidate, action);
		});
	}
}
class ThreadActionModal extends FuzzySuggestModal<ThreadActionChoice> {
	constructor(
		app: App,
		thread: ThreadInfo,
		private readonly choices: ThreadActionChoice[],
		private readonly onAction: (action: ThreadManagerAction) => void,
	) {
		super(app);
		this.setPlaceholder(`管理 ${thread.title}`);
	}

	getItems(): ThreadActionChoice[] {
		return this.choices;
	}

	getItemText(choice: ThreadActionChoice): string {
		return `${choice.label} ${choice.detail}`;
	}

	renderSuggestion(match: FuzzyMatch<ThreadActionChoice>, el: HTMLElement): void {
		if (match.item.action === 'close') el.addClass('thread-journal-open-thread-close-choice');
		el.createDiv({ text: match.item.label });
		el.createDiv({ cls: 'suggestion-note', text: match.item.detail });
	}

	onChooseItem(choice: ThreadActionChoice): void {
		this.onAction(choice.action);
	}
}

export class ThreadSwitcherManager {
	private readonly recentThreadIds: string[] = [];

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly files: ThreadFileManager,
	) {}

	rememberActiveLeaf(leaf: WorkspaceLeaf | null): void {
		if (!leaf) return;
		const view = this.openThreadView(leaf, 0);
		if (!view) return;
		const existing = this.recentThreadIds.indexOf(view.threadId);
		if (existing >= 0) this.recentThreadIds.splice(existing, 1);
		this.recentThreadIds.unshift(view.threadId);
	}

	open(): void {
		const groups = orderOpenThreadGroups(this.collectOpenThreadGroups(), this.recentThreadIds);
		if (groups.length === 0) {
			new Notice('当前没有已打开的 thread。');
			return;
		}
		const currentThreadId = this.currentThreadId();
		const candidates = groups
			.map((group) => this.buildCandidate(group, currentThreadId))
			.filter((candidate): candidate is OpenThreadCandidate => Boolean(candidate));
		new OpenThreadManagerModal(
			this.app,
			candidates,
			(candidate) => this.openActions(candidate),
			(candidate, action) => this.runAction(candidate.thread.id, action),
		).open();
	}

	getOpenThreadCount(): number {
		return this.collectOpenThreadGroups().length;
	}

	private collectOpenThreadGroups(): OpenThreadGroup<WorkspaceLeaf>[] {
		const views: OpenThreadView<WorkspaceLeaf>[] = [];
		let order = 0;
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = this.openThreadView(leaf, order);
			order += 1;
			if (view) views.push(view);
		});
		return groupOpenThreadViews(views);
	}

	private openThreadView(
		leaf: WorkspaceLeaf,
		order: number,
	): OpenThreadView<WorkspaceLeaf> | undefined {
		const path = leafFilePath(leaf);
		if (!path) return undefined;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return undefined;
		const threadFile = this.index.getThreadFile(file);
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		if (!thread) return undefined;
		const member = this.index.getMember(file);
		return {
			threadId: thread.id,
			role: member?.role ?? 'meta',
			roleStatus: member?.roleStatus,
			filePath: file.path,
			target: leaf,
			order,
		};
	}

	private buildCandidate(
		group: OpenThreadGroup<WorkspaceLeaf>,
		currentThreadId: string | undefined,
	): OpenThreadCandidate | undefined {
		const thread = this.index.getThreadById(group.threadId);
		if (!thread) return undefined;
		const ancestors = this.index.getAncestors(thread.file).items.map((item) => item.label);
		return {
			thread,
			breadcrumb: [...ancestors, thread.title].join(' › '),
			openSummary: describeOpenThreadRoles(group),
			memberCount: this.index.getMembersByThreadId(thread.id).length,
			openCount: group.views.length,
			current: thread.id === currentThreadId,
		};
	}

	private currentThreadId(): string | undefined {
		const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		return leaf ? this.openThreadView(leaf, 0)?.threadId : undefined;
	}

	private openActions(candidate: OpenThreadCandidate): void {
		const choices: ThreadActionChoice[] = [
			{ action: 'entry', label: '打开入口', detail: '打开 meta 指定的唯一入口文件' },
			{ action: 'files', label: '管理文件', detail: `${candidate.memberCount} 个成员文件` },
			{ action: 'close', label: '关闭全部标签', detail: `${candidate.openCount} 个已打开标签；不修改 thread 状态` },
		];
		new ThreadActionModal(
			this.app,
			candidate.thread,
			choices,
			(action) => this.runAction(candidate.thread.id, action),
		).open();
	}

	private runAction(threadId: string, action: ThreadManagerAction): void {
		void this.performAction(threadId, action).catch((error: unknown) => {
			console.error('Thread Journal failed to manage open thread', error);
			new Notice(`管理已打开的 thread 失败：${String(error)}`);
		});
	}

	private async performAction(threadId: string, action: ThreadManagerAction): Promise<void> {
		const thread = this.index.getThreadById(threadId);
		if (!thread) throw new Error(`找不到 thread_id: ${threadId}`);
		if (action === 'close') {
			this.closeThread(threadId);
			return;
		}
		if (action === 'files') {
			this.files.openThreadFilesModal(thread.file);
			return;
		}
		await this.files.openEntry(thread.file);
	}

	private closeThread(threadId: string): void {
		const group = this.collectOpenThreadGroups().find((item) => item.threadId === threadId);
		if (!group) {
			new Notice('这个 thread 已经不在打开的标签页中。');
			return;
		}
		const leaves = [...new Set(group.views.map((view) => view.target))];
		for (const leaf of leaves) leaf.detach();
		const recent = this.recentThreadIds.indexOf(threadId);
		if (recent >= 0) this.recentThreadIds.splice(recent, 1);
		new Notice(`已关闭 ${leaves.length} 个标签；thread 状态未改变。`);
	}
}
