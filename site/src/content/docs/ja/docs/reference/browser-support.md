---
title: ブラウザサポート
description: Droidpier は Chrome と Edge をサポートします。Safari はローカルゲートウェイへの接続をブロックし、Firefox は非対応です。
sourceHash: f0d75b070eb1
---

| ブラウザ | サポート |
|---|---|
| Google Chrome | あり |
| Microsoft Edge | あり |
| Safari | なし |
| Firefox | なし |

[動作要件](/ja/docs/getting-started/requirements/#measured-performance)ページの測定値は Chrome 157 で取得しました。

## Safari が動作しない理由

ページは `https` で提供されており、`ws://127.0.0.1`（または `ws://localhost`）を使って Mac 上のゲートウェイに接続します。これは暗号化されていない通信です。Safari はこれを混在コンテンツ（セキュアなページからのセキュアでない接続）として扱いブロックします。Safari ではページがゲートウェイに到達できません。

## Firefox

Firefox は非対応です。

## ページのブラウザ検出方法

<!-- verify: phase 3 -->
ページは `navigator.userAgentData.brands` を読み取ります。リストに `Google Chrome` または `Microsoft Edge` が含まれている場合のみ続行します。そうでない場合、Chrome または Edge で開くように求め、接続を試みません。

<!-- verify: phase 3 -->
Safari と Firefox は `navigator.userAgentData` を提供しないため拒否されます。Chrome または Edge ブランドを報告しない他の Chromium ベースのブラウザも拒否されます。

## Chrome のローカルネットワークアクセス

<!-- verify: phase 3 -->
- Chrome 147 以降、`localhost` に接続する公開 `https` ページはまずユーザーの許可を得る必要があります。Chrome は一度尋ねてそのサイトの答えを記憶します。
- Chrome 154 以降、ページはループバックアドレスへの接続を宣言できます（WebSocket を開く際に `targetAddressSpace: "loopback"` を使用）。ページはこれを実装しており、このオプションをサポートしないバージョンでは通常の WebSocket にフォールバックします。
- Chrome 156 以降、エンタープライズポリシーでこのチェックをオフにすることはできません。

許可を拒否した場合は[トラブルシューティング](/ja/docs/guides/troubleshooting/#chrome-blocked-local-network-access)を参照してください。
