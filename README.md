# Thread Journal

Thread Journal 是一个本地优先的 Obsidian 插件，用主 thread 保存稳定状态与 Context，用配套工作区承载实际推进过程，并把 log 与 checkpoint 作为可查询的记录条目。

> 插件仍处于探索阶段。当前实现只维护一套数据模型；schema 变化时应一次性迁移现有笔记，不在运行时保留旧格式兼容分支。

## 为什么需要 Thread Journal

一项持续推进的工作，通常既不是一个可以直接勾掉的待办，也不是一篇适合从头写到尾的线性笔记。只用普通笔记跟进较长的项目时，常见的问题包括：

- 项目持续越久，过程性内容越多，重要信息和当前主线越容易被淹没。
- 为了避免单篇笔记过长而拆分文件，又会增加频繁切换笔记和重新建立上下文的成本。
- 留在同一篇笔记中工作，则需要不断上下翻动，寻找目标、进度、重要参考和下一步。

任务清单能告诉我们“要做什么”，却难以保存不断变化的思考和上下文；日记能保留时间线，却会把同一项工作的连续记录拆散。Thread Journal 面向的正是这种持续、多阶段、无法一次规划完整的工作。

## Thread 的思想

这里的 thread 借用操作系统线程的概念，表示一项工作的连续执行单元。推进一个项目通常包含一系列彼此相关的操作：思考、搜索、试验、执行、等待反馈、调整方向和复盘。它们共享同一份上下文，沿着一条主线推进，也可能暂停、恢复、产生子 thread 或最终结束。

在 Thread Journal 中，一个 thread 由两个通过稳定 `thread_id` 配对的界面组成：

- **主 thread 与 Context**：集中维护目标、进度主线、重要参考、结论、约束、未决问题、下一步和阶段性产出，帮助用户快速理解当前状态并进入工作。Context 只呈现需要持续把控的信息，不保存完整执行历史。
- **Workspace**：项目的实际工作空间，用于自由记录草稿、推理、资料、失败尝试和临时想法。它优先保障记录与组织的自由度，不要求用户在写下内容之前先判断内容是否重要。

Context 让项目保持清晰，Workspace 让工作过程不受拘束；使用切换命令可以在两者之间快速往返。暂时不确定是否重要的内容先记录在 Workspace，之后再提炼到 Context。

围绕这两类笔记，Thread Journal 提供以下能力：

- **Milestones 与 thread 树**：用 Milestones 标记能提前确定的阶段；只有形成独立工作线时才创建子 thread，避免过度拆分。
- **Log 与 Checkpoint**：Log 用于随手留痕，Checkpoint 用于记录阶段完成、方向变化和复盘节点。两者的原始数据统一保存在 Workspace。
- **`thread-entries` 查询**：按 thread、日期和类型查看记录，可在主 thread、日记或 MOC 中组织不同视角。
- **状态管理**：状态用于表达 thread 当前是否值得投入注意力，共有五种：`active`（行动中）、`paused`（暂时封存）、`review`（主要行动结束，等待复盘或知识整理）、`completed`（目标达成且收尾完成）和 `closed`（决定终止）。状态可根据实际情况直接设置，不设置强制流转流程，以适应工作方向调整、暂停后恢复以及不同 thread 的推进方式。

## 推荐工作流

1. 先在现有笔记或 Workspace 中思考和推进；只有拥有独立 Context、推进过程和生命周期的工作线自然形成时，才运行 **新建 thread**。小事、一次性动作和短暂念头不需要拆分。
2. 在主 thread 的 Context 中整理项目的重要信息，在 Milestones 中记录已经明确的阶段。
3. 运行 **切换 thread 与工作区**，在 Workspace 中自由探索和执行。
4. 需要随手留痕时运行 **插入 inline log**；阶段完成、方向变化或准备复盘时运行 **创建 checkpoint**。
5. 定期把影响项目理解和后续推进的信息提炼回 Context。
6. 在主 thread、日记或 MOC 中使用 `thread-entries` 汇总所需视角。

## 文件与身份

### 主 thread

新建文件默认位于设置中的 Thread 目录，直接使用 `标题.md`；创建日期保存在 `created`。仅当同名文件已经存在时，文件名才追加短 `thread_id` 以消除冲突。插件会校正这些身份属性：

```yaml
---
type: thread
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
title: 睡眠管理
aliases: [睡眠管理]
tags: [线程]
kind: area
status: active
parent: "[[健康管理|健康管理]]"
created: 2026-08-31
---
```

- `thread_id` 是稳定身份。
- `kind` 可为 `normal`、`project` 或 `area`，三者使用同一套逻辑和模板。
- `parent` 是可选的单一父节点。
- `status` 可为 `active`、`paused`、`review`、`completed` 或 `closed`。
- 主 thread 不保存 `workspace` 属性，也不直接保存 log 或 checkpoint 原始数据。

