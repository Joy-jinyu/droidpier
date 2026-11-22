/** 侧栏搜索：任一文字（名字、id、型号）里含有查询词就算匹配，不分大小写；空查询全部匹配。 */
export function matchesText(query: string, ...texts: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return texts.some((t) => (t ?? "").toLowerCase().includes(q));
}

/** 模拟器行：显示名或 id。 */
export function matchesAvd(a: { name: string; displayName?: string }, query: string): boolean {
  return matchesText(query, a.name, a.displayName);
}

/**
 * 侧栏三组（模拟器、手机、MuMu）一起按查询词筛：每组只留匹配的；搜索时整个列表都没匹配才算 noMatch。
 * text 给出每种行拿来匹配的文字（名字、id、型号）。
 */
export function searchSidebar<A, P, M>(
  query: string,
  groups: { avds: A[]; phones: P[]; mumu: M[] },
  text: { avd(a: A): Array<string | undefined>; phone(p: P): Array<string | undefined>; mumu(m: M): Array<string | undefined> },
): { searching: boolean; avds: A[]; phones: P[]; mumu: M[]; noMatch: boolean } {
  const searching = query.trim() !== "";
  const avds = groups.avds.filter((a) => matchesText(query, ...text.avd(a)));
  const phones = groups.phones.filter((p) => matchesText(query, ...text.phone(p)));
  const mumu = groups.mumu.filter((m) => matchesText(query, ...text.mumu(m)));
  return { searching, avds, phones, mumu, noMatch: searching && avds.length === 0 && phones.length === 0 && mumu.length === 0 };
}
