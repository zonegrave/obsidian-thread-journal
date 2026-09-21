import {
	App,
	ItemView,
	MarkdownRenderChild,
	Notice,
	moment,
	setIcon,
	type MarkdownPostProcessorContext,
	type WorkspaceLeaf,
} from 'obsidian';
import {
	collectAttention,
	moveAttentionTaskToNext,
	setAttentionTaskPinned,
	type AttentionRow,
	type AttentionRowFallback,
	type AttentionRowTask,
} from './thread-attention';
import {
	attentionHint,
	filterAttentionTasks,
	type TaskScope,
	type TodoDisposition,
} from './thread-attention-model';
import type { ThreadIndex } from './thread-index';
import {
	buildThreadOverviewTree,
	countThreadOverviewDescendants,
	DEFAULT_THREAD_OVERVIEW_STATUSES,
	filterThreadOverviewTree,
	type ThreadOverviewNode,
} from './thread-overview-model';
import type { TaskManager } from './task';
import {
	taskCurrentLabel,
	taskWindowState,
	type TaskData,
	type TaskEffort,
} from './task-model';
import {
	clampMapZoom,
	fitMapZoom,
	MAP_ZOOM_STEP,
	mapPointAtViewportPosition,
	mapScrollForCenter,
	mapScrollForViewportPoint,
	mapStageGeometry,
	mapViewportCenter,
	wheelMapZoomFactor,
	type MapViewportCenter,
} from './thread-overview-layout';
import {
	THREAD_STATUS_CHOICES,
	threadStatusDescription,
	threadStatusLabel,
} from './thread-status-model';
import { LANGUAGE_CHANGE_EVENT, t, type TranslationKey } from './i18n';

const TASK_DISPOSITION_LABELS: Record<TodoDisposition, TranslationKey> = {
	ready: 'ready',
	future: 'future',
	waiting: 'waiting',
	candidate: 'candidate',
	unknown: 'other',
};

const TASK_EFFORT_LABELS: Record<Exclude<TaskEffort, ''>, TranslationKey> = {
	quick: 'Quick',
	light: 'Light',
	normal: 'Normal effort',
	deep: 'Deep',
};

function repeatLabel(data: TaskData): string {
	if (data.repeatFrequency === 'weekly') return t('Weekly');
	if (data.repeatFrequency === 'monthly') return t('Monthly');
	if (data.repeatFrequency === 'custom') {
		return t('Every {count} days', { count: data.repeatInterval });
	}
	return t('Daily');
}

function taskDeadline(
	data: TaskData,
	today: string,
): { label: string; modifier: string } | undefined {
	if (!data.windowEnd) return undefined;
	const end = moment(data.windowEnd, 'YYYY-MM-DD', true).startOf('day');
	const current = moment(today, 'YYYY-MM-DD', true).startOf('day');
	if (!end.isValid() || !current.isValid()) return undefined;
	const days = end.diff(current, 'days');
	if (days < 0) {
		return { label: t('{count}d overdue', { count: Math.abs(days) }), modifier: 'overdue' };
	}
	if (days === 0) return { label: t('Due today'), modifier: 'current' };
	if (days > 30) return { label: '30d+', modifier: 'distant' };
	return {
		label: t('{count}d left', { count: days }),
		modifier: taskWindowState(data, today) ?? 'current',
	};
}

export const THREAD_OVERVIEW_VIEW_TYPE = 'thread-journal-overview';

interface MindMapEdge {
	from: HTMLElement;
	to: HTMLElement;
	status: string;
}

type OverviewViewScope = 'all' | 'today';

