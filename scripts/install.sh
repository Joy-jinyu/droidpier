#!/bin/sh
# Droidpier 安装并启动：curl -fsSL https://droid.devpier.dev/install.sh | sh
# 没装或有新版时下载打包好的可执行文件，校验 sha256，装到 ~/.local/bin/droidpier，然后用 droidpier start 在后台启动
# （macOS LaunchAgent：关闭终端不影响，开机后自动启动；已在运行时重启它，更新就换上了）。
# 参数原样传给 droidpier start，存进后台服务：curl … | sh -s -- --port 7310
# 只装不启动：DROIDPIER_NO_START=1；像以前一样在这个终端里前台运行：DROIDPIER_FOREGROUND=1
set -eu

# 整个脚本包在函数里：curl | sh 半途断线时不会只执行一半
main() {
  base="${DROIDPIER_DOWNLOAD:-https://droid.devpier.dev/download}"
  name="droidpier-darwin-arm64"
  bin_dir="$HOME/.local/bin"
  target="$bin_dir/droidpier"
  share_dir="$HOME/.local/share/droidpier"
  # 记下装的是哪个压缩包（它的 sha256），下次对比远端判断要不要更新
  stamp="$share_dir/installed.sha256"

  os="$(uname -s)"
  arch="$(uname -m)"
  # Rosetta 下的终端 uname -m 报 x86_64，但机器本身是 Apple 芯片
  if [ "$os" = "Darwin" ] && [ "$arch" = "x86_64" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then
    arch="arm64"
  fi
  if [ "$os" != "Darwin" ] || [ "$arch" != "arm64" ]; then
    echo "Droidpier 目前只支持 Apple 芯片的 Mac（darwin-arm64），这台机器是 $os-$arch。" >&2
    exit 1
  fi

  # 只走 https，重定向也不许降级到 http；只有测试用的 127.0.0.1 地址例外
  proto='=https'
  case "$base" in
    http://127.0.0.1:*) proto='=http' ;;
  esac

  # 下载不下来：装过就用装着的那份启动，没装过只能失败
  offline() {
    if [ -x "$target" ]; then
      echo "连不上下载站，接着用已经装好的 $target" >&2
    else
      echo "连不上下载站 $base，没有安装。" >&2
      exit 1
    fi
  }

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  get() {
    curl -fL --proto "$proto" --proto-redir "$proto" --tlsv1.2 "$@"
  }

  # 先取很小的 .sha256，和装过的那一份比：一样就不用再下载
  installed=""
  [ -f "$stamp" ] && installed="$(cat "$stamp")"
  if ! get -sS -o "$tmp/$name.tar.xz.sha256" "$base/$name.tar.xz.sha256"; then
    offline
  else
    want="$(awk '{print $1}' "$tmp/$name.tar.xz.sha256")"
    if [ -x "$target" ] && [ -n "$want" ] && [ "$want" = "$installed" ]; then
      echo "已是最新版本：$target"
    else
      if [ -x "$target" ]; then
        echo "更新 droidpier"
      fi
      echo "下载 $base/$name.tar.xz"
      if ! get --progress-bar -o "$tmp/$name.tar.xz" "$base/$name.tar.xz"; then
        offline
      else
        # sha256 和可执行文件同域：防下载损坏，防不了下载站本身被替换
        got="$(shasum -a 256 "$tmp/$name.tar.xz" | awk '{print $1}')"
        if [ -z "$want" ] || [ "$want" != "$got" ]; then
          echo "校验失败：sha256 应为 ${want:-（空）}，下载到的是 $got。没有安装。" >&2
          exit 1
        fi

        # macOS 自带的 tar 能解 xz
        tar -xJf "$tmp/$name.tar.xz" -C "$tmp" "$name"
        mkdir -p "$bin_dir" "$share_dir"
        chmod +x "$tmp/$name"
        xattr -d com.apple.quarantine "$tmp/$name" 2>/dev/null || true
        mv -f "$tmp/$name" "$target"
        echo "$want" > "$stamp"
        echo "已安装到 $target"
      fi
    fi
  fi

  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      echo "$bin_dir 不在 PATH 里。把下面这行加到 ~/.zshrc，然后重开终端："
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac

  if [ -n "${DROIDPIER_NO_START:-}" ]; then
    echo "运行 droidpier start 在后台启动（或者运行 droidpier 在终端里前台运行）"
    exit 0
  fi
  # exec 之后 EXIT trap 不会再跑，临时目录要先删掉
  rm -rf "$tmp"
  trap - EXIT
  # curl | sh 时 stdin 是送脚本的管道；网关不读 stdin，接 /dev/null 免得它继承这根管道
  if [ -n "${DROIDPIER_FOREGROUND:-}" ]; then
    echo "启动 droidpier（保持这个终端开着；按 Ctrl+C 停止）"
    exec "$target" "$@" </dev/null
  fi
  echo "在后台启动 droidpier"
  exec "$target" start "$@" </dev/null
}

main "$@"
