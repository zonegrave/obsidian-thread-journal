# Thread Journal

一个本地优先的 Obsidian 插件：用主 thread 保存可恢复状态，用配套工作区承载自由探索，并在 milestone 或 review 时创建结构化 checkpoint。

> 当前处于探索测试阶段。笔记 schema、术语和交互会直接演进；每次变化采用一次性迁移，然后只保留最新结构，不提供历史结构兼容。

## 当前模型

- **主 thread**：保存身份、状态、父子关系、milestones、当前 Context 和 checkpoints。
- **Thread 工作区**：自由记录、草拟和重组，不要求时间顺序。
- **Checkpoint**：阶段性、结构化、可查询的状态存档，不要求每日创建。

插件不修改日记，不读取旧日记表单，也不解析历史执行记录结构。

## 当前能力

- 使用一个命令新建 thread；当前文件属于 thread 或工作区时，默认将对应主 thread 作为父节点。
- 使用单一 `parent` 字段维护 thread 树。
- 按需打开并切换配套 Thread 工作区标签页。
- 在 `active`、`paused`、`review`、`completed`、`closed` 五种状态间自由切换。
- 从主 thread 或工作区在右侧打开非模态 checkpoint 表单。
- 直接从 checkpoint 卡片编辑该条记录的日期、时间与实际保存字段。
- 在 Thread 工作区光标处插入带时间戳、可查询的醒目 inline log。
- 在日记中按日期动态汇总当天产生 checkpoint 的 thread。
- 为每个 thread 单独增删、排序和配置 checkpoint 字段。
- 将不再追踪的 checkpoint 字段标为废弃，同时保留历史记录的显示语义。
- 使用 `thread-breadcrumb` 和 `thread-children` 显示 thread 树。
- 使用一个可配置 Markdown 模板创建所有 kind 的 thread。

## 数据模型

主 thread：

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

Thread 工作区：

```yaml
---
type: thread-workspace
thread_id: 3e9b3f36-7f7d-4205-97b0-82c533155eb0
thread: "[[260831·睡眠管理|睡眠管理]]"
created: 2026-08-31
---
```

`thread_id` 是稳定身份，也是主 thread 与工作区配对的唯一依据。主文件不保存 `workspace` 属性；`thread-breadcrumb` 会按 `thread_id` 动态显示工作区入口，因此文件改名后无需同步字段。工作区的 `thread` 只作为可读的返回链接。工作区不保存 `parent`、`kind`、`status`、milestones 或 checkpoints。

## Checkpoint 模板与表单

在主 thread 或工作区运行命令 **创建 checkpoint**。插件自动找到主文件，优先读取这个 thread 自己的模板，并把结果写入主文件 Context 下的 `Checkpoints` 小节。

创建与编辑 checkpoint 时，插件在右侧边栏打开非模态表单。填写期间主笔记仍可滚动、选择和复制，表单也不会替换当前笔记标签；保存成功后侧栏表单自动关闭。若侧栏视图无法加载，才回退到 Modal Form 或内置弹窗。

侧栏采用紧凑单列布局，日期和时间并排；文本、多行文本、选择项等控件使用完整侧栏宽度。按 `Cmd/Ctrl + Enter` 可以保存。侧栏中已有未保存内容时，不会被新的创建或编辑请求覆盖。

在主 thread 或工作区运行 **编辑 checkpoint 模板**，可以为它单独增删、排序和配置字段。启用 Modal Form 时，模板窗口显示紧凑字段列表，眼睛按钮直接控制字段是否用于新 checkpoint，“添加字段”和“编辑”会调用 Modal Form；未启用时使用内置字段编辑器。新增、编辑、排序、删除和废弃状态都会自动保存，不再需要二次点击保存按钮。独立模板保存在主 thread 的 `checkpoint_fields` 属性中；选择“使用全局默认模板”会删除该属性，重新继承 **设置 → Thread Journal → 默认 Checkpoint 模板**。

日期、时间和 `[checkpoint:: true]` 标记由插件固定生成。全局默认模板只包含“类型”和“摘要”两个填写字段；每个 thread 的模板字段均可增删、排序和修改，并支持：

- 单行文本
- 多行文本
- 数字
- 开关
- 日期
- 选择项

每个字段可以设为必填，并选择保存位置：

- **可查询字段**：写入 checkpoint 顶层列表项，可由 Dataview 展开成独立数据行。
- **Checkpoint 正文**：写成缩进内容，适合较长的阶段成果、决策和遗留问题。

不再需要追踪的字段可以标为 **废弃**。废弃字段会统一排列在模板底部，不再出现在新 checkpoint 表单中；历史卡片仍只根据每条记录当时实际保存的字段展示，有旧值时继续使用原显示名称，没有值时不会补空字段。若仍需解释历史数据，建议废弃而不是删除字段。

默认输出：

````markdown
### Checkpoints

```thread-checkpoints
```

> [!info]- 结构化数据
> - [checkpoint:: true] [checkpoint_date:: 2026-08-31] [checkpoint_time:: 14:35] [checkpoint_kind:: milestone] [checkpoint_summary:: 完成工作区模型设计] [version:: 0.16.0] ^cp-20260831-143500-a1b2c
````

`thread-checkpoints` 动态读取折叠区中的唯一一份结构化数据并生成卡片：日期、时间和类型显示在标题，摘要直接显示，自定义字段按“名称：值”排列。修改结构化字段后，卡片随预览刷新，不保存重复的展示文本。

