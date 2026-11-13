---
title: Keyboard and input
description: How mouse, trackpad, keyboard, non-ASCII text and the device buttons reach the emulator.
---

## Mouse and trackpad

- **Tap:** click the screen.
- **Swipe:** press, drag, release. The gateway sends the movement to the emulator as one touch.
- If you drag past the edge of the screen and release outside it, the emulator still receives the release, so the touch does not stay pressed.

Page coordinates are converted to device pixels, taking the page size into account.

<!-- verify: phase 2 -->
After you rotate the device, the conversion uses the new orientation, so taps land where you click.

## Scroll wheel

<!-- verify: phase 2 -->
The emulator has no scroll-wheel input, so the page turns wheel movement into a short swipe:

- Every 100 pixels of wheel movement becomes a 300-pixel swipe on the device, up to 900 pixels per swipe.
- The swipe goes the opposite way to the wheel: scrolling down moves the finger up, like on a phone.
- Wheel events within 50 ms are merged into one swipe.

## Keyboard

Click the screen first. It then has keyboard focus.

- Printable characters and function keys (arrows, Enter, Backspace, Tab, Escape and so on) are sent to the emulator as you press them.
- Browser shortcuts that use Cmd, such as Cmd+R and Cmd+W, are not captured. They still act on the browser.

<!-- verify: phase 2 -->
Cmd+V pastes from your Mac. See [Clipboard](/docs/guides/clipboard/).

## Chinese and other non-ASCII text

Type with any macOS input method. When the input method finishes composing a word, the page:

1. puts the text on the emulator's clipboard;
2. sends a paste to the emulator.

No input method app is installed on the emulator. The trade-off: this overwrites the emulator's clipboard.

The emulator's key input drops non-ASCII characters, which is why this text goes through the clipboard.

## Device buttons

Buttons above the screen:

| Button | Sends |
|---|---|
| Back | `GoBack` |
| Home | `GoHome` |
| Recents | `AppSwitch` |

<!-- verify: phase 2 -->
| Button | Action |
|---|---|
| Rotate | Rotates the device 90° clockwise |
| Volume up / down | `AudioVolumeUp` / `AudioVolumeDown` |
| Power | `Power`; press again to turn the screen back on |
| Screenshot | Downloads a PNG. See [Screenshots](/docs/guides/screenshots/) |
