export type ThreadStatus = 'idea' | 'committed' | 'active' | 'dormant' | 'paused' | 'review' | 'completed' | 'closed';

export interface ThreadStatusChoice {
 value: ThreadStatus;
 label: string;
 description: string;
}

export const THREAD_STATUS_CHOICES: readonly ThreadStatusChoice[] = [
 { value: 'idea', label: '想法', description: '保留可能性，尚未承诺投入' },
 { value: 'committed', label: '已承诺', description: '已决定投入，等待开始；在 Context 中说明承诺' },
 { value: 'active', label: '持续关注', description: '已经展开，需要持续关注；子树无 todo 时复核状态' },
 { value: 'dormant', label: '休眠', description: '保持开放，按需记录；有可执行 todo 时需要处理' },
 { value: 'paused', label: '冻结', description: '明确暂停投入，保留未完成事项；不自动取消承诺' },
 { value: 'review', label: '待复盘', description: '等待复盘、知识整理或收尾' },
 { value: 'completed', label: '已完成', description: '目标达成且收尾完成' },
 { value: 'closed', label: '已结束', description: '决定不再延续，保留历史' },
];

export function isThreadStatus(value: string): value is ThreadStatus {
 return THREAD_STATUS_CHOICES.some(choice => choice.value === value);
}

export function threadStatusLabel(value: string): string {
 return THREAD_STATUS_CHOICES.find(choice => choice.value === value)?.label || value || '未设状态';
}

export function threadStatusOptionLabel(choice: ThreadStatusChoice): string {
 return `${choice.value} — ${choice.label}`;
}
