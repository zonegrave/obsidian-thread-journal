import { getFrontMatterInfo, parseYaml, TFile, type App } from 'obsidian';
import { stripWikiLink } from './core';
import { explorerOrder, type ExplorerNode } from './thread-explorer-order';

function identity(data: Record<string, unknown>): string { return JSON.stringify([data.type ?? null, data.thread_id ?? null, data.parent ?? null]); }
function matches(node: ExplorerNode, data: Record<string, unknown>): boolean {
	return data.thread_id === node.threadId && (node.kind === 'thread' ? data.type === 'thread' && stripWikiLink(data.parent) === node.parentLink : data.type !== 'thread');
}

// Preflight the whole sibling group; writes only affect explorer_order, never membership or content.
export async function persistExplorerOrder(app: App, siblings: readonly ExplorerNode[], changes: ReadonlyMap<string, number | undefined>): Promise<void> {
	if (!changes.size) return;
	const prepared: { file: TFile; node: ExplorerNode; previous: Record<string, unknown>; next: number | undefined }[] = [];
	for (const node of siblings) {
		const file = app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile) || file.extension !== 'md') throw new Error('A node no longer exists. Refresh and try again.');
		const info = getFrontMatterInfo(await app.vault.read(file));
		const data = info.exists ? parseYaml(info.frontmatter) as Record<string, unknown> | null : null;
		if (!data || !matches(node, data) || explorerOrder(data.explorer_order) !== node.order) throw new Error('The tree changed. Refresh and try again.');
		if (changes.has(node.path)) prepared.push({ file, node, previous: data, next: changes.get(node.path) });
	}
	if (prepared.length !== changes.size) throw new Error('The reorder scope changed. Refresh and try again.');
	const written: typeof prepared = [];
	try {
		for (const entry of prepared) {
			await app.fileManager.processFrontMatter(entry.file, (data: Record<string, unknown>) => {
				if (identity(data) !== identity(entry.previous) || JSON.stringify(data.explorer_order) !== JSON.stringify(entry.previous.explorer_order)) throw new Error('The node changed while saving.');
				if (entry.next === undefined) delete data.explorer_order; else data.explorer_order = entry.next;
			});
			written.push(entry);
		}
		for (const entry of written) {
			const info = getFrontMatterInfo(await app.vault.read(entry.file));
			const current = parseYaml(info.frontmatter) as Record<string, unknown>;
			if (!matches(entry.node, current) || current.explorer_order !== entry.next) throw new Error('The saved order could not be verified.');
		}
	} catch (error) {
		let rollbackFailed = false;
		for (const entry of written.reverse()) {
			try {
				await app.fileManager.processFrontMatter(entry.file, (data: Record<string, unknown>) => {
					if (identity(data) !== identity(entry.previous) || data.explorer_order !== entry.next) throw new Error('A concurrent change prevented rollback.');
					if (entry.previous.explorer_order === undefined) delete data.explorer_order; else data.explorer_order = entry.previous.explorer_order;
				});
			} catch { rollbackFailed = true; }
		}
		if (rollbackFailed) throw new Error(`${String(error)} Some node orders could not be restored; refresh to inspect the saved order.`);
		throw error;
	}
}
