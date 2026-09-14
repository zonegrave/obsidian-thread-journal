import {
	attentionHint,
	filterAttentionTasks,
	summarizeAttention,
	todoDisposition,
} from '../src/thread-attention-model';
import {
	breadcrumbMenuSide,
	breadcrumbRightClearance,
	breadcrumbTooltipPlacement,
	filterBreadcrumbThreads,
} from '../src/thread-breadcrumb-model';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocale, setLocale, translate } from '../src/i18n';
import {
	appendCheckpointEntry,
	buildCheckpointEntry,
	checkpointEditState,
	checkpointEntryAroundLine,
	deleteCheckpointEntry,
	insertCheckpointEntryAtLine,
	parseCheckpointEntries,
	replaceCheckpointEntry,
} from '../src/checkpoint-core';
import {
	activeCheckpointFields,
	checkpointFieldRenderMode,
	checkpointFieldsForThread,
	DEFAULT_CHECKPOINT_FIELDS,
	normalizeCheckpointFields,
} from '../src/checkpoint-model';
import {
	buildThreadFileName,
	stripWikiLink,
	wikiLinkAlias,
} from '../src/core';
import {
	DEFAULT_THREAD_ROLE_TEMPLATE,
	renderThreadFileTemplate,
} from '../src/thread-template';
import { ThreadIndex } from '../src/thread-index';
import {
	buildInlineLogEdit,
	inlineLogEntryAroundLine,
	parseInlineLogEntries,
} from '../src/inline-log';
import {
	compareThreadEntryTimestamps,
	formatThreadEntryTimestamp,
	parseThreadEntriesQuery,
} from '../src/entry-query';
import {
	buildCheckpointModalForm,
	buildCheckpointTemplateFieldModalForm,
	checkpointFieldFromModalData,
	checkpointTemplateFieldValues,
} from '../src/modal-form';
import {
	THREAD_STATUS_CHOICES,
	isOperationalThreadStatus,
	threadStatusUsesMembers,
	threadStatusLabel,
	threadStatusOptionLabel,
} from '../src/thread-status-model';
import {
	availableThreadParentIds,
	wouldCreateThreadParentCycle,
} from '../src/thread-parent-model';
import { replaceThreadDisplayAlias } from '../src/thread-meta-model';
import {
	buildThreadOverviewTree,
	countThreadOverviewDescendants,
	DEFAULT_THREAD_OVERVIEW_STATUSES,
} from '../src/thread-overview-model';
import {
	describeOpenThreadRoles,
	groupOpenThreadViews,
	nextActiveThreadRolePath,
	openThreadViewsForFile,
	orderOpenThreadGroups,
} from '../src/thread-switcher-model';

void test('resolves automatic language and translates interpolated UI text', () => {
	assert.equal(resolveLocale('auto', 'zh-CN'), 'zh');
	assert.equal(resolveLocale('auto', 'en-US'), 'en');
	assert.equal(resolveLocale('zh', 'en-US'), 'zh');
	assert.equal(translate('en', 'Created {title}', { title: 'Project' }), 'Created Project');
	assert.equal(translate('zh', 'Created {title}', { title: '项目' }), '已创建 项目');
});

void test('builds safe thread member file names', () => {
	assert.equal(buildThreadFileName('睡眠/管理'), '睡眠-管理');
	assert.equal(
		buildThreadFileName('睡眠/管理', '3e9b3f36-7f7d-4205-97b0-82c533155eb0'),
		'睡眠-管理·3e9b3f36',
	);
	assert.equal(buildThreadFileName('...'), '');
});

void test('builds a queryable inline log callout at the cursor line', () => {
	assert.deepEqual(
		buildInlineLogEdit(
			'  ',
			'09-04 14:35',
			'2026-09-04T14:35:27',
			'log-20260904-143527-a1b2c',
		),
		{
			replacement: [
				'  > [!thread-log] 09-04 14:35',
				'  > - (thread_log:: 2026-09-04T14:35:27)  ^log-20260904-143527-a1b2c',
			].join('\n'),
			fromCh: 0,
			toCh: 2,
			cursorLineOffset: 1,
			cursorCh: 41,
		},
	);
	assert.deepEqual(
		buildInlineLogEdit(
			'已有内容',
			'09-04 14:35',
			'2026-09-04T14:35:27',
			'log-20260904-143527-a1b2c',
		),
		{
			replacement: [
				'',
				'',
				'> [!thread-log] 09-04 14:35',
				'> - (thread_log:: 2026-09-04T14:35:27)  ^log-20260904-143527-a1b2c',
			].join('\n'),
			fromCh: 4,
			toCh: 4,
			cursorLineOffset: 3,
			cursorCh: 39,
		},
	);
});

