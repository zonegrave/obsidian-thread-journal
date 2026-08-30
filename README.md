# Thread Journal

一个本地优先的 Obsidian 插件：把行为统一表示为带单一父节点的 `thread`，并把跨日期的事实记录直接保存在所属 thread 中。日记不再被插件修改，它只需要通过 Dataview 或其他查询展示当天的横向切片。

## 当前能力

- 从任意位置新建 thread，并选择父 thread 或创建根节点。
- 从当前 thread 新建子 thread 或同级 thread。
- 所有 thread 默认平铺在 `50-行动系统/`。
- 新文件使用 `YYMMDD·标题.md`；`aliases`、`title` 和正文标题保留原始名称。
- 新建 thread 时读取可配置的完整 Markdown 模板。
- 用 `thread-breadcrumb` 显示从根节点到直接父节点的 breadcrumb。
- 用 `thread-children` 显示直接子 thread。
- 用 `thread-record-template` 展示可复制的记录模板，并可自动填入今天日期后复制。
- 用 `thread-records` 汇总自身及后代 thread 正文中的记录。
- 只读兼容旧版已经写入日记的历史记录；不再监听、修改或补全日记。

插件不再依赖 Meta Bind。Dataview 是可选的，只在日记或 MOC 需要跨文件查询时使用。

## Thread 数据模型

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
created: 2026-08-30
---
```

- `kind` 默认为 `normal`，也可以是 `area` 或 `project`；三者统一使用 `type: thread`。
- `parent` 是唯一结构性父节点。
- 父节点只接受 `type: thread`；旧式 `area/project/routine` 不自动兼容。
- Breadcrumb 优先使用 `parent` 链接中的 alias。

## 在 thread 中记录

记录模板放在 thread 前部：

````markdown
```thread-record-template
- [thread_record:: true] [record_date:: YYYY-MM-DD] [sleep_hours:: ] [summary:: ]
  - 详细观察：
```
````

阅读模式会显示两个按钮：

- **复制模板**：保留日期占位符。
- **复制今日记录**：把所有 `YYYY-MM-DD` 替换为当天日期后复制。

把复制结果粘贴到同一 thread 的 `## 记录` 下并填写：

```markdown
## 记录

- [thread_record:: true] [record_date:: 2026-08-30] [sleep_hours:: 7.5] [summary:: 入睡顺利] ^rec-260830-a
  - 详细观察：夜间醒来一次，但很快重新入睡。
```

每一条顶层列表项是一条独立记录。结构化字段必须使用 `[key:: value]` 并放在同一条顶层列表项上；缩进内容适合长文本。`thread_record:: true` 是记录标记，`record_date` 必须使用 `YYYY-MM-DD`。块 ID 可选，用于稳定定位。

## 日记只负责调度和展示

插件不会向新日记注入任何表单或属性。日记可以使用 Dataview 展示当天所有 thread 记录：

````markdown
```dataview
TABLE WITHOUT ID
  file.link AS "Thread",
  record.summary AS "记录"
FROM "50-行动系统"
FLATTEN file.lists AS record
WHERE record.thread_record = true
  AND record.record_date = this.date
SORT file.name ASC
```
````

这样 thread 是纵向事实来源，日记只是按日期形成横向切片；记录不复制、不搬运。

## Thread 文件中的代码块

Breadcrumb：

````markdown
```thread-breadcrumb
```
````

直接子线程：

````markdown
```thread-children
```
````

汇总自身及后代最近 30 天的记录：

````markdown
```thread-records
scope: descendants
days: 30
fields:
  - sleep_hours
  - sleep_quality
```
````

`scope` 可设为 `self` 或 `descendants`。省略 `fields` 时显示记录中的全部业务字段。旧版日记快照仍会由此视图只读显示，便于逐步迁移。

## Thread 创建模板

默认模板路径是 `Templates/Thread.md`，可在 Thread Journal 设置中修改。模板不存在时插件会自动创建；若内容仍是 0.6.0 的未修改默认模板，插件会自动升级为内联记录结构。自定义模板不会被覆盖。

支持以下占位符：

- `{{title}}` / `{{thread_title}}`
- `{{filename}}`、`{{thread_id}}`、`{{kind}}`
- `{{parent}}`、`{{parent_title}}`
- `{{created}}` / `{{date}}` / `{{date:YYMMDD}}`
- `{{goal_heading}}`：area 为“责任范围”，其余为“期望结果”
- `{{criteria_heading}}`：area 为“维持标准”，其余为“完成条件”

创建完成后，插件会校正 `type`、`thread_id`、`title`、`aliases`、`tags`、`kind`、`status`、`created` 和 `parent`。

## 从旧版迁移

- 0.7.0 起不再注册“编辑当前 thread 的日记表单”和“用活跃 thread 补全当前日记”命令。
- 不再监听日记创建事件，也不会产生新的 thread 表单快照。
- 现有 `thread-daily-form` 代码块只显示为旧版只读预览。
- 旧日记及其中的 properties、正文和隐藏标记不会被删除或改写。
- `thread-records` 会同时读取新的 thread 正文记录和旧日记记录。

## 开发

```bash
npm ci
npm test
npm run build
npm run lint
```

插件不联网、不收集遥测，也不依赖 Node.js/Electron API，可在桌面端和移动端运行。
