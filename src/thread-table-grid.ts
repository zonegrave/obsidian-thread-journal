import { t } from './i18n';

// Rows flow independently; only the content scrolls above the fixed summary.
export function createThreadTree(parent: HTMLElement): { body: HTMLElement; total: HTMLElement; scroll: HTMLDivElement } {
	const pane = parent.createDiv({ cls: 'thread-journal-table-pane thread-journal-tree-pane' });
	const scroll = pane.createDiv({ cls: 'thread-journal-table-scroll' });
	const body = scroll.createDiv({ cls: 'thread-journal-tree-list', attr: { 'aria-label': t('Thread explorer') } });
	const total = pane.createDiv({ cls: 'thread-journal-tree-total' });
	return { body, total, scroll };
}
