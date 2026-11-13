/**
 * 首页动效：随滚动出现、在视口内才运行的循环动画、安装命令打字效果、“暂停动画”开关。
 *
 * 状态都挂在 <html> 的 class 上：
 * - emu-motion：未开启减少动态效果。由 Hero 里的内联脚本提前加上（避免闪烁）。
 * - emu-paused：用户按了“暂停动画”。同样由内联脚本按 localStorage 提前恢复。
 * - emu-reveal-ready：只由 initMotion 加。随滚动出现的“先隐藏”状态依赖它，
 *   所以这个模块没加载成功时内容照样可见。
 * 状态变化时在 document 上派发 emu:motion，JS 驱动的动效据此暂停或恢复。
 */

const query = "(prefers-reduced-motion: reduce)";
const PAUSE_KEY = "emu-motion-paused";
const root = document.documentElement;

export function reducedMotion(): boolean {
  return matchMedia(query).matches;
}

/** 循环动效是否应该停下：系统减少动态效果，或用户按了暂停 */
export function motionStopped(): boolean {
  return reducedMotion() || root.classList.contains("emu-paused");
}

function announce(): void {
  document.dispatchEvent(new CustomEvent("emu:motion"));
}

const revealAll = () =>
  document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-in"));

/**
 * 进入视口时给 [data-reveal] 加 .is-in（一次性）；
 * 给 [data-live] 在视口内时加 .is-live、离开时去掉，用来暂停循环动画。
 */
function observe(): void {
  const reveal = document.querySelectorAll<HTMLElement>("[data-reveal]");
  const live = document.querySelectorAll<HTMLElement>("[data-live]");

  if (reducedMotion()) {
    revealAll();
    return;
  }
  root.classList.add("emu-reveal-ready");

  const revealIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        e.target.dispatchEvent(new CustomEvent("emu:reveal"));
        revealIo.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  reveal.forEach((el) => revealIo.observe(el));

  const liveIo = new IntersectionObserver((entries) => {
    for (const e of entries) {
      e.target.classList.toggle("is-live", e.isIntersecting);
      e.target.dispatchEvent(new CustomEvent(e.isIntersecting ? "emu:enter" : "emu:leave"));
    }
  });
  live.forEach((el) => liveIo.observe(el));
}

/** 正在打字的元素及其完整文字；动效被停掉时一次性补全 */
const typing = new Map<HTMLElement, string>();

function finishTyping(): void {
  for (const [el, text] of typing) el.textContent = text;
  typing.clear();
}

/**
 * 打字效果：元素原本就有完整文字（禁用 JS 时直接可见），这里清空后逐字打回去。
 * 调用方负责让这份文字 aria-hidden，并另外保留一份完整文字给读屏。
 * 用 setTimeout 而不是动画对象，打完就没有任何东西在运行。
 */
export function typeOut(el: HTMLElement, stepMs = 32): void {
  const text = el.textContent ?? "";
  if (motionStopped() || text.length === 0) return;
  typing.set(el, text);
  el.textContent = "";
  let i = 0;
  const tick = () => {
    if (!typing.has(el)) return;
    i += 1;
    el.textContent = text.slice(0, i);
    if (i < text.length) setTimeout(tick, stepMs);
    else typing.delete(el);
  };
  setTimeout(tick, stepMs);
}

function initTyping(): void {
  document.querySelectorAll<HTMLElement>("[data-type]").forEach((el) => {
    const host = el.closest<HTMLElement>("[data-reveal]");
    if (!host || host.classList.contains("is-in")) {
      typeOut(el);
      return;
    }
    host.addEventListener("emu:reveal", () => typeOut(el), { once: true });
  });
}

/** 系统设置中途切换到减少动态效果时，立刻给出最终状态并通知视频暂停 */
function watchPreference(): void {
  matchMedia(query).addEventListener("change", (e) => {
    root.classList.toggle("emu-motion", !e.matches);
    if (e.matches) {
      // 去掉 emu-reveal-ready 连同它的过渡一起去掉，元素直接到最终状态
      root.classList.remove("emu-reveal-ready");
      revealAll();
      finishTyping();
    }
    announce();
  });
}

function setPaused(paused: boolean): void {
  root.classList.toggle("emu-paused", paused);
  try {
    if (paused) localStorage.setItem(PAUSE_KEY, "1");
    else localStorage.removeItem(PAUSE_KEY);
  } catch {
    // 隐私模式等情况下存不了，只影响“记住选择”
  }
  if (paused) finishTyping();
  announce();
}

/** “暂停动画”按钮：aria-pressed 表示已暂停，可见文字在 label / pressed-label 之间切换 */
function initToggles(): void {
  const toggles = document.querySelectorAll<HTMLButtonElement>("[data-motion-toggle]");
  const sync = () => {
    const paused = root.classList.contains("emu-paused");
    toggles.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(paused));
      const text = btn.querySelector<HTMLElement>("[data-motion-text]");
      if (text) text.textContent = (paused ? btn.dataset.pressedLabel : btn.dataset.label) ?? "";
    });
  };
  toggles.forEach((btn) =>
    btn.addEventListener("click", () => setPaused(!root.classList.contains("emu-paused"))),
  );
  document.addEventListener("emu:motion", sync);
  sync();
}

export function initMotion(): void {
  observe();
  initTyping();
  initToggles();
  watchPreference();
}
