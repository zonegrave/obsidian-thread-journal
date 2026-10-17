import type { App, TAbstractFile, TFile } from 'obsidian';
import { t } from './i18n';
import { ROOT_THREAD_ID, rootThreadContent, rootThreadPath } from './thread-root-model';

function isMarkdownFile(file: TAbstractFile): file is TFile {
	return 'extension' in file && file.extension === 'md';
}

export class RootThreadManager {
	private pending?: Promise<TFile>;

	constructor(
		private readonly app: App,
		private readonly getMetaFolder: () => string,
	) {}

	async ensure(created: string): Promise<TFile> {
		if (this.pending) return this.pending;
		this.pending = this.ensureMeta(created);
		try {
			return await this.pending;
		} finally {
			this.pending = undefined;
		}
	}

	private async ensureMeta(created: string): Promise<TFile> {
		const path = rootThreadPath(this.getMetaFolder());
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing) {
			if (!isMarkdownFile(existing)) {
				throw new Error(t('Thread meta already exists: {path}', { path }));
			}
			const file = existing;
			const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (metadata?.type !== 'thread' || metadata.thread_id !== ROOT_THREAD_ID) {
				throw new Error(t('ROOT meta conflicts with an existing file: {path}', { path }));
			}
			return file;
		}
		for (const file of this.app.vault.getMarkdownFiles()) {
			const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (metadata?.type === 'thread' && metadata.thread_id === ROOT_THREAD_ID) {
				throw new Error(t('ROOT meta conflicts with an existing file: {path}', { path: file.path }));
			}
		}
		let folder = '';
		for (const segment of path.split('/').slice(0, -1)) {
			folder = folder ? `${folder}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		}
		return this.app.vault.create(path, rootThreadContent(created));
	}
}
