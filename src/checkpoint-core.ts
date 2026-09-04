import { checkpointFieldKey } from './checkpoint-model';
import type { CheckpointFieldSpec } from './types';

export type CheckpointValue = string | number | boolean;

export interface CheckpointEntryInput {
	date: string;
	time: string;
	blockId: string;
	fields: CheckpointFieldSpec[];
	values: Record<string, CheckpointValue | undefined>;
}

function valueIsPresent(value: CheckpointValue | undefined): value is CheckpointValue {
	if (value === undefined) return false;
	return typeof value !== 'string' || value.trim().length > 0;
}

function inlineValue(value: CheckpointValue): string {
	if (typeof value !== 'string') return String(value);
	return value
		.trim()
		.replace(/\r?\n+/g, ' / ')
		.replace(/\]/g, '&#93;');
}

function bodyField(field: CheckpointFieldSpec, value: CheckpointValue): string[] {
	const text = String(value).trim();
	const lines = text.split(/\r?\n/);
	if (lines.length <= 1) return [`  - **${field.label}：** ${lines[0] ?? ''}`];
	return [
		`  - **${field.label}：**`,
		...lines.map((line) => `    ${line}`),
	];
}

export interface ParsedCheckpointBodyField {
	label: string;
	value: string;
}

export interface ParsedCheckpointEntry {
	blockId?: string;
	values: Record<string, string>;
	body: ParsedCheckpointBodyField[];
}

export interface CheckpointEditState {
	fields: CheckpointFieldSpec[];
	values: Record<string, CheckpointValue | undefined>;
}

const CHECKPOINT_SYSTEM_KEYS = new Set(['checkpoint', 'checkpoint_date', 'checkpoint_time']);

function modalValue(field: CheckpointFieldSpec, value: string): CheckpointValue {
	if (field.control === 'toggle') return value === 'true';
	if (field.control === 'number') {
		const number = Number(value);
		if (Number.isFinite(number)) return number;
	}
	return value;
}

export function checkpointEditState(
	templateFields: CheckpointFieldSpec[],
	entry: ParsedCheckpointEntry,
): CheckpointEditState {
	const fields: CheckpointFieldSpec[] = [];
	const values: Record<string, CheckpointValue | undefined> = {};
	const usedKeys = new Set<string>();
	const usedBodyLabels = new Set<string>();

	for (const field of templateFields) {
		const inlineValue = entry.values[field.key];
		const bodyValue = entry.body.find((item) => item.label === field.label);
		const present = inlineValue !== undefined || bodyValue !== undefined;
		if (!present && field.deprecated) continue;
		const storage = inlineValue !== undefined
			? 'inline'
			: bodyValue ? 'body' : field.storage;
		fields.push({ ...field, storage, required: false, options: [...field.options] });
		if (present) values[field.key] = modalValue(field, inlineValue ?? bodyValue?.value ?? '');
		usedKeys.add(field.key);
		if (bodyValue) usedBodyLabels.add(bodyValue.label);
	}

	for (const [key, value] of Object.entries(entry.values)) {
		if (CHECKPOINT_SYSTEM_KEYS.has(key) || usedKeys.has(key)) continue;
		fields.push({
			key,
			label: key,
			control: 'text',
			storage: 'inline',
			required: false,
			deprecated: true,
			options: [],
		});
		values[key] = value;
		usedKeys.add(key);
	}

	entry.body.forEach((body, index) => {
		if (usedBodyLabels.has(body.label)) return;
		let key = checkpointFieldKey(body.label, `checkpoint_body_${index + 1}`);
		let suffix = 2;
		while (usedKeys.has(key)) {
			key = `${key}_${suffix}`;
			suffix += 1;
		}
		fields.push({
			key,
			label: body.label,
			control: 'textarea',
			storage: 'body',
			required: false,
			deprecated: true,
			options: [],
		});
		values[key] = body.value;
		usedKeys.add(key);
	});

	return { fields, values };
}

export function buildCheckpointEntry(input: CheckpointEntryInput): string {
	const fields = [
		'[checkpoint:: true]',
		`[checkpoint_date:: ${input.date}]`,
		`[checkpoint_time:: ${input.time}]`,
	];
	const body: string[] = [];
	for (const field of input.fields) {
		const value = input.values[field.key];
		if (!valueIsPresent(value)) continue;
		if (field.storage === 'body') body.push(...bodyField(field, value));
		else fields.push(`[${field.key}:: ${inlineValue(value)}]`);
	}
	const blockId = input.blockId.replace(/[^\p{Letter}\p{Number}_-]+/gu, '-');
	const kind = valueIsPresent(input.values.checkpoint_kind)
		? inlineValue(input.values.checkpoint_kind)
		: 'checkpoint';
	const title = `${kind} · ${input.date.slice(5)} ${input.time}`;
	return [
		`> [!thread-checkpoint] ${title}`,
		...[
			`- ${fields.join(' ')} ^${blockId}`,
			...body,
		].map((line) => `> ${line}`),
	].join('\n');
}

function unquote(line: string): string {
	return line.replace(/^(?:> ?)+/, '');
}

