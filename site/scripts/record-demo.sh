#!/usr/bin/env bash
# 录制 3 段演示片段，从每段里截一帧，输出首页手机里的静态截图 site/public/media/screen-{1,2,3}.webp。
# 片段本身只放在临时目录，不进仓库。截图时刻在下面 record 调用的第 4 个参数：
# 主屏取第 0 秒，Settings 首页和滚动后的列表取画面已停稳的 2.8 秒。重录后要逐张看截图，确认不在转场或滚动中。
#
# 用法：scripts/record-demo.sh [serial]   （默认 emulator-5556）
#
# 前提：
# - 一台干净的模拟器（本仓库用的是 AVD emu-web-demo：Pixel 5、API 34 google_apis arm64，没装任何第三方 App、没登录账号）。
#   拒绝对 emulator-5554 录制，也拒绝 `pm list packages -3` 不为空的设备，免得把别的 App 录进去。
# - 主屏第一排最左边那格放着 Settings 图标（脚本会检查，没有就从应用抽屉拖过去）。
# - 本机有 ffmpeg（带 libx264）；封面用 site 的依赖 sharp 转 webp。
#
# 坐标都是 1080x2340 屏幕上的像素。
# 按原生分辨率录，再缩到 828x1794：首页手机屏幕最宽约 277 CSS 像素，DPR 2 要 554、DPR 3 要 831 个设备像素，
# 828 宽在 DPR 2 下不用放大，DPR 3 下几乎不放大。中间片段的 CRF 可用环境变量覆盖（默认 20）。截图用 sharp 转 webp（quality 90），
# 录完要确认每张仍 ≤ 400KB（tests/dist.test.ts 的“演示素材体积”）。
set -euo pipefail

SERIAL="${1:-emulator-5556}"
SITE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$SITE_DIR/public/media"
ADB_BIN="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
FFMPEG="${FFMPEG:-$(command -v ffmpeg || echo /opt/homebrew/bin/ffmpeg)}"
WORK="$(mktemp -d)"
CRF="${CRF:-20}"
trap 'rm -rf "$WORK"' EXIT

adb() { "$ADB_BIN" -s "$SERIAL" "$@"; }

if [[ "$SERIAL" == "emulator-5554" ]]; then
  echo "拒绝：emulator-5554 是开发用的模拟器，不能用来录演示" >&2
  exit 1
fi
if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" != "1" ]]; then
  echo "拒绝：$SERIAL 没有启动完成" >&2
  exit 1
fi
third_party="$(adb shell pm list packages -3 | tr -d '\r')"
if [[ -n "$third_party" ]]; then
  echo "拒绝：$SERIAL 装了第三方 App，可能录进画面：" >&2
  echo "$third_party" >&2
  exit 1
fi
"$FFMPEG" -hide_banner -encoders 2>/dev/null | grep -q libx264 || {
  echo "ffmpeg 不支持 libx264" >&2
  exit 1
}

# ---------- 状态栏演示模式：12:00、满电不充电、信号满、隐藏通知图标 ----------
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
adb shell settings put global sysui_demo_allowed 1
demo enter
demo clock -e hhmm 1200
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile show -e level 4 -e datatype none -e fully true
demo notifications -e visible false

home() {
  adb shell input keyevent KEYCODE_HOME
  sleep 1.2
}

# ---------- 主屏放好 Settings 图标（第一排最左格，中心 164,1492）----------
home
# 看主屏上有没有哪个 Settings 图标的范围盖住 (164,1492)；启动器的格子会差几个像素，不能按固定 bounds 比
settings_at_tap() {
  adb exec-out uiautomator dump /dev/tty 2>/dev/null |
    grep -o 'text="Settings"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' |
    sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/' |
    awk '$1 <= 164 && 164 <= $3 && $2 <= 1492 && 1492 <= $4 { found = 1 } END { exit !found }'
}
if ! settings_at_tap; then
  adb shell input swipe 540 1500 540 400 300
  sleep 1.5
  # 应用抽屉 “All apps” 里 Settings 在第 4 排第 2 列
  adb shell input draganddrop 420 1800 165 1500 2500
  sleep 2
  home
fi

# record <编号> <秒数> <操作函数> <截图秒数>：边录边执行操作，然后转码、在指定时刻截图
record() {
  local n="$1" secs="$2" actions="$3" at="$4"
  local raw="$WORK/raw-$n.mp4"
  adb shell rm -f /sdcard/clip.mp4
  adb shell screenrecord --size 1080x2340 --bit-rate 8000000 --time-limit "$secs" /sdcard/clip.mp4 &
  local rec=$!
  sleep 0.8
  "$actions"
  wait "$rec" || true
  sleep 0.5
  adb pull /sdcard/clip.mp4 "$raw" >/dev/null
  adb shell rm -f /sdcard/clip.mp4
  # screenrecord 输出是变帧率，画面不动时没有帧；fps 补成 30 帧恒定帧率，tpad 补齐结尾的静止画面
  "$FFMPEG" -hide_banner -loglevel error -y -i "$raw" -an \
    -vf "tpad=stop_mode=clone:stop_duration=1,fps=30,scale=828:1794:flags=lanczos" -t "$secs" \
    -c:v libx264 -profile:v high -preset slow -tune animation -crf "$CRF" -pix_fmt yuv420p -movflags +faststart \
    "$WORK/clip-$n.mp4"
  "$FFMPEG" -hide_banner -loglevel error -y -i "$WORK/clip-$n.mp4" -ss "$at" -frames:v 1 "$WORK/screen-$n.png"
  (cd "$SITE_DIR" && node -e '
    const sharp = require("sharp");
    sharp(process.argv[1]).webp({ quality: 90 }).toFile(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });
  ' "$WORK/screen-$n.png" "$OUT_DIR/screen-$n.webp")
  echo "screen-$n: $(wc -c <"$OUT_DIR/screen-$n.webp") bytes"
}

# 片段 1：主屏，上滑打开应用抽屉，停一下再下滑收起，回到主屏
clip1() {
  sleep 1
  adb shell input swipe 540 1700 540 700 450
  sleep 1.6
  adb shell input swipe 540 900 540 2000 450
  sleep 1.4
}

# 片段 2：点主屏上的 Settings 图标，往下滚一点，再回主屏
clip2() {
  sleep 0.8
  adb shell input tap 164 1492
  sleep 1.6
  adb shell input swipe 540 1700 540 1000 500
  sleep 1.2
  adb shell input keyevent KEYCODE_HOME
  sleep 1.2
}

# 片段 3：在 Settings 首页快速往下甩到底，再甩回顶部
clip3() {
  sleep 0.8
  adb shell input swipe 540 1900 540 500 120
  sleep 1.4
  adb shell input swipe 540 1900 540 500 120
  sleep 1.2
  adb shell input swipe 540 500 540 2000 120
  sleep 0.6
  adb shell input swipe 540 500 540 2000 120
  sleep 1.2
}

mkdir -p "$OUT_DIR"

home
record 1 6 clip1 0

home
record 2 6 clip2 2.8

# 片段 3 从 Settings 首页顶部开始（录制前先打开并滚到顶）
adb shell am start -W -a android.settings.SETTINGS >/dev/null
sleep 1.5
for _ in 1 2 3; do adb shell input swipe 540 600 540 2000 120; sleep 0.4; done
sleep 1
record 3 7 clip3 2.8
home

echo "完成：$OUT_DIR"
