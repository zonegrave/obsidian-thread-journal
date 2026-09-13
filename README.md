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
4. 用 **Set as thread entry** 决定当前最适合恢复工作的文件，用 **Manage thread files** 在 pack 内切换。
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

### Thread 成员

成员可以位于 vault 的任何位置。通过插件新建的成员默认放在 `50-行动系统/Thread Files/`：

```yaml
---
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
thread_role: research
thread_role_status: active
created: 2026-09-13
---
```

- `thread_role` 是任意字符串；省略时按 `workspace` 显示。
- `thread_role_status` 只有 `active` 和 `terminated`；省略时视为 `active`。终止只结束这个工作切片，不删除文件或整个 thread。
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

- 左侧展示 thread 树；根节点、祖先和子 thread 都打开各自的入口文件。当前 thread 的状态徽标显示在右侧操作区，点击即可切换状态。
- 入口以外的成员会出现首页按钮，可一键返回当前 thread 的入口。
- 文件按钮显示成员数量，并打开 **Manage thread files**；选择成员可跳转，也可设置入口、终止非入口成员或重新激活成员。terminated 成员排在底部且不能成为入口。
- thread 树图标打开 **Manage open threads**。它按 `thread_id` 合并当前窗口的所有已打开标签，显示角色组成，可打开入口、管理文件或关闭该 thread 的全部标签。
- 最右侧在 `Active + dormant` 和 `All` 之间切换树菜单范围。

目标文件已经打开时，插件直接聚焦已有标签；否则创建普通标签。插件不绑定、移动或自动关闭分栏，也不依赖 Vertical Tabs 等布局插件。

## Log

**Insert inline log** 可在任意 active thread 成员的编辑视图中使用。它在光标处插入一个可查询 callout：

```markdown
> [!thread-log] 09-13 14:35
> - (thread_log:: 2026-09-13T14:35:27) 完成了第一轮接口验证 ^log-20260913-143527-a1b2c
```

- 正文可以使用 Markdown 和双链。
- 完整时间戳用于识别、筛选和排序；渲染时显示紧凑时间。
- 块 ID 用于从查询卡片精确定位原始记录。
- Log 直接在原文件中编辑，不提供单独表单。

## Checkpoint

**Create checkpoint** 可从 meta 或 active 成员运行：

- 从成员运行时，记录插入光标位置。
- 从 meta 运行时，记录追加到当前入口末尾。
- 日期、时间、标记和稳定块 ID 由插件生成。
- 默认字段只有“类型”和“摘要”。

```markdown
> [!thread-checkpoint] milestone · 09-13 15:20
> - [checkpoint:: true] [checkpoint_date:: 2026-09-13] [checkpoint_time:: 15:20] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成 pack 模型] ^cp-20260913-152000-a1b2c
```

创建和编辑默认使用右侧非模态表单，可以继续对照主笔记；`Cmd/Ctrl + Enter` 保存。原地卡片提供编辑，查询卡片提供定位、编辑和删除。摘要和文本字段支持 Markdown 与双链。

每个 thread 可以把独立字段模板保存在 meta 的 `checkpoint_fields`；没有时继承全局默认。字段支持单行、多行、数字、开关、日期、选择项、必填、正文/inline 保存和废弃。废弃字段不再出现在新表单中，但仍用于解释历史记录。

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

**Open thread overview** 或 `thread-overview` 代码块会读取 meta 和 pack 全部成员中的 Markdown 任务，统计当前 thread 及其子树，并可定位原任务；它只提示，不自动改变状态。外部笔记中的任务只有在同一行明确链接某个 meta 或成员时才归属该 thread。

`thread-children` 代码块动态显示直接子 thread，并链接到各自入口：

````markdown
```thread-children
```
````

## 命令

| 命令 | 可用位置 | 作用 |
| --- | --- | --- |
| **Create thread** | 任意位置 | 创建 meta；非 idea/committed 状态同时选择模板并创建入口 |
| **Create thread file** | meta 或成员 | 从角色模板向当前 pack 添加成员 |
| **Manage thread files** | meta 或成员 | 打开成员、设置入口、终止或重新激活成员 |
| **Switch active thread role** | meta 或成员 | 在当前 pack 的 active 成员间循环切换；从 meta 或 terminated 成员进入入口 |
| **Set as thread entry** | 非入口成员 | 将当前成员设为唯一入口 |
| **Manage open threads** | 任意位置 | 按 thread 管理当前窗口里的标签 |
| **Open thread overview** | 任意位置 | 查看状态、子树任务提示并定位原任务 |
| **Insert inline log** | active 成员编辑视图 | 在光标处插入 log |
| **Edit checkpoint template** | meta 或成员 | 编辑当前 thread 的独立字段模板 |
| **Create checkpoint** | meta 或成员 | 打开 checkpoint 侧栏表单 |
| **Set thread status** | meta 或成员 | 修改 meta 中的状态 |
| **Change thread parent** | meta 或成员 | 选择新的 active/dormant 父 thread，或将当前 thread 设为根节点 |

## 设置

- **Thread meta 目录**：新建 UUID meta 的位置。
- **Thread 文件目录**：通过插件创建成员文件的位置。
- **Thread 角色模板目录**：可用于新建入口和成员的模板集合。
- **默认入口模板**：新建 thread 时默认选择的角色模板。
- **Breadcrumb 位置与默认范围**：控制固定工具条和层级菜单。
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
