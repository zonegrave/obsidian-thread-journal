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
- 按需在绑定窗格中打开并复用配套 Thread 工作区。
- 在 `active`、`paused`、`review`、`completed`、`closed` 五种状态间自由切换。
- 从主 thread 或工作区打开内置 checkpoint 表单。
- 直接从 checkpoint 卡片编辑该条记录的日期、时间与实际保存字段。
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

创建与编辑 checkpoint 时，如果已启用 [Modal Form](https://github.com/danielo515/obsidian-modal-form)，插件会把当前 thread 的字段动态转换成内联 Modal Form，并传入创建默认值或历史值。关闭 Modal Form、取消填写或提交失败都不会产生记录；Modal Form 不可用时才回退到内置表单。

内置回退表单使用紧凑的响应式布局：日期、时间、选择项、数字和开关等短字段双列排列；单行文本与多行文本独占整行并使用完整内容宽度。在窄屏上自动退回单列。

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

## 绑定工作区窗格

插件不再因打开主 thread 自动创建工作区窗格。需要时运行 **打开 thread 工作区**：

- 首次调用时在相邻窗格显示工作区；已有合适窗格时直接绑定，避免重复创建。
- 对其他 thread 再次调用时复用同一个受控工作区窗格。
- 从工作区窗格打开其他笔记时，笔记转到主窗格。
- 关闭主窗格时，同时关闭配套工作区；单独关闭工作区不关闭主窗格。
- 命令执行后焦点进入工作区。
- 在工作区运行 **在左侧打开 context**，会在左侧创建或复用主 thread 窗格，并直接定位到 `当前 Context`；旧笔记中的 `Context` 标题也可识别。

窗格复用依据 leaf 是否仍连接在界面中，而不依赖特定布局插件或单一 leaf 枚举结果。显式打开时通过 Obsidian 的 `revealLeaf()` 显示并聚焦目标；从主 thread 或工作区执行命令都会通过 `thread_id` 定位同一对象。真正无法定位主窗格或工作区时会显示错误，不再静默失败。

## 命令

- 新建 thread
- 打开 thread 工作区
- 在左侧打开 context（仅在工作区可用）
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
