import { Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import { taskScheduledLabel, type TaskData } from './task-model';
import { taskNextActionLabel, taskRepeatRuleDisplay } from './task-display';

// Scheduling stays primary; repeating schedules expose a separate next-occurrence action.
export function renderTaskSchedule(parent: HTMLElement, data: TaskData, today: string,
	onNext: () => void | Promise<void>): void {
	if (!data.scheduled) return;
	const label = taskScheduledLabel(data.scheduled, today, t('Today'));
	const overdue = data.scheduled < today && !['completed', 'cancelled'].includes(data.status);
	const title = data.repeat ? `${taskRepeatRuleDisplay(data)} · ${taskNextActionLabel(data, today)}` : t('Scheduled date');
	const schedule = parent.createSpan({ cls: `thread-journal-task-schedule${overdue ? ' is-overdue' : ''}`, attr: { title } });
	const icon = schedule.createSpan({ cls: 'thread-journal-task-chip-icon', attr: { 'aria-hidden': 'true' } });
	setIcon(icon, 'calendar-check');
	schedule.createSpan({ text: overdue ? `${label} · ${t('Overdue')}` : label });
	if (data.repeat) {
		const button = schedule.createEl('button', {
			cls: 'clickable-icon thread-journal-task-schedule-next',
			attr: { type: 'button', title, 'aria-label': title },
		});
		setIcon(button, 'arrow-right');
		button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
		button.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation();
			button.disabled = true;
			void Promise.resolve().then(onNext).catch((error: unknown) => {
				new Notice(t('Failed to move task to next: {error}', { error: String(error) }));
			}).finally(() => { if (button.isConnected) button.disabled = false; });
		});
	}
}
