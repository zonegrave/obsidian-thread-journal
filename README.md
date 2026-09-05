# Thread Journal

Thread Journal 是一个本地优先的 Obsidian 插件，用主 thread 保存稳定状态与 Context，用配套工作区承载实际推进过程，并把 log 与 checkpoint 作为可查询的记录条目。

> 插件仍处于探索阶段。当前实现只维护一套数据模型；schema 变化时应一次性迁移现有笔记，不在运行时保留旧格式兼容分支。

## 当前模型

- **主 thread**：保存稳定身份、父子关系、状态、Milestones、Context 和 checkpoint 字段模板。
- **Thread 工作区**：自由探索、草拟、重组和实际推进，也是 log 与 checkpoint 的唯一原始数据位置。
- **Log**：中性的随手记录，可用于小进度、随笔或临时观察，不预设内容类型。
- **Checkpoint**：阶段性、结构化的状态存档，通常在 milestone 完成或进入 review 时创建。
- **`thread-entries`**：按 thread、日期和记录类型查询工作区中的原始条目，不复制数据。

主 thread 负责“下次如何恢复”，工作区负责“这次具体如何推进”。插件不会自动把工作区内容归纳进 Context，也不会自动修改日记。

## 快速使用

1. 运行 **新建 thread**。如果当前打开的是主 thread 或工作区，新 thread 默认以其对应主 thread 为父节点。
2. 运行 **切换 thread 与工作区**，在工作区自由推进。
3. 需要随手留痕时，在工作区编辑视图运行 **插入 inline log**。
4. 阶段完成或需要复盘时，运行 **创建 checkpoint**。
5. 手动更新主 thread 的 Context，使其足以支持下次恢复。
6. 在主 thread、日记或 MOC 中使用 `thread-entries` 汇总记录。

## 文件与身份

### 主 thread

新建文件默认位于设置中的 Thread 目录，文件名为 `YYMMDD·标题.md`。插件会校正这些身份属性：

```yaml
---
type: thread
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
title: 睡眠管理
aliases: [睡眠管理]
tags: [线程]
kind: area
status: active
parent: "[[260826·健康管理|健康管理]]"
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
thread: "[[260831·睡眠管理|睡眠管理]]"
created: 2026-08-31
---
```

工作区的 `thread` 仅用于人工返回主文件，不参与身份判断。主文件或工作区改名后，插件仍按 `thread_id` 找到配对文件，并在下次切换时修正工作区的返回链接。

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

- 标题只显示紧凑的 `MM-DD HH:mm`，不添加“进度”等语义前缀。
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
