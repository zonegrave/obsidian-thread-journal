# Thread Journal

Thread Journal 是一个本地优先的 Obsidian 插件。它把持续推进的工作组织成 thread pack：一份只负责身份与生命周期的 meta，加上任意数量、任意角色的工作文件；log 与 commit 可以写在任何成员文件中，再按 thread、日期和类型统一查询。

> 插件仍处于探索阶段。当前实现只维护一套数据模型；schema 变化时一次性迁移现有笔记，不在运行时保留旧格式兼容分支。

## 为什么需要 Thread Journal

一项持续推进的工作，通常既不是一个可以直接勾掉的待办，也不是一篇适合从头写到尾的线性笔记。只用普通笔记跟进较长的项目时，常见问题包括：

- 项目越长，过程内容越容易淹没当前主线和重要信息。
- 拆成许多普通笔记后，文件之间缺少稳定归属，切换和重新建立上下文的成本变高。
- 留在一篇长笔记中，又需要反复上下翻动寻找目标、资料、结论和下一步。
- 工作刚启动时通常只想先写下来；提前设计 Context、Workspace 和目录结构反而增加启动成本。

任务清单擅长回答“要做什么”，日记擅长保存“今天发生了什么”，但它们都不直接表达“一组共享身份、持续演化的工作切片”。Thread Journal 解决的就是这层组织问题。

## Thread 的模型

Thread 表示一条可以暂停、恢复、分叉并最终结束的工作脉络。在插件中，一个 thread 是由 `thread_id` 绑定的文件 pack：

```text
thread meta（唯一）
  ├─ entry → 当前默认入口文件
  ├─ workspace · active（默认角色）
  ├─ context · active（可选角色）
  ├─ research · terminated（已结束但保留）
  └─ 任意其他成员文件
```

这个模型有三个关键点：

1. **Meta 只管理 thread 本身。** 稳定身份、显示名称、状态、父子关系、唯一入口和 commit 字段模板只存一份。
2. **成员文件负责工作内容。** 任意 Markdown 只要带有同一个 `thread_id`，就自动属于该 thread；它可以自由记录，也可以通过 `thread_role` 表达用途。
3. **角色由模板定义。** `workspace` 和 `context` 不再是插件写死的两种文件。新 thread 只需先创建一个入口文件；需要稳定 Context、研究稿或子任务切片时，再从相应模板扩展。

`entry` 是用户进入 thread 时的默认落点，不代表它比其他成员更重要。它可以随时改为 pack 中的另一个文件，但一个 thread 同时只有一个入口。

## 推荐使用方式

1. 一条独立工作线自然形成后，再运行 **Create thread**；不要为了使用工具而提前拆 thread。
2. 新 thread 创建时选择 `active` 或 `dormant`，并从模板创建入口文件；默认 `workspace` 模板几乎为空，可以立刻开始自由工作。想法与承诺阶段由 Task 的 `idea` 和 `committed` 状态承接。
3. 内容变长或出现稳定分工后，运行 **Create thread file**，从 `context`、`research` 等自定义角色模板扩展 pack。
4. 用 **Manage thread** 维护显示名称、状态、父节点和默认入口；用 **Manage thread files** 在 pack 内切换并管理成员。
5. 随手进展用 inline log；值得保留的结果、判断或方向用 commit 主动固化。
6. 在入口、日记或 MOC 中使用 `thread-entries` 汇总所需视角。

## 文件与身份

### Thread meta

每个 thread 只有一个 meta 文件。普通 thread 以 UUID 作为文件名，默认放在 `50-行动系统/Thread Meta/`：

```yaml
---
type: thread
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
aliases: [睡眠管理]
tags: [线程]
status: active
parent: "[[父线程的 meta 文件|健康管理]]"
entry: "[[睡眠管理|睡眠管理]]"
created: 2026-09-13
---
```

- `thread_id` 是稳定身份。
- `aliases[0]` 是 thread 显示名称；meta 不使用 `title`。
- `parent` 指向可选的单一父 thread meta。
- `entry` 指向同一 `thread_id` 下的唯一入口成员。
- `commit_fields` 可保存当前 thread 独立的 commit 模板。
- Meta 不保存成员列表；成员通过自己的 `thread_id` 自动归属。

