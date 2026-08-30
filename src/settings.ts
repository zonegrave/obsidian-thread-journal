import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type ThreadJournalPlugin from './main';
import type { ThreadJournalSettings } from './types';

export const DEFAULT_SETTINGS: ThreadJournalSettings = {
	threadsFolder: '50-行动系统',
	threadTemplatePath: 'Templates/Thread.md',
	legacyDailyFolder: '00-日记',
};

export function normalizedSettings(
	value: Partial<ThreadJournalSettings> | null | undefined,
): ThreadJournalSettings {
	const raw = (value ?? {}) as Partial<ThreadJournalSettings> & { dailyFolder?: unknown };
	const merged = { ...DEFAULT_SETTINGS, ...raw };
	const legacyDailyFolder = typeof raw.legacyDailyFolder === 'string'
		? raw.legacyDailyFolder
		: typeof raw.dailyFolder === 'string'
			? raw.dailyFolder
			: DEFAULT_SETTINGS.legacyDailyFolder;
	return {
		threadsFolder: normalizePath(merged.threadsFolder.trim() || DEFAULT_SETTINGS.threadsFolder),
		threadTemplatePath: normalizePath(
			merged.threadTemplatePath.trim() || DEFAULT_SETTINGS.threadTemplatePath,
		),
		legacyDailyFolder: normalizePath(
			legacyDailyFolder.trim() || DEFAULT_SETTINGS.legacyDailyFolder,
		),
	};
}

export class ThreadJournalSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ThreadJournalPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('线程目录')
			.setDesc('“新建子线程”和“新建同级线程”创建文件的位置。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadsFolder)
				.setValue(this.plugin.settings.threadsFolder)
				.onChange(async (value) => {
					this.plugin.settings.threadsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Thread 模板')
			.setDesc('新建 thread 时读取的完整 Markdown 模板；身份和层级属性仍由插件校正。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.threadTemplatePath)
				.setValue(this.plugin.settings.threadTemplatePath)
				.onChange(async (value) => {
					this.plugin.settings.threadTemplatePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('旧日记目录')
			.setDesc('只读扫描旧版已注入的历史记录；插件不再修改或补全日记。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.legacyDailyFolder)
				.setValue(this.plugin.settings.legacyDailyFolder)
				.onChange(async (value) => {
					this.plugin.settings.legacyDailyFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}
