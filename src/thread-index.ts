import { App, TFile } from 'obsidian';
import { normalizeDailyContribution, stripWikiLink } from './core';
import type { ThreadInfo, ThreadJournalSettings, ThreadKind } from './types';

export interface ThreadParentCandidate {
	file: TFile;
	title: string;
	kind: ThreadKind;
}

function frontmatterFor(app: App, file: TFile): Record<string, unknown> {
	return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

function textValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export class ThreadIndex {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	getThread(file: TFile): ThreadInfo | undefined {
		const frontmatter = frontmatterFor(this.app, file);
		if (frontmatter.type !== 'thread') return undefined;
		const rawKind = textValue(frontmatter.kind);
		const kind: ThreadKind = rawKind === 'area' || rawKind === 'project'
			? rawKind
			: 'normal';
		return {
			file,
			id: textValue(frontmatter.thread_id) || file.path,
			title: textValue(frontmatter.title) || file.basename,
			kind,
			status: textValue(frontmatter.status),
			parentLink: stripWikiLink(frontmatter.parent),
			daily: normalizeDailyContribution(frontmatter.daily),
		};
	}

	getAllThreads(): ThreadInfo[] {
		return this.app.vault.getMarkdownFiles()
			.map((file) => this.getThread(file))
			.filter((thread): thread is ThreadInfo => Boolean(thread));
	}

	getParentCandidates(): ThreadParentCandidate[] {
		return this.app.vault.getMarkdownFiles()
			.map((file) => {
				const frontmatter = frontmatterFor(this.app, file);
				const type = textValue(frontmatter.type);
				if (type !== 'thread') return undefined;
				return {
					file,
					title: textValue(frontmatter.title) || file.basename,
					kind: frontmatter.kind === 'area' || frontmatter.kind === 'project'
						? frontmatter.kind
						: 'normal',
				};
			})
			.filter((candidate): candidate is ThreadParentCandidate => Boolean(candidate))
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	getActiveProviders(): ThreadInfo[] {
		const statuses = new Set(
			this.getSettings().activeStatuses
				.split(',')
				.map((status) => status.trim().toLocaleLowerCase())
				.filter(Boolean),
		);
		return this.getAllThreads().filter((thread) =>
			thread.daily.enabled && statuses.has(thread.status.toLocaleLowerCase()));
	}

	getParentFile(file: TFile): TFile | undefined {
		const frontmatter = frontmatterFor(this.app, file);
		const parent = stripWikiLink(frontmatter.parent);
		if (!parent) return undefined;
		const target = this.app.metadataCache.getFirstLinkpathDest(parent, file.path);
		if (!target || frontmatterFor(this.app, target).type !== 'thread') return undefined;
		return target;
	}

	getAncestors(file: TFile): { files: TFile[]; cycle: boolean } {
		const result: TFile[] = [];
		const visited = new Set<string>([file.path]);
		let cursor = this.getParentFile(file);
		while (cursor) {
			if (visited.has(cursor.path)) {
				return { files: result.reverse(), cycle: true };
			}
			visited.add(cursor.path);
			result.push(cursor);
			cursor = this.getParentFile(cursor);
		}
		return { files: result.reverse(), cycle: false };
	}

	getDirectChildren(parent: TFile): ThreadInfo[] {
		return this.getAllThreads()
			.filter((thread) => this.getParentFile(thread.file)?.path === parent.path)
			.sort((a, b) => a.title.localeCompare(b.title));
	}

	getDescendants(root: TFile): ThreadInfo[] {
		const result: ThreadInfo[] = [];
		const queue: TFile[] = [root];
		const visited = new Set<string>([root.path]);
		while (queue.length > 0) {
			const parent = queue.shift();
			if (!parent) break;
			for (const child of this.getDirectChildren(parent)) {
				if (visited.has(child.file.path)) continue;
				visited.add(child.file.path);
				result.push(child);
				queue.push(child.file);
			}
		}
		return result;
	}

	getScope(root: TFile, includeDescendants: boolean): ThreadInfo[] {
		const self = this.getThread(root);
		const result = self ? [self] : [];
		if (includeDescendants) result.push(...this.getDescendants(root));
		return result;
	}
}
