import {
	App,
	MarkdownView,
	TFile,
	type WorkspaceLeaf,
	moment,
	normalizePath,
} from 'obsidian';
import { buildWorkspaceBody, buildWorkspaceFileName } from './core';
import type { ThreadIndex } from './thread-index';
import type { ThreadJournalSettings } from './types';

export interface ThreadWorkspaceSeed {
	id: string;
	title: string;
	created?: string;
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function leafFilePath(leaf: WorkspaceLeaf): string | undefined {
	if (leaf.view instanceof MarkdownView) return leaf.view.file?.path;
	const state = leaf.getViewState().state;
	return typeof state?.file === 'string' ? state.file : undefined;
}

export class ThreadWorkspaceManager {
	private readonly pending = new Map<string, Promise<TFile | undefined>>();
	private readonly knownWorkspaces = new Map<string, string>();

	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	async ensureForThread(
		threadFile: TFile,
		seed?: ThreadWorkspaceSeed,
	): Promise<TFile | undefined> {
		const pendingKey = seed?.id || this.index.getThread(threadFile)?.id || threadFile.path;
		const running = this.pending.get(pendingKey);
		if (running) return running;
		const promise = this.createOrFindWorkspace(threadFile, seed).finally(() => {
			this.pending.delete(pendingKey);
		});
		this.pending.set(pendingKey, promise);
		return promise;
	}

	async toggleThreadWorkspace(file: TFile): Promise<void> {
		const sourceView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!sourceView?.file || sourceView.file.path !== file.path) {
			throw new Error('当前活动标签页不是可切换的 thread 或工作区。');
		}

		const thread = this.index.getThread(file);
		const targetFile = thread
			? await this.ensureForThread(file)
			: this.index.getThreadForWorkspace(file);
		if (!targetFile) throw new Error('无法通过 thread_id 定位配套 thread 或工作区。');

		const sourceLeaf = sourceView.leaf;
		const existing = this.findLeafForFileInGroup(targetFile, sourceLeaf);
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			this.app.workspace.setActiveLeaf(existing, { focus: true });
			return;
		}

		this.app.workspace.setActiveLeaf(sourceLeaf, { focus: false });
		const target = this.app.workspace.getLeaf('tab');
		await target.openFile(targetFile, { active: true });
		await this.app.workspace.revealLeaf(target);
		this.app.workspace.setActiveLeaf(target, { focus: true });
	}

	private async createOrFindWorkspace(
		threadFile: TFile,
		seed?: ThreadWorkspaceSeed,
	): Promise<TFile | undefined> {
		const thread = this.index.getThread(threadFile);
		const identity = seed ?? (thread ? { id: thread.id, title: thread.title } : undefined);
		if (!identity) return undefined;
		const knownPath = this.knownWorkspaces.get(identity.id);
		const known = knownPath ? this.app.vault.getAbstractFileByPath(knownPath) : undefined;
		if (known instanceof TFile && this.index.isWorkspaceForThreadId(known, identity.id)) {
			await this.linkThreadAndWorkspace(threadFile, known, identity);
			return known;
		}
		this.knownWorkspaces.delete(identity.id);

		const indexed = this.index.getWorkspaceByThreadId(identity.id);
		if (indexed) {
			await this.linkThreadAndWorkspace(threadFile, indexed, identity);
			this.knownWorkspaces.set(identity.id, indexed.path);
			return indexed;
		}

		const settings = this.getSettings();
		await this.ensureFolder(settings.workspacesFolder);
		const baseName = buildWorkspaceFileName(threadFile.basename, settings.workspaceSuffix);
		let path = normalizePath(settings.workspacesFolder
			? `${settings.workspacesFolder}/${baseName}.md`
			: `${baseName}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			const suffix = identity.id.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'thread';
			path = normalizePath(settings.workspacesFolder
				? `${settings.workspacesFolder}/${baseName}·${suffix}.md`
				: `${baseName}·${suffix}.md`);
			if (this.app.vault.getAbstractFileByPath(path)) {
				throw new Error(`Thread 工作区文件已存在：${path}`);
			}
		}

		const workspaceFile = await this.app.vault.create(path, buildWorkspaceBody(identity.title));
		await this.linkThreadAndWorkspace(threadFile, workspaceFile, identity);
		this.knownWorkspaces.set(identity.id, workspaceFile.path);
		return workspaceFile;
	}

	private async linkThreadAndWorkspace(
		threadFile: TFile,
		workspaceFile: TFile,
		identity: ThreadWorkspaceSeed,
	): Promise<void> {
		const created = identity.created || moment().format('YYYY-MM-DD');
		const threadLink = this.app.fileManager.generateMarkdownLink(
			threadFile,
			workspaceFile.path,
			undefined,
			identity.title,
		);
		const workspaceMetadata = this.app.metadataCache.getFileCache(workspaceFile)?.frontmatter;
		const workspaceNeedsUpdate = workspaceMetadata?.type !== 'thread-workspace'
			|| stringValue(workspaceMetadata.thread_id) !== identity.id
			|| stringValue(workspaceMetadata.thread) !== threadLink
			|| !stringValue(workspaceMetadata.created);
		if (workspaceNeedsUpdate) {
			await this.app.fileManager.processFrontMatter(workspaceFile, (frontmatter) => {
				const metadata = frontmatter as Record<string, unknown>;
				metadata.type = 'thread-workspace';
				metadata.thread_id = identity.id;
				metadata.thread = threadLink;
				metadata.created = stringValue(metadata.created) || created;
			});
		}
	}

	private async ensureFolder(folder: string): Promise<void> {
		const normalized = normalizePath(folder);
		if (!normalized) return;
		let cursor = '';
		for (const segment of normalized.split('/')) {
			cursor = cursor ? `${cursor}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(cursor)) {
				await this.app.vault.createFolder(cursor);
			}
		}
	}

	private findLeafForFileInGroup(
		file: TFile,
		sourceLeaf: WorkspaceLeaf,
	): WorkspaceLeaf | undefined {
		let result: WorkspaceLeaf | undefined;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (
				!result
				&& leaf !== sourceLeaf
				&& leaf.parent === sourceLeaf.parent
				&& leafFilePath(leaf) === file.path
			) result = leaf;
		});
		return result;
	}
}
