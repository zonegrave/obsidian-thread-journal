import { App, ItemView, Notice, moment, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import type { TaskManager } from './task';
import { LANGUAGE_CHANGE_EVENT, t } from './i18n';
import { ROOT_THREAD_ID } from './thread-root-model';
import { filterThreadTable, tableFiltersFromState, tableHasConditions, DEFAULT_TABLE_FILTERS } from './thread-table-filter-model';
import { renderTreeFilters, type TableFilterUI } from './thread-table-header';
import { createThreadTree } from './thread-table-grid';
import { renderTableRootBreadcrumb } from './thread-table-breadcrumb';
import { totalThreadTable } from './thread-table-total-model';
import { flattenThreadTableTree } from './thread-table-model';
import { collectThreadTable, type ThreadTableRow } from './thread-table-data';
import { renderTableThreadRow, renderTableFileRows, renderTableTotalRow, type TableSelection } from './thread-table-rows';
import { renderTreeFileTasks } from './thread-tree-tasks';
import { renderTableTaskDetails } from './thread-table-details';
import { THREAD_TABLE_COLUMNS, type ThreadTableColumn } from './thread-table-columns';

export const THREAD_TABLE_VIEW_TYPE = 'thread-journal-overview-table';

export class ThreadTableView extends ItemView {
	private filters = { ...DEFAULT_TABLE_FILTERS };
	private filterUI: TableFilterUI = {};
	private disposeHeader?: () => void;
	private filterCollapsed = new Set<string>();
	private filterFilesCollapsed = new Set<string>();
	private rows: ThreadTableRow[] = [];
	private expandedTasks = new Set<string>();
	private expandedFiles = new Set<string>();
	private selection?: TableSelection;
	private collapsed = new Set<string>();
	private fields = new Set<ThreadTableColumn>(THREAD_TABLE_COLUMNS.map(column => column.key));
	private timer?: number;
	private request = 0;
	private opened = false;
	private fieldsOpen = false;

	constructor(leaf: WorkspaceLeaf, private readonly index: ThreadIndex, private readonly taskManager: TaskManager) {
		super(leaf);
	}

	getViewType(): string { return THREAD_TABLE_VIEW_TYPE; }
	getDisplayText(): string { return t('Thread explorer'); }
	getIcon(): string { return 'list-tree'; }

	getState(): Record<string, unknown> {
		return { filters: this.filters, expandedTasks: [...this.expandedTasks], expandedFiles: [...this.expandedFiles], collapsed: [...this.collapsed], fields: [...this.fields] };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		if (typeof state === 'object' && state !== null) {
			const value = state as Record<string, unknown>;
			this.filters = tableFiltersFromState(value.filters);
			if (Array.isArray(value.expandedTasks)) this.expandedTasks = new Set(value.expandedTasks.filter((id): id is string => typeof id === 'string'));
			if (Array.isArray(value.expandedFiles)) this.expandedFiles = new Set(value.expandedFiles.filter((id): id is string => typeof id === 'string'));
			if (Array.isArray(value.collapsed)) this.collapsed = new Set(value.collapsed.filter((id): id is string => typeof id === 'string'));
			if (Array.isArray(value.fields) && value.fields.every(key => THREAD_TABLE_COLUMNS.some(column => column.key === key))) this.fields = new Set(THREAD_TABLE_COLUMNS.filter(column =>
				(value.fields as unknown[]).includes(column.key)).map(column => column.key));
		}
		if (this.opened) this.render();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass('thread-journal-table-view', 'thread-journal-explorer');
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		this.registerInterval(window.setInterval(() => this.scheduleRefresh(), 60000));
		const languageChanged = (): void => this.render();
		window.addEventListener(LANGUAGE_CHANGE_EVENT, languageChanged);
		this.register(() => window.removeEventListener(LANGUAGE_CHANGE_EVENT, languageChanged));
		this.contentEl.createDiv({ cls: 'thread-journal-empty', text: t('Loading thread tree…') });
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.disposeHeader?.();
		this.request++;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.contentEl.empty();
		this.contentEl.removeClass('thread-journal-table-view', 'thread-journal-explorer');
	}

	private scheduleRefresh(): void {
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => { void this.refresh(); }, 350);
	}

	private async refresh(): Promise<void> {
		const request = ++this.request;
		try {
			const rows = await collectThreadTable(this.app, this.index, moment().format('YYYY-MM-DDTHH:mm'));
			if (!this.opened || request !== this.request) return;
			this.rows = rows;
			if (this.filters.root && !rows.some(row => row.thread.id === this.filters.root)) this.filters.root = '';
			if (this.selection?.threadId) {
				const selected = rows.find(row => row.thread.id === this.selection?.threadId);
				if (!selected || (this.selection.filePath && !selected.files.some(file => file.member.file.path === this.selection?.filePath))) this.selection = undefined;
			}
			this.render();
		} catch (error) {
			if (!this.opened || request !== this.request) return;
			const message = t('Failed to read thread explorer: {error}', { error: String(error) });
			if (!this.rows.length) {
				this.contentEl.empty();
				this.contentEl.createDiv({ cls: 'thread-journal-empty', text: message });
			}
			new Notice(message);
		}
	}

	private saveLayout(): void { void this.app.workspace.requestSaveLayout(); }

	private render(): void {
		const oldScroll = this.contentEl.querySelector('.thread-journal-table-scroll');
		const scrollTop = oldScroll?.scrollTop ?? 0;
		const scrollLeft = oldScroll?.scrollLeft ?? 0;
		const detailScroll = this.contentEl.querySelector('.thread-journal-table-details-list')?.scrollTop ?? 0;
		const active = this.contentEl.ownerDocument.activeElement;
		const focus = active instanceof HTMLInputElement && this.contentEl.contains(active) ? {
			key: active.getAttribute('data-table-filter'), start: active.selectionStart, end: active.selectionEnd,
		} : undefined;
		this.disposeHeader?.();
		this.contentEl.empty();
		const projection = filterThreadTable(this.rows, this.filters, moment().format('YYYY-MM-DDTHH:mm'));
		const tree = projection.tree;
		const matchingIds = new Set(projection.matchedRows.map(row => row.thread.id));
		const searching = tableHasConditions(this.filters);
		const effectiveCollapsed = searching ? this.filterCollapsed : new Set(this.collapsed);
		const visible = flattenThreadTableTree(tree, effectiveCollapsed);
		if (this.selection?.threadId && !matchingIds.has(this.selection.threadId)) this.selection = undefined;
		if (this.selection?.threadId && this.selection.filePath) {
			const files = projection.fileMatches.get(this.selection.threadId);
			if (files && !files.has(this.selection.filePath)) this.selection = undefined;
		}
		const byId = new Map([...this.rows, ...projection.matchedRows].map(row => [row.thread.id, row]));
		const main = this.contentEl.createDiv({ cls: 'thread-journal-table-main' });
		const columns = THREAD_TABLE_COLUMNS.filter(column => this.fields.has(column.key));
		const grid = createThreadTree(main);
		const { scroll, body } = grid;
		for (const item of visible) {
			const data = byId.get(item.node.item.id);
			if (!data) continue;
			const context = {
				contextOnly: item.node.contextOnly, app: this.app, columns: columns.map(column => column.key), selection: this.selection,
				filesExpanded: !item.node.contextOnly && (projection.fileMatches.has(data.thread.id) ? !this.filterFilesCollapsed.has(data.thread.id) : this.expandedFiles.has(data.thread.id)), childrenCollapsed: effectiveCollapsed.has(data.thread.id),
				focus: () => this.focusThread(data.thread.id === ROOT_THREAD_ID ? '' : data.thread.id),
				toggleChildren: () => this.toggle(data.thread.id),
				toggleFiles: () => this.toggleFiles(data.thread.id),
				select: (selection: TableSelection) => this.select(selection),
				tasksExpanded: (filePath: string) => this.expandedTasks.has(`${data.thread.id}:${filePath}`),
				toggleTasks: (filePath: string) => {
					const key = `${data.thread.id}:${filePath}`;
					if (this.expandedTasks.has(key)) this.expandedTasks.delete(key); else this.expandedTasks.add(key);
					this.render(); this.saveLayout();
				},
				renderTasks: (parent: HTMLElement, filePath: string, fileItem: Pick<typeof item, 'guides' | 'ancestors' | 'depth' | 'last'>) => renderTreeFileTasks(parent, data, filePath, fileItem, { app: this.app, taskManager: this.taskManager, onRefresh: () => this.refresh() }),
			};
			const files = projection.fileMatches.get(data.thread.id);
			const display = files ? { ...data, files: data.files.filter(file => files.has(file.member.file.path)) } : data;
			renderTableThreadRow(body, item, { ...data, counts: { ...data.counts, files: this.filters.fileStatuses === null ? data.counts.files : data.files.filter(file => this.filters.fileStatuses!.includes(file.member.roleStatus)).length } }, context);
			if (context.filesExpanded) {
				renderTableFileRows(body, item, display, context);
			}
		}
		if (!visible.length) body.createDiv({ cls: 'thread-journal-empty', text: t('No threads match the filters.') });
		renderTableTotalRow(grid.total, totalThreadTable(projection.matchedRows, moment().format('YYYY-MM-DDTHH:mm')), columns.map(column => column.key), selection => this.select(selection));
		if (this.selection) renderTableTaskDetails(main, projection.matchedRows, this.selection, {
			app: this.app, taskManager: this.taskManager,
			onClose: () => { this.selection = undefined; this.render(); },
			onRefresh: () => this.refresh(),
		});
		this.renderFooter(flattenThreadTableTree(tree, new Set()).filter(item => item.node.children.length).map(item => item.node.item.id));
		scroll.scrollTop = scrollTop;
		scroll.scrollLeft = scrollLeft;
		const details = this.contentEl.querySelector('.thread-journal-table-details-list');
		if (details) details.scrollTop = detailScroll;
		if (focus?.key) {
			const input = this.contentEl.querySelector<HTMLInputElement>(`input[data-table-filter="${focus.key}"]`);
			input?.focus();
			if (input && focus.start !== null && focus.end !== null) input.setSelectionRange(focus.start, focus.end);
		}
	}

	private focusThread(root: string): void {
		this.selection = undefined;
		const scroll = this.contentEl.querySelector('.thread-journal-table-scroll');
		if (scroll) scroll.scrollTop = 0;
		this.changeFilters({ ...this.filters, root });
	}

	private changeFilters(filters: typeof this.filters): void {
		this.filters = filters;
		this.filterCollapsed.clear(); this.filterFilesCollapsed.clear();
		this.render(); this.saveLayout();
	}

	private select(selection: TableSelection): void {
		this.selection = selection;
		const list = this.contentEl.querySelector('.thread-journal-table-details-list');
		if (list) list.scrollTop = 0;
		this.render();
	}

	private toggle(id: string): void {
		const collapsed = tableHasConditions(this.filters) ? this.filterCollapsed : this.collapsed;
		if (collapsed.has(id)) collapsed.delete(id);
		else collapsed.add(id);
		this.render();
		this.saveLayout();
	}

	private toggleFiles(id: string): void {
		const automatic = filterThreadTable(this.rows, this.filters, moment().format('YYYY-MM-DDTHH:mm')).fileMatches.has(id);
		if (automatic) {
			if (this.filterFilesCollapsed.has(id)) this.filterFilesCollapsed.delete(id);
			else this.filterFilesCollapsed.add(id);
		} else if (this.expandedFiles.has(id)) this.expandedFiles.delete(id);
		else this.expandedFiles.add(id);
		this.render();
		this.saveLayout();
	}

	private renderFooter(branchIds: string[]): void {
		const footer = this.contentEl.createDiv({ cls: 'thread-journal-view-bottom-bar thread-journal-table-footer' });
		this.disposeHeader = renderTreeFilters(footer, this.contentEl, this.rows, this.filters, this.filterUI, filters => this.changeFilters(filters), () => this.render());
		renderTableRootBreadcrumb(footer, this.rows, this.filters.root, root => this.focusThread(root));
		for (const expand of [true, false]) {
			const button = footer.createEl('button', { text: t(expand ? 'Expand all threads' : 'Collapse all threads') });
			button.addEventListener('click', () => {
				if (tableHasConditions(this.filters)) this.filterCollapsed = new Set(expand ? [] : branchIds);
				else this.collapsed = new Set(expand ? [] : branchIds);
				if (!expand) this.expandedTasks.clear();
				if (!expand && !tableHasConditions(this.filters)) this.expandedFiles.clear();
				if (!expand && tableHasConditions(this.filters)) this.filterFilesCollapsed = new Set(this.rows.map(row => row.thread.id));
				this.render();
				this.saveLayout();
			});
		}
		const menu = footer.createEl('details', { cls: 'thread-journal-overview-filter-menu thread-journal-table-fields' });
		menu.open = this.fieldsOpen;
		menu.addEventListener('toggle', () => { this.fieldsOpen = menu.open; });
		const summary = menu.createEl('summary', { cls: 'thread-journal-overview-filter-summary', text: t('Fields') });
		setIcon(summary.createSpan(), 'list-filter');
		const panel = menu.createDiv({ cls: 'thread-journal-overview-filter-panel' });
		for (const column of THREAD_TABLE_COLUMNS) {
			const label = panel.createEl('label', { cls: 'thread-journal-overview-filter-option' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.fields.has(column.key);
			label.createSpan({ text: t(column.label) });
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) this.fields.add(column.key);
				else this.fields.delete(column.key);
				this.fieldsOpen = true;
				this.render();
				this.saveLayout();
			});
		}
		const refresh = footer.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': t('Refresh') } });
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => { void this.refresh(); });
	}
}

export async function openThreadTable(app: App): Promise<void> {
	try {
		let leaf = app.workspace.getLeavesOfType(THREAD_TABLE_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = app.workspace.getLeaf('tab');
			await leaf.setViewState({ type: THREAD_TABLE_VIEW_TYPE, active: true });
		}
		await app.workspace.revealLeaf(leaf);
		app.workspace.setActiveLeaf(leaf, { focus: true });
	} catch (error) {
		new Notice(t('Failed to read thread explorer: {error}', { error: String(error) }));
	}
}
