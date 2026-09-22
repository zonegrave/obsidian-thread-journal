# Thread Journal

Thread Journal 是一个本地优先的 Obsidian 插件。它把持续推进的工作组织成 thread pack：一份只负责身份与生命周期的 meta，加上任意数量、任意角色的工作文件；log 与 checkpoint 可以写在任何成员文件中，再按 thread、日期和类型统一查询。

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

1. **Meta 只管理 thread 本身。** 稳定身份、显示名称、状态、父子关系、唯一入口和 checkpoint 字段模板只存一份。
2. **成员文件负责工作内容。** 任意 Markdown 只要带有同一个 `thread_id`，就自动属于该 thread；它可以自由记录，也可以通过 `thread_role` 表达用途。
3. **角色由模板定义。** `workspace` 和 `context` 不再是插件写死的两种文件。新 thread 只需先创建一个入口文件；需要稳定 Context、研究稿或子任务切片时，再从相应模板扩展。

`entry` 是用户进入 thread 时的默认落点，不代表它比其他成员更重要。它可以随时改为 pack 中的另一个文件，但一个 thread 同时只有一个入口。

## 推荐使用方式

1. 一条独立工作线自然形成后，再运行 **Create thread**；不要为了使用工具而提前拆 thread。
2. `idea` 和 `committed` 只创建 meta，不创建成员或 entry。选择其他初始状态时才选择入口模板；默认 `workspace` 模板几乎为空，可以立刻开始自由工作。
3. 内容变长或出现稳定分工后，运行 **Create thread file**，从 `context`、`research` 等自定义角色模板扩展 pack。
4. 用 **Manage thread** 维护显示名称、状态、父节点和默认入口；用 **Manage thread files** 在 pack 内切换并管理成员。
5. 随手进展用 inline log；阶段节点、方向变化和复盘结果用 checkpoint。
6. 在入口、日记或 MOC 中使用 `thread-entries` 汇总所需视角。

## 文件与身份

### Thread meta

每个 thread 只有一个 meta 文件。插件以 UUID 作为文件名，默认放在 `50-行动系统/Thread Meta/`：

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
- `checkpoint_fields` 可保存当前 thread 独立的 checkpoint 模板。
- Meta 不保存成员列表；成员通过自己的 `thread_id` 自动归属。

在 meta 或任意成员中运行 **Manage thread**，可以在一个界面中查看 Thread ID 与 meta 路径，并修改 `aliases[0]`、`status`、`parent` 和 `entry`。同一界面也提供 checkpoint 模板与成员管理入口；修改显示名称不会重命名文件。

### Thread 成员

成员可以位于 vault 的任何位置。通过插件新建的成员默认放在 `50-行动系统/Thread Files/`：

```yaml
---
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
thread_role: research
thread_role_status: active
attention_fallback: false
created: 2026-09-13
---
```

- `thread_role` 是任意字符串；省略时按 `workspace` 显示。
- `thread_role_status` 只有 `active` 和 `terminated`；省略时视为 `active`。终止只结束这个工作切片，不删除文件或整个 thread。
- `attention_fallback: true` 表示 active thread 中的 active 成员在自身没有未完成任务时，仍作为可继续工作的文件入口出现在 Thread Overview。省略、设为 `false`，或 thread 处于 dormant 等其他状态时不产生兜底项。
- 成员可以保留模板自己的普通 `type`，但不能使用 `type: thread`，因为只有 meta 是 thread 身份来源。
- 文件名、路径和正文结构不参与身份判断，改名或移动后仍由 `thread_id` 归属。
- Log 和 checkpoint 可以分布在任意成员中；terminated 成员的历史记录仍会被查询。任务总览只统计 meta 与 active 成员，避免已经结束的工作切片留下陈旧任务。

## 角色模板

设置中的 **Thread 角色模板目录** 默认是 `Templates/Thread Roles/`。其中每个 Markdown 文件都会成为新建 thread 或成员文件时的可选模板；frontmatter 中的 `thread_role` 定义它的角色：

