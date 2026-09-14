import { App, TFile, moment } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import { summarizeAttention, todoDisposition, type AttentionTask, type AttentionNode, type AttentionSummary, type TodoDisposition } from './thread-attention-model';
import type { ThreadInfo } from './types';

export interface AttentionRow {
 thread: ThreadInfo;
 summary: AttentionSummary;
 tasks: { file: TFile; line: number; text: string; disposition: TodoDisposition }[];
}

export async function collectAttention(app: App, index: ThreadIndex): Promise<AttentionRow[]> {
 const threads = index.getAllThreads();
 const nodes: AttentionNode[] = threads.map(thread => ({
  id: thread.id, status: thread.status,
  parent: index.getParentFile(thread.file) ? index.getThread(index.getParentFile(thread.file)!)?.id : undefined,
 }));
 const tasks: AttentionTask[] = [];
 const taskSources = new Map<string, { file: TFile; line: number; text: string }>();
 const today = moment().format('YYYY-MM-DD');
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
   const text = (lines[line] ?? '').replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s*/, '');
   const disposition = todoDisposition(item.task ?? '', text, today);
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
   if (owners.size) taskSources.set(key, { file, line, text });
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
