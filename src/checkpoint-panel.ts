import {
	ItemView,
	Notice,
	type WorkspaceLeaf,
} from 'obsidian';
import type {
	CheckpointValue,
} from './checkpoint-core';
import type { CheckpointFieldSpec } from './types';
import { LANGUAGE_CHANGE_EVENT, t } from './i18n';

export const CHECKPOINT_PANEL_VIEW_TYPE = 'thread-journal-checkpoint-panel';

export interface CheckpointPanelRequest {
	mode: 'create' | 'edit';
	threadTitle: string;
	fields: CheckpointFieldSpec[];
	date: string;
	time: string;
	values: Record<string, CheckpointValue | undefined>;
	onSubmit: (
		date: string,
		time: string,
		values: Record<string, CheckpointValue | undefined>,
	) => Promise<void>;
}

function valueIsPresent(value: CheckpointValue | undefined): boolean {
	return value !== undefined && (typeof value !== 'string' || value.trim().length > 0);
}

export class CheckpointPanelView extends ItemView {
	private request?: CheckpointPanelRequest;
	private date = '';
	private time = '';
	private values: Record<string, CheckpointValue | undefined> = {};
	private dirty = false;
	private saving = false;
	private saveButton?: HTMLButtonElement;
	private sidebarResize?: {
		element: HTMLElement;
		previousWidth: string;
		appliedWidth: string;
	};
	private readonly inputPrefix = `thread-journal-checkpoint-${Math.random()
		.toString(36).slice(2, 8)}`;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return CHECKPOINT_PANEL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('Checkpoint form');
	}

	getIcon(): string {
		return 'list-checks';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('thread-journal-checkpoint-panel-view');
		this.registerDomEvent(this.contentEl, 'keydown', (event) => {
			if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			void this.save();
		});
		const onLanguageChange = (): void => {
			if (this.request) this.renderForm();
			else this.renderEmpty();
		};
		window.addEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange);
		this.register(() => window.removeEventListener(LANGUAGE_CHANGE_EVENT, onLanguageChange));
		this.renderEmpty();
	}

	async onClose(): Promise<void> {
		this.restoreSidebarWidth();
		this.request = undefined;
		this.values = {};
		this.contentEl.empty();
	}

	setForm(request: CheckpointPanelRequest): boolean {
		if (this.request && this.dirty) {
			new Notice(t('The checkpoint side panel has unsaved changes. Save or close it first.'));
			return false;
		}
		this.request = request;
		this.date = request.date;
		this.time = request.time;
		this.values = { ...request.values };
		this.dirty = false;
		this.saving = false;
		this.renderForm();
		this.expandSidebar();
		return true;
	}

	private expandSidebar(): void {
		if (this.sidebarResize) return;
		const sidebar = this.contentEl.closest<HTMLElement>(
			'.workspace-split.mod-right-split',
		);
		const viewportWidth = sidebar?.ownerDocument.defaultView?.innerWidth ?? 0;
		if (!sidebar || viewportWidth <= 0) return;
		const availableWidth = Math.max(280, viewportWidth - 520);
		const preferredWidth = Math.min(440, Math.max(360, viewportWidth * 0.34));
		const targetWidth = Math.round(Math.min(availableWidth, preferredWidth));
		if (sidebar.getBoundingClientRect().width >= targetWidth - 1) return;
		const appliedWidth = `${targetWidth}px`;
		this.sidebarResize = {
			element: sidebar,
			previousWidth: sidebar.style.width,
			appliedWidth,
		};
		sidebar.style.width = appliedWidth;
		window.setTimeout(() => this.app.workspace.trigger('resize'), 0);
	}

	private restoreSidebarWidth(): void {
		const resized = this.sidebarResize;
		this.sidebarResize = undefined;
		if (!resized?.element.isConnected) return;
		if (resized.element.style.width !== resized.appliedWidth) return;
		resized.element.style.width = resized.previousWidth;
		window.setTimeout(() => this.app.workspace.trigger('resize'), 0);
	}

	private renderEmpty(): void {
		this.contentEl.empty();
		this.contentEl.createEl('h4', { text: t('Checkpoint form') });
		this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-panel-empty',
			text: t('Run “Create checkpoint” from any thread file, or select “Edit” on a card.'),
		});
	}

	private renderForm(): void {
		const request = this.request;
		if (!request) {
			this.renderEmpty();
			return;
		}
		this.contentEl.empty();
		this.contentEl.createEl('h4', {
			cls: 'thread-journal-checkpoint-panel-title',
			text: request.mode === 'edit' ? t('Edit checkpoint') : t('Create checkpoint'),
		});
		this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-panel-target',
			text: request.threadTitle,
		});

		const systemFields = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-panel-system-fields',
		});
		this.addTextField(systemFields, 'checkpoint-date', t('Date'), 'date', this.date, (value) => {
			this.date = value;
		});
		this.addTextField(systemFields, 'checkpoint-time', t('Time'), 'time', this.time, (value) => {
			this.time = value;
		});

		const customFields = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-panel-fields',
		});
		let focusTarget: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
		request.fields.forEach((field, index) => {
			const row = customFields.createDiv({
				cls: `thread-journal-checkpoint-panel-field is-${field.control}`,
			});
			const inputId = `${this.inputPrefix}-${index}`;
			const label = row.createEl('label', {
				cls: 'thread-journal-checkpoint-panel-label',
				attr: { for: inputId, title: field.key },
			});
			label.createSpan({ text: field.label });
			if (field.required) label.createSpan({
				cls: 'thread-journal-checkpoint-panel-required',
				text: ' *',
			});

			const current = this.values[field.key];
			if (field.control === 'textarea') {
				const textarea = row.createEl('textarea', {
					attr: { id: inputId, placeholder: field.label, rows: '6' },
				});
				textarea.value = typeof current === 'string' ? current : '';
				textarea.addEventListener('input', () => {
					this.values[field.key] = textarea.value;
					this.dirty = true;
				});
				focusTarget ??= field.required ? textarea : undefined;
				return;
			}
			if (field.control === 'toggle') {
				const toggle = row.createEl('input', { attr: { id: inputId } });
				toggle.type = 'checkbox';
				toggle.checked = Boolean(current);
				toggle.addEventListener('change', () => {
					this.values[field.key] = toggle.checked;
					this.dirty = true;
				});
				return;
			}
			if (field.control === 'select') {
				const select = row.createEl('select', { attr: { id: inputId } });
				if (!field.required) select.createEl('option', {
					text: t('Not selected'),
					attr: { value: '' },
				});
				for (const option of field.options) {
					select.createEl('option', { text: option, attr: { value: option } });
				}
				const value = typeof current === 'string' ? current : '';
				if (value && !field.options.includes(value)) {
					select.createEl('option', { text: value, attr: { value } });
				}
				select.value = value;
				select.addEventListener('change', () => {
					this.values[field.key] = select.value;
					this.dirty = true;
				});
				focusTarget ??= field.required ? select : undefined;
				return;
			}

			const input = row.createEl('input', {
				attr: { id: inputId, placeholder: field.label },
			});
			input.type = field.control === 'date'
				? 'date'
				: field.control === 'number' ? 'number' : 'text';
			input.value = typeof current === 'string' || typeof current === 'number'
				? String(current)
				: '';
			input.addEventListener('input', () => {
				this.values[field.key] = input.value;
				this.dirty = true;
			});
			focusTarget ??= field.required ? input : undefined;
		});

		const actions = this.contentEl.createDiv({
			cls: 'thread-journal-checkpoint-panel-actions',
		});
		const close = actions.createEl('button', { text: t('Close') });
		close.addEventListener('click', () => this.leaf.detach());
		this.saveButton = actions.createEl('button', {
			cls: 'mod-cta',
			text: request.mode === 'edit' ? t('Save changes') : t('Save checkpoint'),
		});
		this.saveButton.addEventListener('click', () => void this.save());

		window.setTimeout(() => focusTarget?.focus(), 0);
	}

	private addTextField(
		container: HTMLElement,
		key: string,
		labelText: string,
		type: 'date' | 'time',
		value: string,
		onChange: (value: string) => void,
	): void {
		const row = container.createDiv({ cls: 'thread-journal-checkpoint-panel-field' });
		const inputId = `${this.inputPrefix}-${key}`;
		row.createEl('label', {
			cls: 'thread-journal-checkpoint-panel-label',
			text: labelText,
			attr: { for: inputId },
		});
		const input = row.createEl('input', { attr: { id: inputId } });
		input.type = type;
		input.value = value;
		input.addEventListener('input', () => {
			onChange(input.value);
			this.dirty = true;
		});
	}

	private async save(): Promise<void> {
		const request = this.request;
		if (!request || this.saving) return;
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(this.date)) {
			new Notice(t('Enter a valid checkpoint date.'));
			return;
		}
		if (!/^\d{2}:\d{2}$/u.test(this.time)) {
			new Notice(t('Enter a valid checkpoint time.'));
			return;
		}
		const missing = request.fields.find((field) =>
			field.required && !valueIsPresent(this.values[field.key]));
		if (missing) {
			new Notice(t('Enter {field}.', { field: missing.label }));
			return;
		}

		this.saving = true;
		if (this.saveButton) this.saveButton.disabled = true;
		try {
			await request.onSubmit(this.date, this.time, { ...this.values });
			this.dirty = false;
			this.leaf.detach();
		} catch (error) {
			console.error('Thread Journal failed to save checkpoint from side panel', error);
			new Notice(t('Failed to save checkpoint: {error}', { error: String(error) }));
			this.saving = false;
			if (this.saveButton) this.saveButton.disabled = false;
		}
	}
}
