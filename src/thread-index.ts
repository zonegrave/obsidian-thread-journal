import type { App, TFile } from 'obsidian';
import { stripWikiLink, wikiLinkAlias } from './core';
import type { ThreadInfo, ThreadKind } from './types';

export interface ThreadParentCandidate {
	file: TFile;
	title: string;
	kind: ThreadKind;
}

export interface ThreadAncestor {
	file: TFile;
	label: string;
}

function frontmatterFor(app: App, file: TFile): Record<string, unknown> {
	return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

function textValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function firstTextValue(value: unknown): string {
	if (Array.isArray(value)) return value.map(textValue).find(Boolean) ?? '';
	return textValue(value);
}

export class ThreadIndex {
	constructor(private readonly app: App) {}

	getThread(file: TFile): ThreadInfo | undefined {
		const frontmatter = frontmatterFor(this.app, file);
		const id = textValue(frontmatter.thread_id);
		if (frontmatter.type !== 'thread' || !id) return undefined;
		const rawKind = textValue(frontmatter.kind);
		const kind: ThreadKind = rawKind === 'area' || rawKind === 'project'
			? rawKind
			: 'normal';
		return {
			file,
			id,
			title: textValue(frontmatter.title) || file.basename,
			kind,
			status: textValue(frontmatter.status),
			parentLink: stripWikiLink(frontmatter.parent),
		};
	}

	getAllThreads(): ThreadInfo[] {
		return this.app.vault.getMarkdownFiles()
			.map((file) => this.getThread(file))
			.filter((thread): thread is ThreadInfo => Boolean(thread));
	}

	getThreadById(threadId: string): ThreadInfo | undefined {
		return this.getAllThreads().find((thread) => thread.id === threadId);
	}

	getParentCandidates(): ThreadParentCandidate[] {
		return this.getAllThreads()
			.map((thread) => ({ file: thread.file, title: thread.title, kind: thread.kind }))
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	getDisplayName(file: TFile): string {
		const frontmatter = frontmatterFor(this.app, file);
		return firstTextValue(frontmatter.aliases)
			|| textValue(frontmatter.title)
			|| file.basename;
	}

	getParent(file: TFile): ThreadAncestor | undefined {
		const metadata = frontmatterFor(this.app, file);
		const parent = stripWikiLink(metadata.parent);
		if (!parent) return undefined;
		const target = this.app.metadataCache.getFirstLinkpathDest(parent, file.path);
		if (!target || !this.getThread(target)) return undefined;
		return {
			file: target,
			label: wikiLinkAlias(metadata.parent) || this.getDisplayName(target),
		};
	}

	getParentFile(file: TFile): TFile | undefined {
		return this.getParent(file)?.file;
	}

	getWorkspace(file: TFile): TFile | undefined {
		const thread = this.getThread(file);
		if (!thread) return undefined;
		return this.getWorkspaceByThreadId(thread.id);
	}

	getWorkspaceByThreadId(threadId: string): TFile | undefined {
		return this.app.vault.getMarkdownFiles().find((candidate) =>
			this.isWorkspaceForThreadId(candidate, threadId));
	}

	getThreadForWorkspace(file: TFile): TFile | undefined {
		const metadata = frontmatterFor(this.app, file);
		if (metadata.type !== 'thread-workspace') return undefined;
		const threadId = textValue(metadata.thread_id);
		if (!threadId) return undefined;
		return this.getThreadById(threadId)?.file;
	}

	getThreadFile(file: TFile): TFile | undefined {
		return this.getThread(file)?.file ?? this.getThreadForWorkspace(file);
	}

	isWorkspaceForThreadId(file: TFile, threadId: string): boolean {
		const metadata = frontmatterFor(this.app, file);
		return metadata.type === 'thread-workspace' && textValue(metadata.thread_id) === threadId;
	}

	getAncestors(file: TFile): { items: ThreadAncestor[]; cycle: boolean } {
		const result: ThreadAncestor[] = [];
		const visited = new Set<string>([file.path]);
		let cursor = this.getParent(file);
		while (cursor) {
			if (visited.has(cursor.file.path)) return { items: result.reverse(), cycle: true };
			visited.add(cursor.file.path);
			result.push(cursor);
			cursor = this.getParent(cursor.file);
		}
		return { items: result.reverse(), cycle: false };
	}

	getDirectChildren(parent: TFile): ThreadInfo[] {
		return this.getAllThreads()
			.filter((thread) => this.getParentFile(thread.file)?.path === parent.path)
			.sort((a, b) => a.title.localeCompare(b.title));
	}
}