void test('parses current inline logs for a daily summary', () => {
	const content = [
		'> [!thread-log] 09-04 14:35',
		'> - (thread_log:: 2026-09-04T14:35:27) 完成了 [[接口验证]] ^log-20260904-143527-a1b2c',
		'> [!thread-log] 09-03 23:10',
		'> - (thread_log:: 2026-09-03T23:10:00) 昨天的记录 ^log-20260903-231000-d4e5f',
		'> [!thread-log] 没有块 ID 的非当前格式',
		'> - (thread_log:: 2026-09-04T07:41:06) 不应进入结果',
		'普通文本 (thread_log:: 2026-09-04T12:00:00)',
	].join('\n');

	assert.deepEqual(parseInlineLogEntries(content), [
		{
			timestamp: '2026-09-04T14:35:27',
			date: '2026-09-04',
			time: '14:35',
			text: '完成了 [[接口验证]]',
			blockId: 'log-20260904-143527-a1b2c',
		},
		{
			timestamp: '2026-09-03T23:10:00',
			date: '2026-09-03',
			time: '23:10',
			text: '昨天的记录',
			blockId: 'log-20260903-231000-d4e5f',
		},
	]);
});

void test('finds the inline log around a Live Preview source line', () => {
	const content = [
		'# 工作区',
		'',
		'> [!thread-log] 09-04 14:35',
		'> - (thread_log:: 2026-09-04T14:35:27) 完成了 [[接口验证]] ^log-20260904-143527-a1b2c',
		'',
		'后续内容',
	].join('\n');

	assert.deepEqual(inlineLogEntryAroundLine(content, 2), {
		timestamp: '2026-09-04T14:35:27',
		date: '2026-09-04',
		time: '14:35',
		text: '完成了 [[接口验证]]',
		blockId: 'log-20260904-143527-a1b2c',
	});
	assert.equal(inlineLogEntryAroundLine(content, 5), undefined);
});

void test('parses the unified thread entries query', () => {
	assert.deepEqual(parseThreadEntriesQuery([
		'thread_id: 20e15ed8-5de0-44bc-919f-54d49294c14c',
		'date: 2026-09-01..2026-09-04',
		'type: [checkpoint, log]',
		'group_by: thread',
		'thread_detail: crumb',
		'order: asc',
	].join('\n')), {
		query: {
			threadIds: ['20e15ed8-5de0-44bc-919f-54d49294c14c'],
			date: { from: '2026-09-01', to: '2026-09-04' },
			types: ['checkpoint', 'log'],
			groupBy: 'thread',
			threadDetail: 'crumb',
			order: 'asc',
		},
		errors: [],
	});
	assert.deepEqual(parseThreadEntriesQuery(''), {
		query: {
			threadIds: undefined,
			date: undefined,
			types: ['checkpoint', 'log'],
			groupBy: 'none',
			threadDetail: 'none',
			order: 'desc',
		},
		errors: [],
	});
	assert.deepEqual(parseThreadEntriesQuery('date: 2026-09-04').query.date, {
		from: '2026-09-04',
		to: '2026-09-04',
	});
	assert.equal(parseThreadEntriesQuery('date: 2026-09-04').query.order, 'desc');
});

void test('reports invalid thread entries query values', () => {
	const result = parseThreadEntriesQuery([
		'date: 2026-09-05..2026-09-01',
		'type: checkpoint, thought',
		'group_by: day',
		'thread_detail: full',
		'order: newest',
		'unknown: value',
	].join('\n'));
	assert.equal(result.errors.length, 6);
	assert.match(result.errors.join('\n'), /date/);
	assert.match(result.errors.join('\n'), /thought/);
	assert.match(result.errors.join('\n'), /group_by/);
	assert.match(result.errors.join('\n'), /thread_detail/);
	assert.match(result.errors.join('\n'), /order/);
	assert.match(result.errors.join('\n'), /unknown/);
});

void test('formats checkpoint and log timestamps consistently', () => {
	assert.equal(formatThreadEntryTimestamp('2026-09-05', '07:20'), '26/09/05 07:20');
	assert.equal(formatThreadEntryTimestamp('2026-09-05', '07:20', true), '07:20');
	assert.equal(formatThreadEntryTimestamp('2026-09-05', '', true), '26/09/05');
	assert.equal(formatThreadEntryTimestamp('未填写日期', ''), '未填写日期');
});

void test('sorts thread entry timestamps only by the explicit order', () => {
	const earlier = '2026-09-04T09:00:00';
	const later = '2026-09-04T10:00:00';
	assert.ok(compareThreadEntryTimestamps(earlier, later, 'asc') < 0);
	assert.ok(compareThreadEntryTimestamps(earlier, later, 'desc') > 0);
});

