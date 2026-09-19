import { Setting } from 'obsidian';
import { cloneDefaultCheckpointFields } from './checkpoint-model';
import { t } from './i18n';
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
	containerEl.createEl('h3', { text: t('Default checkpoint template') });
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: t('Threads without an independent template use these fields. Deprecated fields are hidden from new forms, retained for historical checkpoints, and placed last.'),
	});

	plugin.settings.checkpointFields.forEach((field, index) => {
		const previous = plugin.settings.checkpointFields[index - 1];
		const next = plugin.settings.checkpointFields[index + 1];
		let deleteConfirmation: HTMLElement | undefined;
		const card = containerEl.createDiv({
			cls: `thread-journal-checkpoint-field-setting${field.deprecated ? ' is-deprecated' : ''}`,
		});
		new Setting(card)
			.setName(field.label || field.key)
			.setDesc(`${field.key}${field.deprecated ? ` · ${t('Deprecated')}` : ''}`)
			.addExtraButton((button) => button
				.setIcon('arrow-up')
				.setTooltip(t('Move up'))
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
				.setTooltip(t('Move down'))
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
				.setTooltip(t('Delete field'))
				.onClick(() => {
					if (deleteConfirmation?.isConnected) return;
					deleteConfirmation = card.createDiv({
						cls: 'thread-journal-checkpoint-field-delete-confirmation',
					});
					deleteConfirmation.createDiv({
						cls: 'thread-journal-checkpoint-field-delete-message',
						text: t('Delete {field}?', { field: field.label || field.key }),
					});
					deleteConfirmation.createDiv({
						cls: 'setting-item-description',
						text: t('This removes the field from the template. Existing checkpoint records are not rewritten.'),
					});
					const actions = new Setting(deleteConfirmation)
						.setClass('thread-journal-checkpoint-actions');
					actions.addButton((cancel) => cancel
						.setButtonText(t('Cancel'))
						.onClick(() => {
							deleteConfirmation?.remove();
							deleteConfirmation = undefined;
						}));
					actions.addButton((confirm) => confirm
						.setButtonText(t('Delete field'))
						.setDestructive()
						.setCta()
						.onClick(async () => {
							confirm.setDisabled(true);
							plugin.settings.checkpointFields.splice(index, 1);
							await plugin.saveSettings();
							refresh();
						}));
				}));

		new Setting(card)
			.setName(t('Display name'))
			.addText((text) => text
				.setValue(field.label)
				.setPlaceholder(t('Summary'))
				.onChange(async (value) => {
					await updateField(plugin, index, { label: value });
				}));

		new Setting(card)
			.setName(t('Field key'))
			.setDesc(t('Used in Dataview queries. checkpoint, checkpoint_date, and checkpoint_time are reserved.'))
			.addText((text) => text
				.setValue(field.key)
				.setPlaceholder(t('Field key'))
				.onChange(async (value) => {
					await updateField(plugin, index, { key: value });
				}));

		new Setting(card)
			.setName(t('Control'))
			.addDropdown((dropdown) => dropdown
				.addOption('text', t('Single-line text'))
				.addOption('textarea', t('Multiline text'))
				.addOption('number', t('Number'))
				.addOption('toggle', t('Toggle'))
				.addOption('date', t('Date'))
				.addOption('select', t('Select'))
				.setValue(field.control)
				.onChange(async (value) => {
					await updateField(plugin, index, {
						control: value as CheckpointFieldSpec['control'],
					});
					refresh();
				}));

		new Setting(card)
			.setName(t('Storage'))
			.setDesc(t('Queryable fields are written to the checkpoint header; body fields appear as indented content.'))
			.addDropdown((dropdown) => dropdown
				.addOption('inline', t('Queryable field'))
				.addOption('body', t('Checkpoint body'))
				.setValue(field.storage)
				.onChange(async (value) => {
					await updateField(plugin, index, {
						storage: value as CheckpointFieldSpec['storage'],
					});
				}));

		new Setting(card)
			.setName(t('Required'))
			.addToggle((toggle) => toggle
				.setValue(field.required)
				.setDisabled(field.control === 'toggle' || field.deprecated)
				.onChange(async (value) => {
					await updateField(plugin, index, { required: value });
				}));

		new Setting(card)
			.setName(t('Deprecate'))
			.setDesc(t('Stop using this field in new checkpoints. Existing records still display their saved data.'))
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
				.setName(t('Options'))
				.setDesc(t('Separate options with commas. Saved values and displayed labels are identical.'))
				.addText((text) => text
					.setValue(field.options.join(', '))
					.setPlaceholder(t('Separate with commas'))
					.onChange(async (value) => {
						await updateField(plugin, index, {
							options: value.split(',').map((item) => item.trim()).filter(Boolean),
						});
					}));
		}
	});

	let restoreConfirmation: HTMLElement | undefined;
	new Setting(containerEl)
		.setName(t('Custom template fields'))
		.setDesc(t('Historical cards show only the fields saved at the time. The template does not add empty values or rewrite history.'))
		.addButton((button) => button
			.setButtonText(t('Add field'))
			.onClick(async () => {
				const index = plugin.settings.checkpointFields.length + 1;
				plugin.settings.checkpointFields.push({
					key: `checkpoint_field_${index}`,
					label: t('Custom field {index}', { index }),
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
			.setButtonText(t('Restore minimal defaults'))
			.setDestructive()
			.onClick(() => {
				if (restoreConfirmation?.isConnected) return;
				restoreConfirmation = containerEl.createDiv({
					cls: 'thread-journal-checkpoint-template-reset-confirmation',
				});
				restoreConfirmation.createDiv({
					cls: 'thread-journal-checkpoint-field-delete-message',
					text: t('Restore the minimal default template?'),
				});
				restoreConfirmation.createDiv({
					cls: 'setting-item-description',
					text: t('This replaces all global checkpoint fields. Independent thread templates and existing checkpoint records are not changed.'),
				});
				const actions = new Setting(restoreConfirmation)
					.setClass('thread-journal-checkpoint-actions');
				actions.addButton((cancel) => cancel
					.setButtonText(t('Cancel'))
					.onClick(() => {
						restoreConfirmation?.remove();
						restoreConfirmation = undefined;
					}));
				actions.addButton((confirm) => confirm
					.setButtonText(t('Restore minimal defaults'))
					.setDestructive()
					.setCta()
					.onClick(async () => {
						confirm.setDisabled(true);
						plugin.settings.checkpointFields = cloneDefaultCheckpointFields();
						await plugin.saveSettings();
						refresh();
					}));
			}));
}
