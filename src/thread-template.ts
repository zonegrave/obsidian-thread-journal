export const DEFAULT_THREAD_ROLE_TEMPLATE = [
	'---',
	'thread_role: workspace',
	'thread_role_status: active',
	'---',
	'',
].join('\n');

export interface ThreadFileTemplateContext {
	title: string;
	fileName: string;
	threadId: string;
	role: string;
	roleStatus: 'active' | 'terminated';
	status: string;
	parentLink?: string;
	parentTitle?: string;
	created: string;
}

export function renderThreadFileTemplate(
	template: string,
	context: ThreadFileTemplateContext,
	formatDate: (format: string) => string = () => context.created,
): string {
	const replacements: Record<string, string> = {
		title: context.title,
		thread_title: context.title,
		filename: context.fileName,
		thread_id: context.threadId,
		thread_role: context.role,
		thread_role_status: context.roleStatus,
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
