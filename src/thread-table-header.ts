import { setIcon } from 'obsidian';
import { t } from './i18n';
import { THREAD_STATUS_CHOICES, threadStatusLabel } from './thread-status-model';
import type { ThreadTableRow } from './thread-table-data';
import { DEFAULT_TABLE_FILTERS, TABLE_PRESENCE_COLUMNS, type TableFilters } from './thread-table-filter-model';
import { THREAD_TABLE_COLUMNS, type ThreadTableColumn } from './thread-table-columns';

export interface TableFilterUI { menu?: 'query' | 'status' }

export function renderTableHeader(table: HTMLElement, host: HTMLElement, rows: ThreadTableRow[], columns: ThreadTableColumn[], filters: TableFilters,
	ui: TableFilterUI, change: (filters: TableFilters) => void, render: () => void): () => void {
	const head = table.createEl('thead');
	const top = head.createEl('tr');
	const cells: Partial<Record<'query' | 'status', HTMLElement>> = {};
	const name = top.createEl('th', { attr: { scope: 'col' } });
	const nameTitle = name.createDiv({ cls: 'thread-journal-table-heading-label' });
	nameTitle.createSpan({ text: t('Thread') }); cells.query = nameTitle;
	for (const key of columns) {
		const label = t(THREAD_TABLE_COLUMNS.find(column => column.key === key)!.label);
		const cell = top.createEl('th', { attr: { scope: 'col' } });
		const title = cell.createDiv({ cls: 'thread-journal-table-heading-label' });
		title.createSpan({ text: label });
		if (key === 'status') cells.status = title;
		const presence = TABLE_PRESENCE_COLUMNS.find(column => column === key);
		if (!presence) continue;
		const enabled = filters.present.includes(presence);
		const description = `${label} · ${t(enabled ? 'Has items' : 'Any quantity')}`;
		const button = title.createEl('button', { cls: `clickable-icon thread-journal-table-header-filter${enabled ? ' is-active' : ''}`,
			attr: { type: 'button', title: description, 'aria-label': description, 'aria-pressed': String(enabled) } });
		setIcon(button, 'list-filter');
		button.addEventListener('click', () => change({ ...filters, present: enabled ? filters.present.filter(column => column !== presence) : [...filters.present, presence] }));
	}
	const triggers: Partial<Record<'query' | 'status', HTMLButtonElement>> = {};
	for (const key of ['query', 'status'] as const) {
		if (!cells[key]) continue;
		const active = key === 'query' ? Boolean(filters.query.trim()) : filters.statuses !== null;
		const label = key === 'query' ? `${t('Search thread or file name…')} ${filters.query}` : `${t('Status')} ${filters.statuses?.map(threadStatusLabel).join(', ') ?? ''}`;
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
