import { setIcon } from 'obsidian';
import { t } from './i18n';
import { THREAD_STATUS_CHOICES, threadStatusLabel } from './thread-status-model';
import type { ThreadTableRow } from './thread-table-data';
import { DEFAULT_TABLE_FILTERS, type TableFilters } from './thread-table-filter-model';
import { THREAD_TABLE_COLUMNS, type ThreadTableColumn } from './thread-table-columns';

export interface TableFilterUI { menu?: 'query' | 'status' | 'tasks' }

export function renderTableHeader(table: HTMLElement, host: HTMLElement, rows: ThreadTableRow[], columns: ThreadTableColumn[], filters: TableFilters,
	ui: TableFilterUI, change: (filters: TableFilters) => void, render: () => void): () => void {
	const head = table.createEl('thead');
	const top = head.createEl('tr');
	const taskKeys = new Set(['open', 'committed', 'idea', 'completed', 'cancelled', 'holding', 'scheduled', 'pinned']);
	const taskColumns = columns.filter(key => taskKeys.has(key));
	const lower = taskColumns.length ? head.createEl('tr', { cls: 'thread-journal-table-task-headings' }) : undefined;
	const cells: Partial<Record<'query' | 'status' | 'tasks', HTMLElement>> = {};
	const name = top.createEl('th', { attr: { scope: 'col', rowspan: lower ? '2' : '1' } });
	const nameTitle = name.createDiv({ cls: 'thread-journal-table-heading-label' });
	nameTitle.createSpan({ text: t('Thread') }); cells.query = nameTitle;
	let taskGroup = false;
	for (const key of columns) {
		const label = t(THREAD_TABLE_COLUMNS.find(column => column.key === key)!.label);
		if (taskKeys.has(key)) {
			if (!taskGroup) {
				const group = top.createEl('th', { attr: { colspan: String(taskColumns.length), scope: 'colgroup' } });
				const title = group.createDiv({ cls: 'thread-journal-table-heading-label' });
				title.createSpan({ text: t('Tasks') }); cells.tasks = title; taskGroup = true;
			}
			lower!.createEl('th', { text: label, attr: { scope: 'col' } });
		} else {
			const cell = top.createEl('th', { attr: { scope: 'col', rowspan: lower ? '2' : '1' } });
			const title = cell.createDiv({ cls: 'thread-journal-table-heading-label' });
			title.createSpan({ text: label });
			if (key === 'status') cells.status = title;
		}
	}
	const triggers: Partial<Record<'query' | 'status' | 'tasks', HTMLButtonElement>> = {};
	for (const key of ['query', 'status', 'tasks'] as const) {
		if (!cells[key]) continue;
		const active = key === 'query' ? Boolean(filters.query.trim()) : key === 'status' ? filters.statuses !== null : filters.tasks !== 'any';
		const label = key === 'query' ? `${t('Search thread or file name…')} ${filters.query}` : key === 'status' ? `${t('Status')} ${filters.statuses?.map(threadStatusLabel).join(', ') ?? ''}` : `${t('Unfinished tasks')} ${filters.tasks === 'with' ? '≥ 1' : filters.tasks === 'without' ? '= 0' : filters.tasks === 'range' ? `${filters.min ?? 0}–${filters.max ?? '∞'}` : ''}`;
		const button = cells[key].createEl('button', { cls: `clickable-icon thread-journal-table-header-filter${active ? ' is-active' : ''}`, attr: { type: 'button', title: label, 'aria-label': label, 'aria-expanded': String(ui.menu === key) } });
		setIcon(button, key === 'query' ? 'search' : 'list-filter');
		button.addEventListener('click', () => { ui.menu = ui.menu === key ? undefined : key; render(); });
		triggers[key] = button;
	}
	const clear = nameTitle.createEl('button', { cls: 'clickable-icon thread-journal-table-header-filter', attr: { type: 'button', 'aria-label': t('Clear filters'), title: t('Clear filters') } });
	setIcon(clear, 'filter-x');
	clear.addEventListener('click', () => change({ ...DEFAULT_TABLE_FILTERS, root: filters.root }));
	const trigger = ui.menu ? triggers[ui.menu] : undefined;
	if (!trigger) return () => {};
	const panel = host.createDiv({ cls: 'thread-journal-table-filter-popover' });
	if (ui.menu === 'query') {
		const query = panel.createEl('input', { type: 'search', attr: { placeholder: t('Search thread or file name…'), 'aria-label': t('Search thread or file name…'), 'data-table-filter': 'query' } });
		query.value = filters.query;
		query.addEventListener('input', event => { if (!(event as InputEvent).isComposing) change({ ...filters, query: query.value }); });
		query.addEventListener('compositionend', () => change({ ...filters, query: query.value }));
		const reset = panel.createEl('button', { text: t('Clear filters'), attr: { type: 'button' } });
		reset.addEventListener('click', () => change({ ...filters, query: '' }));
	} else if (ui.menu === 'status') {
	const statuses = [...new Set([...THREAD_STATUS_CHOICES.map(s => s.value), ...rows.map(row => row.thread.status)])];
	const statusPanel = panel;
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

	} else {
	const taskPanel = panel;
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

	}
	const position = (): void => {
		const bounds = host.getBoundingClientRect(); const anchor = trigger.getBoundingClientRect();
		panel.style.left = `${Math.max(4, Math.min(anchor.left - bounds.left, bounds.width - panel.offsetWidth - 4))}px`;
		panel.style.top = `${anchor.bottom - bounds.top + 4}px`;
		panel.style.maxHeight = `${Math.max(60, bounds.bottom - anchor.bottom - 12)}px`;
	};
	position();
	panel.querySelector<HTMLInputElement>('input[type=search]')?.focus();
	const observer = new ResizeObserver(position); observer.observe(host);
	const close = (): void => {
		ui.menu = undefined; trigger.setAttribute('aria-expanded', 'false'); panel.remove(); observer.disconnect();
		host.ownerDocument.removeEventListener('pointerdown', outside, true);
		host.ownerDocument.removeEventListener('keydown', escape, true);
		host.removeEventListener('scroll', position, true);
	};
	const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !panel.contains(event.target) && !trigger.contains(event.target)) close(); };
	const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); close(); trigger.focus(); } };
	host.addEventListener('scroll', position, true);
	host.ownerDocument.addEventListener('pointerdown', outside, true);
	host.ownerDocument.addEventListener('keydown', escape, true);
	return () => { observer.disconnect(); host.ownerDocument.removeEventListener('pointerdown', outside, true); host.ownerDocument.removeEventListener('keydown', escape, true); host.removeEventListener('scroll', position, true); panel.remove(); };
}
