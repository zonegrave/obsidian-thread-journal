import { App, Modal, Notice, Setting } from 'obsidian';
import {
	cloneCommitFields,
	normalizeCommitFields,
	placeDeprecatedFieldsLast,
} from './commit-model';
import { createCommitOptionEditor } from './commit-option-editor';
import { t } from './i18n';
import type { CommitFieldSpec } from './types';

export class CommitTemplateModal extends Modal {
	private fields: CommitFieldSpec[];
	private inherited: boolean;
	private saveQueue: Promise<void> = Promise.resolve();
	private saveRevision = 0;
	private saveTimer: number | undefined;
	private saveStatusEl: HTMLElement | undefined;
	private pendingDeleteField: CommitFieldSpec | undefined;

	constructor(
		app: App,
		private readonly threadTitle: string,
		initialFields: CommitFieldSpec[],
		inherited: boolean,
		private readonly onSave: (fields: CommitFieldSpec[]) => Promise<void>,
	) {
		super(app);
		this.fields = cloneCommitFields(initialFields);
		this.inherited = inherited;
	}

	onOpen(): void {
		this.modalEl.addClass('thread-journal-commit-template-modal');
		this.setTitle(t('Edit commit template'));
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.createDiv({
			cls: 'thread-journal-commit-target',
			text: this.threadTitle,
		});
		this.contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: this.inherited
				? t('This thread currently inherits the global default template. The first change creates an independent template. Deprecated fields are hidden from new commits but still explain historical data.')
				: t('This thread uses an independent template. All changes save automatically; deprecated fields still explain historical data.'),
		});
		this.saveStatusEl = this.contentEl.createDiv({
			cls: 'thread-journal-commit-save-status',
			text: t('Changes save automatically'),
		});

		this.fields.forEach((field, index) => this.renderField(field, index));

		new Setting(this.contentEl)
			.setName(t('Template fields'))
			.setDesc(t('All fields may be removed. A commit then keeps only its fixed date, time, and marker.'))
			.addButton((button) => button
				.setButtonText(t('Add field'))
				.onClick(() => {
					const next = this.fields.length + 1;
					const field: CommitFieldSpec = {
						key: `commit_field_${next}`,
						label: t('Custom field {index}', { index: next }),
						control: 'text',
						storage: 'inline',
						required: false,
						deprecated: false,
						options: [],
					};
					this.fields.push(field);
					this.renderAndSave();
				}));
	}

	private updateSaveStatus(text: string, failed = false): void {
		if (!this.saveStatusEl) return;
		this.saveStatusEl.setText(text);
		this.saveStatusEl.toggleClass('is-failed', failed);
	}

	private queueSave(): void {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		this.inherited = false;
		const revision = ++this.saveRevision;
		const snapshot = normalizeCommitFields(this.fields);
		this.updateSaveStatus(t('Saving…'));
		this.saveQueue = this.saveQueue.then(
			() => this.onSave(snapshot),
			() => this.onSave(snapshot),
		).then(() => {
			if (revision === this.saveRevision) this.updateSaveStatus(t('Saved automatically'));
		}, (error: unknown) => {
			console.error('Thread Journal failed to auto-save commit template', error);
			if (revision === this.saveRevision) this.updateSaveStatus(t('Auto-save failed'), true);
			new Notice(t('Failed to auto-save commit template: {error}', { error: String(error) }));
		});
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
		this.inherited = false;
		this.updateSaveStatus(t('Waiting to save…'));
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined;
			this.queueSave();
		}, 350);
	}

	private flushScheduledSave(): void {
		if (this.saveTimer === undefined) return;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = undefined;
		this.queueSave();
	}

	private renderAndSave(): void {
		this.inherited = false;
		this.render();
		this.queueSave();
	}

	private moveField(field: CommitFieldSpec, index: number, direction: -1 | 1): void {
		const otherIndex = index + direction;
		const other = this.fields[otherIndex];
		if (!other || other.deprecated !== field.deprecated) return;
		this.fields[index] = other;
		this.fields[otherIndex] = field;
		this.renderAndSave();
	}

	private renderField(field: CommitFieldSpec, index: number): void {
		const previous = this.fields[index - 1];
		const next = this.fields[index + 1];
		const card = this.contentEl.createDiv({
			cls: `thread-journal-commit-field-setting${field.deprecated ? ' is-deprecated' : ''}`,
		});
		new Setting(card)
			.setName(field.label || field.key)
			.setDesc(`${field.key}${field.deprecated ? ` · ${t('Deprecated')}` : ''}`)
			.addExtraButton((button) => button
				.setIcon('arrow-up')
				.setTooltip(t('Move up'))
				.setDisabled(!previous || previous.deprecated !== field.deprecated)
				.onClick(() => this.moveField(field, index, -1)))
			.addExtraButton((button) => button
				.setIcon('arrow-down')
				.setTooltip(t('Move down'))
				.setDisabled(!next || next.deprecated !== field.deprecated)
				.onClick(() => this.moveField(field, index, 1)))
			.addExtraButton((button) => button
				.setIcon('trash-2')
				.setTooltip(t('Delete field'))
				.onClick(() => {
					this.pendingDeleteField = field;
					this.render();
				}));

		new Setting(card)
			.setName(t('Display name'))
			.addText((text) => text
				.setValue(field.label)
				.setPlaceholder(t('Summary'))
				.onChange((value) => {
					field.label = value;
					this.scheduleSave();
				}));

		new Setting(card)
			.setName(t('Field key'))
			.setDesc(t('Used in Dataview queries. commit, commit_date, and commit_time are reserved by the system.'))
			.addText((text) => text
				.setValue(field.key)
				.setPlaceholder(t('Field key'))
				.onChange((value) => {
					field.key = value;
					this.scheduleSave();
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
				.onChange((value) => {
					field.control = value as CommitFieldSpec['control'];
					if (field.control !== 'select') field.options = [];
					this.renderAndSave();
				}));

		new Setting(card)
			.setName(t('Storage'))
			.setDesc(t('Queryable fields are written to the header; body fields are better for longer content.'))
			.addDropdown((dropdown) => dropdown
				.addOption('inline', t('Queryable field'))
				.addOption('body', t('Commit body'))
				.setValue(field.storage)
				.onChange((value) => {
					field.storage = value as CommitFieldSpec['storage'];
					this.queueSave();
				}));

		new Setting(card)
			.setName(t('Required'))
			.addToggle((toggle) => toggle
				.setValue(field.required)
				.setDisabled(field.control === 'toggle' || field.deprecated)
				.onChange((value) => {
					field.required = value;
					this.queueSave();
				}));

		new Setting(card)
			.setName(t('Deprecate'))
			.setDesc(t('Stop using this field in new commits. Existing records still display their saved data.'))
			.addToggle((toggle) => toggle
				.setValue(field.deprecated)
				.onChange((value) => {
					field.deprecated = value;
					if (value) field.required = false;
					this.fields = placeDeprecatedFieldsLast(this.fields);
					this.renderAndSave();
				}));

		if (field.control === 'select') {
			const optionsSetting = new Setting(card)
				.setName(t('Options'))
				.setDesc(t('Drag to reorder options.'));
			createCommitOptionEditor(
				optionsSetting.controlEl,
				field.options,
				(options) => {
					field.options = options;
					this.scheduleSave();
				},
			);
		}

		if (this.pendingDeleteField === field) {
			this.renderFieldDeleteConfirmation(card, field);
		}
	}

	private renderFieldDeleteConfirmation(
		card: HTMLElement,
		field: CommitFieldSpec,
	): void {
		const confirmation = card.createDiv({
			cls: 'thread-journal-commit-field-delete-confirmation',
		});
		confirmation.createDiv({
			cls: 'thread-journal-commit-field-delete-message',
			text: t('Delete {field}?', { field: field.label || field.key }),
		});
		confirmation.createDiv({
			cls: 'setting-item-description',
			text: t('This removes the field from the template. Existing commit records are not rewritten.'),
		});
		const actions = new Setting(confirmation)
			.setClass('thread-journal-commit-actions');
		actions.addButton((button) => button
			.setButtonText(t('Cancel'))
			.onClick(() => {
				this.pendingDeleteField = undefined;
				this.render();
			}));
		actions.addButton((button) => button
			.setButtonText(t('Delete field'))
			.setDestructive()
			.setCta()
			.onClick(() => {
				const index = this.fields.indexOf(field);
				this.pendingDeleteField = undefined;
				if (index < 0) return;
				this.fields.splice(index, 1);
				this.renderAndSave();
			}));
	}

	onClose(): void {
		this.flushScheduledSave();
		this.saveStatusEl = undefined;
		this.contentEl.empty();
	}
}
