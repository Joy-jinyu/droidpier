// 试验：起一个独立配置的 Chrome，经 CDP 在测速页上依次跑各模式，并同时采样 qemu / 网关 CPU
// 用法：node spike/drive-chrome.ts <qemuPid> <gatewayPid> [mode...]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const [qemu, gw, ...modesArg] = process.argv.slice(2);
const modes = modesArg.length ? modesArg : ["rgba", "rgba-mmap", "jpeg", "png"];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9447;
const chrome = spawn(CHROME, [
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "emu-bench-chrome-"))}`,
  `--remote-debugging-port=${port}`,
  "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "--window-size=900,1250", "http://127.0.0.1:8765/",
], { stdio: "ignore" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let target: any;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list: any[] = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:8765"));
  } catch {}
}
if (!target) throw new Error("Chrome 未就绪");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const cdp = (method: string, params: object = {}) =>
  new Promise<any>((res) => {
    const my = ++id;
    const on = (raw: any) => {
      const m = JSON.parse(raw.toString());
      if (m.id === my) { ws.off("message", on); res(m.result); }
    };
    ws.on("message", on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
await sleep(2000);

const results = [];
for (const mode of modes) {
  const samples: Record<string, number[]> = { qemu: [], gw: [] };
  const timer = setInterval(() => {
    const out = execFileSync("ps", ["-o", "pid=,%cpu=", "-p", `${qemu},${gw}`]).toString().trim().split("\n");
    for (const line of out) {
      const [pid, cpu] = line.trim().split(/\s+/);
      (pid === qemu ? samples.qemu : samples.gw).push(Number(cpu));
    }
  }, 1000);
  const r = await cdp("Runtime.evaluate", { expression: `runBench(${JSON.stringify(mode)})`, awaitPromise: true, returnByValue: true });
  clearInterval(timer);
  const avg = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0);
  const v = r.result.value;
  results.push({ ...v, qemuCpu: avg(samples.qemu), gwCpu: avg(samples.gw) });
  console.log(JSON.stringify(results.at(-1)));
}
ws.close();
chrome.kill();