void test('groups arbitrary member files under meta and resolves its unique entry', () => {
	const threadFile = { path: '50-行动系统/Thread Meta/thread-1.md', basename: 'thread-1' };
	const entry = { path: '50-行动系统/Thread Files/睡眠管理.md', basename: '睡眠管理' };
	const research = { path: '50-行动系统/Thread Files/睡眠研究.md', basename: '睡眠研究' };
	const other = { path: '50-行动系统/Thread Files/其它.md', basename: '其它' };
	const frontmatter = new Map<unknown, Record<string, unknown>>([
		[threadFile, {
			type: 'thread', thread_id: 'thread-1', aliases: ['已改名 thread'],
			entry: '[[睡眠管理|入口]]',
		}],
		[entry, { thread_id: 'thread-1' }],
		[research, {
			type: 'source',
			thread_id: 'thread-1',
			thread_role: 'research',
			thread_role_status: 'terminated',
		}],
		[other, { thread_id: 'another-thread', thread_role: 'workspace' }],
	]);
	const app = {
		vault: {
			getMarkdownFiles: () => [threadFile, entry, research, other],
		},
		metadataCache: {
			getFileCache: (file: unknown) => ({ frontmatter: frontmatter.get(file) }),
			getFirstLinkpathDest: (link: string) => {
				if (link === '睡眠管理') return entry;
				if (link === '睡眠研究') return research;
				return null;
			},
		},
	};
	const index = new ThreadIndex(app as never);
	assert.equal(index.getEntry(threadFile as never), entry);
	assert.equal(index.getThreadForMember(research as never), threadFile);
	assert.equal(index.getMember(entry as never)?.role, 'workspace');
	assert.equal(index.getMember(entry as never)?.roleStatus, 'active');
	assert.equal(index.getMember(research as never)?.role, 'research');
	assert.equal(index.getMember(research as never)?.roleStatus, 'terminated');
	assert.deepEqual(index.getMembersByThreadId('thread-1').map((item) => item.file), [research, entry]);
	assert.equal(index.isEntry(entry as never), true);
	assert.equal(index.isEntry(research as never), false);
	assert.equal(index.getThread(threadFile as never)?.title, '已改名 thread');
	const threadMetadata = frontmatter.get(threadFile);
	if (threadMetadata) threadMetadata.entry = '[[睡眠研究]]';
	assert.equal(index.getEntry(threadFile as never), undefined);
});

void test('uses aliases then the filename as the thread display name', () => {
	const aliased = { path: '50-行动系统/同名项目·abc12345.md', basename: '同名项目·abc12345' };
	const plain = { path: '50-行动系统/普通项目.md', basename: '普通项目' };
	const frontmatter = new Map<unknown, Record<string, unknown>>([
		[aliased, {
			type: 'thread', thread_id: 'thread-a', aliases: ['同名项目'], title: '旧标题',
		}],
		[plain, { type: 'thread', thread_id: 'thread-b', title: '不再读取的旧标题' }],
	]);
	const app = {
		vault: { getMarkdownFiles: () => [aliased, plain] },
		metadataCache: {
			getFileCache: (file: unknown) => ({ frontmatter: frontmatter.get(file) }),
		},
	};
	const index = new ThreadIndex(app as never);
	assert.equal(index.getThread(aliased as never)?.title, '同名项目');
	assert.equal(index.getDisplayName(aliased as never), '同名项目');
	assert.equal(index.getThread(plain as never)?.title, '普通项目');
	assert.equal(index.getDisplayName(plain as never), '普通项目');
});

void test('updates only the primary thread display alias', () => {
	assert.deepEqual(
		replaceThreadDisplayAlias(['旧标题', '次要别名', '新标题'], ' 新标题 '),
		['新标题', '次要别名'],
	);
	assert.deepEqual(replaceThreadDisplayAlias('旧标题', '新标题'), ['新标题']);
	assert.deepEqual(replaceThreadDisplayAlias(undefined, '新标题'), ['新标题']);
});

void test('uses a minimal default role template', () => {
	assert.equal(
		DEFAULT_THREAD_ROLE_TEMPLATE,
		'---\nthread_role: workspace\nthread_role_status: active\n---\n',
	);
});

