---
title: インストール
description: コマンド一つで Apple Silicon Mac に Droidpier ゲートウェイをインストールして起動する。
sourceHash: 721a09a23a56
---

2 ステップで始められます。

1. ターミナルで下のコマンドを実行します。Droidpier をインストールし、バックグラウンドで起動します。
2. `https://droid.devpier.dev/app/` を開きます。ページは自動で接続します。初回は、ページがローカルネットワークにアクセスしてよいか Chrome に尋ねられたら、**許可**をクリックします。

ステップ 2 については[初回起動](/ja/docs/getting-started/first-run/)で説明しています。

<!-- verify: phase 3 -->
`droidpier` コマンドがゲートウェイです。Mac 上の Android エミュレーターをブラウザページに接続する単一の実行ファイルです。実行に Node.js は不要です。

## コマンドを実行する

<!-- verify: phase 3 -->

まず[動作要件](/ja/docs/getting-started/requirements/)を確認してから、ターミナルで次のコマンドを実行してください。

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

初回実行時、このスクリプトは次の処理を行います。

1. Apple Silicon macOS 向けのゲートウェイ `droidpier-darwin-arm64.tar.xz` を `https://droid.devpier.dev/download/` からダウンロードします。チェックサムはその隣の `droidpier-darwin-arm64.tar.xz.sha256` にあります。
2. ダウンロードしたファイルをチェックサムと照合します。一致しない場合は中止し、何もインストールしません。
3. ゲートウェイを `~/.local/bin/droidpier` として保存し、実行権限を付与します。
4. `droidpier start` でゲートウェイをバックグラウンドで起動します。

ゲートウェイはバックグラウンドで動きます。ターミナルウィンドウを閉じても動き続け、ログイン時にも自動で起動します。停止するには `droidpier stop`、状態を確認するには `droidpier status` を実行します。

同じコマンドをもう一度実行すると：

- 手元のコピーが最新なら、ダウンロードを省略してゲートウェイを再起動します。
- 新しいバージョンがあれば、コピーを更新してからゲートウェイを再起動し、新しいバージョンを動かします。
- ダウンロードサイトに接続できない場合は、警告を表示して、インストール済みのバージョンを起動します。
- 別のターミナルウィンドウでゲートウェイがすでに動いている場合は、その旨を表示して何も起動しません。先にそのウィンドウで `Ctrl+C` を押して止めてください。

ゲートウェイにオプションを渡す方法や、起動せずにインストールだけする方法は、[コマンドライン](/ja/docs/reference/cli/#start-with-the-install-command)を参照してください。

## droidpier を直接実行する

<!-- verify: phase 3 -->

インストール後は `droidpier` コマンドも使えます。`droidpier start` はインストールコマンドと同じようにゲートウェイをバックグラウンドで起動します。`droidpier` だけを実行すると、`Ctrl+C` を押すまでターミナルウィンドウで動きます。

```sh
droidpier start
```

シェルが `command not found` と表示する場合、`~/.local/bin` が `PATH` に含まれていません。この場合、インストールスクリプトが案内を表示します。たとえば `~/.zshrc` に次の行を追加してください。

```sh
export PATH="$HOME/.local/bin:$PATH"
```

その後、新しいターミナルウィンドウを開いて再試行してください。

## アップデート

<!-- verify: phase 3 -->

同じコマンドをもう一度実行します。新しいバージョンがあれば `~/.local/bin` のファイルを置き換え、ゲートウェイを再起動して新しいバージョンを動かします。

<!-- verify: phase 3 -->
ページのバージョンがゲートウェイより新しい場合、ページがゲートウェイの更新を案内し、アップグレードコマンドを表示します。

## 次のステップ

[初回起動](/ja/docs/getting-started/first-run/)：ゲートウェイに Android SDK を確認させ、ページを開いて、ローカルネットワークアクセスを許可します。