### Thread 工作区

插件在创建 thread 时同时创建工作区；之后只通过相同的 `thread_id` 配对：

```yaml
---
type: thread-workspace
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
thread: "[[睡眠管理|睡眠管理]]"
created: 2026-08-31
---
```

工作区的 `thread` 仅用于人工返回主文件，不参与身份判断。主文件或工作区改名后，插件仍按 `thread_id` 找到配对文件，并在下次切换时修正工作区的返回链接。

## 已打开 thread 切换

**切换已打开的 thread** 用于在当前 Obsidian 窗口里已经打开的 thread 之间切换：

- Context 和 Workspace 按 `thread_id` 合并为一个候选项，不会因为两个界面同时打开而重复出现。
- 列表显示 thread 层级、状态以及当前已打开的界面，并支持模糊搜索。
- 最近使用的 thread 排在前面；选择后回到它最近使用的界面。尚未访问过界面时优先选择 Workspace。
- 命令只聚焦已有标签，不创建、移动或关闭标签。最近使用顺序仅保留在本次插件运行期间。

这个命令负责在不同 thread 之间移动；下面的 **切换 thread 与工作区** 则负责在同一个 thread 的两个界面之间往返。

## Thread 与工作区切换

**切换 thread 与工作区** 在两个配对文件之间往返：

- 目标已在任意标签组打开时，直接聚焦已有标签。
- 目标未打开时，在当前标签组创建新标签。
- 插件不绑定、移动或自动关闭分栏。
- 实现只使用 Obsidian 标准标签页接口，不为 Vertical Tabs 等布局插件添加专用逻辑。

## Log

**插入 inline log** 仅在 Thread 工作区编辑视图可用。它在光标处插入一个 `thread-log` callout，并把光标留在正文位置继续输入：

```markdown
> [!thread-log] 09-04 14:35
> - (thread_log:: 2026-09-04T14:35:27) 完成了第一轮接口验证 ^log-20260904-143527-a1b2c
```

- 标题只显示紧凑的 `YY/MM/DD HH:mm`，不添加“进度”等语义前缀。
- `thread_log` 保存完整时间戳，用于识别、筛选和排序；查询卡片不显示该字段。启用 Dataview 时，工作区原地卡片也会隐藏其渲染结果，源码编辑时仍可见。
- 正文可以直接使用普通 Markdown 和双链。
- 稳定块 ID 用于从查询卡片精确定位原始记录。
- 工作区原地与查询结果使用同类橙色卡片和 `log` 标签；查询卡片额外提供 **定位**。

Log 不提供结构化表单、编辑按钮或删除按钮，直接在工作区原文中修改即可。

## Checkpoint

**创建 checkpoint** 可从主 thread 或工作区运行：

- 从工作区创建时，记录插入到运行命令时的光标位置。
- 从主 thread 创建时，记录追加到配套工作区末尾。
- 日期、时间、`checkpoint` 标记和稳定块 ID 由插件生成。
- 默认字段只有“类型”和“摘要”。

当前格式：

```markdown
> [!thread-checkpoint] milestone · 09-05 07:20
> - [checkpoint:: true] [checkpoint_date:: 2026-09-05] [checkpoint_time:: 07:20] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成统一记录查询与展示] ^cp-20260905-072055-a1b2c
```

创建和编辑默认使用右侧非模态表单，主笔记仍可滚动和对照。侧栏过窄时插件会临时扩大宽度，保存或关闭后尽力恢复；`Cmd/Ctrl + Enter` 可保存。侧栏无法打开时，插件才回退到 Modal Form 或内置弹窗。

工作区原地 checkpoint 与查询结果使用同一套蓝色卡片内容布局：

- 原地卡片提供 **编辑**。
- 查询卡片提供 **定位**、**编辑** 和 **删除**。
- 摘要和单行文本字段支持紧凑 Markdown；多行或正文型字段支持完整 Markdown。选择、数字、日期和开关字段按纯文本显示。
- 编辑按块 ID 原位替换，不重复创建，也不会再次触发 `status_after`。
- 删除需要确认，只删除对应 checkpoint 块。

如果模板中定义了键为 `status_after` 的字段，并填写有效状态值，新建 checkpoint 后会同步更新主 thread 状态。

## Checkpoint 字段模板

每个 thread 可以在主文件的 `checkpoint_fields` 中保存独立模板；没有该属性时继承插件设置里的全局默认模板。使用 **编辑 checkpoint 模板** 管理字段，所有变更自动保存。

字段支持：

- 控件：单行文本、多行文本、数字、开关、日期、选择项。
- 保存位置：`inline` 可查询字段，或适合长文本的 checkpoint 正文。
- 必填：新建 checkpoint 时校验；编辑历史记录时不会强制补齐后来新增的字段。
- 废弃：不再出现在新表单中，但仍用于解释和编辑已经保存的历史值。

