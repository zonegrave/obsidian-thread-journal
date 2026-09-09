import { App, Modal, Setting, MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian';
import type { ThreadIndex } from './thread-index';
import type { ThreadStatusManager } from './thread-status';
import { THREAD_STATUS_CHOICES, isThreadStatus, threadStatusLabel } from './thread-status-model';
import { collectAttention } from './thread-attention';
import { attentionHint } from './thread-attention-model';

class OverviewContent extends MarkdownRenderChild {
 private filter = 'all';
 private request = 0;
 private timer: number | undefined;
 constructor(el: HTMLElement, private app: App, private index: ThreadIndex, private statuses: ThreadStatusManager) { super(el); }
 onload(): void {
  this.registerEvent(this.app.metadataCache.on('changed', () => this.schedule()));
  this.registerEvent(this.app.vault.on('delete', () => this.schedule()));
  this.registerEvent(this.app.vault.on('rename', () => this.schedule()));
  this.registerInterval(window.setInterval(() => this.schedule(), 60000));
  void this.render();
 }
 onunload(): void { this.request++; if (this.timer !== undefined) window.clearTimeout(this.timer); }
 private schedule(): void {
  if (this.timer !== undefined) window.clearTimeout(this.timer);
  this.timer = window.setTimeout(() => { void this.render(); }, 300);
 }
 private async render(): Promise<void> {
  const request = ++this.request;
  try {
   const rows = await collectAttention(this.app, this.index);
   if (request !== this.request) return;
   const el = this.containerEl; el.empty(); el.addClass('thread-journal-overview');
   new Setting(el).setName('Thread 总览').addDropdown(dropdown => {
    dropdown.addOption('all', '全部状态');
    for (const choice of THREAD_STATUS_CHOICES) dropdown.addOption(choice.value, choice.label);
    dropdown.setValue(this.filter).onChange(value => { this.filter = value; void this.render(); });
   }).addButton(button => button.setButtonText('刷新').onClick(() => { void this.render(); }));
   el.createEl('p', { cls: 'setting-item-description', text: '统计自身和子树。只提示，不自动切换状态。任务保存于原笔记，点击可定位。' });
   const visible = rows.filter(row => this.filter === 'all' || row.thread.status === this.filter);
   if (!visible.length) el.createEl('p', { text: '此状态暂无 thread。' });
   for (const { thread, summary, tasks } of visible) {
    const card = el.createDiv({ cls: 'thread-journal-overview-card' });
    const link = card.createEl('a', { text: thread.title, href: thread.file.path });
    link.onclick = event => { event.preventDefault(); void this.app.workspace.openLinkText(thread.file.path, '', event.metaKey || event.ctrlKey); };
    card.createSpan({ cls: 'thread-journal-meta', text: threadStatusLabel(thread.status) });
    card.createEl('p', { text: attentionHint(thread.status, summary) });
    card.createEl('p', { cls: 'setting-item-description', text: `子树未完成 ${summary.open} · 可执行 ${summary.ready} · 未来 ${summary.future} · 等待 ${summary.waiting} · 候选 ${summary.candidate} · 自定义标记 ${summary.unknown} · 暂不投入 ${summary.suspended}` });
    new Setting(card).setName('状态').addDropdown(dropdown => {
     for (const choice of THREAD_STATUS_CHOICES) dropdown.addOption(choice.value, choice.label);
     dropdown.setValue(thread.status).onChange(async value => {
      if (!isThreadStatus(value)) return;
      await this.statuses.setStatus(thread.file, value);
      this.schedule();
     });
    });
    if (tasks.length) {
     const details = card.createEl('details'); details.createEl('summary', { text: `本 thread 的 ${tasks.length} 条未完成事项` });
     for (const task of tasks) {
      const taskLink = details.createEl('p').createEl('a', { text: task.text, href: task.file.path });
      taskLink.onclick = event => {
       event.preventDefault();
       void this.app.workspace.getLeaf(false).openFile(task.file, { eState: { line: task.line } });
      };
     }
    }
   }
  } catch (error) {
   if (request === this.request) { this.containerEl.empty(); this.containerEl.createEl('p', { text: `无法读取 thread 总览：${String(error)}` }); }
  }
 }
}

export function openThreadOverview(app: App, index: ThreadIndex, statuses: ThreadStatusManager): void {
 class OverviewModal extends Modal {
  private view?: OverviewContent;
  onOpen(): void {
   this.modalEl.addClass('thread-journal-overview-modal');
   this.view = new OverviewContent(this.contentEl, app, index, statuses); this.view.load();
  }
  onClose(): void { this.view?.unload(); this.contentEl.empty(); }
 }
 new OverviewModal(app).open();
}

export function renderThreadOverview(app: App, index: ThreadIndex, statuses: ThreadStatusManager, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
 ctx.addChild(new OverviewContent(el, app, index, statuses));
}
