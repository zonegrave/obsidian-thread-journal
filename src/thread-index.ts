import type { App, TFile } from 'obsidian';
import { stripWikiLink, wikiLinkAlias } from './core';
import type { ThreadInfo, ThreadMemberInfo, ThreadRoleStatus } from './types';

export interface ThreadParentCandidate {
	file: TFile;
	title: string;
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

function threadRoleStatus(value: unknown): ThreadRoleStatus {
	return textValue(value) === 'terminated' ? 'terminated' : 'active';
}

export class ThreadIndex {
	constructor(private readonly app: App) {}

	getThread(file: TFile): ThreadInfo | undefined {
		const frontmatter = frontmatterFor(this.app, file);
		const id = textValue(frontmatter.thread_id);
		if (frontmatter.type !== 'thread' || !id) return undefined;
		return {
			file,
			id,
			title: firstTextValue(frontmatter.aliases) || file.basename,
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

	getMember(file: TFile): ThreadMemberInfo | undefined {
		const frontmatter = frontmatterFor(this.app, file);
		const threadId = textValue(frontmatter.thread_id);
		if (!threadId || frontmatter.type === 'thread') return undefined;
		return {
			file,
			threadId,
			role: textValue(frontmatter.thread_role) || 'workspace',
			roleStatus: threadRoleStatus(frontmatter.thread_role_status),
		};
	}

	getMembersByThreadId(threadId: string): ThreadMemberInfo[] {
		return this.getAllMembers()
			.filter((member) => member.threadId === threadId)
			.sort((left, right) => left.file.basename.localeCompare(right.file.basename));
	}

	getAllMembers(): ThreadMemberInfo[] {
		return this.app.vault.getMarkdownFiles()
			.map((file) => this.getMember(file))
			.filter((member): member is ThreadMemberInfo => Boolean(member));
	}

	getEntry(file: TFile): TFile | undefined {
		const threadFile = this.getThreadFile(file);
		if (!threadFile) return undefined;
		const metadata = frontmatterFor(this.app, threadFile);
		const entryLink = stripWikiLink(metadata.entry);
		if (!entryLink) return undefined;
		const target = this.app.metadataCache.getFirstLinkpathDest(entryLink, threadFile.path);
		const thread = this.getThread(threadFile);
		const member = target ? this.getMember(target) : undefined;
		return thread
			&& target
			&& member?.threadId === thread.id
			&& member.roleStatus === 'active'
			? target
			: undefined;
	}

	isEntry(file: TFile): boolean {
		return this.getEntry(file)?.path === file.path;
	}

	getParentCandidates(): ThreadParentCandidate[] {
		return this.getAllThreads()
			.map((thread) => ({ file: thread.file, title: thread.title }))
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	getDisplayName(file: TFile): string {
		const frontmatter = frontmatterFor(this.app, file);
		return firstTextValue(frontmatter.aliases) || file.basename;
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

	getThreadForMember(file: TFile): TFile | undefined {
		const member = this.getMember(file);
		return member ? this.getThreadById(member.threadId)?.file : undefined;
	}

	getThreadFile(file: TFile): TFile | undefined {
		return this.getThread(file)?.file ?? this.getThreadForMember(file);
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
