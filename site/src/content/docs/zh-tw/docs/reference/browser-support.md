---
title: 瀏覽器支援
description: Droidpier 支援 Chrome 和 Edge。Safari 會封鎖連接到本機閘道，Firefox 不受支援。
sourceHash: f0d75b070eb1
---

| 瀏覽器 | 支援 |
|---|---|
| Google Chrome | 是 |
| Microsoft Edge | 是 |
| Safari | 否 |
| Firefox | 否 |

[前置需求](/zh-tw/docs/getting-started/requirements/#measured-performance)頁面上的測量資料在 Chrome 157 中採集。

## Safari 不支援的原因

頁面透過 `https` 提供，它使用 `ws://127.0.0.1`（或 `ws://localhost`）連接到你 Mac 上的閘道，該連線未加密。Safari 將此視為混合內容（從安全頁面發起的不安全連線）並封鎖它。頁面在 Safari 中無法存取閘道。

## Firefox

Firefox 不受支援。

## 頁面如何偵測瀏覽器

<!-- verify: phase 3 -->
頁面讀取 `navigator.userAgentData.brands`。只有清單中包含 `Google Chrome` 或 `Microsoft Edge` 時才會繼續。否則它會要求你在 Chrome 或 Edge 中開啟頁面，並不會嘗試連接。

<!-- verify: phase 3 -->
Safari 和 Firefox 不提供 `navigator.userAgentData`，因此會被拒絕。其他不回報 Chrome 或 Edge 品牌的基於 Chromium 的瀏覽器也會被拒絕。

## Chrome 本機網路存取

<!-- verify: phase 3 -->
- 自 Chrome 147 起，連接到 `localhost` 的公共 `https` 頁面必須先取得使用者權限。Chrome 詢問一次並記住該網站的答案。
- 自 Chrome 154 起，頁面可以宣告連接到回送位址（開啟 WebSocket 時使用 `targetAddressSpace: "loopback"`）。頁面會這樣做，並在不支援該選項的版本上回退到普通 WebSocket。
- 自 Chrome 156 起，企業原則無法再關閉此檢查。

如果你拒絕了權限，請參閱[疑難排解](/zh-tw/docs/guides/troubleshooting/#chrome-blocked-local-network-access)。
