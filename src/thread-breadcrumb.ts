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
	private childMenu?: HTMLElement;
	private closeChildMenuListeners?: () => void;

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	refresh(resetFilter = false): void {
		this.closeChildMenu();
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
		this.closeChildMenu();
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

	private closeChildMenu(): void {
		this.closeChildMenuListeners?.();
		this.closeChildMenuListeners = undefined;
		this.childMenu?.remove();
		this.childMenu = undefined;
	}

	private openChildMenu(
		trigger: HTMLButtonElement,
		parent: { label: string },
		children: ThreadInfo[],
		activeChildPath: string | undefined,
		currentFile: ThreadInfo['file'],
	): void {
		this.closeChildMenu();
		const menu = document.body.createDiv({
			cls: 'thread-journal-breadcrumb-child-menu',
			attr: { role: 'menu', 'aria-label': `${parent.label} 的子 thread` },
		});
		this.childMenu = menu;
		trigger.setAttr('aria-expanded', 'true');

		menu.createDiv({
			cls: 'thread-journal-breadcrumb-child-menu-title',
			text: `${parent.label} /`,
		});
		const buttons = children.map((child) => {
			const item = menu.createEl('button', {
				cls: 'thread-journal-breadcrumb-child-menu-item',
				attr: { role: 'menuitem' },
			});
			item.toggleClass('is-active', child.file.path === activeChildPath);
			item.createSpan({ cls: 'thread-journal-breadcrumb-child-menu-name', text: child.title });
			item.createSpan({
				cls: 'thread-journal-breadcrumb-child-menu-status',
				text: threadStatusLabel(child.status),
			});
			item.addEventListener('click', () => {
				this.closeChildMenu();
				void this.app.workspace.openLinkText(child.file.path, currentFile.path);
			});
			return item;
		});

		const rect = trigger.getBoundingClientRect();
		menu.style.top = `${rect.bottom + 4}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
		menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 12)}px`;

		const closeOnPointerDown = (event: PointerEvent): void => {
			const target = event.target as Node | null;
			if (target && (menu.contains(target) || trigger.contains(target))) return;
			this.closeChildMenu();
		};
		const closeOnViewportChange = (): void => this.closeChildMenu();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.closeChildMenu();
				trigger.focus();
				return;
			}
			const focused = document.activeElement;
			const currentIndex = buttons.findIndex((button) => button === focused);
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				buttons[(currentIndex + 1 + buttons.length) % buttons.length]?.focus();
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				buttons[(currentIndex - 1 + buttons.length) % buttons.length]?.focus();
			} else if (event.key === 'Home') {
				event.preventDefault();
				buttons[0]?.focus();
			} else if (event.key === 'End') {
				event.preventDefault();
				buttons.at(-1)?.focus();
			}
		};
		document.addEventListener('pointerdown', closeOnPointerDown);
		document.addEventListener('keydown', onKeyDown);
		window.addEventListener('resize', closeOnViewportChange);
		document.addEventListener('scroll', closeOnViewportChange, true);
		this.closeChildMenuListeners = () => {
			trigger.setAttr('aria-expanded', 'false');
			document.removeEventListener('pointerdown', closeOnPointerDown);
			document.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('resize', closeOnViewportChange);
			document.removeEventListener('scroll', closeOnViewportChange, true);
		};
		(buttons.find((button) => button.hasClass('is-active')) ?? buttons[0])?.focus();
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
		const root = bar.createSpan({
			cls: 'thread-journal-fixed-breadcrumb-root',
			attr: { 'aria-label': 'Thread 根节点' },
		});
		setIcon(root, 'git-branch');
		const trail = [...this.index.getAncestors(threadFile).items, {
			file: threadFile,
			label: current.title,
		}];
		if (rootThreads.length > 0) {
			const rootSeparator = bar.createEl('button', {
				cls: 'clickable-icon thread-journal-fixed-breadcrumb-separator',
				attr: {
					'aria-label': `切换根 thread（${breadcrumbFilterLabel(mounted.filter)}，${rootThreads.length} 个）`,
					'aria-haspopup': 'menu',
					'aria-expanded': 'false',
				},
			});
			setIcon(rootSeparator, 'chevron-right');
			rootSeparator.addEventListener('click', () => {
				this.openChildMenu(
					rootSeparator,
					{ label: 'Thread' },
					rootThreads,
					trail[0]?.file.path,
					currentFile,
				);
			});
		} else {
			bar.createSpan({ cls: 'thread-journal-fixed-breadcrumb-separator-static', text: '›' });
		}
		const path = bar.createDiv({ cls: 'thread-journal-fixed-breadcrumb-path' });
		for (const [trailIndex, item] of trail.entries()) {
			const button = path.createEl('button', {
				cls: 'clickable-icon thread-journal-fixed-breadcrumb-segment',
				text: item.label,
				attr: { 'aria-label': `打开 ${item.label}` },
			});
			button.addEventListener('click', () => {
				void this.app.workspace.openLinkText(item.file.path, threadFile.path);
			});

			const children = filterBreadcrumbThreads(
				this.index.getDirectChildren(item.file),
				mounted.filter,
			);
			const separatesNextSegment = trailIndex < trail.length - 1;
			if (children.length > 0) {
				const separator = path.createEl('button', {
					cls: 'clickable-icon thread-journal-fixed-breadcrumb-separator',
					attr: {
						'aria-label': `切换 ${item.label} 的子 thread（${breadcrumbFilterLabel(mounted.filter)}，${children.length} 个）`,
						'aria-haspopup': 'menu',
						'aria-expanded': 'false',
					},
				});
				setIcon(separator, 'chevron-right');
				separator.addEventListener('click', () => {
					this.openChildMenu(
						separator,
						item,
						children,
						trail[trailIndex + 1]?.file.path,
						currentFile,
					);
				});
			} else if (separatesNextSegment) {
				path.createSpan({ cls: 'thread-journal-fixed-breadcrumb-separator-static', text: '›' });
			}
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
				'aria-label': mounted.filter === 'operational'
					? '当前显示投入中的 thread；切换为全部 thread'
					: '当前显示全部；切换为投入中的 thread',
			},
		});
		filterButton.addEventListener('click', () => {
			mounted.filter = mounted.filter === 'operational' ? 'all' : 'operational';
			this.render(mounted, current, threadFile, currentFile);
		});
	}
}
