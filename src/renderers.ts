import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	Notice,
	TFile,
	moment,
	parseYaml,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import {
	extractThreadBodyRecords,
	extractMarkedSection,
	extractMetaBindPropertyKeys,
	extractThreadDailyForm,
	hasDailyFormSnapshot,
	neutralizeMetaBindInputs,
	normalizeRecordsConfig,
	valueIsPresent,
} from './core';
import type { ThreadIndex } from './thread-index';
import type {
	DailyRecord,
	ThreadBodyRecord,
	ThreadInfo,
	ThreadJournalSettings,
} from './types';

function sourceFile(app: App, ctx: MarkdownPostProcessorContext): TFile | undefined {
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	return file instanceof TFile ? file : undefined;
}

function addFileLink(app: App, container: HTMLElement, file: TFile, sourcePath: string, text?: string): void {
	const link = container.createEl('a', {
		text: text ?? file.basename,
		attr: { href: file.path },
	});
	link.addEventListener('click', (event) => {
		event.preventDefault();
		void app.workspace.openLinkText(file.path, sourcePath, event.metaKey || event.ctrlKey);
	});
}

function frontmatter(app: App, file: TFile): Record<string, unknown> {
	return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

function displayValue(value: unknown): string {
	if (typeof value === 'boolean') return value ? '✓' : '✗';
	if (Array.isArray(value)) return value.join('、');
	if (typeof value === 'object' && value !== null) return JSON.stringify(value);
	return String(value);
}

export class ThreadRenderers {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
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
				text: `${child.kind} · ${child.status || '未设状态'}`,
			});
		}
	}

	renderRecordTemplate(source: string, el: HTMLElement): void {
		el.addClass('thread-journal-record-template');
		const header = el.createDiv({ cls: 'thread-journal-record-template-header' });
		header.createSpan({ text: '记录模板' });
		const actions = header.createDiv({ cls: 'thread-journal-record-template-actions' });
		const copy = async (content: string, label: string): Promise<void> => {
			await navigator.clipboard.writeText(content.trim());
			new Notice(label);
		};
		const rawButton = actions.createEl('button', { text: '复制模板' });
		rawButton.addEventListener('click', () => {
			void copy(source, '已复制记录模板。');
		});
		const todayButton = actions.createEl('button', { text: '复制今日记录' });
		todayButton.addEventListener('click', () => {
			const today = moment().format('YYYY-MM-DD');
			void copy(source.replace(/YYYY-MM-DD/g, today), `已填入日期 ${today} 并复制。`);
		});
		const code = el.createEl('pre').createEl('code');
		code.setText(source.trim());
	}

	async renderLegacyDailyForm(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		el.addClass('thread-journal-form-preview');
		el.createDiv({
			cls: 'thread-journal-form-preview-label',
			text: '旧版日记表单 · 不再自动注入日记',
		});
		const body = el.createDiv({ cls: 'thread-journal-form-preview-body' });
		const child = new MarkdownRenderChild(body);
		ctx.addChild(child);
		await MarkdownRenderer.render(
			this.app,
			neutralizeMetaBindInputs(source),
			body,
			ctx.sourcePath,
			child,
		);
	}

	async renderRecords(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
		const current = sourceFile(this.app, ctx);
		if (!current) return;
		let rawConfig: unknown = {};
		try {
			rawConfig = source.trim() ? parseYaml(source) : {};
		} catch (error) {
			el.createDiv({ cls: 'thread-journal-error', text: `配置无法解析：${String(error)}` });
			return;
		}
		const config = normalizeRecordsConfig(rawConfig);
		const scope = this.index.getScope(current, config.scope === 'descendants');
		const bodyRecords = await this.collectThreadBodyRecords(scope, config);
		const legacyRecords = await this.collectLegacyRecords(scope, config);
		el.addClass('thread-journal-records');
		if (bodyRecords.length === 0 && legacyRecords.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '所选时间范围内暂无记录。' });
			return;
		}
		const records: Array<ThreadBodyRecord | DailyRecord> = [...bodyRecords, ...legacyRecords]
			.sort((a, b) => b.date.localeCompare(a.date));
		for (const record of records) {
			if ('threadTitle' in record) await this.renderThreadBodyRecord(record, el, ctx, config.fields);
			else await this.renderLegacyRecord(record, el, ctx);
		}
	}

	private async collectThreadBodyRecords(
		scope: ThreadInfo[],
		config: ReturnType<typeof normalizeRecordsConfig>,
	): Promise<ThreadBodyRecord[]> {
		const threshold = moment().startOf('day').subtract(config.days - 1, 'days');
		const results: ThreadBodyRecord[] = [];
		await Promise.all(scope.map(async (thread) => {
			const content = await this.app.vault.cachedRead(thread.file);
			for (const record of extractThreadBodyRecords(content)) {
				const parsedDate = moment(record.date, 'YYYY-MM-DD', true);
				if (!parsedDate.isValid() || parsedDate.isBefore(threshold, 'day')) continue;
				results.push({
					file: thread.file,
					threadTitle: thread.title,
					date: record.date,
					line: record.line,
					blockId: record.blockId,
					fields: record.fields,
					body: record.body,
				});
			}
		}));
		return results;
	}

	private async collectLegacyRecords(
		scope: ThreadInfo[],
		config: ReturnType<typeof normalizeRecordsConfig>,
	): Promise<DailyRecord[]> {
		if (scope.length === 0) return [];
		const templateFieldKeys = new Map<string, string[]>();
		await Promise.all(scope.map(async (thread) => {
			const template = extractThreadDailyForm(await this.app.vault.cachedRead(thread.file));
			templateFieldKeys.set(thread.id, template ? extractMetaBindPropertyKeys(template) : []);
		}));
		const configuredFields = config.fields.length > 0
			? config.fields
			: [...new Set(scope.flatMap((thread) => [
				...thread.daily.fields.map((field) => field.key),
				...(templateFieldKeys.get(thread.id) ?? []),
			]))];
		const threshold = moment().startOf('day').subtract(config.days - 1, 'days');
		const dailyFiles = this.app.vault.getMarkdownFiles()
			.filter((file) => file.path.startsWith(`${this.getSettings().legacyDailyFolder}/`))
			.sort((a, b) => b.basename.localeCompare(a.basename));
		const results: DailyRecord[] = [];

		for (const file of dailyFiles) {
			const metadata = frontmatter(this.app, file);
			const date = typeof metadata.date === 'string' ? metadata.date : file.basename;
			const parsedDate = moment(date, 'YYYY-MM-DD', true);
			if (parsedDate.isValid() && parsedDate.isBefore(threshold, 'day')) continue;
			const content = await this.app.vault.cachedRead(file);
			const linkedThreads = scope.filter((thread) => hasDailyFormSnapshot(content, thread.id));
			if (linkedThreads.length === 0) continue;

			const linkedFieldKeys = new Set(linkedThreads.flatMap((thread) =>
				[
					...thread.daily.fields.map((field) => field.key),
					...(templateFieldKeys.get(thread.id) ?? []),
				]));
			const values = configuredFields
				.filter((key) => linkedFieldKeys.has(key))
				.map((key) => ({ key, value: metadata[key] }))
				.filter((item) => valueIsPresent(item.value));
			const sections = linkedThreads.flatMap((thread) => thread.daily.sections
				.filter((section) => config.sections.length === 0 || config.sections.includes(section.id))
				.map((section) => ({
					threadTitle: thread.title,
					heading: section.label,
					content: extractMarkedSection(content, thread.id, section.id) ?? '',
				}))
				.filter((section) => section.content.trim().length > 0));
			if (!config.showEmpty && values.length === 0 && sections.length === 0) continue;
			results.push({ file, date, values, sections });
		}
		return results;
	}

	private async renderThreadBodyRecord(
		record: ThreadBodyRecord,
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext,
		configuredFields: string[],
	): Promise<void> {
		const card = container.createDiv({ cls: 'thread-journal-card' });
		const header = card.createDiv({ cls: 'thread-journal-card-header' });
		const target = record.blockId
			? `${record.file.path}#^${record.blockId}`
			: record.file.path;
		const link = header.createEl('a', {
			text: `${record.date} · ${record.threadTitle}`,
			attr: { href: target },
		});
		link.addEventListener('click', (event) => {
			event.preventDefault();
			void this.app.workspace.openLinkText(target, ctx.sourcePath, event.metaKey || event.ctrlKey);
		});
		const hiddenFields = new Set(['thread_record', 'record_date', 'record_id', 'summary']);
		const fields = record.fields
			.filter((field) => !hiddenFields.has(field.key))
			.filter((field) => configuredFields.length === 0 || configuredFields.includes(field.key))
			.filter((field) => valueIsPresent(field.value));
		if (fields.length > 0) {
			const properties = card.createDiv({ cls: 'thread-journal-properties' });
			for (const item of fields) {
				const property = properties.createDiv({ cls: 'thread-journal-property' });
				property.createSpan({ cls: 'thread-journal-property-key', text: item.key });
				property.createSpan({ text: displayValue(item.value) });
			}
		}
		if (record.body) {
			const body = card.createDiv({ cls: 'thread-journal-section-body' });
			const child = new MarkdownRenderChild(body);
			ctx.addChild(child);
			await MarkdownRenderer.render(this.app, record.body, body, record.file.path, child);
		}
	}

	private async renderLegacyRecord(
		record: DailyRecord,
		container: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		const card = container.createDiv({ cls: 'thread-journal-card' });
		const header = card.createDiv({ cls: 'thread-journal-card-header' });
		addFileLink(this.app, header, record.file, ctx.sourcePath, record.date);
		if (record.values.length > 0) {
			const properties = card.createDiv({ cls: 'thread-journal-properties' });
			for (const item of record.values) {
				const property = properties.createDiv({ cls: 'thread-journal-property' });
				property.createSpan({ cls: 'thread-journal-property-key', text: item.key });
				property.createSpan({ text: displayValue(item.value) });
			}
		}
		for (const section of record.sections) {
			const sectionEl = card.createDiv({ cls: 'thread-journal-section' });
			sectionEl.createEl('h4', { text: `${section.heading} · ${section.threadTitle}` });
			const body = sectionEl.createDiv({ cls: 'thread-journal-section-body' });
			const child = new MarkdownRenderChild(body);
			ctx.addChild(child);
			await MarkdownRenderer.render(this.app, section.content, body, record.file.path, child);
		}
	}
}
