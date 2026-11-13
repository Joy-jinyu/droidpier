/** 读这台浏览器存的一项设置；存储不可用（隐私模式、被禁用）时当作没存过。 */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 存一项设置；存不了返回 false，页面照常用这次的值。 */
export function writePref(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
