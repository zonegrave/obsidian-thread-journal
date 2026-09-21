import {
	openThreadOverview,
	renderThreadOverview,
	THREAD_OVERVIEW_VIEW_TYPE,
	ThreadOverviewView,
} from './thread-overview';
import { ThreadBreadcrumbManager } from './thread-breadcrumb';
import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	getLanguage,
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
import { ThreadMetaManager } from './thread-meta';
import { ThreadParentManager } from './thread-parent';
import { ThreadSwitcherManager } from './thread-switcher';
import { TaskManager } from './task';
import {
	LANGUAGE_CHANGE_EVENT,
	resolveLocale,
	setLocale,
	t,
} from './i18n';
import type { ThreadJournalSettings } from './types';

export default class ThreadJournalPlugin extends Plugin {
	settings: ThreadJournalSettings = DEFAULT_SETTINGS;
	private index!: ThreadIndex;
	private creator!: ThreadCreator;
	private renderers!: ThreadRenderers;
	private files!: ThreadFileManager;
	private meta!: ThreadMetaManager;
	private parents!: ThreadParentManager;
	private checkpoints!: CheckpointManager;
	private switcher!: ThreadSwitcherManager;
	private breadcrumbs!: ThreadBreadcrumbManager;
	private tasks!: TaskManager;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(
			CHECKPOINT_PANEL_VIEW_TYPE,
			(leaf) => new CheckpointPanelView(leaf),
		);
		const getSettings = () => this.settings;
		this.index = new ThreadIndex(this.app);
		this.tasks = new TaskManager(this.app, this.index);
		this.registerView(
			THREAD_OVERVIEW_VIEW_TYPE,
			(leaf) => new ThreadOverviewView(leaf, this.index, this.tasks),
		);
		this.files = new ThreadFileManager(this.app, this.index, getSettings);
		this.switcher = new ThreadSwitcherManager(this.app, this.index, this.files);
		this.parents = new ThreadParentManager(this.index);
		this.checkpoints = new CheckpointManager(
			this.app,
			this.index,
			getSettings,
		);
		this.meta = new ThreadMetaManager(
			this.app,
			this.index,
			this.parents,
			this.files,
			this.checkpoints,
		);
		this.breadcrumbs = new ThreadBreadcrumbManager(
			this.app,
			this.index,
			this.files,
			this.meta,
			this.switcher,
			getSettings,
		);
		this.creator = new ThreadCreator(this.app, this.index, this.files, getSettings);
		this.renderers = new ThreadRenderers(
			this.app,
			this.index,
			getSettings,
			this.tasks,
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
			(callout, file, entry, registerChild) =>
				this.renderers.renderSourceLogCallout(callout, file, entry, registerChild),
			(file, line, sourceLine) =>
				this.tasks.moveFileTaskToNext(file, line, sourceLine),
			(file, line, sourceLine, data) =>
				this.tasks.openFileTaskEdit(file, line, sourceLine, data),
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
		this.app.workspace.onLayoutReady(() => this.breadcrumbs.refresh());
	}

	onunload(): void {
		this.breadcrumbs?.unload();
	}

	refreshBreadcrumbBars(): void {
		this.breadcrumbs?.refresh();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<ThreadJournalSettings> | null;
		const language = stored?.language === 'zh' || stored?.language === 'en'
			? stored.language
			: 'auto';
		setLocale(resolveLocale(language, getLanguage()));
		this.settings = normalizedSettings(stored);
	}

	async saveSettings(): Promise<void> {
		this.settings = normalizedSettings(this.settings);
		setLocale(resolveLocale(this.settings.language, getLanguage()));
		await this.saveData(this.settings);
		this.refreshBreadcrumbBars();
		window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
	}

	private registerCommands(): void {
		this.addCommand({ id: 'thread-overview', name: t('Open thread overview'), callback: () => void openThreadOverview(this.app) });
		this.addCommand({
			id: 'edit-current-thread-checkpoint-template',
			name: t('Edit checkpoint template'),
			checkCallback: (checking) => {
				const threadFile = this.meta.getCurrentThreadFile();
				if (!threadFile) return false;
				if (!checking) this.checkpoints.openCheckpointTemplateModal(threadFile);
				return true;
			},
		});
		this.addCommand({
			id: 'manage-thread',
			name: t('Manage thread'),
			checkCallback: (checking) => {
				if (!this.meta.getCurrentThreadFile()) return false;
				if (!checking) this.meta.openCurrentMetaModal();
				return true;
			},
		});

		this.addCommand({
			id: 'create-current-thread-checkpoint',
			name: t('Create checkpoint'),
			checkCallback: (checking) => {
				if (!this.checkpoints.canCreateCurrentCheckpoint()) return false;
				if (!checking) this.checkpoints.openCurrentCheckpointModal();
				return true;
			},
		});

		this.addCommand({
			id: 'open-thread-workspace',
			name: t('Switch active thread role'),
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) {
					void this.files.switchActiveThreadRole(file).catch((error: unknown) => {
						console.error('Thread Journal failed to switch active thread role', error);
						new Notice(t('Failed to switch active thread role: {error}', { error: String(error) }));
					});
				}
				return true;
			},
		});

		this.addCommand({
			id: 'switch-open-thread',
			name: t('Manage open threads'),
			callback: () => {
				this.switcher.open();
			},
		});

		this.addCommand({
			id: 'manage-thread-files',
			name: t('Manage thread files'),
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) this.files.openThreadFilesModal(file);
				return true;
			},
		});

		this.addCommand({
			id: 'new-thread-file',
			name: t('Create thread file'),
			checkCallback: (checking) => {
				const file = this.currentThreadFile();
				if (!file) return false;
				if (!checking) this.files.openNewThreadFileModal(file);
				return true;
			},
		});

		this.addCommand({
			id: 'create-task',
			name: t('Create task'),
			editorCheckCallback: (checking, editor, view) => {
				if (!this.tasks.canCreateTask(editor, view.file)) return false;
				if (!checking) this.tasks.openCreateTask(editor);
				return true;
			},
		});

		this.addCommand({
			id: 'edit-task',
			name: t('Edit task'),
			editorCheckCallback: (checking, editor, view) => {
				if (!this.tasks.canEditTask(editor, view.file)) return false;
				if (!checking) this.tasks.openEditTask(editor);
				return true;
			},
		});

		this.addCommand({
			id: 'insert-inline-log',
			name: t('Insert inline log'),
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
						new Notice(t('Failed to insert inline log: {error}', { error: String(error) }));
					}
				}
				return true;
			},
		});

		this.addCommand({
			id: 'new-thread',
			name: t('Create thread'),
			callback: () => {
				this.creator.openNewThreadModal();
			},
		});

	}

	private registerRenderers(): void {
		this.registerMarkdownCodeBlockProcessor('thread-overview', (_source, el, ctx) => renderThreadOverview(this.app, this.index, this.tasks, el, ctx));
		this.registerMarkdownPostProcessor(async (el, ctx) => {
			await this.renderers.enhanceCheckpointCallouts(el, ctx);
			await this.renderers.enhanceLogCallouts(el, ctx);
			await this.renderers.enhanceTasks(el, ctx);
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