在 meta 或任意成员中运行 **Manage thread**，可以在一个界面中查看 Thread ID 与 meta 路径，并修改 `aliases[0]`、`status`、`parent` 和 `entry`。同一界面也提供 commit 模板与成员管理入口；修改显示名称不会重命名文件。

系统根节点是唯一例外：meta 固定为配置的 meta 目录下的 `ROOT.md`，身份固定为 `thread_id: ROOT`，显示名称为 ROOT，始终 active 且没有 parent。插件首次加载时创建缺失的 ROOT，不预建成员或 entry。**Open ROOT thread** 打开其入口（没有入口时打开 meta）；**Create ROOT thread file** 可从任意位置向 ROOT 添加随笔、零散记录等成员，首个 active 成员自动成为 entry。成员通过 `thread_id: ROOT` 归属，文件、log、commit、模板和查询沿用现有机制；管理表单锁定 ROOT 的名称、状态与父节点。已有顶层 thread 继续保持 parent 为空，无需改挂 ROOT。

Overview 中 ROOT 是系统中心节点，替代原来的 Threads 占位节点；它始终显示且不计入普通状态筛选计数，展开可见直属 Thread Files。已有顶层 thread 与显式以 ROOT 为 parent 的 thread 在图上从 ROOT 连出，不增加重复 ROOT 节点。Breadcrumb 同样以 ROOT 为统一起点，顶层切换菜单不把 ROOT 当作普通 thread 选项。以上层级是展示和导航关系，不改写已有 parent，也不改变任务与记录的实际归属。

### Thread 成员

成员可以位于 vault 的任何位置。通过插件新建的成员默认放在 `50-行动系统/Thread Files/`：

```yaml
---
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
thread_role: research
thread_icon: search
thread_role_status: active
attention_fallback: false
created: 2026-09-13
---
```

- `thread_role` 是任意字符串；省略时按 `workspace` 显示。
- `thread_icon` 是 Obsidian/Lucide 图标 ID，可在 **Manage thread files** 中为每个成员选择。
- `thread_role_status` 只有 `active` 和 `terminated`；省略时视为 `active`。终止只结束这个工作切片，不删除文件或整个 thread。
- `attention_fallback: true` 表示 active thread 中的 active 成员在自身没有未完成任务时，仍作为可继续工作的文件入口参与任务注意力收集（不影响 Thread Overview 文件列表）。省略、设为 `false`，或 thread 处于 dormant 等其他状态时不产生兜底项。
- 成员可以保留模板自己的普通 `type`，但不能使用 `type: thread`，因为只有 meta 是 thread 身份来源。
- 文件名、路径和正文结构不参与身份判断，改名或移动后仍由 `thread_id` 归属。
- Log 和 commit 可以分布在任意成员中；terminated 成员的历史记录仍会被查询。任务总览只统计 meta 与 active 成员，避免已经结束的工作切片留下陈旧任务。

## 角色模板

设置中的 **Thread 角色模板目录** 默认是 `Templates/Thread Roles/`。其中每个 Markdown 文件都会成为新建 thread 或成员文件时的可选模板；frontmatter 中的 `thread_role` 定义它的角色：

```markdown
---
thread_role: context
thread_icon: book-open
thread_role_status: active
---

# 项目概况

## 目标与边界

## 重要参考

## 当前结论与下一步
```

默认模板为 `Templates/Thread Roles/Workspace.md`，内容仅有：

```yaml
---
thread_role: workspace
thread_role_status: active
attention_fallback: true
---
```

模板支持这些占位符：

- `{{title}}`、`{{thread_title}}`
- `{{filename}}`
- `{{thread_id}}`、`{{thread_role}}`、`{{thread_role_status}}`
- `{{status}}`
- `{{parent}}`、`{{parent_title}}`
- `{{created}}`、`{{date}}`、`{{date:YYMMDD}}` 等日期格式

创建成员后，插件会强制写入正确的 `thread_id`、`thread_role`、`thread_icon`、`thread_role_status: active` 和 `created`，并移除模板中的 thread 级字段，例如 `status`、`parent`、`entry` 与 `commit_fields`。

## Pack 内导航

每个 meta 和成员文件都会显示固定 Breadcrumb：

