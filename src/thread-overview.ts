import {
	App,
	MarkdownRenderChild,
	Modal,
	setIcon,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import { collectAttention, type AttentionRow } from './thread-attention';
import { attentionHint, type TodoDisposition } from './thread-attention-model';
import type { ThreadIndex } from './thread-index';
import {
	buildThreadOverviewTree,
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

class OverviewContent extends MarkdownRenderChild {
	private readonly selectedStatuses = new Set<string>(DEFAULT_THREAD_OVERVIEW_STATUSES);
	private readonly expanded = new Set<string>();
	private readonly collapsed = new Set<string>();
	private rows: AttentionRow[] = [];
	private request = 0;
	private timer: number | undefined;

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
			text: 'Loading thread tree…',
		});
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		this.registerInterval(window.setInterval(() => this.scheduleRefresh(), 60000));
		void this.refresh();
	}

	onunload(): void {
		this.request += 1;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
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
			this.containerEl.empty();
			this.containerEl.createEl('p', {
				text: `无法读取 thread 总览：${String(error)}`,
			});
		}
	}

	private render(): void {
		const el = this.containerEl;
		el.empty();
		const header = el.createDiv({ cls: 'thread-journal-overview-header' });
		const heading = header.createDiv({ cls: 'thread-journal-overview-heading' });
		heading.createEl('h3', { text: 'Thread overview' });
		heading.createEl('p', {
			text: '展开节点查看子树统计和直属 tasks；淡色节点仅用于保留筛选结果的真实层级。',
		});
		const refreshButton = header.createEl('button', {
			cls: 'clickable-icon',
			attr: { type: 'button', 'aria-label': 'Refresh thread overview' },
		});
		setIcon(refreshButton, 'refresh-cw');
		refreshButton.addEventListener('click', () => void this.refresh());

		const counts = new Map<string, number>();
		for (const row of this.rows) {
			counts.set(row.thread.status, (counts.get(row.thread.status) ?? 0) + 1);
		}
		const filters = el.createDiv({
			cls: 'thread-journal-overview-filters',
			attr: { role: 'group', 'aria-label': 'Thread status filters' },
		});
		filters.createSpan({ cls: 'thread-journal-overview-filter-label', text: 'Status' });
		for (const choice of THREAD_STATUS_CHOICES) {
			const selected = this.selectedStatuses.has(choice.value);
			const button = filters.createEl('button', {
				cls: 'thread-journal-overview-filter',
				text: `${choice.value} ${counts.get(choice.value) ?? 0}`,
				attr: {
					type: 'button',
					'aria-pressed': String(selected),
					'aria-label': `${choice.value} — ${choice.label}: ${choice.description}`,
					'data-status': choice.value,
				},
			});
			button.toggleClass('is-selected', selected);
			button.addEventListener('click', () => {
				if (selected) this.selectedStatuses.delete(choice.value);
				else this.selectedStatuses.add(choice.value);
				this.render();
			});
		}

		const items = this.rows.map((row) => {
			const parentFile = this.index.getParentFile(row.thread.file);
			return {
				id: row.thread.id,
				parent: parentFile ? this.index.getThread(parentFile)?.id : undefined,
				status: row.thread.status,
				title: row.thread.title,
			};
		});
		const tree = buildThreadOverviewTree(items, this.selectedStatuses);
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
		const rowById = new Map(this.rows.map((row) => [row.thread.id, row]));
		const treeEl = el.createDiv({ cls: 'thread-journal-overview-tree' });
		for (const node of tree) this.renderNode(treeEl, node, rowById, 0);
	}

	private renderNode(
		parent: HTMLElement,
		node: ThreadOverviewNode,
		rowById: ReadonlyMap<string, AttentionRow>,
		depth: number,
	): void {
		const row = rowById.get(node.item.id);
		if (!row) return;
		const details = parent.createEl('details', {
			cls: `thread-journal-overview-node${node.contextOnly ? ' is-context-only' : ''}`,
			attr: {
				'data-thread-id': node.item.id,
				'data-status': node.item.status || 'unset',
			},
		});
		const defaultOpen = depth === 0 || node.contextOnly;
		details.open = this.expanded.has(node.item.id)
			|| (defaultOpen && !this.collapsed.has(node.item.id));
		details.addEventListener('toggle', () => {
			if (details.open) {
				this.expanded.add(node.item.id);
				this.collapsed.delete(node.item.id);
			} else {
				this.expanded.delete(node.item.id);
				this.collapsed.add(node.item.id);
			}
		});

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
				text: `${row.tasks.length} tasks`,
			});
		}
		if (node.children.length > 0) {
			summary.createSpan({
				cls: 'thread-journal-overview-node-count',
				text: `${node.children.length} branches`,
			});
		}

		const content = details.createDiv({ cls: 'thread-journal-overview-node-content' });
		if (node.contextOnly) {
			content.createDiv({
				cls: 'thread-journal-overview-context-note',
				text: 'Ancestor retained for hierarchy',
			});
		} else {
			content.createEl('p', {
				cls: 'thread-journal-overview-hint',
				text: attentionHint(row.thread.status, row.summary),
			});
			this.renderMetrics(content, row);
			this.renderTasks(content, row);
		}
		if (node.children.length > 0) {
			const children = content.createDiv({ cls: 'thread-journal-overview-children' });
			for (const child of node.children) {
				this.renderNode(children, child, rowById, depth + 1);
			}
		}
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
			item.createSpan({
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
			item.createSpan({
				cls: 'thread-journal-overview-task-source',
				text: task.file.basename,
			});
		}
	}
}

export function openThreadOverview(app: App, index: ThreadIndex): void {
	class OverviewModal extends Modal {
		private view?: OverviewContent;

		onOpen(): void {
			this.modalEl.addClass('thread-journal-overview-modal');
			this.view = new OverviewContent(this.contentEl, app, index);
			this.view.load();
		}

		onClose(): void {
			this.view?.unload();
			this.contentEl.empty();
		}
	}
	new OverviewModal(app).open();
}

export function renderThreadOverview(
	app: App,
	index: ThreadIndex,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	ctx.addChild(new OverviewContent(el, app, index));
}
