import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	TFile,
	moment,
	parseYaml,
	type MarkdownPostProcessorContext,
} from 'obsidian';
import {
	extractMarkedSection,
	hasDailyFormSnapshot,
	normalizeRecordsConfig,
	valueIsPresent,
} from './core';
import type { ThreadIndex } from './thread-index';
import type {
	DailyRecord,
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
		const files = [...ancestry.files, current];
		files.forEach((file, index) => {
			if (index > 0) el.createSpan({ cls: 'thread-journal-separator', text: '›' });
			if (file.path === current.path) {
				el.createSpan({ cls: 'thread-journal-current', text: file.basename });
			} else {
				addFileLink(this.app, el, file, ctx.sourcePath);
			}
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
		const records = await this.collectRecords(scope, config);
		el.addClass('thread-journal-records');
		if (records.length === 0) {
			el.createDiv({ cls: 'thread-journal-empty', text: '所选时间范围内暂无记录。' });
			return;
		}
		for (const record of records) {
			await this.renderRecord(record, el, ctx);
		}
	}

	private async collectRecords(
		scope: ThreadInfo[],
		config: ReturnType<typeof normalizeRecordsConfig>,
	): Promise<DailyRecord[]> {
		if (scope.length === 0) return [];
		const configuredFields = config.fields.length > 0
			? config.fields
			: [...new Set(scope.flatMap((thread) => thread.daily.fields.map((field) => field.key)))];
		const threshold = moment().startOf('day').subtract(config.days - 1, 'days');
		const dailyFiles = this.app.vault.getMarkdownFiles()
			.filter((file) => file.path.startsWith(`${this.getSettings().dailyFolder}/`))
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
				thread.daily.fields.map((field) => field.key)));
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

	private async renderRecord(
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
