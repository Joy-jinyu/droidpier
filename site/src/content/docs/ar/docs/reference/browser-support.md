---
title: دعم المتصفحات
description: يدعم Droidpier متصفحَي Chrome وEdge. يحظر Safari الاتصال بالبوابة المحلية، وFirefox غير مدعوم.
sourceHash: f0d75b070eb1
---

| المتصفح | مدعوم |
|---|---|
| Google Chrome | نعم |
| Microsoft Edge | نعم |
| Safari | لا |
| Firefox | لا |

أُجريت القياسات الواردة في صفحة [المتطلبات](/ar/docs/getting-started/requirements/#measured-performance) في Chrome 157.

## لماذا لا يعمل Safari

تُقدَّم الصفحة عبر `https`، وتتصل بالبوابة على جهاز Mac الخاص بك باستخدام `ws://127.0.0.1` (أو `ws://localhost`)، وهو اتصال غير مشفّر. يعدّ Safari هذا محتوى مختلطًا (اتصالًا غير آمن من صفحة آمنة) ويحظره. لا تستطيع الصفحة الوصول إلى البوابة في Safari.

## Firefox

Firefox غير مدعوم.

## كيف تتحقق الصفحة من المتصفح

<!-- verify: phase 3 -->
تقرأ الصفحة `navigator.userAgentData.brands`. ولا تتابع إلا إذا احتوت القائمة على `Google Chrome` أو `Microsoft Edge`. وإلا فإنها تطلب منك فتح الصفحة في Chrome أو Edge ولا تحاول الاتصال.

<!-- verify: phase 3 -->
لا يوفر Safari وFirefox الكائن `navigator.userAgentData`، لذلك يُرفضان. وتُرفض كذلك المتصفحات الأخرى المبنية على Chromium التي لا تُبلغ عن العلامة التجارية Chrome أو Edge.

## الوصول إلى الشبكة المحلية في Chrome

<!-- verify: phase 3 -->
- منذ Chrome 147، يجب على صفحة `https` عامة تتصل بـ `localhost` أن تحصل أولًا على إذن المستخدم. يسأل Chrome مرة واحدة ويتذكر الإجابة للموقع.
- منذ Chrome 154، يمكن للصفحة أن تذكر أنها تتصل بعنوان الاسترجاع (`targetAddressSpace: "loopback"` عند فتح WebSocket). تفعل الصفحة ذلك، وتعود إلى WebSocket عادي في الإصدارات التي لا تدعم هذا الخيار.
- منذ Chrome 156، لم يعد بإمكان سياسة المؤسسة إيقاف هذا التحقق.

إذا رفضت الإذن، راجع [استكشاف الأخطاء وإصلاحها](/ar/docs/guides/troubleshooting/#chrome-blocked-local-network-access).