void test('renders thread member template placeholders', () => {
	const rendered = renderThreadFileTemplate([
		'# {{title}}',
		'{{status}} · {{filename}} · {{thread_id}} · {{thread_role}} · {{thread_role_status}}',
		'{{parent_title}} {{parent}}',
		'{{date}} / {{date:YYMMDD}}',
	].join('\n'), {
		title: '睡眠管理',
		fileName: '睡眠管理',
		threadId: 'stable-id',
		role: 'research',
		roleStatus: 'active',
		status: 'idea',
		parentTitle: '健康管理',
		parentLink: '[[健康管理|健康管理]]',
		created: '2026-08-31',
	}, (format: string) => format === 'YYMMDD' ? '260831' : '2026-08-31');
	assert.match(rendered, /^# 睡眠管理/m);
	assert.match(rendered, /idea · 睡眠管理 · stable-id · research · active/);
	assert.match(rendered, /2026-08-31 \/ 260831/);
});

void test('normalizes configurable checkpoint fields and protects system keys', () => {
	assert.deepEqual(
		DEFAULT_CHECKPOINT_FIELDS.map((field) => field.key),
		['checkpoint_kind', 'checkpoint_summary'],
	);
	assert.deepEqual(normalizeCheckpointFields([
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline', required: true,
		},
		{
			key: 'checkpoint_time', label: '备注', control: 'textarea', storage: 'body', required: false,
		},
	]), [
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline',
			required: true, deprecated: false, options: [],
		},
		{
			key: 'checkpoint_field_2', label: '备注', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		},
	]);
});

void test('uses a per-thread checkpoint template before the global default', () => {
	const defaults = normalizeCheckpointFields(undefined);
	assert.deepEqual(
		checkpointFieldsForThread(undefined, defaults).map((field) => field.key),
		['checkpoint_kind', 'checkpoint_summary'],
	);
	assert.deepEqual(checkpointFieldsForThread([], defaults), []);
	assert.deepEqual(
		checkpointFieldsForThread([{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body', required: false,
		}], defaults),
		[{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		}],
	);
});

void test('moves deprecated fields last and excludes them from new checkpoint input', () => {
	const fields = normalizeCheckpointFields([
		{
			key: 'old_metric', label: '旧指标', control: 'number', storage: 'inline',
			required: true, deprecated: true,
		},
		{
			key: 'current_metric', label: '当前指标', control: 'number', storage: 'inline',
			required: false,
		},
	]);
	assert.deepEqual(fields.map((field) => field.key), ['current_metric', 'old_metric']);
	assert.equal(fields[1]?.deprecated, true);
	assert.equal(fields[1]?.required, false);
	assert.deepEqual(
		activeCheckpointFields(fields).map((field) => field.key),
		['current_metric'],
	);
});

void test('maps checkpoint fields to a Modal Form inline definition', () => {
	const definition = buildCheckpointModalForm('创建 checkpoint', normalizeCheckpointFields([
		{
			key: 'checkpoint_kind', label: '类型', control: 'select', storage: 'inline',
			required: true, options: ['milestone', 'review'],
		},
		{
			key: 'notes', label: '说明', control: 'textarea', storage: 'body', required: false,
		},
	]), { checkpoint_kind: 'custom-review' });
	assert.equal(definition.customClassname, 'thread-journal-modal-form');
	assert.deepEqual(definition.fields.map((field) => field.input.type), [
		'date', 'time', 'select', 'textarea',
	]);
	assert.deepEqual(definition.fields[2]?.input, {
		type: 'select',
		source: 'fixed',
		options: [
			{ value: 'milestone', label: 'milestone' },
			{ value: 'review', label: 'review' },
			{ value: 'custom-review', label: 'custom-review' },
		],
	});
});

void test('builds a Modal Form checkpoint template field editor', () => {
	const definition = buildCheckpointTemplateFieldModalForm('编辑 checkpoint 字段');
	assert.equal(definition.title, '编辑 checkpoint 字段');
	assert.deepEqual(
		definition.fields.map((field) => [field.name, field.input.type]),
		[
			['label', 'text'],
			['key', 'text'],
			['control', 'select'],
			['storage', 'select'],
			['required', 'toggle'],
			['options', 'textarea'],
		],
	);
	assert.deepEqual(checkpointTemplateFieldValues({
		key: 'checkpoint_kind',
		label: '类型',
		control: 'select',
		storage: 'inline',
		required: true,
		deprecated: false,
		options: ['milestone', 'review'],
	}), {
		key: 'checkpoint_kind',
		label: '类型',
		control: 'select',
		storage: 'inline',
		required: true,
		options: 'milestone\nreview',
	});
	assert.deepEqual(checkpointFieldFromModalData({
		label: '新的类型',
		key: 'new kind',
		control: 'select',
		storage: 'inline',
		required: true,
		deprecated: true,
		options: 'milestone\nreview, archived',
	}, DEFAULT_CHECKPOINT_FIELDS[0]!), {
		key: 'new_kind',
		label: '新的类型',
		control: 'select',
		storage: 'inline',
		required: false,
		deprecated: true,
		options: ['milestone', 'review', 'archived'],
	});
	assert.equal(checkpointFieldFromModalData({
		label: '旧字段',
		key: 'old_field',
		control: 'text',
		storage: 'inline',
		required: true,
	}, {
		...DEFAULT_CHECKPOINT_FIELDS[0]!,
		deprecated: true,
	}).deprecated, true);
});

