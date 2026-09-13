import { openThreadOverview, renderThreadOverview } from './thread-overview';
import { ThreadBreadcrumbManager } from './thread-breadcrumb';
import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from 'obsidian';
import { CheckpointManager } from './checkpoint';
import { checkpointEditorExtension } from './checkpoint-editor';
import {
	CHECKPOINT_PANEL_VIEW_TYPE,
	CheckpointPanelView,
} from './checkpoint-panel';
import { ThreadRenderers } from './renderers';
import {
	DEFAULT_SETTINGS,
	ThreadJournalSettingTab,
	normalizedSettings,
} from './settings';
import { ThreadCreator } from './thread-creator';
import { ThreadFileManager } from './thread-files';
import { ThreadIndex } from './thread-index';
import { ThreadParentManager } from './thread-parent';
import { ThreadStatusManager } from './thread-status';
import { ThreadSwitcherManager } from './thread-switcher';
import type { ThreadJournalSettings } from './types';

export default class ThreadJournalPlugin extends Plugin {
	settings: ThreadJournalSettings = DEFAULT_SETTINGS;
	private index!: ThreadIndex;
	private creator!: ThreadCreator;
	private renderers!: ThreadRenderers;
	private files!: ThreadFileManager;
	private parents!: ThreadParentManager;
	private statuses!: ThreadStatusManager;
	private checkpoints!: CheckpointManager;
	private switcher!: ThreadSwitcherManager;
	private breadcrumbs!: ThreadBreadcrumbManager;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(
			CHECKPOINT_PANEL_VIEW_TYPE,
			(leaf) => new CheckpointPanelView(leaf),
		);
		const getSettings = () => this.settings;
		this.index = new ThreadIndex(this.app);
		this.files = new ThreadFileManager(this.app, this.index, getSettings);
		this.switcher = new ThreadSwitcherManager(this.app, this.index, this.files);
		this.parents = new ThreadParentManager(this.app, this.index);
		this.statuses = new ThreadStatusManager(this.app, this.index);
		this.breadcrumbs = new ThreadBreadcrumbManager(
			this.app,
			this.index,
			this.files,
			this.statuses,
			this.switcher,
			getSettings,
		);
		this.checkpoints = new CheckpointManager(
			this.app,
			this.index,
			getSettings,
		);
		this.creator = new ThreadCreator(this.app, this.index, this.files, getSettings);
		this.renderers = new ThreadRenderers(
			this.app,
			this.index,
			getSettings,
			(file, entry) => this.checkpoints.openCheckpointEditModal(file, entry),
			(file, entry) => this.checkpoints.openCheckpointDeleteModal(file, entry),
		);
		this.registerEditorExtension(checkpointEditorExtension(
			(file) => Boolean(this.index.getThreadForMember(file)),
			(callout, file, entry, registerChild) =>
				this.renderers.renderSourceCheckpointCallout(
					callout,
					file,
					entry,
					registerChild,
				),
			(callout, file, entry) => {
				this.renderers.renderSourceLogCallout(callout, file, entry);
			},
		));
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			this.switcher.rememberActiveLeaf(leaf);
			this.breadcrumbs.refresh();
		}));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.breadcrumbs.refresh()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.breadcrumbs.refresh()));
		this.registerEvent(this.app.metadataCache.on('changed', () => this.breadcrumbs.refresh()));
		this.switcher.rememberActiveLeaf(
			this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null,
		);

		this.registerCommands();
		this.registerRenderers();
		this.addSettingTab(new ThreadJournalSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => this.breadcrumbs.refresh(true));
	}

	onunload(): void {
		this.breadcrumbs?.unload();
	}

	refreshBreadcrumbBars(resetFilter = false): void {
		this.breadcrumbs?.refresh(resetFilter);
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
		this.addCommand({ id: 'thread-overview', name: 'Open thread overview', callback: () => openThreadOverview(this.app, this.index, this.statuses) });
		this.addCommand({
			id: 'edit-current-thread-checkpoint-template',
			name: 'Edit checkpoint template',
			checkCallback: (checking) => {
				if (!this.checkpoints.getCurrentThreadFile()) return false;
				if (!checking) this.checkpoints.openCurrentCheckpointTemplateModal();
				return true;
			},
		});

		this.addCommand({
			id: 'create-current-thread-checkpoint',
			name: 'Create checkpoint',
			checkCallback: (checking) => {
				if (!this.checkpoints.canCreateCurrentCheckpoint()) return false;
				if (!checking) this.checkpoints.openCurrentCheckpointModal();
				return true;
			},
		});

		this.addCommand({
			id: 'set-current-thread-status',
			name: 'Set thread status',
			checkCallback: (checking) => {
				if (!this.statuses.getCurrentThreadFile()) return false;
				if (!checking) this.statuses.openCurrentStatusModal();
				return true;
			},
		});

		this.addCommand({
			id: 'set-thread-parent',
			name: 'Change thread parent',
			checkCallback: (checking) => {
				if (!this.parents.getCurrentThreadFile()) return false;
				if (!checking) this.parents.openCurrentParentModal();
				return true;
			},
		});

		this.addCommand({
			id: 'open-thread-workspace',
			name: 'Switch active thread role',
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) {
					void this.files.switchActiveThreadRole(file).catch((error: unknown) => {
						console.error('Thread Journal failed to switch active thread role', error);
						new Notice(`切换 active thread role 失败：${String(error)}`);
					});
				}
				return true;
			},
		});

		this.addCommand({
			id: 'switch-open-thread',
			name: 'Manage open threads',
			callback: () => {
				this.switcher.open();
			},
		});

		this.addCommand({
			id: 'manage-thread-files',
			name: 'Manage thread files',
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) this.files.openThreadFilesModal(file);
				return true;
			},
		});

		this.addCommand({
			id: 'new-thread-file',
			name: 'Create thread file',
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) this.files.openNewThreadFileModal(file);
				return true;
			},
		});

		this.addCommand({
			id: 'set-thread-entry',
			name: 'Set as thread entry',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				const threadFile = file ? this.index.getThreadForMember(file) : undefined;
				const member = file ? this.index.getMember(file) : undefined;
				if (
					!file
					|| !threadFile
					|| member?.roleStatus !== 'active'
					|| this.index.isEntry(file)
				) return false;
				if (!checking) {
					void this.files.setEntry(threadFile, file).catch((error: unknown) => {
						console.error('Thread Journal failed to set thread entry', error);
						new Notice(`设置 thread 入口失败：${String(error)}`);
					});
				}
				return true;
			},
		});

		this.addCommand({
			id: 'insert-inline-log',
			name: 'Insert inline log',
			editorCheckCallback: (checking, editor, view) => {
				const file = view.file;
				const member = file ? this.index.getMember(file) : undefined;
				if (!file || member?.roleStatus !== 'active' || !this.index.getThreadForMember(file)) {
					return false;
				}
				if (!checking) {
					try {
						this.files.insertInlineLog(editor, file);
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
			name: 'Create thread',
			callback: () => {
				this.creator.openNewThreadModal();
			},
		});

	}

	private registerRenderers(): void {
		this.registerMarkdownCodeBlockProcessor('thread-overview', (_source, el, ctx) => renderThreadOverview(this.app, this.index, this.statuses, el, ctx));
		this.registerMarkdownPostProcessor(async (el, ctx) => {
			await this.renderers.enhanceCheckpointCallouts(el, ctx);
			this.renderers.enhanceLogCallouts(el, ctx);
		});
		this.registerMarkdownCodeBlockProcessor('thread-entries', async (source, el, ctx) => {
			await this.renderers.renderEntries(source, el, ctx);
		});

		this.registerMarkdownCodeBlockProcessor('thread-children', (_source, el, ctx) => {
			this.renderers.renderChildren(el, ctx);
		});
	}

	private currentThreadFile(): TFile | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) return undefined;
		if (this.index.getThreadFile(file)) return file;
		return undefined;
	}
}
