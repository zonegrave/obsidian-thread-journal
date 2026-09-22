import {
	attentionHint,
	filterAttentionTasks,
	selectAttentionFallbackPaths,
	summarizeAttention,
	taskIsPinned,
	taskLineWithPin,
	taskTextWithoutPin,
	todoDisposition,
	threadUsesAttentionFallback,
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
	appendCommitEntry,
	buildCommitEntry,
	commitEditState,
	commitEntryAroundLine,
	commitInsertionEdit,
	cursorLineIsFrontmatter,
	deleteCommitEntry,
	insertCommitAfterTask,
	parseCommitEntries,
	replaceCommitEntry,
} from '../src/commit-core';
import {
	activeCommitFields,
	commitBodyLabels,
	commitFieldRenderMode,
	commitFieldsForThread,
	DEFAULT_COMMIT_FIELDS,
	normalizeCommitFields,
} from '../src/commit-model';
import { moveCommitOption } from '../src/commit-option-model';
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
	parseInlineLogEntrySlots,
	parseInlineLogEntries,
} from '../src/inline-log';
import {
	compareThreadEntryTimestamps,
	formatThreadEntryTimestamp,
	parseThreadEntriesQuery,
} from '../src/entry-query';
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
	filterThreadOverviewTree,
} from '../src/thread-overview-model';
import {
	clampMapZoom,
	fitMapZoom,
	mapPointAtViewportPosition,
	mapScrollForCenter,
	mapScrollForViewportPoint,
	mapStageGeometry,
	mapViewportCenter,
	wheelMapZoomFactor,
} from '../src/thread-overview-layout';
import {
	describeOpenThreadRoles,
	groupOpenThreadViews,
	nextActiveThreadRolePath,
	openThreadViewsForFile,
	orderOpenThreadGroups,
} from '../src/thread-switcher-model';
import {
	advanceTaskData,
	advanceTaskLine,
	buildTaskLine,
	createTaskId,
	parseTaskLine,
	taskCurrentLabel,
	taskInsertionEdit,
	taskValidationError,
	taskWindowLabel,
	taskWindowState,
	type TaskData,
} from '../src/task-model';
import { parseTaskReference } from '../src/task-reference-model';
import { is24HourTime } from '../src/time-input';

void test('resolves automatic language and translates interpolated UI text', () => {
	assert.equal(resolveLocale('auto', 'zh-CN'), 'zh');
	assert.equal(resolveLocale('auto', 'en-US'), 'en');
	assert.equal(resolveLocale('zh', 'en-US'), 'zh');
	assert.equal(translate('en', 'Created {title}', { title: 'Project' }), 'Created Project');
	assert.equal(translate('zh', 'Created {title}', { title: '项目' }), '已创建 项目');
});

void test('overview canvas can center content edges at every zoom level', () => {
	for (const zoom of [0.2, 1, 2]) {
		const stage = mapStageGeometry(1200, 800, 600, 400, zoom);
		const maxScrollLeft = stage.width - 600;
		const maxScrollTop = stage.height - 400;
		assert.equal(stage.left, 300);
		assert.equal(stage.top, 200);
		assert.equal(stage.left + 1200 * zoom - maxScrollLeft, 300);
		assert.equal(stage.top + 800 * zoom - maxScrollTop, 200);
	}
	assert.equal(clampMapZoom(0), 0.05);
	assert.equal(clampMapZoom(10), 2.5);
	assert.equal(fitMapZoom(1200, 800, 600, 400), 0.44);
});

void test('overview restores the same map viewpoint after a tab resize or redraw', () => {
	const before = mapStageGeometry(1200, 800, 600, 400, 1.5);
	const center = mapViewportCenter(450, 125, 600, 400, before.left, before.top, 1.5);
	assert.deepEqual(center, { x: 300, y: 125 / 1.5 });
	const after = mapStageGeometry(1200, 800, 800, 500, 1.5);
	const restored = mapScrollForCenter(center, 800, 500, after.left, after.top, 1.5);
	assert.deepEqual(restored, { left: 450, top: 125 });
	assert.deepEqual(
		mapViewportCenter(restored.left, restored.top, 800, 500, after.left, after.top, 1.5),
		center,
	);
});

