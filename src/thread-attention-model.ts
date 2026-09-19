import { t } from './i18n';

export type TodoDisposition = 'ready' | 'future' | 'waiting' | 'candidate' | 'unknown';
export type TaskScope = 'today' | 'all';
export interface AttentionTask {
 key: string;
 owner: string;
 disposition: TodoDisposition;
}

const THREAD_PIN_FIELD = /\s*\[thread_pin::\s*true\]/giu;

export function taskIsPinned(text: string): boolean {
 return /\[thread_pin::\s*true\]/iu.test(text);
}

export function taskTextWithoutPin(text: string): string {
 return text.replace(THREAD_PIN_FIELD, '').trim();
}

export function taskLineWithPin(line: string, pinned: boolean): string {
 const withoutPin = line.replace(THREAD_PIN_FIELD, '');
 if (!pinned) return withoutPin;
 const trailingWhitespace = /\s*$/u.exec(withoutPin)?.[0] ?? '';
 const body = withoutPin.slice(0, withoutPin.length - trailingWhitespace.length).trimEnd();
 const blockId = /\s+(\^[A-Za-z0-9-]+)$/u.exec(body);
 if (!blockId) return `${body} [thread_pin:: true]${trailingWhitespace}`;
 return `${body.slice(0, blockId.index).trimEnd()} [thread_pin:: true] ${blockId[1]}${trailingWhitespace}`;
}
export interface AttentionNode {
 id: string;
 parent?: string;
 status: string;
}
export interface AttentionSummary {
 open: number;
 ready: number;
 future: number;
 waiting: number;
 candidate: number;
 unknown: number;
 suspended: number;
 cycle: boolean;
}

export function filterAttentionTasks<T extends { disposition: TodoDisposition }>(
 tasks: readonly T[],
 scope: TaskScope,
): T[] {
 return scope === 'today'
  ? tasks.filter(task => task.disposition === 'ready')
  : [...tasks];
}

// Uses Obsidian's parsed task marker; code fences and ordinary lists are excluded by the caller.
export function todoDisposition(marker: string, text: string, now: string): TodoDisposition | undefined {
 if (marker.toLowerCase() === 'x' || marker === '-') return undefined;
 if (!text.trim()) return undefined;
 if (marker === '?' || /\[candidate::\s*true\]/i.test(text)) return 'candidate';
 if (marker === '>' || /\[waiting::\s*true\]/i.test(text)) return 'waiting';
 if (marker !== ' ' && marker !== '/') return 'unknown';
	const today = now.slice(0, 10);
	const comparisonNow = /^\d{4}-\d{2}-\d{2}$/u.test(now) ? `${now} 23:59` : now.replace('T', ' ');
	const leadingDate = text.match(/^(\d{4}-\d{2}-\d{2})(?:\s|$)/)?.[1];
	if (leadingDate && leadingDate > today) return 'future';
	const dates = [...text.matchAll(/(?:⏳|🛫|\[(?:scheduled|start)::)\s*(\d{4}-\d{2}-\d{2})/g)];
	if (dates.some(match => (match[1] ?? '') > today)) return 'future';
	const windowStart = /\[window_start::\s*(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?)\s*\]/u
		.exec(text)?.[1]?.replace('T', ' ');
	if (windowStart && windowStart > comparisonNow) return 'future';
 // A due date is a deadline, not a reason to postpone starting.
 return 'ready';
}

export function summarizeAttention(root: string, nodes: AttentionNode[], tasks: AttentionTask[]): AttentionSummary {
 const byId = new Map(nodes.map(node => [node.id, node]));
 const children = new Map<string, AttentionNode[]>();
 for (const node of nodes) {
  if (node.parent) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
 }
 const result: AttentionSummary = { open: 0, ready: 0, future: 0, waiting: 0, candidate: 0, unknown: 0, suspended: 0, cycle: false };
 const visited = new Set<string>();
 const blocked = new Map<string, boolean>();
 const walk = (id: string, inherited: boolean): void => {
  if (visited.has(id)) { result.cycle = true; return; }
  visited.add(id);
  const state = byId.get(id)?.status;
  const suspended = inherited || ['idea', 'paused', 'completed', 'closed'].includes(state ?? '');
  blocked.set(id, suspended);
  for (const child of children.get(id) ?? []) walk(child.id, suspended);
 };
 // A child cannot silently bypass an explicitly suspended ancestor.
 let ancestor = byId.get(root)?.parent;
 let inherited = false;
 const ancestors = new Set([root]);
 while (ancestor) {
  if (ancestors.has(ancestor)) { result.cycle = true; break; }
  ancestors.add(ancestor);
  const node = byId.get(ancestor);
  inherited ||= ['idea', 'paused', 'completed', 'closed'].includes(node?.status ?? '');
  ancestor = node?.parent;
 }
 walk(root, inherited);
 const grouped = new Map<string, AttentionTask[]>();
 for (const task of tasks) {
  if (visited.has(task.owner)) grouped.set(task.key, [...(grouped.get(task.key) ?? []), task]);
 }
 for (const group of grouped.values()) {
  result.open++;
  const available = group.find(task => !blocked.get(task.owner));
  if (available) result[available.disposition]++;
  else result.suspended++;
 }
 return result;
}

export function attentionHint(status: string, summary: AttentionSummary): string {
 if (summary.cycle) return t('The parent relationship contains a cycle; check it');
 if (status === 'idea') return t('Keep the idea; set it to committed when you decide to invest');
 if (status === 'committed') return summary.open
  ? t('Committed and waiting to begin')
  : t('Committed; define the commitment or next action');
 if (status === 'active' && summary.open === 0) return t('The subtree has no unfinished todo; add the next action or consider making it dormant');
 if (status === 'dormant') return summary.ready
  ? t('Ready todo needs attention')
  : '';
 if (status === 'paused') return t('Frozen; retain items without investing attention');
 if (status === 'review') return t('Waiting for review and wrap-up');
 if (status === 'completed' || status === 'closed') return summary.open
  ? t('Unfinished items remain; review them')
  : t('Retain as history');
 return summary.ready ? t('Ready todo available') : t('No ready todo');
}