- 最左侧线程树图标打开 **Open thread overview**；其后的 breadcrumb 展示 thread 层级，根节点、祖先和子 thread 都打开各自的入口文件。当前 thread 的状态显示在右侧操作区，点击会打开 **Manage thread**。
- 右侧保留紧凑的文件图标与 active 成员数量。展开后只显示“自定义图标 + 文件名”，Entry 排在最前并带有简洁的首页标记；也可从菜单新建成员或进入 **Manage thread files**。
- **Manage thread files** 保留完整的管理职责，可设置入口、终止非入口成员或重新激活成员；terminated 成员不会出现在日常文件选择器中。
- thread 树和层级菜单固定只显示 `active` 与 `dormant` thread。

目标文件已经打开时，插件直接聚焦已有标签；否则创建普通标签。插件不绑定、移动或自动关闭分栏，也不依赖 Vertical Tabs 等布局插件。

## Log

**Insert inline log** 可在任意 active thread 成员的编辑视图中使用。它在光标处插入一个可查询 callout：

```markdown
> [!thread-log]
> - (thread_log:: 2026-09-13T14:35:27) 完成了第一轮接口验证 ^log-20260913-143527-a1b2c
> 还有一项需要继续调研。
```

- 正文是自由的多行 Markdown，可以使用双链、列表等；查询会保留整个正文。
- 完整时间戳只存于 `thread_log` 字段，用于筛选和排序；渲染时生成紧凑时间，隐藏原始字段。
- 块 ID 与时间放在同一行，光标落在两者之间，便于直接输入；查询卡片据此定位原始记录行。
- Log 命令会立即在执行命令时的光标位置插入 callout，随后直接在原文件中编辑，不提供单独表单或 Save 按钮。

## Commit

**Create commit** 可从 meta 或 active 成员运行：

- 从成员的编辑视图运行时，记录在点击 **Save commit** 时按该文件的实时光标位置插入；填表期间可以移动光标。目标文件在保存前需保持打开。
- 从 meta 运行时，记录追加到当前入口末尾。
- 日期、时间、标记和稳定块 ID 由插件生成。
- 默认字段是必填的“摘要”和可选的“人力消耗”；消耗使用 `quick`、`light`、`normal`、`deep` 四档。

Task 在阅读视图、Live Preview、Task Reference 和 Task Board 中都提供 commit 图标。由 Task 打开时，表单会用任务内容预填摘要并继承 effort；取消或保存失败不会改变任务。Commit 保存成功后，普通任务才会标记完成，循环任务才会推进到下一期。在原 thread 成员的编辑视图触发时，Commit 仍按保存时的实时光标插入；从其他视图触发时，Commit 默认插在原任务完整块之后。若任务保存在 thread 外部，Commit 会写入所属 thread 的 entry，避免把 thread 原始记录散落到外部笔记。

```markdown
> [!thread-commit]
> - [commit:: true] [commit_date:: 2026-09-13] [commit_time:: 15:20] [commit_summary:: 完成 pack 模型] [effort:: light] ^cm-20260913-152000-a1b2c
```

日期和时间只保存在结构化字段中，卡片标题由字段生成。创建和编辑默认使用右侧非模态表单，可以继续对照主笔记；`Cmd/Ctrl + Enter` 保存。原地卡片提供编辑，查询卡片提供定位、编辑和删除。摘要和文本字段支持 Markdown 与双链。

`effort` 在原地 callout 与查询卡片中渲染为和 Task 一致的 gauge 图标，以绿、黄、红、紫分别表示 `quick`、`light`、`normal`、`deep`；悬浮时显示对应文字，不重复展示原始字段值。

每个 thread 可以把独立字段模板保存在 meta 的 `commit_fields`；没有时继承全局默认。字段支持单行、多行、数字、开关、日期、选择项、必填、正文/inline 保存和废弃。废弃字段不再出现在新表单中，但仍用于解释历史记录。

多行字段使用 `inline` storage 时，换行会在原始 inline property 中无损编码为 `&#10;`，插件在编辑和渲染时恢复为真实换行；使用 `body` storage 时则直接保存为 commit callout 中的多行 Markdown。

## `thread-entries` 查询

查询会扫描匹配 thread 的全部成员文件：

````markdown
```thread-entries
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
date: 2026-09-01..2026-09-13
type: [commit, log]
group_by: thread
thread_detail: crumb
order: asc
```
````