void test('overview pinch zoom keeps the point under the gesture stationary', () => {
	const anchor = { x: 100, y: 80 };
	const before = mapStageGeometry(1200, 800, 600, 400, 1);
	const point = mapPointAtViewportPosition(
		250, 150, anchor.x, anchor.y, before.left, before.top, 1,
	);
	assert.deepEqual(point, { x: 50, y: 30 });
	const after = mapStageGeometry(1200, 800, 600, 400, 2);
	const offset = mapScrollForViewportPoint(
		point, anchor.x, anchor.y, after.left, after.top, 2,
	);
	assert.deepEqual(offset, { left: 300, top: 180 });
	assert.deepEqual(
		mapPointAtViewportPosition(
			offset.left, offset.top, anchor.x, anchor.y, after.left, after.top, 2,
		),
		point,
	);
	assert.equal(wheelMapZoomFactor(-20, 0, 400) > 1, true);
	assert.equal(wheelMapZoomFactor(20, 0, 400) < 1, true);
	assert.equal(wheelMapZoomFactor(-1000, 0, 400), 1.25);
	assert.equal(wheelMapZoomFactor(1000, 0, 400), 0.75);
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
			2,
			'2026-09-04T14:35:27',
			'log-20260904-143527-a1b2c',
		),
		{
			replacement: [
				'  > [!thread-log]',
				'  > - (thread_log:: 2026-09-04T14:35:27)  ^log-20260904-143527-a1b2c',
			].join('\n') + '\n',
			fromCh: 0,
			toCh: 2,
			cursorLineOffset: 1,
			cursorCh: '  > - (thread_log:: 2026-09-04T14:35:27) '.length,
		},
	);
	assert.deepEqual(
		buildInlineLogEdit(
			'已有内容',
			4,
			'2026-09-04T14:35:27',
			'log-20260904-143527-a1b2c',
		),
		{
			replacement: [
				'',
				'',
				'> [!thread-log]',
				'> - (thread_log:: 2026-09-04T14:35:27)  ^log-20260904-143527-a1b2c',
			].join('\n') + '\n',
			fromCh: 4,
			toCh: 4,
			cursorLineOffset: 3,
			cursorCh: '> - (thread_log:: 2026-09-04T14:35:27) '.length,
		},
	);
	const middle = buildInlineLogEdit(
		'已有内容',
		2,
		'2026-09-04T14:35:27',
		'log-middle',
	);
	assert.equal(middle.fromCh, 2);
	assert.equal(middle.toCh, 2);
	assert.equal(middle.cursorLineOffset, 3);
	assert.match(middle.replacement, /\n\n> \[!thread-log\]/u);
	assert.match(middle.replacement, /\(thread_log:: 2026-09-04T14:35:27\) {2}\^log-middle\n\n$/u);
	const splitLine = '已有内容'.slice(0, 2) + middle.replacement + '已有内容'.slice(2);
	assert.match(splitLine, /^已有\n\n> \[!thread-log\][\s\S]*\^log-middle\n\n内容$/u);
	const compactLines = middle.replacement.trim().split('\n');
	const logLine = compactLines[1] ?? '';
	const typed = logLine.slice(0, middle.cursorCh)
		+ '完成接口验证'
		+ logLine.slice(middle.cursorCh);
	assert.equal(
		parseInlineLogEntries([compactLines[0], typed].join('\n'))[0]?.text,
		'完成接口验证',
	);
});

