# Thread Journal

一个本地优先的 Obsidian 插件：把行为统一表示为带单一父节点的 `thread`。每个 thread 在正文中维护一份可自由排版的日记表单；新建日记时，插件把所有活跃 thread 的表单冻结为当天快照，Meta Bind 控件在填写后写入当日日记 properties。

## 依赖

- Obsidian 1.13.1 或更高版本。
- Meta Bind：负责把复制到日记正文中的控件绑定到当日日记 properties。

## 当前能力

- 从任意位置新建 thread，并选择父 thread 或创建根节点。
- 从当前 thread 新建子 thread 或同级 thread。
- 新建文件使用 `YYMMDD·标题.md`；`aliases`、`title` 和正文标题保留原始名称。
- 通过“添加或定位当前 thread 的日记表单”命令，在 thread 正文中直接维护 Markdown 与 Meta Bind 控件。
- 在 thread 中把表单渲染成禁用控件的 callout 预览，避免误写 thread 自身的 properties。
- 自动或手动把活跃 thread 的正文表单快照注入日记，不预写空 properties。
- 用 `thread-breadcrumb` 显示从根节点到直接父节点的 breadcrumb，不重复显示当前 thread。
- 用 `thread-children` 显示直接子 thread。
- 用 `thread-records` 在任意 thread 中纵向汇总自身及后代的日记记录。

## Thread 数据模型

````markdown
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
---

## 日记表单

```thread-daily-form
> [!note]+ 睡眠管理
> **睡眠时长（小时）** `INPUT[number:sleep_hours]`
>
> **睡眠质量** `INPUT[slider(addLabels, minValue(1), maxValue(10), stepSize(1)):sleep_quality]`
>
> **精力水平** `INPUT[inlineSelect(option('低'), option('中'), option('高')):energy_level]`
```
````

- `kind` 默认为 `normal`，也可以是 `area` 或 `project`；三者统一使用 `type: thread`。
- `parent` 是唯一结构性父节点；其他关系继续使用普通双链。
- Breadcrumb 优先使用 `parent` 链接中的 alias；旧链接没有显式 alias 时，回退到父文件的首个 `aliases`。
- 父节点只接受 `type: thread`；旧式 `area/project/routine` 不自动兼容。
- `thread-daily-form` 代码块是唯一日记录入声明；没有该代码块的 thread 不参与日记注入。
- 代码块内部是普通 Markdown，可使用 callout、列表、表格、标题或任意 Meta Bind `INPUT[...]` 控件。
- thread 页面只显示安全预览；复制到日记后，Meta Bind 控件才会绑定并写入当日日记 properties。
- 旧 `daily.form` 仍可临时注入；运行“添加或定位当前 thread 的日记表单”会将其转换到正文并清除旧配置。

控件语法直接遵循 Meta Bind。字段名仍应保持稳定、避免跨 thread 意外重名；Base 和 `thread-records` 都直接读取这些日记 properties。

## 日记合成

默认监视 `00-日记/YYYY-MM-DD.md`。创建日记后，插件会：

1. 查找状态活跃的 `type: thread` 文件。
2. 读取其正文中的 `thread-daily-form` 代码块。
3. 在 `## 今日记录` 下原样复制代码块内部的 Markdown，并用稳定隐藏标记标识 thread 来源。
4. Meta Bind 在用户实际填写控件后创建或更新日记 property。

日记中的 thread 快照保存在正文隐藏标记中，不使用 `daily_threads`。重复运行 **Thread Journal: 用活跃 thread 补全当前日记** 只会添加尚未存在的 thread 表单，不覆盖已有表单或用户内容。之后修改 thread 模板也不会改变历史日记。

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

省略 `fields` 时，插件从作用域内 thread 的当前正文模板中解析 Meta Bind 绑定键并汇总对应日记 properties。旧 `sections` 配置仍可读取历史 `daily.form` 产生的正文段落。记录归属通过日记正文里的 thread 快照识别。

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
