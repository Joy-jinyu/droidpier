---
title: سطر الأوامر
description: الخيارات ومتغيرات البيئة لأمر بوابة Droidpier.
sourceHash: 6865e9bd6511
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| الأمر | ما يفعله |
|---|---|
| `droidpier start` | يشغّل البوابة في الخلفية بوصفها LaunchAgent في macOS. تستمر بعد إغلاق Terminal، وتبدأ عند تسجيل الدخول، وتُعاد إذا تعطّلت. إذا كانت تعمل بالفعل، يعيد تشغيلها. يحفظ الخيارات التي تمرّرها؛ ومن دون خيارات يُبقي المحفوظة. يفتح الصفحة مرة واحدة ما لم تمرّر `--no-open`. |
| `droidpier stop` | يوقف البوابة العاملة في الخلفية، فلا تبدأ بعد ذلك عند تسجيل الدخول. |
| `droidpier status` | يعرض ما إذا كانت البوابة تعمل في الخلفية، مع معرّف العملية والمنفذ والإصدار وملف السجل. |
| `droidpier logs` | يطبع مسار ملف السجل وآخر 50 سطرًا منه. |
| `droidpier` | يشغّل البوابة في نافذة Terminal هذه إلى أن تضغط `Ctrl+C`. |

إيقاف البوابة لا يوقف المحاكيات العاملة.

## التشغيل بأمر التثبيت {#start-with-the-install-command}

يثبّت أمر التثبيت `curl -fsSL https://droid.devpier.dev/install.sh | sh` البوابة أو يحدّثها، ثم يشغّل `droidpier start`. لتمرير خيارات، ضعها بعد `sh -s --`. تُحفظ هذه الخيارات للبوابة العاملة في الخلفية:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

للتثبيت أو التحديث دون تشغيل البوابة، اضبط `DROIDPIER_NO_START=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

لتشغيل البوابة في نافذة Terminal كما في السابق، اضبط `DROIDPIER_FOREGROUND=1`:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## الخيارات

| الخيار | القيمة الافتراضية | التأثير |
|---|---|---|
| `--port <port>` | `7300` | المنفذ الذي تستمع عليه البوابة، على `127.0.0.1` فقط. |

<!-- verify: phase 3 -->
| الخيار | القيمة الافتراضية | التأثير |
|---|---|---|
| `--local` | معطّل | يفتح الصفحة التي تقدّمها البوابة بنفسها، `http://127.0.0.1:<port>/app/`، بدلًا من الصفحة العامة على `droid.devpier.dev`. |
| `--no-open` | معطّل | لا يفتح المتصفح عند البدء. تظل البوابة تطبع العنوان. |

سواء استخدمت `--no-open` أم لا، تجد الصفحة البوابة من تلقاء نفسها. راجع [التشغيل الأول](/ar/docs/getting-started/first-run/#3-open-the-page).

## متغيرات البيئة

| المتغير | التأثير |
|---|---|
| `ANDROID_HOME` | دليل Android SDK. من دونه، تستخدم البوابة `~/Library/Android/sdk`. |
| `ANDROID_AVD_HOME` | الدليل الذي يحتوي على أجهزة AVD. من دونه، تستخدم البوابة `~/.android/avd`. |
| `DEBUG=1` | يطبع سطرًا واحدًا في الثانية لكل اتصال: الإطارات المستلمة والمرسلة والمُسقطة، ومتوسط حجم الإطار، والتأخير من المحاكي إلى البوابة. |

<!-- verify: phase 2 -->
يُقرأ `ANDROID_AVD_HOME` عندما تعرض البوابة قائمة الأجهزة.

<!-- verify: phase 3 -->
يُقرأ `ANDROID_HOME` أثناء فحص التشغيل الأول.

عند ضبط `ANDROID_HOME` و`ANDROID_AVD_HOME`، يحفظهما `droidpier start` للبوابة العاملة في الخلفية، لأن launchd لا يقرأ ملف إعدادات الصدفة لديك. شغّل `droidpier start` مجددًا بعد تغييرهما.

## ما الذي تطبعه

عند البدء، تطبع البوابة عنوان الصفحة. إذا لم يكن هناك محاكٍ قيد التشغيل، تطبع السبب وتستمر في العمل.

<!-- verify: phase 3 -->
افتراضيًا، يكون العنوان المطبوع هو الصفحة العامة، `https://droid.devpier.dev/app/`. وعندما لا تعمل البوابة على المنفذ `7300`، ينتهي العنوان بـ `#port=<port>`. ومع `--local`، يكون الصفحة المحلية، `http://127.0.0.1:<port>/app/`. وتفتح البوابة العنوان بأمر `open` في macOS ما لم تمرّر `--no-open`.

إذا كانت هناك بوابة تعمل بالفعل على المنفذ، فلا تبدأ بوابة ثانية. يطبع أن droidpier يعمل بالفعل مع رقم المنفذ، ويفتح الصفحة. إذا كانت البوابة العاملة هي بوابة الخلفية، يطبع أيضًا `droidpier stop`. إذا كان برنامج آخر يستخدم المنفذ، ينبّه إلى ذلك ويقترح منفذًا آخر ثم يخرج.

<!-- verify: phase 3 -->
عندما تكون أجزاء من Android SDK مفقودة، تعرض البوابة كل جزء مع أمر لتثبيته يدويًا، وتطلب منك إكمال الإعداد في الصفحة. ولا تسأل أي شيء في Terminal أبدًا: التثبيت والأجهزة الجديدة والتراخيص كلها تُؤكَّد في الصفحة. راجع [التشغيل الأول](/ar/docs/getting-started/first-run/#2-let-it-check-your-android-sdk).

## الملفات والمنافذ التي تستخدمها

| ماذا | أين |
|---|---|
| عنوان استماع البوابة | `127.0.0.1:<port>` |
| اكتشاف المحاكيات قيد التشغيل | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| ماذا | أين |
|---|---|
| منافذ gRPC التي تخصصها للمحاكي | أول منفذ زوجي متاح بدءًا من `8554` |

<!-- verify: phase 3 -->
| ماذا | أين |
|---|---|
| الملف التنفيذي المثبَّت | `~/.local/bin/droidpier` |
| المجموع الاختباري للإصدار المثبّت | `~/.local/share/droidpier/installed.sha256` |
| إعدادات بوابة الخلفية | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| سجل بوابة الخلفية | `~/Library/Logs/Droidpier/droidpier.log` |

## إلغاء التثبيت {#uninstall}

أوقف بوابة الخلفية، ثم احذف الملفات التي تستخدمها:

```sh
droidpier stop
rm ~/.local/bin/droidpier
rm -r ~/.local/share/droidpier ~/Library/Logs/Droidpier
```

إذا كنت قد حذفت `droidpier` بالفعل لكن بوابة الخلفية ما زالت تعمل أو تبدأ عند تسجيل الدخول، فأزلها يدويًا:

```sh
launchctl bootout gui/$(id -u)/dev.devpier.droidpier
rm ~/Library/LaunchAgents/dev.devpier.droidpier.plist
```