```markdown
---
thread_role: context
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

创建成员后，插件会强制写入正确的 `thread_id`、`thread_role`、`thread_role_status: active` 和 `created`，并移除模板中的 thread 级字段，例如 `status`、`parent`、`entry` 与 `checkpoint_fields`。

## Pack 内导航

每个 meta 和成员文件都会显示固定 Breadcrumb：

- 最左侧线程树图标打开 **Open thread overview**；其后的 breadcrumb 展示 thread 层级，根节点、祖先和子 thread 都打开各自的入口文件。当前 thread 的状态显示在右侧操作区，点击会打开 **Manage thread**。
- 入口以外的成员会出现首页按钮，可一键返回当前 thread 的入口。
- 文件按钮显示成员数量，并打开 **Manage thread files**；选择成员可跳转，也可设置入口、终止非入口成员或重新激活成员。terminated 成员排在底部且不能成为入口。
- 右侧分叉图标打开 **Manage open threads**。它按 `thread_id` 合并当前窗口的所有已打开标签，显示角色组成，可打开入口、管理文件或关闭该 thread 的全部标签。
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

## Checkpoint

**Create checkpoint** 可从 meta 或 active 成员运行：

- 从成员的编辑视图运行时，记录在点击 **Save checkpoint** 时按该文件的实时光标位置插入；填表期间可以移动光标。目标文件在保存前需保持打开。
- 从 meta 运行时，记录追加到当前入口末尾。
- 日期、时间、标记和稳定块 ID 由插件生成。
- 默认字段只有“类型”和“摘要”。

```markdown
> [!thread-checkpoint]
> - [checkpoint:: true] [checkpoint_date:: 2026-09-13] [checkpoint_time:: 15:20] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成 pack 模型] ^cp-20260913-152000-a1b2c
```

日期、时间和类型只保存在结构化字段中，卡片标题由字段生成。创建和编辑默认使用右侧非模态表单，可以继续对照主笔记；`Cmd/Ctrl + Enter` 保存。原地卡片提供编辑，查询卡片提供定位、编辑和删除。摘要和文本字段支持 Markdown 与双链。

每个 thread 可以把独立字段模板保存在 meta 的 `checkpoint_fields`；没有时继承全局默认。字段支持单行、多行、数字、开关、日期、选择项、必填、正文/inline 保存和废弃。废弃字段不再出现在新表单中，但仍用于解释历史记录。

多行字段使用 `inline` storage 时，换行会在原始 inline property 中无损编码为 `&#10;`，插件在编辑和渲染时恢复为真实换行；使用 `body` storage 时则直接保存为 checkpoint callout 中的多行 Markdown。

## `thread-entries` 查询

查询会扫描匹配 thread 的全部成员文件：

````markdown
```thread-entries
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
date: 2026-09-01..2026-09-13
type: [checkpoint, log]
group_by: thread
thread_detail: crumb
order: asc
```
````

| 字段 | 可用值 | 默认值 |
| --- | --- | --- |
| `thread_id` | 单个 UUID，或 `[UUID, UUID]` | 全部 thread |
| `date` | `YYYY-MM-DD` 或闭区间 | 全部日期 |
| `type` | `checkpoint`、`log` 或列表 | 两种记录 |
| `group_by` | `none`、`thread`、`type` | `none` |
| `thread_detail` | `none`、`name`、`crumb` | `none` |
| `order` | `asc`、`desc` | `desc` |

条件之间是“并且”关系。`thread_detail: name` 显示 thread 名称链接，`crumb` 显示完整可点击层级；链接统一指向对应 thread 的入口。查询不接受 `current` 等隐式值。

日记模板示例：

````markdown
```thread-entries
date: {{date:YYYY-MM-DD}}
type: [checkpoint, log]
group_by: thread
order: asc
```
````

## Thread 树、状态与任务

状态没有强制流转约束：

| 值 | 显示名 | 语义 |
| --- | --- | --- |
| `idea` | 想法 | 保留可能性，尚未承诺投入 |
| `committed` | 已承诺 | 已决定投入，等待开始 |
| `active` | 持续关注 | 已经展开，需要主动维持关注 |
| `dormant` | 休眠 | 保持开放，按需投入 |
| `paused` | 冻结 | 明确暂停投入，保留现场 |
| `review` | 待复盘 | 等待复盘、知识整理或收尾 |
| `completed` | 已完成 | 目标达成且收尾完成 |
| `closed` | 已结束 | 决定不再延续，保留历史 |

只有 `active` 和 `dormant` thread 可以成为新子 thread 的父节点。父节点之后改变状态不会破坏已有层级。

