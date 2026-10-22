import { t } from './i18n';
import { THREAD_TABLE_COLUMNS, type ThreadTableColumn } from './thread-table-columns';

// Separate vertical scrolling from the fixed heading and total; all three tables share columns.
export function createThreadTableGrid(parent: HTMLElement, columns: ThreadTableColumn[]): {
	header: HTMLTableElement; body: HTMLTableSectionElement; total: HTMLTableSectionElement;
	scroll: HTMLDivElement; sync: () => void; dispose: () => void;
} {
	const pane = parent.createDiv({ cls: 'thread-journal-table-pane' });
	const heading = pane.createDiv({ cls: 'thread-journal-table-heading' });
	const scroll = pane.createDiv({ cls: 'thread-journal-table-scroll' });
	const footer = pane.createDiv({ cls: 'thread-journal-table-total-wrap' });
	const font = getComputedStyle(parent);
	const canvas = parent.ownerDocument.createElement('canvas').getContext('2d');
	if (canvas) canvas.font = `${font.fontSize} ${font.fontFamily}`;
	const widths = [320, ...columns.map(key => {
		const label = t(THREAD_TABLE_COLUMNS.find(column => column.key === key)!.label);
		return Math.max(key === 'tasks' ? 230 : key === 'status' ? 116 : 64, Math.ceil(canvas?.measureText(label).width ?? label.length * 8) + (key === 'status' || key === 'files' || key === 'tasks' ? 50 : 24));
	})];
	const table = (host: HTMLElement): HTMLTableElement => {
		const element = host.createEl('table', { cls: 'thread-journal-thread-table' });
		element.style.minWidth = `${widths.reduce((a, b) => a + b, 0)}px`;
		const group = element.createEl('colgroup');
		for (const width of widths) group.createEl('col').style.width = `${width}px`;
		return element;
	};
	const header = table(heading);
	header.setAttribute('aria-label', t('Thread overview table'));
	const body = table(scroll).createEl('tbody');
	const total = table(footer).createEl('tfoot');
	const sync = (): void => {
		const gutter = scroll.offsetWidth - scroll.clientWidth;
		heading.style.paddingRight = `${gutter}px`;
		footer.style.paddingRight = `${gutter}px`;
		heading.scrollLeft = scroll.scrollLeft;
		footer.scrollLeft = scroll.scrollLeft;
	};
	scroll.addEventListener('scroll', sync, { passive: true });
	const observer = new ResizeObserver(sync);
	observer.observe(scroll);
	return { header, body, total, scroll, sync, dispose: () => { observer.disconnect(); scroll.removeEventListener('scroll', sync); } };
}