void test('builds a Dataview-queryable checkpoint with a free-form body', () => {
	const fields = normalizeCheckpointFields([
		{
			key: 'checkpoint_kind', label: '类型', control: 'select', storage: 'inline',
			required: true, options: ['milestone', 'review'],
		},
		{
			key: 'checkpoint_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
		{
			key: 'checkpoint_result', label: '阶段成果', control: 'textarea', storage: 'body',
			required: false,
		},
	]);
	assert.equal(buildCheckpointEntry({
		date: '2026-08-31',
		time: '14:35',
		blockId: 'cp-20260831-01',
		fields,
		values: {
			checkpoint_kind: 'milestone',
			checkpoint_summary: '完成表单设计',
			checkpoint_result: '可以自由配置字段。\n长文字保留在正文。',
		},
	}), [
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_time:: 14:35] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成表单设计] ^cp-20260831-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
});

void test('parses checkpoint data from a thread member callout', () => {
	const parsed = parseCheckpointEntries([
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_time:: 14:35] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成表单设计] ^cp-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
	assert.deepEqual(parsed, [{
		blockId: 'cp-01',
		values: {
			checkpoint: 'true',
			checkpoint_date: '2026-08-31',
			checkpoint_time: '14:35',
			checkpoint_kind: 'milestone',
			checkpoint_summary: '完成表单设计',
		},
		body: [{
			label: '阶段成果',
			value: '可以自由配置字段。\n长文字保留在正文。',
		}],
	}]);
});

void test('finds the checkpoint around a Live Preview source line', () => {
	const content = [
		'# Thread 工作区',
		'',
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_summary:: 完成] ^cp-live',
		'>   - **阶段成果：** 可见',
		'',
		'后续内容',
	].join('\n');
	assert.equal(checkpointEntryAroundLine(content, 2)?.blockId, 'cp-live');
	assert.equal(checkpointEntryAroundLine(content, 4)?.values.checkpoint_summary, '完成');
	assert.equal(checkpointEntryAroundLine(content, 6), undefined);
});

void test('appends checkpoint callouts to a thread member', () => {
	const entry = [
		'> [!thread-checkpoint] milestone · 08-31 14:35',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] ^cp-new',
	].join('\n');
	const original = [
		'# Thread 工作区',
		'',
		'自由记录',
		'',
	].join('\n');
	const result = appendCheckpointEntry(original, entry);
	assert.match(result, /自由记录\n\n> \[!thread-checkpoint\].*\n> - \[checkpoint:: true\]/);
	assert.ok(result.indexOf('自由记录') < result.indexOf('^cp-new'));
});

void test('inserts checkpoint callouts at a thread member cursor line', () => {
	const original = [
		'# Thread 工作区',
		'',
		'第一段',
		'',
		'第二段',
	].join('\n');
	const result = insertCheckpointEntryAtLine(
		original,
		[
			'> [!thread-checkpoint] review · 09-01 10:30',
			'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] ^cp-custom',
		].join('\n'),
		2,
	);
	assert.match(result, /第一段\n\n> \[!thread-checkpoint\][\s\S]*\^cp-custom\n\n第二段/);
});

void test('replaces one checkpoint in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-checkpoint] milestone · 09-01 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] [checkpoint_summary:: 旧摘要] ^cp-edit',
		'>   - **详情：** 旧内容',
		'',
		'> [!thread-checkpoint] milestone · 08-31 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_summary:: 保留] ^cp-keep',
	].join('\n');
	const replacement = [
		'> [!thread-checkpoint] review · 09-02 10:30',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-02] [checkpoint_time:: 10:30] [checkpoint_summary:: 新摘要] ^cp-edit',
		'>   - **详情：** 新内容',
	].join('\n');
	const result = replaceCheckpointEntry(original, 'cp-edit', replacement);
	assert.match(result, /> \[!thread-checkpoint\] review · 09-02 10:30/);
	assert.match(result, /> - \[checkpoint:: true\].*新摘要.*\^cp-edit/);
	assert.match(result, /> {3}- \*\*详情：\*\* 新内容/);
	assert.doesNotMatch(result, /旧摘要|旧内容/);
	assert.match(result, /保留.*\^cp-keep/);
	assert.equal(parseCheckpointEntries(result).length, 2);
});