void test('parses multiline inline logs for a daily summary', () => {
	const content = [
		'> [!thread-log] 任意标题内容',
		'> (thread_log:: 2026-09-04T14:35:27)',
		'> ',
		'> 完成了 [[接口验证]]',
		'> 第二行也应显示',
		'> ',
		'> - 继续调研',
		'',
		'^log-20260904-143527-a1b2c',
		'',
		'> [!thread-log]',
		'> (thread_log:: 2026-09-03T23:10:00)',
		'> ',
		'> 昨天的记录',
		'',
		'^log-20260903-231000-d4e5f',
		'',
		'> [!thread-log]',
		'> (thread_log:: not-a-time)',
		'> 不应进入结果',
		'普通文本 (thread_log:: 2026-09-04T12:00:00)',
	].join('\n');

	assert.deepEqual(parseInlineLogEntries(content), [
		{
			timestamp: '2026-09-04T14:35:27',
			date: '2026-09-04',
			time: '14:35',
			text: '完成了 [[接口验证]]\n第二行也应显示\n\n- 继续调研',
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

void test('reads existing thread-log callouts and keeps malformed slots aligned', () => {
	const content = [
		'> [!thread-log] 09-03 23:10',
		'> - (thread_log:: 2026-09-03T23:10:00) 旧记录 ^log-old',
		'> 旧记录续行',
		'> [!thread-log]',
		'> (thread_log:: 2026-09-04T14:35:27)',
		'> ',
		'> 新记录',
		'',
		'^log-new',
		'',
		'> [!thread-log] 缺少时间数据',
		'> 只有正文',
		'> 不应进入结果',
		'> [!thread-log]+ 可折叠标题',
		'> (thread_log:: 2026-09-04T16:00:00)',
		'> 没有 ID 仍可查询',
	].join('\n');
	const slots = parseInlineLogEntrySlots(content);
	assert.equal(slots.length, 4);
	assert.equal(slots[0]?.text, '旧记录\n旧记录续行');
	assert.equal(slots[0]?.blockId, 'log-old');
	assert.equal(slots[1]?.text, '新记录');
	assert.equal(slots[2], undefined);
	assert.equal(slots[3]?.text, '没有 ID 仍可查询');
	assert.equal(slots[3]?.blockId, '');
	assert.deepEqual(parseInlineLogEntries(content), [slots[0], slots[1], slots[3]]);
});

void test('preserves internal Markdown block IDs inside a log body', () => {
	const content = [
		'> [!thread-log]',
		'> (thread_log:: 2026-09-04T16:00:00)',
		'> ',
		'> 这一段有自己的定位 ^sub-block',
		'> - Markdown 列表 ^list-item',
		'',
		'^log-parent',
		'',
	].join('\n');
	assert.equal(
		parseInlineLogEntries(content)[0]?.text,
		'这一段有自己的定位 ^sub-block\n- Markdown 列表 ^list-item',
	);
});

void test('finds the inline log around a Live Preview source line', () => {
	const content = [
		'# 工作区',
		'',
		'> [!thread-log] 09-04 14:35',
		'> (thread_log:: 2026-09-04T14:35:27)',
		'> ',
		'> 完成了 [[接口验证]]',
		'> 第二行',
		'',
		'^log-20260904-143527-a1b2c',
		'',
		'后续内容',
	].join('\n');

	assert.deepEqual(inlineLogEntryAroundLine(content, 2), {
		timestamp: '2026-09-04T14:35:27',
		date: '2026-09-04',
		time: '14:35',
		text: '完成了 [[接口验证]]\n第二行',
		blockId: 'log-20260904-143527-a1b2c',
	});
	assert.equal(inlineLogEntryAroundLine(content, 6)?.text, '完成了 [[接口验证]]\n第二行');
	assert.equal(inlineLogEntryAroundLine(content, 10), undefined);
});

void test('parses the unified thread entries query', () => {
	assert.deepEqual(parseThreadEntriesQuery([
		'thread_id: 20e15ed8-5de0-44bc-919f-54d49294c14c',
		'date: 2026-09-01..2026-09-04',
		'type: [commit, log]',
		'group_by: thread',
		'thread_detail: crumb',
		'order: asc',
	].join('\n')), {
		query: {
			threadIds: ['20e15ed8-5de0-44bc-919f-54d49294c14c'],
			date: { from: '2026-09-01', to: '2026-09-04' },
			types: ['commit', 'log'],
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
			types: ['commit', 'log'],
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
		'type: commit, thought',
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

void test('formats commit and log timestamps consistently', () => {
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
		[entry, { thread_id: 'thread-1', attention_fallback: true }],
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
	assert.equal(index.getMember(entry as never)?.attentionFallback, true);
	assert.equal(index.getMember(research as never)?.role, 'research');
	assert.equal(index.getMember(research as never)?.roleStatus, 'terminated');
	assert.equal(index.getMember(research as never)?.attentionFallback, false);
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
		'---\nthread_role: workspace\nthread_role_status: active\nattention_fallback: true\n---\n',
	);
});

void test('selects active attention fallbacks only when their file has no unfinished task', () => {
	const members = [
		{ path: 'workspace.md', roleStatus: 'active', attentionFallback: true },
		{ path: 'future-task.md', roleStatus: 'active', attentionFallback: true },
		{ path: 'context.md', roleStatus: 'active', attentionFallback: false },
		{ path: 'history.md', roleStatus: 'terminated', attentionFallback: true },
	];
	assert.deepEqual(
		selectAttentionFallbackPaths(members, new Set(['future-task.md'])),
		['workspace.md'],
	);
	assert.equal(threadUsesAttentionFallback('active'), true);
	assert.equal(threadUsesAttentionFallback('dormant'), false);
	assert.equal(threadUsesAttentionFallback('review'), false);
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

void test('normalizes configurable commit fields and protects system keys', () => {
	assert.deepEqual(DEFAULT_COMMIT_FIELDS.map((field) => ({
		key: field.key,
		control: field.control,
		storage: field.storage,
	})), [
		{ key: 'commit_summary', control: 'textarea', storage: 'body' },
		{ key: 'effort', control: 'select', storage: 'inline' },
	]);
	assert.deepEqual(normalizeCommitFields([
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline', required: true,
		},
		{
			key: 'commit_time', label: '备注', control: 'textarea', storage: 'body', required: false,
		},
	]), [
		{
			key: 'custom_score', label: '评分', control: 'number', storage: 'inline',
			required: true, deprecated: false, options: [],
		},
		{
			key: 'commit_field_2', label: '备注', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		},
	]);
});

void test('recognizes body field labels independently of the current storage mode', () => {
	const labels = commitBodyLabels(normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
	]));
	assert.equal(labels.has('摘要'), true);
});

void test('moves commit select options without changing their values', () => {
	assert.deepEqual(
		moveCommitOption(['low', 'medium', 'high'], 0, 2),
		['medium', 'high', 'low'],
	);
	assert.deepEqual(
		moveCommitOption(['low', 'high'], 3, 0),
		['low', 'high'],
	);
});

void test('uses a per-thread commit template before the global default', () => {
	const defaults = normalizeCommitFields(undefined);
	assert.deepEqual(
		commitFieldsForThread(undefined, defaults).map((field) => field.key),
		['commit_summary', 'effort'],
	);
	assert.deepEqual(commitFieldsForThread([], defaults), []);
	assert.deepEqual(
		commitFieldsForThread([{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body', required: false,
		}], defaults),
		[{
			key: 'risk', label: '风险', control: 'textarea', storage: 'body',
			required: false, deprecated: false, options: [],
		}],
	);
});

void test('moves deprecated fields last and excludes them from new commit input', () => {
	const fields = normalizeCommitFields([
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
		activeCommitFields(fields).map((field) => field.key),
		['current_metric'],
	);
});

void test('builds a Dataview-queryable commit with a free-form body', () => {
	const fields = normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'text', storage: 'inline',
			required: true,
		},
		{
			key: 'effort', label: '人力消耗', control: 'select', storage: 'inline',
			required: false, options: ['quick', 'light', 'normal', 'deep'],
		},
		{
			key: 'commit_result', label: '阶段成果', control: 'textarea', storage: 'body',
			required: false,
		},
	]);
	assert.equal(buildCommitEntry({
		date: '2026-08-31',
		time: '14:35',
		blockId: 'cm-20260831-01',
		fields,
		values: {
			commit_summary: '完成表单设计',
			effort: 'light',
			commit_result: '可以自由配置字段。\n长文字保留在正文。',
		},
	}), [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_time:: 14:35] [commit_summary:: 完成表单设计] [effort:: light] ^cm-20260831-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
});

void test('round-trips multiline inline commit values without delimiter collisions', () => {
	const fields = normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'textarea', storage: 'inline',
			required: true,
		},
	]);
	const value = '第一行\n\n第二行 & 原样保留 &#10; 和 ]';
	const entry = buildCommitEntry({
		date: '2026-09-20',
		time: '12:30',
		blockId: 'cm-multiline-inline',
		fields,
		values: { commit_summary: value },
	});
	assert.match(entry, /\[commit_summary:: 第一行&#10;&#10;第二行 &#38; 原样保留 &#38;#10; 和 &#93;\]/u);
	assert.equal(parseCommitEntries(entry)[0]?.values.commit_summary, value);
});

void test('parses commit data from a thread member callout', () => {
	const parsed = parseCommitEntries([
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_time:: 14:35] [commit_summary:: 完成表单设计] [effort:: deep] ^cm-01',
		'>   - **阶段成果：**',
		'>     可以自由配置字段。',
		'>     长文字保留在正文。',
	].join('\n'));
	assert.deepEqual(parsed, [{
		blockId: 'cm-01',
		values: {
			commit: 'true',
			commit_date: '2026-08-31',
			commit_time: '14:35',
			commit_summary: '完成表单设计',
			effort: 'deep',
		},
		body: [{
			label: '阶段成果',
			value: '可以自由配置字段。\n长文字保留在正文。',
		}],
	}]);
});

void test('finds the commit around a Live Preview source line', () => {
	const content = [
		'# Thread 工作区',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_summary:: 完成] ^cm-live',
		'>   - **阶段成果：** 可见',
		'',
		'后续内容',
	].join('\n');
	assert.equal(commitEntryAroundLine(content, 2)?.blockId, 'cm-live');
	assert.equal(commitEntryAroundLine(content, 4)?.values.commit_summary, '完成');
	assert.equal(commitEntryAroundLine(content, 6), undefined);
});

void test('appends commit callouts to a thread member', () => {
	const entry = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] ^cm-new',
	].join('\n');
	const original = [
		'# Thread 工作区',
		'',
		'自由记录',
		'',
	].join('\n');
	const result = appendCommitEntry(original, entry);
	assert.match(result, /自由记录\n\n> \[!thread-commit\].*\n> - \[commit:: true\]/);
	assert.ok(result.indexOf('自由记录') < result.indexOf('^cm-new'));
});

void test('inserts commit callouts at a thread member cursor line', () => {
	const original = [
		'# Thread 工作区',
		'',
		'第一段',
		'',
		'第二段',
	].join('\n');
	const lines = original.split('\n');
	const entry = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-01] ^cm-custom',
	].join('\n');
	const edit = commitInsertionEdit(lines, entry, 2);
	assert.deepEqual(edit.from, { line: 2, ch: 3 });
	assert.deepEqual(edit.to, { line: 4, ch: 0 });
	const offset = (position: { line: number; ch: number }): number =>
		lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0)
		+ position.ch;
	const result = original.slice(0, offset(edit.from))
		+ edit.replacement
		+ original.slice(offset(edit.to));
	assert.match(result, /第一段\n\n> \[!thread-commit\][\s\S]*\^cm-custom\n\n第二段/);
	assert.deepEqual(commitInsertionEdit(lines, entry, 3), {
		from: { line: 3, ch: 0 },
		to: { line: 3, ch: 0 },
		replacement: `${entry}\n`,
	});
});