**Open thread overview** 会打开或聚焦一个可常驻的 Overview tab；`thread-overview` 代码块仍可在笔记中嵌入同一视图。独立 Tab 的思维导图画布铺满整个视图，筛选与操作控件悬浮在右上角；画布四周保留足够空白，让边缘内容也能滚动到视图中央，并提供放大、缩小和适应视图控件。Mac 触控板可在画布上双指捏合缩放，缩放中心保持在手势位置；普通双指滚动仍用于平移，切换标签回来会保留地图视角。嵌入笔记时仍按文档宽度展示。视图把 thread 层级渲染成横向思维导图：从虚拟 Threads 根节点向右分叉，以曲线连接父子节点，画布可横纵滚动。紧凑的 Status 菜单默认选择 `active` 与 `dormant`，展开后可任意勾选八种状态；筛选结果所依赖的未选中祖先会作为淡色结构节点保留，避免层级断裂。View 可在“全部 thread”和“今日关注”之间切换；“今日关注”只保留今天有 ready task 或 active fallback 的 thread，并以淡色节点保留必要祖先。Tasks 可独立在“今日活跃”和“全部未完成”之间切换；“今日活跃”只保留尚未完成、未等待、未列为候选且没有被未来开始或计划日期推迟的任务。Overview 的任务摘要只展示决策信息：开始日期尚未到时显示灰色“未开始”；开始后若没有结束日期则隐藏窗口；截止日在 30 天内显示剩余天数，超过 30 天显示弱化的 `30d+`，逾期显示逾期天数；循环只显示 current，当天显示“今天”、同年省略年份，周期规则收进悬浮提示，只有循环图标可点击并直接推进到下一期，旁边的 current 文字仅用于显示；预计消耗以绿、黄、红、紫的 gauge 图标表示 quick、light、normal、deep。仅当 thread 状态为 `active` 时，带有 `attention_fallback: true` 的 active 成员才可能作为文件入口与任务并列显示；它自身存在任何未完成任务时都不生成入口，Today 筛掉未来任务也不会造成误判。dormant 和其他状态不显示兜底入口。任务标题最前方的 pin 按钮会在原任务写入 `[thread_pin:: true]`，并把它汇总到 Overview 左侧的固定任务区；再次点击即可取消，任务链接仍定位原文。固定区不受状态、View 与 Tasks 筛选影响，会随任务数量增长到当前视图可用高度，超出后在区内滚动，标题栏可整体收起或展开。**Expand all items** 会展开当前筛选结果中所有包含关注项目的节点及其分支；切换到 **Collapse all items** 后会关闭当前视图中全部 thread 的详情区，包括没有任务但曾被手动展开的节点。节点右侧的 `+/−` 继续独立控制下级分支。点击单个节点会展开状态提示和该节点自己的关注项目；任务链接定位原文，文件入口直接打开对应成员。它只提示，不自动改变状态。外部笔记中的任务只有在同一行明确链接某个 meta 或成员时才归属该 thread。

Active 成员的编辑视图提供 **Create task** 与 **Edit task**。任务仍是普通 Markdown checkbox，任务内容本身表达要达成的结果；表单只保存只读的 `task_id`、可选固定、可选的日期窗口、`quick`/`light`/`normal`/`deep` 模糊消耗，以及可选循环。日期窗口通过独立浮层编辑，不改变任务表单尺寸；浮层并排展示两个日历，左侧选择开始、右侧选择结束，各自可翻月，也可清除单侧或整体清空；主表单不再重复提供 Clear 按钮。`task_id` 在创建时自动生成，用于任务移动行号后继续准确定位；表单顶部以小号只读文字展示，左侧 Pin 图标可直接切换固定状态，阅读视图、Live Preview 摘要和 Overview 不显示 ID。表单中预计消耗与 Window 位于第一行；Repeat 单独占下一行，开启后在同行展开 Frequency 与 Current，选择每 N 天时将间隔输入合并在 Frequency 控件内。Task 没有 fixed/flexible 分类：所有任务都可在窗口内安排，精确占用时段的事项由独立 Event 模型承担。

