import { setIcon, type App } from 'obsidian';
import { t } from './i18n';
import { threadStatusLabel } from './thread-status-model';
import { ROOT_THREAD_ID } from './thread-root-model';
import type { ThreadTableTreeRow, ThreadTableTaskFilter, ThreadTableCounts } from './thread-table-model';
import type { ExplorerGuide } from './thread-explorer-order';
import type { ThreadTableFileRow, ThreadTableRow } from './thread-table-data';
import { THREAD_TABLE_COLUMNS, TABLE_TASK_BUTTONS, type ThreadTableColumn } from './thread-table-columns';

export interface TableSelection { threadId?: string; filePath?: string; filter: ThreadTableTaskFilter }
export interface TableRowContext {
	contextOnly?: boolean;
	bindDrag?: (row: HTMLElement, name: HTMLElement, key: string, movable: boolean) => void;
	app: App;
	columns: ThreadTableColumn[];
	selection?: TableSelection;
	filesExpanded: boolean;
	childrenCollapsed: boolean;
	focus: () => void;
	toggleChildren: () => void;
	toggleFiles: () => void;
	select: (selection: TableSelection) => void;
	tasksExpanded: (filePath: string) => boolean;
	toggleTasks: (filePath: string) => void;
	renderTasks: (parent: HTMLElement, filePath: string, item: Pick<ThreadTableTreeRow, 'guides' | 'ancestors' | 'depth' | 'last'>) => void;
}

// Stable node colors keep outgoing branches recognizable after filtering or folding.
function branchColor(id: string): string {
	const colors = ['blue', 'orange', 'green', 'purple', 'cyan', 'pink', 'red'];
	let hash = 0;
	for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
	return `var(--color-${colors[hash % colors.length]})`;
}

export function renderTreeGuides(name: HTMLElement, item: Pick<ThreadTableTreeRow, 'guides' | 'ancestors' | 'depth' | 'last'>): void {
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
	if (context.contextOnly) return;
	for (const key of context.columns) {
		const cell = row.createDiv({ cls: `thread-journal-table-value is-${key}` });
		if (key === 'status') { if (!isFile) cell.setText(status); else cell.remove(); continue; }
		if (isFile && key === 'files' && !total) { if (status === t('Terminated')) cell.setText(status); else cell.remove(); continue; }
		if (isFile && (key === 'files' || key === 'children')) { cell.remove(); continue; }
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
			if (!group.childElementCount) cell.remove();
			continue;
		}
		const value = counts[key];
		if (!value) { cell.remove(); continue; }
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
	const row = parent.createDiv({ cls: 'thread-journal-tree-row is-thread', attr: { 'aria-level': String(item.depth + 1), 'data-thread-id': data.thread.id } });
	row.toggleClass('is-context', Boolean(context.contextOnly));
	row.toggleClass('is-root', data.thread.id === ROOT_THREAD_ID);
	row.toggleClass('is-selected', context.selection?.threadId === data.thread.id && !context.selection.filePath);
	const select = (filter: ThreadTableTaskFilter): void => context.select({ threadId: data.thread.id, filter });
	row.addEventListener('click', () => { if (!context.contextOnly) select('all'); });
	if (item.node.children.length) row.setAttribute('aria-expanded', String(!context.childrenCollapsed));
	const name = row.createDiv({ cls: 'thread-journal-table-name' });
	renderTreeGuides(name, item);
	const toggle = name.createEl('button', {
		cls: 'clickable-icon thread-journal-table-toggle is-thread-toggle',
		attr: { type: 'button', 'aria-label': t(context.childrenCollapsed ? 'Expand child threads' : 'Collapse child threads') },
	});
	toggle.disabled = !item.node.children.length;
	toggle.style.setProperty('--thread-branch-color', branchColor(data.thread.id));
	if (item.node.children.length) setIcon(toggle, context.childrenCollapsed ? 'chevron-right' : 'chevron-down');
	toggle.addEventListener('click', event => { event.stopPropagation(); context.toggleChildren(); });
	const focus = name.createEl('button', { cls: 'thread-journal-table-thread-focus', text: data.thread.title,
		attr: { type: 'button', title: t('Focus this thread'), 'aria-label': `${t('Focus this thread')}: ${data.thread.title}` } });
	focus.addEventListener('click', event => { event.stopPropagation(); context.focus(); });
	values(name.createDiv({ cls: 'thread-journal-tree-metadata' }), data.counts, threadStatusLabel(data.thread.status), context, select);
	context.bindDrag?.(row, name, `thread:${data.thread.id}`, !context.contextOnly && item.depth > 0);
}

