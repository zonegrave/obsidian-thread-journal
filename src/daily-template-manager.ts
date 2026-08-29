import {
	App,
	MarkdownRenderChild,
	MarkdownRenderer,
	Modal,
	Notice,
	Setting,
	TFile,
} from 'obsidian';
import {
	buildDefaultThreadDailyForm,
	buildLegacyThreadDailyForm,
	buildThreadDailyFormCodeBlock,
	extractThreadDailyForm,
	insertBlocksUnderHeading,
	neutralizeMetaBindInputs,
	replaceThreadDailyForm,
} from './core';
import type { DailyFormItem } from './types';

interface FormSnippet {
	label: string;
	value: string;
}

const FORM_SNIPPETS: FormSnippet[] = [
	{ label: '短文本', value: '> **字段名称** `INPUT[text:field_key]`' },
	{ label: '数字', value: '> **字段名称** `INPUT[number:field_key]`' },
	{ label: '开关', value: '> **字段名称** `INPUT[toggle:field_key]`' },
	{
		label: '评分',
		value: '> **字段名称** `INPUT[slider(addLabels, minValue(1), maxValue(5), stepSize(1)):field_key]`',
	},
	{
		label: '选择',
		value: "> **字段名称** `INPUT[inlineSelect(option('选项一'), option('选项二')):field_key]`",
	},
	{ label: '长文本', value: '> **字段名称**\n> `INPUT[textArea:field_key]`' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class DailyTemplateModal extends Modal {
	private editor!: HTMLTextAreaElement;
	private preview!: HTMLDivElement;
	private previewChild?: MarkdownRenderChild;
	private previewTimer?: number;

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly initialTemplate: string,
		private readonly onSave: (template: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-template-modal');
		this.setTitle('编辑日记表单');
		this.contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: '编辑表单内部 Markdown。左侧内容会复制到日记；右侧是禁用控件的安全预览。',
		});

		const toolbar = this.contentEl.createDiv({ cls: 'thread-journal-template-toolbar' });
		toolbar.createSpan({ text: '插入控件：' });
		for (const snippet of FORM_SNIPPETS) {
			const button = toolbar.createEl('button', { text: snippet.label });
			button.addEventListener('click', () => this.insertSnippet(snippet.value));
		}

		const workspace = this.contentEl.createDiv({ cls: 'thread-journal-template-workspace' });
		const editorPane = workspace.createDiv({ cls: 'thread-journal-template-pane' });
		editorPane.createDiv({ cls: 'thread-journal-template-pane-title', text: 'Markdown 表单' });
		this.editor = editorPane.createEl('textarea', {
			cls: 'thread-journal-template-editor',
			attr: {
				spellcheck: 'false',
				placeholder: '> [!note]+ 标题\n> **字段** `INPUT[text:field_key]`',
			},
		});
		this.editor.value = this.initialTemplate;
		this.editor.addEventListener('input', () => this.schedulePreview());

		const previewPane = workspace.createDiv({ cls: 'thread-journal-template-pane' });
		previewPane.createDiv({ cls: 'thread-journal-template-pane-title', text: 'Callout 预览' });
		this.preview = previewPane.createDiv({ cls: 'thread-journal-template-modal-preview' });
		void this.renderPreview();

		const actions = new Setting(this.contentEl).setClass('thread-journal-template-actions');
		actions.addButton((button) => button
			.setButtonText('取消')
			.onClick(() => this.close()));
		actions.addButton((button) => button
			.setButtonText('保存表单')
			.setCta()
			.onClick(async () => {
				const template = this.editor.value.trim();
				if (!template) {
					new Notice('表单不能为空；如果不需要日记表单，请删除 thread-daily-form 代码块。');
					return;
				}
				try {
					await this.onSave(template);
					this.close();
				} catch (error: unknown) {
					console.error('Thread Journal failed to save daily form template', error);
					new Notice(`保存日记表单失败：${String(error)}`);
				}
			}));

		window.setTimeout(() => this.editor.focus(), 0);
	}

	onClose(): void {
		if (this.previewTimer !== undefined) window.clearTimeout(this.previewTimer);
		this.previewChild?.unload();
		this.contentEl.empty();
	}

	private insertSnippet(value: string): void {
		const start = this.editor.selectionStart;
		const end = this.editor.selectionEnd;
		const before = this.editor.value.slice(0, start);
		const after = this.editor.value.slice(end);
		const prefix = before && !before.endsWith('\n') ? '\n' : '';
		const suffix = after && !after.startsWith('\n') ? '\n' : '';
		const insertion = `${prefix}${value}${suffix}`;
		this.editor.value = before + insertion + after;
		const cursor = before.length + insertion.length - suffix.length;
		this.editor.setSelectionRange(cursor, cursor);
		this.editor.focus();
		this.schedulePreview();
	}

	private schedulePreview(): void {
		if (this.previewTimer !== undefined) window.clearTimeout(this.previewTimer);
		this.previewTimer = window.setTimeout(() => {
			this.previewTimer = undefined;
			void this.renderPreview();
		}, 120);
	}

	private async renderPreview(): Promise<void> {
		this.previewChild?.unload();
		this.preview.empty();
		const child = new MarkdownRenderChild(this.preview);
		this.previewChild = child;
		child.load();
		await MarkdownRenderer.render(
			this.app,
			neutralizeMetaBindInputs(this.editor.value),
			this.preview,
			this.file.path,
			child,
		);
	}
}

export class DailyTemplateManager {
	constructor(private readonly app: App) {}

	async open(file: TFile, legacyForm: DailyFormItem[]): Promise<void> {
		const original = await this.app.vault.cachedRead(file);
		const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const title = typeof metadata.title === 'string' && metadata.title.trim()
			? metadata.title.trim()
			: file.basename;
		const existing = extractThreadDailyForm(original);
		const initialTemplate = existing
			?? (legacyForm.length > 0
				? buildLegacyThreadDailyForm(title, legacyForm)
				: buildDefaultThreadDailyForm(title));

		new DailyTemplateModal(this.app, file, initialTemplate, async (template) => {
			await this.save(file, template, legacyForm.length > 0 && !existing);
		}).open();
	}

	private async save(file: TFile, template: string, migrateLegacy: boolean): Promise<void> {
		await this.app.vault.process(file, (content) => {
			const replaced = replaceThreadDailyForm(content, template);
			if (replaced !== undefined) return replaced;
			const block = buildThreadDailyFormCodeBlock(template);
			return insertBlocksUnderHeading(content, '日记表单', [block]).content;
		});

		if (migrateLegacy) {
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

		new Notice(migrateLegacy
			? '旧表单已迁移到 thread 正文并保存。'
			: '日记表单已保存。');
	}
}
