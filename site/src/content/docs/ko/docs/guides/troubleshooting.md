---
title: 문제 해결
description: 자주 발생하는 문제 해결 - Chrome의 로컬 네트워크 접근 차단, 이미 사용 중인 포트, 에뮬레이터를 찾을 수 없음, 페이지가 연결되지 않음, 버전 불일치.
sourceHash: b8a54e8a6f0d
---

## Chrome이 로컬 네트워크 접근을 차단함 {#chrome-blocked-local-network-access}

<!-- verify: phase 3 -->
`droid.devpier.dev`의 페이지는 내 Mac의 게이트웨이에 연결합니다. Chrome은 처음에 권한을 요청합니다. 거부했다면 페이지가 연결할 수 없으며, 몇 번 시도에 실패한 뒤 Chrome이 Mac 접근을 차단했다고 알려 줍니다.

다시 허용하려면:

1. Chrome에서 **설정 → 개인정보 보호 및 보안 → 사이트 설정**을 엽니다.
2. `droid.devpier.dev`를 찾아 로컬 네트워크 접근을 허용합니다.
3. 페이지를 새로고침합니다.

그래도 연결할 수 없으면 [로컬 대체 페이지](#use-the-local-fallback-page)를 사용하세요.

## 포트가 이미 사용 중임

게이트웨이는 기본적으로 `7300` 포트에서 수신합니다.

게이트웨이가 백그라운드에서 실행 중이면 명령을 다시 실행할 때 다시 시작됩니다. 터미널 창에서 게이트웨이가 실행 중이면 두 번째는 시작하지 않고, droidpier 가 이미 포트 `7300` 에서 실행 중이라고 알립니다. 그 게이트웨이를 `Ctrl+C` 로 중지한 뒤 명령을 다시 실행하세요.

다른 프로그램이 포트를 사용 중이면 게이트웨이는 그렇다고 알리고, 다른 포트를 제안한 뒤 종료합니다. 해당 프로그램을 찾으세요:

```sh
lsof -nP -iTCP:7300 -sTCP:LISTEN
```

그 프로그램을 중지하거나, 다른 포트로 게이트웨이를 시작하세요:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7301
```

설치한 뒤에는 `droidpier --port 7301`도 같은 일을 합니다.

<!-- verify: phase 3 -->
게이트웨이는 여는 주소에 새 포트를 넣으므로, 페이지가 올바른 포트에 연결합니다.

## 에뮬레이터를 찾을 수 없음

페이지에 실행 중인 에뮬레이터를 찾을 수 없다고 표시되면:

- 에뮬레이터가 실행 중인지 확인하세요. `adb devices`에 `emulator-5554` 같은 항목이 나와야 합니다.
- gRPC를 활성화해(`-grpc <port>`) 시작했는지 확인하세요. 게이트웨이는 gRPC가 없는 에뮬레이터의 화면을 읽을 수 없습니다.

<!-- verify: phase 2 -->
페이지의 목록에서 기기를 시작할 수도 있습니다. [기기](/ko/docs/guides/devices/)를 참고하세요.

에뮬레이터를 찾지 못해도 게이트웨이는 계속 실행되며 이유를 출력합니다. 터미널에, 백그라운드에서 실행 중이면 로그에 남깁니다 (`droidpier logs`).

<!-- verify: phase 3 -->
게이트웨이가 Android SDK, `emulator`, `platform-tools` 또는 시스템 이미지가 없다고 보고하면, 출력된 해결 방법을 따르세요. [첫 실행](/ko/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)을 참고하세요.

## "sdkmanager"가 없음

<!-- verify: phase 3 -->
Android Studio로 설치한 SDK에는 `sdkmanager`와 `avdmanager`를 제공하는 `cmdline-tools`가 없을 수 있습니다. 페이지에서 설치할 수 있습니다. 빠진 항목 목록에서 그 옆의 설치 버튼을 쓰거나, 기기 만들기 대화 상자에서 설치하세요. 확인하면 게이트웨이가 Google에서 명령줄 도구 22.0을 다운로드해 SDK에 넣습니다. 페이지는 Google 라이선스를 전문으로 보여 주고, 동의해야만 설치합니다.

`sdkmanager`에는 Java가 필요합니다. Java가 없으면 Java가 포함된 Android Studio나 JDK 17 이상을 설치한 다음 페이지를 다시 여세요.

직접 설치하려면 developer.android.com에서 Google 명령줄 도구를 다운로드하고, 다음 경로가 생기도록 압축을 푸세요:

```text
<your SDK>/cmdline-tools/latest/bin/sdkmanager
```

## 페이지가 연결되지 않음

<!-- verify: phase 3 -->
페이지는 1초마다 게이트웨이를 확인하고, 게이트웨이가 응답하는 즉시 연결합니다. 계속 기다리기만 한다면:

- `droidpier status`로 게이트웨이가 실행 중인지 확인하세요. 실행 중이 아니면 `droidpier start`를 실행하세요. 멈춘 이유는 `droidpier logs`에서 볼 수 있습니다.
- Chrome이 `droid.devpier.dev`에 로컬 네트워크 접근을 허용하는지 확인하세요. [Chrome이 로컬 네트워크 접근을 차단함](#chrome-blocked-local-network-access)을 참고하세요.
- `--port`로 게이트웨이를 시작했다면, 게이트웨이가 출력한 주소(`#port=<port>`로 끝남)를 여세요.
- 탭을 앞으로 가져오세요. 탭이 백그라운드에 있는 동안 페이지는 확인하지 않습니다.

## 설치 명령이 실패함

- **체크섬 불일치:** 다운로드한 파일이 체크섬과 일치하지 않아 아무것도 설치되지 않았습니다. 명령을 다시 실행하세요.
- **다운로드 사이트에 연결할 수 없음:** Droidpier가 이미 설치되어 있으면 명령이 경고를 표시하고 설치된 버전을 시작합니다. 아직 설치하지 않았다면 인터넷 연결을 확인한 뒤 명령을 다시 실행하세요.

## 페이지에 게이트웨이 또는 페이지가 오래되었다고 표시됨

<!-- verify: phase 3 -->
- **게이트웨이가 오래됨:** 페이지에 표시된 업그레이드 명령을 실행하세요. [설치 명령](/ko/docs/getting-started/install/)과 같습니다.
- **페이지가 오래됨:** Cmd+Shift+R로 페이지를 강력 새로고침하세요.

## 지원하지 않는 브라우저

<!-- verify: phase 3 -->
페이지는 Chrome과 Edge에서만 동작합니다. 다른 브라우저에서는 브라우저를 바꾸라고 안내하고 연결을 시도하지 않습니다. [브라우저 지원](/ko/docs/reference/browser-support/)을 참고하세요.

## 로컬 대체 페이지 사용 {#use-the-local-fallback-page}

게이트웨이는 같은 페이지를 `http://127.0.0.1:7300/app/`(또는 선택한 포트)에서 제공합니다. 공개 페이지가 로드되지 않거나 로컬 네트워크 접근이 거부되었을 때 사용하세요.

`droidpier --local` 명령을 실행하면 게이트웨이가 공개 페이지 대신 로컬 페이지를 엽니다.

## 화면이 더 이상 갱신되지 않음

에뮬레이터가 종료되거나 다시 시작되면 페이지에 연결이 끊겼다고 표시됩니다. 게이트웨이는 계속 실행됩니다. 에뮬레이터가 다시 돌아오면 페이지가 다시 연결되고 화면이 돌아옵니다.

## 제거 {#uninstall}

백그라운드 게이트웨이를 중지한 뒤 사용하던 파일을 삭제하세요.

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

`droidpier`를 이미 삭제했는데 백그라운드 게이트웨이가 아직 실행 중이거나 로그인할 때 시작되면 직접 제거하세요.

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
