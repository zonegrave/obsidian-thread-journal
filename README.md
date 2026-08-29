# Thread Journal

一个本地优先的 Obsidian 原型插件：把行为统一表示为带单一父节点的 `thread`。每个 thread 只维护自己的日记录入表单；新建日记时，插件把所有活跃 thread 的表单冻结为当天快照，并用 Meta Bind 提供正文内填写控件。

## 依赖

- Obsidian 1.13.1 或更高版本。
- Meta Bind：负责把正文里的结构化控件绑定到日记 frontmatter。

## 当前能力

- 从任意位置新建 thread，并选择父 thread 或创建根节点。
- 从当前 thread 新建子 thread 或同级 thread。
- 新建文件使用 `YYMMDD·标题.md`；`aliases`、`title` 和正文标题保留原始名称。
- 通过“管理当前 thread 的日记表单”图形界面维护结构化字段与 Markdown 正文段落。
- 自动或手动把活跃 thread 的表单快照注入日记，不预写空 frontmatter 属性。
- 用 `thread-breadcrumb` 显示从根节点到直接父节点的 breadcrumb，不重复显示当前 thread。
- 用 `thread-children` 显示直接子 thread。
- 用 `thread-records` 在任意 thread 中纵向汇总自身及后代的日记记录。

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
created: 2026-08-28
daily:
  form:
    - kind: field
      key: sleep_hours
      label: 睡眠时长
      control: number
      unit: 小时
    - kind: field
      key: sleep_quality
      label: 睡眠质量
      control: slider
      min: 1
      max: 10
      step: 1
    - kind: field
      key: energy_level
      label: 精力水平
      control: select
      options: [低, 中, 高]
    - kind: section
      id: sleep-observation
      label: 睡眠观察
      storage: body
---
```

- `kind` 默认为 `normal`，也可以是 `area` 或 `project`；三者统一使用 `type: thread`。
- `parent` 是唯一结构性父节点；其他关系继续使用普通双链。
- Breadcrumb 优先使用 `parent` 链接中的 alias；旧链接没有显式 alias 时，回退到父文件的首个 `aliases`。
- 父节点只接受 `type: thread`；旧式 `area/project/routine` 不自动兼容。
- `daily.form` 是唯一日记录入声明。没有表单或设置 `daily.enabled: false` 时，thread 不参与日记注入。
- `kind: field` 由 Meta Bind 写入日记 frontmatter；属性只在用户实际操作控件后创建。
- `kind: section` 在日记正文中生成带稳定标记的 Markdown 段落。

支持的字段控件：`text`、`number`、`toggle`、`date`、`datetime`、`slider`、`select`、`textarea`、`list`。其中 Meta Bind 的 `textarea` 保存纯文本；需要 Markdown、列表或双链时使用 `section`。

## 日记合成

默认监视 `00-日记/YYYY-MM-DD.md`。创建日记后，插件会：

1. 查找 `type: thread`、状态活跃且 `daily.form` 非空的文件。
2. 在 `## 今日记录` 下，为每个 thread 注入一份带稳定隐藏标记的表单快照。
3. 将结构化字段渲染成 Meta Bind `INPUT[...]` 控件；不创建空 property。
4. 将正文 section 生成为可直接书写 Markdown 的段落。

日记中的 thread 快照保存在正文隐藏标记中，不再使用 `daily_threads`。重复运行 **Thread Journal: 用活跃 thread 补全当前日记** 只会添加尚未存在的 thread 表单，不覆盖已有表单或用户内容。

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

最近 30 天自身及后代记录：

````markdown
```thread-records
scope: descendants
days: 30
fields:
  - sleep_hours
  - sleep_quality
sections:
  - sleep-observation
show-empty: false
```
````

省略 `fields` 或 `sections` 时，插件从作用域内 thread 的当前 `daily.form` 自动汇总。记录归属通过日记正文里的 thread 快照识别。

## 安装测试版

生产构建后，把 `main.js`、`manifest.json` 和 `styles.css` 放入测试 Vault 的 `.obsidian/plugins/thread-journal/`，然后在 **设置 → 第三方插件** 中启用 Thread Journal。

## 开发

```bash
npm ci
npm test
npm run build
npm run lint
```

每次提交都会在 GitHub Actions 中运行测试、生产构建和 lint。推送与 `manifest.json` 版本一致的标签后，发布工作流会构建 `main.js` 并创建包含 `main.js`、`manifest.json` 与 `styles.css` 的草稿 Release。

插件不联网、不收集遥测，也不依赖 Node.js/Electron API，可在桌面端和移动端运行。
