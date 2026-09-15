import {
	App,
	ItemView,
	MarkdownRenderChild,
	Notice,
	setIcon,
	type MarkdownPostProcessorContext,
	type WorkspaceLeaf,
} from 'obsidian';
import { collectAttention, type AttentionRow } from './thread-attention';
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
	type ThreadOverviewNode,
} from './thread-overview-model';
import {
	clampMapZoom,
	fitMapZoom,
	MAP_ZOOM_STEP,
	mapStageGeometry,
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

export const THREAD_OVERVIEW_VIEW_TYPE = 'thread-journal-overview';

interface MindMapEdge {
	from: HTMLElement;
	to: HTMLElement;
	status: string;
}

class OverviewContent extends MarkdownRenderChild {
	private readonly selectedStatuses = new Set<string>(DEFAULT_THREAD_OVERVIEW_STATUSES);
	private readonly expandedNodes = new Set<string>();
	private readonly collapsedBranches = new Set<string>();
	private taskScope: TaskScope = 'today';
	private filterOpen = false;
	private rows: AttentionRow[] = [];
	private request = 0;
	private timer: number | undefined;
	private zoom = 1;
	private zoomValueEl?: HTMLElement;
	private scrollEl?: HTMLElement;
	private stageEl?: HTMLElement;
	private mapEl?: HTMLElement;
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
		const tree = buildThreadOverviewTree(this.overviewItems(), this.selectedStatuses);
		this.renderToolbar(el, tree);
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
				text: t('No threads match the selected statuses.'),
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
			text: allTasksExpanded ? t('Collapse tasks') : t('Expand all tasks'),
			attr: {
				type: 'button',
				'aria-label': allTasksExpanded
					? t('Collapse all task lists')
					: t('Expand all task lists'),
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

	private changeZoom(value: number, centerMap = false): void {
		const map = this.mapEl;
		const scroll = this.scrollEl;
		if (!map || !scroll || !this.stageEl) return;
		const nextZoom = clampMapZoom(value);
		const logicalCenterX = (scroll.scrollLeft + scroll.clientWidth / 2 - map.offsetLeft)
			/ this.zoom;
		const logicalCenterY = (scroll.scrollTop + scroll.clientHeight / 2 - map.offsetTop)
			/ this.zoom;
		this.zoom = nextZoom;
		map.style.transform = `scale(${this.zoom})`;
		this.updateMapStage();
		this.zoomValueEl?.setText(`${Math.round(this.zoom * 100)}%`);
		if (centerMap) {
			this.centerMap();
		} else {
			scroll.scrollLeft = map.offsetLeft + logicalCenterX * this.zoom
				- scroll.clientWidth / 2;
			scroll.scrollTop = map.offsetTop + logicalCenterY * this.zoom
				- scroll.clientHeight / 2;
		}
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
				!node.contextOnly && row && this.tasksForRow(row).length > 0,
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

		this.resizeObserver = new ResizeObserver(() => {
			this.updateMapStage();
			this.scheduleConnectorDraw();
		});
		this.resizeObserver.observe(layout);
		if (stage) this.resizeObserver.observe(scroll);
		this.updateMapStage();
		this.centerMap();
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
		if (visibleTasks.length > 0) {
			summary.createSpan({
				cls: 'thread-journal-overview-node-count',
				text: String(visibleTasks.length),
				attr: {
					title: this.taskScope === 'today'
						? t('{count} active tasks today', { count: visibleTasks.length })
						: t('{count} unfinished tasks', { count: visibleTasks.length }),
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
		const hint = attentionHint(row.thread.status, row.summary);
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
		const tasks = parent.createDiv({ cls: 'thread-journal-overview-tasks' });
		tasks.createDiv({
			cls: 'thread-journal-overview-tasks-title',
			text: `${this.taskScope === 'today' ? t('Active today') : t('All unfinished')} · ${visibleTasks.length}`,
		});
		if (visibleTasks.length === 0) {
			tasks.createDiv({
				cls: 'thread-journal-empty',
				text: this.taskScope === 'today'
					? t('No active tasks today in this thread.')
					: t('No unfinished tasks in this thread.'),
			});
			return;
		}
		for (const task of visibleTasks) {
			const item = tasks.createDiv({ cls: 'thread-journal-overview-task' });
			const meta = item.createDiv({ cls: 'thread-journal-overview-task-meta' });
			meta.createSpan({
				cls: 'thread-journal-overview-task-kind',
				text: t(TASK_DISPOSITION_LABELS[task.disposition]),
				attr: { 'data-disposition': task.disposition },
			});
			const taskLink = item.createEl('a', {
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
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.connectorFrame !== undefined) window.cancelAnimationFrame(this.connectorFrame);
		this.connectorFrame = undefined;
		if (this.revealFrame !== undefined) window.cancelAnimationFrame(this.revealFrame);
		this.revealFrame = undefined;
		this.scrollEl = undefined;
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
		this.content = new OverviewContent(this.contentEl, this.app, this.index);
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
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	ctx.addChild(new OverviewContent(el, app, index));
}
