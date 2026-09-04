import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	TFile,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import {
	checkpointEntriesForDate,
	parseCheckpointEntries,
	type ParsedCheckpointEntry,
} from './checkpoint-core';
import { checkpointFieldsForThread } from './checkpoint-model';
import { inlineLogEntriesForDate } from './inline-log';
import type { ThreadIndex } from './thread-index';
import { threadStatusLabel } from './thread-status-model';
import type { ThreadJournalSettings } from './types';

function sourceFile(app: App, ctx: MarkdownPostProcessorContext): TFile | undefined {
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	return file instanceof TFile ? file : undefined;
}

function dailyNoteDate(app: App, file: TFile): string | undefined {
	const rawDate: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.date;
	if (typeof rawDate === 'string') {
		const match = /\d{4}-\d{2}-\d{2}/.exec(rawDate);
		if (match) return match[0];
	}
	const fileMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(file.basename);
	return fileMatch?.[1];
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
			if (callout.querySelector('.thread-journal-source-checkpoint-controls')) return;
			const entry = entries[index];
			if (!entry?.blockId) return;
			const title = callout.querySelector<HTMLElement>('.callout-title');
			if (!title) return;
			const controls = title.createDiv({
				cls: 'thread-journal-source-checkpoint-controls',
			});
			const edit = controls.createEl('button', {
				text: '编辑',
				attr: { type: 'button', 'aria-label': '编辑当前 checkpoint' },
			});
			edit.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.onEditCheckpoint(current, entry);
			});
		});
	}

	async renderCheckpoints(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const current = sourceFile(this.app, ctx);
		if (!current) return;
		el.addClass('thread-journal-checkpoints');
		const thread = this.index.getThread(current);
		if (!thread) {
			el.createDiv({ cls: 'thread-journal-empty', text: '当前代码块不在主 thread 中。' });
			return;
		}
		const workspace = this.index.getWorkspace(current);
		if (!workspace) {
			el.createDiv({ cls: 'thread-journal-empty', text: '尚未找到配套工作区。' });
			return;
		}
		const content = await this.app.vault.cachedRead(workspace);
		const entries = parseCheckpointEntries(content)
			.sort((a, b) => checkpointTimestamp(b).localeCompare(checkpointTimestamp(a)));
		if (entries.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '暂无 checkpoint。' });
			return;
		}
		const rawFrontmatter: unknown = this.app.metadataCache
			.getFileCache(current)?.frontmatter;
		const ownFields = typeof rawFrontmatter === 'object' && rawFrontmatter !== null
			? (rawFrontmatter as Record<string, unknown>).checkpoint_fields
			: undefined;
		const fields = checkpointFieldsForThread(
			ownFields,
			this.getSettings().checkpointFields,
		);
		this.renderCheckpointCards(el, workspace, entries, fields, ctx.sourcePath);
	}

	async renderDailyCheckpoints(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const dailyFile = sourceFile(this.app, ctx);
		if (!dailyFile) return;
		el.addClass('thread-journal-daily-checkpoints');
		const date = dailyNoteDate(this.app, dailyFile);
		if (!date) {
			el.createDiv({ cls: 'thread-journal-empty', text: '无法确定当前日记日期。' });
			return;
		}

		const candidates = await Promise.all(this.index.getAllThreads().map(async (thread) => {
			const workspace = this.index.getWorkspace(thread.file);
			if (!workspace) return undefined;
			const content = await this.app.vault.cachedRead(workspace);
			const entries = checkpointEntriesForDate(content, date)
				.sort((a, b) => checkpointTimestamp(a).localeCompare(checkpointTimestamp(b)));
			if (entries.length === 0) return undefined;
			const rawFrontmatter: unknown = this.app.metadataCache
				.getFileCache(thread.file)?.frontmatter;
			const ownFields = typeof rawFrontmatter === 'object' && rawFrontmatter !== null
				? (rawFrontmatter as Record<string, unknown>).checkpoint_fields
				: undefined;
			return {
				thread,
				workspace,
				entries,
				fields: checkpointFieldsForThread(
					ownFields,
					this.getSettings().checkpointFields,
				),
			};
		}));
		const groups = candidates
			.filter((group): group is Exclude<(typeof candidates)[number], undefined> =>
				Boolean(group))
			.sort((a, b) => a.thread.title.localeCompare(b.thread.title));

		if (groups.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '今天没有 checkpoint。' });
			return;
		}

		for (const group of groups) {
			const section = el.createEl('details', {
				cls: 'thread-journal-daily-checkpoint-thread',
			});
			section.open = true;
			const summary = section.createEl('summary');
			addFileLink(
				this.app,
				summary,
				group.thread.file,
				ctx.sourcePath,
				group.thread.title,
			);
			summary.createSpan({
				cls: 'thread-journal-daily-checkpoint-count',
				text: `${group.entries.length} 条`,
			});
			const cards = section.createDiv({ cls: 'thread-journal-daily-checkpoint-cards' });
			this.renderCheckpointCards(
				cards,
				group.workspace,
				group.entries,
				group.fields,
				ctx.sourcePath,
			);
		}
	}

	async renderDailyLogs(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const dailyFile = sourceFile(this.app, ctx);
		if (!dailyFile) return;
		el.addClass('thread-journal-daily-logs');
		const date = dailyNoteDate(this.app, dailyFile);
		if (!date) {
			el.createDiv({ cls: 'thread-journal-empty', text: '无法确定当前日记日期。' });
			return;
		}

		const candidates = await Promise.all(this.index.getAllThreads().map(async (thread) => {
			const workspace = this.index.getWorkspace(thread.file);
			if (!workspace) return undefined;
			const content = await this.app.vault.cachedRead(workspace);
			const entries = inlineLogEntriesForDate(content, date);
			if (entries.length === 0) return undefined;
			return { thread, workspace, entries };
		}));
		const groups = candidates
			.filter((group): group is Exclude<(typeof candidates)[number], undefined> =>
				Boolean(group))
			.sort((a, b) => a.thread.title.localeCompare(b.thread.title));

		if (groups.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '今天没有 inline log。' });
			return;
		}

		for (const group of groups) {
			const section = el.createEl('details', {
				cls: 'thread-journal-daily-log-thread',
			});
			section.open = true;
			const summary = section.createEl('summary');
			addFileLink(
				this.app,
				summary,
				group.thread.file,
				ctx.sourcePath,
				group.thread.title,
			);
			const workspaceLink = summary.createSpan({
				cls: 'thread-journal-daily-log-source',
			});
			workspaceLink.createSpan({ text: ' · ' });
			addFileLink(
				this.app,
				workspaceLink,
				group.workspace,
				ctx.sourcePath,
				'工作区',
			);
			summary.createSpan({
				cls: 'thread-journal-daily-log-count',
				text: `${group.entries.length} 条`,
			});

			const cards = section.createDiv({ cls: 'thread-journal-daily-log-cards' });
			for (const entry of group.entries) {
				const card = cards.createDiv({ cls: 'thread-journal-daily-log-card' });
				card.createSpan({
					cls: 'thread-journal-daily-log-time',
					text: entry.time || entry.timestamp,
				});
				const content = card.createDiv({ cls: 'thread-journal-daily-log-content' });
				const child = new MarkdownRenderChild(content);
				ctx.addChild(child);
				await MarkdownRenderer.render(
					this.app,
					entry.text || '（空日志）',
					content,
					group.workspace.path,
					child,
				);
			}
		}
	}

	private renderCheckpointCards(
		container: HTMLElement,
		sourceFile: TFile,
		entries: ParsedCheckpointEntry[],
		fields: ThreadJournalSettings['checkpointFields'],
		renderSourcePath: string,
	): void {
		const knownKeys = new Set(fields.map((field) => field.key));
		const systemKeys = new Set(['checkpoint', 'checkpoint_date', 'checkpoint_time']);

		for (const entry of entries) {
			const card = container.createDiv({ cls: 'thread-journal-checkpoint-card' });
			const header = card.createDiv({ cls: 'thread-journal-checkpoint-card-header' });
			const date = entry.values.checkpoint_date || '未填写日期';
			const time = entry.values.checkpoint_time;
			header.createSpan({
				cls: 'thread-journal-checkpoint-card-date',
				text: time ? `${date} ${time}` : date,
			});
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

			const summary = entry.values.checkpoint_summary;
			if (summary) {
				card.createDiv({
					cls: 'thread-journal-checkpoint-card-summary',
					text: summary,
				});
			}

			const details = card.createDiv({ cls: 'thread-journal-checkpoint-card-fields' });
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
