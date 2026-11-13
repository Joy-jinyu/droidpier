import type { SystemImage } from "./protocol.ts";

/** 一台 AVD 要的空闲空间（MB）：模拟器 32.1 第一次启动时的检查“Not enough space to create userdata partition … need 12288 MB”（2026-11-12 实测）。 */
export const AVD_DISK_MB = 12288;

/** 没有已安装的镜像时默认选的级别。 */
const FALLBACK_API = "34";

/** 机型名 + 级别拼出的默认设备名，如 Pixel_5_API_34。 */
export function defaultAvdName(modelName: string, api: string): string {
  const base = modelName.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]/g, "").replace(/_+/g, "_").replace(/^[^A-Za-z0-9]+/, "");
  return `${base}_API_${api}`;
}

/** 设备名不能用时的原因；能用返回 null。规则：^[A-Za-z0-9][A-Za-z0-9._-]*$。existing 不分大小写比较（macOS 的文件系统默认不分）。 */
export function avdNameError(name: string, existing: string[]): string | null {
  if (name === "") return "请输入设备名";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "设备名只能用英文字母、数字、点、下划线和短横线";
  // 开头是 - 时命令行（emulator -avd、avdmanager）会把它当成选项
  if (!/^[A-Za-z0-9]/.test(name)) return "设备名要以英文字母或数字开头";
  const same = existing.find((n) => n.toLowerCase() === name.toLowerCase());
  return same ? `已有同名设备 ${same}` : null;
}

/** 显示名的长度上限（字符）：侧栏一行放得下，再长也看不全。 */
export const DISPLAY_NAME_MAX = 50;

/** 显示名不能用时的原因；能用返回 null。它是 config.ini 里的一行，所以不能有换行等控制字符。 */
export function displayNameError(name: string): string | null {
  const t = name.trim();
  if (t === "") return "请输入名称";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "名称里不能有换行等控制字符";
  if ([...t].length > DISPLAY_NAME_MAX) return `名称最多 ${DISPLAY_NAME_MAX} 个字`;
  return null;
}

/** 新设备的内存（MB）：低于 API 28 的镜像用 2048，其余 4096。 */
export function ramMbFor(apiLevel: number): number {
  return apiLevel < 28 ? 2048 : 4096;
}

/** 默认选中的系统版本：已安装里 API 最高的；没有已安装的就选 android-34，再没有选第一个。 */
export function pickDefaultImage(images: SystemImage[]): SystemImage | null {
  const installed = images.filter((i) => i.installed).sort((a, b) => Number(b.api) - Number(a.api));
  return installed[0] ?? images.find((i) => i.api === FALLBACK_API) ?? images[0] ?? null;
}

/** 建这台设备要算进磁盘检查的项（给 spaceCheck）：镜像没装时加上镜像。 */
export function createItems(image: SystemImage) {
  const avd = { id: "avd", diskMb: AVD_DISK_MB };
  return image.installed ? [avd] : [{ id: "system-image", sizeMb: image.sizeMb, diskMb: image.diskMb }, avd];
}
