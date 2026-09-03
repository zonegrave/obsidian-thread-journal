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
	return [
		`- ${fields.join(' ')} ^${blockId}`,
		...body,
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

interface HeadingLocation {
	index: number;
	level: number;
}

function headingLocation(
	lines: string[],
	pattern: RegExp,
	maximumLevel = 6,
): HeadingLocation | undefined {
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? '');
		if (!match || (match[1]?.length ?? 0) > maximumLevel) continue;
		if (pattern.test(match[2] ?? '')) {
			return { index, level: match[1]?.length ?? 1 };
		}
	}
	return undefined;
}

function sectionEnd(lines: string[], heading: HeadingLocation): number {
	for (let index = heading.index + 1; index < lines.length; index += 1) {
		const match = /^(#{1,6})\s+/.exec(lines[index] ?? '');
		if (match && (match[1]?.length ?? 7) <= heading.level) return index;
	}
	return lines.length;
}

function headingBefore(lines: string[], index: number): HeadingLocation | undefined {
	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const match = /^(#{1,6})\s+/.exec(lines[cursor] ?? '');
		if (match) return { index: cursor, level: match[1]?.length ?? 1 };
	}
	return undefined;
}

function withTrailingNewline(lines: string[]): string {
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return `${lines.join('\n')}\n`;
}

export function insertCheckpointEntry(content: string, entry: string): string {
	const lines = content.split(/\r?\n/);
	const existingRenderer = lines.findIndex((line) =>
		line.trim() === '```thread-checkpoints');
	const checkpoints = existingRenderer >= 0
		? headingBefore(lines, existingRenderer)
		: headingLocation(lines, /^checkpoints?$/i);
	if (checkpoints) {
		let end = sectionEnd(lines, checkpoints);
		let renderer = existingRenderer > checkpoints.index && existingRenderer < end
			? existingRenderer
			: -1;
		if (renderer < 0) {
			lines.splice(checkpoints.index + 1, 0, '', '```thread-checkpoints', '```', '');
			renderer = checkpoints.index + 2;
			end = sectionEnd(lines, checkpoints);
		}
		let data = lines.findIndex((line, index) =>
			index > renderer && index < end && line.trim() === '> [!info]- 结构化数据');
		if (data < 0) {
			const close = lines.findIndex((line, index) =>
				index > renderer && index < end && line.trim() === '```');
			data = close >= 0 ? close + 1 : renderer + 1;
			lines.splice(data, 0, '', '> [!info]- 结构化数据');
			data += 1;
		}
		const quoted = entry.split('\n').map((line) => `> ${line}`);
		lines.splice(data + 1, 0, ...quoted, '>');
		return withTrailingNewline(lines);
	}

	const context = headingLocation(lines, /^(?:当前\s*)?context$/i, 5);
	if (context) {
		const insertAt = sectionEnd(lines, context);
		const hashes = '#'.repeat(context.level + 1);
		lines.splice(insertAt, 0,
			`${hashes} Checkpoints`, '',
			'```thread-checkpoints', '```', '',
			'> [!info]- 结构化数据',
			...entry.split('\n').map((line) => `> ${line}`), '>', '');
		return withTrailingNewline(lines);
	}

	while (lines.length > 0 && !(lines[lines.length - 1] ?? '').trim()) lines.pop();
	lines.push('', '## 当前 Context', '', '### Checkpoints', '',
		'```thread-checkpoints', '```', '',
		'> [!info]- 结构化数据',
		...entry.split('\n').map((line) => `> ${line}`), '>', '');
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
	const start = lines.findIndex((line) => {
		const unquoted = unquote(line);
		return /\[checkpoint::\s*true\]/.test(unquoted) && blockPattern.test(unquoted);
	});
	if (start < 0) throw new Error(`Checkpoint 不存在：${blockId}`);

	let end = start + 1;
	while (end < lines.length) {
		const next = unquote(lines[end] ?? '');
		if (!/^\s{2,}\S/.test(next)) break;
		end += 1;
	}
	return { start, end };
}

export function replaceCheckpointEntry(
	content: string,
	blockId: string,
	entry: string,
): string {
	const lines = content.split(/\r?\n/);
	const { start, end } = checkpointEntryRange(lines, blockId);
	const quotePrefix = /^(?:> ?)+/.exec(lines[start] ?? '')?.[0] ?? '';
	const replacement = entry.split('\n').map((line) => `${quotePrefix}${line}`);
	lines.splice(start, end - start, ...replacement);
	return withTrailingNewline(lines);
}

export function deleteCheckpointEntry(content: string, blockId: string): string {
	const lines = content.split(/\r?\n/);
	const { start, end } = checkpointEntryRange(lines, blockId);
	let deleteEnd = end;
	const separator = lines[deleteEnd] ?? '';
	if (/^(?:> ?)+$/.test(separator)) deleteEnd += 1;
	lines.splice(start, deleteEnd - start);
	return withTrailingNewline(lines);
}
