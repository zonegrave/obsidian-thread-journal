import { App, ItemView, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import type { ThreadFileManager } from './thread-files';
import { LANGUAGE_CHANGE_EVENT, t } from './i18n';
import { threadStatusLabel } from './thread-status-model';
import { buildRootedThreadOverviewTree } from './thread-overview-model';
import { ROOT_THREAD_ID } from './thread-root-model';
import { flattenThreadTableTree, type ThreadTableTreeRow } from './thread-table-model';
import { collectThreadTable, type ThreadTableRow } from './thread-table-data';
import { THREAD_TABLE_COLUMNS, type ThreadTableColumn } from './thread-table-columns';

export const THREAD_TABLE_VIEW_TYPE = 'thread-journal-overview-table';

export class ThreadTableView extends ItemView {
	private rows: ThreadTableRow[] = [];
	private collapsed = new Set<string>();
	private fields = new Set<ThreadTableColumn>(THREAD_TABLE_COLUMNS.map(column => column.key));
	private timer?: number;
	private request = 0;
	private opened = false;
	private fieldsOpen = false;

	constructor(leaf: WorkspaceLeaf, private readonly index: ThreadIndex, private readonly files: ThreadFileManager) {
		super(leaf);
	}

	getViewType(): string { return THREAD_TABLE_VIEW_TYPE; }
	getDisplayText(): string { return t('Thread overview table'); }
	getIcon(): string { return 'table-properties'; }

	getState(): Record<string, unknown> {
		return { collapsed: [...this.collapsed], fields: [...this.fields] };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		if (typeof state === 'object' && state !== null) {
			const value = state as Record<string, unknown>;
			if (Array.isArray(value.collapsed)) this.collapsed = new Set(value.collapsed.filter((id): id is string => typeof id === 'string'));
			if (Array.isArray(value.fields)) this.fields = new Set(THREAD_TABLE_COLUMNS.filter(column =>
				(value.fields as unknown[]).includes(column.key)).map(column => column.key));
		}
		if (this.opened) this.render();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass('thread-journal-table-view');
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
		const languageChanged = (): void => this.render();
		window.addEventListener(LANGUAGE_CHANGE_EVENT, languageChanged);
		this.register(() => window.removeEventListener(LANGUAGE_CHANGE_EVENT, languageChanged));
		this.contentEl.createDiv({ cls: 'thread-journal-empty', text: t('Loading thread table…') });
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.request++;
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.contentEl.empty();
		this.contentEl.removeClass('thread-journal-table-view');
	}

	private scheduleRefresh(): void {
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => { void this.refresh(); }, 350);
	}

	private async refresh(): Promise<void> {
		const request = ++this.request;
		try {
			const rows = await collectThreadTable(this.app, this.index);
			if (!this.opened || request !== this.request) return;
			this.rows = rows;
			this.render();
		} catch (error) {
			if (!this.opened || request !== this.request) return;
			const message = t('Failed to read thread table: {error}', { error: String(error) });
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
		this.contentEl.empty();
		const tree = buildRootedThreadOverviewTree(this.rows.map(row => ({
			id: row.thread.id, title: row.thread.title, status: row.thread.status, parent: row.parent,
		})), new Set(this.rows.map(row => row.thread.status)));
		const visible = flattenThreadTableTree(tree, this.collapsed);
		const byId = new Map(this.rows.map(row => [row.thread.id, row]));
		const scroll = this.contentEl.createDiv({ cls: 'thread-journal-table-scroll' });
		const table = scroll.createEl('table', {
			cls: 'thread-journal-thread-table', attr: { role: 'treegrid', 'aria-label': t('Thread overview table') },
		});
		const columns = THREAD_TABLE_COLUMNS.filter(column => this.fields.has(column.key));
		const header = table.createEl('thead').createEl('tr');
		header.createEl('th', { text: t('Thread'), attr: { scope: 'col' } });
		for (const column of columns) header.createEl('th', { text: t(column.label), attr: { scope: 'col' } });
		const body = table.createEl('tbody');
		for (const item of visible) {
			const data = byId.get(item.node.item.id);
			if (data) this.renderRow(body, item, data, columns.map(column => column.key));
		}
		if (!visible.length) scroll.createDiv({ cls: 'thread-journal-empty', text: t('No threads match the selected statuses.') });
		this.renderFooter(flattenThreadTableTree(tree, new Set()).filter(item => item.node.children.length).map(item => item.node.item.id));
		scroll.scrollTop = scrollTop;
		scroll.scrollLeft = scrollLeft;
	}

	private toggle(id: string): void {
		if (this.collapsed.has(id)) this.collapsed.delete(id);
		else this.collapsed.add(id);
		this.render();
		this.saveLayout();
	}

	private renderRow(parent: HTMLElement, item: ThreadTableTreeRow, data: ThreadTableRow, columns: ThreadTableColumn[]): void {
		const { node } = item;
		const row = parent.createEl('tr', { attr: { 'aria-level': String(item.depth + 1), 'data-thread-id': data.thread.id } });
		row.toggleClass('is-root', data.thread.id === ROOT_THREAD_ID);
		if (node.children.length) row.setAttribute('aria-expanded', String(!this.collapsed.has(data.thread.id)));
		const name = row.createEl('td').createDiv({ cls: 'thread-journal-table-name' });
		for (const continues of item.guides) name.createSpan({ cls: `thread-journal-table-guide${continues ? ' is-continuing' : ''}` });
		if (item.depth) name.createSpan({ cls: `thread-journal-table-branch${item.last ? ' is-last' : ''}` });
		const toggle = name.createEl('button', {
			cls: 'clickable-icon thread-journal-table-toggle',
			attr: { type: 'button', 'aria-label': t(this.collapsed.has(data.thread.id) ? 'Expand child threads' : 'Collapse child threads') },
		});
		toggle.disabled = !node.children.length;
		if (node.children.length) setIcon(toggle, this.collapsed.has(data.thread.id) ? 'chevron-right' : 'chevron-down');
		toggle.addEventListener('click', () => this.toggle(data.thread.id));
		const target = this.index.getEntry(data.thread.file) ?? data.thread.file;
		const link = name.createEl('a', { text: data.thread.title, href: target.path, attr: { title: data.thread.title } });
		link.addEventListener('click', event => {
			event.preventDefault();
			void this.app.workspace.openLinkText(target.path, '', event.metaKey || event.ctrlKey);
		});
		for (const key of columns) {
			const cell = row.createEl('td', { cls: `thread-journal-table-value is-${key}` });
			if (key === 'status') { cell.setText(threadStatusLabel(data.thread.status)); continue; }
			const value = data.counts[key];
			cell.toggleClass('is-zero', !value);
			const column = THREAD_TABLE_COLUMNS.find(column => column.key === key)!;
			cell.setAttribute('title', `${t(column.label)} · ${value}`);
			const count: HTMLElement = cell.createEl(key === 'files' || (key === 'children' && node.children.length) ? 'button' : 'span', {
				cls: 'thread-journal-table-count',
				attr: { 'aria-label': `${t(column.label)}: ${value}` },
			});
			if (column.icon) setIcon(count.createSpan({ cls: 'thread-journal-table-count-icon', attr: { 'aria-hidden': 'true' } }), column.icon);
			count.createSpan({ text: value ? String(value) : '–' });
			if (key === 'files') {
				count.setAttribute('type', 'button');
				count.setAttribute('aria-label', t('Manage thread files ({count})', { count: value }));
				count.addEventListener('click', event => this.files.openActiveThreadFilesMenu(data.thread.file, event));
			} else if (key === 'children' && node.children.length) {
				count.setAttribute('type', 'button');
				count.addEventListener('click', () => this.toggle(data.thread.id));
			}
		}
	}

	private renderFooter(branchIds: string[]): void {
		const footer = this.contentEl.createDiv({ cls: 'thread-journal-view-bottom-bar thread-journal-table-footer' });
		footer.createSpan({ text: t('Own counts'), attr: { title: t('Own files include historical members. Holding, recurring and pinned counts overlap task states.') } });
		for (const expand of [true, false]) {
			const button = footer.createEl('button', { text: t(expand ? 'Expand all threads' : 'Collapse all threads') });
			button.addEventListener('click', () => {
				this.collapsed = new Set(expand ? [] : branchIds);
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
		new Notice(t('Failed to read thread table: {error}', { error: String(error) }));
	}
}
