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
import { attentionHint, type TodoDisposition } from './thread-attention-model';
import type { ThreadIndex } from './thread-index';
import {
	buildThreadOverviewTree,
	countThreadOverviewDescendants,
	DEFAULT_THREAD_OVERVIEW_STATUSES,
	type ThreadOverviewNode,
} from './thread-overview-model';
import {
	THREAD_STATUS_CHOICES,
	threadStatusLabel,
} from './thread-status-model';

const TASK_DISPOSITION_LABELS: Record<TodoDisposition, string> = {
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
	private filterOpen = false;
	private rows: AttentionRow[] = [];
	private request = 0;
	private timer: number | undefined;
	private mapEl?: HTMLElement;
	private connectorSvg?: SVGSVGElement;
	private resizeObserver?: ResizeObserver;
	private connectorFrame?: number;
	private edges: MindMapEdge[] = [];

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
			text: 'Loading thread map…',
		});
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		this.registerDomEvent(window, 'resize', () => this.scheduleConnectorDraw());
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
				text: `无法读取 thread 总览：${String(error)}`,
			});
		}
	}

	private render(): void {
		this.teardownMap();
		const el = this.containerEl;
		el.empty();
		this.renderToolbar(el);
		const tree = buildThreadOverviewTree(this.overviewItems(), this.selectedStatuses);
		if (this.selectedStatuses.size === 0) {
			el.createEl('p', {
				cls: 'thread-journal-empty',
				text: '请选择至少一个状态。',
			});
			return;
		}
		if (tree.length === 0) {
			el.createEl('p', {
				cls: 'thread-journal-empty',
				text: '所选状态下没有 thread。',
			});
			return;
		}
		this.renderMindMap(el, tree);
	}

	private renderToolbar(parent: HTMLElement): void {
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
			attr: { 'aria-label': 'Select thread statuses' },
		});
		setIcon(filterSummary.createSpan(), 'list-filter');
		filterSummary.createSpan({ text: `Status · ${this.selectedStatuses.size}` });
		const filterPanel = filters.createDiv({
			cls: 'thread-journal-overview-filter-panel',
			attr: { role: 'group', 'aria-label': 'Thread status filters' },
		});
		for (const choice of THREAD_STATUS_CHOICES) {
			const selected = this.selectedStatuses.has(choice.value);
			const option = filterPanel.createEl('label', {
				cls: 'thread-journal-overview-filter-option',
				attr: { title: choice.description },
			});
			const checkbox = option.createEl('input', { type: 'checkbox' });
			checkbox.checked = selected;
			option.createSpan({ text: `${choice.value} — ${choice.label}` });
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
		const refreshButton = toolbar.createEl('button', {
			cls: 'clickable-icon thread-journal-overview-refresh',
			attr: { type: 'button', 'aria-label': 'Refresh thread overview' },
		});
		setIcon(refreshButton, 'refresh-cw');
		refreshButton.addEventListener('click', () => void this.refresh());
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
		const map = scroll.createDiv({ cls: 'thread-journal-overview-map' });
		this.mapEl = map;
		const svg = createSvg('svg');
		svg.classList.add('thread-journal-overview-connectors');
		svg.setAttribute('aria-hidden', 'true');
		map.appendChild(svg);
		this.connectorSvg = svg;

		const layout = map.createDiv({ cls: 'thread-journal-overview-map-layout' });
		const root = layout.createDiv({ cls: 'thread-journal-overview-map-root' });
		setIcon(root.createSpan(), 'git-branch');
		root.createSpan({ text: 'Threads' });
		const roots = layout.createDiv({ cls: 'thread-journal-overview-map-children' });
		for (const node of tree) {
			const child = this.renderBranch(roots, node, rowById);
			if (child) this.edges.push({ from: root, to: child, status: node.item.status });
		}

		this.resizeObserver = new ResizeObserver(() => this.scheduleConnectorDraw());
		this.resizeObserver.observe(layout);
		this.scheduleConnectorDraw();
	}

	private renderBranch(
		parent: HTMLElement,
		node: ThreadOverviewNode,
		rowById: ReadonlyMap<string, AttentionRow>,
	): HTMLElement | undefined {
		const row = rowById.get(node.item.id);
		if (!row) return undefined;
		const branch = parent.createDiv({ cls: 'thread-journal-overview-map-branch' });
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
						? `Expand ${node.item.title} branches (${descendantCount} hidden threads)`
						: `Collapse ${node.item.title} branches`,
				},
			});
			if (branchCollapsed) toggle.setText(`+${descendantCount}`);
			else setIcon(toggle, 'minus');
			toggle.addEventListener('click', () => {
				if (branchCollapsed) this.collapsedBranches.delete(node.item.id);
				else this.collapsedBranches.add(node.item.id);
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
		if (row.tasks.length > 0) {
			summary.createSpan({
				cls: 'thread-journal-overview-node-count',
				text: String(row.tasks.length),
				attr: { title: `${row.tasks.length} unfinished tasks` },
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
				text: 'Ancestor retained for hierarchy',
			});
			return;
		}
		content.createEl('p', {
			cls: 'thread-journal-overview-hint',
			text: attentionHint(row.thread.status, row.summary),
		});
		if (this.index.getDirectChildren(row.thread.file).length > 0) {
			this.renderMetrics(content, row);
		}
		this.renderTasks(content, row);
	}

	private renderMetrics(parent: HTMLElement, row: AttentionRow): void {
		const metrics = parent.createDiv({ cls: 'thread-journal-overview-metrics' });
		const values: [string, number][] = [
			['open', row.summary.open],
			['ready', row.summary.ready],
			['future', row.summary.future],
			['waiting', row.summary.waiting],
			['candidate', row.summary.candidate],
			['suspended', row.summary.suspended],
		];
		if (row.summary.unknown > 0) values.push(['other', row.summary.unknown]);
		for (const [label, value] of values) {
			const metric = metrics.createSpan({ cls: 'thread-journal-overview-metric' });
			metric.createSpan({ text: label });
			metric.createEl('strong', { text: String(value) });
		}
	}

	private renderTasks(parent: HTMLElement, row: AttentionRow): void {
		const tasks = parent.createDiv({ cls: 'thread-journal-overview-tasks' });
		tasks.createDiv({
			cls: 'thread-journal-overview-tasks-title',
			text: `Tasks · ${row.tasks.length}`,
		});
		if (row.tasks.length === 0) {
			tasks.createDiv({ cls: 'thread-journal-empty', text: 'No unfinished tasks in this thread.' });
			return;
		}
		for (const task of row.tasks) {
			const item = tasks.createDiv({ cls: 'thread-journal-overview-task' });
			const meta = item.createDiv({ cls: 'thread-journal-overview-task-meta' });
			meta.createSpan({
				cls: 'thread-journal-overview-task-kind',
				text: TASK_DISPOSITION_LABELS[task.disposition],
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
		const width = Math.max(map.scrollWidth, Math.ceil(mapRect.width));
		const height = Math.max(map.scrollHeight, Math.ceil(mapRect.height));
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		svg.replaceChildren();
		for (const edge of this.edges) {
			if (!edge.from.isConnected || !edge.to.isConnected) continue;
			const from = edge.from.getBoundingClientRect();
			const to = edge.to.getBoundingClientRect();
			const startX = from.right - mapRect.left;
			const startY = from.top + from.height / 2 - mapRect.top;
			const endX = to.left - mapRect.left;
			const endY = to.top + to.height / 2 - mapRect.top;
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

	private teardownMap(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.connectorFrame !== undefined) window.cancelAnimationFrame(this.connectorFrame);
		this.connectorFrame = undefined;
		this.mapEl = undefined;
		this.connectorSvg = undefined;
		this.edges = [];
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
		return 'Thread overview';
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
		new Notice(`无法打开 Thread overview：${String(error)}`);
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
