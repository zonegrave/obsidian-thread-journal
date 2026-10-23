import assert from 'node:assert/strict';
import test from 'node:test';
import { parse, stringify } from 'yaml';
import { TFile, type App } from 'obsidian';
import { persistExplorerOrder } from '../src/thread-explorer-order-service';
import { compareExplorerNodes, explorerMovePlan, explorerOrder, type ExplorerNode } from '../src/thread-explorer-order';

function fixture() {
	const contents = new Map([
		['A.md', '---\ntype: thread\nthread_id: A\nparent: "[[Parent]]"\naliases: [A]\n---\nBody A\n'],
		['B.md', '---\nthread_id: Parent\nthread_role: workspace\ncustom: keep\n---\n- [ ] Original task\n'],
		['C.md', '---\ntype: thread\nthread_id: C\nparent: "[[Parent]]"\n---\nBody C\n'],
	]);
	const files = new Map([...contents.keys()].map(path => [path, Object.assign(new TFile(), { path, extension: 'md' })]));
	const nodes: ExplorerNode[] = [
		{ key: 'thread:A', kind: 'thread', threadId: 'A', parent: 'Parent', parentLink: 'Parent', path: 'A.md', title: 'A' },
		{ key: 'file:B.md', kind: 'file', threadId: 'Parent', parent: 'Parent', path: 'B.md', title: 'B' },
		{ key: 'thread:C', kind: 'thread', threadId: 'C', parent: 'Parent', parentLink: 'Parent', path: 'C.md', title: 'C' },
	];
	let writes = 0;
	let beforeWrite: ((path: string, attempt: number) => void) | undefined;
	const state = (path: string): Record<string, unknown> => parse(/^---\n([\s\S]*?)\n---\n/u.exec(contents.get(path)!)![1]!) as Record<string, unknown>;
	const app = {
		vault: { getAbstractFileByPath: (path: string) => files.get(path), read: (file: TFile) => Promise.resolve(contents.get(file.path)!) },
		fileManager: { processFrontMatter: (file: TFile, change: (data: Record<string, unknown>) => void) => {
			writes++; beforeWrite?.(file.path, writes);
			const text = contents.get(file.path)!; const data = state(file.path); change(data);
			contents.set(file.path, `---\n${stringify(data)}---\n${text.replace(/^---\n[\s\S]*?\n---\n/u, '')}`);
			return Promise.resolve();
		} },
	};
	return { app: app as unknown as App, nodes, contents, state, writes: () => writes, inject: (callback: typeof beforeWrite) => { beforeWrite = callback; } };
}

void test('mixed sibling order survives frontmatter reload without modifying task text or membership', async () => {
	const f = fixture(); const original = new Map(f.nodes.map(node => [node.path, f.state(node.path)]));
	const plan = explorerMovePlan(f.nodes, 'thread:C', 'thread:A', 'before');
	await persistExplorerOrder(f.app, f.nodes, plan);
	const reloaded = f.nodes.map(node => ({ ...node, order: explorerOrder(f.state(node.path).explorer_order) })).sort(compareExplorerNodes);
	assert.deepEqual(reloaded.map(node => node.key), ['file:B.md', 'thread:C', 'thread:A']);
	for (const node of f.nodes) {
		const data = { ...f.state(node.path) }; delete data.explorer_order;
		assert.deepEqual(data, original.get(node.path));
	}
	assert.ok(f.contents.get('B.md')?.endsWith('- [ ] Original task\n'));
	await persistExplorerOrder(f.app, reloaded, new Map(reloaded.map(node => [node.path, undefined])));
	assert.equal(f.nodes.some(node => 'explorer_order' in f.state(node.path)), false);
});

void test('stale sibling membership aborts before any write', async () => {
	const f = fixture(); f.contents.set('B.md', f.contents.get('B.md')!.replace('thread_id: Parent', 'thread_id: Other'));
	await assert.rejects(persistExplorerOrder(f.app, f.nodes, new Map([['A.md', 1000]])), /tree changed/u);
	assert.equal(f.writes(), 0);
});

void test('partial save failure restores the previously written ranks', async () => {
	const f = fixture();
	f.inject((_path, attempt) => { if (attempt === 2) throw new Error('Disk failure'); });
	await assert.rejects(persistExplorerOrder(f.app, f.nodes, new Map([['A.md', 1000], ['B.md', 2000]])), /Disk failure/u);
	assert.equal(f.nodes.some(node => 'explorer_order' in f.state(node.path)), false);
	assert.ok(f.contents.get('B.md')?.includes('Original task'));
});

void test('a concurrent edit between preflight and write is preserved and rejects the move', async () => {
	const f = fixture();
	f.inject((path, attempt) => { if (attempt === 1) f.contents.set(path, f.contents.get(path)!.replace('thread_id: A', 'thread_id: Changed')); });
	await assert.rejects(persistExplorerOrder(f.app, f.nodes, new Map([['A.md', 1000]])), /node changed/u);
	assert.equal(f.state('A.md').thread_id, 'Changed');
	assert.equal(f.state('A.md').explorer_order, undefined);
});
