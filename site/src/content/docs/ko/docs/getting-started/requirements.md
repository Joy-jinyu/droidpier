---
title: 요구 사항
description: Droidpier를 설치하기 전에 필요한 것 - Apple Silicon Mac, Chrome 또는 Edge, arm64 시스템 이미지가 있는 Android 에뮬레이터.
sourceHash: 39e85ecc70b3
---

Droidpier는 공식 Android 에뮬레이터를 내 Mac에서 실행하고 브라우저 탭에 보여 줍니다. 원격 서버에서는 아무것도 실행되지 않습니다. 작은 로컬 프로그램(게이트웨이)을 설치하고, 같은 Mac에 Android 에뮬레이터와 시스템 이미지가 있어야 합니다.

## 컴퓨터

- Apple Silicon(M1 이상) Mac. 버전 1은 Apple Silicon Mac과 arm64 시스템 이미지만 지원합니다.
- Intel Mac, Windows, Linux는 버전 1에서 지원하지 않습니다.

## 브라우저

- Google Chrome 또는 Microsoft Edge.
- Safari와 Firefox는 지원하지 않습니다. 이유는 [브라우저 지원](/ko/docs/reference/browser-support/)을 참고하세요.

## Android SDK 구성 요소

게이트웨이는 Android SDK의 다음 구성 요소를 사용합니다:

| 구성 요소 | 용도 | 대략적인 다운로드 크기 |
|---|---|---|
| `emulator` | Android 가상 기기 실행 | 약 400 MB |
| `platform-tools` | `adb`. 부팅 상태 확인과 기기 중지에 사용 | 약 16 MB |
| 시스템 이미지(예: `system-images;android-34;google_apis;arm64-v8a`) | 기기에서 실행되는 Android 시스템. Android 버전은 상관없으며, 하나도 없으면 페이지가 Android 14(API 34)를 제안합니다 | 약 1.5 GB |

<!-- verify: phase 3 -->
Java, 명령줄 도구(`sdkmanager`, `avdmanager`), Android Studio는 필요 없습니다. 게이트웨이가 이 구성 요소를 Google의 SDK 저장소에서 내려받고 기기도 직접 만듭니다. Android Studio로 설치한 SDK가 이미 있으면 게이트웨이가 그것을 사용합니다. SDK는 다음 순서로 찾습니다:

1. `ANDROID_HOME` 환경 변수에 지정된 디렉터리.
2. `~/Library/Android/sdk`.

<!-- verify: phase 3 -->
빠진 것이 있으면 게이트웨이가 무엇이 빠졌는지 알려 주고, 무엇이든 다운로드하기 전에 먼저 묻습니다. [첫 실행](/ko/docs/getting-started/first-run/)을 참고하세요.

## 메모리

<!-- verify: phase 3 -->
실행 중인 각 에뮬레이터는 기기 설정에 지정된 RAM을 사용합니다. 게이트웨이가 만들 수 있는 기본 기기는 4096 MB를 사용합니다. 한 번에 한 기기만 표시됩니다.

## 측정된 성능 {#measured-performance}

M4 Mac에서 Pixel 5 API 34 가상 기기(1080×2340)를 Chrome 157로 열고 rgba-mmap 프레임 전송(공유 메모리를 통한 원본 RGBA 프레임)을 사용했을 때, 화면은 중앙값 기준 초당 60프레임으로 갱신되었고 탭 지연은 p50에서 20 ms, p90에서 30 ms였습니다. 수치는 사용하는 Mac, 기기, 브라우저에 따라 달라집니다.

CPU는 같은 환경에서 연속 스와이프 16회 동안 측정했으며, 에뮬레이터, 게이트웨이, 표시 프로세스(모든 Chrome 프로세스)를 합산했습니다. Droidpier는 257%(에뮬레이터 136% + 게이트웨이 69% + Chrome 52%)를 사용했습니다. 같은 에뮬레이터로 같은 방식으로 측정한 scrcpy는 208%(에뮬레이터 203% + scrcpy 5%)를 사용했으므로, Droidpier는 scrcpy가 사용한 CPU의 1.24배를 사용했습니다.
