---
title: 動作要件
description: Droidpier のインストールに必要なもの——Apple Silicon Mac、Chrome または Edge、arm64 システムイメージ入りの Android エミュレーター。
sourceHash: a1a9610ae52d
---

Droidpier はあなた自身の Mac 上で公式 Android エミュレーターを動かし、ブラウザのタブに表示します。リモートサーバーでは何も動きません。小さなローカルプログラム（ゲートウェイ）をインストールし、同じ Mac に Android エミュレーターとシステムイメージが必要です。

## コンピューター

- Apple Silicon（M1 以降）搭載の Mac。バージョン 1 は Apple Silicon Mac と arm64 システムイメージのみをサポートします。
- Intel Mac、Windows、Linux はバージョン 1 では非対応です。

## ブラウザ

- Google Chrome または Microsoft Edge。
- Safari と Firefox は非対応です。理由は[ブラウザサポート](/ja/docs/reference/browser-support/)を参照してください。

## Android SDK コンポーネント

ゲートウェイは Android SDK の以下の部分を使用します。

| コンポーネント | 用途 | おおよそのダウンロードサイズ |
|---|---|---|
| `emulator` | Android 仮想デバイスを実行する | 約 400 MB |
| `system-images;android-34;google_apis;arm64-v8a` | Android 14（API 34）システムイメージ | 約 1.5 GB |

<!-- verify: phase 2 -->
| コンポーネント | 用途 | おおよそのダウンロードサイズ |
|---|---|---|
| `platform-tools` | `adb`（起動状態の確認とデバイスの停止に使用） | 約 15 MB |

<!-- verify: phase 3 -->
| コンポーネント | 用途 | おおよそのダウンロードサイズ |
|---|---|---|
| `cmdline-tools` | `sdkmanager` と `avdmanager`（他のコンポーネントのインストールとデバイス作成に使用） | - |

<!-- verify: phase 3 -->
Android Studio を開く必要はありません。すでに Android Studio から SDK をインストール済みの場合、ゲートウェイはそれを使用します。SDK の検索順序は次のとおりです。

1. `ANDROID_HOME` 環境変数で指定したディレクトリ。
2. `~/Library/Android/sdk`。

<!-- verify: phase 3 -->
不足しているものがあれば、ゲートウェイが何が足りないかを伝え、ダウンロードの前に確認を求めます。[初回起動](/ja/docs/getting-started/first-run/)を参照してください。

## メモリ

<!-- verify: phase 3 -->
起動中の各エミュレーターは、デバイス設定で指定された RAM を使用します。ゲートウェイが作成できるデフォルトデバイスは 4096 MB を使用します。表示できるのは一度に 1 デバイスです。

## 実測パフォーマンス {#measured-performance}

M4 搭載 Mac、Pixel 5 API 34 仮想デバイス（1080×2340）、Chrome 157 にて、rgba-mmap フレーム転送方式（共有メモリ経由の生 RGBA フレーム）を使用した場合、画面更新のフレームレート中央値は 60 fps、タップ遅延は p50 で 20 ms、p90 で 30 ms でした。実際の値は Mac・デバイス・ブラウザによって異なります。

CPU は同じ構成で 16 回連続スワイプを実行中に計測し、エミュレーター・ゲートウェイ・表示プロセス（すべての Chrome プロセス）の合計値を使用しました。Droidpier は 257%（エミュレーター 136% + ゲートウェイ 69% + Chrome 52%）でした。同条件で計測した scrcpy は 208%（エミュレーター 203% + scrcpy 5%）であり、Droidpier の CPU 使用量は scrcpy の 1.24 倍でした。
