import { parseCommitEntries } from './commit-core';
import { parseInlineLogEntries } from './inline-log';
import { scanTaskLines } from './task-holding-model';
import { taskIsScheduledToday, taskNeedsPinnedAttention, type TaskData } from './task-model';
import type { ThreadOverviewNode } from './thread-overview-model';

export interface ThreadTableCounts {
	files: number;
	children: number;
	open: number;
	committed: number;
	idea: number;
	completed: number;
	cancelled: number;
	holding: number;
	scheduled: number;
	pinned: number;
	commits: number;
	logs: number;
}

export function emptyThreadTableCounts(): ThreadTableCounts {
	return { files: 0, children: 0, open: 0, committed: 0, idea: 0, completed: 0,
		cancelled: 0, holding: 0, scheduled: 0, pinned: 0, commits: 0, logs: 0 };
}

export function countTableTask(counts: ThreadTableCounts, data: TaskData, today: string): void {
	counts[data.status]++;
	if (data.holding) counts.holding++;
	if (taskIsScheduledToday(data, today)) counts.scheduled++;
	if (taskNeedsPinnedAttention(data)) counts.pinned++;
}

// Keep original line numbers while removing YAML and code examples from record parsing.
function recordSource(content: string): string {
	let yaml = false;
	let fence = '';
	let fenceLength = 0;
	return content.split(/\r?\n/u).map((line, index) => {
		if (index === 0 && line.trim() === '---') { yaml = true; return ''; }
		if (yaml) {
			if (/^(---|\.\.\.)\s*$/u.test(line)) yaml = false;
			return '';
		}
		const body = line.replace(/^\s*(?:>\s*)+/u, '');
		const marker = /^\s*(`{3,}|~{3,})(.*)$/u.exec(body);
		if (marker) {
			if (!fence) { fence = marker[1]![0]!; fenceLength = marker[1]!.length; }
			else if (marker[1]![0] === fence && marker[1]!.length >= fenceLength && !marker[2]!.trim()) fence = '';
			return '';
		}
		if (fence || /^(?: {4}|\t)/u.test(line)) return '';
		return line;
	}).join('\n');
}

export function threadTableContent(content: string): {
	tasks: ReturnType<typeof scanTaskLines>;
	commits: number;
	logs: number;
} {
	const source = recordSource(content);
	return {
		tasks: scanTaskLines(content).filter(({ parsed, sourceLine }) =>
			[' ', '/', '+', '!', 'x', 'X', '-'].includes(parsed.marker)
			&& !/\[reference_task_id::/u.test(sourceLine)),
		commits: parseCommitEntries(source).length,
		logs: parseInlineLogEntries(source).length,
	};
}

export interface ThreadTableTreeRow {
	node: ThreadOverviewNode;
	depth: number;
	guides: boolean[];
	ancestors: string[];
	last: boolean;
}

export function flattenThreadTableTree(
	tree: readonly ThreadOverviewNode[],
	collapsed: ReadonlySet<string>,
): ThreadTableTreeRow[] {
	const result: ThreadTableTreeRow[] = [];
	const visit = (nodes: readonly ThreadOverviewNode[], depth: number, guides: boolean[], ancestors: string[]): void => {
		for (const [index, node] of nodes.entries()) {
			const last = index === nodes.length - 1;
			result.push({ node, depth, guides, ancestors, last });
			if (!collapsed.has(node.item.id)) {
				visit(node.children, depth + 1, depth ? [...guides, !last] : [], [...ancestors, node.item.id]);
			}
		}
	};
	visit(tree, 0, [], []);
	return result;
}

export type ThreadTableTaskFilter = 'all' | 'open' | 'committed' | 'idea' | 'completed' | 'cancelled' | 'holding' | 'scheduled' | 'pinned';

export function tableTaskMatches(data: TaskData, filter: ThreadTableTaskFilter, showEnded: boolean, today: string): boolean {
	if (filter === 'completed' || filter === 'cancelled') return data.status === filter;
	if (filter === 'all' && !showEnded && (data.status === 'completed' || data.status === 'cancelled')) return false;
	if (filter === 'all') return true;
	if (filter === 'holding') return data.holding;
	if (filter === 'scheduled') return taskIsScheduledToday(data, today);
	if (filter === 'pinned') return taskNeedsPinnedAttention(data);
	return data.status === filter;
}
