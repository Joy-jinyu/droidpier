---
title: 浏览器支持
description: Droidpier 支持 Chrome 和 Edge。Safari 会阻止连接到本地网关，Firefox 不受支持。
sourceHash: f0d75b070eb1
---

| 浏览器 | 支持 |
|---|---|
| Google Chrome | 是 |
| Microsoft Edge | 是 |
| Safari | 否 |
| Firefox | 否 |

[前置要求](/zh-cn/docs/getting-started/requirements/#measured-performance)页面上的测量数据在 Chrome 157 中采集。

## Safari 不支持的原因

页面通过 `https` 提供，它使用 `ws://127.0.0.1`（或 `ws://localhost`）连接到你 Mac 上的网关，该连接未加密。Safari 将此视为混合内容（从安全页面发起的不安全连接）并阻止它。页面在 Safari 中无法访问网关。

## Firefox

Firefox 不受支持。

## 页面如何检测浏览器

<!-- verify: phase 3 -->
页面读取 `navigator.userAgentData.brands`。只有列表中包含 `Google Chrome` 或 `Microsoft Edge` 时才会继续。否则它会要求你在 Chrome 或 Edge 中打开页面，并不会尝试连接。

<!-- verify: phase 3 -->
Safari 和 Firefox 不提供 `navigator.userAgentData`，因此会被拒绝。其他不报告 Chrome 或 Edge 品牌的基于 Chromium 的浏览器也会被拒绝。

## Chrome 本地网络访问

<!-- verify: phase 3 -->
- 自 Chrome 147 起，连接到 `localhost` 的公共 `https` 页面必须先获得用户权限。Chrome 询问一次并记住该站点的答案。
- 自 Chrome 154 起，页面可以声明连接到回环地址（打开 WebSocket 时使用 `targetAddressSpace: "loopback"`）。页面会这样做，并在不支持该选项的版本上回退到普通 WebSocket。
- 自 Chrome 156 起，企业策略无法再关闭此检查。

如果你拒绝了权限，请参阅[故障排除](/zh-cn/docs/guides/troubleshooting/#chrome-blocked-local-network-access)。
