import {
	App,
	FuzzySuggestModal,
	MarkdownView,
	setIcon,
	type FuzzyMatch,
	type WorkspaceLeaf,
} from 'obsidian';
import type { ThreadIndex } from './thread-index';
import {
	breadcrumbCounterpart,
	breadcrumbFilterLabel,
	filterBreadcrumbThreads,
	type BreadcrumbFilter,
} from './thread-breadcrumb-model';
import { threadStatusLabel } from './thread-status-model';
import type { ThreadInfo, ThreadJournalSettings } from './types';

class ThreadPicker extends FuzzySuggestModal<ThreadInfo> {
	constructor(
		app: App,
		private readonly threads: ThreadInfo[],
		private readonly onChoose: (thread: ThreadInfo) => Promise<void>,
	) {
		super(app);
		this.setPlaceholder('切换 thread');
	}

	getItems(): ThreadInfo[] {
		return this.threads;
	}

	getItemText(thread: ThreadInfo): string {
		return `${thread.title} ${threadStatusLabel(thread.status)} ${thread.file.path}`;
	}

	renderSuggestion(match: FuzzyMatch<ThreadInfo>, el: HTMLElement): void {
		el.createDiv({ text: match.item.title });
		el.createDiv({
			cls: 'suggestion-note',
			text: `${threadStatusLabel(match.item.status)} · ${match.item.file.path}`,
		});
	}

	onChooseItem(thread: ThreadInfo): void {
		void this.onChoose(thread);
	}
}

interface MountedBar {
	bar: HTMLElement;
	filter: BreadcrumbFilter;
}

export class ThreadBreadcrumbManager {
	private readonly mounted = new Map<WorkspaceLeaf, MountedBar>();

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	refresh(resetFilter = false): void {
		const liveLeaves = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			liveLeaves.add(leaf);
			this.mountOrUpdate(leaf, leaf.view, resetFilter);
		});
		for (const [leaf, mounted] of this.mounted) {
			if (liveLeaves.has(leaf)) continue;
			this.detach(mounted);
			this.mounted.delete(leaf);
		}
	}

	unload(): void {
		for (const mounted of this.mounted.values()) this.detach(mounted);
		this.mounted.clear();
	}

	private mountOrUpdate(leaf: WorkspaceLeaf, view: MarkdownView, resetFilter: boolean): void {
		const file = view.file;
		const threadFile = file ? this.index.getThreadFile(file) : undefined;
		const thread = threadFile ? this.index.getThread(threadFile) : undefined;
		const existing = this.mounted.get(leaf);
		if (!file || !thread || !threadFile) {
			if (existing) this.detach(existing);
			this.mounted.delete(leaf);
			return;
		}

		const settings = this.getSettings();
		const mounted = existing ?? {
			bar: createDiv({ cls: 'thread-journal-fixed-breadcrumb' }),
			filter: settings.breadcrumbDefaultFilter,
		};
		if (resetFilter) mounted.filter = settings.breadcrumbDefaultFilter;
		this.mounted.set(leaf, mounted);
		this.place(view.contentEl, mounted.bar, settings.breadcrumbPosition);
		this.render(mounted, thread, threadFile, file);
	}

	private place(
		contentEl: HTMLElement,
		bar: HTMLElement,
		position: ThreadJournalSettings['breadcrumbPosition'],
	): void {
		contentEl.addClass('thread-journal-breadcrumb-host');
		bar.toggleClass('is-bottom', position === 'bottom');
		if (position === 'bottom') contentEl.append(bar);
		else contentEl.prepend(bar);
	}

	private detach(mounted: MountedBar): void {
		mounted.bar.parentElement?.removeClass('thread-journal-breadcrumb-host');
		mounted.bar.remove();
	}

	private render(
		mounted: MountedBar,
		current: ThreadInfo,
		threadFile: ThreadInfo['file'],
		currentFile: ThreadInfo['file'],
	): void {
		const { bar } = mounted;
		bar.empty();
		const rootThreads = filterBreadcrumbThreads(
			this.index.getAllThreads().filter((thread) => !this.index.getParentFile(thread.file)),
			mounted.filter,
		);
		const rootButton = bar.createEl('button', {
			cls: 'clickable-icon thread-journal-fixed-breadcrumb-root',
			attr: {
				'aria-label': `切换根 thread（${breadcrumbFilterLabel(mounted.filter)}，${rootThreads.length} 个）`,
			},
		});
		setIcon(rootButton, 'git-branch');
		rootButton.addEventListener('click', () => {
			new ThreadPicker(this.app, rootThreads, async (thread) => {
				await this.app.workspace.getLeaf(false).openFile(thread.file);
			}).open();
		});
		const trail = [...this.index.getAncestors(threadFile).items, {
			file: threadFile,
			label: current.title,
		}];
		const path = bar.createDiv({ cls: 'thread-journal-fixed-breadcrumb-path' });
		for (const [index, item] of trail.entries()) {
			if (index > 0) path.createSpan({ cls: 'thread-journal-fixed-breadcrumb-separator', text: '›' });
			const button = path.createEl('button', {
				cls: 'clickable-icon thread-journal-fixed-breadcrumb-segment',
				text: item.label,
				attr: { 'aria-label': `打开 ${item.label}` },
			});
			button.addEventListener('click', () => {
				void this.app.workspace.openLinkText(item.file.path, threadFile.path);
			});
		}
		if (this.index.getAncestors(threadFile).cycle) {
			path.createSpan({ cls: 'thread-journal-warning', text: '父子循环' });
		}

		const actions = bar.createDiv({ cls: 'thread-journal-fixed-breadcrumb-actions' });
		const workspace = this.index.getWorkspace(threadFile);
		const counterpart = breadcrumbCounterpart(threadFile.path, workspace?.path, currentFile.path);
		if (counterpart) {
			const workspaceButton = actions.createEl('button', {
				cls: 'clickable-icon',
				attr: { 'aria-label': counterpart.label },
			});
			setIcon(workspaceButton, 'arrow-left-right');
			workspaceButton.addEventListener('click', () => {
				void this.app.workspace.openLinkText(counterpart.path, currentFile.path);
			});
		}

		const available = filterBreadcrumbThreads(this.index.getAllThreads(), mounted.filter);
		const pickerButton = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-fixed-breadcrumb-picker',
			attr: {
				'aria-label': `切换 thread（${breadcrumbFilterLabel(mounted.filter)}）`,
			},
		});
		setIcon(pickerButton, 'list-tree');
		pickerButton.createSpan({ text: String(available.length) });
		pickerButton.addEventListener('click', () => {
			new ThreadPicker(this.app, available, async (thread) => {
				await this.app.workspace.getLeaf(false).openFile(thread.file);
			}).open();
		});

		const filterButton = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-fixed-breadcrumb-filter',
			text: breadcrumbFilterLabel(mounted.filter),
			attr: {
				'aria-label': mounted.filter === 'active'
					? '当前只显示持续关注；切换为全部 thread'
					: '当前显示全部；切换为仅持续关注',
			},
		});
		filterButton.addEventListener('click', () => {
			mounted.filter = mounted.filter === 'active' ? 'all' : 'active';
			this.render(mounted, current, threadFile, currentFile);
		});
	}
}
