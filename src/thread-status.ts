import {
	App,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	TFile,
	type FuzzyMatch,
} from 'obsidian';
import type { ThreadIndex } from './thread-index';
import {
	THREAD_STATUS_CHOICES,
	type ThreadStatus,
	type ThreadStatusChoice,
} from './thread-status-model';

class ThreadStatusModal extends FuzzySuggestModal<ThreadStatusChoice> {
	constructor(
		app: App,
		private readonly currentStatus: string,
		private readonly onChoose: (status: ThreadStatus) => Promise<void>,
	) {
		super(app);
		this.setPlaceholder('选择 thread 状态');
	}

	getItems(): ThreadStatusChoice[] {
		return [...THREAD_STATUS_CHOICES];
	}

	getItemText(item: ThreadStatusChoice): string {
		return `${item.label} ${item.value} ${item.description}`;
	}

	renderSuggestion(match: FuzzyMatch<ThreadStatusChoice>, el: HTMLElement): void {
		const current = match.item.value === this.currentStatus ? ' · 当前' : '';
		el.createDiv({ text: `${match.item.label}${current}` });
		el.createDiv({
			cls: 'suggestion-note',
			text: `${match.item.value} · ${match.item.description}`,
		});
	}

	onChooseItem(item: ThreadStatusChoice): void {
		void this.onChoose(item.value);
	}
}

export class ThreadStatusManager {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
	) {}

	getCurrentThreadFile(): TFile | undefined {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (!file) return undefined;
		return this.index.getThreadFile(file);
	}

	openCurrentStatusModal(): void {
		const file = this.getCurrentThreadFile();
		if (!file) {
			new Notice('当前文件不属于 thread。');
			return;
		}
		const current = this.index.getThread(file)?.status ?? '';
		new ThreadStatusModal(this.app, current, async (status) => {
			await this.setStatus(file, status);
		}).open();
	}

	private async setStatus(file: TFile, status: ThreadStatus): Promise<void> {
		const current = this.index.getThread(file)?.status;
		if (current === status) {
			new Notice(`当前状态已经是 ${status}。`);
			return;
		}
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const metadata = frontmatter as Record<string, unknown>;
			metadata.status = status;
		});
		const choice = THREAD_STATUS_CHOICES.find((item) => item.value === status);
		new Notice(`已将 ${file.basename} 设置为${choice?.label ?? status}。`);
	}
}
