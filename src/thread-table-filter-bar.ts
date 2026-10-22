import { setIcon } from 'obsidian';
import { t } from './i18n';
import { THREAD_STATUS_CHOICES, threadStatusLabel } from './thread-status-model';
import type { ThreadTableRow } from './thread-table-data';
import { DEFAULT_TABLE_FILTERS, type TableFilters } from './thread-table-filter-model';

export interface TableFilterUI { status: boolean; tasks: boolean; mobile: boolean }

export function renderTableFilterBar(parent: HTMLElement, rows: ThreadTableRow[], filters: TableFilters,
	ui: TableFilterUI, change: (filters: TableFilters) => void): void {
	const bar = parent.createDiv({ cls: `thread-journal-table-topbar${ui.mobile ? ' is-filters-open' : ''}` });
	const label = bar.createEl('label', { cls: 'thread-journal-table-root' });
	label.createSpan({ text: t('Root thread') });
	const root = label.createEl('select', { attr: { 'aria-label': t('Root thread') } });
	root.createEl('option', { text: 'ROOT', attr: { value: '' } });
	for (const row of [...rows].sort((a, b) => a.thread.title.localeCompare(b.thread.title))) {
		if (row.thread.id !== 'ROOT') root.createEl('option', { text: row.thread.title, attr: { value: row.thread.id } });
	}
	root.value = filters.root;
	root.addEventListener('change', () => change({ ...filters, root: root.value }));
	const query = bar.createEl('input', { type: 'search', cls: 'thread-journal-table-search',
		attr: { placeholder: t('Search thread or file name…'), 'aria-label': t('Search thread or file name…'), 'data-table-filter': 'query' } });
	query.value = filters.query;
	query.addEventListener('input', event => { if (!(event as InputEvent).isComposing) change({ ...filters, query: query.value }); });
	query.addEventListener('compositionend', () => change({ ...filters, query: query.value }));
	const toggle = bar.createEl('button', { cls: 'thread-journal-table-filter-toggle', text: t('Filters'), attr: { type: 'button', 'aria-expanded': String(ui.mobile) } });
	toggle.addEventListener('click', () => { ui.mobile = !ui.mobile; bar.toggleClass('is-filters-open', ui.mobile); toggle.setAttribute('aria-expanded', String(ui.mobile)); });
	const options = bar.createDiv({ cls: 'thread-journal-table-filter-options' });
	const status = options.createEl('details', { cls: 'thread-journal-table-filter-menu' });
	status.open = ui.status;
	status.addEventListener('toggle', () => { if (status.isConnected) ui.status = status.open; });
	status.createEl('summary', { text: filters.statuses === null ? t('Status') : `${t('Status')} · ${filters.statuses.length}` });
	const statuses = [...new Set([...THREAD_STATUS_CHOICES.map(s => s.value), ...rows.map(row => row.thread.status)])];
	const statusPanel = status.createDiv({ cls: 'thread-journal-table-filter-panel' });
	const all = statusPanel.createEl('button', { text: t('All statuses'), attr: { type: 'button' } });
	all.addEventListener('click', () => change({ ...filters, statuses: null }));
	for (const value of statuses) {
		const item = statusPanel.createEl('label');
		const check = item.createEl('input', { type: 'checkbox' });
		check.checked = filters.statuses === null || filters.statuses.includes(value);
		item.createSpan({ text: threadStatusLabel(value) });
		check.addEventListener('change', () => {
			const next = new Set(filters.statuses ?? statuses);
			if (check.checked) next.add(value); else next.delete(value);
			change({ ...filters, statuses: [...next] });
		});
	}
	const tasks = options.createEl('details', { cls: 'thread-journal-table-filter-menu' });
	tasks.open = ui.tasks;
	tasks.addEventListener('toggle', () => { if (tasks.isConnected) ui.tasks = tasks.open; });
	const suffix = filters.tasks === 'with' ? ' ≥ 1' : filters.tasks === 'without' ? ' = 0'
		: filters.tasks === 'range' ? ` ${filters.min ?? 0}–${filters.max ?? '∞'}` : '';
	tasks.createEl('summary', { text: t('Tasks') + suffix });
	const taskPanel = tasks.createDiv({ cls: 'thread-journal-table-filter-panel' });
	taskPanel.createSpan({ text: t('Unfinished tasks'), cls: 'thread-journal-table-filter-hint' });
	const mode = taskPanel.createEl('select', { attr: { 'aria-label': t('Task count') } });
	for (const [value, text] of [['any', t('Any count')], ['with', t('With unfinished tasks')], ['without', t('Without unfinished tasks')], ['range', t('Count range')]]) {
		mode.createEl('option', { text, attr: { value: value! } });
	}
	mode.value = filters.tasks;
	mode.addEventListener('change', () => change({ ...filters, tasks: mode.value as TableFilters['tasks'] }));
	if (filters.tasks === 'range') for (const key of ['min', 'max'] as const) {
		const item = taskPanel.createEl('label');
		item.createSpan({ text: t(key === 'min' ? 'Minimum' : 'Maximum') });
		const input = item.createEl('input', { type: 'number', attr: { min: '0', step: '1', 'aria-label': t(key === 'min' ? 'Minimum' : 'Maximum'), 'data-table-filter': key } });
		input.value = filters[key] === null ? '' : String(filters[key]);
		input.addEventListener('input', () => {
			if (input.value && !input.validity.valid) return;
			change({ ...filters, [key]: input.value === '' ? null : Number(input.value) });
		});
	}
	const clear = bar.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': t('Clear filters'), title: t('Clear filters') } });
	setIcon(clear, 'filter-x');
	clear.addEventListener('click', () => change({ ...DEFAULT_TABLE_FILTERS }));
}
