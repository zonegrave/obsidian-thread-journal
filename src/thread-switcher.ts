import {
	App,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	TFile,
	type FuzzyMatch,
	type WorkspaceLeaf,
} from 'obsidian';
import type { ThreadIndex } from './thread-index';
import {
	describeOpenThreadSurfaces,
	groupOpenThreadViews,
	openThreadViewsForSurface,
	orderOpenThreadGroups,
	type OpenThreadGroup,
	type OpenThreadSurface,
	type OpenThreadView,
} from './thread-switcher-model';
import { threadStatusLabel } from './thread-status-model';
import type { ThreadInfo } from './types';
import { leafFilePath } from './workspace-leaf';

type ThreadManagerAction = OpenThreadSurface | 'close';
type EnsureWorkspace = (threadFile: TFile) => Promise<TFile | undefined>;

interface OpenThreadCandidate {
	thread: ThreadInfo;
	breadcrumb: string;
	surfaces: string;
	contextCount: number;
	workspaceCount: number;
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
			candidate.thread.file.basename,
			candidate.thread.id,
			threadStatusLabel(candidate.thread.status),
			candidate.thread.status,
			candidate.surfaces,
		].join(' ');
	}

	renderSuggestion(match: FuzzyMatch<OpenThreadCandidate>, el: HTMLElement): void {
		const candidate = match.item;
		el.addClass('thread-journal-open-thread-suggestion');
		const copy = el.createDiv({ cls: 'thread-journal-open-thread-copy' });
		const current = candidate.current ? ' · 当前' : '';
		copy.createDiv({ text: `${candidate.breadcrumb}${current}` });
		copy.createDiv({
			cls: 'suggestion-note',
			text: `${threadStatusLabel(candidate.thread.status)} · ${candidate.surfaces}`,
		});
		const actions = el.createDiv({ cls: 'thread-journal-open-thread-actions' });
		this.addActionButton(actions, candidate, 'context', 'Context');
		this.addActionButton(actions, candidate, 'workspace', 'Workspace');
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
					: `跳转到 ${candidate.thread.title} 的 ${label}`,
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
	private readonly lastLeafBySurface = new Map<string, WorkspaceLeaf>();

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly ensureWorkspace: EnsureWorkspace,
	) {}

	rememberActiveLeaf(leaf: WorkspaceLeaf | null): void {
		if (!leaf) return;
		const view = this.openThreadView(leaf, 0);
		if (!view) return;
		this.lastLeafBySurface.set(this.surfaceKey(view.threadId, view.surface), leaf);
		const existing = this.recentThreadIds.indexOf(view.threadId);
		if (existing >= 0) this.recentThreadIds.splice(existing, 1);
		this.recentThreadIds.unshift(view.threadId);
	}

	open(): void {
		const groups = orderOpenThreadGroups(
			this.collectOpenThreadGroups(),
			this.recentThreadIds,
		);
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
			(candidate) => this.openActions(candidate.thread.id),
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
		const thread = this.index.getThread(file);
		if (thread) return this.threadView(thread.id, 'context', leaf, order);
		const threadFile = this.index.getThreadForWorkspace(file);
		const workspaceThread = threadFile ? this.index.getThread(threadFile) : undefined;
		return workspaceThread
			? this.threadView(workspaceThread.id, 'workspace', leaf, order)
			: undefined;
	}

	private threadView(
		threadId: string,
		surface: OpenThreadSurface,
		target: WorkspaceLeaf,
		order: number,
	): OpenThreadView<WorkspaceLeaf> {
		return { threadId, surface, target, order };
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
			surfaces: describeOpenThreadSurfaces(group),
			contextCount: openThreadViewsForSurface(group, 'context').length,
			workspaceCount: openThreadViewsForSurface(group, 'workspace').length,
			current: thread.id === currentThreadId,
		};
	}

	private currentThreadId(): string | undefined {
		const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		return leaf ? this.openThreadView(leaf, 0)?.threadId : undefined;
	}

	private openActions(threadId: string): void {
		const current = this.getOpenThread(threadId);
		if (!current) {
			new Notice('这个 thread 已经不在打开的标签页中。');
			return;
		}
		const workspaceExists = Boolean(this.index.getWorkspace(current.thread.file));
		const choices: ThreadActionChoice[] = [
			{
				action: 'context',
				label: '跳转到 Context',
				detail: this.surfaceActionDetail(current.candidate.contextCount, true),
			},
			{
				action: 'workspace',
				label: '跳转到 Workspace',
				detail: this.surfaceActionDetail(current.candidate.workspaceCount, workspaceExists),
			},
			{
				action: 'close',
				label: '关闭全部标签',
				detail: `${current.group.views.length} 个已打开标签；不修改 thread 状态`,
			},
		];
		new ThreadActionModal(
			this.app,
			current.thread,
			choices,
			(action) => this.runAction(threadId, action),
		).open();
	}

	private getOpenThread(threadId: string): {
		thread: ThreadInfo;
		group: OpenThreadGroup<WorkspaceLeaf>;
		candidate: OpenThreadCandidate;
	} | undefined {
		const group = this.collectOpenThreadGroups().find((item) => item.threadId === threadId);
		const thread = this.index.getThreadById(threadId);
		if (!group || !thread) return undefined;
		const candidate = this.buildCandidate(group, this.currentThreadId());
		return candidate ? { thread, group, candidate } : undefined;
	}

	private surfaceActionDetail(openCount: number, exists: boolean): string {
		if (openCount > 0) return `${openCount} 个已打开标签`;
		return exists ? '在当前标签组打开' : '按需创建工作区并打开';
	}

	private runAction(threadId: string, action: ThreadManagerAction): void {
		void this.performAction(threadId, action).catch((error: unknown) => {
			console.error('Thread Journal failed to manage open thread', error);
			new Notice(`管理已打开的 thread 失败：${String(error)}`);
		});
	}

	private async performAction(threadId: string, action: ThreadManagerAction): Promise<void> {
		if (action === 'close') {
			this.closeThread(threadId);
			return;
		}
		await this.openSurface(threadId, action);
	}

	private async openSurface(threadId: string, surface: OpenThreadSurface): Promise<void> {
		const thread = this.index.getThreadById(threadId);
		if (!thread) throw new Error(`找不到 thread_id: ${threadId}`);
		const targetFile = surface === 'context'
			? thread.file
			: await this.ensureWorkspace(thread.file);
		if (!targetFile) throw new Error('无法创建或定位 Thread 工作区。');

		const group = this.collectOpenThreadGroups().find((item) => item.threadId === threadId);
		const openViews = group ? openThreadViewsForSurface(group, surface) : [];
		const remembered = this.lastLeafBySurface.get(this.surfaceKey(threadId, surface));
		const existing = openViews.find((view) => view.target === remembered) ?? openViews[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing.target);
			this.app.workspace.setActiveLeaf(existing.target, { focus: true });
			this.rememberActiveLeaf(existing.target);
			return;
		}

		const target = this.app.workspace.getLeaf('tab');
		await target.openFile(targetFile, { active: true });
		await this.app.workspace.revealLeaf(target);
		this.app.workspace.setActiveLeaf(target, { focus: true });
		this.rememberActiveLeaf(target);
	}

	private closeThread(threadId: string): void {
		const group = this.collectOpenThreadGroups().find((item) => item.threadId === threadId);
		if (!group) {
			new Notice('这个 thread 已经不在打开的标签页中。');
			return;
		}
		const leaves = [...new Set(group.views.map((view) => view.target))];
		for (const leaf of leaves) leaf.detach();
		this.lastLeafBySurface.delete(this.surfaceKey(threadId, 'context'));
		this.lastLeafBySurface.delete(this.surfaceKey(threadId, 'workspace'));
		const recent = this.recentThreadIds.indexOf(threadId);
		if (recent >= 0) this.recentThreadIds.splice(recent, 1);
		new Notice(`已关闭 ${leaves.length} 个标签；thread 状态未改变。`);
	}

	private surfaceKey(threadId: string, surface: OpenThreadSurface): string {
		return `${threadId}:${surface}`;
	}
}
