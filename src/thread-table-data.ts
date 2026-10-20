import type { App } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import type { ThreadInfo } from './types';
import { buildRootedThreadOverviewTree } from './thread-overview-model';
import { countTableTask, emptyThreadTableCounts, threadTableContent, type ThreadTableCounts } from './thread-table-model';

export interface ThreadTableRow {
	thread: ThreadInfo;
	parent?: string;
	counts: ThreadTableCounts;
}

export async function collectThreadTable(app: App, index: ThreadIndex): Promise<ThreadTableRow[]> {
	const threads = index.getAllThreads();
	const members = index.getAllMembers();
	const rows = new Map(threads.map(thread => [thread.id, {
		thread,
		parent: index.getParentFile(thread.file)
			? index.getThread(index.getParentFile(thread.file)!)?.id : undefined,
		counts: emptyThreadTableCounts(),
	}]));
	const owners = new Map(threads.map(thread => [thread.file.path, thread.id]));
	for (const member of members) {
		const row = rows.get(member.threadId);
		if (!row) continue;
		row.counts.files++;
		owners.set(member.file.path, member.threadId);
	}
	const candidates = app.vault.getMarkdownFiles().filter(file => owners.has(file.path)
		|| app.metadataCache.getFileCache(file)?.listItems?.some(item => item.task !== undefined));
	const contents = await Promise.all(candidates.map(async file => ({
		file, content: threadTableContent(await app.vault.cachedRead(file)),
	})));
	for (const { file, content } of contents) {
		const owner = owners.get(file.path);
		const row = owner ? rows.get(owner) : undefined;
		if (row) {
			row.counts.commits += content.commits;
			row.counts.logs += content.logs;
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
				const counts = rows.get(id)?.counts;
				if (counts) countTableTask(counts, task.parsed.data);
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
	return [...rows.values()];
}
