import type { App } from 'obsidian';
import type { TaskManager } from './task';
import { renderThreadTaskItem } from './thread-task-item';
import { compareExplorerTasks } from './thread-tree-task-order';
import { renderTreeGuides } from './thread-table-rows';
import type { ThreadTableRow } from './thread-table-data';
import type { ThreadTableTreeRow } from './thread-table-model';

export function renderTreeFileTasks(parent: HTMLElement, data: ThreadTableRow, filePath: string,
	item: Pick<ThreadTableTreeRow, 'guides' | 'ancestors' | 'depth' | 'last'>,
	context: { app: App; taskManager: TaskManager; onRefresh: () => Promise<void> }): void {
	const tasks = data.tasks.filter(task => task.file.path === filePath).sort((a, b) => compareExplorerTasks({ task: a, thread: data.thread }, { task: b, thread: data.thread }));
	const historical = data.files.find(file => file.member.file.path === filePath)?.member.roleStatus === 'terminated';
	for (const [index, task] of tasks.entries()) {
		const row = parent.createDiv({ cls: 'thread-journal-tree-row is-task' });
		const line = row.createDiv({ cls: 'thread-journal-table-name' });
		renderTreeGuides(line, { depth: item.depth + 1, guides: item.depth ? [...item.guides, !item.last] : [], ancestors: [...item.ancestors, filePath], last: index === tasks.length - 1 });
		const content = line.createDiv({ cls: 'thread-journal-overview-task thread-journal-tree-task' });
		renderThreadTaskItem(content, task, data.thread.file, { ...context,
			isFieldVisible: field => !historical || !['pin', 'actions', 'schedule'].includes(field),
		});
	}
}
