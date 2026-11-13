---
title: ब्राउज़र सपोर्ट
description: Droidpier Chrome और Edge को सपोर्ट करता है। Safari लोकल गेटवे से कनेक्शन ब्लॉक करता है, और Firefox सपोर्टेड नहीं है।
sourceHash: f0d75b070eb1
---

| ब्राउज़र | सपोर्टेड |
|---|---|
| Google Chrome | हाँ |
| Microsoft Edge | हाँ |
| Safari | नहीं |
| Firefox | नहीं |

[ज़रूरतें](/hi/docs/getting-started/requirements/#measured-performance) पेज पर दिए गए माप Chrome 157 में लिए गए थे।

## Safari काम क्यों नहीं करता

पेज `https` पर सर्व होता है, और यह आपके Mac पर गेटवे से `ws://127.0.0.1` (या `ws://localhost`) के ज़रिए कनेक्ट होता है, जो एन्क्रिप्टेड नहीं है। Safari इसे mixed content (सुरक्षित पेज से असुरक्षित कनेक्शन) मानता है और ब्लॉक कर देता है। Safari में पेज गेटवे तक नहीं पहुँच सकता।

## Firefox

Firefox सपोर्टेड नहीं है।

## पेज ब्राउज़र की जाँच कैसे करता है

<!-- verify: phase 3 -->
पेज `navigator.userAgentData.brands` पढ़ता है। यह तभी आगे बढ़ता है जब सूची में `Google Chrome` या `Microsoft Edge` हो। नहीं तो यह आपसे पेज को Chrome या Edge में खोलने को कहता है और कनेक्ट करने की कोशिश नहीं करता।

<!-- verify: phase 3 -->
Safari और Firefox `navigator.userAgentData` नहीं देते, इसलिए उन्हें अस्वीकार कर दिया जाता है। Chromium पर आधारित दूसरे ब्राउज़र जो Chrome या Edge ब्रांड नहीं बताते, उन्हें भी अस्वीकार कर दिया जाता है।

## Chrome में लोकल नेटवर्क एक्सेस

<!-- verify: phase 3 -->
- Chrome 147 से, `localhost` से कनेक्ट होने वाले किसी पब्लिक `https` पेज को पहले उपयोगकर्ता की अनुमति लेनी होती है। Chrome एक बार पूछता है और उस साइट के लिए जवाब याद रखता है।
- Chrome 154 से, पेज बता सकता है कि वह loopback पते से कनेक्ट हो रहा है (WebSocket खोलते समय `targetAddressSpace: "loopback"`)। पेज ऐसा करता है, और जिन वर्शन में यह विकल्प सपोर्टेड नहीं है उन पर सामान्य WebSocket इस्तेमाल करता है।
- Chrome 156 से, enterprise policy इस जाँच को अब बंद नहीं कर सकती।

अगर आपने अनुमति मना कर दी थी, तो [समस्या निवारण](/hi/docs/guides/troubleshooting/#chrome-blocked-local-network-access) देखें।