每张带块 ID 的 checkpoint 卡片都有“编辑”和“删除”按钮。编辑表单会合并当前模板中所有未废弃字段与该条记录实际保存的历史字段：新增字段可以补录，后来废弃或已从模板删除但已有值的字段仍可维护；空字段不会写回，也不会出现在卡片中。保存后按原块 ID 原位替换，不会新增重复记录，也不会重新触发 `status_after` 状态流转。删除需要二次确认，并且只移除该块 ID 对应的 checkpoint。

Checkpoint 存储区通过 `thread-checkpoints` 代码块定位，不依赖小节标题。可以直接把 `### Checkpoints` 改成“阶段存档”“复盘记录”等任意标题，后续 checkpoint 仍会写入同一位置。

如果自行添加键为 `status_after` 的选择字段，并使用有效状态值，保存 checkpoint 时会同时更新主 thread 的 `status`。

Dataview 查询示例：

````markdown
```dataview
TABLE WITHOUT ID
  file.link AS Thread,
  checkpoint.checkpoint_date AS 日期,
  checkpoint.checkpoint_time AS 时间,
  checkpoint.checkpoint_kind AS 类型,
  checkpoint.checkpoint_summary AS 摘要
FROM "50-行动系统"
FLATTEN file.lists AS checkpoint
WHERE checkpoint.checkpoint = true
SORT checkpoint.checkpoint_date DESC
```
````

## 日记中的 Checkpoint 汇总

在日记模板中加入：

````markdown
```thread-daily-checkpoints
```
````

插件优先读取日记的 `date` 属性，否则使用 `YYYY-MM-DD` 文件名作为日期。视图只展示当天实际存在 checkpoint 的 thread，按 thread 分组并默认展开；其中的卡片仍可直接编辑。这里只动态查询主 thread，不向日记复制 checkpoint 数据。

## Thread 与工作区切换

插件不自动打开、绑定或关闭窗格。需要时运行 **切换 thread 与工作区**：

- 当前文件是主 thread 时切换到配套工作区；当前文件是工作区时切换回主 thread。
- 配套文件已在任意标签组打开时，直接显示并聚焦已有标签页。
- 配套文件完全未打开时，在当前标签组新建标签页、打开并切换过去。
- 插件不移动已有标签，也不维护分栏绑定；需要分栏时可使用 Obsidian 自带操作手动排列。
- 切换只依赖 `thread_id` 配对，不维护长期窗格绑定，也不拦截普通笔记的打开行为。

命令保留原来的 `open-thread-workspace` ID，因此已有快捷键无需重新绑定。标签复用不把 group 作为配对条件，实现使用 Obsidian 的标准标签页与聚焦接口，不依赖 Vertical Tabs 等布局插件。

## Inline log

在 Thread 工作区的编辑视图运行 **插入 inline log**，插件会在光标处插入一个紧凑的进度 callout，并把光标留在正文末尾继续输入。当前行已有内容时先留出空行；空白行则原位替换。标题只显示 `MM-DD HH:mm`，完整时间戳保存在 `thread_log` 字段中供查询和排序但不重复渲染；日志内容不放进 inline field，因此仍可自由输入双链和普通 Markdown。

```markdown
> [!thread-log] 进度 · 09-04 14:35
> - (thread_log:: 2026-09-04T14:35:27) 完成了第一轮接口验证
```

`thread_log` 同时是日志标记和精确时间戳。它位于 list item 上，可以用 Dataview 汇总：

````markdown
```dataview
TABLE WITHOUT ID
  thread AS Thread,
  log.thread_log AS 时间,
  log.text AS 记录
FROM "50-行动系统/工作区"
FLATTEN file.lists AS log
WHERE log.thread_log
SORT log.thread_log DESC
```
````

## 日记中的 Inline log 汇总

在日记模板中加入：

````markdown
```thread-daily-logs
```
````

插件优先读取日记的 `date` 属性，否则使用 `YYYY-MM-DD` 文件名作为日期。视图动态读取各 Thread 工作区里的 `thread_log`，按 thread 分组、按时间正序排列并默认展开，不向日记复制日志数据。thread 名称链接主文件，“工作区”链接日志来源；日志正文中的双链和 Markdown 会正常渲染。

## 命令

- 新建 thread
- 切换 thread 与工作区
- 插入 inline log（仅在工作区编辑视图可用）
- 编辑 checkpoint 模板
- 创建 checkpoint
- 设置 thread 状态

## Thread 状态

- `active`：行动中。
- `paused`：暂时封存。
- `review`：主要行动结束，等待复盘或知识整理。
- `completed`：目标达成且收尾完成。
- `closed`：决定终止。

状态选择不依赖当前状态，也不限制流转路径。

## Thread 代码块

Breadcrumb：

````markdown
```thread-breadcrumb
```
````

该代码块同时动态显示祖先路径和当前 thread 的工作区入口；工作区链接不写入主文件属性。

直接子 thread：

````markdown
```thread-children
```
````

## Thread 模板

默认模板路径为 `Templates/Thread.md`。所有 kind 共用同一份完整 Markdown 模板；插件只负责替换占位符并校正身份属性。

支持：

- `{{title}}` / `{{thread_title}}`
- `{{filename}}`
- `{{thread_id}}`
- `{{kind}}`
- `{{parent}}` / `{{parent_title}}`
- `{{created}}` / `{{date}}` / `{{date:YYMMDD}}`

## 开发

```bash
npm ci
npm test
npm run build
npm run lint
```

插件不联网、不收集遥测，也不依赖 Node.js 或 Electron API。
