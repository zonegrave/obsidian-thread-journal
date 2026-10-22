import type { TaskStatus } from './task-model';
import { t } from './i18n';
import { TABLE_TASK_BUTTONS } from './thread-table-columns';
import { DEFAULT_TABLE_TASK_FILTERS, type TableTaskFilters, type TableTaskFlag } from './thread-table-task-filter';

export function renderTableTaskFilter(panel: HTMLElement, filters: TableTaskFilters, change: (value: TableTaskFilters) => void): void {
	panel.addClass('thread-journal-table-task-filter');
	const states = panel.createEl('fieldset');
	states.createEl('legend', { text: t('Status') });
	for (const state of TABLE_TASK_BUTTONS) {
		const label = states.createEl('label');
		const check = label.createEl('input', { type: 'checkbox' });
		check.checked = (filters.states ?? ['open', 'committed', 'idea']).includes(state.key);
		label.createSpan({ text: t(state.label) });
		check.addEventListener('change', () => {
			const next = new Set<TaskStatus>(filters.states ?? ['open', 'committed', 'idea']);
			if (check.checked) next.add(state.key); else next.delete(state.key);
			change({ ...filters, states: [...next] });
		});
	}
	for (const [key, title] of [['pin', 'Pin'], ['scheduled', 'Schedule'], ['holding', 'Holding']] as const) {
		const label = panel.createEl('label', { cls: 'thread-journal-table-task-filter-row' });
		label.createSpan({ text: t(title) });
		const select = label.createEl('select', { attr: { 'aria-label': t(title), 'data-table-filter': key } });
		for (const [value, title] of [['any', 'Any quantity'], ['yes', 'Yes'], ['no', 'No']] as const) select.createEl('option', { value, text: t(title) });
		select.value = filters[key];
		select.addEventListener('change', () => change({ ...filters, [key]: select.value as TableTaskFlag }));
	}
	for (const [key, title] of [['scheduledBy', 'Scheduled on or before'], ['windowOn', 'Window active on']] as const) {
		const row = panel.createDiv({ cls: 'thread-journal-table-task-filter-date' });
		row.createSpan({ text: t(title) });
		const controls = row.createDiv();
		const date = controls.createEl('input', { type: 'date', attr: { 'aria-label': t(title), 'data-table-filter': key } });
		date.value = filters[key] === 'today' ? '' : filters[key];
		date.disabled = filters[key] === 'today';
		date.addEventListener('change', () => change({ ...filters, [key]: date.value }));
		const today = controls.createEl('button', { text: t('Today'), attr: { type: 'button', 'aria-pressed': String(filters[key] === 'today') } });
		today.addEventListener('click', () => change({ ...filters, [key]: filters[key] === 'today' ? '' : 'today' }));
	}
	panel.createDiv({ cls: 'thread-journal-table-filter-hint', text: t('Overdue tasks remain included.') });
	const clear = panel.createEl('button', { text: t('Clear filters'), attr: { type: 'button' } });
	clear.addEventListener('click', () => change({ ...DEFAULT_TABLE_TASK_FILTERS }));
}
