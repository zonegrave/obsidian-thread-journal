import { Setting } from 'obsidian';
import { cloneDefaultCheckpointFields } from './checkpoint-model';
import type ThreadJournalPlugin from './main';
import type { CheckpointFieldSpec } from './types';

async function updateField(
	plugin: ThreadJournalPlugin,
	index: number,
	patch: Partial<CheckpointFieldSpec>,
): Promise<void> {
	const current = plugin.settings.checkpointFields[index];
	if (!current) return;
	plugin.settings.checkpointFields[index] = { ...current, ...patch };
	await plugin.saveSettings();
}

export function renderCheckpointFieldSettings(
	containerEl: HTMLElement,
	plugin: ThreadJournalPlugin,
	refresh: () => void,
): void {
	containerEl.createEl('h3', { text: '默认 checkpoint 模板' });
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: '未设置独立模板的 thread 使用这里的字段。废弃字段不再出现在新表单中，但仍用于解释历史 checkpoint，并统一排列在底部。',
	});

	plugin.settings.checkpointFields.forEach((field, index) => {
		const previous = plugin.settings.checkpointFields[index - 1];
		const next = plugin.settings.checkpointFields[index + 1];
		const card = containerEl.createDiv({
			cls: `thread-journal-checkpoint-field-setting${field.deprecated ? ' is-deprecated' : ''}`,
		});
		new Setting(card)
			.setName(field.label || field.key)
			.setDesc(`${field.key}${field.deprecated ? ' · 已废弃' : ''}`)
			.addExtraButton((button) => button
				.setIcon('arrow-up')
				.setTooltip('上移')
				.setDisabled(!previous || previous.deprecated !== field.deprecated)
				.onClick(async () => {
					const fields = plugin.settings.checkpointFields;
					if (index <= 0) return;
					const current = fields[index];
					const previous = fields[index - 1];
					if (!current || !previous) return;
					fields[index - 1] = current;
					fields[index] = previous;
					await plugin.saveSettings();
					refresh();
				}))
			.addExtraButton((button) => button
				.setIcon('arrow-down')
				.setTooltip('下移')
				.setDisabled(!next || next.deprecated !== field.deprecated)
				.onClick(async () => {
					const fields = plugin.settings.checkpointFields;
					if (index >= fields.length - 1) return;
					const current = fields[index];
					const next = fields[index + 1];
					if (!current || !next) return;
					fields[index] = next;
					fields[index + 1] = current;
					await plugin.saveSettings();
					refresh();
				}))
			.addExtraButton((button) => button
				.setIcon('trash-2')
				.setTooltip('删除字段')
				.onClick(async () => {
					plugin.settings.checkpointFields.splice(index, 1);
					await plugin.saveSettings();
					refresh();
				}));

		new Setting(card)
			.setName('显示名称')
			.addText((text) => text
				.setValue(field.label)
				.setPlaceholder('摘要')
				.onChange(async (value) => {
					await updateField(plugin, index, { label: value });
				}));

		new Setting(card)
			.setName('字段键')
			.setDesc('Dataview 查询时使用；checkpoint、checkpoint_date 和 checkpoint_time 为保留键。')
			.addText((text) => text
				.setValue(field.key)
				.setPlaceholder('字段键')
				.onChange(async (value) => {
					await updateField(plugin, index, { key: value });
				}));

		new Setting(card)
			.setName('控件')
			.addDropdown((dropdown) => dropdown
				.addOption('text', '单行文本')
				.addOption('textarea', '多行文本')
				.addOption('number', '数字')
				.addOption('toggle', '开关')
				.addOption('date', '日期')
				.addOption('select', '选择项')
				.setValue(field.control)
				.onChange(async (value) => {
					await updateField(plugin, index, {
						control: value as CheckpointFieldSpec['control'],
					});
					refresh();
				}));

		new Setting(card)
			.setName('保存位置')
			.setDesc('可查询字段会写入 checkpoint 首行；正文字段显示为缩进内容。')
			.addDropdown((dropdown) => dropdown
				.addOption('inline', '可查询字段')
				.addOption('body', 'Checkpoint 正文')
				.setValue(field.storage)
				.onChange(async (value) => {
					await updateField(plugin, index, {
						storage: value as CheckpointFieldSpec['storage'],
					});
				}));

		new Setting(card)
			.setName('必填')
			.addToggle((toggle) => toggle
				.setValue(field.required)
				.setDisabled(field.control === 'toggle' || field.deprecated)
				.onChange(async (value) => {
					await updateField(plugin, index, { required: value });
				}));

		new Setting(card)
			.setName('废弃')
			.setDesc('停止用于新 checkpoint；已有记录仍按实际数据展示。')
			.addToggle((toggle) => toggle
				.setValue(field.deprecated)
				.onChange(async (value) => {
					await updateField(plugin, index, {
						deprecated: value,
						required: value ? false : field.required,
					});
					refresh();
				}));

		if (field.control === 'select') {
			new Setting(card)
				.setName('选项')
				.setDesc('使用英文逗号分隔；保存值与显示文字相同。')
				.addText((text) => text
					.setValue(field.options.join(', '))
					.setPlaceholder('使用逗号分隔')
					.onChange(async (value) => {
						await updateField(plugin, index, {
							options: value.split(',').map((item) => item.trim()).filter(Boolean),
						});
					}));
		}
	});

	new Setting(containerEl)
		.setName('自定义模板字段')
		.setDesc('历史卡片只展示每条 checkpoint 当时实际保存的字段；模板不会补空值或改写历史。')
		.addButton((button) => button
			.setButtonText('添加字段')
			.onClick(async () => {
				const index = plugin.settings.checkpointFields.length + 1;
				plugin.settings.checkpointFields.push({
					key: `checkpoint_field_${index}`,
					label: `自定义字段 ${index}`,
					control: 'text',
					storage: 'inline',
					required: false,
					deprecated: false,
					options: [],
				});
				await plugin.saveSettings();
				refresh();
			}))
		.addButton((button) => button
			.setButtonText('恢复精简默认模板')
			.onClick(async () => {
				plugin.settings.checkpointFields = cloneDefaultCheckpointFields();
				await plugin.saveSettings();
				refresh();
			}));
}
