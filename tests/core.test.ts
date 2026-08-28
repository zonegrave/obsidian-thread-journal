import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDailyFormBlock,
	buildThreadFileName,
	buildSectionBlock,
	extractMarkedSection,
	hasDailyFormSnapshot,
	insertBlocksUnderHeading,
	metaBindInput,
	normalizeDailyContribution,
	normalizeRecordsConfig,
	stripWikiLink,
} from '../src/core';

void test('prefixes new thread file names while preserving a safe title', () => {
	assert.equal(buildThreadFileName('睡眠/管理', '260828'), '260828·睡眠-管理');
	assert.equal(buildThreadFileName('...', '260828'), '');
});

void test('normalizes an opt-in daily contribution', () => {
	assert.deepEqual(normalizeDailyContribution({
		form: [
			{ kind: 'field', key: 'sleep_hours', control: 'number', label: '睡眠时长', unit: '小时' },
			{ kind: 'field', key: 'sleep_quality', control: 'slider', min: 1, max: 10, step: 1 },
			{ kind: 'section', id: 'sleep-note', label: '睡眠观察' },
		],
	}), {
		enabled: true,
		form: [
			{
				kind: 'field', key: 'sleep_hours', control: 'number', label: '睡眠时长',
				unit: '小时', min: undefined, max: undefined, step: undefined, options: [],
			},
			{
				kind: 'field', key: 'sleep_quality', control: 'slider', label: undefined,
				unit: undefined, min: 1, max: 10, step: 1, options: [],
			},
			{ kind: 'section', id: 'sleep-note', label: '睡眠观察', storage: 'body' },
		],
		fields: [
			{
				kind: 'field', key: 'sleep_hours', control: 'number', label: '睡眠时长',
				unit: '小时', min: undefined, max: undefined, step: undefined, options: [],
			},
			{
				kind: 'field', key: 'sleep_quality', control: 'slider', label: undefined,
				unit: undefined, min: 1, max: 10, step: 1, options: [],
			},
		],
		sections: [
			{ kind: 'section', id: 'sleep-note', label: '睡眠观察', storage: 'body' },
		],
	});
});

void test('only daily.form participates in diary composition', () => {
	assert.equal(normalizeDailyContribution({ form: [] }).enabled, false);
	assert.equal(normalizeDailyContribution({ fields: ['legacy'] }).enabled, false);
	assert.equal(normalizeDailyContribution({
		enabled: false,
		form: [{ kind: 'field', key: 'x', control: 'text' }],
	}).enabled, false);
});

void test('inserts marked sections under 今日记录 and stays idempotent', () => {
	const block = buildSectionBlock('sleep-thread', {
		kind: 'section', id: 'observation', label: '睡眠观察', storage: 'body',
	});
	const original = '# 2026-08-27\n\n## 今日记录\n\n- 原有内容\n\n## 今日收尾\n';
	const first = insertBlocksUnderHeading(original, '今日记录', [block]);
	assert.equal(first.inserted, 1);
	assert.ok(first.content.indexOf('睡眠观察') < first.content.indexOf('## 今日收尾'));
	const second = insertBlocksUnderHeading(first.content, '今日记录', [block]);
	assert.equal(second.inserted, 0);
	assert.equal(second.content, first.content);
});

void test('creates the target heading when a daily template does not provide it', () => {
	const block = buildSectionBlock('exercise', {
		kind: 'section', id: 'note', label: '运动观察', storage: 'body',
	});
	const result = insertBlocksUnderHeading('# 2026-08-27\n', '今日记录', [block]);
	assert.equal(result.inserted, 1);
	assert.match(result.content, /## 今日记录\n\n<!-- thread-journal/);
});

void test('extracts user text while removing the generated heading', () => {
	const block = buildSectionBlock('sleep-thread', {
		kind: 'section', id: 'observation', label: '睡眠观察', storage: 'body',
	})
		.replace('\n\n<!-- thread-journal', '\n\n今天睡得不错。\n\n<!-- thread-journal');
	assert.equal(extractMarkedSection(block, 'sleep-thread', 'observation'), '今天睡得不错。');
});

void test('generates Meta Bind controls and a stable thread snapshot', () => {
	const form = normalizeDailyContribution({
		form: [
			{ kind: 'field', key: 'sleep_hours', label: '睡眠时长', control: 'number', unit: '小时' },
			{ kind: 'field', key: 'sleep_quality', control: 'slider', min: 1, max: 10, step: 1 },
			{ kind: 'section', id: 'note', label: '睡眠观察' },
		],
	}).form;
	const block = buildDailyFormBlock('sleep-thread', '睡眠管理', form);
	assert.match(block, /INPUT\[number:sleep_hours\]/);
	assert.match(block, /INPUT\[slider\(addLabels, minValue\(1\), maxValue\(10\), stepSize\(1\)\):sleep_quality\]/);
	assert.match(block, /#### 睡眠观察/);
	assert.equal(hasDailyFormSnapshot(block, 'sleep-thread'), true);
	assert.equal(insertBlocksUnderHeading('## 今日记录\n', '今日记录', [block]).inserted, 1);
});

void test('quotes Meta Bind select options', () => {
	assert.equal(metaBindInput({
		kind: 'field',
		key: 'energy',
		control: 'select',
		options: ['低', "今天's 高"],
	}), "INPUT[inlineSelect(option('低'), option('今天\\'s 高')):energy]");
});

void test('normalizes record view config', () => {
	assert.deepEqual(normalizeRecordsConfig({
		scope: 'self',
		days: '7',
		fields: ['energy'],
		sections: ['Sleep note'],
		'show-empty': true,
	}), {
		scope: 'self',
		days: 7,
		fields: ['energy'],
		sections: ['sleep-note'],
		showEmpty: true,
	});
});

void test('resolves the target part of a wikilink', () => {
	assert.equal(stripWikiLink('[[睡眠管理#记录|睡眠]]'), '睡眠管理');
});
