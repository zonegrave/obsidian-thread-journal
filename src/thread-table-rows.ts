import { setIcon, type App, type TFile } from 'obsidian';
import { t } from './i18n';
import { threadStatusLabel } from './thread-status-model';
import { ROOT_THREAD_ID } from './thread-root-model';
import type { ThreadTableTreeRow, ThreadTableTaskFilter, ThreadTableCounts } from './thread-table-model';
import type { ThreadTableRow } from './thread-table-data';
import { THREAD_TABLE_COLUMNS, type ThreadTableColumn } from './thread-table-columns';

export interface TableSelection { threadId: string; filePath?: string; filter: ThreadTableTaskFilter }
export interface TableRowContext {
	app: App;
	columns: ThreadTableColumn[];
	selection?: TableSelection;
	filesExpanded: boolean;
	childrenCollapsed: boolean;
	entry?: TFile;
	toggleChildren: () => void;
	toggleFiles: () => void;
	select: (selection: TableSelection) => void;
}

function guides(name: HTMLElement, item: Pick<ThreadTableTreeRow, 'guides' | 'depth' | 'last'>): void {
	for (const continues of item.guides) name.createSpan({ cls: `thread-journal-table-guide${continues ? ' is-continuing' : ''}` });
	if (item.depth) name.createSpan({ cls: `thread-journal-table-branch${item.last ? ' is-last' : ''}` });
}

function values(row: HTMLElement, counts: ThreadTableCounts, status: string, context: TableRowContext,
	select: (filter: ThreadTableTaskFilter) => void, isFile = false): void {
	for (const key of context.columns) {
		const cell = row.createEl('td', { cls: `thread-journal-table-value is-${key}` });
		if (key === 'status') { cell.setText(status); continue; }
		if (isFile && (key === 'files' || key === 'children')) { cell.setText('–'); cell.addClass('is-zero'); continue; }
		const value = counts[key];
		cell.toggleClass('is-zero', !value);
		const column = THREAD_TABLE_COLUMNS.find(column => column.key === key)!;
		const action = key === 'files' ? context.toggleFiles : key === 'children' ? (value ? context.toggleChildren : undefined)
			: key === 'commits' || key === 'logs' ? undefined : () => select(key);
		const label = `${t(column.label)}: ${value}`;
		cell.setAttribute('title', label);
		const count: HTMLElement = cell.createEl(action ? 'button' : 'span', {
			cls: 'thread-journal-table-count', attr: { 'aria-label': label },
		});
		if (column.icon) setIcon(count.createSpan({ cls: 'thread-journal-table-count-icon', attr: { 'aria-hidden': 'true' } }), column.icon);
		count.createSpan({ text: value ? String(value) : '–' });
		if (action) {
			count.setAttribute('type', 'button');
			if (key === 'files') count.setAttribute('aria-expanded', String(context.filesExpanded));
			count.addEventListener('click', event => { event.stopPropagation(); action(); });
		}
	}
}

export function renderTableThreadRow(parent: HTMLElement, item: ThreadTableTreeRow, data: ThreadTableRow, context: TableRowContext): void {
	const row = parent.createEl('tr', { attr: { 'aria-level': String(item.depth + 1), 'data-thread-id': data.thread.id } });
	row.toggleClass('is-root', data.thread.id === ROOT_THREAD_ID);
	row.toggleClass('is-selected', context.selection?.threadId === data.thread.id && !context.selection.filePath);
	const select = (filter: ThreadTableTaskFilter): void => context.select({ threadId: data.thread.id, filter });
	row.addEventListener('click', () => select('all'));
	if (item.node.children.length) row.setAttribute('aria-expanded', String(!context.childrenCollapsed));
	const name = row.createEl('td').createDiv({ cls: 'thread-journal-table-name' });
	guides(name, item);
	const toggle = name.createEl('button', {
		cls: 'clickable-icon thread-journal-table-toggle',
		attr: { type: 'button', 'aria-label': t(context.childrenCollapsed ? 'Expand child threads' : 'Collapse child threads') },
	});
	toggle.disabled = !item.node.children.length;
	if (item.node.children.length) setIcon(toggle, context.childrenCollapsed ? 'chevron-right' : 'chevron-down');
	toggle.addEventListener('click', event => { event.stopPropagation(); context.toggleChildren(); });
	const target = context.entry ?? data.thread.file;
	const link = name.createEl('a', { text: data.thread.title, href: target.path, attr: { title: data.thread.title } });
	link.addEventListener('click', event => {
		event.preventDefault(); event.stopPropagation();
		void context.app.workspace.openLinkText(target.path, '', event.metaKey || event.ctrlKey);
	});
	values(row, data.counts, threadStatusLabel(data.thread.status), context, select);
}

export function renderTableFileRows(parent: HTMLElement, item: ThreadTableTreeRow, data: ThreadTableRow, context: TableRowContext): void {
	for (const [i, file] of data.files.entries()) {
		const { member } = file;
		const select = (filter: ThreadTableTaskFilter): void => context.select({ threadId: data.thread.id, filePath: member.file.path, filter });
		const row = parent.createEl('tr', { cls: 'thread-journal-table-file-row', attr: { 'aria-level': String(item.depth + 2), 'data-file-path': member.file.path } });
		row.toggleClass('is-selected', context.selection?.threadId === data.thread.id && context.selection.filePath === member.file.path);
		row.toggleClass('is-terminated', member.roleStatus === 'terminated');
		row.addEventListener('click', () => select('all'));
		const name = row.createEl('td').createDiv({ cls: 'thread-journal-table-name' });
		guides(name, { depth: item.depth + 1, guides: item.depth ? [...item.guides, !item.last] : [],
			last: i === data.files.length - 1 && (context.childrenCollapsed || !item.node.children.length) });
		const open = name.createEl('button', { cls: 'clickable-icon thread-journal-table-toggle', attr: { type: 'button', 'aria-label': member.file.path, title: member.file.path } });
		setIcon(open, member.icon || 'file-text');
		open.addEventListener('click', event => {
			event.stopPropagation();
			void context.app.workspace.openLinkText(member.file.path, '', event.metaKey || event.ctrlKey);
		});
		const title = name.createEl('button', { cls: 'thread-journal-table-file-title', text: member.file.basename, attr: { type: 'button', title: member.file.path } });
		title.addEventListener('click', event => { event.stopPropagation(); select('all'); });
		name.createSpan({ cls: 'thread-journal-table-role', text: member.role });
		values(row, file.counts, t(member.roleStatus === 'terminated' ? 'Terminated' : 'Active'), context, select, true);
	}
	if (!data.files.length) {
		const row = parent.createEl('tr');
		row.createEl('td', { cls: 'thread-journal-empty', text: t('No thread files yet.'), attr: { colspan: String(context.columns.length + 1) } });
	}
}
