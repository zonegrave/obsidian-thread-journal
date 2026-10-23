import { setIcon } from 'obsidian';
import { t } from './i18n';
import { THREAD_STATUS_CHOICES, threadStatusLabel } from './thread-status-model';
import type { ThreadTableRow } from './thread-table-data';
import { DEFAULT_TABLE_FILTERS, type TableFilters } from './thread-table-filter-model';
import { renderTableTaskFilter } from './thread-table-task-filter-ui';
import { tableTaskFilterActive } from './thread-table-task-filter';

export interface TableFilterUI { menu?: 'query' | 'status' | 'files' | 'tasks' }

export function renderTreeFilters(toolbar: HTMLElement, host: HTMLElement, rows: ThreadTableRow[], filters: TableFilters,
	ui: TableFilterUI, change: (filters: TableFilters) => void, render: () => void): () => void {
	const controls = toolbar.createDiv({ cls: 'thread-journal-tree-filters' });
	const triggers: Partial<Record<'query' | 'status' | 'files' | 'tasks', HTMLButtonElement>> = {};
	for (const key of ['query', 'status', 'files', 'tasks'] as const) {
		const active = key === 'query' ? Boolean(filters.query.trim()) : key === 'tasks' ? tableTaskFilterActive(filters.tasks) : key === 'files' ? filters.fileStatuses !== null : filters.statuses !== null;
		const label = key === 'query' ? `${t('Search thread or file name…')} ${filters.query}` : key === 'tasks' ? t('Tasks') : key === 'files' ? `${t('Thread files')} · ${filters.fileStatuses?.map(value => t(value === 'active' ? 'Active' : 'Terminated')).join(', ') ?? t('All statuses')}` : `${t('Status')} ${filters.statuses?.map(threadStatusLabel).join(', ') ?? ''}`;
		const button = controls.createEl('button', { cls: `clickable-icon thread-journal-table-header-filter${active ? ' is-active' : ''}`, attr: { type: 'button', title: label, 'aria-label': label, 'aria-expanded': String(ui.menu === key) } });
		setIcon(button.createSpan({ cls: 'thread-journal-tree-filter-icon' }), key === 'query' ? 'search' : 'list-filter');
		button.createSpan({ text: t(key === 'query' ? 'Search' : key === 'status' ? 'Status' : key === 'files' ? 'Thread files' : 'Tasks') });
		button.addEventListener('click', () => { ui.menu = ui.menu === key ? undefined : key; render(); });
		triggers[key] = button;
	}
	const clear = controls.createEl('button', { cls: 'clickable-icon thread-journal-table-header-filter', attr: { type: 'button', 'aria-label': t('Clear filters'), title: t('Clear filters') } });
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
	if (ui.menu === 'files') {
		const all = panel.createEl('button', { text: t('All statuses'), attr: { type: 'button' } });
		all.addEventListener('click', () => change({ ...filters, fileStatuses: null }));
		for (const value of ['active', 'terminated'] as const) {
			const item = panel.createEl('label');
			const check = item.createEl('input', { type: 'checkbox' });
			check.checked = filters.fileStatuses === null || filters.fileStatuses.includes(value);
			item.createSpan({ text: t(value === 'active' ? 'Active' : 'Terminated') });
			check.addEventListener('change', () => {
				const next = new Set(filters.fileStatuses ?? ['active', 'terminated'] as const);
				if (check.checked) next.add(value); else next.delete(value);
				change({ ...filters, fileStatuses: [...next] });
			});
		}
	}
	if (ui.menu === 'tasks') renderTableTaskFilter(panel, filters.tasks, tasks => change({ ...filters, tasks }));
	const position = (): void => {
		const bounds = host.getBoundingClientRect(); const anchor = trigger.getBoundingClientRect();
		panel.style.left = `${Math.max(4, Math.min(anchor.left - bounds.left, bounds.width - panel.offsetWidth - 4))}px`;
		panel.style.maxHeight = `${Math.max(60, anchor.top - bounds.top - 12)}px`;
		panel.style.top = `${Math.max(4, anchor.top - bounds.top - panel.offsetHeight - 4)}px`;
	};
	position();
	panel.querySelector<HTMLInputElement>('input[type=search]')?.focus();
	const observer = new ResizeObserver(position); observer.observe(host); observer.observe(toolbar);
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
