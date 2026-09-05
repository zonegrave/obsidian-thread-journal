import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	TFile,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import {
	parseCheckpointEntries,
	type ParsedCheckpointEntry,
} from './checkpoint-core';
import { checkpointFieldsForThread } from './checkpoint-model';
import {
	parseThreadEntriesQuery,
	type ThreadEntryGroupBy,
} from './entry-query';
import { parseInlineLogEntries, type ParsedInlineLogEntry } from './inline-log';
import type { ThreadIndex } from './thread-index';
import { threadStatusLabel } from './thread-status-model';
import type { ThreadInfo, ThreadJournalSettings } from './types';

interface CheckpointEntryRecord {
	type: 'checkpoint';
	thread: ThreadInfo;
	workspace: TFile;
	date: string;
	time: string;
	timestamp: string;
	entry: ParsedCheckpointEntry;
	fields: ThreadJournalSettings['checkpointFields'];
}

interface LogEntryRecord {
	type: 'log';
	thread: ThreadInfo;
	workspace: TFile;
	date: string;
	time: string;
	timestamp: string;
	entry: ParsedInlineLogEntry;
}

type ThreadEntryRecord = CheckpointEntryRecord | LogEntryRecord;

function sourceFile(app: App, ctx: MarkdownPostProcessorContext): TFile | undefined {
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	return file instanceof TFile ? file : undefined;
}

function checkpointTimestamp(entry: ParsedCheckpointEntry): string {
	return `${entry.values.checkpoint_date ?? ''}T${entry.values.checkpoint_time ?? ''}`;
}

function addFileLink(
	app: App,
	container: HTMLElement,
	file: TFile,
	sourcePath: string,
	text?: string,
): void {
	const link = container.createEl('a', {
		text: text ?? file.basename,
		attr: { href: file.path },
	});
	link.addEventListener('click', (event) => {
		event.preventDefault();
		void app.workspace.openLinkText(file.path, sourcePath, event.metaKey || event.ctrlKey);
	});
}

