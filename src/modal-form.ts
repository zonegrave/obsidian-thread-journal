import type { App } from 'obsidian';
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
				label: '日期',
				description: 'Checkpoint 的发生日期。',
				isRequired: true,
				input: { type: 'date', hidden: false },
			},
			{
				name: 'checkpoint_time',
				label: '时间',
				description: 'Checkpoint 的发生时间。',
				isRequired: true,
				input: { type: 'time', hidden: false },
			},
			...fields.map((field) => ({
				name: field.key,
				label: field.label,
				description: field.storage === 'inline'
					? `可查询字段 · ${field.key}`
					: `Checkpoint 正文 · ${field.key}`,
				isRequired: field.required,
				input: fieldInput(field, values[field.key]),
			})),
		],
	};
}

export function getModalFormApi(app: App): ModalFormApi | undefined {
	const candidate = (app as AppWithPlugins).plugins?.plugins?.modalforms?.api;
	if (typeof candidate !== 'object' || candidate === null) return undefined;
	const openForm = (candidate as { openForm?: unknown }).openForm;
	return typeof openForm === 'function' ? candidate as ModalFormApi : undefined;
}
