import assert from 'node:assert/strict';
import test from 'node:test';
import type { App, Plugin, TFile as ObsidianFile } from 'obsidian';
import { TFile } from './obsidian-stub';
import { TaskHoldingService } from '../src/task-holding';
import { parseTaskLine } from '../src/task-model';

function fixture(initial: Record<string, string>) {
	const sources = new Map(Object.entries(initial));
	const files = [...sources.keys()].map(path => new TFile(path));
	const callbacks = new Map<string, ((file?: TFile) => void)[]>();
	const cleanups: (() => void)[] = [];
	let writes = 0;
	const emit = (event: string, file?: TFile): void => { for (const callback of callbacks.get(event) ?? []) callback(file); };
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: (file: TFile) => Promise.resolve(sources.get(file.path)!),
			process: (file: TFile, transform: (value: string) => string) => {
				const before = sources.get(file.path)!;
				const after = transform(before);
				if (before !== after) { sources.set(file.path, after); writes++; emit('modify', file); }
				return Promise.resolve();
			},
			on: (event: string, callback: (file?: TFile) => void) => {
				callbacks.set(event, [...(callbacks.get(event) ?? []), callback]);
				return {};
			},
		},
		workspace: { onLayoutReady: (callback: () => void) => callback() },
	} as unknown as App;
	// Timers are deliberately controlled; reconcile() is the actual production pass.
	Object.defineProperty(globalThis, 'window', { value: { setTimeout: () => 1, clearTimeout: () => undefined }, configurable: true });
	const plugin = { registerEvent: () => undefined, register: (callback: () => void) => cleanups.push(callback) } as unknown as Plugin;
	const service = new TaskHoldingService(app, () => undefined);
	service.register(plugin);
	return { app, service, sources, files, emit, writes: () => writes, stop: () => cleanups.forEach(callback => callback()) };
}

void test('startup releases all satisfied dependencies, preserving original state and task identity', async () => {
	const f = fixture({
		'a.md': '- [:] A [task_id:: task-aaaaaaaaaaaa] [holding:: true] [holding_review:: 2099-12-31] [holding_for:: task-bbbbbbbbbbbb]',
		'b.md': '- [x] B [task_id:: task-bbbbbbbbbbbb]',
	});
	await f.service.reconcile();
	const data = parseTaskLine(f.sources.get('a.md')!)!.data;
	assert.equal(data.status, 'committed');
	assert.equal(data.taskId, 'task-aaaaaaaaaaaa');
	assert.equal(data.holding, false);
	assert.deepEqual(data.holdingFor, []);
	assert.equal(data.holdingReview, '');
	assert.equal(f.writes(), 1);
	await f.service.reconcile();
	assert.equal(f.writes(), 1);
	// Reopening the source does not re-hold an already released task.
	f.sources.set('b.md', '- [ ] B [task_id:: task-bbbbbbbbbbbb]');
	f.emit('modify', f.files[1]);
	await f.service.reconcile();
	assert.equal(f.writes(), 1);
	f.stop();
});

void test('external task completion releases a dependency; manual date alone never does', async () => {
	const f = fixture({
		'a.md': '- [i] A [task_id:: task-aaaaaaaaaaaa] [holding:: true] [holding_for:: task-bbbbbbbbbbbb]',
		'b.md': '- [ ] B [task_id:: task-bbbbbbbbbbbb]',
		'c.md': '- [ ] C [task_id:: task-cccccccccccc] [holding:: true] [holding_review:: 2000-01-01]',
	});
	await f.service.reconcile();
	assert.equal(f.writes(), 0);
	f.sources.set('b.md', '- [x] B [task_id:: task-bbbbbbbbbbbb]');
	f.emit('modify', f.files[1]);
	await f.service.reconcile();
	assert.equal(parseTaskLine(f.sources.get('a.md')!)!.data.holding, false);
	assert.equal(parseTaskLine(f.sources.get('a.md')!)!.data.status, 'idea');
	assert.equal(parseTaskLine(f.sources.get('c.md')!)!.data.holding, true);
	f.stop();
});

void test('missing and duplicated IDs cannot trigger release and code samples do not duplicate IDs', async () => {
	const f = fixture({
		'a.md': '- [ ] A [task_id:: task-aaaaaaaaaaaa] [holding:: true] [holding_for:: task-bbbbbbbbbbbb]',
		'b.md': '```md\n- [x] B [task_id:: task-bbbbbbbbbbbb]\n```',
	});
	await f.service.reconcile();
	assert.equal(f.writes(), 0);
	f.sources.set('b.md', '- [x] B [task_id:: task-bbbbbbbbbbbb]\n- [x] Duplicate [task_id:: task-bbbbbbbbbbbb]');
	await f.service.reconcile();
	assert.equal(f.writes(), 0);
	f.sources.set('b.md', '```md\n- [ ] Example [task_id:: task-bbbbbbbbbbbb]\n```\n- [x] B [task_id:: task-bbbbbbbbbbbb]');
	await f.service.reconcile();
	assert.equal(f.writes(), 1);
	f.stop();
});

void test('an external completed recurring occurrence is recorded before advancing or restart', async () => {
	const f = fixture({ 'b.md': '- [x] B [task_id:: task-bbbbbbbbbbbb] [current:: 2026-09-23] [repeat:: FREQ=DAILY]' });
	await f.service.reconcile();
	assert.deepEqual(parseTaskLine(f.sources.get('b.md')!)!.data.completedOccurrences, ['2026-09-23']);
	await f.service.reconcile();
	assert.equal(f.writes(), 1);
	f.stop();
});

void test('a concurrent change during scanning prevents a stale automatic release', async () => {
	const f = fixture({
		'a.md': '- [:] A [task_id:: task-aaaaaaaaaaaa] [holding:: true] [holding_for:: task-bbbbbbbbbbbb]',
		'b.md': '- [x] B [task_id:: task-bbbbbbbbbbbb]',
	});
	const read = f.app.vault.cachedRead.bind(f.app.vault);
	let edited = false;
	f.app.vault.cachedRead = async (file: ObsidianFile) => {
		const snapshot = await read(file);
		if (!edited) {
			edited = true;
			f.sources.set('b.md', '- [ ] B [task_id:: task-bbbbbbbbbbbb]');
			f.emit('modify', f.files[1]);
		}
		return snapshot;
	};
	await f.service.reconcile();
	assert.equal(f.writes(), 0);
	await f.service.reconcile();
	assert.equal(f.writes(), 0);
	f.stop();
});

void test('plugin unload cancels reconciliation writes', async () => {
	const f = fixture({
		'a.md': '- [ ] A [task_id:: task-aaaaaaaaaaaa] [holding:: true] [holding_for:: task-bbbbbbbbbbbb]',
		'b.md': '- [x] B [task_id:: task-bbbbbbbbbbbb]',
	});
	f.stop();
	await f.service.reconcile();
	assert.equal(f.writes(), 0);
});
