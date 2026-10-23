import { getFrontMatterInfo, parseYaml, type App } from 'obsidian';
import { explorerOrder } from './thread-explorer-order';
import type { ThreadIndex } from './thread-index';
import type { ThreadInfo, ThreadMemberInfo } from './types';
import type { AttentionRowTask } from './thread-attention';
import { buildRootedThreadOverviewTree } from './thread-overview-model';
import { countTableTask, emptyThreadTableCounts, threadTableContent, type ThreadTableCounts } from './thread-table-model';

export interface ThreadTableFileRow {
	member: ThreadMemberInfo;
	order?: number;
	counts: ThreadTableCounts;
}

export interface ThreadTableRow {
	thread: ThreadInfo;
	order?: number;
	parent?: string;
	counts: ThreadTableCounts;
	files: ThreadTableFileRow[];
	tasks: AttentionRowTask[];
}

export async function collectThreadTable(app: App, index: ThreadIndex, today: string): Promise<ThreadTableRow[]> {
	const threads = index.getAllThreads();
	const members = index.getAllMembers();
	const rows = new Map<string, ThreadTableRow>(threads.map(thread => [thread.id, {
		thread,
		parent: index.getParentFile(thread.file)
			? index.getThread(index.getParentFile(thread.file)!)?.id : undefined,
		counts: emptyThreadTableCounts(), files: [], tasks: [],
	}]));
	const fileRows = new Map<string, ThreadTableFileRow>();
	const owners = new Map(threads.map(thread => [thread.file.path, thread.id]));
	for (const member of members) {
		const row = rows.get(member.threadId);
		if (!row) continue;
		row.counts.files++;
		const fileRow = { member, counts: emptyThreadTableCounts() };
		row.files.push(fileRow);
		fileRows.set(member.file.path, fileRow);
		owners.set(member.file.path, member.threadId);
	}
	const candidates = app.vault.getMarkdownFiles().filter(file => owners.has(file.path)
		|| app.metadataCache.getFileCache(file)?.listItems?.some(item => item.task !== undefined));
	const contents = await Promise.all(candidates.map(async file => {
		const text = await app.vault.cachedRead(file);
		const info = getFrontMatterInfo(text);
		const frontmatter = owners.has(file.path) && info.exists ? parseYaml(info.frontmatter) as Record<string, unknown> | null : null;
		return { file, content: threadTableContent(text), order: explorerOrder(frontmatter?.explorer_order) };
	}));
	for (const { file, content, order } of contents) {
		const owner = owners.get(file.path);
		const row = owner ? rows.get(owner) : undefined;
		if (row) {
			row.order = order;
			row.counts.commits += content.commits;
			row.counts.logs += content.logs;
		}
		const fileRow = fileRows.get(file.path);
		if (fileRow) {
			fileRow.order = order;
			fileRow.counts.commits = content.commits;
			fileRow.counts.logs = content.logs;
			for (const task of content.tasks) countTableTask(fileRow.counts, task.parsed.data, today);
		}
		const links = app.metadataCache.getFileCache(file)?.links ?? [];
		for (const task of content.tasks) {
			const taskOwners = new Set(owner ? [owner] : []);
			if (!owner) for (const link of links) {
				if (link.position.start.line !== task.line) continue;
				const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
				const threadFile = target ? index.getThreadFile(target) : undefined;
				const id = threadFile ? index.getThread(threadFile)?.id : undefined;
				if (id) taskOwners.add(id);
			}
			for (const id of taskOwners) {
				const target = rows.get(id);
				if (!target) continue;
				const data = task.parsed.data;
				countTableTask(target.counts, data, today);
				target.tasks.push({
					key: `${file.path}:${task.line}`, file, line: task.line, sourceLine: task.sourceLine,
					text: data.content, data, pinned: data.pinned,
					disposition: data.holding ? 'holding' : data.status === 'idea' ? 'idea'
						: data.status === 'committed' ? 'committed' : 'ready',
				});
			}
		}
	}
	const tree = buildRootedThreadOverviewTree([...rows.values()].map(row => ({
		id: row.thread.id, title: row.thread.title, status: row.thread.status, parent: row.parent,
	})), new Set(threads.map(thread => thread.status)));
	const visit = (nodes: typeof tree): void => {
		for (const node of nodes) {
			const row = rows.get(node.item.id);
			if (row) row.counts.children = node.children.length;
			visit(node.children);
		}
	};
	visit(tree);
	for (const row of rows.values()) row.files.sort((a, b) => a.member.file.basename.localeCompare(b.member.file.basename));
	return [...rows.values()];
}