export class ThreadRenderers {
	private readonly sourceCheckpointSignatures = new WeakMap<HTMLElement, string>();
	private readonly sourceLogSignatures = new WeakMap<HTMLElement, string>();

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
		private readonly onEditCheckpoint: (
			file: TFile,
			entry: ParsedCheckpointEntry,
		) => void,
		private readonly onDeleteCheckpoint: (
			file: TFile,
			entry: ParsedCheckpointEntry,
		) => void,
	) {}

	renderBreadcrumb(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		const current = sourceFile(this.app, ctx);
		if (!current) return;
		const ancestry = this.index.getAncestors(current);
		el.addClass('thread-journal-breadcrumb');
		ancestry.items.forEach((item, index) => {
			if (index > 0) el.createSpan({ cls: 'thread-journal-separator', text: '›' });
			addFileLink(this.app, el, item.file, ctx.sourcePath, item.label);
		});
		const workspace = this.index.getWorkspace(current);
		if (workspace) {
			if (ancestry.items.length > 0) {
				el.createSpan({ cls: 'thread-journal-separator', text: '·' });
			}
			const workspaceLink = el.createSpan({ cls: 'thread-journal-workspace-link' });
			addFileLink(this.app, workspaceLink, workspace, ctx.sourcePath, '工作区');
		}
		if (ancestry.cycle) {
			el.createSpan({ cls: 'thread-journal-warning', text: '检测到父线程循环' });
		}
	}

	renderChildren(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		const current = sourceFile(this.app, ctx);
		if (!current) return;
		const children = this.index.getDirectChildren(current);
		el.addClass('thread-journal-children');
		if (children.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '暂无子 thread。' });
			return;
		}
		const list = el.createEl('ul');
		for (const child of children) {
			const item = list.createEl('li');
			addFileLink(this.app, item, child.file, ctx.sourcePath, child.title);
			item.createSpan({
				cls: 'thread-journal-meta',
				text: `${child.kind} · ${threadStatusLabel(child.status)}`,
			});
		}
	}

	enhanceCheckpointCallouts(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): void {
		const current = sourceFile(this.app, ctx);
		if (!current || !this.index.getThreadForWorkspace(current)) return;
		const selector = '.callout[data-callout="thread-checkpoint"]';
		const callouts = [
			...(el.matches(selector) ? [el] : []),
			...Array.from(el.querySelectorAll<HTMLElement>(selector)),
		];
		if (callouts.length === 0) return;
		const section = ctx.getSectionInfo(el);
		if (!section) return;
		const entries = parseCheckpointEntries(section.text);
		callouts.forEach((callout, index) => {
			const entry = entries[index];
			if (!entry?.blockId) return;
			this.renderSourceCheckpointCallout(callout, current, entry);
		});
	}

	enhanceLogCallouts(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): void {
		const current = sourceFile(this.app, ctx);
		if (!current || !this.index.getThreadForWorkspace(current)) return;
		const selector = '.callout[data-callout="thread-log"]';
		const callouts = [
			...(el.matches(selector) ? [el] : []),
			...Array.from(el.querySelectorAll<HTMLElement>(selector)),
		];
		if (callouts.length === 0) return;
		const section = ctx.getSectionInfo(el);
		if (!section) return;
		const entries = parseInlineLogEntries(section.text);
		callouts.forEach((callout, index) => {
			const entry = entries[index];
			if (!entry) return;
			this.renderSourceLogCallout(callout, current, entry);
		});
	}

	renderSourceCheckpointCallout(
		callout: HTMLElement,
		workspace: TFile,
		entry: ParsedCheckpointEntry,
	): void {
		const thread = this.index.getThreadForWorkspace(workspace);
		if (!thread) return;
		const fields = this.checkpointFields(thread);
		const signature = JSON.stringify([entry, fields]);
		if (this.sourceCheckpointSignatures.get(callout) === signature) return;
		const title = callout.querySelector<HTMLElement>('.callout-title');
		const titleInner = title?.querySelector<HTMLElement>('.callout-title-inner');
		const content = callout.querySelector<HTMLElement>('.callout-content');
		if (!title || !titleInner || !content) return;
		this.sourceCheckpointSignatures.set(callout, signature);
		callout.addClass('thread-journal-source-checkpoint-card');

		const date = entry.values.checkpoint_date || '未填写日期';
		const time = entry.values.checkpoint_time;
		titleInner.setText(time ? `${date} ${time}` : date);
		title.querySelector('.thread-journal-source-checkpoint-controls')?.remove();
		const controls = title.createDiv({
			cls: [
				'thread-journal-source-checkpoint-controls',
				'thread-journal-checkpoint-card-controls',
			],
		});
		const kind = entry.values.checkpoint_kind;
		if (kind) {
			controls.createSpan({ cls: 'thread-journal-checkpoint-card-kind', text: kind });
		}
		const edit = controls.createEl('button', {
			cls: 'thread-journal-checkpoint-edit',
			text: '编辑',
			attr: { type: 'button', 'aria-label': '编辑当前 checkpoint' },
		});
		edit.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		edit.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.onEditCheckpoint(workspace, entry);
		});

		content.empty();
		this.renderCheckpointContent(content, entry, fields);
	}

	renderSourceLogCallout(
		callout: HTMLElement,
		_workspace: TFile,
		entry: ParsedInlineLogEntry,
	): void {
		const signature = JSON.stringify(entry);
		if (this.sourceLogSignatures.get(callout) === signature) return;
		const title = callout.querySelector<HTMLElement>('.callout-title');
		const titleInner = title?.querySelector<HTMLElement>('.callout-title-inner');
		const content = callout.querySelector<HTMLElement>('.callout-content');
		if (!title || !titleInner || !content) return;
		this.sourceLogSignatures.set(callout, signature);
		callout.addClass('thread-journal-source-log-card');

		const compactDate = entry.date.slice(5) || entry.date;
		titleInner.setText(entry.time ? `${compactDate} ${entry.time}` : compactDate);
		title.querySelector('.thread-journal-source-log-controls')?.remove();
		const controls = title.createDiv({
			cls: [
				'thread-journal-source-log-controls',
				'thread-journal-log-card-controls',
			],
		});
		controls.createSpan({ cls: 'thread-journal-log-card-kind', text: 'log' });
	}

	async renderEntries(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const current = sourceFile(this.app, ctx);
		if (!current) return;
		el.addClass('thread-journal-entries');
		const parsed = parseThreadEntriesQuery(source);
		if (parsed.errors.length > 0) {
			this.renderEntryQueryErrors(el, parsed.errors);
			return;
		}

		const errors: string[] = [];
		let threads = this.index.getAllThreads();
		if (parsed.query.threadIds) {
			const uniqueIds = [...new Set(parsed.query.threadIds)];
			threads = uniqueIds.flatMap((id) => {
				const thread = this.index.getThreadById(id);
				if (!thread) {
					errors.push(`找不到 thread_id: ${id}。`);
					return [];
				}
				return [thread];
			});
		}

		const date = parsed.query.date;
		if (errors.length > 0) {
			this.renderEntryQueryErrors(el, errors);
			return;
		}

		const records = (await Promise.all(threads.map(async (thread) => {
			const workspace = this.index.getWorkspace(thread.file);
			if (!workspace) return [];
			const content = await this.app.vault.cachedRead(workspace);
			const entries: ThreadEntryRecord[] = [];
			if (parsed.query.types.includes('checkpoint')) {
				const fields = this.checkpointFields(thread.file);
				for (const entry of parseCheckpointEntries(content)) {
					const entryDate = entry.values.checkpoint_date ?? '';
					if (date && (entryDate < date.from || entryDate > date.to)) continue;
					entries.push({
						type: 'checkpoint',
						thread,
						workspace,
						date: entryDate,
						time: entry.values.checkpoint_time ?? '',
						timestamp: checkpointTimestamp(entry),
						entry,
						fields,
					});
				}
			}
			if (parsed.query.types.includes('log')) {
				for (const entry of parseInlineLogEntries(content)) {
					if (date && (entry.date < date.from || entry.date > date.to)) continue;
					entries.push({
						type: 'log',
						thread,
						workspace,
						date: entry.date,
						time: entry.time,
						timestamp: entry.timestamp,
						entry,
					});
				}
			}
			return entries;
		}))).flat();

		const direction = date ? 1 : -1;
		records.sort((a, b) => {
			const timestamp = direction * a.timestamp.localeCompare(b.timestamp);
			return timestamp || a.thread.title.localeCompare(b.thread.title);
		});
		if (records.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '没有符合条件的记录。' });
			return;
		}
		await this.renderEntryResults(
			el,
			records,
			parsed.query.groupBy,
			ctx,
			Boolean(date && date.from === date.to),
		);
	}

	private checkpointFields(thread: TFile): ThreadJournalSettings['checkpointFields'] {
		const rawFrontmatter: unknown = this.app.metadataCache
			.getFileCache(thread)?.frontmatter;
		const ownFields = typeof rawFrontmatter === 'object' && rawFrontmatter !== null
			? (rawFrontmatter as Record<string, unknown>).checkpoint_fields
			: undefined;
		return checkpointFieldsForThread(
			ownFields,
			this.getSettings().checkpointFields,
		);
	}

	private renderEntryQueryErrors(container: HTMLElement, errors: string[]): void {
		const warning = container.createDiv({ cls: 'thread-journal-entry-query-error' });
		warning.createDiv({ text: '记录查询无法执行：' });
		const list = warning.createEl('ul');
		for (const error of errors) list.createEl('li', { text: error });
	}

	private async renderEntryResults(
		container: HTMLElement,
		records: ThreadEntryRecord[],
		groupBy: ThreadEntryGroupBy,
		ctx: MarkdownPostProcessorContext,
		dateFiltered: boolean,
	): Promise<void> {
		if (groupBy === 'thread') {
			const groups = new Map<string, ThreadEntryRecord[]>();
			for (const record of records) {
				const group = groups.get(record.thread.id) ?? [];
				group.push(record);
				groups.set(record.thread.id, group);
			}
			const sorted = [...groups.values()].sort((a, b) =>
				(a[0]?.thread.title ?? '').localeCompare(b[0]?.thread.title ?? ''));
			for (const group of sorted) {
				const first = group[0];
				if (!first) continue;
				const section = this.createEntryGroup(container);
				const summary = section.createEl('summary');
				addFileLink(
					this.app,
					summary,
					first.thread.file,
					ctx.sourcePath,
					first.thread.title,
				);
				const source = summary.createSpan({ cls: 'thread-journal-entry-source' });
				source.createSpan({ text: ' · ' });
				addFileLink(
					this.app,
					source,
					first.workspace,
					ctx.sourcePath,
					'工作区',
				);
				this.addEntryCount(summary, group.length);
				const cards = section.createDiv({ cls: 'thread-journal-entry-cards' });
				await this.renderEntryCards(cards, group, ctx, dateFiltered, false);
			}
			return;
		}

		if (groupBy === 'type') {
			for (const type of ['checkpoint', 'log'] as const) {
				const group = records.filter((record) => record.type === type);
				if (group.length === 0) continue;
				const section = this.createEntryGroup(container);
				const summary = section.createEl('summary', {
					text: type === 'checkpoint' ? 'Checkpoint' : 'Log',
				});
				this.addEntryCount(summary, group.length);
				const cards = section.createDiv({ cls: 'thread-journal-entry-cards' });
				await this.renderEntryCards(cards, group, ctx, dateFiltered, true);
			}
			return;
		}

		const cards = container.createDiv({ cls: 'thread-journal-entry-cards' });
		const showThread = new Set(records.map((record) => record.thread.id)).size > 1;
		await this.renderEntryCards(cards, records, ctx, dateFiltered, showThread);
	}

	private createEntryGroup(container: HTMLElement): HTMLDetailsElement {
		const section = container.createEl('details', { cls: 'thread-journal-entry-group' });
		section.open = true;
		return section;
	}

	private addEntryCount(container: HTMLElement, count: number): void {
		container.createSpan({ cls: 'thread-journal-entry-count', text: `${count} 条` });
	}

	private async renderEntryCards(
		container: HTMLElement,
		records: ThreadEntryRecord[],
		ctx: MarkdownPostProcessorContext,
		dateFiltered: boolean,
		showThread: boolean,
	): Promise<void> {
		for (const record of records) {
			if (record.type === 'checkpoint') {
				this.renderCheckpointCards(
					container,
					record.workspace,
					[record.entry],
					record.fields,
					ctx.sourcePath,
					showThread ? record.thread : undefined,
				);
				continue;
			}
			await this.renderLogCard(
				container,
				record,
				ctx,
				dateFiltered,
				showThread,
			);
		}
	}

	private async renderLogCard(
		container: HTMLElement,
		record: LogEntryRecord,
		ctx: MarkdownPostProcessorContext,
		dateFiltered: boolean,
		showThread: boolean,
	): Promise<void> {
		const card = container.createDiv({ cls: 'thread-journal-log-card' });
		const header = card.createDiv({ cls: 'thread-journal-log-card-header' });
		const identity = header.createDiv({ cls: 'thread-journal-log-card-identity' });
		identity.createSpan({
			cls: 'thread-journal-log-card-date',
			text: dateFiltered
				? record.time || record.timestamp
				: `${record.date}${record.time ? ` ${record.time}` : ''}`,
		});
		if (showThread) {
			identity.createSpan({ cls: 'thread-journal-entry-separator', text: '·' });
			const thread = identity.createSpan({ cls: 'thread-journal-entry-thread' });
			addFileLink(
				this.app,
				thread,
				record.thread.file,
				ctx.sourcePath,
				record.thread.title,
			);
		}
		const controls = header.createDiv({ cls: 'thread-journal-log-card-controls' });
		controls.createSpan({ cls: 'thread-journal-log-card-kind', text: 'log' });
		const blockId = record.entry.blockId;
		const locate = controls.createEl('a', {
			cls: 'thread-journal-log-locate',
			text: '定位',
			attr: {
				href: `${record.workspace.path}#^${blockId}`,
				'aria-label': '在工作区中定位 log',
			},
		});
		locate.addEventListener('click', (event) => {
			event.preventDefault();
			void this.app.workspace.openLinkText(
				`${record.workspace.path}#^${blockId}`,
				ctx.sourcePath,
				event.metaKey || event.ctrlKey,
			);
		});
		const content = card.createDiv({ cls: 'thread-journal-log-content' });
		const child = new MarkdownRenderChild(content);
		ctx.addChild(child);
		await MarkdownRenderer.render(
			this.app,
			record.entry.text || '（空日志）',
			content,
			record.workspace.path,
			child,
		);
	}

	private renderCheckpointCards(
		container: HTMLElement,
		sourceFile: TFile,
		entries: ParsedCheckpointEntry[],
		fields: ThreadJournalSettings['checkpointFields'],
		renderSourcePath: string,
		thread?: ThreadInfo,
	): void {
		for (const entry of entries) {
			const card = container.createDiv({ cls: 'thread-journal-checkpoint-card' });
			const header = card.createDiv({ cls: 'thread-journal-checkpoint-card-header' });
			const identity = header.createDiv({
				cls: 'thread-journal-checkpoint-card-identity',
			});
			const date = entry.values.checkpoint_date || '未填写日期';
			const time = entry.values.checkpoint_time;
			identity.createSpan({
				cls: 'thread-journal-checkpoint-card-date',
				text: time ? `${date} ${time}` : date,
			});
			if (thread) {
				identity.createSpan({ cls: 'thread-journal-entry-separator', text: '·' });
				const threadLink = identity.createSpan({ cls: 'thread-journal-entry-thread' });
				addFileLink(
					this.app,
					threadLink,
					thread.file,
					renderSourcePath,
					thread.title,
				);
			}
			const controls = header.createDiv({ cls: 'thread-journal-checkpoint-card-controls' });
			const kind = entry.values.checkpoint_kind;
			if (kind) controls.createSpan({ cls: 'thread-journal-checkpoint-card-kind', text: kind });
			if (entry.blockId) {
				const blockId = entry.blockId;
				const locate = controls.createEl('a', {
					cls: 'thread-journal-checkpoint-locate',
					text: '定位',
					attr: {
						href: `${sourceFile.path}#^${blockId}`,
						'aria-label': '在工作区中定位 checkpoint',
					},
				});
				locate.addEventListener('click', (event) => {
					event.preventDefault();
					void this.app.workspace.openLinkText(
						`${sourceFile.path}#^${blockId}`,
						renderSourcePath,
						event.metaKey || event.ctrlKey,
					);
				});
				const edit = controls.createEl('button', {
					cls: 'thread-journal-checkpoint-edit',
					text: '编辑',
					attr: { type: 'button', 'aria-label': '编辑 checkpoint' },
				});
				edit.addEventListener('click', () => {
					this.onEditCheckpoint(sourceFile, entry);
				});
				const remove = controls.createEl('button', {
					cls: 'thread-journal-checkpoint-delete',
					text: '删除',
					attr: { type: 'button', 'aria-label': '删除 checkpoint' },
				});
				remove.addEventListener('click', () => {
					this.onDeleteCheckpoint(sourceFile, entry);
				});
			}

			this.renderCheckpointContent(card, entry, fields);
		}
	}

	private renderCheckpointContent(
		container: HTMLElement,
		entry: ParsedCheckpointEntry,
		fields: ThreadJournalSettings['checkpointFields'],
	): void {
		const knownKeys = new Set(fields.map((field) => field.key));
		const systemKeys = new Set(['checkpoint', 'checkpoint_date', 'checkpoint_time']);
		const summary = entry.values.checkpoint_summary;
		if (summary) {
			container.createDiv({
				cls: 'thread-journal-checkpoint-card-summary',
				text: summary,
			});
		}

		const details = container.createDiv({ cls: 'thread-journal-checkpoint-card-fields' });
		let detailCount = 0;
		for (const field of fields) {
			if (field.key === 'checkpoint_kind' || field.key === 'checkpoint_summary') continue;
			const bodyValue = entry.body.find((item) => item.label === field.label)?.value;
			const value = entry.values[field.key] || bodyValue;
			if (!value) continue;
			this.renderCheckpointField(details, field.label, value);
			detailCount += 1;
		}
		for (const [key, value] of Object.entries(entry.values)) {
			if (systemKeys.has(key) || knownKeys.has(key) || !value) continue;
			this.renderCheckpointField(details, key, value);
			detailCount += 1;
		}
		for (const body of entry.body) {
			if (fields.some((field) => field.storage === 'body' && field.label === body.label)) {
				continue;
			}
			this.renderCheckpointField(details, body.label, body.value);
			detailCount += 1;
		}
		if (detailCount === 0) details.remove();
	}

	private renderCheckpointField(
		container: HTMLElement,
		label: string,
		value: string,
	): void {
		const row = container.createDiv({ cls: 'thread-journal-checkpoint-card-field' });
		row.createSpan({ cls: 'thread-journal-checkpoint-card-field-label', text: label });
		row.createSpan({ cls: 'thread-journal-checkpoint-card-field-value', text: value });
	}
}
