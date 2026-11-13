---
title: 명령줄
description: Droidpier 게이트웨이 명령의 옵션과 환경 변수.
sourceHash: 6811a7927009
---

<!-- verify: phase 3 -->
```sh
droidpier [--port <port>] [--local] [--no-open]
```

게이트웨이는 `Ctrl+C`를 누를 때까지 포그라운드에서 실행됩니다. 게이트웨이를 중지해도 실행 중인 에뮬레이터는 중지되지 않습니다.

## 설치 명령으로 시작 {#start-with-the-install-command}

설치 명령 `curl -fsSL https://droid.devpier.dev/install.sh | sh`는 게이트웨이를 설치하거나 업데이트한 뒤 시작합니다. 게이트웨이에 옵션을 전달하려면 `sh -s --` 뒤에 적으세요:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

게이트웨이를 시작하지 않고 설치나 업데이트만 하려면 `DROIDPIER_NO_START=1`을 설정하세요:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

## 옵션

| 옵션 | 기본값 | 효과 |
|---|---|---|
| `--port <port>` | `7300` | 게이트웨이가 수신하는 포트입니다. `127.0.0.1`에서만 수신합니다. |

<!-- verify: phase 3 -->
| 옵션 | 기본값 | 효과 |
|---|---|---|
| `--local` | 꺼짐 | `droid.devpier.dev`의 공개 페이지 대신 게이트웨이가 직접 제공하는 페이지(`http://127.0.0.1:<port>/app/`)를 엽니다. |
| `--no-open` | 꺼짐 | 시작할 때 브라우저를 열지 않습니다. 게이트웨이는 주소를 여전히 출력합니다. |

`--no-open`을 지정하든 지정하지 않든, 페이지는 알아서 게이트웨이를 찾습니다. [첫 실행](/ko/docs/getting-started/first-run/#3-open-the-page)을 참고하세요.

## 환경 변수

| 변수 | 효과 |
|---|---|
| `ANDROID_HOME` | Android SDK 디렉터리입니다. 설정하지 않으면 게이트웨이는 `~/Library/Android/sdk`를 사용합니다. |
| `ANDROID_AVD_HOME` | AVD가 들어 있는 디렉터리입니다. 설정하지 않으면 게이트웨이는 `~/.android/avd`를 사용합니다. |
| `DEBUG=1` | 연결마다 초당 한 줄씩 출력합니다: 받은 프레임, 보낸 프레임, 버린 프레임, 평균 프레임 크기, 에뮬레이터에서 게이트웨이까지의 지연. |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME`은 게이트웨이가 기기 목록을 만들 때 읽습니다.

<!-- verify: phase 3 -->
`ANDROID_HOME`은 첫 실행 검사에서 읽습니다.

## 출력 내용

시작할 때 게이트웨이는 페이지 주소를 출력합니다. 실행 중인 에뮬레이터가 없으면 이유를 출력하고 계속 실행됩니다.

<!-- verify: phase 3 -->
기본적으로 출력되는 주소는 공개 페이지 `https://droid.devpier.dev/app/`입니다. 게이트웨이가 포트 `7300`에서 실행되지 않으면 주소는 `#port=<port>`로 끝납니다. `--local`을 지정하면 로컬 페이지(`http://127.0.0.1:<port>/app/`)가 됩니다. `--no-open`을 지정하지 않으면 게이트웨이가 macOS `open` 명령으로 이 주소를 엽니다.

그 포트에서 이미 게이트웨이가 실행 중이면 두 번째 게이트웨이는 시작되지 않습니다. droidpier가 이미 실행 중이라는 메시지와 포트를 출력하고 페이지를 엽니다. 다른 프로그램이 포트를 사용 중이면 그렇다고 알리고, 다른 포트를 제안한 뒤 종료합니다.

<!-- verify: phase 3 -->
Android SDK 구성 요소가 빠져 있으면 게이트웨이는 항목마다 직접 설치하는 명령과 함께 출력하고, 페이지에서 설정을 마치라고 안내합니다. 터미널에서는 아무것도 묻지 않습니다. 설치, 기기 생성, 라이선스 동의는 모두 페이지에서 확인합니다. [첫 실행](/ko/docs/getting-started/first-run/#2-let-it-check-your-android-sdk)을 참고하세요.

## 사용하는 파일과 포트

| 항목 | 위치 |
|---|---|
| 게이트웨이 수신 주소 | `127.0.0.1:<port>` |
| 실행 중인 에뮬레이터 탐색 | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| 항목 | 위치 |
|---|---|
| 게이트웨이가 할당하는 에뮬레이터 gRPC 포트 | `8554`부터 처음으로 비어 있는 짝수 포트 |

<!-- verify: phase 3 -->
| 항목 | 위치 |
|---|---|
| 설치된 실행 파일 | `~/.local/bin/droidpier` |
| 설치된 버전의 체크섬 | `~/.local/share/droidpier/installed.sha256` |
