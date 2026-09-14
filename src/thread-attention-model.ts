export type TodoDisposition = 'ready' | 'future' | 'waiting' | 'candidate' | 'unknown';
export type TaskScope = 'today' | 'all';
export interface AttentionTask {
 key: string;
 owner: string;
 disposition: TodoDisposition;
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
export function todoDisposition(marker: string, text: string, today: string): TodoDisposition | undefined {
 if (marker.toLowerCase() === 'x' || marker === '-') return undefined;
 if (!text.trim()) return undefined;
 if (marker === '?' || /\[candidate::\s*true\]/i.test(text)) return 'candidate';
 if (marker === '>' || /\[waiting::\s*true\]/i.test(text)) return 'waiting';
 if (marker !== ' ' && marker !== '/') return 'unknown';
 const leadingDate = text.match(/^(\d{4}-\d{2}-\d{2})(?:\s|$)/)?.[1];
 if (leadingDate && leadingDate > today) return 'future';
 const dates = [...text.matchAll(/(?:⏳|🛫|\[(?:scheduled|start)::)\s*(\d{4}-\d{2}-\d{2})/g)];
 if (dates.some(match => (match[1] ?? '') > today)) return 'future';
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
 if (summary.cycle) return '父子关系存在循环，请检查';
 if (status === 'idea') return '保留想法；决定投入后可设为已承诺';
 if (status === 'committed') return summary.open ? '已承诺，等待开始' : '已承诺；请明确承诺内容或下一步';
 if (status === 'active' && summary.open === 0) return '子树没有未完成 todo：补充下一步，或考虑休眠';
 if (status === 'dormant') return summary.ready ? '有可执行 todo，需要处理' : '按需记录，无需持续关注';
 if (status === 'paused') return '已冻结；保留事项，暂停投入';
 if (status === 'review') return '等待复盘与收尾';
 if (status === 'completed' || status === 'closed') return summary.open ? '仍保留未完成事项，请复核' : '保留历史';
 return summary.ready ? '有可执行 todo' : '当前无可执行 todo';
}
