/** 测试用的 SDK 仓库清单，结构照抄 Google 的官方清单；sha1 用 H("x") 这种 40 位的假值。 */
export const H = (c: string) => c.repeat(40);

/** 结构照抄 2026-11-13 读的 repository2-3.xml：emulator 有 beta 和稳定两份，各有 x64 / aarch64；platform-tools 不写 host-arch。 */
export const REPO = `<?xml version='1.0' encoding='utf-8'?>
<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/sdk/android/repo/repository2/03" xmlns:common="http://schemas.android.com/repository/android/common/02" xmlns:generic="http://schemas.android.com/repository/android/generic/02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <license id="android-sdk-license" type="text">Terms &amp; &quot;Conditions&quot;

January 16, 2019
</license>
  <license id="android-sdk-preview-license" type="text">Preview terms
</license>
  <channel id="channel-0">stable</channel>
  <channel id="channel-1">beta</channel>
  <remotePackage path="emulator">
    <type-details xsi:type="generic:genericDetailsType"/>
    <revision><major>37</major><minor>3</minor><micro>9</micro></revision>
    <display-name>Android Emulator</display-name>
    <uses-license ref="android-sdk-license"/>
    <channelRef ref="channel-1"/>
    <archives>
      <archive><complete><size>1</size><checksum type="sha1">${H("1")}</checksum><url>emulator-darwin_aarch64-beta.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
    </archives>
  </remotePackage>
  <remotePackage path="emulator">
    <type-details xsi:type="generic:genericDetailsType"/>
    <revision><major>37</major><minor>2</minor><micro>13</micro></revision>
    <display-name>Android Emulator</display-name>
    <uses-license ref="android-sdk-license"/>
    <dependencies><dependency path="patcher;v4"/></dependencies>
    <channelRef ref="channel-0"/>
    <archives>
      <archive><complete><size>488733162</size><checksum type="sha1">${H("2")}</checksum><url>emulator-darwin_x64-16740729.zip</url></complete><host-os>macosx</host-os><host-arch>x64</host-arch></archive>
      <archive><complete><size>416113219</size><checksum type="sha1">${H("3")}</checksum><url>emulator-darwin_aarch64-16740729.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
      <archive><complete><size>9</size><checksum type="sha1">${H("4")}</checksum><url>emulator-linux_x64-16740729.zip</url></complete><host-os>linux</host-os></archive>
    </archives>
  </remotePackage>
  <remotePackage path="emulator">
    <type-details xsi:type="generic:genericDetailsType"/>
    <revision><major>36</major><minor>9</minor></revision>
    <display-name>Android Emulator</display-name>
    <uses-license ref="android-sdk-license"/>
    <channelRef ref="channel-0"/>
    <archives>
      <archive><complete><size>5</size><checksum type="sha1">${H("5")}</checksum><url>emulator-darwin_aarch64-old.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
    </archives>
  </remotePackage>
  <remotePackage path="platform-tools">
    <type-details xsi:type="generic:genericDetailsType"/>
    <revision><major>37</major><minor>0</minor><micro>1</micro></revision>
    <display-name>Android SDK Platform-Tools</display-name>
    <uses-license ref="android-sdk-license"/>
    <channelRef ref="channel-0"/>
    <archives>
      <archive><complete><size>16110554</size><checksum type="sha1">${H("6")}</checksum><url>platform-tools_r37.0.1-darwin.zip</url></complete><host-os>macosx</host-os></archive>
      <archive><complete><size>7</size><checksum type="sha1">${H("7")}</checksum><url>platform-tools_r37.0.1-linux.zip</url></complete><host-os>linux</host-os></archive>
    </archives>
  </remotePackage>
</sdk:sdk-repository>`;

/** 结构照抄 sys-img/google_apis/sys-img2-3.xml：系统镜像的 archive 不写 host-os。 */
export const SYS_IMG = `<?xml version='1.0' encoding='utf-8'?>
<sys-img:sdk-sys-img xmlns:sys-img="http://schemas.android.com/sdk/android/repo/sys-img2/03" xmlns:common="http://schemas.android.com/repository/android/common/02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <license id="android-sdk-arm-dbt-license" type="text">ARM terms
</license>
  <channel id="channel-0">stable</channel>
  <remotePackage path="system-images;android-34;google_apis;arm64-v8a">
    <type-details xsi:type="sys-img:sysImgDetailsType"><api-level>34</api-level><tag><id>google_apis</id><display>Google APIs</display></tag><vendor><id>google</id><display>Google Inc.</display></vendor><abi>arm64-v8a</abi></type-details>
    <revision><major>14</major></revision>
    <display-name>Google APIs ARM 64 v8a System Image</display-name>
    <uses-license ref="android-sdk-arm-dbt-license"/>
    <channelRef ref="channel-0"/>
    <archives>
      <archive><complete><size>1610393229</size><checksum type="sha1">${H("8")}</checksum><url>arm64-v8a-34_r14.zip</url></complete></archive>
    </archives>
  </remotePackage>
</sys-img:sdk-sys-img>`;
