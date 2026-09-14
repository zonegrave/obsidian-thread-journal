import type { App } from 'obsidian';
import { checkpointFieldKey } from './checkpoint-model';
import { t } from './i18n';
import type { CheckpointFieldSpec } from './types';

type ModalFormInput =
	| { type: 'text' | 'textarea' | 'number' | 'toggle' | 'date' | 'time'; hidden: false }
	| {
		type: 'select';
		source: 'fixed';
		options: Array<{ value: string; label: string }>;
	};

interface ModalFormField {
	name: string;
	label: string;
	description: string;
	isRequired: boolean;
	input: ModalFormInput;
}

export interface ModalFormDefinition {
	name: string;
	title: string;
	version: '1';
	customClassname: string;
	fields: ModalFormField[];
}

export interface ModalFormResult {
	status: 'ok' | 'cancelled';
	getData(): Record<string, unknown>;
}

export interface ModalFormApi {
	openForm(
		definition: ModalFormDefinition,
		options: { values: Record<string, unknown> },
	): Promise<ModalFormResult>;
}

interface AppWithPlugins extends App {
	plugins?: {
		plugins?: Record<string, { api?: unknown }>;
	};
}

function fieldInput(field: CheckpointFieldSpec, currentValue?: unknown): ModalFormInput {
	if (field.control === 'select') {
		const options = [...field.options];
		if (
			typeof currentValue === 'string'
			&& currentValue
			&& !options.includes(currentValue)
		) {
			options.push(currentValue);
		}
		return {
			type: 'select',
			source: 'fixed',
			options: options.map((option) => ({ value: option, label: option })),
		};
	}
	return { type: field.control, hidden: false };
}

export function buildCheckpointModalForm(
	title: string,
	fields: CheckpointFieldSpec[],
	values: Record<string, unknown> = {},
): ModalFormDefinition {
	return {
		name: 'thread-journal-checkpoint',
		title,
		version: '1',
		customClassname: 'thread-journal-modal-form',
		fields: [
			{
				name: 'checkpoint_date',
				label: t('Date'),
				description: t('The date when the checkpoint occurred.'),
				isRequired: true,
				input: { type: 'date', hidden: false },
			},
			{
				name: 'checkpoint_time',
				label: t('Time'),
				description: t('The time when the checkpoint occurred.'),
				isRequired: true,
				input: { type: 'time', hidden: false },
			},
			...fields.map((field) => ({
				name: field.key,
				label: field.label,
				description: field.storage === 'inline'
					? t('Queryable field · {key}', { key: field.key })
					: t('Checkpoint body · {key}', { key: field.key }),
				isRequired: field.required,
				input: fieldInput(field, values[field.key]),
			})),
		],
	};
}

function checkpointControlOptions(): Array<{ value: string; label: string }> {
	return [
		{ value: 'text', label: t('Single-line text') },
		{ value: 'textarea', label: t('Multiline text') },
		{ value: 'number', label: t('Number') },
		{ value: 'toggle', label: t('Toggle') },
		{ value: 'date', label: t('Date') },
		{ value: 'select', label: t('Select') },
	];
}

function checkpointStorageOptions(): Array<{ value: string; label: string }> {
	return [
		{ value: 'inline', label: t('Queryable field') },
		{ value: 'body', label: t('Checkpoint body') },
	];
}

export function buildCheckpointTemplateFieldModalForm(
	title: string,
): ModalFormDefinition {
	return {
		name: 'thread-journal-checkpoint-template-field',
		title,
		version: '1',
		customClassname: 'thread-journal-modal-form',
		fields: [
			{
				name: 'label',
				label: t('Display name'),
				description: t('The name shown in checkpoint forms and cards.'),
				isRequired: true,
				input: { type: 'text', hidden: false },
			},
			{
				name: 'key',
				label: t('Field key'),
				description: t('Used in Dataview queries; invalid characters are cleaned when saving.'),
				isRequired: true,
				input: { type: 'text', hidden: false },
			},
			{
				name: 'control',
				label: t('Control'),
				description: t('The input control used when filling in a checkpoint.'),
				isRequired: true,
				input: {
					type: 'select',
					source: 'fixed',
					options: checkpointControlOptions(),
				},
			},
			{
				name: 'storage',
				label: t('Storage'),
				description: t('Queryable fields are written to the header; body fields are better for longer content.'),
				isRequired: true,
				input: {
					type: 'select',
					source: 'fixed',
					options: checkpointStorageOptions(),
				},
			},
			{
				name: 'required',
				label: t('Required'),
				description: t('Toggle and deprecated fields automatically become optional when saved.'),
				isRequired: false,
				input: { type: 'toggle', hidden: false },
			},
			{
				name: 'options',
				label: t('Select'),
				description: t('Used only by select controls. Enter one option per line; commas are also supported.'),
				isRequired: false,
				input: { type: 'textarea', hidden: false },
			},
		],
	};
}

export function checkpointTemplateFieldValues(
	field: CheckpointFieldSpec,
): Record<string, unknown> {
	return {
		label: field.label,
		key: field.key,
		control: field.control,
		storage: field.storage,
		required: field.required,
		options: field.options.join('\n'),
	};
}

function textValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown): boolean {
	return value === true || value === 'true';
}

function optionsValue(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => textValue(item)).filter(Boolean);
	}
	return textValue(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function checkpointFieldFromModalData(
	data: Record<string, unknown>,
	fallback: CheckpointFieldSpec,
): CheckpointFieldSpec {
	const rawControl = textValue(data.control);
	const control = ['text', 'textarea', 'number', 'toggle', 'date', 'select'].includes(rawControl)
		? rawControl as CheckpointFieldSpec['control']
		: fallback.control;
	const rawStorage = textValue(data.storage);
	const storage = rawStorage === 'body' || rawStorage === 'inline'
		? rawStorage
		: fallback.storage;
	const deprecated = data.deprecated === undefined
		? fallback.deprecated
		: booleanValue(data.deprecated);
	return {
		key: checkpointFieldKey(data.key, fallback.key),
		label: textValue(data.label) || fallback.label,
		control,
		storage,
		required: !deprecated && control !== 'toggle' && booleanValue(data.required),
		deprecated,
		options: control === 'select' ? optionsValue(data.options) : [],
	};
}

export function getModalFormApi(app: App): ModalFormApi | undefined {
	const candidate = (app as AppWithPlugins).plugins?.plugins?.modalforms?.api;
	if (typeof candidate !== 'object' || candidate === null) return undefined;
	const openForm = (candidate as { openForm?: unknown }).openForm;
	return typeof openForm === 'function' ? candidate as ModalFormApi : undefined;
}
