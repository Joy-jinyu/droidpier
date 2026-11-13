---
title: कमांड लाइन
description: Droidpier गेटवे कमांड के विकल्प और environment variables।
sourceHash: b62f19b96312
---

<!-- verify: phase 3 -->
```sh
droidpier start [--port <port>] [--local] [--no-open]
droidpier stop
droidpier status
droidpier logs
droidpier [--port <port>] [--local] [--no-open]
```

| कमांड | असर |
|---|---|
| `droidpier start` | गेटवे को macOS LaunchAgent के रूप में बैकग्राउंड में चलाता है। Terminal बंद करने के बाद भी चलता रहता है, लॉग इन पर शुरू होता है, और क्रैश होने पर फिर से शुरू होता है। पहले से चल रहा हो तो उसे फिर से शुरू करता है। आपके दिए विकल्प सहेजता है; विकल्प न हों तो सहेजे हुए रखता है। `--no-open` न दें तो पेज एक बार खोलता है। |
| `droidpier stop` | बैकग्राउंड गेटवे को बंद करता है। लॉग इन पर यह फिर शुरू नहीं होता। |
| `droidpier status` | दिखाता है कि बैकग्राउंड गेटवे चल रहा है या नहीं, उसके प्रोसेस ID, पोर्ट, संस्करण और लॉग फ़ाइल के साथ। |
| `droidpier logs` | लॉग फ़ाइल का पाथ और उसकी आख़िरी 50 पंक्तियाँ दिखाता है। |
| `droidpier` | गेटवे को इसी Terminal विंडो में तब तक चलाता है जब तक आप `Ctrl+C` न दबाएँ। |

गेटवे बंद करने से चल रहे एमुलेटर बंद नहीं होते।

## इंस्टॉल कमांड से शुरू करें {#start-with-the-install-command}

इंस्टॉल कमांड `curl -fsSL https://droid.devpier.dev/install.sh | sh` गेटवे को इंस्टॉल या अपडेट करती है, फिर `droidpier start` चलाती है। इसे विकल्प देने के लिए उन्हें `sh -s --` के बाद लिखें। ये बैकग्राउंड गेटवे के लिए सहेजे जाते हैं:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | sh -s -- --port 7310
```

गेटवे शुरू किए बिना सिर्फ़ इंस्टॉल या अपडेट करने के लिए, `DROIDPIER_NO_START=1` सेट करें:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_NO_START=1 sh
```

पहले की तरह गेटवे को Terminal विंडो में चलाने के लिए `DROIDPIER_FOREGROUND=1` सेट करें:

```sh
curl -fsSL https://droid.devpier.dev/install.sh | DROIDPIER_FOREGROUND=1 sh
```

## विकल्प

| विकल्प | डिफ़ॉल्ट | असर |
|---|---|---|
| `--port <port>` | `7300` | वह पोर्ट जिस पर गेटवे सुनता है, सिर्फ़ `127.0.0.1` पर। |

<!-- verify: phase 3 -->
| विकल्प | डिफ़ॉल्ट | असर |
|---|---|---|
| `--local` | बंद | `droid.devpier.dev` पर मौजूद पब्लिक पेज की जगह वह पेज खोलें जिसे गेटवे ख़ुद सर्व करता है, `http://127.0.0.1:<port>/app/`। |
| `--no-open` | बंद | शुरू होने पर ब्राउज़र न खोलें। गेटवे फिर भी पता प्रिंट करता है। |