| 字段 | 可用值 | 默认值 |
| --- | --- | --- |
| `thread_id` | 单个 UUID、`ROOT`，或身份列表 | 全部 thread |
| `date` | `YYYY-MM-DD` 或闭区间 | 全部日期 |
| `type` | `commit`、`log` 或列表 | 两种记录 |
| `group_by` | `none`、`thread`、`type` | `none` |
| `thread_detail` | `none`、`name`、`crumb` | `none` |
| `order` | `asc`、`desc` | `desc` |

条件之间是“并且”关系。`thread_detail: name` 显示 thread 名称链接，`crumb` 显示完整可点击层级；链接统一指向对应 thread 的入口。查询不接受 `current` 等隐式值。

日记模板示例：

````markdown
```thread-entries
date: {{date:YYYY-MM-DD}}
type: [commit, log]
group_by: thread
order: asc
```
````

## Thread 树、状态与任务

状态没有强制流转约束：

| 值 | 显示名 | 语义 |
| --- | --- | --- |
| `active` | 持续关注 | 已经展开，需要主动维持关注 |
| `dormant` | 休眠 | 保持开放，按需投入 |
| `paused` | 冻结 | 明确暂停投入，保留现场 |
| `review` | 待复盘 | 等待复盘、知识整理或收尾 |
| `completed` | 已完成 | 目标达成且收尾完成 |
| `closed` | 已结束 | 决定不再延续，保留历史 |

只有 `active` 和 `dormant` thread 可以成为新子 thread 的父节点。父节点之后改变状态不会破坏已有层级。

**Open thread overview** 打开常驻 Overview tab；`thread-overview` 代码块嵌入同一视图。Overview 只负责 thread 层级、状态和所属 Thread Files，不扫描或展示具体任务，也不提供任务范围、今日关注或 Holding queue 控件。Status 默认选择 `active` 与 `dormant`，支持八种状态，必要祖先以淡色结构节点保留。节点标题打开 entry，无 entry 时打开 meta；展开节点显示全部成员文件的名称、图标、角色、入口标记，terminated 文件淡化并标注，仍可打开查看历史。文件列表不受任务内容或 attention_fallback 影响。节点上的文件菜单提供 active 成员快捷入口。**Expand all files / Collapse files** 控制文件列表，节点右侧按钮独立控制子分支。独立视图保留缩放、适应视图、滚动与视角恢复功能；底部工具栏保留状态筛选、文件展开、缩放与刷新。

**Open thread overview table** 打开独立的紧凑树形表格，保留原来的思维导图视图。每行对应一个 thread，通过缩进、折线和箭头展示并折叠父子关系。树形连接线加粗并按父节点使用固定分支色，展开按钮呼应其下级连接线颜色，筛选或折叠不改变配色。默认显示状态、Thread Files、直接子线程数量、Open／Committed／Idea／Completed／Cancelled，以及 Holding／Scheduled today／Pinned、Commit 和 Log 数量。各数量前显示语义图标，非零数量用彩色图标与浅底色强调，零值淡化，行高保持紧凑。每行只统计自身的 meta、成员文件与明确链接到自身的外部任务，不累计子线程；成员数量和历史统计包含 terminated 成员；基础状态与记录数量不受 Task Board 的日期筛选影响，Scheduled today 和 Pinned 则分别统计当前需要关注的已排期及未排期任务。Holding 可与任务状态重叠；Scheduled today 统计今天及此前未完成的已排期任务，Pinned 只统计未排期且状态为 Open 的关注任务，两者互斥；任务引用不重复统计。ROOT 的子线程数按树上直属分支计算。表头和线程列固定，底栏可选择显示列、全部展开／收起；列选择与折叠状态随视图保存。点击文件数在表格内展开／收起成员文件，各文件沿用相同的统计列；文件图标打开原文件，文件名或行空白处选中该文件。点击子线程数独立展开／收起 thread 分支。点击 thread／文件的行空白处或任务数量，会打开右侧任务明细；数量按所点的状态或标记筛选，thread 范围仍只包括自身。明细按来源分组并标注外部任务，沿用 Task Board 的编辑、固定、循环推进与生成 Commit 操作；terminated 成员的任务只供查看。全部任务默认隐藏完成／取消，可切换显示；直接点击 Completed／Cancelled 或其他分类数量时包含该分类的全部任务。侧栏可关闭，窄分栏内以浮层显示，表格列保持对齐；文件展开状态随视图保存。

