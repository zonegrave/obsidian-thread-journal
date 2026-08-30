import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from 'obsidian';
import { ThreadRenderers } from './renderers';
import {
	DEFAULT_SETTINGS,
	ThreadJournalSettingTab,
	normalizedSettings,
} from './settings';
import { ThreadCreator } from './thread-creator';
import { ThreadIndex } from './thread-index';
import type { ThreadJournalSettings } from './types';

export default class ThreadJournalPlugin extends Plugin {
	settings: ThreadJournalSettings = DEFAULT_SETTINGS;
	private index!: ThreadIndex;
	private creator!: ThreadCreator;
	private renderers!: ThreadRenderers;

	async onload(): Promise<void> {
		await this.loadSettings();
		const getSettings = () => this.settings;
		this.index = new ThreadIndex(this.app, getSettings);
		this.creator = new ThreadCreator(this.app, this.index, getSettings);
		this.renderers = new ThreadRenderers(this.app, this.index, getSettings);

		this.registerCommands();
		this.registerRenderers();
		this.addSettingTab(new ThreadJournalSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizedSettings(
			(await this.loadData()) as Partial<ThreadJournalSettings> | null,
		);
	}

	async saveSettings(): Promise<void> {
		this.settings = normalizedSettings(this.settings);
		await this.saveData(this.settings);
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'new-thread',
			name: '新建 thread（选择父 thread）',
			callback: () => {
				this.creator.openNewThreadModal();
			},
		});

		this.addCommand({
			id: 'open-thread-template',
			name: '打开 thread 创建模板',
			callback: () => {
				void this.creator.openThreadTemplate().catch((error: unknown) => {
					console.error('Thread Journal failed to open thread template', error);
					new Notice(`打开 Thread 模板失败：${String(error)}`);
				});
			},
		});

		this.addCommand({
			id: 'new-child-thread',
			name: '从当前文件新建子 thread',
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) this.creator.openNewChildModal(file);
				return true;
			},
		});

		this.addCommand({
			id: 'new-sibling-thread',
			name: '从当前文件新建同级 thread',
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) this.creator.openNewSiblingModal(file);
				return true;
			},
		});

	}

	private registerRenderers(): void {
		this.registerMarkdownCodeBlockProcessor('thread-breadcrumb', (_source, el, ctx) => {
			this.renderers.renderBreadcrumb(el, ctx);
		});
		this.registerMarkdownCodeBlockProcessor('thread-children', (_source, el, ctx) => {
			this.renderers.renderChildren(el, ctx);
		});
		this.registerMarkdownCodeBlockProcessor('thread-record-template', (source, el) =>
			this.renderers.renderRecordTemplate(source, el));
		this.registerMarkdownCodeBlockProcessor('thread-daily-form', (source, el, ctx) =>
			this.renderers.renderLegacyDailyForm(source, el, ctx));
		this.registerMarkdownCodeBlockProcessor('thread-records', (source, el, ctx) =>
			this.renderers.renderRecords(source, el, ctx));
	}

	private currentThreadFile(): TFile | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) return undefined;
		const type: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
		return type === 'thread' ? file : undefined;
	}
}