`--no-open` के साथ हो या उसके बिना, पेज गेटवे को अपने-आप ढूँढ लेता है। [पहली बार चलाना](/hi/docs/getting-started/first-run/#3-open-the-page) देखें।

## Environment variables

| Variable | असर |
|---|---|
| `ANDROID_HOME` | Android SDK डायरेक्टरी। इसके बिना गेटवे `~/Library/Android/sdk` इस्तेमाल करता है। |
| `ANDROID_AVD_HOME` | वह डायरेक्टरी जिसमें AVD रहते हैं। इसके बिना गेटवे `~/.android/avd` इस्तेमाल करता है। |
| `DEBUG=1` | हर कनेक्शन के लिए हर सेकंड एक लाइन प्रिंट करें: मिले, भेजे गए और छोड़े गए फ़्रेम, औसत फ़्रेम साइज़, और एमुलेटर से गेटवे तक की देरी। |

<!-- verify: phase 2 -->
`ANDROID_AVD_HOME` तब पढ़ा जाता है जब गेटवे डिवाइस की सूची बनाता है।

<!-- verify: phase 3 -->
`ANDROID_HOME` पहली बार चलने वाली जाँच में पढ़ा जाता है।

अगर `ANDROID_HOME` और `ANDROID_AVD_HOME` सेट हैं, तो `droidpier start` उन्हें बैकग्राउंड गेटवे के लिए सहेजता है, क्योंकि launchd आपकी shell प्रोफ़ाइल नहीं पढ़ता। इन्हें बदलने के बाद `droidpier start` फिर से चलाएँ।

## यह क्या प्रिंट करता है

शुरू होने पर गेटवे पेज का पता प्रिंट करता है। अगर कोई एमुलेटर नहीं चल रहा है, तो यह कारण प्रिंट करता है और चलता रहता है।

<!-- verify: phase 3 -->
डिफ़ॉल्ट रूप से प्रिंट किया गया पता पब्लिक पेज का होता है, `https://droid.devpier.dev/app/`। जब गेटवे पोर्ट `7300` पर नहीं चल रहा होता, तो पते के अंत में `#port=<port>` होता है। `--local` के साथ यह लोकल पेज का होता है, `http://127.0.0.1:<port>/app/`। जब तक आप `--no-open` नहीं देते, गेटवे यह पता macOS की `open` कमांड से खोलता है।

अगर उस पोर्ट पर पहले से कोई गेटवे चल रहा है, तो दूसरा शुरू नहीं होता। यह पोर्ट के साथ बताता है कि droidpier पहले से चल रहा है, और पेज खोलता है। अगर चल रहा गेटवे बैकग्राउंड वाला है, तो यह `droidpier stop` भी दिखाता है। अगर कोई दूसरा प्रोग्राम पोर्ट इस्तेमाल कर रहा है, तो यह बताता है, दूसरा पोर्ट सुझाता है, और बंद हो जाता है।

<!-- verify: phase 3 -->
जब Android SDK के हिस्से मौजूद नहीं होते, तो गेटवे हर एक को उसे हाथ से इंस्टॉल करने की कमांड के साथ दिखाता है, और सेटअप पेज पर पूरा करने को कहता है। यह Terminal में कभी कुछ नहीं पूछता: इंस्टॉल, नए डिवाइस और लाइसेंस की पुष्टि पेज पर होती है। [पहली बार चलाना](/hi/docs/getting-started/first-run/#2-let-it-check-your-android-sdk) देखें।

## इस्तेमाल होने वाली फ़ाइलें और पोर्ट

| क्या | कहाँ |
|---|---|
| गेटवे का listen पता | `127.0.0.1:<port>` |
| चल रहे एमुलेटर की खोज | `~/Library/Caches/TemporaryItems/avd/running/pid_<pid>.ini` |

<!-- verify: phase 2 -->
| क्या | कहाँ |
|---|---|
| गेटवे जो एमुलेटर gRPC पोर्ट असाइन करता है | `8554` से पहला ख़ाली सम (even) पोर्ट |

<!-- verify: phase 3 -->
| क्या | कहाँ |
|---|---|
| इंस्टॉल की गई executable फ़ाइल | `~/.local/bin/droidpier` |
| इंस्टॉल किए गए वर्ज़न का checksum | `~/.local/share/droidpier/installed.sha256` |
| बैकग्राउंड गेटवे की सेटिंग | `~/Library/LaunchAgents/dev.devpier.droidpier.plist` |
| बैकग्राउंड गेटवे का लॉग | `~/Library/Logs/Droidpier/droidpier.log` |