筛选控件集成在表头旁：Thread 名称旁搜索 Thread／文件名，Status 只显示和筛选 Thread 状态；Thread Files 表头可多选 Active／Terminated，同步限制文件数量与展开列表，文件行的状态显示在 Thread Files 列，Status 留空。文件状态筛选不排除没有匹配文件的 Thread，不改变任务、Commit、Log 统计；文件名搜索只匹配当前允许状态的文件。各 Task 状态及 Holding、Pinned、Scheduled today 列旁独立放置“有”的开关：开启后仅保留该列自身数量大于 0 的 Thread，关闭即不限；多个开启条件取交集，不累计子线程，不提供“无”或数量范围。底栏 breadcrumb 切换 Root 范围，默认 ROOT；点击祖先回到该级子树，点击各级箭头选择直接子 Thread，切换范围保留内容筛选。名称匹配文件时保留所属 Thread 并展开匹配文件；匹配 Thread 名时保留它的全部成员文件，统计仍按该 Thread 的自身内容计算。必要祖先只作淡色导航，不显示内容数量、不参与总计；搜索和条件筛选临时展开匹配路径，清除后恢复原折叠状态。筛选随视图保存，不另占顶栏。表头和总计独立固定在可视区域上下两端，中间数据纵向滚动；三部分共用列宽并同步横向滚动，数据少时总计也贴底。总计行仅汇总各类 Tasks、Commit、Log，Status、Thread Files、Child Threads 留空；总计只覆盖实际匹配的 Thread，不受折叠影响，跨 Thread 链接的同一原任务按来源文件和行号去重。点击任务总计可在侧栏查看筛选范围内去重后的明细，并标明所属 Thread；Commit／Log 保持纯统计。

Active 成员的编辑视图提供统一的 **Create or edit task**。光标在 task 行时直接编辑；在普通文本行时先将该行原地转换为 Markdown task，再打开编辑表单；空行则打开空白新建表单。任务内容本身表达要达成的结果；表单保存只读的 `task_id`、任务状态、独立 holding 条件、可选固定、可选的日期窗口、`quick`/`light`/`normal`/`deep` 模糊消耗，以及可选循环。日期窗口通过独立浮层编辑，不改变任务表单尺寸；浮层并排展示两个日历，左侧选择开始、右侧选择结束，各自可翻月，也可清除单侧或整体清空；主表单不再重复提供 Clear 按钮。`task_id` 在创建时自动生成，用于任务移动行号后继续准确定位；表单顶部以小号只读文字展示，左侧 Pin 图标可直接切换固定状态，阅读视图、Live Preview 摘要和 Task Board 不显示 ID。表单中预计消耗、状态与 Window 位于选择区域；Schedule 单独占下一行，开启后默认安排到今天，并显示执行日及可选 Repeat；Repeat 开启后选择每 N 天／周／月／年，N 为大于等于 1 的整数。关闭 Schedule 同时清除执行日和循环。Pin 用于未排期但需当前关注的任务，与 Schedule 互斥；设置执行日时取消 Pin，清除执行日不会自动 Pin。Window 是可安排边界，Schedule 是已经确定的安排，二者独立。

Task Board 的当前关注列分成上下两个板块：**Pinned tasks** 只收纳未排期且状态为 Open 的主动关注项，**Scheduled today** 收纳单次或循环的今日及之前未完成排期。未来排期不显示，也不进入 Open／Committed／Idea 调度列；未排期、未 Pin 的任务按状态进入调度列，继续遵守窗口开始日期筛选。Pin 项不受未来窗口阻止展示。Holding 仍是独立约束，保留各列的到期确认与挂起分组。

