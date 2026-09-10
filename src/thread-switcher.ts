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
	groupOpenThreadViews,
	orderOpenThreadGroups,
	preferredOpenThreadView,
	type OpenThreadGroup,
	type OpenThreadSurface,
	type OpenThreadView,
} from './thread-switcher-model';
import { threadStatusLabel } from './thread-status-model';
import type { ThreadInfo } from './types';
import { leafFilePath } from './workspace-leaf';

interface OpenThreadCandidate {
	thread: ThreadInfo;
	breadcrumb: string;
	surfaces: string;
	current: boolean;
}

class OpenThreadModal extends FuzzySuggestModal<OpenThreadCandidate> {
	constructor(
		app: App,
		private readonly candidates: OpenThreadCandidate[],
		private readonly onChoose: (candidate: OpenThreadCandidate) => Promise<void>,
	) {
		super(app);
		this.setPlaceholder('切换已打开的 thread');
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
		const current = candidate.current ? ' · 当前' : '';
		el.createDiv({ text: `${candidate.breadcrumb}${current}` });
		el.createDiv({
			cls: 'suggestion-note',
			text: `${threadStatusLabel(candidate.thread.status)} · ${candidate.surfaces}`,
		});
	}

	onChooseItem(candidate: OpenThreadCandidate): void {
		void this.onChoose(candidate);
	}
}

export class ThreadSwitcherManager {
	private readonly recentThreadIds: string[] = [];
	private readonly lastLeafByThreadId = new Map<string, WorkspaceLeaf>();

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
	) {}

	rememberActiveLeaf(leaf: WorkspaceLeaf | null): void {
		if (!leaf) return;
		const view = this.openThreadView(leaf, 0);
		if (!view) return;
		this.lastLeafByThreadId.set(view.threadId, leaf);
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
		new OpenThreadModal(this.app, candidates, async (candidate) => {
			try {
				await this.focusThread(candidate.thread.id);
			} catch (error) {
				console.error('Thread Journal failed to switch open thread', error);
				new Notice(`切换已打开的 thread 失败：${String(error)}`);
			}
		}).open();
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
		const breadcrumb = [...ancestors, thread.title].join(' › ');
		const surfaces = new Set(group.views.map((view) => view.surface));
		const surfaceLabel = surfaces.has('context') && surfaces.has('workspace')
			? 'Context + Workspace'
			: surfaces.has('workspace') ? 'Workspace' : 'Context';
		return {
			thread,
			breadcrumb,
			surfaces: surfaceLabel,
			current: thread.id === currentThreadId,
		};
	}

	private currentThreadId(): string | undefined {
		const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
		return leaf ? this.openThreadView(leaf, 0)?.threadId : undefined;
	}

	private async focusThread(threadId: string): Promise<void> {
		const group = this.collectOpenThreadGroups().find((item) => item.threadId === threadId);
		if (!group) {
			new Notice('这个 thread 已经不在打开的标签页中。');
			return;
		}
		const target = preferredOpenThreadView(group, this.lastLeafByThreadId.get(threadId));
		if (!target) return;
		await this.app.workspace.revealLeaf(target.target);
		this.app.workspace.setActiveLeaf(target.target, { focus: true });
		this.rememberActiveLeaf(target.target);
	}
}
