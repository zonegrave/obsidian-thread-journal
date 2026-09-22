import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	moment,
	setIcon,
	TFile,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import {
	parseCheckpointEntries,
	type ParsedCheckpointEntry,
} from './checkpoint-core';
import {
	checkpointBodyLabels,
	checkpointFieldRenderMode,
	checkpointFieldsForThread,
	type CheckpointFieldRenderMode,
} from './checkpoint-model';
import {
	compareThreadEntryTimestamps,
	formatThreadEntryTimestamp,
	parseThreadEntriesQuery,
	type ThreadEntryDetail,
	type ThreadEntryGroupBy,
} from './entry-query';
import {
	parseInlineLogEntries,
	parseInlineLogEntrySlots,
	type ParsedInlineLogEntry,
} from './inline-log';
import type { ThreadIndex } from './thread-index';
import { threadStatusLabel } from './thread-status-model';
import { t } from './i18n';
import type { TaskManager } from './task';
import {
	TASK_EFFORT_LABELS,
	taskDeadlineDisplay,
	taskNextActionLabel,
	taskRepeatRuleDisplay,
} from './task-display';
import {
	parseTaskLine,
	taskCurrentLabel,
	type TaskData,
} from './task-model';
import type { ThreadInfo, ThreadJournalSettings } from './types';

interface CheckpointEntryRecord {
	type: 'checkpoint';
	thread: ThreadInfo;
	memberFile: TFile;
	date: string;
	time: string;
	timestamp: string;
	entry: ParsedCheckpointEntry;
	fields: ThreadJournalSettings['checkpointFields'];
}

interface LogEntryRecord {
	type: 'log';
	thread: ThreadInfo;
	memberFile: TFile;
	date: string;
	time: string;
	timestamp: string;
	entry: ParsedInlineLogEntry;
}