可选的 `[scheduled:: YYYY-MM-DD]` 保存执行日，既支持单次任务，也作为循环任务本轮的执行日期；规则使用精简的 RRULE 风格字符串保存，支持每 N 天、周、月、年；用 `INTERVAL` 保存间隔，年周期另保存 `BYMONTH`，月／年周期用 `BYMONTHDAY` 保留日期。短月或平年闰日落在目标月份最后一天，并保留原始日期供后续周期恢复。执行日使用与 Window 一致的独立日历浮层选择；通过关闭 Schedule 取消排期。Live Preview、阅读视图和 Task Board 会隐藏原始 inline fields，并使用一致的紧凑摘要：开始日期尚未到时显示灰色“未开始”；开始后若没有结束日期则不显示窗口；截止日在 30 天内显示剩余天数，超过 30 天显示 `30d+`，今天截止与逾期分别提示；预计消耗只显示绿、黄、红、紫 gauge 图标；所有已排期任务显示执行日，当天显示“今天”、同年省略年份，未完成且早于今天时标记逾期；循环任务在执行日右侧显示独立的 → 按钮，悬浮显示规则和下一日期，不再单独分组。笔记内的任务摘要在内容前显示 Pin 控件；已排期时禁用，未排期时可直接切换。进入 Live Preview 当前行时恢复源码以便编辑。铅笔图标可直接调整窗口，**To next** 会在同一行推进 `scheduled`；若推进后仍早于今天，则继续跳过过期 occurrence，直到落在今天或未来，再按最终跨越的总天数移动已有窗口，并把 checkbox 恢复为未完成。循环不会生成新的任务行，执行记录仍由 commit 保存。

```markdown
- [ ] 整理本周任务模型 [task_id:: task-4f8a0d92c3e1] [window_start:: 2026-09-18] [window_end:: 2026-09-20] [effort:: normal]
- [ ] 填写训练恢复 commit [task_id:: task-238e1b07d6af] [window_end:: 2026-09-18] [effort:: quick] [scheduled:: 2026-09-18] [repeat:: FREQ=DAILY]
- [ ] 完成月末复盘 [task_id:: task-c9d03f6812ab] [scheduled:: 2026-09-30] [repeat:: FREQ=MONTHLY;BYMONTHDAY=30]
```

任意 Markdown 笔记可以通过 `task-reference` 代码块嵌入已有任务。引用使用独立字段 `reference_task_id`，不会与原任务的 `task_id` 混淆：

````markdown
```task-reference
reference_task_id: task-4f8a0d92c3e1
```
````

也可把代码块内容写成 `[reference_task_id:: task-4f8a0d92c3e1]`。引用卡片显示原任务内容、时间状态、预计消耗和执行日，并可直接创建 commit、切换完成状态、固定、推进循环、编辑或打开原任务。所有操作写回原任务，引用处不复制任务数据；找不到 ID 或发现重复 ID 时显示明确错误，不对不确定目标执行操作。

`thread-children` 代码块动态显示直接子 thread，并链接到各自入口：

````markdown
```thread-children
```
````

## 命令

界面语言默认为 **Auto**，跟随 Obsidian；也可在设置中固定为中文或 English。下表使用英文命令名，切换到中文后命令面板会显示对应中文名称。命令 ID、YAML 字段、状态值和代码块名称不会随语言变化。

| 命令 | 可用位置 | 作用 |
| --- | --- | --- |
| **Create thread** | 任意位置 | 以 active 或 dormant 状态创建 meta，并选择模板创建入口 |
| **Create thread file** | meta 或成员 | 从角色模板向当前 pack 添加成员 |
| **Open ROOT thread** | 任意位置 | 打开 ROOT 的入口，无入口时打开 ROOT meta |
| **Create ROOT thread file** | 任意位置 | 从角色模板向 ROOT 添加成员 |
| **Manage thread** | meta 或成员 | 查看 Thread ID 与 meta 路径；修改显示名称、状态、父节点和入口；进入 commit 模板与成员管理 |
| **Edit commit template** | meta 或成员 | 直接编辑当前 thread 的 commit 字段模板 |
| **Manage thread files** | meta 或成员 | 打开成员、设置入口、终止或重新激活成员 |
| **Switch active thread role** | meta 或成员 | 在当前 pack 的 active 成员间循环切换；从 meta 或 terminated 成员进入入口 |
| **Open thread overview** | 任意位置 | 打开可筛选、可展开的 thread 思维导图，查看 thread 状态、层级与所属文件 |
| **Open thread overview table** | 任意位置 | 打开可折叠树形表格，查看自身文件、子线程及各类任务、Commit、Log 数量 |
| **Create or edit task** | active 成员编辑视图 | 编辑光标所在 task；普通文本行原地转为 task 后编辑；空行创建新 task |
| **Insert inline log** | active 成员编辑视图 | 在光标处插入 log |
| **Create commit** | meta 或成员 | 打开 commit 侧栏表单 |