class OverviewContent extends MarkdownRenderChild {
	private readonly selectedStatuses = new Set<string>(DEFAULT_THREAD_OVERVIEW_STATUSES);
	private readonly expandedNodes = new Set<string>();
	private readonly collapsedBranches = new Set<string>();
	private viewScope: OverviewViewScope = 'all';
	private taskScope: TaskScope = 'today';
	private filterOpen = false;
	private pinnedCollapsed = false;
	private rows: AttentionRow[] = [];
	private request = 0;
	private timer: number | undefined;
	private zoom = 1;
	private zoomValueEl?: HTMLElement;
	private scrollEl?: HTMLElement;
	private stageEl?: HTMLElement;
	private mapEl?: HTMLElement;
	private savedViewportCenter?: MapViewportCenter;
	private viewportWidth = 0;
	private viewportHeight = 0;
	private readonly onMapScroll = (): void => this.captureMapViewport();
	private readonly onMapWheel = (event: WheelEvent): void => {
		const scroll = this.scrollEl;
		if (!event.ctrlKey || !scroll || !this.stageEl || scroll.clientWidth <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = scroll.getBoundingClientRect();
		const anchor = {
			x: Math.max(0, Math.min(scroll.clientWidth, event.clientX - rect.left - scroll.clientLeft)),
			y: Math.max(0, Math.min(scroll.clientHeight, event.clientY - rect.top - scroll.clientTop)),
		};
		this.changeZoom(
			this.zoom * wheelMapZoomFactor(event.deltaY, event.deltaMode, scroll.clientHeight),
			false,
			anchor,
		);
	};
	private connectorSvg?: SVGSVGElement;
	private resizeObserver?: ResizeObserver;
	private connectorFrame?: number;
	private revealFrame?: number;
	private pendingBranchReveal?: string;
	private edges: MindMapEdge[] = [];
	private branchElements = new Map<string, HTMLElement>();

	constructor(
		el: HTMLElement,
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly taskManager: TaskManager,
	) {
		super(el);
	}

	onload(): void {
		this.containerEl.addClass('thread-journal-overview');
		this.containerEl.createEl('p', {
			cls: 'thread-journal-empty',
			text: t('Loading thread map…'),
		});
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		this.registerDomEvent(window, 'resize', () => this.scheduleConnectorDraw());
		const onLanguageChange = (): void => this.render();
		window.addEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange);
		this.register(() => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange));
		this.registerInterval(window.setInterval(() => this.scheduleRefresh(), 60000));
		void this.refresh();
	}

	onunload(): void {
		this.request += 1;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.teardownMap();
	}

	private scheduleRefresh(): void {
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = undefined;
			void this.refresh();
		}, 300);
	}

	private async refresh(): Promise<void> {
		const request = ++this.request;
		try {
			const rows = await collectAttention(this.app, this.index);
			if (request !== this.request) return;
			this.rows = rows;
			this.render();
		} catch (error) {
			if (request !== this.request) return;
			this.teardownMap();
			this.containerEl.empty();
			this.containerEl.createEl('p', {
				text: t('Failed to read thread overview: {error}', { error: String(error) }),
			});
		}
	}

	private render(): void {
		this.teardownMap();
		const el = this.containerEl;
		el.empty();
		const statusTree = buildThreadOverviewTree(this.overviewItems(), this.selectedStatuses);
		const attentionToday = new Set(this.rows
			.filter((row) => filterAttentionTasks(row.tasks, 'today').length > 0
				|| row.fallbacks.length > 0)
			.map((row) => row.thread.id));
		const tree = this.viewScope === 'today'
			? filterThreadOverviewTree(statusTree, (item) => attentionToday.has(item.id))
			: statusTree;
		this.renderToolbar(el, tree);
		this.renderPinnedTasks(el);
		if (this.selectedStatuses.size === 0) {
			el.createEl('p', {
				cls: 'thread-journal-empty',
				text: t('Select at least one status.'),
			});
			return;
		}
		if (tree.length === 0) {
			el.createEl('p', {
				cls: 'thread-journal-empty',
				text: this.viewScope === 'today'
					? t('No threads need attention today.')
					: t('No threads match the selected statuses.'),
			});
			return;
		}
		this.renderMindMap(el, tree);
	}

	private renderToolbar(parent: HTMLElement, tree: ThreadOverviewNode[]): void {
		const counts = new Map<string, number>();
		for (const row of this.rows) {
			counts.set(row.thread.status, (counts.get(row.thread.status) ?? 0) + 1);
		}
		const toolbar = parent.createDiv({ cls: 'thread-journal-overview-toolbar' });
		const filters = toolbar.createEl('details', {
			cls: 'thread-journal-overview-filter-menu',
		});
		filters.open = this.filterOpen;
		filters.addEventListener('toggle', () => {
			this.filterOpen = filters.open;
		});
		const filterSummary = filters.createEl('summary', {
			cls: 'thread-journal-overview-filter-summary',
			attr: { 'aria-label': t('Select thread statuses') },
		});
		setIcon(filterSummary.createSpan(), 'list-filter');
		filterSummary.createSpan({ text: t('Status · {count}', { count: this.selectedStatuses.size }) });
		const filterPanel = filters.createDiv({
			cls: 'thread-journal-overview-filter-panel',
			attr: { role: 'group', 'aria-label': t('Thread status filters') },
		});
		for (const choice of THREAD_STATUS_CHOICES) {
			const selected = this.selectedStatuses.has(choice.value);
			const option = filterPanel.createEl('label', {
				cls: 'thread-journal-overview-filter-option',
				attr: { title: threadStatusDescription(choice) },
			});
			const checkbox = option.createEl('input', { type: 'checkbox' });
			checkbox.checked = selected;
			option.createSpan({ text: `${choice.value} — ${threadStatusLabel(choice.value)}` });
			option.createSpan({
				cls: 'thread-journal-overview-filter-count',
				text: String(counts.get(choice.value) ?? 0),
			});
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.selectedStatuses.add(choice.value);
				else this.selectedStatuses.delete(choice.value);
				this.filterOpen = true;
				this.render();
			});
		}
		const viewScope = toolbar.createEl('label', {
			cls: 'thread-journal-overview-view-scope',
		});
		viewScope.createSpan({ text: t('View') });
		const viewScopeSelect = viewScope.createEl('select', {
			attr: { 'aria-label': t('Filter thread overview') },
		});
		viewScopeSelect.createEl('option', { text: t('All threads'), value: 'all' });
		viewScopeSelect.createEl('option', { text: t('Attention today'), value: 'today' });
		viewScopeSelect.value = this.viewScope;
		viewScopeSelect.addEventListener('change', () => {
			this.viewScope = viewScopeSelect.value === 'today' ? 'today' : 'all';
			this.render();
		});
		const taskScope = toolbar.createEl('label', {
			cls: 'thread-journal-overview-task-scope',
		});
		taskScope.createSpan({ text: t('Tasks') });
		const taskScopeSelect = taskScope.createEl('select', {
			attr: { 'aria-label': t('Filter thread tasks') },
		});
		taskScopeSelect.createEl('option', { text: t('Active today'), value: 'today' });
		taskScopeSelect.createEl('option', { text: t('All'), value: 'all' });
		taskScopeSelect.value = this.taskScope;
		taskScopeSelect.addEventListener('change', () => {
			this.taskScope = taskScopeSelect.value === 'all' ? 'all' : 'today';
			this.render();
		});
		if (parent.hasClass('thread-journal-overview-view')) {
			this.renderZoomControls(toolbar);
		}

		const { taskIds, branchIds } = this.overviewExpansionTargets(tree);
		const allTasksExpanded = taskIds.length > 0
			&& taskIds.every((id) => this.expandedNodes.has(id))
			&& branchIds.every((id) => !this.collapsedBranches.has(id));
		const expandButton = toolbar.createEl('button', {
			cls: 'thread-journal-overview-expand-tasks',
			text: allTasksExpanded ? t('Collapse items') : t('Expand all items'),
			attr: {
				type: 'button',
				'aria-label': allTasksExpanded
					? t('Collapse all attention lists')
					: t('Expand all attention lists'),
			},
		});
		expandButton.disabled = taskIds.length === 0;
		expandButton.addEventListener('click', () => {
			if (allTasksExpanded) {
				for (const id of taskIds) this.expandedNodes.delete(id);
			} else {
				for (const id of branchIds) this.collapsedBranches.delete(id);
				for (const id of taskIds) this.expandedNodes.add(id);
			}
			this.render();
		});
		const refreshButton = toolbar.createEl('button', {
			cls: 'clickable-icon thread-journal-overview-refresh',
			attr: { type: 'button', 'aria-label': t('Refresh thread overview') },
		});
		setIcon(refreshButton, 'refresh-cw');
		refreshButton.addEventListener('click', () => void this.refresh());
	}

	private renderZoomControls(toolbar: HTMLElement): void {
		const controls = toolbar.createDiv({ cls: 'thread-journal-overview-zoom-controls' });
		const zoomOut = controls.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('Zoom out') },
		});
		setIcon(zoomOut, 'minus');
		zoomOut.addEventListener('click', () => this.changeZoom(this.zoom - MAP_ZOOM_STEP));

		this.zoomValueEl = controls.createSpan({
			cls: 'thread-journal-overview-zoom-value',
			text: `${Math.round(this.zoom * 100)}%`,
		});

		const zoomIn = controls.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('Zoom in') },
		});
		setIcon(zoomIn, 'plus');
		zoomIn.addEventListener('click', () => this.changeZoom(this.zoom + MAP_ZOOM_STEP));

		const fit = controls.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': t('Fit map to view') },
		});
		setIcon(fit, 'maximize');
		fit.addEventListener('click', () => this.fitMapToView());
	}

	private changeZoom(
		value: number,
		centerMap = false,
		viewportAnchor?: { x: number; y: number },
	): void {
		const map = this.mapEl;
		const scroll = this.scrollEl;
		if (!map || !scroll || !this.stageEl) return;
		const nextZoom = clampMapZoom(value);
		const anchor = viewportAnchor ?? {
			x: scroll.clientWidth / 2,
			y: scroll.clientHeight / 2,
		};
		const point = mapPointAtViewportPosition(
			scroll.scrollLeft,
			scroll.scrollTop,
			anchor.x,
			anchor.y,
			map.offsetLeft,
			map.offsetTop,
			this.zoom,
		);
		this.zoom = nextZoom;
		map.style.transform = `scale(${this.zoom})`;
		this.updateMapStage();
		this.zoomValueEl?.setText(`${Math.round(this.zoom * 100)}%`);
		if (centerMap) {
			this.centerMap();
		} else {
			const offset = mapScrollForViewportPoint(
				point,
				anchor.x,
				anchor.y,
				map.offsetLeft,
				map.offsetTop,
				this.zoom,
			);
			scroll.scrollLeft = offset.left;
			scroll.scrollTop = offset.top;
		}
		this.captureMapViewport();
		this.scheduleConnectorDraw();
	}

	private fitMapToView(): void {
		const map = this.mapEl;
		const scroll = this.scrollEl;
		if (!map || !scroll) return;
		this.changeZoom(fitMapZoom(
			map.offsetWidth,
			map.offsetHeight,
			scroll.clientWidth,
			scroll.clientHeight,
		), true);
	}

	private updateMapStage(): void {
		const map = this.mapEl;
		const scroll = this.scrollEl;
		const stage = this.stageEl;
		if (!map || !scroll || !stage) return;
		const viewportWidth = scroll.clientWidth;
		const viewportHeight = scroll.clientHeight;
		const geometry = mapStageGeometry(
			map.offsetWidth,
			map.offsetHeight,
			viewportWidth,
			viewportHeight,
			this.zoom,
		);
		map.style.left = `${geometry.left}px`;
		map.style.top = `${geometry.top}px`;
		stage.style.width = `${geometry.width}px`;
		stage.style.height = `${geometry.height}px`;
	}

	private centerMap(): void {
		const map = this.mapEl;
		const scroll = this.scrollEl;
		if (!map || !scroll || !this.stageEl) return;
		scroll.scrollLeft = map.offsetLeft + map.offsetWidth * this.zoom / 2
			- scroll.clientWidth / 2;
		scroll.scrollTop = map.offsetTop + map.offsetHeight * this.zoom / 2
			- scroll.clientHeight / 2;
	}

	private captureMapViewport(): void {
		const scroll = this.scrollEl;
		const map = this.mapEl;
		if (
			!scroll || !map || !this.stageEl
			|| scroll.clientWidth <= 0 || scroll.clientHeight <= 0
			|| scroll.clientWidth !== this.viewportWidth
			|| scroll.clientHeight !== this.viewportHeight
		) {
			return;
		}
		this.savedViewportCenter = mapViewportCenter(
			scroll.scrollLeft,
			scroll.scrollTop,
			scroll.clientWidth,
			scroll.clientHeight,
			map.offsetLeft,
			map.offsetTop,
			this.zoom,
		);
	}

	private restoreMapViewport(): void {
		const scroll = this.scrollEl;
		const map = this.mapEl;
		if (!scroll || !map || !this.stageEl || scroll.clientWidth <= 0 || scroll.clientHeight <= 0) {
			return;
		}
		if (this.savedViewportCenter) {
			const offset = mapScrollForCenter(
				this.savedViewportCenter,
				scroll.clientWidth,
				scroll.clientHeight,
				map.offsetLeft,
				map.offsetTop,
				this.zoom,
			);
			scroll.scrollLeft = offset.left;
			scroll.scrollTop = offset.top;
		} else {
			this.centerMap();
		}
		this.captureMapViewport();
	}

	private overviewExpansionTargets(tree: readonly ThreadOverviewNode[]): {
		taskIds: string[];
		branchIds: string[];
	} {
		const taskIds: string[] = [];
		const branchIds: string[] = [];
		const rowById = new Map(this.rows.map((row) => [row.thread.id, row]));
		const visit = (node: ThreadOverviewNode): boolean => {
			const row = rowById.get(node.item.id);
			const hasOwnTasks = Boolean(
				!node.contextOnly && row
					&& (this.tasksForRow(row).length > 0 || row.fallbacks.length > 0),
			);
			if (hasOwnTasks) {
				taskIds.push(node.item.id);
			}
			let hasTasksBelow = false;
			for (const child of node.children) {
				hasTasksBelow = visit(child) || hasTasksBelow;
			}
			if (hasTasksBelow) branchIds.push(node.item.id);
			return hasOwnTasks || hasTasksBelow;
		};
		for (const node of tree) visit(node);
		return { taskIds, branchIds };
	}

	private tasksForRow(row: AttentionRow): AttentionRow['tasks'] {
		return filterAttentionTasks(row.tasks, this.taskScope);
	}

	private pinnedTasks(): { task: AttentionRowTask; threadTitle: string }[] {
		const pinned = new Map<string, { task: AttentionRowTask; threadTitle: string }>();
		for (const row of this.rows) {
			for (const task of row.tasks) {
				if (!task.pinned || pinned.has(task.key)) continue;
				pinned.set(task.key, { task, threadTitle: row.thread.title });
			}
		}
		return [...pinned.values()];
	}

	private renderPinnedTasks(parent: HTMLElement): void {
		const pinned = this.pinnedTasks();
		const panel = parent.createEl('aside', {
			cls: `thread-journal-overview-pinned-panel${this.pinnedCollapsed ? ' is-collapsed' : ''}`,
			attr: { 'aria-label': t('Pinned tasks') },
		});
		const header = panel.createDiv({ cls: 'thread-journal-overview-pinned-header' });
		setIcon(header.createSpan(), 'pin');
		header.createSpan({ text: t('Pinned tasks') });
		header.createSpan({
			cls: 'thread-journal-overview-pinned-count',
			text: String(pinned.length),
		});
		const collapse = header.createEl('button', {
			cls: 'clickable-icon thread-journal-overview-pinned-collapse',
			attr: { type: 'button' },
		});
		const list = panel.createDiv({ cls: 'thread-journal-overview-pinned-list' });
		const updateCollapsedState = (): void => {
			panel.toggleClass('is-collapsed', this.pinnedCollapsed);
			list.hidden = this.pinnedCollapsed;
			const label = this.pinnedCollapsed ? t('Expand pinned tasks') : t('Collapse pinned tasks');
			collapse.setAttribute('aria-label', label);
			collapse.setAttribute('title', label);
			collapse.setAttribute('aria-expanded', String(!this.pinnedCollapsed));
			collapse.empty();
			setIcon(collapse, this.pinnedCollapsed ? 'chevron-down' : 'chevron-up');
		};
		collapse.addEventListener('click', () => {
			this.pinnedCollapsed = !this.pinnedCollapsed;
			updateCollapsedState();
		});
		updateCollapsedState();
		if (pinned.length === 0) {
			list.createDiv({
				cls: 'thread-journal-empty',
				text: t('No pinned tasks.'),
			});
		} else {
			for (const { task, threadTitle } of pinned) {
				const item = list.createDiv({ cls: 'thread-journal-overview-pinned-task' });
				const meta = item.createDiv({ cls: 'thread-journal-overview-pinned-task-meta' });
				meta.createSpan({ text: threadTitle });
				this.renderTaskPinButton(item, task);
				this.renderTaskLink(item, task);
				this.renderTaskDetails(item, task);
				this.renderTaskActions(item, task);
			}
		}
	}

	private overviewItems(): {
		id: string;
		parent?: string;
		status: string;
		title: string;
	}[] {
		return this.rows.map((row) => {
			const parentFile = this.index.getParentFile(row.thread.file);
			return {
				id: row.thread.id,
				parent: parentFile ? this.index.getThread(parentFile)?.id : undefined,
				status: row.thread.status,
				title: row.thread.title,
			};
		});
	}

	private renderMindMap(parent: HTMLElement, tree: ThreadOverviewNode[]): void {
		const rowById = new Map(this.rows.map((row) => [row.thread.id, row]));
		const scroll = parent.createDiv({ cls: 'thread-journal-overview-map-scroll' });
		const standalone = parent.hasClass('thread-journal-overview-view');
		const stage = standalone
			? scroll.createDiv({ cls: 'thread-journal-overview-map-stage' })
			: undefined;
		const map = (stage ?? scroll).createDiv({ cls: 'thread-journal-overview-map' });
		this.scrollEl = scroll;
		this.stageEl = stage;
		this.mapEl = map;
		if (stage) {
			this.viewportWidth = scroll.clientWidth;
			this.viewportHeight = scroll.clientHeight;
			scroll.addEventListener('scroll', this.onMapScroll);
			scroll.addEventListener('wheel', this.onMapWheel, { passive: false });
		}
		if (standalone) map.style.transform = `scale(${this.zoom})`;
		const svg = createSvg('svg');
		svg.classList.add('thread-journal-overview-connectors');
		svg.setAttribute('aria-hidden', 'true');
		map.appendChild(svg);
		this.connectorSvg = svg;

		const layout = map.createDiv({ cls: 'thread-journal-overview-map-layout' });
		const root = layout.createDiv({ cls: 'thread-journal-overview-map-root' });
		setIcon(root.createSpan(), 'git-branch');
		root.createSpan({ text: t('Threads') });
		const roots = layout.createDiv({ cls: 'thread-journal-overview-map-children' });
		for (const node of tree) {
			const child = this.renderBranch(roots, node, rowById);
			if (child) this.edges.push({ from: root, to: child, status: node.item.status });
		}

		this.resizeObserver = new ResizeObserver((entries) => {
			const viewportChanged = entries.some((entry) => entry.target === scroll);
			if (viewportChanged) {
				this.viewportWidth = scroll.clientWidth;
				this.viewportHeight = scroll.clientHeight;
			}
			this.updateMapStage();
			if (viewportChanged) this.restoreMapViewport();
			this.scheduleConnectorDraw();
		});
		this.resizeObserver.observe(layout);
		if (stage) this.resizeObserver.observe(scroll);
		this.updateMapStage();
		if (stage) this.restoreMapViewport();
		else this.centerMap();
		this.scheduleConnectorDraw();
		this.scheduleBranchReveal();
	}

	private renderBranch(
		parent: HTMLElement,
		node: ThreadOverviewNode,
		rowById: ReadonlyMap<string, AttentionRow>,
	): HTMLElement | undefined {
		const row = rowById.get(node.item.id);
		if (!row) return undefined;
		const branch = parent.createDiv({
			cls: 'thread-journal-overview-map-branch',
			attr: { 'data-thread-id': node.item.id },
		});
		this.branchElements.set(node.item.id, branch);
		const shell = branch.createDiv({ cls: 'thread-journal-overview-node-shell' });
		const details = shell.createEl('details', {
			cls: `thread-journal-overview-node${node.contextOnly ? ' is-context-only' : ''}`,
			attr: {
				'data-thread-id': node.item.id,
				'data-status': node.item.status || 'unset',
			},
		});
		details.open = this.expandedNodes.has(node.item.id);
		details.addEventListener('toggle', () => {
			if (details.open) this.expandedNodes.add(node.item.id);
			else this.expandedNodes.delete(node.item.id);
			this.scheduleConnectorDraw();
		});
		this.renderNodeHeader(details, row, node);
		this.renderNodeContent(details, row, node);

		const branchCollapsed = this.collapsedBranches.has(node.item.id);
		if (node.children.length > 0) {
			const descendantCount = countThreadOverviewDescendants(node);
			const toggle = shell.createEl('button', {
				cls: 'clickable-icon thread-journal-overview-branch-toggle',
				attr: {
					type: 'button',
					'data-collapsed': String(branchCollapsed),
					'aria-label': branchCollapsed
						? t('Expand {title} branches ({count} hidden threads)', {
							title: node.item.title,
							count: descendantCount,
						})
						: t('Collapse {title} branches', { title: node.item.title }),
				},
			});
			if (branchCollapsed) toggle.setText(`+${descendantCount}`);
			else setIcon(toggle, 'minus');
			toggle.addEventListener('click', () => {
				if (branchCollapsed) {
					this.collapsedBranches.delete(node.item.id);
					this.pendingBranchReveal = node.item.id;
				} else {
					this.collapsedBranches.add(node.item.id);
				}
				this.render();
			});
		}
		if (node.children.length > 0 && !branchCollapsed) {
			const children = branch.createDiv({ cls: 'thread-journal-overview-map-children' });
			for (const childNode of node.children) {
				const child = this.renderBranch(children, childNode, rowById);
				if (child) {
					this.edges.push({
						from: details,
						to: child,
						status: childNode.item.status,
					});
				}
			}
		}
		return details;
	}

	private renderNodeHeader(
		details: HTMLDetailsElement,
		row: AttentionRow,
		node: ThreadOverviewNode,
	): void {
		const summary = details.createEl('summary', {
			cls: 'thread-journal-overview-node-header',
		});
		summary.createSpan({ cls: 'thread-journal-overview-node-status-dot' });
		const entry = this.index.getEntry(row.thread.file) ?? row.thread.file;
		const link = summary.createEl('a', {
			cls: 'thread-journal-overview-node-title',
			text: row.thread.title,
			href: entry.path,
		});
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.app.workspace.openLinkText(
				entry.path,
				'',
				event.metaKey || event.ctrlKey,
			);
		});
		summary.createSpan({
			cls: 'thread-journal-overview-node-status',
			text: node.item.status || 'unset',
			attr: { title: threadStatusLabel(node.item.status) },
		});
		const visibleTasks = this.tasksForRow(row);
		const attentionCount = visibleTasks.length + row.fallbacks.length;
		if (attentionCount > 0) {
			summary.createSpan({
				cls: 'thread-journal-overview-node-count',
				text: String(attentionCount),
				attr: {
					title: t('{count} attention items', { count: attentionCount }),
				},
			});
		}
	}

	private renderNodeContent(
		details: HTMLDetailsElement,
		row: AttentionRow,
		node: ThreadOverviewNode,
	): void {
		const content = details.createDiv({ cls: 'thread-journal-overview-node-content' });
		if (node.contextOnly) {
			content.createDiv({
				cls: 'thread-journal-overview-context-note',
				text: t('Ancestor retained for hierarchy'),
			});
			return;
		}
		const hint = row.fallbacks.length > 0
			&& row.thread.status === 'active'
			&& row.summary.open === 0
			? ''
			: attentionHint(row.thread.status, row.summary);
		if (hint) {
			content.createEl('p', {
				cls: 'thread-journal-overview-hint',
				text: hint,
			});
		}
		this.renderTasks(content, row);
	}

	private renderTasks(parent: HTMLElement, row: AttentionRow): void {
		const visibleTasks = this.tasksForRow(row);
		const attentionCount = visibleTasks.length + row.fallbacks.length;
		const tasks = parent.createDiv({ cls: 'thread-journal-overview-tasks' });
		tasks.createDiv({
			cls: 'thread-journal-overview-tasks-title',
			text: `${t('Attention')} · ${attentionCount}`,
		});
		if (attentionCount === 0) {
			tasks.createDiv({
				cls: 'thread-journal-empty',
				text: this.taskScope === 'today'
					? t('No attention items today in this thread.')
					: t('No attention items in this thread.'),
			});
			return;
		}
		for (const task of visibleTasks) {
			const item = tasks.createDiv({ cls: 'thread-journal-overview-task' });
			this.renderTaskPinButton(item, task);
			this.renderTaskLink(item, task);
			this.renderTaskDetails(item, task);
			this.renderTaskActions(item, task);
		}
		for (const fallback of row.fallbacks) {
			this.renderFallbackLink(tasks, fallback);
		}
	}

	private renderFallbackLink(parent: HTMLElement, fallback: AttentionRowFallback): void {
		const item = parent.createDiv({
			cls: 'thread-journal-overview-task thread-journal-overview-fallback',
		});
		const meta = item.createDiv({ cls: 'thread-journal-overview-task-meta' });
		setIcon(meta.createSpan({ cls: 'thread-journal-overview-fallback-icon' }), 'file-text');
		meta.createSpan({
			cls: 'thread-journal-overview-task-kind',
			text: fallback.role,
		});
		if (this.index.isEntry(fallback.file)) {
			meta.createSpan({
				cls: 'thread-journal-overview-fallback-entry',
				text: t('Entry'),
			});
		}
		const link = item.createEl('a', {
			text: fallback.file.basename,
			href: fallback.file.path,
		});
		link.addEventListener('click', (event) => {
			event.preventDefault();
			void this.app.workspace.openLinkText(
				fallback.file.path,
				'',
				event.metaKey || event.ctrlKey,
			);
		});
	}

	private renderTaskLink(parent: HTMLElement, task: AttentionRowTask): void {
		const taskLink = parent.createEl('a', {
			text: task.text,
			href: task.file.path,
		});
		taskLink.addEventListener('click', (event) => {
			event.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(task.file, {
				eState: { line: task.line },
			});
		});
	}

	private renderTaskDetails(parent: HTMLElement, task: AttentionRowTask): void {
		const { data } = task;
		const details = parent.createDiv({ cls: 'thread-journal-overview-task-details' });
		const addDetail = (text: string, icon: string, modifier = ''): void => {
			const detail = details.createSpan({
				cls: `thread-journal-overview-task-detail${modifier ? ` is-${modifier}` : ''}`,
			});
			setIcon(detail.createSpan({ cls: 'thread-journal-task-chip-icon' }), icon);
			detail.createSpan({ text });
		};
		if (task.disposition !== 'ready') {
			addDetail(
				t(TASK_DISPOSITION_LABELS[task.disposition]),
				'circle-alert',
				`disposition-${task.disposition}`,
			);
		}
		const today = moment().format('YYYY-MM-DD');
		const deadline = taskDeadline(data, today);
		if (deadline) addDetail(deadline.label, 'calendar-clock', deadline.modifier);
		if (data.effort) {
			const label = t(TASK_EFFORT_LABELS[data.effort]);
			const effort = details.createSpan({
				cls: `thread-journal-overview-task-effort is-${data.effort}`,
				attr: { title: label, 'aria-label': label },
			});
			setIcon(effort, 'gauge');
		}
		if (data.repeat) {
			const current = taskCurrentLabel(data.current, today, t('Today'));
			const rule = repeatLabel(data);
			const repeat = details.createSpan({
				cls: 'thread-journal-overview-task-repeat',
				attr: { title: rule },
			});
			const next = repeat.createEl('button', {
				cls: 'clickable-icon thread-journal-task-repeat-next',
				attr: {
					type: 'button',
					'aria-label': `${rule} · ${t('To next')}`,
					title: `${rule} · ${t('To next')}`,
				},
			});
			setIcon(next, 'repeat-2');
			if (current) repeat.createSpan({ text: current });
			next.addEventListener('click', () => {
				next.disabled = true;
				void moveAttentionTaskToNext(this.app, task)
					.then(() => this.refresh())
					.catch((error: unknown) => {
						next.disabled = false;
						console.error('Thread Journal failed to move task to next occurrence', error);
						new Notice(t('Failed to move task to next: {error}', { error: String(error) }));
					});
			});
		}
		if (!details.hasChildNodes()) details.remove();
	}

	private renderTaskActions(parent: HTMLElement, task: AttentionRowTask): void {
		const actions = parent.createDiv({ cls: 'thread-journal-overview-task-actions' });
		const edit = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-overview-task-edit',
			attr: { type: 'button', 'aria-label': t('Edit task'), title: t('Edit task') },
		});
		setIcon(edit, 'pencil');
		edit.addEventListener('click', () => {
			this.taskManager.openFileTaskEdit(
				task.file,
				task.line,
				task.sourceLine,
				task.data,
				() => void this.refresh(),
			);
		});
	}

	private renderTaskPinButton(parent: HTMLElement, task: AttentionRowTask): void {
		const button = parent.createEl('button', {
			cls: `clickable-icon thread-journal-overview-task-pin${task.pinned ? ' is-pinned' : ''}`,
			attr: {
				type: 'button',
				'aria-label': task.pinned ? t('Unpin task') : t('Pin task'),
				'aria-pressed': String(task.pinned),
			},
		});
		setIcon(button, task.pinned ? 'pin-off' : 'pin');
		button.addEventListener('click', () => {
			button.disabled = true;
			void setAttentionTaskPinned(this.app, task, !task.pinned)
				.then(() => this.refresh())
				.catch((error: unknown) => {
					button.disabled = false;
					console.error('Thread Journal failed to update pinned task', error);
					new Notice(t('Failed to update pinned task: {error}', { error: String(error) }));
				});
		});
	}

	private scheduleConnectorDraw(): void {
		if (!this.mapEl || !this.connectorSvg) return;
		if (this.connectorFrame !== undefined) window.cancelAnimationFrame(this.connectorFrame);
		this.connectorFrame = window.requestAnimationFrame(() => {
			this.connectorFrame = undefined;
			this.drawConnectors();
		});
	}

	private drawConnectors(): void {
		const map = this.mapEl;
		const svg = this.connectorSvg;
		if (!map || !svg || !map.isConnected) return;
		const mapRect = map.getBoundingClientRect();
		const scale = this.stageEl ? this.zoom : 1;
		const width = Math.max(map.scrollWidth, Math.ceil(mapRect.width / scale));
		const height = Math.max(map.scrollHeight, Math.ceil(mapRect.height / scale));
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		svg.replaceChildren();
		for (const edge of this.edges) {
			if (!edge.from.isConnected || !edge.to.isConnected) continue;
			const from = edge.from.getBoundingClientRect();
			const to = edge.to.getBoundingClientRect();
			const startX = (from.right - mapRect.left) / scale;
			const startY = (from.top + from.height / 2 - mapRect.top) / scale;
			const endX = (to.left - mapRect.left) / scale;
			const endY = (to.top + to.height / 2 - mapRect.top) / scale;
			const controlX = startX + Math.max(24, (endX - startX) / 2);
			const path = createSvg('path');
			path.classList.add('thread-journal-overview-connector');
			path.setAttribute('data-status', edge.status || 'unset');
			path.setAttribute(
				'd',
				`M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
			);
			svg.appendChild(path);
		}
	}

	private scheduleBranchReveal(): void {
		if (!this.pendingBranchReveal) return;
		if (this.revealFrame !== undefined) window.cancelAnimationFrame(this.revealFrame);
		this.revealFrame = window.requestAnimationFrame(() => {
			this.revealFrame = undefined;
			const threadId = this.pendingBranchReveal;
			this.pendingBranchReveal = undefined;
			if (threadId) this.revealBranch(threadId);
		});
	}

	private revealBranch(threadId: string): void {
		const branch = this.branchElements.get(threadId);
		const scroll = branch?.closest<HTMLElement>('.thread-journal-overview-map-scroll');
		if (!branch?.isConnected || !scroll) return;
		const branchRect = branch.getBoundingClientRect();
		const scrollRect = scroll.getBoundingClientRect();
		const branchLeft = branchRect.left - scrollRect.left + scroll.scrollLeft;
		const branchTop = branchRect.top - scrollRect.top + scroll.scrollTop;
		const padding = 24;
		const desiredLeft = branchRect.width + padding * 2 <= scroll.clientWidth
			? branchLeft - (scroll.clientWidth - branchRect.width) / 2
			: branchLeft - padding;
		const desiredTop = branchRect.height + padding * 2 <= scroll.clientHeight
			? branchTop - (scroll.clientHeight - branchRect.height) / 2
			: branchTop - padding;
		const maxLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
		const maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
		scroll.scrollTo({
			left: Math.max(0, Math.min(desiredLeft, maxLeft)),
			top: Math.max(0, Math.min(desiredTop, maxTop)),
			behavior: 'smooth',
		});
	}

	private teardownMap(): void {
		this.captureMapViewport();
		this.scrollEl?.removeEventListener('scroll', this.onMapScroll);
		this.scrollEl?.removeEventListener('wheel', this.onMapWheel);
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.connectorFrame !== undefined) window.cancelAnimationFrame(this.connectorFrame);
		this.connectorFrame = undefined;
		if (this.revealFrame !== undefined) window.cancelAnimationFrame(this.revealFrame);
		this.revealFrame = undefined;
		this.scrollEl = undefined;
		this.viewportWidth = 0;
		this.viewportHeight = 0;
		this.stageEl = undefined;
		this.mapEl = undefined;
		this.connectorSvg = undefined;
		this.edges = [];
		this.branchElements.clear();
	}
}

export class ThreadOverviewView extends ItemView {
	private content?: OverviewContent;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly index: ThreadIndex,
		private readonly taskManager: TaskManager,
	) {
		super(leaf);
	}

	getViewType(): string {
		return THREAD_OVERVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('Thread overview');
	}

	getIcon(): string {
		return 'git-branch';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('thread-journal-overview-view');
		this.content = new OverviewContent(this.contentEl, this.app, this.index, this.taskManager);
		this.content.load();
	}

	async onClose(): Promise<void> {
		this.content?.unload();
		this.content = undefined;
		this.contentEl.empty();
		this.contentEl.removeClass('thread-journal-overview-view');
	}
}

export async function openThreadOverview(app: App): Promise<void> {
	try {
		let leaf = app.workspace.getLeavesOfType(THREAD_OVERVIEW_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = app.workspace.getLeaf('tab');
			await leaf.setViewState({
				type: THREAD_OVERVIEW_VIEW_TYPE,
				active: true,
			});
		}
		await app.workspace.revealLeaf(leaf);
		app.workspace.setActiveLeaf(leaf, { focus: true });
	} catch (error) {
		console.error('Thread Journal failed to open thread overview', error);
		new Notice(t('Failed to open thread overview: {error}', { error: String(error) }));
	}
}

export function renderThreadOverview(
	app: App,
	index: ThreadIndex,
	taskManager: TaskManager,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	ctx.addChild(new OverviewContent(el, app, index, taskManager));
}