void test('adds active template fields when editing an older checkpoint', () => {
	const fields = normalizeCheckpointFields([
		{
			key: 'checkpoint_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
		{
			key: 'new_note', label: '新增说明', control: 'textarea', storage: 'body',
			required: false,
		},
		{
			key: 'retired', label: '旧字段', control: 'text', storage: 'inline',
			deprecated: true,
		},
	]);
	const edit = checkpointEditState(fields, {
		blockId: 'cp-old',
		values: {
			checkpoint: 'true',
			checkpoint_date: '2026-09-01',
			checkpoint_summary: '旧记录',
			legacy_only: '保留',
		},
		body: [],
	});
	assert.deepEqual(edit.fields.map((field) => field.key), [
		'checkpoint_summary', 'new_note', 'legacy_only',
	]);
	assert.equal(edit.values.new_note, undefined);
	assert.equal(edit.fields.find((field) => field.key === 'new_note')?.required, false);
	assert.equal(edit.fields.find((field) => field.key === 'legacy_only')?.deprecated, true);
});

void test('chooses markdown rendering by checkpoint field shape', () => {
	assert.equal(checkpointFieldRenderMode({ control: 'text', storage: 'inline' }), 'inline-markdown');
	assert.equal(checkpointFieldRenderMode({ control: 'textarea', storage: 'body' }), 'block-markdown');
	assert.equal(checkpointFieldRenderMode({ control: 'textarea', storage: 'inline' }), 'block-markdown');
	assert.equal(checkpointFieldRenderMode({ control: 'text', storage: 'body' }), 'block-markdown');
	assert.equal(checkpointFieldRenderMode({ control: 'select', storage: 'inline' }), 'plain');
	assert.equal(checkpointFieldRenderMode({ control: 'number', storage: 'inline' }), 'plain');
	assert.equal(checkpointFieldRenderMode({ control: 'toggle', storage: 'inline' }), 'plain');
	assert.equal(checkpointFieldRenderMode({ control: 'date', storage: 'inline' }), 'plain');
});

void test('deletes one checkpoint in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-checkpoint] review · 09-02 10:30',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-02] [checkpoint_summary:: 删除] ^cp-delete',
		'>   - **详情：** 一并删除',
		'',
		'> [!thread-checkpoint] milestone · 09-01 09:00',
		'> - [checkpoint:: true] [checkpoint_date:: 2026-09-01] [checkpoint_summary:: 保留] ^cp-keep',
	].join('\n');
	const result = deleteCheckpointEntry(original, 'cp-delete');
	assert.doesNotMatch(result, /删除|一并删除|cp-delete/);
	assert.match(result, /保留.*\^cp-keep/);
	assert.equal(parseCheckpointEntries(result).length, 1);
});

void test('supports only the eight current status values', () => {
	assert.deepEqual(
		THREAD_STATUS_CHOICES.map((choice) => choice.value),
		['idea', 'committed', 'active', 'dormant', 'paused', 'review', 'completed', 'closed'],
	);
	assert.equal(threadStatusLabel('active'), '持续关注');
	const dormant = THREAD_STATUS_CHOICES.find((choice) => choice.value === 'dormant');
	assert.ok(dormant);
	assert.equal(threadStatusOptionLabel(dormant), 'dormant — 休眠');
	assert.equal(isOperationalThreadStatus('active'), true);
	assert.equal(isOperationalThreadStatus('dormant'), true);
	assert.equal(isOperationalThreadStatus('committed'), false);
	assert.equal(isOperationalThreadStatus('paused'), false);
	assert.equal(threadStatusUsesMembers('idea'), false);
	assert.equal(threadStatusUsesMembers('committed'), false);
	assert.equal(threadStatusUsesMembers('active'), true);
});

void test('allows only operational non-descendants as a new thread parent', () => {
	const nodes = [
		{ id: 'root', status: 'active' },
		{ id: 'current', status: 'active', parent: 'root' },
		{ id: 'child', status: 'dormant', parent: 'current' },
		{ id: 'other', status: 'dormant' },
		{ id: 'paused', status: 'paused' },
	];
	assert.equal(wouldCreateThreadParentCycle(nodes, 'current', 'current'), true);
	assert.equal(wouldCreateThreadParentCycle(nodes, 'current', 'child'), true);
	assert.equal(wouldCreateThreadParentCycle(nodes, 'current', 'root'), false);
	assert.deepEqual(availableThreadParentIds(nodes, 'current'), ['root', 'other']);
});

