import { moment, setIcon, type App } from 'obsidian';
import { t } from './i18n';
import type { TaskManager } from './task';
import { renderThreadTaskItem } from './thread-task-item';
import type { ThreadTableRow } from './thread-table-data';
import type { TableSelection } from './thread-table-rows';
import { tableTaskMatches } from './thread-table-model';
import { compareBoardTasks } from './thread-task-board-model';
import { THREAD_TABLE_COLUMNS } from './thread-table-columns';

export function renderTableTaskDetails(parent: HTMLElement, row: ThreadTableRow, selection: TableSelection, context: {
	app: App; taskManager: TaskManager; showEnded: boolean;
	onShowEnded: (value: boolean) => void; onClose: () => void; onRefresh: () => Promise<void>;
}): void {
	const panel = parent.createEl('aside', { cls: 'thread-journal-table-details', attr: { 'aria-label': t('Task details') } });
	const header = panel.createDiv({ cls: 'thread-journal-table-details-header' });
	const titles = header.createDiv();
	titles.createEl('strong', { text: selection.filePath ? row.files.find(file => file.member.file.path === selection.filePath)?.member.file.basename ?? row.thread.title : row.thread.title });
	const filter = THREAD_TABLE_COLUMNS.find(column => column.key === selection.filter);
	titles.createDiv({ cls: 'thread-journal-table-details-scope', text: filter ? t(filter.label) : t('All tasks') });
	const close = header.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': t('Close') } });
	setIcon(close, 'x'); close.addEventListener('click', context.onClose);
	if (selection.filter === 'all') {
		const label = panel.createEl('label', { cls: 'thread-journal-table-ended' });
		const toggle = label.createEl('input', { type: 'checkbox' });
		toggle.checked = context.showEnded;
		label.createSpan({ text: t('Show completed and cancelled tasks') });
		toggle.addEventListener('change', () => context.onShowEnded(toggle.checked));
	}
	const tasks = row.tasks.filter(task => (!selection.filePath || task.file.path === selection.filePath)
		&& tableTaskMatches(task.data, selection.filter, context.showEnded, moment().format('YYYY-MM-DD')))
		.sort((a, b) => compareBoardTasks({ task: a, thread: row.thread }, { task: b, thread: row.thread }));
	const list = panel.createDiv({ cls: 'thread-journal-table-details-list' });
	if (!tasks.length) list.createDiv({ cls: 'thread-journal-empty', text: t('No tasks in this state.') });
	const groups = new Map<string, typeof tasks>();
	for (const task of tasks) {
		const group = groups.get(task.file.path) ?? [];
		group.push(task); groups.set(task.file.path, group);
	}
	for (const [path, group] of groups) {
		const member = row.files.find(file => file.member.file.path === path)?.member;
		const historical = member?.roleStatus === 'terminated';
		const external = !member && path !== row.thread.file.path;
		const section = list.createDiv({ cls: 'thread-journal-table-task-group' });
		const source = section.createDiv({ cls: 'thread-journal-table-task-source' });
		setIcon(source.createSpan(), external ? 'link' : 'file-text');
		source.createSpan({ text: group[0]!.file.basename, attr: { title: path } });
		if (external || historical) source.createSpan({ text: t(external ? 'External tasks' : 'Terminated') });
		for (const task of group) {
			const item = section.createDiv({ cls: 'thread-journal-overview-task' });
			renderThreadTaskItem(item, task, row.thread.file, {
				app: context.app, taskManager: context.taskManager, onRefresh: context.onRefresh,
				isFieldVisible: field => !historical || !['pin', 'actions', 'schedule'].includes(field),
			});
		}
	}
}
