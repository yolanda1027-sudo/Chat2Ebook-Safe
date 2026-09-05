# Chat2Ebook Safe

这是基于 Chat2Ebook 0.0.2 的安全收敛版，只保留 EPUB 与 TXT 导出。

## 保留的功能

- 导出 EPUB 与 TXT。
- 选择楼层范围、是否包含用户或 AI、隐藏 AI 名称。
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