void test('builds a filtered thread tree while retaining structural ancestors', () => {
	const tree = buildThreadOverviewTree([
		{ id: 'paused-root', title: 'Paused root', status: 'paused' },
		{ id: 'active-child', title: 'Active child', status: 'active', parent: 'paused-root' },
		{ id: 'review-child', title: 'Review child', status: 'review', parent: 'active-child' },
		{ id: 'dormant-root', title: 'Dormant root', status: 'dormant' },
		{ id: 'closed-root', title: 'Closed root', status: 'closed' },
	], new Set(DEFAULT_THREAD_OVERVIEW_STATUSES));

	assert.deepEqual(tree.map((node) => ({
		id: node.item.id,
		contextOnly: node.contextOnly,
		children: node.children.map((child) => child.item.id),
	})), [
		{ id: 'dormant-root', contextOnly: false, children: [] },
		{ id: 'paused-root', contextOnly: true, children: ['active-child'] },
	]);
	assert.equal(tree[1]?.children[0]?.contextOnly, false);
	assert.equal(tree[1] ? countThreadOverviewDescendants(tree[1]) : -1, 1);
	assert.deepEqual(DEFAULT_THREAD_OVERVIEW_STATUSES, ['active', 'dormant']);
});

void test('returns no overview nodes when no status is selected', () => {
	assert.deepEqual(buildThreadOverviewTree([
		{ id: 'active', title: 'Active', status: 'active' },
	], new Set()), []);
});

void test('groups and orders open thread views without duplicating logical threads', () => {
	const views = [
		{ threadId: 'thread-a', role: 'workspace', roleStatus: 'active' as const, filePath: 'a.md', target: 'a-entry', order: 0 },
		{ threadId: 'thread-b', role: 'meta', filePath: 'b-meta.md', target: 'b-meta', order: 1 },
		{ threadId: 'thread-a', role: 'research', roleStatus: 'terminated' as const, filePath: 'a-research.md', target: 'a-research', order: 2 },
		{ threadId: 'thread-c', role: 'workspace', roleStatus: 'active' as const, filePath: 'c.md', target: 'c-entry', order: 3 },
		{ threadId: 'thread-a', role: 'workspace', roleStatus: 'active' as const, filePath: 'a.md', target: 'a-entry-copy', order: 4 },
	];
	const groups = groupOpenThreadViews(views);
	assert.equal(groups.length, 3);
	assert.deepEqual(groups.find((group) => group.threadId === 'thread-a')?.views, [
		views[0], views[2], views[4],
	]);
	assert.deepEqual(
		orderOpenThreadGroups(groups, ['thread-c', 'thread-a']).map((group) => group.threadId),
		['thread-c', 'thread-a', 'thread-b'],
	);
	const threadA = groups.find((group) => group.threadId === 'thread-a');
	assert.ok(threadA);
	assert.deepEqual(
		openThreadViewsForFile(threadA, 'a.md').map((view) => view.target),
		['a-entry', 'a-entry-copy'],
	);
	assert.deepEqual(
		openThreadViewsForFile(threadA, 'a-research.md').map((view) => view.target),
		['a-research'],
	);
	assert.equal(
		describeOpenThreadRoles(threadA),
		'workspace · active ×2 + research · terminated',
	);
});

void test('cycles only through active thread roles and enters the first active role from outside', () => {
	const roles = [
		{ path: 'entry.md', status: 'active' as const },
		{ path: 'old-research.md', status: 'terminated' as const },
		{ path: 'context.md', status: 'active' as const },
	];
	assert.equal(nextActiveThreadRolePath(roles, 'entry.md'), 'context.md');
	assert.equal(nextActiveThreadRolePath(roles, 'context.md'), 'entry.md');
	assert.equal(nextActiveThreadRolePath(roles, 'old-research.md'), 'entry.md');
	assert.equal(
		nextActiveThreadRolePath([{ path: 'old.md', status: 'terminated' }], 'old.md'),
		undefined,
	);
});

void test('resolves current wikilinks and aliases', () => {
	assert.equal(stripWikiLink('[[睡眠管理#Context|睡眠管理]]'), '睡眠管理');
	assert.equal(wikiLinkAlias('[[睡眠管理|睡眠管理]]'), '睡眠管理');
	assert.equal(wikiLinkAlias('[[睡眠管理]]'), undefined);
});

void test('task readiness separates future, waiting, candidates, completion and deadlines', () => {
 assert.equal(todoDisposition(' ', '2026-10-01 预约', '2026-09-09'), 'future');
 assert.equal(todoDisposition(' ', '预约 📅 2026-10-01', '2026-09-09'), 'ready');
 assert.equal(todoDisposition(' ', '预约 ⏳ 2026-10-01', '2026-09-09'), 'future');
 assert.equal(todoDisposition(' ', '预约 🛫 2026-09-09', '2026-09-09'), 'ready');
 assert.equal(todoDisposition('>', '等回复', '2026-09-09'), 'waiting');
 assert.equal(todoDisposition('?', '考虑一下', '2026-09-09'), 'candidate');
 assert.equal(todoDisposition('x', '完成', '2026-09-09'), undefined);
 assert.equal(todoDisposition('-', '取消', '2026-09-09'), undefined);
 assert.equal(todoDisposition(' ', '', '2026-09-09'), undefined);
 assert.equal(todoDisposition('!', '自定义', '2026-09-09'), 'unknown');
});

