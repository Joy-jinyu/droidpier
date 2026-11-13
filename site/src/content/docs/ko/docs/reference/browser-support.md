---
title: 브라우저 지원
description: Droidpier는 Chrome과 Edge를 지원합니다. Safari는 로컬 게이트웨이로의 연결을 차단하며, Firefox는 지원하지 않습니다.
sourceHash: f0d75b070eb1
---

| 브라우저 | 지원 |
|---|---|
| Google Chrome | 예 |
| Microsoft Edge | 예 |
| Safari | 아니요 |
| Firefox | 아니요 |

[요구 사항](/ko/docs/getting-started/requirements/#measured-performance) 페이지의 측정값은 Chrome 157에서 측정했습니다.

## Safari가 동작하지 않는 이유

페이지는 `https`로 제공되며, 암호화되지 않은 `ws://127.0.0.1`(또는 `ws://localhost`)로 Mac의 게이트웨이에 연결합니다. Safari는 이를 혼합 콘텐츠(보안 페이지에서의 안전하지 않은 연결)로 취급해 차단합니다. Safari에서는 페이지가 게이트웨이에 접근할 수 없습니다.

## Firefox

Firefox는 지원하지 않습니다.

## 페이지가 브라우저를 확인하는 방법

<!-- verify: phase 3 -->
페이지는 `navigator.userAgentData.brands`를 읽습니다. 목록에 `Google Chrome` 또는 `Microsoft Edge`가 있을 때만 계속 진행합니다. 그렇지 않으면 Chrome이나 Edge에서 페이지를 열라고 안내하고 연결을 시도하지 않습니다.

<!-- verify: phase 3 -->
Safari와 Firefox는 `navigator.userAgentData`를 제공하지 않으므로 거부됩니다. Chrome 또는 Edge 브랜드를 보고하지 않는 다른 Chromium 기반 브라우저도 거부됩니다.

## Chrome 로컬 네트워크 접근

<!-- verify: phase 3 -->
- Chrome 147부터, `localhost`에 연결하는 공개 `https` 페이지는 먼저 사용자의 권한을 받아야 합니다. Chrome은 한 번 묻고 그 사이트에 대한 답을 기억합니다.
- Chrome 154부터, 페이지는 루프백 주소에 연결한다고 밝힐 수 있습니다(WebSocket을 열 때 `targetAddressSpace: "loopback"`). 페이지는 이렇게 하며, 이 옵션을 지원하지 않는 버전에서는 일반 WebSocket으로 대체합니다.
- Chrome 156부터는 엔터프라이즈 정책으로 이 검사를 더 이상 끌 수 없습니다.

권한을 거부했다면 [문제 해결](/ko/docs/guides/troubleshooting/#chrome-blocked-local-network-access)을 참고하세요.
