---
title: 설치
description: 명령어 하나로 Apple Silicon Mac에 Droidpier 게이트웨이를 설치하고 시작합니다.
sourceHash: 9e0b6fc5fcb6
---

두 단계로 시작할 수 있습니다:

1. 터미널에서 아래 명령을 실행하고 그 창을 열어 둡니다. Droidpier를 설치하고 시작합니다.
2. `https://droid.devpier.dev/app/`을 엽니다. 페이지가 알아서 연결됩니다. 처음에는 페이지가 로컬 네트워크에 접근해도 되는지 Chrome이 물으면 **허용**을 클릭합니다.

2단계는 [첫 실행](/ko/docs/getting-started/first-run/)에서 설명합니다.

<!-- verify: phase 3 -->
`droidpier` 명령이 바로 게이트웨이입니다. Mac의 Android 에뮬레이터를 브라우저 페이지와 연결하는 실행 파일 하나로 되어 있습니다. 실행하는 데 Node.js는 필요 없습니다.

## 명령 실행

<!-- verify: phase 3 -->

먼저 [요구 사항](/ko/docs/getting-started/requirements/)을 확인하세요. 그런 다음 터미널에서 다음을 실행하세요:

<!-- 待第 3 阶段 Task 5 确认 -->
```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

처음 실행하면 이 스크립트는 다음을 수행합니다:

1. Apple Silicon용 macOS 게이트웨이 `droidpier-darwin-arm64.tar.xz`를 `https://droid.devpier.dev/download/`에서 다운로드합니다. 체크섬은 바로 옆의 `droidpier-darwin-arm64.tar.xz.sha256`에 있습니다.
2. 다운로드한 파일을 체크섬과 대조합니다. 일치하지 않으면 중단하고 아무것도 설치하지 않습니다.
3. 게이트웨이를 `~/.local/bin/droidpier`로 저장하고 실행 권한을 부여합니다.
4. 게이트웨이를 시작합니다.

게이트웨이는 그 터미널 창에서 계속 실행됩니다. 페이지를 사용하는 동안 창을 열어 두세요. 중지하려면 `Ctrl+C`를 누르세요.

같은 명령을 다시 실행하면:

- 설치된 버전이 최신이면 다운로드를 건너뛰고 게이트웨이를 시작합니다.
- 새 버전이 있으면 업데이트한 다음 시작합니다.
- 다운로드 사이트에 연결할 수 없으면 경고를 표시하고 이미 설치된 버전을 시작합니다.
- 게이트웨이가 이미 실행 중이면 그렇다고 알리고 페이지를 엽니다. 두 번째 게이트웨이는 시작하지 않습니다.

게이트웨이에 옵션을 전달하거나 시작하지 않고 설치만 하려면 [명령줄](/ko/docs/reference/cli/#start-with-the-install-command)을 참고하세요.

## droidpier 직접 실행

<!-- verify: phase 3 -->

설치한 뒤에는 `droidpier` 명령으로도 게이트웨이를 시작할 수 있습니다:

```sh
droidpier
```

셸이 `command not found`를 출력하면 `~/.local/bin`이 `PATH`에 없는 것입니다. 이 경우 설치 스크립트가 안내를 출력합니다. 예를 들어 `~/.zshrc`에 추가하세요:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

그런 다음 새 터미널 창을 열고 다시 시도하세요.

## 업데이트

<!-- verify: phase 3 -->

같은 명령을 다시 실행하세요. 새 버전이 있으면 `~/.local/bin`의 파일이 교체됩니다. 게이트웨이가 아직 실행 중이면 먼저 `Ctrl+C`로 중지하세요. 그래야 명령이 새 버전을 시작합니다.

<!-- verify: phase 3 -->
페이지가 게이트웨이보다 새 버전이면, 페이지가 게이트웨이가 오래되었다고 알려 주고 업그레이드 명령을 보여 줍니다.

## 다음 단계

[첫 실행](/ko/docs/getting-started/first-run/): 게이트웨이가 Android SDK를 확인하게 한 다음, 페이지를 열고 로컬 네트워크 접근을 허용합니다.