type ThreadEntryRecord = CheckpointEntryRecord | LogEntryRecord;
type MarkdownChildRegistrar = (child: MarkdownRenderChild) => void;

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
	private readonly sourceTaskSignatures = new WeakMap<HTMLElement, string>();

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
		private readonly taskManager: TaskManager,
		private readonly onEditCheckpoint: (
			file: TFile,
			entry: ParsedCheckpointEntry,
		) => void,
		private readonly onDeleteCheckpoint: (
			file: TFile,
			entry: ParsedCheckpointEntry,
		) => void,
	) {}

	async enhanceTasks(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
		const current = sourceFile(this.app, ctx);
		if (!current || !this.index.getThreadFile(current)) return;
		const section = ctx.getSectionInfo(el);
		if (!section) return;
		const sourceTasks = section.text.split(/\r?\n/u).flatMap((sourceLine, index) => {
			const parsed = parseTaskLine(sourceLine);
			return parsed ? [{ sourceLine, parsed, line: section.lineStart + index }] : [];
		});
		const selector = 'li.task-list-item';
		const taskElements = [
			...(el.matches(selector) ? [el] : []),
			...Array.from(el.querySelectorAll<HTMLElement>(selector)),
		];
		if (sourceTasks.length !== taskElements.length) return;
		for (let index = 0; index < sourceTasks.length; index += 1) {
			const source = sourceTasks[index];
			const task = taskElements[index];
			if (!source || !task) continue;
			const signature = JSON.stringify(source.parsed);
			if (this.sourceTaskSignatures.get(task) === signature) continue;
			this.sourceTaskSignatures.set(task, signature);
			await this.renderSourceTask(
				task,
				current,
				source.line,
				source.sourceLine,
				source.parsed.data,
				(child) => ctx.addChild(child),
			);
		}
	}

	private async renderSourceTask(
		item: HTMLElement,
		file: TFile,
		line: number,
		sourceLine: string,
		data: TaskData,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		const checkbox = Array.from(item.children)
			.find((child) => child.matches('input.task-list-item-checkbox')) as HTMLInputElement | undefined
			?? item.querySelector<HTMLInputElement>('input.task-list-item-checkbox');
		if (!checkbox) return;
		const nestedLists = Array.from(item.children)
			.filter((child) => child.tagName === 'UL' || child.tagName === 'OL') as HTMLElement[];
		item.empty();
		item.addClass('thread-journal-source-task');
		item.appendChild(checkbox);
		const card = item.createDiv({ cls: 'thread-journal-source-task-card' });
		let pinned = data.pinned;
		const pin = card.createEl('button', {
			cls: `clickable-icon thread-journal-source-task-pin${pinned ? ' is-pinned' : ''}`,
			attr: { type: 'button' },
		});
		const updatePin = (): void => {
			pin.toggleClass('is-pinned', pinned);
			pin.setAttribute('aria-pressed', String(pinned));
			const label = pinned ? t('Unpin task') : t('Pin task');
			pin.setAttribute('aria-label', label);
			pin.setAttribute('title', label);
			pin.empty();
			setIcon(pin, pinned ? 'pin-off' : 'pin');
		};
		updatePin();
		pin.addEventListener('click', () => {
			pin.disabled = true;
			void this.taskManager.setFileTaskPinned(file, line, sourceLine, !pinned)
				.then(() => {
					pinned = !pinned;
					updatePin();
				})
				.catch(() => undefined)
				.finally(() => {
					if (pin.isConnected) pin.disabled = false;
				});
		});
		const content = card.createDiv({ cls: 'thread-journal-source-task-content' });
		const child = new MarkdownRenderChild(content);
		registerChild(child);
		await MarkdownRenderer.render(this.app, data.content, content, file.path, child);

		const details = card.createDiv({ cls: 'thread-journal-source-task-details' });
		const addChip = (text: string, icon: string, modifier = ''): void => {
			const chip = details.createSpan({
				cls: `thread-journal-source-task-chip${modifier ? ` is-${modifier}` : ''}`,
			});
			setIcon(chip.createSpan({ cls: 'thread-journal-task-chip-icon' }), icon);
			chip.createSpan({ text });
		};
		const today = moment().format('YYYY-MM-DD');
		const deadline = taskDeadlineDisplay(data, today);
		if (deadline) addChip(deadline.label, 'calendar-clock', deadline.modifier);
		if (data.effort) {
			const label = t(TASK_EFFORT_LABELS[data.effort]);
			const effort = details.createSpan({
				cls: `thread-journal-task-effort is-${data.effort}`,
				attr: { title: label, 'aria-label': label },
			});
			setIcon(effort, 'gauge');
		}
		if (data.repeat) {
			const rule = taskRepeatRuleDisplay(data);
			const nextLabel = taskNextActionLabel(data, today);
			const current = taskCurrentLabel(
				data.current,
				today,
				t('Today'),
			);
			const repeat = details.createSpan({
				cls: 'thread-journal-source-task-chip is-repeat',
				attr: { title: rule },
			});
			const next = repeat.createEl('button', {
				cls: 'clickable-icon thread-journal-task-repeat-next',
				attr: {
					type: 'button',
					'aria-label': `${rule} · ${nextLabel}`,
					title: `${rule} · ${nextLabel}`,
				},
			});
			setIcon(next, 'repeat-2');
			if (current) repeat.createSpan({ text: current });
			next.addEventListener('click', () => {
				next.disabled = true;
				this.taskManager.moveFileTaskToNext(file, line, sourceLine, () => {
					next.disabled = false;
				});
			});
		}
		if (!details.hasChildNodes()) details.remove();

		const actions = card.createDiv({ cls: 'thread-journal-source-task-actions' });
		const edit = actions.createEl('button', {
			cls: 'clickable-icon thread-journal-source-task-edit',
			attr: { type: 'button', 'aria-label': t('Edit task'), title: t('Edit task') },
		});
		setIcon(edit, 'pencil');
		edit.addEventListener('click', () => {
			this.taskManager.openFileTaskEdit(file, line, sourceLine, data);
		});
		for (const list of nestedLists) item.appendChild(list);
	}


	renderChildren(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		const current = sourceFile(this.app, ctx);
		if (!current) return;
		const threadFile = this.index.getThreadFile(current);
		if (!threadFile) return;
		const children = this.index.getDirectChildren(threadFile);
		el.addClass('thread-journal-children');
		if (children.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: t('No child threads.') });
			return;
		}
		const list = el.createEl('ul');
		for (const child of children) {
			const item = list.createEl('li');
			addFileLink(
				this.app,
				item,
				this.index.getEntry(child.file) ?? child.file,
				ctx.sourcePath,
				child.title,
			);
			item.createSpan({
				cls: 'thread-journal-meta',
				text: threadStatusLabel(child.status),
			});
		}
	}

	async enhanceCheckpointCallouts(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const current = sourceFile(this.app, ctx);
		if (!current || !this.index.getThreadForMember(current)) return;
		const selector = '.callout[data-callout="thread-checkpoint"]';
		const callouts = [
			...(el.matches(selector) ? [el] : []),
			...Array.from(el.querySelectorAll<HTMLElement>(selector)),
		];
		if (callouts.length === 0) return;
		const section = ctx.getSectionInfo(el);
		if (!section) return;
		const entries = parseCheckpointEntries(section.text);
		await Promise.all(callouts.map(async (callout, index) => {
			const entry = entries[index];
			if (!entry?.blockId) return;
			await this.renderSourceCheckpointCallout(
				callout,
				current,
				entry,
				(child) => ctx.addChild(child),
			);
		}));
	}

	async enhanceLogCallouts(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const current = sourceFile(this.app, ctx);
		if (!current || !this.index.getThreadForMember(current)) return;
		const selector = '.callout[data-callout="thread-log"]';
		const callouts = [
			...(el.matches(selector) ? [el] : []),
			...Array.from(el.querySelectorAll<HTMLElement>(selector)),
		];
		if (callouts.length === 0) return;
		const section = ctx.getSectionInfo(el);
		if (!section) return;
		const sourceLines = (await this.app.vault.cachedRead(current)).split(/\r?\n/u);
		// A structured block's ID is outside the rendered callout section.
		// Include the lines just after the section when matching source entries.
		const sectionSource = sourceLines
			.slice(section.lineStart, section.lineEnd + 4)
			.join('\n');
		const entries = parseInlineLogEntrySlots(sectionSource);
		await Promise.all(callouts.map(async (callout, index) => {
			const entry = entries[index];
			if (!entry) return;
			await this.renderSourceLogCallout(callout, current, entry, (child) => ctx.addChild(child));
		}));
	}

	async renderSourceCheckpointCallout(
		callout: HTMLElement,
		memberFile: TFile,
		entry: ParsedCheckpointEntry,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		const thread = this.index.getThreadForMember(memberFile);
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

		const date = entry.values.checkpoint_date || t('No date entered');
		const time = entry.values.checkpoint_time || '';
		titleInner.setText(formatThreadEntryTimestamp(date, time));
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
			text: t('Edit'),
			attr: { type: 'button', 'aria-label': t('Edit current checkpoint') },
		});
		edit.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		edit.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.onEditCheckpoint(memberFile, entry);
		});

		content.empty();
		await this.renderCheckpointContent(
			content,
			entry,
			fields,
			memberFile.path,
			registerChild,
		);
	}

	async renderSourceLogCallout(
		callout: HTMLElement,
		memberFile: TFile,
		entry: ParsedInlineLogEntry,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		const signature = JSON.stringify(entry);
		if (this.sourceLogSignatures.get(callout) === signature) return;
		const title = callout.querySelector<HTMLElement>('.callout-title');
		const titleInner = title?.querySelector<HTMLElement>('.callout-title-inner');
		const content = callout.querySelector<HTMLElement>('.callout-content');
		if (!title || !titleInner || !content) return;
		this.sourceLogSignatures.set(callout, signature);
		callout.addClass('thread-journal-source-log-card');

		titleInner.setText(formatThreadEntryTimestamp(entry.date, entry.time));
		title.querySelector('.thread-journal-source-log-controls')?.remove();
		const controls = title.createDiv({
			cls: [
				'thread-journal-source-log-controls',
				'thread-journal-log-card-controls',
			],
		});
		controls.createSpan({ cls: 'thread-journal-log-card-kind', text: 'log' });
		content.empty();
		await this.renderLogContent(content, entry, memberFile.path, registerChild);
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
					errors.push(t('Cannot find thread_id: {id}.', { id }));
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

		const membersByThread = new Map<string, TFile[]>();
		for (const member of this.index.getAllMembers()) {
			const members = membersByThread.get(member.threadId) ?? [];
			members.push(member.file);
			membersByThread.set(member.threadId, members);
		}
		const records = (await Promise.all(threads.flatMap((thread) =>
			(membersByThread.get(thread.id) ?? []).map(async (memberFile) => {
			const content = await this.app.vault.cachedRead(memberFile);
			const entries: ThreadEntryRecord[] = [];
			if (parsed.query.types.includes('checkpoint')) {
				const fields = this.checkpointFields(thread.file);
				for (const entry of parseCheckpointEntries(content)) {
					const entryDate = entry.values.checkpoint_date ?? '';
					if (date && (entryDate < date.from || entryDate > date.to)) continue;
					entries.push({
						type: 'checkpoint',
						thread,
						memberFile,
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
						memberFile,
						date: entry.date,
						time: entry.time,
						timestamp: entry.timestamp,
						entry,
					});
				}
			}
			return entries;
		})))).flat();

		records.sort((a, b) => {
			const timestamp = compareThreadEntryTimestamps(
				a.timestamp,
				b.timestamp,
				parsed.query.order,
			);
			return timestamp || a.thread.title.localeCompare(b.thread.title);
		});
		if (records.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: t('No matching entries.') });
			return;
		}
		await this.renderEntryResults(
			el,
			records,
			parsed.query.groupBy,
			parsed.query.threadDetail,
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
		warning.createDiv({ text: t('The entry query could not run:') });
		const list = warning.createEl('ul');
		for (const error of errors) list.createEl('li', { text: error });
	}

	private async renderEntryResults(
		container: HTMLElement,
		records: ThreadEntryRecord[],
		groupBy: ThreadEntryGroupBy,
		threadDetail: ThreadEntryDetail,
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
				this.renderThreadDetail(
					summary,
					first.thread,
					ctx.sourcePath,
					threadDetail === 'crumb' ? 'crumb' : 'name',
				);
				this.addEntryCount(summary, group.length);
				const cards = section.createDiv({ cls: 'thread-journal-entry-cards' });
				await this.renderEntryCards(cards, group, ctx, dateFiltered, 'none');
			}
			return;
		}

		if (groupBy === 'type') {
			for (const type of ['checkpoint', 'log'] as const) {
				const group = records.filter((record) => record.type === type);
				if (group.length === 0) continue;
				const section = this.createEntryGroup(container);
				const summary = section.createEl('summary', {
					text: type === 'checkpoint' ? t('Checkpoint') : t('Log'),
				});
				this.addEntryCount(summary, group.length);
				const cards = section.createDiv({ cls: 'thread-journal-entry-cards' });
				await this.renderEntryCards(
					cards,
					group,
					ctx,
					dateFiltered,
					threadDetail,
				);
			}
			return;
		}

		const cards = container.createDiv({ cls: 'thread-journal-entry-cards' });
		await this.renderEntryCards(cards, records, ctx, dateFiltered, threadDetail);
	}

	private createEntryGroup(container: HTMLElement): HTMLDetailsElement {
		const section = container.createEl('details', { cls: 'thread-journal-entry-group' });
		section.open = true;
		return section;
	}

	private addEntryCount(container: HTMLElement, count: number): void {
		container.createSpan({ cls: 'thread-journal-entry-count', text: t('{count} entries', { count }) });
	}

	private renderThreadDetail(
		container: HTMLElement,
		thread: ThreadInfo,
		sourcePath: string,
		detail: Exclude<ThreadEntryDetail, 'none'>,
	): void {
		const target = container.createSpan({
			cls: [
				'thread-journal-entry-thread',
				detail === 'crumb' ? 'is-crumb' : 'is-name',
			],
		});
		if (detail === 'name') {
			addFileLink(
				this.app,
				target,
				this.index.getEntry(thread.file) ?? thread.file,
				sourcePath,
				thread.title,
			);
			return;
		}

		const ancestry = this.index.getAncestors(thread.file);
		const items = [
			...ancestry.items,
			{ file: thread.file, label: thread.title },
		];
		items.forEach((item, index) => {
			if (index > 0) {
				target.createSpan({ cls: 'thread-journal-entry-separator', text: '›' });
			}
			addFileLink(
				this.app,
				target,
				this.index.getEntry(item.file) ?? item.file,
				sourcePath,
				item.label,
			);
		});
		if (ancestry.cycle) {
			target.createSpan({
				cls: 'thread-journal-warning',
				text: '↻',
				attr: { 'aria-label': t('A parent thread cycle was detected') },
			});
		}
	}

	private async renderEntryCards(
		container: HTMLElement,
		records: ThreadEntryRecord[],
		ctx: MarkdownPostProcessorContext,
		dateFiltered: boolean,
		threadDetail: ThreadEntryDetail,
	): Promise<void> {
		for (const record of records) {
			if (record.type === 'checkpoint') {
				await this.renderCheckpointCards(
					container,
					record.memberFile,
					[record.entry],
					record.fields,
					ctx.sourcePath,
					dateFiltered,
					threadDetail,
					record.thread,
					(child) => ctx.addChild(child),
				);
				continue;
			}
			await this.renderLogCard(
				container,
				record,
				ctx,
				dateFiltered,
				threadDetail,
			);
		}
	}

	private async renderLogCard(
		container: HTMLElement,
		record: LogEntryRecord,
		ctx: MarkdownPostProcessorContext,
		dateFiltered: boolean,
		threadDetail: ThreadEntryDetail,
	): Promise<void> {
		const card = container.createDiv({ cls: 'thread-journal-log-card' });
		const header = card.createDiv({ cls: 'thread-journal-log-card-header' });
		const identity = header.createDiv({ cls: 'thread-journal-log-card-identity' });
		identity.createSpan({
			cls: 'thread-journal-log-card-date',
			text: formatThreadEntryTimestamp(record.date, record.time, dateFiltered),
		});
		if (threadDetail !== 'none') {
			identity.createSpan({ cls: 'thread-journal-entry-separator', text: '·' });
			this.renderThreadDetail(
				identity,
				record.thread,
				ctx.sourcePath,
				threadDetail,
			);
		}
		const controls = header.createDiv({ cls: 'thread-journal-log-card-controls' });
		controls.createSpan({ cls: 'thread-journal-log-card-kind', text: 'log' });
		const blockId = record.entry.blockId;
		if (blockId) {
			const locate = controls.createEl('a', {
				cls: 'thread-journal-log-locate',
				text: t('Locate'),
				attr: {
					href: `${record.memberFile.path}#^${blockId}`,
					'aria-label': t('Locate log in thread file'),
				},
			});
			locate.addEventListener('click', (event) => {
				event.preventDefault();
				void this.app.workspace.openLinkText(
					`${record.memberFile.path}#^${blockId}`,
					ctx.sourcePath,
					event.metaKey || event.ctrlKey,
				);
			});
		}
		const content = card.createDiv({ cls: 'thread-journal-log-content' });
		await this.renderLogContent(
			content,
			record.entry,
			record.memberFile.path,
			(child) => ctx.addChild(child),
		);
	}

	private async renderLogContent(
		content: HTMLElement,
		entry: ParsedInlineLogEntry,
		sourcePath: string,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		const child = new MarkdownRenderChild(content);
		registerChild(child);
		await MarkdownRenderer.render(
			this.app,
			entry.text || t('(empty log)'),
			content,
			sourcePath,
			child,
		);
	}

	private async renderCheckpointCards(
		container: HTMLElement,
		sourceFile: TFile,
		entries: ParsedCheckpointEntry[],
		fields: ThreadJournalSettings['checkpointFields'],
		renderSourcePath: string,
		dateFiltered: boolean,
		threadDetail: ThreadEntryDetail,
		thread: ThreadInfo,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		for (const entry of entries) {
			const card = container.createDiv({ cls: 'thread-journal-checkpoint-card' });
			const header = card.createDiv({ cls: 'thread-journal-checkpoint-card-header' });
			const identity = header.createDiv({
				cls: 'thread-journal-checkpoint-card-identity',
			});
			const date = entry.values.checkpoint_date || t('No date entered');
			const time = entry.values.checkpoint_time || '';
			identity.createSpan({
				cls: 'thread-journal-checkpoint-card-date',
				text: formatThreadEntryTimestamp(date, time, dateFiltered),
			});
			if (threadDetail !== 'none') {
				identity.createSpan({ cls: 'thread-journal-entry-separator', text: '·' });
				this.renderThreadDetail(
					identity,
					thread,
					renderSourcePath,
					threadDetail,
				);
			}
			const controls = header.createDiv({ cls: 'thread-journal-checkpoint-card-controls' });
			const kind = entry.values.checkpoint_kind;
			if (kind) controls.createSpan({ cls: 'thread-journal-checkpoint-card-kind', text: kind });
			if (entry.blockId) {
				const blockId = entry.blockId;
				const locate = controls.createEl('a', {
					cls: 'thread-journal-checkpoint-locate',
					text: t('Locate'),
					attr: {
						href: `${sourceFile.path}#^${blockId}`,
						'aria-label': t('Locate checkpoint in thread file'),
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
					text: t('Edit'),
					attr: { type: 'button', 'aria-label': t('Edit checkpoint') },
				});
				edit.addEventListener('click', () => {
					this.onEditCheckpoint(sourceFile, entry);
				});
				const remove = controls.createEl('button', {
					cls: 'thread-journal-checkpoint-delete',
					text: t('Delete'),
					attr: { type: 'button', 'aria-label': t('Delete checkpoint') },
				});
				remove.addEventListener('click', () => {
					this.onDeleteCheckpoint(sourceFile, entry);
				});
			}

			await this.renderCheckpointContent(
				card,
				entry,
				fields,
				sourceFile.path,
				registerChild,
			);
		}
	}

	private async renderCheckpointContent(
		container: HTMLElement,
		entry: ParsedCheckpointEntry,
		fields: ThreadJournalSettings['checkpointFields'],
		sourcePath: string,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		const knownKeys = new Set(fields.map((field) => field.key));
		const knownBodyLabels = checkpointBodyLabels(fields);
		const consumedBodyLabels = new Set<string>();
		const systemKeys = new Set(['checkpoint', 'checkpoint_date', 'checkpoint_time']);
		const summaryField = fields.find((field) => field.key === 'checkpoint_summary');
		const summaryBody = summaryField
			? entry.body.find((item) => item.label === summaryField.label)
			: undefined;
		if (summaryBody) consumedBodyLabels.add(summaryBody.label);
		const summary = entry.values.checkpoint_summary
			?? summaryBody?.value;
		if (summary) {
			const summaryRenderMode = summaryField
				&& checkpointFieldRenderMode(summaryField) === 'block-markdown'
				? 'block-markdown'
				: 'inline-markdown';
			const summaryEl = container.createDiv({
				cls: 'thread-journal-checkpoint-card-summary',
			});
			await this.renderMarkdownValue(
				summaryEl,
				summary,
				sourcePath,
				registerChild,
				summaryRenderMode,
			);
		}

		const details = container.createDiv({ cls: 'thread-journal-checkpoint-card-fields' });
		let detailCount = 0;
		for (const field of fields) {
			if (field.key === 'checkpoint_kind' || field.key === 'checkpoint_summary') continue;
			const bodyValue = consumedBodyLabels.has(field.label)
				? undefined
				: entry.body.find((item) => item.label === field.label)?.value;
			if (bodyValue !== undefined) consumedBodyLabels.add(field.label);
			const value = entry.values[field.key] || bodyValue;
			if (!value) continue;
			await this.renderCheckpointField(
				details,
				field.label,
				value,
				checkpointFieldRenderMode(field),
				sourcePath,
				registerChild,
			);
			detailCount += 1;
		}
		for (const [key, value] of Object.entries(entry.values)) {
			if (systemKeys.has(key) || knownKeys.has(key) || !value) continue;
			await this.renderCheckpointField(
				details,
				key,
				value,
				'inline-markdown',
				sourcePath,
				registerChild,
			);
			detailCount += 1;
		}
		for (const body of entry.body) {
			if (knownBodyLabels.has(body.label) || consumedBodyLabels.has(body.label)) continue;
			await this.renderCheckpointField(
				details,
				body.label,
				body.value,
				'block-markdown',
				sourcePath,
				registerChild,
			);
			detailCount += 1;
		}
		if (detailCount === 0) details.remove();
	}

	private async renderCheckpointField(
		container: HTMLElement,
		label: string,
		value: string,
		mode: CheckpointFieldRenderMode,
		sourcePath: string,
		registerChild: MarkdownChildRegistrar,
	): Promise<void> {
		const row = container.createDiv({ cls: 'thread-journal-checkpoint-card-field' });
		row.createSpan({ cls: 'thread-journal-checkpoint-card-field-label', text: label });
		if (mode === 'plain') {
			row.createSpan({ cls: 'thread-journal-checkpoint-card-field-value', text: value });
			return;
		}
		if (mode === 'block-markdown') row.addClass('is-block');
		const valueEl = row.createDiv({ cls: 'thread-journal-checkpoint-card-field-value' });
		await this.renderMarkdownValue(valueEl, value, sourcePath, registerChild, mode);
	}

	private async renderMarkdownValue(
		container: HTMLElement,
		value: string,
		sourcePath: string,
		registerChild: MarkdownChildRegistrar,
		mode: Exclude<CheckpointFieldRenderMode, 'plain'>,
	): Promise<void> {
		container.addClass(`thread-journal-${mode}`);
		const child = new MarkdownRenderChild(container);
		registerChild(child);
		await MarkdownRenderer.render(this.app, value, container, sourcePath, child);
	}
}
