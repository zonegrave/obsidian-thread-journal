import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type ThreadJournalPlugin from './main';
import type { ThreadJournalSettings } from './types';

export const DEFAULT_SETTINGS: ThreadJournalSettings = {
	threadsFolder: '50-行动系统',
	dailyFolder: '00-日记',
	dailyFilePattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$',
	dailyRecordsHeading: '今日记录',
	activeStatuses: 'active,进行中,启用',
	autoComposeDaily: true,
};

export function normalizedSettings(
	value: Partial<ThreadJournalSettings> | null | undefined,
): ThreadJournalSettings {
	const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
	return {
		threadsFolder: normalizePath(merged.threadsFolder.trim() || DEFAULT_SETTINGS.threadsFolder),
		dailyFolder: normalizePath(merged.dailyFolder.trim() || DEFAULT_SETTINGS.dailyFolder),
		dailyFilePattern: merged.dailyFilePattern.trim() || DEFAULT_SETTINGS.dailyFilePattern,
		dailyRecordsHeading: merged.dailyRecordsHeading.trim() || DEFAULT_SETTINGS.dailyRecordsHeading,
		activeStatuses: merged.activeStatuses.trim() || DEFAULT_SETTINGS.activeStatuses,
		autoComposeDaily: merged.autoComposeDaily,
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
			.setName('日记目录')
			.setDesc('仅扫描和修改这个目录中的日记。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.dailyFolder)
				.setValue(this.plugin.settings.dailyFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('日记文件正则')
			.setDesc('用于自动补全新建日记；默认匹配 yyyy-mm-dd.md。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.dailyFilePattern)
				.setValue(this.plugin.settings.dailyFilePattern)
				.onChange(async (value) => {
					this.plugin.settings.dailyFilePattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('日记记录标题')
			.setDesc('活跃 thread 的正文表单模板会复制到这个二级标题下。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.dailyRecordsHeading)
				.setValue(this.plugin.settings.dailyRecordsHeading)
				.onChange(async (value) => {
					this.plugin.settings.dailyRecordsHeading = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('活跃状态')
			.setDesc('逗号分隔。只有状态匹配且正文包含 thread-daily-form 的 thread 参与注入。')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.activeStatuses)
				.setValue(this.plugin.settings.activeStatuses)
				.onChange(async (value) => {
					this.plugin.settings.activeStatuses = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自动补全新日记')
			.setDesc('日记创建后复制活跃 thread 的表单模板；填写控件后写入日记属性。')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.autoComposeDaily)
				.onChange(async (value) => {
					this.plugin.settings.autoComposeDaily = value;
					await this.plugin.saveSettings();
				}));
	}
}
