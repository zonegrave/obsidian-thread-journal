import {
	App,
	MarkdownView,
	Notice,
	TFile,
	type WorkspaceLeaf,
	moment,
	normalizePath,
} from 'obsidian';
import {
	buildWorkspaceBody,
	buildWorkspaceFileName,
	isContextHeading,
} from './core';
import type { ThreadIndex } from './thread-index';
import type { ThreadJournalSettings } from './types';

export interface ThreadWorkspaceSeed {
	id: string;
	title: string;
	created?: string;
}

interface CompanionPair {
	mainLeaf: WorkspaceLeaf;
	workspaceLeaf: WorkspaceLeaf;
	threadFile: TFile;
	workspaceFile: TFile;
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function leafFilePath(leaf: WorkspaceLeaf): string | undefined {
	if (leaf.view instanceof MarkdownView) return leaf.view.file?.path;
	const state = leaf.getViewState().state;
	return typeof state?.file === 'string' ? state.file : undefined;
}

function leafContainer(leaf: WorkspaceLeaf): HTMLElement | undefined {
	return (leaf as WorkspaceLeaf & { containerEl?: HTMLElement }).containerEl;
}

export class ThreadWorkspaceManager {
	private pair: CompanionPair | undefined;
	private readonly pending = new Map<string, Promise<TFile | undefined>>();
	private readonly knownWorkspaces = new Map<string, string>();
	private openRequest = 0;
	private redirecting = false;

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

	async openWorkspace(threadFile: TFile, activate = false): Promise<void> {
		const request = ++this.openRequest;
		const workspaceFile = await this.ensureForThread(threadFile);
		if (!workspaceFile) throw new Error('无法定位或创建 Thread 工作区。');
		if (request !== this.openRequest) return;
		if (!activate && this.app.workspace.getActiveFile()?.path !== threadFile.path) return;

		const attachedPair = this.getAttachedPair();
		const sourceView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourceLeaf = sourceView?.file?.path === threadFile.path
			? sourceView.leaf
			: attachedPair && leafFilePath(attachedPair.mainLeaf) === threadFile.path
				? attachedPair.mainLeaf
				: this.findLeafForFile(threadFile, attachedPair?.workspaceLeaf)
					?? this.app.workspace.getMostRecentLeaf()
					?? undefined;
		if (!sourceLeaf) throw new Error('无法定位用于打开工作区的主文件窗口。');

		let target = attachedPair?.workspaceLeaf;
		if (!target || target === sourceLeaf) target = this.findLeafForFile(workspaceFile, sourceLeaf);
		if (!target || target === sourceLeaf) {
			target = this.app.workspace.createLeafBySplit(sourceLeaf, 'vertical');
		}
		this.pair = {
			mainLeaf: sourceLeaf,
			workspaceLeaf: target,
			threadFile,
			workspaceFile,
		};
		await target.openFile(workspaceFile, { active: activate });
		if (activate) {
			await this.app.workspace.revealLeaf(target);
			this.app.workspace.setActiveLeaf(target, { focus: true });
		} else {
			this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
		}
	}

	async openContextFromWorkspace(workspaceFile: TFile): Promise<void> {
		const threadFile = this.index.getThreadForWorkspace(workspaceFile);
		if (!threadFile) throw new Error('无法通过 thread_id 定位主 thread。');

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourceLeaf = activeView?.file?.path === workspaceFile.path
			? activeView.leaf
			: this.findLeafForFile(workspaceFile);
		if (!sourceLeaf) throw new Error('无法定位当前 Thread 工作区窗口。');

		const pair = this.getAttachedPair();
		let target = pair?.workspaceLeaf === sourceLeaf && this.isLeafLeftOf(pair.mainLeaf, sourceLeaf)
			? pair.mainLeaf
			: undefined;
		if (!target) {
			const existing = this.findLeafForFile(threadFile, sourceLeaf);
			if (existing && this.isLeafLeftOf(existing, sourceLeaf)) target = existing;
		}
		if (!target) target = this.app.workspace.createLeafBySplit(sourceLeaf, 'vertical', true);

		this.pair = {
			mainLeaf: target,
			workspaceLeaf: sourceLeaf,
			threadFile,
			workspaceFile,
		};
		const heading = this.app.metadataCache.getFileCache(threadFile)?.headings
			?.find((candidate) => isContextHeading(candidate.heading));
		await target.openFile(threadFile, {
			active: true,
			...(heading ? { eState: { subpath: `#${heading.heading}` } } : {}),
		});
		await this.app.workspace.revealLeaf(target);
		this.app.workspace.setActiveLeaf(target, { focus: true });
		if (!heading) new Notice('未找到 context 标题，已打开主 thread。');
	}

