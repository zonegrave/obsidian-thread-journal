import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	type EventRef,
} from 'obsidian';
import { DailyTemplateManager } from './daily-template-manager';
import { JournalComposer } from './journal-composer';
import { ThreadRenderers } from './renderers';
import {
	DEFAULT_SETTINGS,
	ThreadJournalSettingTab,
	normalizedSettings,
} from './settings';
import { ThreadCreator } from './thread-creator';
import { ThreadIndex } from './thread-index';
import type { ThreadJournalSettings } from './types';

const AUTO_COMPOSE_DELAY_MS = 1200;

export default class ThreadJournalPlugin extends Plugin {
	settings: ThreadJournalSettings = DEFAULT_SETTINGS;
	private index!: ThreadIndex;
	private formManager!: DailyTemplateManager;
	private composer!: JournalComposer;
	private creator!: ThreadCreator;
	private renderers!: ThreadRenderers;
	private pendingDailyTimers = new Map<string, number>();
	private vaultCreateEvent?: EventRef;

	async onload(): Promise<void> {
		await this.loadSettings();
		const getSettings = () => this.settings;
		this.index = new ThreadIndex(this.app, getSettings);
		this.formManager = new DailyTemplateManager(this.app);
		this.composer = new JournalComposer(this.app, this.index, getSettings);
		this.creator = new ThreadCreator(this.app, this.index, getSettings);
		this.renderers = new ThreadRenderers(this.app, this.index, getSettings);

		this.registerCommands();
		this.registerRenderers();
		this.addSettingTab(new ThreadJournalSettingTab(this.app, this));
		this.vaultCreateEvent = this.app.vault.on('create', (file) => {
			if (file instanceof TFile) this.scheduleDailyComposition(file);
		});
		this.registerEvent(this.vaultCreateEvent);
	}

	onunload(): void {
		for (const timer of this.pendingDailyTimers.values()) window.clearTimeout(timer);
		this.pendingDailyTimers.clear();
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

		this.addCommand({
			id: 'manage-daily-form',
			name: '编辑当前 thread 的日记表单',
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) {
					const form = this.index.getThread(file)?.daily.form ?? [];
					void this.formManager.open(file, form).catch((error: unknown) => {
						console.error('Thread Journal failed to open daily form template', error);
						new Notice(`打开日记表单失败：${String(error)}`);
					});
				}
				return true;
			},
		});

		this.addCommand({
			id: 'compose-current-daily-note',
			name: '用活跃 thread 补全当前日记',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.composer.isDailyFile(file)) return false;
				if (!checking) {
					void this.composer.compose(file).catch((error: unknown) => {
						console.error('Thread Journal failed to compose daily note', error);
						new Notice(`补全日记失败：${String(error)}`);
					});
				}
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
		this.registerMarkdownCodeBlockProcessor('thread-daily-form', (source, el, ctx) =>
			this.renderers.renderDailyFormPreview(source, el, ctx));
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

	private scheduleDailyComposition(file: TFile): void {
		if (!this.settings.autoComposeDaily || !this.composer.isDailyFile(file)) return;
		const prior = this.pendingDailyTimers.get(file.path);
		if (prior !== undefined) window.clearTimeout(prior);
		const timer = window.setTimeout(() => {
			this.pendingDailyTimers.delete(file.path);
			const current = this.app.vault.getAbstractFileByPath(file.path);
			if (!(current instanceof TFile)) return;
			void this.composer.compose(current, false).catch((error: unknown) => {
				console.error('Thread Journal failed to auto-compose daily note', error);
				new Notice('Thread journal 自动补全日记失败，请运行手动补全命令。');
			});
		}, AUTO_COMPOSE_DELAY_MS);
		this.pendingDailyTimers.set(file.path, timer);
	}
}