字段模板可以全部清空；此时 checkpoint 只保留固定的标记、日期、时间和块 ID。安装并启用 Modal Form 后，模板的新增与字段编辑会调用其表单界面；Modal Form 不是数据来源。

## 统一记录查询

唯一查询代码块是 `thread-entries`：

````markdown
```thread-entries
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
date: 2026-09-01..2026-09-05
type: [checkpoint, log]
group_by: thread
thread_detail: crumb
```
````

所有字段均可省略，条件之间是“并且”关系：

| 字段 | 可用值 | 省略时 |
| --- | --- | --- |
| `thread_id` | 单个 UUID，或 `[UUID, UUID]` | 全部 thread |
| `date` | `YYYY-MM-DD`，或闭区间 `YYYY-MM-DD..YYYY-MM-DD` | 全部日期 |
| `type` | `checkpoint`、`log`，或列表 | 两种记录 |
| `group_by` | `none`、`thread`、`type` | `none` |
| `thread_detail` | `none`、`name`、`crumb` | `none` |

单日查询中的卡片只显示 `HH:mm`；其他查询和工作区原地卡片统一显示 `YY/MM/DD HH:mm`。

`thread_detail` 控制 thread 身份的显示层级：

- `none`：不在卡片中额外显示 thread。
- `name`：显示当前 thread 名称链接。
- `crumb`：显示从根节点到当前 thread 的完整可点击路径。

使用 `group_by: thread` 时，分组标题必须保留 thread 身份：`none` 与 `name` 显示名称，`crumb` 显示完整路径；组内卡片不重复显示。

有日期条件时记录按时间正序排列，没有日期条件时按时间倒序排列。无效字段和值会直接显示查询错误，不自动猜测。查询只接受显式值，不支持 `current`。

### 主 thread 中的 Timeline

在 Thread 模板中使用 `{{thread_id}}`，创建文件时会替换为实际 UUID：

````markdown
```thread-entries
thread_id: {{thread_id}}
type: [checkpoint, log]
```
````

### 日记中的当日记录

插件不会向日记自动注入内容；可以在日记模板中手动加入：

````markdown
```thread-entries
date: {{date:YYYY-MM-DD}}
type: [checkpoint, log]
group_by: thread
```
````

## Thread 树代码块

主 thread 可使用：

````markdown
```thread-breadcrumb
```
````

`thread-breadcrumb` 动态显示祖先路径和按 `thread_id` 找到的工作区入口。

````markdown
```thread-children
```
````

`thread-children` 动态显示直接子 thread。两个代码块都只渲染界面，不向 Markdown 持续写入内容。

## Thread 模板

插件从设置中的模板路径读取完整 Markdown，默认路径是 `Templates/Thread.md`。所有 kind 共用同一份模板；已有模板不会被插件自动更新或覆盖。

支持的占位符：

- `{{title}}`、`{{thread_title}}`
- `{{filename}}`
- `{{thread_id}}`
- `{{kind}}`
- `{{parent}}`、`{{parent_title}}`
- `{{created}}`、`{{date}}`、`{{date:YYMMDD}}` 等日期格式

推荐的当前正文结构：

````markdown
```thread-breadcrumb
```

# Milestones

# Context

# Timeline

```thread-entries
thread_id: {{thread_id}}
type: [checkpoint, log]
```

## 子线程

```thread-children
```
````

## 命令

| 命令 | 可用位置 | 作用 |
| --- | --- | --- |
| **新建 thread** | 任意位置 | 创建主 thread 与配套工作区 |
| **切换已打开的 thread** | 任意位置 | 在已打开的 thread 之间切换，不创建新标签 |
| **切换 thread 与工作区** | 主 thread、工作区 | 聚焦或打开配对文件 |
| **插入 inline log** | 工作区编辑视图 | 在光标处插入 log |
| **编辑 checkpoint 模板** | 主 thread、工作区 | 编辑当前 thread 的独立字段模板 |
| **创建 checkpoint** | 主 thread、工作区 | 打开 checkpoint 侧栏表单 |
| **设置 thread 状态** | 主 thread、工作区 | 从五个状态中直接选择 |

状态没有流转约束：

- `active`：行动中
- `paused`：暂时封存
- `review`：主要行动结束，等待复盘或知识整理
- `completed`：目标达成且收尾完成
- `closed`：决定终止

## 设置

- **线程目录**：新建主 thread 的位置。
- **Thread 工作区目录**：新建工作区的位置。
- **工作区文件后缀**：只影响新建工作区的文件名，不移动或改名已有文件。
- **Thread 模板**：新建 thread 使用的完整 Markdown 模板路径。
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
