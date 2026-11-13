/** 侧栏搜索：显示名或 id 里含有查询词就算匹配，不分大小写；空查询全部匹配。 */
export function matchesAvd(a: { name: string; displayName?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return a.name.toLowerCase().includes(q) || (a.displayName ?? "").toLowerCase().includes(q);
}
