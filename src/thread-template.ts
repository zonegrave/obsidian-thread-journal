import type { ThreadKind } from './types';

export const DEFAULT_THREAD_TEMPLATE = [
	'```thread-breadcrumb',
	'```',
	'',
	'# {{title}}',
	'',
	'## {{goal_heading}}',
	'',
	'## {{criteria_heading}}',
	'',
	'- ',
	'',
	'## 子线程',
	'',
	'```thread-children',
	'```',
	'',
	'## 记录',
	'',
	'```thread-records',
	'scope: descendants',
	'days: 30',
	'```',
	'',
].join('\n');

export interface ThreadTemplateContext {
	title: string;
	fileName: string;
	threadId: string;
	kind: ThreadKind;
	parentLink?: string;
	parentTitle?: string;
	created: string;
}

export function renderThreadTemplate(
	template: string,
	context: ThreadTemplateContext,
	formatDate: (format: string) => string = () => context.created,
): string {
	const goalHeading = context.kind === 'area' ? '责任范围' : '期望结果';
	const criteriaHeading = context.kind === 'area' ? '维持标准' : '完成条件';
	const replacements: Record<string, string> = {
		title: context.title,
		thread_title: context.title,
		filename: context.fileName,
		thread_id: context.threadId,
		kind: context.kind,
		parent: context.parentLink ?? '',
		parent_title: context.parentTitle ?? '',
		created: context.created,
		date: context.created,
		goal_heading: goalHeading,
		criteria_heading: criteriaHeading,
	};

	return template
		.replace(/\{\{date:([^}\r\n]+)\}\}/g, (_match, format: string) =>
			formatDate(format.trim()))
		.replace(/\{\{([a-z_]+)\}\}/gi, (match, key: string) =>
			Object.prototype.hasOwnProperty.call(replacements, key)
				? replacements[key] ?? ''
				: match);
}
