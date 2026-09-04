import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from 'obsidian';
import { CheckpointManager } from './checkpoint';
import { ThreadRenderers } from './renderers';
import {
	DEFAULT_SETTINGS,
	ThreadJournalSettingTab,
	normalizedSettings,
} from './settings';
import { ThreadCreator } from './thread-creator';
import { ThreadIndex } from './thread-index';
import { ThreadStatusManager } from './thread-status';
import { ThreadWorkspaceManager } from './thread-workspace';
import type { ThreadJournalSettings } from './types';

export default class ThreadJournalPlugin extends Plugin {
	settings: ThreadJournalSettings = DEFAULT_SETTINGS;
	private index!: ThreadIndex;
	private creator!: ThreadCreator;
	private renderers!: ThreadRenderers;
	private workspaces!: ThreadWorkspaceManager;
	private statuses!: ThreadStatusManager;
	private checkpoints!: CheckpointManager;

	async onload(): Promise<void> {
		await this.loadSettings();
		const getSettings = () => this.settings;
		this.index = new ThreadIndex(this.app);
		this.workspaces = new ThreadWorkspaceManager(this.app, this.index, getSettings);
		this.statuses = new ThreadStatusManager(this.app, this.index);
		this.checkpoints = new CheckpointManager(this.app, this.index, getSettings);
		this.creator = new ThreadCreator(this.app, this.index, this.workspaces, getSettings);
		this.renderers = new ThreadRenderers(
			this.app,
			this.index,
			getSettings,
			(file, entry) => this.checkpoints.openCheckpointEditModal(file, entry),
			(file, entry) => this.checkpoints.openCheckpointDeleteModal(file, entry),
		);

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
			id: 'edit-current-thread-checkpoint-template',
			name: '编辑 checkpoint 模板',
			checkCallback: (checking) => {
				if (!this.checkpoints.getCurrentThreadFile()) return false;
				if (!checking) this.checkpoints.openCurrentCheckpointTemplateModal();
				return true;
			},
		});

		this.addCommand({
			id: 'create-current-thread-checkpoint',
			name: '创建 checkpoint',
			checkCallback: (checking) => {
				if (!this.checkpoints.getCurrentThreadFile()) return false;
				if (!checking) this.checkpoints.openCurrentCheckpointModal();
				return true;
			},
		});

		this.addCommand({
			id: 'set-current-thread-status',
			name: '设置 thread 状态',
			checkCallback: (checking) => {
				if (!this.statuses.getCurrentThreadFile()) return false;
				if (!checking) this.statuses.openCurrentStatusModal();
				return true;
			},
		});

		this.addCommand({
			id: 'open-thread-workspace',
			name: '切换 thread 与工作区',
			checkCallback: (checking) => {
				const file = this.currentThreadOrWorkspaceFile();
				if (!file) return false;
				if (!checking) {
					void this.workspaces.toggleThreadWorkspace(file).catch((error: unknown) => {
						console.error('Thread Journal failed to toggle thread workspace', error);
						new Notice(`切换 Thread 与工作区失败：${String(error)}`);
					});
				}
				return true;
			},
		});

		this.addCommand({
			id: 'insert-inline-log',
			name: '插入 inline log',
			editorCheckCallback: (checking, editor, view) => {
				const file = view.file;
				if (!file || !this.index.getThreadForWorkspace(file)) return false;
				if (!checking) {
					try {
						this.workspaces.insertInlineLog(editor, file);
					} catch (error) {
						console.error('Thread Journal failed to insert inline log', error);
						new Notice(`插入 inline log 失败：${String(error)}`);
					}
				}
				return true;
			},
		});

		this.addCommand({
			id: 'new-thread',
			name: '新建 thread',
			callback: () => {
				this.creator.openNewThreadModal();
			},
		});

	}

	private registerRenderers(): void {
		this.registerMarkdownCodeBlockProcessor('thread-checkpoints', async (_source, el, ctx) => {
			await this.renderers.renderCheckpoints(el, ctx);
		});
		this.registerMarkdownCodeBlockProcessor(
			'thread-daily-checkpoints',
			async (_source, el, ctx) => {
				await this.renderers.renderDailyCheckpoints(el, ctx);
			},
		);

		this.registerMarkdownCodeBlockProcessor('thread-breadcrumb', (_source, el, ctx) => {
			this.renderers.renderBreadcrumb(el, ctx);
		});
		this.registerMarkdownCodeBlockProcessor('thread-children', (_source, el, ctx) => {
			this.renderers.renderChildren(el, ctx);
		});
	}

	private currentThreadOrWorkspaceFile(): TFile | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) return undefined;
		if (this.index.getThread(file) || this.index.getThreadForWorkspace(file)) return file;
		return undefined;
	}
}
