/** 磁盘余量：装完之后每块盘至少还要留这么多。 */
const MARGIN_MB = 1024;

/** MB 换成“x.y GB”，页面和网关的提示都用它。 */
export function gbText(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`;
}

type Item = { id: string; sizeMb?: number; diskMb?: number };
type Disks = { freeMb: number; avdFreeMb: number; sameDisk: boolean };

/**
 * 要装的这些项需要多少磁盘：下载 + 安装后占用 + 余量。avd 记在 AVD 目录那块盘上，其余记在 SDK 那块盘上；
 * shortMb 是差得最多的那块盘还差多少，够用时为 0。页面确认框和网关收到 install 时都用它。
 */
export function spaceCheck(items: Item[], disks: Disks) {
  const need = (list: Item[]) => list.reduce((n, i) => n + (i.sizeMb ?? 0) + (i.diskMb ?? 0), 0);
  const downloadMb = items.reduce((n, i) => n + (i.sizeMb ?? 0), 0);
  const diskMb = items.reduce((n, i) => n + (i.diskMb ?? 0), 0);
  const needMb = downloadMb + diskMb + MARGIN_MB;
  const avd = items.filter((i) => i.id === "avd");
  const short = disks.sameDisk
    ? needMb - disks.freeMb
    : Math.max(
        need(items.filter((i) => i.id !== "avd")) + MARGIN_MB - disks.freeMb,
        avd.length ? need(avd) + MARGIN_MB - disks.avdFreeMb : 0,
      );
  return { downloadMb, diskMb, needMb, shortMb: Math.max(0, short) };
}
