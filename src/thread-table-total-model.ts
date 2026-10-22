import type { AttentionRowTask } from './thread-attention';
import type { ThreadInfo, ThreadMemberInfo } from './types';
import type { ThreadTableRow } from './thread-table-data';
import { countTableTask, emptyThreadTableCounts, type ThreadTableCounts } from './thread-table-model';

export interface TableTaskEntry { task: AttentionRowTask; thread: ThreadInfo; member?: ThreadMemberInfo; owners: string[] }

export function uniqueTableTasks(rows: readonly ThreadTableRow[]): TableTaskEntry[] {
	const tasks = new Map<string, TableTaskEntry>();
	for (const row of rows) for (const task of row.tasks) {
		const key = `${task.file.path}:${task.line}`;
		const previous = tasks.get(key);
		if (previous) { if (!previous.owners.includes(row.thread.title)) previous.owners.push(row.thread.title); continue; }
		tasks.set(key, { task, thread: row.thread, owners: [row.thread.title],
			member: row.files.find(file => file.member.file.path === task.file.path)?.member });
	}
	return [...tasks.values()];
}

export function totalThreadTable(rows: readonly ThreadTableRow[], today: string): ThreadTableCounts {
	const counts = emptyThreadTableCounts();
	const seen = new Set<string>();
	for (const row of rows) {
		if (seen.has(row.thread.id)) continue;
		seen.add(row.thread.id);
		counts.commits += row.counts.commits;
		counts.logs += row.counts.logs;
	}
	for (const { task } of uniqueTableTasks(rows)) countTableTask(counts, task.data, today);
	return counts;
}