	async handleFileOpen(file: TFile | null): Promise<void> {
		if (!file || this.redirecting) return;
		try {
			const pair = this.getAttachedPair();
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (
				pair
				&& activeView?.leaf === pair.workspaceLeaf
				&& file.path !== pair.workspaceFile.path
			) {
				await this.redirectFromWorkspaceLeaf(file, pair);
				return;
			}
		} catch (error) {
			console.error('Thread Journal failed to open workspace', error);
			new Notice(`打开 Thread 工作区失败：${String(error)}`);
		}
	}

	handleLayoutChange(): void {
		const pair = this.pair;
		if (!pair) return;
		const mainAttached = this.isLeafUsable(pair.mainLeaf);
		const workspaceAttached = this.isLeafUsable(pair.workspaceLeaf);
		if (!mainAttached) {
			this.pair = undefined;
			if (workspaceAttached) pair.workspaceLeaf.detach();
			return;
		}
		if (!workspaceAttached) this.pair = undefined;
	}

	private async redirectFromWorkspaceLeaf(file: TFile, pair: CompanionPair): Promise<void> {
		const threadForWorkspace = this.index.getThreadForWorkspace(file);
		const mainTarget = threadForWorkspace ?? file;
		this.redirecting = true;
		try {
			await pair.mainLeaf.openFile(mainTarget, { active: true });
			this.app.workspace.setActiveLeaf(pair.mainLeaf, { focus: true });
			if (this.index.getThread(mainTarget)) {
				await this.openWorkspace(mainTarget, false);
				return;
			}
			if (this.isLeafUsable(pair.workspaceLeaf)) {
				await pair.workspaceLeaf.openFile(pair.workspaceFile, { active: false });
				this.pair = pair;
			}
		} finally {
			this.redirecting = false;
		}
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

	private findLeafForFile(
		file: TFile,
		excludedLeaf?: WorkspaceLeaf,
	): WorkspaceLeaf | undefined {
		let result: WorkspaceLeaf | undefined;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!result && leaf !== excludedLeaf && leafFilePath(leaf) === file.path) result = leaf;
		});
		return result;
	}

	private isLeafUsable(target: WorkspaceLeaf): boolean {
		const container = leafContainer(target);
		if (container?.isConnected) return true;
		let found = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === target) found = true;
		});
		return found;
	}

	private isLeafLeftOf(target: WorkspaceLeaf, source: WorkspaceLeaf): boolean {
		if (!this.isLeafUsable(target) || !this.isLeafUsable(source)) return false;
		const targetContainer = leafContainer(target);
		const sourceContainer = leafContainer(source);
		if (!targetContainer?.isConnected || !sourceContainer?.isConnected) return false;
		return targetContainer.getBoundingClientRect().left
			< sourceContainer.getBoundingClientRect().left - 1;
	}

	private getAttachedPair(): CompanionPair | undefined {
		const pair = this.pair;
		if (!pair) return undefined;
		if (this.isLeafUsable(pair.mainLeaf) && this.isLeafUsable(pair.workspaceLeaf)) return pair;
		this.pair = undefined;
		return undefined;
	}
}
