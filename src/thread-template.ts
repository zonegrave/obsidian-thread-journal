import type { ThreadKind } from './types';

export const DEFAULT_THREAD_TEMPLATE = [
	'```thread-breadcrumb',
	'```',
	'',
	'# {{title}}',
	'',
	'## 期望结果',
	'',
	'## 完成条件',
	'',
	'- ',
	'',
	'## Milestones',
	'',
	'- [ ] ',
	'',
	'## 当前 Context',
	'',
	'**继续：** ',
	'',
	'### Checkpoints',
	'',
	'```thread-checkpoints',
	'```',
	'',
	'## 子线程',
	'',
	'```thread-children',
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
	};

	return template
		.replace(/\{\{date:([^}\r\n]+)\}\}/g, (_match, format: string) =>
			formatDate(format.trim()))
		.replace(/\{\{([a-z_]+)\}\}/gi, (match, key: string) =>
			Object.prototype.hasOwnProperty.call(replacements, key)
				? replacements[key] ?? ''
				: match);
}
