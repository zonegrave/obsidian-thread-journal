import {
	App,
	MarkdownView,
	setIcon,
	setTooltip,
	type WorkspaceLeaf,
} from 'obsidian';
import type { ThreadIndex } from './thread-index';
import type { ThreadFileManager } from './thread-files';
import type { ThreadStatusManager } from './thread-status';
import type { ThreadSwitcherManager } from './thread-switcher';
import {
	breadcrumbFilterLabel,
	breadcrumbMenuSide,
	breadcrumbRightClearance,
	breadcrumbTooltipPlacement,
	filterBreadcrumbThreads,
	type BreadcrumbFilter,
} from './thread-breadcrumb-model';
import type { ThreadInfo, ThreadJournalSettings } from './types';

interface MountedBar {
	bar: HTMLElement;
	filter: BreadcrumbFilter;
}

export class ThreadBreadcrumbManager {
	private readonly mounted = new Map<WorkspaceLeaf, MountedBar>();
	private childMenu?: HTMLElement;
	private closeChildMenuListeners?: () => void;
	private readonly updateClearances = (): void => {
		for (const mounted of this.mounted.values()) this.updateBottomClearance(mounted.bar);
	};

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly files: ThreadFileManager,
		private readonly statuses: ThreadStatusManager,
		private readonly switcher: ThreadSwitcherManager,
		private readonly getSettings: () => ThreadJournalSettings,
	) {
		window.addEventListener('resize', this.updateClearances);
	}

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
		window.removeEventListener('resize', this.updateClearances);
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

	private updateBottomClearance(bar: HTMLElement): void {
		let clearance = 0;
		if (bar.hasClass('is-bottom')) {
			const statusBar = document.querySelector<HTMLElement>('.status-bar');
			if (statusBar) {
				clearance = breadcrumbRightClearance(
					bar.getBoundingClientRect(),
					statusBar.getBoundingClientRect(),
				);
			}
		}
		bar.setCssProps({ '--thread-journal-bottom-clearance': `${clearance}px` });
	}

	private setBarTooltip(bar: HTMLElement, target: HTMLElement, text: string): void {
		setTooltip(target, text, {
			placement: breadcrumbTooltipPlacement(bar.hasClass('is-bottom') ? 'bottom' : 'top'),
		});
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
			attr: { role: 'menu', 'aria-label': `Child threads of ${parent.label}` },
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
				text: child.status || 'unset',
			});
			item.addEventListener('click', () => {
				this.closeChildMenu();
				const target = this.index.getEntry(child.file) ?? child.file;
				void this.app.workspace.openLinkText(target.path, currentFile.path);
			});
			return item;
		});

		const rect = trigger.getBoundingClientRect();
		const gap = 4;
		const margin = 8;
		const side = breadcrumbMenuSide(
			rect.top,
			rect.bottom,
			window.innerHeight,
			menu.scrollHeight,
			Boolean(trigger.closest('.thread-journal-fixed-breadcrumb.is-bottom')),
		);
		menu.dataset.side = side;
		const availableHeight = side === 'above'
			? rect.top - gap - margin
			: window.innerHeight - rect.bottom - gap - margin;
		menu.setCssProps({
			'--thread-journal-menu-top': side === 'below' ? `${rect.bottom + gap}px` : 'auto',
			'--thread-journal-menu-bottom': side === 'above' ? `${window.innerHeight - rect.top + gap}px` : 'auto',
			'--thread-journal-menu-left': `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`,
			'--thread-journal-menu-max-height': `${Math.max(80, availableHeight)}px`,
		});

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
		});
		setIcon(root, 'git-branch');
		this.setBarTooltip(bar, root, 'Thread root');
		const trail = [...this.index.getAncestors(threadFile).items, {
			file: threadFile,
			label: current.title,
		}];
		if (rootThreads.length > 0) {
			const rootSeparator = bar.createEl('button', {
				cls: 'clickable-icon thread-journal-fixed-breadcrumb-separator',
				attr: {
					'aria-haspopup': 'menu',
					'aria-expanded': 'false',
				},
			});
			setIcon(rootSeparator, 'chevron-right');
			this.setBarTooltip(
				bar,
				rootSeparator,
				`Switch root threads (${breadcrumbFilterLabel(mounted.filter)}, ${rootThreads.length})`,
			);
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
			});
			this.setBarTooltip(bar, button, `Open ${item.label}`);
			button.addEventListener('click', () => {
				const target = this.index.getEntry(item.file) ?? item.file;
				void this.app.workspace.openLinkText(target.path, threadFile.path);
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
						'aria-haspopup': 'menu',
						'aria-expanded': 'false',
					},
				});
				setIcon(separator, 'chevron-right');
				this.setBarTooltip(
					bar,
					separator,
					`Switch child threads of ${item.label} (${breadcrumbFilterLabel(mounted.filter)}, ${children.length})`,
				);
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
			path.createSpan({ cls: 'thread-journal-warning', text: 'Parent cycle' });
		}

		const actions = bar.createDiv({ cls: 'thread-journal-fixed-breadcrumb-actions' });
		const status = actions.createEl('button', {
			cls: 'thread-journal-fixed-breadcrumb-status',
			text: current.status || 'unset',
			attr: {
				type: 'button',
				'data-status': current.status || 'unset',
				'aria-label': `Change thread status; current status: ${current.status || 'unset'}`,
			},
		});
		this.setBarTooltip(bar, status, `Change thread status (current: ${current.status || 'unset'})`);
		status.addEventListener('click', () => {
			this.statuses.openStatusModal(threadFile);
		});
		const entry = this.index.getEntry(threadFile);
		if (entry && entry.path !== currentFile.path) {
			const entryButton = actions.createEl('button', {
				cls: 'clickable-icon',
			});
			setIcon(entryButton, 'home');
			this.setBarTooltip(bar, entryButton, 'Open thread entry');
			entryButton.addEventListener('click', () => {
				void this.files.openEntry(threadFile);
			});
		}
		const members = this.index.getMembersByThreadId(current.id);
		const filesButton = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-fixed-breadcrumb-files',
		});
		setIcon(filesButton, 'files');
		this.setBarTooltip(bar, filesButton, `Manage thread files (${members.length})`);
		filesButton.createSpan({ text: String(members.length) });
		filesButton.addEventListener('click', () => {
			this.files.openThreadFilesModal(currentFile);
		});

		const openThreadCount = this.switcher.getOpenThreadCount();
		const pickerButton = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-fixed-breadcrumb-picker',
		});
		setIcon(pickerButton, 'git-fork');
		this.setBarTooltip(bar, pickerButton, `Manage open threads (${openThreadCount})`);
		pickerButton.createSpan({ text: String(openThreadCount) });
		pickerButton.addEventListener('click', () => {
			this.switcher.open();
		});

		const filterTooltip = mounted.filter === 'operational'
			? 'Active + dormant; switch to all threads'
			: 'All threads; switch to active + dormant';
		const filterButton = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-fixed-breadcrumb-filter',
			text: breadcrumbFilterLabel(mounted.filter),
		});
		this.setBarTooltip(bar, filterButton, filterTooltip);
		filterButton.addEventListener('click', () => {
			mounted.filter = mounted.filter === 'operational' ? 'all' : 'operational';
			this.render(mounted, current, threadFile, currentFile);
		});
		window.requestAnimationFrame(() => {
			if (bar.isConnected) this.updateBottomClearance(bar);
		});
	}
}