void test('filters overview tasks to today active or all unfinished tasks', () => {
	const tasks = [
		{ id: 'ready', disposition: 'ready' as const },
		{ id: 'future', disposition: 'future' as const },
		{ id: 'waiting', disposition: 'waiting' as const },
		{ id: 'candidate', disposition: 'candidate' as const },
		{ id: 'unknown', disposition: 'unknown' as const },
	];
	assert.deepEqual(filterAttentionTasks(tasks, 'today').map((task) => task.id), ['ready']);
	assert.deepEqual(filterAttentionTasks(tasks, 'all').map((task) => task.id), [
		'ready',
		'future',
		'waiting',
		'candidate',
		'unknown',
	]);
});

void test('subtree attention includes descendants but suspends frozen branches and deduplicates shared tasks', () => {
 const nodes = [
  { id: 'root', status: 'active' },
  { id: 'sleep', parent: 'root', status: 'dormant' },
  { id: 'frozen', parent: 'root', status: 'paused' },
  { id: 'child', parent: 'frozen', status: 'active' },
 ];
 const tasks = [
  { key: 'one', owner: 'sleep', disposition: 'ready' as const },
  { key: 'one', owner: 'root', disposition: 'ready' as const },
  { key: 'two', owner: 'child', disposition: 'ready' as const },
 ];
 const result = summarizeAttention('root', nodes, tasks);
 assert.equal(result.open, 2); assert.equal(result.ready, 1); assert.equal(result.suspended, 1);
 assert.equal(summarizeAttention('child', nodes, tasks).ready, 0);
 assert.match(attentionHint('dormant', summarizeAttention('sleep', nodes, tasks)), /需要处理/);
 assert.match(attentionHint('active', summarizeAttention('root', nodes, [])), /考虑休眠/);
});

void test('cycles terminate with visible warning and future tasks are not an empty subtree', () => {
 const nodes = [{ id: 'a', parent: 'b', status: 'active' }, { id: 'b', parent: 'a', status: 'active' }];
 assert.equal(summarizeAttention('a', nodes, []).cycle, true);
 const summary = summarizeAttention('a', [{ id: 'a', status: 'active' }], [{ key: 'a:1', owner: 'a', disposition: 'future' }]);
 assert.equal(summary.open, 1); assert.equal(summary.ready, 0);
 assert.doesNotMatch(attentionHint('active', summary), /考虑休眠/);
});

void test('breadcrumb switcher exposes only operational threads without changing hierarchy', () => {
	const threads = [
		{ title: '睡眠', status: 'dormant' },
		{ title: '插件', status: 'active' },
		{ title: '旅行', status: 'idea' },
	] as never[];
	assert.deepEqual(
		filterBreadcrumbThreads(threads).map((thread) => thread.title),
		['插件', '睡眠'],
	);
});

void test('breadcrumb child menus open toward available space', () => {
	assert.equal(breadcrumbMenuSide(40, 64, 800, 300, false), 'below');
	assert.equal(breadcrumbMenuSide(730, 754, 800, 300, false), 'above');
	assert.equal(breadcrumbMenuSide(730, 754, 800, 100, true), 'above');
});

void test('bottom breadcrumbs reserve space only for overlapping status bars', () => {
	const bar = { left: 0, right: 1440, top: 870, bottom: 900 };
	assert.equal(
		breadcrumbRightClearance(bar, { left: 1227, right: 1440, top: 873, bottom: 900 }),
		221,
	);
	assert.equal(
		breadcrumbRightClearance({ ...bar, right: 700 }, { left: 1227, right: 1440, top: 873, bottom: 900 }),
		0,
	);
	assert.equal(
		breadcrumbRightClearance(bar, { left: 1227, right: 1440, top: 900, bottom: 927 }),
		0,
	);
});

void test('localizes model-provided labels without changing stored values', () => {
	setLocale('en');
	try {
		assert.equal(threadStatusLabel('active'), 'Active');
		const dormant = THREAD_STATUS_CHOICES.find((choice) => choice.value === 'dormant');
		assert.ok(dormant);
		assert.equal(threadStatusOptionLabel(dormant), 'dormant — Dormant');
		assert.deepEqual(
			normalizeCheckpointFields(undefined).map((field) => field.label),
			['Type', 'Summary'],
		);
		assert.match(parseThreadEntriesQuery('invalid').errors[0] ?? '', /^Line 1/);
	} finally {
		setLocale('zh');
	}
});

void test('breadcrumb tooltips face the document area', () => {
	assert.equal(breadcrumbTooltipPlacement('top'), 'bottom');
	assert.equal(breadcrumbTooltipPlacement('bottom'), 'top');
});
