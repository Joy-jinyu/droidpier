---
title: コマンドライン
description: Droidpier ゲートウェイコマンドのオプションと環境変数。
sourceHash: eef348a17cbd
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| コマンド | 動作 |
|---|---|
| `droidpier start` | ゲートウェイを macOS の LaunchAgent としてバックグラウンドで動かします。ターミナルを閉じても動き続け、ログイン時に起動し、クラッシュしたら再起動します。すでに動いている場合は再起動します。指定したオプションは保存され、オプションなしなら保存済みのものを使います。`--no-open` を付けない限り、ページを 1 回開きます。 |
| `droidpier stop` | バックグラウンドのゲートウェイを止めます。ログイン時にも起動しなくなります。 |
| `droidpier status` | バックグラウンドのゲートウェイが動いているかを、プロセス ID、ポート、バージョン、ログファイルとともに表示します。 |
| `droidpier logs` | ログファイルのパスと最後の 50 行を表示します。 |
| `droidpier` | `Ctrl+C` を押すまで、このターミナルウィンドウでゲートウェイを動かします。 |

ゲートウェイを止めても、実行中のエミュレーターは止まりません。

## インストールコマンドで起動する {#start-with-the-install-command}

インストールコマンド `curl -fsSL https://droid.devpier.dev/install.sh | sh` は、ゲートウェイをインストールまたは更新してから `droidpier start` を実行します。オプションを渡すには `sh -s --` の後に書きます。オプションはバックグラウンドのゲートウェイ用に保存されます。

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

ゲートウェイを起動せずにインストールまたは更新だけを行うには、`DROIDPIER_NO_START=1` を設定します。

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

以前のようにターミナルウィンドウでゲートウェイを動かすには、`DROIDPIER_FOREGROUND=1` を設定します。

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## オプション

| オプション | デフォルト | 効果 |
|---|---|---|
| `--port <port>` | `7300` | ゲートウェイがリッスンするポート（`127.0.0.1` のみ）。 |

<!-- verify: phase 3 -->
| オプション | デフォルト | 効果 |
|---|---|---|
| `--local` | オフ | `droid.devpier.dev` 上の公開ページではなく、ゲートウェイ自身が提供するページ `http://127.0.0.1:<port>/app/` を開く。 |
| `--no-open` | オフ | 起動時にブラウザを開かない。ゲートウェイは引き続きアドレスを表示します。 |

`--no-open` の有無にかかわらず、ページは自動でゲートウェイを見つけます。[初回起動](/ja/docs/getting-started/first-run/#3-open-the-page)を参照してください。

## 環境変数

| 変数 | 効果 |
|---|---|
| `ANDROID_HOME` | Android SDK ディレクトリ。設定しない場合、ゲートウェイは `~/Library/Android/sdk` を使用します。 |
| `ANDROID_AVD_HOME` | AVD を格納するディレクトリ。設定しない場合、ゲートウェイはエミュレータと同じく `ANDROID_USER_HOME` 内の `avd`、または `~/.android/avd` を使用します。 |
| `ANDROID_USER_HOME` | Android のユーザーディレクトリ。設定しない場合、ゲートウェイは `~/.android` を使用します。 |
| `DEBUG=1` | 各接続について 1 秒ごとに 1 行表示：受信・送信・破棄されたフレーム数・平均フレームサイズ・エミュレーターからゲートウェイまでの遅延。 |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` はゲートウェイがデバイスを一覧表示するときに読み込まれます。

<!-- verify: phase 3 -->
`ANDROID_HOME` は初回起動チェック時に読み込まれます。

`ANDROID_HOME`、`ANDROID_AVD_HOME`、`ANDROID_USER_HOME` が設定されていれば、`droidpier start` はそれらをバックグラウンドのゲートウェイ用に保存します。launchd はシェルの設定を読まないためです。変更したら `droidpier start` をもう一度実行してください。

## 表示内容

起動時に、ゲートウェイはページのアドレスを表示します。エミュレーターが起動していない場合は、理由を表示して動き続けます。

<!-- verify: phase 3 -->
デフォルトでは、表示されるアドレスは公開ページ `https://droid.devpier.dev/app/` です。ゲートウェイがポート `7300` 以外で動いている場合、アドレスの末尾は `#port=<port>` になります。`--local` を指定すると、ローカルページ `http://127.0.0.1:<port>/app/` になります。`--no-open` を指定しない限り、ゲートウェイは macOS の `open` コマンドでそのアドレスを開きます。

そのポートですでにゲートウェイが動いている場合、2 つ目は起動しません。droidpier がすでに動いていることをポートとともに表示し、ページを開きます。動いているのがバックグラウンドのゲートウェイなら、`droidpier stop` も表示します。別のプログラムがポートを使っている場合は、その旨と別のポートを示して終了します。

<!-- verify: phase 3 -->
Android SDK のコンポーネントが不足している場合、ゲートウェイは項目ごとに手動インストール用のコマンドを添えて表示し、ページでセットアップを完了するよう案内します。ターミナルで質問することはありません。インストール、デバイスの作成、ライセンスへの同意はすべてページで確認します。[初回起動](/ja/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)を参照してください。

## 使用するファイルとポート

| 内容 | 場所 |
|---|---|
| ゲートウェイのリッスンアドレス | `127.0.0.1:<port>` |
| 起動中のエミュレーターの検出 | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| 内容 | 場所 |
|---|---|
| 割り当てるエミュレーターの gRPC ポート | `8554` から始まる最初の空き偶数ポート |

<!-- verify: phase 3 -->
| 内容 | 場所 |
|---|---|
| インストールされる実行ファイル | `~/.local/bin/droidpier` |
| インストール済みバージョンのチェックサム | `~/.local/share/droidpier/installed.sha256` |
| バックグラウンドのゲートウェイの設定 | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| バックグラウンドのゲートウェイのログ | `~/Library/Logs/Droidpier/droidpier.log` |

## アンインストール {#uninstall}

バックグラウンドのゲートウェイを止めてから、使っているファイルを削除します。

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

`droidpier` をすでに削除したのに、バックグラウンドのゲートウェイがまだ動いている、またはログイン時に起動する場合は、手動で取り除きます。

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
