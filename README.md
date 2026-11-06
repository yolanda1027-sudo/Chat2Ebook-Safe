# Chat2Ebook Safe

这是基于 Chat2Ebook 0.0.2 的安全收敛版，只保留 EPUB 与 TXT 导出。

## 保留的功能

- 导出 EPUB 与 TXT。
- 选择楼层范围、是否包含用户或 AI、隐藏 AI 名称。
- 可选“包含思维链”：导出 SillyTavern 已解析的推理内容（`extra.reasoning`），EPUB 中以灰色引用块显示在正文前，TXT 中以【思维链】标记包裹。会套用作用范围为“推理”的正则，并经过与正文相同的安全清理。
- 可选“包含其他 swipe 版本”：当前显示的版本作为正文，其余 swipe 版本以虚线框“🔀 其他版本 N / 总数”附在该楼层正文之后（TXT 以【其他版本】标记）。若同时勾选思维链，各版本自己的思维链也会一起收录。
- EPUB 中思维链与 swipe 的显示方式可选：
  - **弹窗（默认）**：正文下方只显示「💭 思维链」「🔀 其他版本（N）」小链接，内容放在章节末尾的 EPUB3 脚注里。支持弹窗脚注的阅读器（如 Apple Books）点击后会以弹窗显示；不支持的阅读器会跳到章节末尾，点「↩ 返回正文」即可回来。
  - **直接展开**：与正文一起显示。
- EPUB 页面按 XHTML 严格规则输出，避免阅读器出现「This page contains the following errors」红框：
  - 思维链一律当纯文字：内容里的 `&` `<` `>` 全部转义，`<writing_style:japanese>` 这类标签会原样显示成文字（Markdown 标题、粗体等排版仍保留）。
  - 正文使用标签白名单：p、span、div、details、table、img 等常用排版标签照常保留；白名单以外或名称带冒号的标签（如 `<user_input>`、`<writing_style: …>`）转成文字显示，不会被删掉。
  - `<br>` `<hr>` `<img>` 输出为自闭合，`&nbsp;` 等 HTML 实体转成实际字符，单独的 `<`、`&` 自动转义。
  - 每一章写入前会以 `application/xhtml+xml` 再解析一次；若仍有错误，该章改用纯文字导出，并在导出完成时提示「第 X 章有格式问题，已用纯文字导出」。
- EPUB 现以 EPUB 3 格式输出，并保留 toc.ncx 以兼容旧阅读器。
- EPUB 分章。
- 继续应用 SillyTavern 的全局、角色卡、当前预设及 TavernHelper 区域正则。
- 保留安全的 Markdown 与常见排版效果。

## 安全调整

- JSZip 3.10.1 与 Showdown 2.1.0 随扩展附带，不再从 CDN 执行远端脚本。
- 移除 HTML 与 DOCX 导出入口及相关代码。
- EPUB 内容会移除脚本、iframe、表单、事件属性、危险 URL 与外部图片；安全 CSS、媒体查询与动画会保留。
- 书名、作者和发言者名称在写入 XHTML/XML 前会转义。
- 下载文件名会移除操作系统不允许的字符并限制长度。
- 拒绝超过 1000 字符及具有常见嵌套量词结构的正则，降低页面冻结风险。
- “允许 HTTPS 外部图片”默认关闭；仅在用户主动开启时保留远端图片及 CSS 背景图。

## 安装

将整个 `Chat2Ebook-Safe` 文件夹放入 SillyTavern 的第三方扩展目录，或把文件夹制作成 Git 仓库后通过 SillyTavern 的扩展安装功能安装。请勿遗漏 `vendor` 文件夹。

## 隐私说明

扩展本身不上传聊天内容，也不会在运行时请求第三方 CDN。远端图片默认从 EPUB 内容中移除；开启“允许 HTTPS 外部图片”后，阅读器可能向图片网站发送 IP、浏览器信息及 Referer。内嵌的 PNG、JPEG、GIF、WebP data URI 图片可直接保留。

## 上游与许可证

- 上游项目：https://github.com/sixwater6h2o/Chat2Ebook
- JSZip 3.10.1 与 Showdown 2.1.0 的许可证见 `vendor` 目录。