开启 Repeat 时，`current` 默认是当天，并作为当前循环期的独立指针；规则使用精简的 RRULE 风格字符串保存，第一版支持每天、每周、每月和每 N 天。Current 使用与 Window 一致的独立日历浮层选择日期，不提供 Clear，保证循环任务始终保留当前期指针。Live Preview、阅读视图和 Overview 会隐藏原始 inline fields，并使用一致的紧凑摘要：开始日期尚未到时显示灰色“未开始”；开始后若没有结束日期则不显示窗口；截止日在 30 天内显示剩余天数，超过 30 天显示 `30d+`，今天截止与逾期分别提示；预计消耗只显示绿、黄、红、紫 gauge 图标；recurring 只显示 current，当天显示“今天”、同年省略年份，周期规则放在悬浮提示中，只有前面的循环图标可点击推进，悬浮时显示实际将到达的下一日期。笔记内的任务摘要在内容前显示 Pin 控件，可直接切换固定状态。进入 Live Preview 当前行时恢复源码以便编辑。铅笔图标可直接调整窗口，**To next** 会在同一行推进 `current`；若推进后仍早于今天，则继续跳过过期 occurrence，直到落在今天或未来，再按最终跨越的总天数移动已有窗口，并把 checkbox 恢复为未完成。循环不会生成新的任务行，执行记录仍由 checkpoint 保存。

```markdown
- [ ] 整理本周任务模型 [task_id:: task-4f8a0d92c3e1] [window_start:: 2026-09-18] [window_end:: 2026-09-20] [effort:: normal]
- [ ] 填写训练恢复 checkpoint [task_id:: task-238e1b07d6af] [window_end:: 2026-09-18] [effort:: quick] [current:: 2026-09-18] [repeat:: FREQ=DAILY]
- [ ] 完成月末复盘 [task_id:: task-c9d03f6812ab] [current:: 2026-09-30] [repeat:: FREQ=MONTHLY;BYMONTHDAY=30]
```

任意 Markdown 笔记可以通过 `task-reference` 代码块嵌入已有任务。引用使用独立字段 `reference_task_id`，不会与原任务的 `task_id` 混淆：

````markdown
```task-reference
reference_task_id: task-4f8a0d92c3e1
```
````

也可把代码块内容写成 `[reference_task_id:: task-4f8a0d92c3e1]`。引用卡片显示原任务内容、时间状态、预计消耗和循环 current，并可直接切换完成状态、固定、推进循环、编辑或打开原任务。所有操作写回原任务，引用处不复制任务数据；找不到 ID 或发现重复 ID 时显示明确错误，不对不确定目标执行操作。

`thread-children` 代码块动态显示直接子 thread，并链接到各自入口：

````markdown
```thread-children
```
````

## 命令

界面语言默认为 **Auto**，跟随 Obsidian；也可在设置中固定为中文或 English。下表使用英文命令名，切换到中文后命令面板会显示对应中文名称。命令 ID、YAML 字段、状态值和代码块名称不会随语言变化。

| 命令 | 可用位置 | 作用 |
| --- | --- | --- |
| **Create thread** | 任意位置 | 创建 meta；非 idea/committed 状态同时选择模板并创建入口 |
| **Create thread file** | meta 或成员 | 从角色模板向当前 pack 添加成员 |
| **Manage thread** | meta 或成员 | 查看 Thread ID 与 meta 路径；修改显示名称、状态、父节点和入口；进入 checkpoint 模板与成员管理 |
| **Edit checkpoint template** | meta 或成员 | 直接编辑当前 thread 的 checkpoint 字段模板 |
| **Manage thread files** | meta 或成员 | 打开成员、设置入口、终止或重新激活成员 |
| **Switch active thread role** | meta 或成员 | 在当前 pack 的 active 成员间循环切换；从 meta 或 terminated 成员进入入口 |
| **Manage open threads** | 任意位置 | 按 thread 管理当前窗口里的标签 |
| **Open thread overview** | 任意位置 | 打开可筛选、可展开的 thread 思维导图，查看直属 tasks，并定位原任务 |
| **Create task** | active 成员编辑视图 | 在光标位置通过统一表单创建 Markdown task |
| **Edit task** | active 成员的 task 行 | 编辑原任务的内容、安排方式、时间窗口和消耗 |
| **Insert inline log** | active 成员编辑视图 | 在光标处插入 log |
| **Create checkpoint** | meta 或成员 | 打开 checkpoint 侧栏表单 |

## 设置

- **Language**：`Auto` 跟随 Obsidian，也可固定为中文或 English；新打开的界面立即使用新语言，命令名称在重新加载插件后更新。
- **Thread meta 目录**：新建 UUID meta 的位置。
- **Thread 文件目录**：通过插件创建成员文件的位置。
- **Thread 角色模板目录**：可用于新建入口和成员的模板集合。
- **默认入口模板**：新建 thread 时默认选择的角色模板。
- **Breadcrumb 位置**：控制固定工具条显示在正文上方或下方。
- **默认 checkpoint 模板**：未设置独立模板的 thread 所继承的字段。

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
