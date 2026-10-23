import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocale } from '../src/i18n';
import { renderTableThreadRow, renderExplorerFileRow, type TableRowContext } from '../src/thread-table-rows';
import { emptyThreadTableCounts, type ThreadTableTreeRow } from '../src/thread-table-model';
import type { ThreadTableRow } from '../src/thread-table-data';
import { EMPTY_TASK } from '../src/task-model';

// Minimal event boundary: these tests check navigation and expansion, not browser layout.
class Element {
	children: Element[] = [];
	text = '';
	classes = '';
	attrs: Record<string, string> = {};
	style = { setProperty: () => {} };
	handlers = new Map<string, (event: MouseEvent) => void>();
	constructor(readonly tag = 'div') {}
	append(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): Element {
		const child = new Element(tag); child.classes = options.cls ?? ''; child.text = options.text ?? ''; child.attrs = options.attr ?? {};
		this.children.push(child); return child;
	}
	createEl(...args: Parameters<Element['append']>): Element { return this.append(...args); }
	createDiv(options?: { cls?: string; text?: string }): Element { return this.append('div', options); }
	createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): Element { return this.append('span', options); }
	setText(text: string): void { this.text = text; }
	setAttribute(key: string, value: string): void { this.attrs[key] = value; }
	toggleClass(): void {}
	addClass(): void {}
	remove(): void {}
	addEventListener(name: string, handler: (event: MouseEvent) => void): void { this.handlers.set(name, handler); }
	get childElementCount(): number { return this.children.length; }
	click(): void { this.handlers.get('click')?.({ preventDefault() {}, stopPropagation() {}, metaKey: false, ctrlKey: false } as MouseEvent); }
	find(predicate: (element: Element) => boolean): Element | undefined { return predicate(this) ? this : this.children.map(child => child.find(predicate)).find(Boolean); }
}

function fixture(): { data: ThreadTableRow; item: ThreadTableTreeRow; context: TableRowContext; events: string[] } {
	setLocale('en');
	const events: string[] = [];
	const file = { path: 'Member.md', basename: 'Member' } as never;
	const data: ThreadTableRow = { thread: { id: 'thread', title: 'Thread', status: 'active', file },
		counts: { ...emptyThreadTableCounts(), files: 1 }, files: [{ member: { file, threadId: 'thread', role: 'workspace', roleStatus: 'active', icon: '', attentionFallback: false }, counts: { ...emptyThreadTableCounts(), open: 1 } }],
		tasks: [{ file, line: 0, key: 'Member.md:0', text: 'Task', sourceLine: '- [ ] Task', data: EMPTY_TASK, pinned: false, disposition: 'ready' }] };
	const item: ThreadTableTreeRow = { depth: 0, ancestors: [], guides: [], last: true, node: { item: { id: 'thread', title: 'Thread', status: 'active' }, children: [], contextOnly: false } };
	const context: TableRowContext = { app: { workspace: { openLinkText: (path: string) => { events.push(`open:${path}`); return Promise.resolve(); } } } as never,
		childrenCollapsed: false, focus: () => { events.push('focus'); },
		toggleChildren: () => { events.push('toggle:thread'); }, select: selection => { events.push(`details:${selection.filter}`); },
		tasksExpanded: () => true, toggleTasks: path => { events.push(`toggle:${path}`); }, renderTasks: (_parent, path) => { events.push(`tasks:${path}`); } };
	return { data, item, context, events };
}

void test('thread rows are free-flowing divs and title focus does not open a note', () => {
	const { data, item, context, events } = fixture(); const parent = new Element();
	renderTableThreadRow(parent as never, item, data, context);
	assert.equal(parent.children[0]?.tag, 'div');
	assert.equal(parent.find(element => ['table', 'tr', 'td', 'th'].includes(element.tag)), undefined);
	parent.find(element => element.classes === 'thread-journal-table-thread-focus')!.click();
	assert.deepEqual(events, ['focus']);
	assert.equal(parent.find(element => element.classes.includes('thread-journal-tree-metadata')), undefined);
	parent.find(element => element.classes.includes('is-thread-toggle'))!.click();
	assert.deepEqual(events, ['focus', 'toggle:thread']);
});

void test('file rows keep navigation and task expansion without summary blocks', () => {
	const { data, item, context, events } = fixture(); const parent = new Element();
	renderExplorerFileRow(parent as never, { ...item, depth: 1, ancestors: ['thread'] }, data, data.files[0]!, context);
	assert.deepEqual(events, ['tasks:Member.md']); events.length = 0;
	const title = parent.find(element => element.classes === 'thread-journal-table-file-title')!;
	assert.equal(title.tag, 'a'); title.click();
	assert.deepEqual(events, ['open:Member.md']); events.length = 0;
	parent.find(element => element.attrs['aria-label'] === 'Tasks')!.click();
	assert.deepEqual(events, ['toggle:Member.md']);
	assert.equal(parent.find(element => element.classes.includes('thread-journal-tree-metadata')), undefined);
	assert.equal(parent.find(element => element.classes.includes('thread-journal-table-count')), undefined);
	assert.equal(parent.find(element => element.text === 'workspace'), undefined);
});