void test('rejects commit cursor positions inside live frontmatter', () => {
	const lines = ['---', 'type: thread', 'parent: none', '---', '# Body'];
	assert.equal(cursorLineIsFrontmatter(lines, 2), true);
	assert.equal(cursorLineIsFrontmatter(lines, 4), false);
	assert.equal(cursorLineIsFrontmatter(['---', 'type: thread'], 1), true);
	assert.equal(cursorLineIsFrontmatter(['# Body'], 0), false);
});

void test('replaces one commit in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-01] [commit_summary:: 旧摘要] ^cm-edit',
		'>   - **详情：** 旧内容',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-08-31] [commit_summary:: 保留] ^cm-keep',
	].join('\n');
	const replacement = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-02] [commit_time:: 10:30] [commit_summary:: 新摘要] ^cm-edit',
		'>   - **详情：** 新内容',
	].join('\n');
	const result = replaceCommitEntry(original, 'cm-edit', replacement);
	assert.match(result, /> \[!thread-commit\]\n> - \[commit:: true\].*\[commit_date:: 2026-09-02\].*\[commit_time:: 10:30\]/);
	assert.match(result, /> - \[commit:: true\].*新摘要.*\^cm-edit/);
	assert.match(result, /> {3}- \*\*详情：\*\* 新内容/);
	assert.doesNotMatch(result, /旧摘要|旧内容/);
	assert.match(result, /保留.*\^cm-keep/);
	assert.equal(parseCommitEntries(result).length, 2);
});

