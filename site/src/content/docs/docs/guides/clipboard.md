---
title: Clipboard
description: Copy and paste text between your Mac and the Android emulator in both directions.
---

## Mac to emulator

<!-- verify: phase 2 -->
Copy text on your Mac. Click the emulator screen, then press Cmd+V:

- ASCII text is typed into the emulator character by character.
- Text with other characters (Chinese, emoji and so on) is put on the emulator's clipboard and pasted. This replaces what was on the emulator's clipboard.

## Emulator to Mac

<!-- verify: phase 2 -->
Copy text inside Android, for example by long-pressing and choosing copy. The gateway watches the emulator's clipboard and sends the new text to the page. The page then writes it to your Mac's clipboard, and you can paste it with Cmd+V anywhere on your Mac.

<!-- verify: phase 2 -->
Browsers allow a page to write to the clipboard only while the page has focus. If the write fails, for example because another window was in front, the page shows a notice. Click it to copy the text.

## Typing non-ASCII text

Typing Chinese or other non-ASCII text with a macOS input method also uses the emulator's clipboard. See [Keyboard and input](/docs/guides/keyboard-and-input/#chinese-and-other-non-ascii-text).
