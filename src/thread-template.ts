import type { ThreadStatus } from './thread-status-model';

export const DEFAULT_THREAD_TEMPLATE = [
	'# {{title}}',
	'',
	'## 设想与 Context',
	'',
	'## Milestones（按需）',
	'',
	'### Checkpoints',
	'',
	'```thread-entries',
	'thread_id: {{thread_id}}',
	'type: checkpoint',
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
	status: ThreadStatus;
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
		status: context.status,
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