void test('adds active template fields when editing an older commit', () => {
	const fields = normalizeCommitFields([
		{
			key: 'commit_summary', label: '摘要', control: 'text', storage: 'inline',
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
	const edit = commitEditState(fields, {
		blockId: 'cm-old',
		values: {
			commit: 'true',
			commit_date: '2026-09-01',
			commit_summary: '旧记录',
			legacy_only: '保留',
		},
		body: [],
	});
	assert.deepEqual(edit.fields.map((field) => field.key), [
		'commit_summary', 'new_note', 'legacy_only',
	]);
	assert.equal(edit.values.new_note, undefined);
	assert.equal(edit.fields.find((field) => field.key === 'new_note')?.required, false);
	assert.equal(edit.fields.find((field) => field.key === 'legacy_only')?.deprecated, true);
});

void test('chooses markdown rendering by commit field shape', () => {
	assert.equal(commitFieldRenderMode({ control: 'text', storage: 'inline' }), 'inline-markdown');
	assert.equal(commitFieldRenderMode({ control: 'textarea', storage: 'body' }), 'block-markdown');
	assert.equal(commitFieldRenderMode({ control: 'textarea', storage: 'inline' }), 'block-markdown');
	assert.equal(commitFieldRenderMode({ control: 'text', storage: 'body' }), 'block-markdown');
	assert.equal(commitFieldRenderMode({ control: 'select', storage: 'inline' }), 'plain');
	assert.equal(commitFieldRenderMode({ control: 'number', storage: 'inline' }), 'plain');
	assert.equal(commitFieldRenderMode({ control: 'toggle', storage: 'inline' }), 'plain');
	assert.equal(commitFieldRenderMode({ control: 'date', storage: 'inline' }), 'plain');
});

void test('deletes one commit in place by block id', () => {
	const original = [
		'# Thread 工作区',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-02] [commit_summary:: 删除] ^cm-delete',
		'>   - **详情：** 一并删除',
		'',
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-01] [commit_summary:: 保留] ^cm-keep',
	].join('\n');
	const result = deleteCommitEntry(original, 'cm-delete');
	assert.doesNotMatch(result, /删除|一并删除|cm-delete/);
	assert.match(result, /保留.*\^cm-keep/);
	assert.equal(parseCommitEntries(result).length, 1);
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

void test('filters the overview to matching attention nodes while retaining ancestors', () => {
	const tree = buildThreadOverviewTree([
		{ id: 'root', title: 'Root', status: 'active' },
		{ id: 'ready-child', title: 'Ready', status: 'active', parent: 'root' },
		{ id: 'quiet-child', title: 'Quiet', status: 'dormant', parent: 'root' },
	], new Set(DEFAULT_THREAD_OVERVIEW_STATUSES));
	const filtered = filterThreadOverviewTree(tree, (item) => item.id === 'ready-child');
	assert.deepEqual(filtered.map((node) => ({
		id: node.item.id,
		contextOnly: node.contextOnly,
		children: node.children.map((child) => ({
			id: child.item.id,
			contextOnly: child.contextOnly,
		})),
	})), [{
		id: 'root',
		contextOnly: true,
		children: [{ id: 'ready-child', contextOnly: false }],
	}]);
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

void test('task readiness respects date windows and the current repeat occurrence', () => {
	assert.equal(
		todoDisposition(' ', '记录恢复 [window_start:: 2026-09-19]', '2026-09-18'),
		'future',
	);
	assert.equal(
		todoDisposition(' ', '记录恢复 [window_start:: 2026-09-18]', '2026-09-18'),
		'ready',
	);
	assert.equal(todoDisposition(' ', '记录恢复 [current:: 2026-09-19]', '2026-09-18'), 'future');
});

void test('accepts only explicit 24-hour HH:mm values', () => {
	assert.equal(is24HourTime('00:00'), true);
	assert.equal(is24HourTime('23:59'), true);
	assert.equal(is24HourTime('24:00'), false);
	assert.equal(is24HourTime('12:60'), false);
	assert.equal(is24HourTime('9:30'), false);
	assert.equal(is24HourTime('09:30 PM'), false);
});

void test('parses task references only through the distinct reference_task_id field', () => {
	assert.equal(
		parseTaskReference('reference_task_id: task-abcdef123456'),
		'task-abcdef123456',
	);
	assert.equal(
		parseTaskReference('[reference_task_id:: task-abcdef123456]'),
		'task-abcdef123456',
	);
	assert.equal(parseTaskReference('task_id: task-abcdef123456'), undefined);
	assert.equal(parseTaskReference('task-abcdef123456'), undefined);
});

void test('task form fields round-trip without losing markdown task state or other metadata', () => {
	const source = '  > - [/] 记录恢复 [task_id:: task-123456789abc] '
		+ '[window_start:: 2026-09-18] [window_end:: 2026-09-20] '
		+ '[effort:: quick] [current:: 2026-09-18] [repeat:: FREQ=WEEKLY] '
		+ '[thread_pin:: true] ^task-recovery';
	const parsed = parseTaskLine(source);
	assert.ok(parsed);
	assert.deepEqual(parsed.data, {
		taskId: 'task-123456789abc',
		content: '记录恢复',
		pinned: true,
		windowStart: '2026-09-18',
		windowEnd: '2026-09-20',
		effort: 'quick',
		repeat: true,
		current: '2026-09-18',
		repeatFrequency: 'weekly',
		repeatInterval: 1,
		repeatMonthDay: 1,
	});
	const rebuilt = buildTaskLine(parsed.data, parsed);
	assert.match(rebuilt, /^ {2}> - \[\/\] 记录恢复/u);
	assert.match(rebuilt, /\[thread_pin:: true\]/u);
	assert.match(rebuilt, /\^task-recovery$/u);
	assert.deepEqual(parseTaskLine(rebuilt)?.data, parsed.data);
});

void test('task validation keeps date bounds optional and validates repeat state', () => {
	const base: TaskData = {
		taskId: 'task-123456789abc',
		content: '整理会议结论',
		pinned: false,
		windowStart: '',
		windowEnd: '',
		effort: 'normal',
		repeat: false,
		current: '',
		repeatFrequency: 'daily',
		repeatInterval: 2,
		repeatMonthDay: 1,
	};
	assert.equal(taskValidationError(base), undefined);
	assert.equal(taskValidationError({ ...base, taskId: '' }), 'task-id');
	assert.match(createTaskId(), /^task-[a-z0-9]{12}$/u);
	assert.equal(taskValidationError({
		...base,
		windowStart: '2026-09-19',
		windowEnd: '2026-09-18',
	}), 'window-order');
	assert.equal(taskValidationError({ ...base, repeat: true }), 'repeat-current');
	assert.equal(taskValidationError({
		...base,
		repeat: true,
		current: '2026-09-18',
		repeatFrequency: 'custom',
		repeatInterval: 1,
	}), 'repeat-interval');
});

void test('formats task windows as one compact boundary range', () => {
	assert.equal(taskWindowLabel({
		windowStart: '2026-09-10',
		windowEnd: '2026-09-15',
	}), '2026-09-10 ～ 2026-09-15');
	assert.equal(taskWindowLabel({ windowStart: '2026-09-10', windowEnd: '' }), '2026-09-10 ～');
	assert.equal(taskWindowLabel({ windowStart: '', windowEnd: '2026-09-15' }), '～ 2026-09-15');
});

void test('formats recurring task current dates for compact rendering', () => {
	assert.equal(taskCurrentLabel('2026-09-21', '2026-09-21', 'Today'), 'Today');
	assert.equal(taskCurrentLabel('2026-10-02', '2026-09-21', 'Today'), '10/2');
	assert.equal(taskCurrentLabel('2027-01-03', '2026-09-21', 'Today'), '2027/1/3');
});

void test('classifies task windows before, during and after their date range', () => {
	const range = { windowStart: '2026-09-10', windowEnd: '2026-09-15' };
	assert.equal(taskWindowState(range, '2026-09-09'), 'upcoming');
	assert.equal(taskWindowState(range, '2026-09-10'), 'current');
	assert.equal(taskWindowState(range, '2026-09-15'), 'current');
	assert.equal(taskWindowState(range, '2026-09-16'), 'overdue');
	assert.equal(taskWindowState({ windowStart: '', windowEnd: '2026-09-15' }, '2026-09-10'), 'current');
	assert.equal(taskWindowState({ windowStart: '2026-09-10', windowEnd: '' }, '2026-09-09'), 'upcoming');
	assert.equal(taskWindowState({ windowStart: '', windowEnd: '' }, '2026-09-10'), undefined);
});

void test('advances one repeating task in place and preserves its relative date window', () => {
	const monthly: TaskData = {
		taskId: 'task-123456789abc',
		content: '月末复盘',
		pinned: false,
		windowStart: '2026-01-30',
		windowEnd: '2026-02-01',
		effort: 'light',
		repeat: true,
		current: '2026-01-31',
		repeatFrequency: 'monthly',
		repeatInterval: 1,
		repeatMonthDay: 31,
	};
	const february = advanceTaskData(monthly);
	assert.ok(february);
	assert.deepEqual(february, {
		...monthly,
		current: '2026-02-28',
		windowStart: '2026-02-27',
		windowEnd: '2026-03-01',
	});
	assert.equal(advanceTaskData(february)?.current, '2026-03-31');
	assert.equal(
		advanceTaskLine('- [x] 每日记录 [task_id:: task-123456789abc] '
			+ '[current:: 2026-09-18] [repeat:: FREQ=DAILY]'),
		'- [ ] 每日记录 [task_id:: task-123456789abc] '
			+ '[current:: 2026-09-19] [repeat:: FREQ=DAILY]',
	);
});

void test('skips past repeat occurrences when advancing while preserving the window offset', () => {
	const daily: TaskData = {
		taskId: 'task-123456789abc',
		content: '每日记录',
		pinned: false,
		windowStart: '2026-09-17',
		windowEnd: '2026-09-18',
		effort: 'quick',
		repeat: true,
		current: '2026-09-18',
		repeatFrequency: 'daily',
		repeatInterval: 1,
		repeatMonthDay: 1,
	};
	assert.deepEqual(advanceTaskData(daily, '2026-09-21'), {
		...daily,
		current: '2026-09-21',
		windowStart: '2026-09-20',
		windowEnd: '2026-09-21',
	});
	assert.equal(advanceTaskData({ ...daily, current: '2026-09-21' }, '2026-09-21')?.current, '2026-09-22');
	assert.equal(advanceTaskData({
		...daily,
		current: '2026-09-01',
		repeatFrequency: 'weekly',
	}, '2026-09-21')?.current, '2026-09-22');
	assert.equal(advanceTaskData({
		...daily,
		current: '2026-01-31',
		repeatFrequency: 'monthly',
		repeatMonthDay: 31,
	}, '2026-03-01')?.current, '2026-03-31');
});

void test('task creation replaces an empty line or inserts below the current line', () => {
	const task = '- [ ] 新任务';
	assert.deepEqual(taskInsertionEdit(['', 'next'], 0, task), {
		from: { line: 0, ch: 0 },
		to: { line: 0, ch: 0 },
		replacement: task,
		cursor: { line: 0, ch: task.length },
	});
	assert.deepEqual(taskInsertionEdit(['  正文'], 0, task), {
		from: { line: 0, ch: 4 },
		to: { line: 0, ch: 4 },
		replacement: `\n  ${task}`,
		cursor: { line: 1, ch: 2 + task.length },
	});
});

void test('task commits are inserted after the complete task block', () => {
	const source = [
		'# Work',
		'- [ ] Main task [task_id:: task-main]',
		'  continuation',
		'  - [ ] child task',
		'',
		'- [ ] Next task',
	].join('\n');
	const entry = [
		'> [!thread-commit]',
		'> - [commit:: true] [commit_date:: 2026-09-22] ^cm-test',
	].join('\n');
	assert.equal(insertCommitAfterTask(source, 1, entry), [
		'# Work',
		'- [ ] Main task [task_id:: task-main]',
		'  continuation',
		'  - [ ] child task',
		'',
		entry,
		'',
		'- [ ] Next task',
		'',
	].join('\n'));
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

void test('pins tasks in their source line without changing their identity', () => {
	const source = '- [ ] 分析恢复趋势 ^task-recovery';
	const pinned = taskLineWithPin(source, true);
	assert.equal(
		pinned,
		'- [ ] 分析恢复趋势 [thread_pin:: true] ^task-recovery',
	);
	assert.equal(taskIsPinned(pinned), true);
	assert.equal(
		taskTextWithoutPin('分析恢复趋势 [thread_pin:: true] ^task-recovery'),
		'分析恢复趋势 ^task-recovery',
	);
	assert.equal(taskLineWithPin(pinned, true), pinned);
	assert.equal(taskLineWithPin(pinned, false), source);
	assert.equal(
		taskLineWithPin('> - [ ] 记录睡眠', true),
		'> - [ ] 记录睡眠 [thread_pin:: true]',
	);
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
 assert.equal(attentionHint('dormant', summarizeAttention('sleep', nodes, [])), '');
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
			normalizeCommitFields(undefined).map((field) => field.label),
			['Summary', 'Effort'],
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
