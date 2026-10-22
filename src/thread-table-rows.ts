import { setIcon, type App, type TFile } from 'obsidian';
import { t } from './i18n';
import { threadStatusLabel } from './thread-status-model';
import { ROOT_THREAD_ID } from './thread-root-model';
import type { ThreadTableTreeRow, ThreadTableTaskFilter, ThreadTableCounts } from './thread-table-model';
import type { ThreadTableRow } from './thread-table-data';
import { THREAD_TABLE_COLUMNS, TABLE_TASK_BUTTONS, type ThreadTableColumn } from './thread-table-columns';

export interface TableSelection { threadId?: string; filePath?: string; filter: ThreadTableTaskFilter }
export interface TableRowContext {
	contextOnly?: boolean;
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

// Stable node colors keep outgoing branches recognizable after filtering or folding.
function branchColor(id: string): string {
	const colors = ['blue', 'orange', 'green', 'purple', 'cyan', 'pink', 'red'];
	let hash = 0;
	for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
	return `var(--color-${colors[hash % colors.length]})`;
}

function guides(name: HTMLElement, item: Pick<ThreadTableTreeRow, 'guides' | 'ancestors' | 'depth' | 'last'>): void {
	for (const [index, continues] of item.guides.entries()) {
		const guide = name.createSpan({ cls: `thread-journal-table-guide${continues ? ' is-continuing' : ''}`, attr: { 'aria-hidden': 'true' } });
		guide.style.setProperty('--thread-branch-color', branchColor(item.ancestors[index]!));
	}
	if (item.depth) {
		const branch = name.createSpan({ cls: `thread-journal-table-branch${item.last ? ' is-last' : ''}`, attr: { 'aria-hidden': 'true' } });
		branch.style.setProperty('--thread-branch-color', branchColor(item.ancestors[item.depth - 1]!));
	}
}

function values(row: HTMLElement, counts: ThreadTableCounts, status: string, context: Pick<TableRowContext, 'columns' | 'contextOnly' | 'toggleFiles' | 'toggleChildren' | 'filesExpanded'>,
	select: (filter: ThreadTableTaskFilter) => void, isFile = false, total = false): void {
	for (const key of context.columns) {
		const cell = row.createEl('td', { cls: `thread-journal-table-value is-${key}` });
		if (context.contextOnly && key !== 'status') continue;
		if (key === 'status') { cell.setText(isFile ? '' : status); continue; }
		if (isFile && key === 'files' && !total) { cell.setText(status); continue; }
		if (isFile && (key === 'files' || key === 'children')) { cell.setText(total ? '' : '–'); cell.addClass('is-zero'); continue; }
		if (key === 'tasks') {
			const group = cell.createDiv({ cls: 'thread-journal-table-task-buttons' });
			for (const state of TABLE_TASK_BUTTONS) {
				if (!counts[state.key]) continue;
				const label = `${t(state.label)}: ${counts[state.key]}`;
				const button = group.createEl('button', { cls: `thread-journal-table-count is-${state.key}`, attr: { type: 'button', title: label, 'aria-label': label } });
				setIcon(button.createSpan({ cls: 'thread-journal-table-count-icon', attr: { 'aria-hidden': 'true' } }), state.icon);
				button.createSpan({ text: String(counts[state.key]) });
				button.addEventListener('click', event => { event.stopPropagation(); select(state.key); });
			}
			if (!group.childElementCount) group.createSpan({ text: '–', cls: 'is-zero' });
			continue;
		}
		const value = counts[key];
		cell.toggleClass('is-zero', !value);
		const column = THREAD_TABLE_COLUMNS.find(column => column.key === key)!;
		const action = key === 'files' ? context.toggleFiles : key === 'children' ? (value ? context.toggleChildren : undefined)
			: undefined;
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
	row.toggleClass('is-context', Boolean(context.contextOnly));
	row.toggleClass('is-root', data.thread.id === ROOT_THREAD_ID);
	row.toggleClass('is-selected', context.selection?.threadId === data.thread.id && !context.selection.filePath);
	const select = (filter: ThreadTableTaskFilter): void => context.select({ threadId: data.thread.id, filter });
	row.addEventListener('click', () => { if (!context.contextOnly) select('all'); });
	if (item.node.children.length) row.setAttribute('aria-expanded', String(!context.childrenCollapsed));
	const name = row.createEl('td').createDiv({ cls: 'thread-journal-table-name' });
	guides(name, item);
	const toggle = name.createEl('button', {
		cls: 'clickable-icon thread-journal-table-toggle is-thread-toggle',
		attr: { type: 'button', 'aria-label': t(context.childrenCollapsed ? 'Expand child threads' : 'Collapse child threads') },
	});
	toggle.disabled = !item.node.children.length;
	toggle.style.setProperty('--thread-branch-color', branchColor(data.thread.id));
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
		guides(name, { depth: item.depth + 1, ancestors: [...item.ancestors, data.thread.id], guides: item.depth ? [...item.guides, !item.last] : [],
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

export function renderTableTotalRow(parent: HTMLElement, counts: ThreadTableCounts, columns: ThreadTableColumn[], select: (selection: TableSelection) => void): void {
	const row = parent.createEl('tr', { cls: 'thread-journal-table-total' });
	row.createEl('td', { text: t('Total') });
	values(row, counts, '', {
		columns, filesExpanded: false,
		toggleChildren: () => {}, toggleFiles: () => {},
	}, filter => select({ filter }), true, true);
}
