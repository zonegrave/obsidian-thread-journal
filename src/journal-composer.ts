import { App, Notice, TFile, normalizePath } from 'obsidian';
import {
	buildDailyFormBlock,
	buildDailyTemplateBlock,
	extractThreadDailyForm,
	insertBlocksUnderHeading,
} from './core';
import type { ThreadIndex } from './thread-index';
import type { DailyFieldSpec, ThreadInfo, ThreadJournalSettings } from './types';

export interface ComposeResult {
	providers: number;
	formsAdded: number;
	conflicts: string[];
}

function fieldSignature(field: DailyFieldSpec): string {
	return JSON.stringify({
		control: field.control,
		min: field.min,
		max: field.max,
		step: field.step,
		options: field.options ?? [],
	});
}

export class JournalComposer {
	constructor(
		private readonly app: App,
		private readonly index: ThreadIndex,
		private readonly getSettings: () => ThreadJournalSettings,
	) {}

	isDailyFile(file: TFile): boolean {
		const settings = this.getSettings();
		const folder = normalizePath(settings.dailyFolder);
		const insideFolder = file.path.startsWith(`${folder}/`);
		if (!insideFolder) return false;
		try {
			return new RegExp(settings.dailyFilePattern).test(file.name);
		} catch {
			return /^\d{4}-\d{2}-\d{2}\.md$/.test(file.name);
		}
	}

	async compose(file: TFile, showNotice = true): Promise<ComposeResult> {
		if (!this.isDailyFile(file)) {
			throw new Error(`Not a configured daily note: ${file.path}`);
		}
		const activeThreads = this.index.getActiveThreads();
		const providers = (await Promise.all(activeThreads.map(async (thread) => ({
			thread,
			template: extractThreadDailyForm(await this.app.vault.cachedRead(thread.file)),
		})))).filter((provider) => provider.template || provider.thread.daily.enabled);
		if (providers.length === 0) {
			const result = { providers: 0, formsAdded: 0, conflicts: [] };
			if (showNotice) this.showResult(result);
			return result;
		}
		const legacyThreads = providers
			.filter((provider) => !provider.template)
			.map((provider) => provider.thread);
		const fieldOwners = this.collectFields(legacyThreads);
		const conflicts = [...fieldOwners.entries()]
			.filter(([, declarations]) =>
				new Set(declarations.map((item) => fieldSignature(item.field))).size > 1)
			.map(([key]) => key);
		const conflictSet = new Set(conflicts);
		const blocks = providers.map(({ thread, template }) => template
			? buildDailyTemplateBlock(thread.id, template)
			: buildDailyFormBlock(thread.id, thread.title, thread.daily.form, conflictSet));
		let formsAdded = 0;
		await this.app.vault.process(file, (content) => {
			const result = insertBlocksUnderHeading(
				content,
				this.getSettings().dailyRecordsHeading,
				blocks,
			);
			formsAdded = result.inserted;
			return result.content;
		});

		const result = { providers: providers.length, formsAdded, conflicts };
		if (showNotice) this.showResult(result);
		return result;
	}

	private collectFields(providers: ThreadInfo[]): Map<string, Array<{ field: DailyFieldSpec; thread: ThreadInfo }>> {
		const result = new Map<string, Array<{ field: DailyFieldSpec; thread: ThreadInfo }>>();
		for (const thread of providers) {
			for (const field of thread.daily.fields) {
				const declarations = result.get(field.key) ?? [];
				declarations.push({ field, thread });
				result.set(field.key, declarations);
			}
		}
		return result;
	}

	private showResult(result: ComposeResult): void {
		if (result.providers === 0) {
			new Notice('没有活跃且包含日记表单模板的 thread，日记未改变。');
			return;
		}
		const conflictText = result.conflicts.length > 0
			? `；跳过类型冲突字段：${result.conflicts.join('、')}`
			: '';
		new Notice(
			`已检查 ${result.providers} 个 thread，新增 ${result.formsAdded} 个日记表单${conflictText}`,
		);
	}
}
