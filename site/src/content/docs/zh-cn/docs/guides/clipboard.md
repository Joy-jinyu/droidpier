---
title: 剪贴板
description: 在 Mac 和 Android 模拟器之间双向复制粘贴文本。
sourceHash: fd58b697773c
---

## Mac 到模拟器

<!-- verify: phase 2 -->
在 Mac 上复制文本，点击模拟器屏幕，然后按 Cmd+V：

- ASCII 文本会逐字符输入到模拟器中。
- 包含其他字符的文本（中文、emoji 等）会放入模拟器的剪贴板并粘贴。这会替换模拟器剪贴板中原有的内容。

## 模拟器到 Mac

<!-- verify: phase 2 -->
在 Android 中复制文本，例如长按后选择复制。网关会监视模拟器的剪贴板，并将新文本发送到页面。页面随后将其写入 Mac 的剪贴板，你可以在 Mac 上任意位置用 Cmd+V 粘贴。

<!-- verify: phase 2 -->
浏览器只允许页面在拥有焦点时写入剪贴板。如果写入失败（例如因为另一个窗口在前台），页面会显示提示。点击提示可复制文本。

## 输入非 ASCII 文字

使用 macOS 输入法输入中文或其他非 ASCII 文字也会通过模拟器的剪贴板传输。请参阅[键盘与输入](/zh-cn/docs/guides/keyboard-and-input/#chinese-and-other-non-ascii-text)。
