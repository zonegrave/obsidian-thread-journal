import { moment, setIcon, type App } from 'obsidian';
import { t } from './i18n';
import type { TaskManager } from './task';
import { renderThreadTaskItem } from './thread-task-item';
import type { ThreadTableRow } from './thread-table-data';
import type { TableSelection } from './thread-table-rows';
import { tableTaskMatches } from './thread-table-model';
import { uniqueTableTasks } from './thread-table-total-model';
import { compareBoardTasks } from './thread-task-board-model';
import { TABLE_TASK_BUTTONS } from './thread-table-columns';

export function renderTableTaskDetails(parent: HTMLElement, rows: ThreadTableRow[], selection: TableSelection, context: {
	app: App; taskManager: TaskManager;
	onClose: () => void; onRefresh: () => Promise<void>;
}): void {
	const panel = parent.createEl('aside', { cls: 'thread-journal-table-details', attr: { 'aria-label': t('Task details') } });
	const header = panel.createDiv({ cls: 'thread-journal-table-details-header' });
	const titles = header.createDiv();
	const row = rows.find(row => row.thread.id === selection.threadId);
	titles.createEl('strong', { text: row ? selection.filePath ? row.files.find(file => file.member.file.path === selection.filePath)?.member.file.basename ?? row.thread.title : row.thread.title : t('Total') });
	const filter = TABLE_TASK_BUTTONS.find(column => column.key === selection.filter);
	titles.createDiv({ cls: 'thread-journal-table-details-scope', text: filter ? t(filter.label) : t('All tasks') });
	const close = header.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': t('Close') } });
	setIcon(close, 'x'); close.addEventListener('click', context.onClose);
	const tasks = uniqueTableTasks(row ? [row] : rows).filter(({ task }) => (!selection.filePath || task.file.path === selection.filePath)
		&& tableTaskMatches(task.data, selection.filter, true, moment().format('YYYY-MM-DD')))
		.sort(compareBoardTasks);
	const list = panel.createDiv({ cls: 'thread-journal-table-details-list' });
	if (!tasks.length) list.createDiv({ cls: 'thread-journal-empty', text: t('No tasks in this state.') });
	const groups = new Map<string, typeof tasks>();
	for (const entry of tasks) {
		const key = `${entry.thread.id}:${entry.task.file.path}`;
		const group = groups.get(key) ?? [];
		group.push(entry); groups.set(key, group);
	}
	for (const group of groups.values()) {
		const first = group[0]!;
		const path = first.task.file.path;
		const member = first.member;
		const historical = member?.roleStatus === 'terminated';
		const external = !member && path !== first.thread.file.path;
		const section = list.createDiv({ cls: 'thread-journal-table-task-group' });
		const source = section.createDiv({ cls: 'thread-journal-table-task-source' });
		setIcon(source.createSpan(), external ? 'link' : 'file-text');
		source.createSpan({ text: row ? first.task.file.basename : `${first.owners.join(' / ')} · ${first.task.file.basename}`, attr: { title: path } });
		if (external || historical) source.createSpan({ text: t(external ? 'External tasks' : 'Terminated') });
		for (const { task, thread } of group) {
			const item = section.createDiv({ cls: 'thread-journal-overview-task' });
			renderThreadTaskItem(item, task, thread.file, {
				app: context.app, taskManager: context.taskManager, onRefresh: context.onRefresh,
				isFieldVisible: field => !historical || !['pin', 'actions', 'schedule'].includes(field),
			});
		}
	}
}
