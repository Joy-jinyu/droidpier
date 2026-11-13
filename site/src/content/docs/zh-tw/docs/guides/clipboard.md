---
title: 剪貼簿
description: 在 Mac 和 Android 模擬器之間雙向複製貼上文字。
sourceHash: fd58b697773c
---

## Mac 到模擬器

<!-- verify: phase 2 -->
在 Mac 上複製文字，點擊模擬器畫面，然後按 Cmd+V：

- ASCII 文字會逐字元輸入到模擬器中。
- 包含其他字元的文字（中文、emoji 等）會放入模擬器的剪貼簿並貼上。這會取代模擬器剪貼簿中原有的內容。

## 模擬器到 Mac

<!-- verify: phase 2 -->
在 Android 中複製文字，例如長按後選擇複製。閘道會監視模擬器的剪貼簿，並將新文字傳送到頁面。頁面隨後將其寫入 Mac 的剪貼簿，你可以在 Mac 上任意位置用 Cmd+V 貼上。

<!-- verify: phase 2 -->
瀏覽器只允許頁面在擁有焦點時寫入剪貼簿。如果寫入失敗（例如因為另一個視窗在前台），頁面會顯示提示。點擊提示可複製文字。

## 輸入非 ASCII 文字

使用 macOS 輸入法輸入中文或其他非 ASCII 文字也會透過模擬器的剪貼簿傳輸。請參閱[鍵盤與輸入](/zh-tw/docs/guides/keyboard-and-input/#chinese-and-other-non-ascii-text)。
