---
title: 첫 실행
description: 명령 하나로 게이트웨이를 시작하고, Android SDK를 확인하게 하고, Chrome에서 로컬 네트워크 접근을 허용한 다음, 브라우저에서 에뮬레이터를 확인합니다.
sourceHash: c1c836eb6e73
---

터미널에서 명령 하나를 실행하고 `https://droid.devpier.dev/app/` 를 연 뒤, Chrome 이 물으면 로컬 네트워크 접근을 허용하세요.

## 1. 게이트웨이 시작

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh
```

필요하면 게이트웨이를 설치하거나 업데이트한 뒤 시작합니다. [설치](/ko/docs/getting-started/install/)를 참고하세요. 설치한 뒤에는 `droidpier start`로도 시작할 수 있습니다.

게이트웨이는 백그라운드에서 실행됩니다. 터미널 창은 닫아도 됩니다.

게이트웨이는 기본적으로 `127.0.0.1`의 `7300` 포트에서 수신합니다. 다른 포트를 사용하려면 [명령줄](/ko/docs/reference/cli/)을 참고하세요.

## 2. Android SDK 확인하게 하기 {#2-let-it-check-your-android-sdk}

<!-- verify: phase 3 -->
시작할 때 게이트웨이는 기기를 시작할 수 있는지 확인합니다. Android 에뮬레이터(`emulator`), `platform-tools`의 `adb`, 그리고 시스템 이미지가 설치된 가상 기기(AVD)가 하나 이상 필요합니다. Android 버전은 상관없습니다. 빠진 것이 있으면 터미널에 항목별로 보여 주고, 페이지에서 설정을 마치라고 안내합니다. 터미널에서는 아무것도 묻지 않습니다.

게이트웨이가 백그라운드에서 실행 중이면 이 목록은 로그에 기록됩니다. `droidpier logs`로 확인하세요.

<!-- verify: phase 3 -->
페이지에도 같은 목록이 항목별 다운로드 크기와 함께 표시됩니다. 기기를 시작할 수 있으면 아무것도 표시하지 않습니다.

| 빠진 항목 | 페이지에서 할 일 |
|---|---|
| `emulator`, `platform-tools`, 시스템 이미지 | 항목 옆의 버튼으로 하나씩 설치하거나, 한 번에 모두 설치합니다. 시스템 이미지가 하나도 없으면 Android 14(`system-images;android-34;google_apis;arm64-v8a`)를 제안합니다. 기기의 시스템 이미지가 삭제됐으면 어느 기기인지 알려 주고 그 이미지를 제안합니다. |
| 기기 없음 | 기기를 만듭니다. 기기 모델과 Android 버전을 고릅니다. 시스템 이미지가 이미 설치돼 있으면 Android 14를 내려받는 대신 그것을 제안합니다. |

Java나 명령줄 도구(`sdkmanager`, `avdmanager`)는 필요 없습니다. 게이트웨이는 각 구성 요소를 Android Studio와 같은 Google의 SDK 저장소에서 내려받고, SDK 폴더가 아직 없으면 만듭니다.

<!-- verify: phase 3 -->
페이지에서 확인하기 전에는 아무것도 다운로드하거나 만들지 않습니다. 시작하기 전에 페이지가 무엇을 다운로드하는지, 어디에 설치하는지, 디스크 공간이 얼마나 필요한지 보여 줍니다. 다운로드할 때마다 그 전에 Google 라이선스를 전문으로 보여 주고, 동의한 항목만 설치합니다. 게이트웨이는 Android Studio처럼 동의 사실을 SDK의 `licenses` 폴더에 기록하고, 압축을 풀기 전에 각 다운로드를 Google이 공개한 체크섬과 대조합니다.

직접 설치하려면 페이지에서 그 항목 아래의 수동 설치 부분을 펼치세요. Android Studio의 어디에서 설치하는지와 어디에 설치되는지가 적혀 있습니다.

## 3. 페이지 열기 {#3-open-the-page}

<!-- verify: phase 3 -->
Chrome이나 Edge에서 `https://droid.devpier.dev/app/`을 여세요. 게이트웨이도 시작할 때 이 주소를 출력하고 기본 브라우저에서 엽니다. 기본 브라우저가 Chrome이나 Edge가 아니면 이 주소를 직접 Chrome이나 Edge에서 여세요.

페이지는 알아서 연결됩니다. 응답하는 게이트웨이가 없는 동안 1초마다 확인하고, 게이트웨이가 시작되는 즉시 새로 고침 없이 연결됩니다. 탭이 백그라운드에 있는 동안에는 확인하지 않습니다.

게이트웨이가 포트 `7300`에서 실행되지 않으면, 출력되는 주소는 `#port=<port>`로 끝납니다:

```text
https://droid.devpier.dev/app/#port=7301
```

페이지가 올바른 포트를 찾을 수 있도록 그 주소를 여세요.

## 4. 로컬 네트워크 접근 허용 {#4-allow-local-network-access}

<!-- verify: phase 3 -->
페이지가 처음으로 Mac의 게이트웨이에 연결할 때, Chrome은 `droid.devpier.dev`가 로컬 네트워크에 접근해도 되는지 묻는 권한 요청을 표시합니다. **허용**을 클릭하세요. Chrome은 이 사이트에 대한 선택을 기억합니다.

거부했다면 [문제 해결](/ko/docs/guides/troubleshooting/#chrome-blocked-local-network-access)을 참고하세요.

## 5. 에뮬레이터 사용

gRPC가 활성화된 에뮬레이터가 이미 실행 중이면 페이지에 그 화면이 표시됩니다.

<!-- verify: phase 2 -->
그렇지 않으면 목록에서 기기를 골라 시작하세요. [기기](/ko/docs/guides/devices/)를 참고하세요.

화면을 클릭해 키보드 포커스를 주세요. 그런 다음:

- 클릭하면 탭, 드래그하면 스와이프입니다.
- Mac 키보드로 입력합니다. [키보드와 입력](/ko/docs/guides/keyboard-and-input/)을 참고하세요.
- 화면 위의 뒤로, 홈, 최근 앱 버튼을 사용합니다.

## 중지

`droidpier stop`을 실행하세요. 터미널 창에서 `droidpier` 로 게이트웨이를 시작했다면 그 창에서 `Ctrl+C` 를 누르세요. 실행 중인 에뮬레이터는 계속 실행됩니다. 다음에 같은 명령이나 `droidpier start`로 게이트웨이를 시작하면 다시 연결됩니다.

## 로컬 대체 페이지

게이트웨이는 같은 페이지를 `http://127.0.0.1:7300/app/`(또는 선택한 포트)에서도 직접 제공합니다. 공개 페이지가 로드되지 않거나 연결할 수 없을 때 사용하세요.

게이트웨이가 공개 페이지 대신 로컬 페이지를 열게 하려면 `--local`로 시작하세요:

```sh
droidpier --local
```