## 设置

- **Language**：`Auto` 跟随 Obsidian，也可固定为中文或 English；新打开的界面立即使用新语言，命令名称在重新加载插件后更新。
- **Thread meta 目录**：新建 UUID meta 的位置。
- **Thread 文件目录**：通过插件创建成员文件的位置。
- **Thread 角色模板目录**：可用于新建入口和成员的模板集合。
- **默认入口模板**：新建 thread 时默认选择的角色模板。
- **Breadcrumb 位置**：控制固定工具条显示在正文上方或下方。
- **默认 commit 模板**：未设置独立模板的 thread 所继承的字段。

## 开发与本地安装

```bash
npm ci
npm test
npm run build
npm run lint
```

构建后，将 `main.js`、`manifest.json` 和 `styles.css` 复制到：

```text
<Vault>/.obsidian/plugins/thread-journal/
```

然后在 **设置 → 第三方插件** 中启用 Thread Journal。插件不联网、不收集遥测，也不依赖 Node.js 或 Electron API。

### Task 状态与 Holding（0.48.0 开发分支）

Task 状态由 Markdown marker 保存：`[!] idea` → `[+] committed` → `[ ] open` → `[x] completed`；`[-] cancelled` 保留取消语义。Idea 与 Committed 直接使用 Obsidian 原生 marker 图标，不覆盖 checkbox 渲染。状态可以人工直接选择，填写日期不会自动升级状态。Open 表示当前执行池，而非“此刻正在做”。任务筛选由独立 Task Board 承担。

Holding 与状态独立。创建/编辑表单开启 **Holding** 后，任务退出原状态队列及固定区，进入 **Holding queue**（命令面板）。待确认队列按确认日期排序，显示原状态、依赖和异常；到期显示 **Review due**，不会自动释放或发送系统通知。

- **Next review**：可选日期，仅用于提醒人工检查；可改期或 **Release holding**。
- **Holding for**：搜索并选择已有 `task_id` 的任务；没有 ID 的普通 checkbox 先通过 Create or edit task 保存一次。所有依赖完成才自动释放，确认日期不阻止依赖自动释放。
- 未选依赖时由人工解除；手动解除始终可用，并清除本次 holding 条件，任务返回原状态队列。
- 自依赖、循环依赖和重复 ID 不可作为有效依赖。依赖丢失、ID 重复或任务取消时保持挂起并提示人工处理，不视为完成。
- 循环依赖绑定选中时的具体日期：`task-id@YYYY-MM-DD`。完成记录保存于 `completed_occurrences`；仅点击 To next 跳过尚未完成的周期不会满足依赖。Task Commit 完成、直接标记完成，以及插件启动/外部笔记修改后的检查都会保留完成证据。
- 自动释放会写回原任务，且不会在依赖以后重新打开时自动再次挂起。插件关闭时停止检查。

```md
- [+] 整理结论 [task_id:: task-aaaaaaaaaaaa] [holding:: true] [holding_review:: 2026-10-01] [holding_for:: task-bbbbbbbbbbbb, task-cccccccccccc@2026-09-23]
```

本次开发基于 GitHub main 0.46.1 的独立分支 `codex/task-state-holding`。一次性迁移把原 `[i] idea` 改为 `[!] idea`，原 `[?] maybe` 与 `[:] committed` 改为 `[+] committed`；原 `[>] waiting` 改为 `[ ] open` 加 `[holding:: true]`，在待确认队列人工复核原本无法恢复的状态。

`scripts/migrate-task-states.ts` 只接受标准输入中的笔记内容、向标准输出生成迁移结果，并向标准错误输出变更行号；不读写 Vault。代码块和 YAML 示例不迁移，正文、任务 ID、其他字段和锚点保留。可用 esbuild 打包后处理经 Obsidian CLI 导出的笔记，再经 CLI/MCP 写回。迁移器不打包进插件，运行时不保留旧状态兼容分支。
