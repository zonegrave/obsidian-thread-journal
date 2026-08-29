import { App, MarkdownView, Notice, TFile } from 'obsidian';
import {
	buildDefaultThreadDailyForm,
	buildLegacyThreadDailyForm,
	buildThreadDailyFormCodeBlock,
	extractThreadDailyForm,
	insertBlocksUnderHeading,
} from './core';
import type { DailyFormItem } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DailyTemplateManager {
	constructor(private readonly app: App) {}

	async open(file: TFile, legacyForm: DailyFormItem[]): Promise<void> {
		const original = await this.app.vault.cachedRead(file);
		if (extractThreadDailyForm(original)) {
			this.focusTemplate(file, original);
			new Notice('日记表单已在 thread 正文中；直接编辑代码块即可。');
			return;
		}

		const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const title = typeof metadata.title === 'string' && metadata.title.trim()
			? metadata.title.trim()
			: file.basename;
		const template = legacyForm.length > 0
			? buildLegacyThreadDailyForm(title, legacyForm)
			: buildDefaultThreadDailyForm(title);
		const block = buildThreadDailyFormCodeBlock(template);
		let updated = original;
		await this.app.vault.process(file, (content) => {
			const result = insertBlocksUnderHeading(content, '日记表单', [block]);
			updated = result.content;
			return result.content;
		});

		if (legacyForm.length > 0) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				if (!isRecord(frontmatter.daily)) return;
				const daily = { ...frontmatter.daily };
				delete daily.form;
				delete daily.fields;
				delete daily.sections;
				if (Object.keys(daily).length === 0) delete frontmatter.daily;
				else frontmatter.daily = daily;
			});
		}

		if (legacyForm.length > 0) updated = await this.app.vault.cachedRead(file);
		this.focusTemplate(file, updated);
		new Notice(legacyForm.length > 0
			? '旧表单已迁移到 thread 正文；Meta Bind 字段保持不变。'
			: '已添加日记表单模板；直接编辑代码块自定义样式。');
	}

	private focusTemplate(file: TFile, content: string): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== file.path) return;
		const offset = content.search(/^\s*(?:`{3,}|~{3,})\s*thread-daily-form\s*$/im);
		if (offset < 0) return;
		const line = content.slice(0, offset).split(/\r?\n/).length;
		view.editor.setCursor({ line, ch: 0 });
		view.editor.focus();
	}
}