function parseInlineFields(line: string): Record<string, string> {
	const result: Record<string, string> = {};
	const pattern = /\[([^\]:]+)::\s*([^\]]*)\]/g;
	for (const match of line.matchAll(pattern)) {
		const key = match[1]?.trim();
		if (!key) continue;
		result[key] = (match[2] ?? '').trim().replace(/&#93;/g, ']');
	}
	return result;
}

export function parseCheckpointEntries(content: string): ParsedCheckpointEntry[] {
	const lines = content.split(/\r?\n/);
	const result: ParsedCheckpointEntry[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = unquote(lines[index] ?? '');
		if (!/^\s*-\s+/.test(line) || !/\[checkpoint::\s*true\]/.test(line)) continue;
		const entry: ParsedCheckpointEntry = {
			blockId: /\^([\p{Letter}\p{Number}_-]+)\s*$/u.exec(line)?.[1],
			values: parseInlineFields(line),
			body: [],
		};
		let currentBody: ParsedCheckpointBodyField | undefined;
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const next = unquote(lines[cursor] ?? '');
			if (/^\s*-\s+.*\[checkpoint::\s*true\]/.test(next)) break;
			if (/^#{1,6}\s+/.test(next) || /^```/.test(next) || /^\s*>?\s*\[!/.test(next)) break;
			const bodyMatch = /^\s*-\s+\*\*(.+?)：\*\*\s*(.*)$/.exec(next);
			if (bodyMatch) {
				currentBody = {
					label: bodyMatch[1]?.trim() ?? '',
					value: bodyMatch[2]?.trim() ?? '',
				};
				entry.body.push(currentBody);
				continue;
			}
			if (currentBody && /^\s{4,}\S/.test(next)) {
				const continuation = next.trim();
				currentBody.value = currentBody.value
					? `${currentBody.value}\n${continuation}`
					: continuation;
				continue;
			}
			if (next.trim()) currentBody = undefined;
		}
		result.push(entry);
	}
	return result;
}

export function checkpointEntriesForDate(
	content: string,
	date: string,
): ParsedCheckpointEntry[] {
	return parseCheckpointEntries(content).filter((entry) =>
		entry.values.checkpoint_date === date);
}

function withTrailingNewline(lines: string[]): string {
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return `${lines.join('\n')}\n`;
}

export function appendCheckpointEntry(content: string, entry: string): string {
	const lines = content.split(/\r?\n/);
	while (lines.length > 0 && !(lines[lines.length - 1] ?? '').trim()) lines.pop();
	if (lines.length > 0) lines.push('');
	lines.push(...entry.split('\n'), '');
	return withTrailingNewline(lines);
}

export function insertCheckpointEntryAtLine(
	content: string,
	entry: string,
	line: number,
): string {
	const lines = content.split(/\r?\n/);
	const index = Math.max(0, Math.min(Math.trunc(line), Math.max(0, lines.length - 1)));
	const entryLines = entry.split('\n');
	if (!(lines[index] ?? '').trim()) {
		lines.splice(index, 1, ...entryLines, '');
	} else {
		let nextContent = index + 1;
		while (nextContent < lines.length && !(lines[nextContent] ?? '').trim()) {
			nextContent += 1;
		}
		lines.splice(index + 1, nextContent - index - 1, '', ...entryLines, '');
	}
	return withTrailingNewline(lines);
}

function escapedPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CheckpointEntryRange {
	start: number;
	end: number;
}

function checkpointEntryRange(lines: string[], blockId: string): CheckpointEntryRange {
	const blockPattern = new RegExp(`\\^${escapedPattern(blockId)}\\s*$`, 'u');
	const marker = lines.findIndex((line) => {
		const unquoted = unquote(line);
		return /\[checkpoint::\s*true\]/.test(unquoted) && blockPattern.test(unquoted);
	});
	if (marker < 0) throw new Error(`Checkpoint 不存在：${blockId}`);
	const calloutStart = marker > 0
		&& /^\s*>\s*\[!thread-checkpoint\]/u.test(lines[marker - 1] ?? '')
		? marker - 1
		: marker;

	let end = marker + 1;
	while (end < lines.length) {
		const source = lines[end] ?? '';
		if (calloutStart < marker) {
			if (/^\s*>\s*\[!/u.test(source) || !/^\s*>/u.test(source)) break;
		} else if (!/^\s{2,}\S/u.test(unquote(source))) break;
		end += 1;
	}
	return { start: calloutStart, end };
}

export function replaceCheckpointEntry(
	content: string,
	blockId: string,
	entry: string,
): string {
	const lines = content.split(/\r?\n/);
	const { start, end } = checkpointEntryRange(lines, blockId);
	lines.splice(start, end - start, ...entry.split('\n'));
	return withTrailingNewline(lines);
}

export function deleteCheckpointEntry(content: string, blockId: string): string {
	const lines = content.split(/\r?\n/);
	const { start, end } = checkpointEntryRange(lines, blockId);
	let deleteStart = start;
	let deleteEnd = end;
	if (!(lines[deleteEnd] ?? '').trim()) deleteEnd += 1;
	else if (deleteStart > 0 && !(lines[deleteStart - 1] ?? '').trim()) deleteStart -= 1;
	lines.splice(deleteStart, deleteEnd - deleteStart);
	return withTrailingNewline(lines);
}
