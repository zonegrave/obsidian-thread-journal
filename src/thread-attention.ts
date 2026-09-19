import { App, TFile, moment } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import {
 summarizeAttention,
 taskIsPinned,
 taskLineWithPin,
 taskTextWithoutPin,
 todoDisposition,
 type AttentionTask,
 type AttentionNode,
 type AttentionSummary,
 type TodoDisposition,
} from './thread-attention-model';
import type { ThreadInfo } from './types';
import { parseTaskLine } from './task-model';

export interface AttentionRowTask {
 key: string;
 file: TFile;
 line: number;
 sourceLine: string;
 text: string;
	disposition: TodoDisposition;
	pinned: boolean;
}

export interface AttentionRow {
 thread: ThreadInfo;
 summary: AttentionSummary;
 tasks: AttentionRowTask[];
}

export async function setAttentionTaskPinned(
 app: App,
 task: AttentionRowTask,
 pinned: boolean,
): Promise<void> {
 await app.vault.process(task.file, (content) => {
  const lines = content.split('\n');
  let line = task.line;
  if (lines[line] !== task.sourceLine) {
   const matches = lines.flatMap((source, index) => source === task.sourceLine ? [index] : []);
   if (matches.length !== 1) throw new Error('The task changed; refresh the overview and try again.');
   line = matches[0] ?? line;
  }
  const source = lines[line];
  if (source === undefined) throw new Error('The task no longer exists.');
  lines[line] = taskLineWithPin(source, pinned);
  return lines.join('\n');
 });
}

export async function collectAttention(app: App, index: ThreadIndex): Promise<AttentionRow[]> {
 const threads = index.getAllThreads();
 const nodes: AttentionNode[] = threads.map(thread => ({
  id: thread.id, status: thread.status,
  parent: index.getParentFile(thread.file) ? index.getThread(index.getParentFile(thread.file)!)?.id : undefined,
 }));
 const tasks: AttentionTask[] = [];
 const taskSources = new Map<string, AttentionRowTask>();
	const now = moment().format('YYYY-MM-DD HH:mm');
 for (const file of app.vault.getMarkdownFiles()) {
  const cache = app.metadataCache.getFileCache(file);
  const taskItems = cache?.listItems?.filter(item => item.task !== undefined) ?? [];
  if (!taskItems.length) continue;
  const thread = index.getThread(file);
  const member = index.getMember(file);
  const ownerFile = thread?.file ?? (member?.roleStatus === 'active'
   ? index.getThreadForMember(file)
   : undefined);
  const defaultOwner = ownerFile ? index.getThread(ownerFile)?.id : undefined;
  const lines = (await app.vault.cachedRead(file)).split('\n');
  for (const item of taskItems) {
   const line = item.position.start.line;
			const sourceLine = lines[line] ?? '';
			const taskText = sourceLine.replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s*/, '');
			const parsed = parseTaskLine(sourceLine);
			const text = parsed?.data.content ?? taskTextWithoutPin(taskText);
			const disposition = todoDisposition(item.task ?? '', taskText, now);
   if (!disposition) continue;
   const owners = new Set<string>();
   if (defaultOwner) owners.add(defaultOwner);
   else for (const link of cache?.links ?? []) {
    if (link.position.start.line !== line) continue;
    const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
    const threadFile = target ? index.getThreadFile(target) : undefined;
    const id = threadFile ? index.getThread(threadFile)?.id : undefined;
    if (id) owners.add(id);
   }
   const key = `${file.path}:${line}`;
   for (const owner of owners) tasks.push({ key, owner, disposition });
   if (owners.size) taskSources.set(key, {
    key,
    file,
    line,
    sourceLine,
				text,
				disposition,
				pinned: taskIsPinned(taskText),
			});
  }
 }
 return threads.map(thread => ({
  thread,
  summary: summarizeAttention(thread.id, nodes, tasks),
  tasks: tasks.filter(task => task.owner === thread.id).map(task => ({
   ...taskSources.get(task.key)!,
   disposition: task.disposition,
  })),
 }));
}