export function renderExplorerFileRow(parent: HTMLElement, item: ExplorerGuide, data: ThreadTableRow, file: ThreadTableFileRow, context: TableRowContext): void {
	const { member } = file;
	const select = (filter: ThreadTableTaskFilter): void => context.select({ threadId: data.thread.id, filePath: member.file.path, filter });
	const row = parent.createDiv({ cls: 'thread-journal-tree-row thread-journal-table-file-row', attr: { 'aria-level': String(item.depth + 1), 'data-file-path': member.file.path } });
	row.toggleClass('is-selected', context.selection?.threadId === data.thread.id && context.selection.filePath === member.file.path);
	row.toggleClass('is-terminated', member.roleStatus === 'terminated');
	row.addEventListener('click', () => select('all'));
	const name = row.createDiv({ cls: 'thread-journal-table-name' });
	renderTreeGuides(name, item);
	const hasTasks = data.tasks.some(task => task.file.path === member.file.path);
	const expand = name.createEl('button', { cls: 'clickable-icon thread-journal-table-toggle', attr: { type: 'button', title: t('Tasks'), 'aria-label': t('Tasks'), 'aria-expanded': String(context.tasksExpanded(member.file.path)) } });
	expand.disabled = !hasTasks;
	if (hasTasks) setIcon(expand, context.tasksExpanded(member.file.path) ? 'chevron-down' : 'chevron-right');
	expand.addEventListener('click', event => { event.stopPropagation(); context.toggleTasks(member.file.path); });
	const open = name.createEl('button', { cls: 'clickable-icon thread-journal-table-toggle', attr: { type: 'button', 'aria-label': member.file.path, title: member.file.path } });
	setIcon(open, member.icon || 'file-text');
	open.addEventListener('click', event => {
		event.stopPropagation();
		void context.app.workspace.openLinkText(member.file.path, '', event.metaKey || event.ctrlKey);
	});
	const title = name.createEl('a', { cls: 'thread-journal-table-file-title', text: member.file.basename, href: member.file.path, attr: { title: member.file.path } });
	title.style.setProperty('--thread-branch-color', branchColor(data.thread.id));
	title.addEventListener('click', event => {
		event.preventDefault(); event.stopPropagation();
		void context.app.workspace.openLinkText(member.file.path, '', event.metaKey || event.ctrlKey);
	});
	values(name.createDiv({ cls: 'thread-journal-tree-metadata' }), file.counts, t(member.roleStatus === 'terminated' ? 'Terminated' : 'Active'), context, select, true);
	if (context.tasksExpanded(member.file.path)) context.renderTasks(parent, member.file.path, item);
	context.bindDrag?.(row, name, `file:${member.file.path}`, true);
}

export function renderTableTotalRow(parent: HTMLElement, counts: ThreadTableCounts, columns: ThreadTableColumn[], select: (selection: TableSelection) => void): void {
	const row = parent.createDiv({ cls: 'thread-journal-tree-summary' });
	row.createEl('strong', { text: t('Total') });
	values(row, counts, '', {
		columns, filesExpanded: false,
		toggleChildren: () => {}, toggleFiles: () => {},
	}, filter => select({ filter }), true, true);
}
