#!/bin/sh
# Droidpier 安装脚本：curl -fsSL https://droid.devpier.dev/install.sh | sh
# 下载打包好的可执行文件，校验 sha256，装到 ~/.local/bin/droidpier
set -eu

# 整个脚本包在函数里：curl | sh 半途断线时不会只执行一半
main() {
  base="${DROIDPIER_DOWNLOAD:-https://droid.devpier.dev/download}"
  name="droidpier-darwin-arm64"
  bin_dir="$HOME/.local/bin"
  target="$bin_dir/droidpier"

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

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "下载 $base/$name.tar.xz"
  curl -fL --proto "$proto" --proto-redir "$proto" --tlsv1.2 --progress-bar -o "$tmp/$name.tar.xz" "$base/$name.tar.xz"
  # sha256 和可执行文件同域：防下载损坏，防不了下载站本身被替换
  curl -fsSL --proto "$proto" --proto-redir "$proto" --tlsv1.2 -o "$tmp/$name.tar.xz.sha256" "$base/$name.tar.xz.sha256"

  want="$(awk '{print $1}' "$tmp/$name.tar.xz.sha256")"
  got="$(shasum -a 256 "$tmp/$name.tar.xz" | awk '{print $1}')"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "校验失败：sha256 应为 ${want:-（空）}，下载到的是 $got。没有安装。" >&2
    exit 1
  fi

  # macOS 自带的 tar 能解 xz
  tar -xJf "$tmp/$name.tar.xz" -C "$tmp" "$name"
  mkdir -p "$bin_dir"
  chmod +x "$tmp/$name"
  xattr -d com.apple.quarantine "$tmp/$name" 2>/dev/null || true
  mv -f "$tmp/$name" "$target"

  echo "已安装到 $target"
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      echo "$bin_dir 不在 PATH 里。把下面这行加到 ~/.zshrc，然后重开终端："
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac
  echo "运行 droidpier 启动"
}

main "$@"
