export type ThreadStatus = 'active' | 'paused' | 'review' | 'completed' | 'closed';

export interface ThreadStatusChoice {
	value: ThreadStatus;
	label: string;
	description: string;
}

export const THREAD_STATUS_CHOICES: readonly ThreadStatusChoice[] = [
	{ value: 'active', label: '行动中', description: '当前正在推进' },
	{ value: 'paused', label: '暂时封存', description: '暂时停止，之后可能恢复' },
	{ value: 'review', label: '待复盘', description: '行动基本结束，等待复盘与知识整理' },
	{ value: 'completed', label: '已完成', description: '目标达成且收尾完成' },
	{ value: 'closed', label: '已终止', description: '未完成目标，但已决定结束' },
];

export function threadStatusLabel(value: string): string {
	return THREAD_STATUS_CHOICES.find((choice) => choice.value === value)?.label || value || '未设状态';
}
