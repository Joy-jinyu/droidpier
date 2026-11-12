# SDD ledger — plan: docs/superpowers/plans/2026-11-11-phase2b-h5-debug.md
Spec: docs/superpowers/specs/2026-11-11-android-emu-web-design.md §6.8. Branch feat/phase2b-h5-debug from main 189038a (phase 2 merged).

## Pre-flight scan
| Rows | Produces vs consumes | Finding |
|---|---|---|
| T1→T2 | portOf(socket), WebViewPage.frontendUrl | consistent |
| T1→T4 | createWebViews({serial,...}) bound to one serial | gap: phase 2 lets the page switch devices (emu.use) — webviews/reverses must follow the current session serial |
| T2→T4 | inspectUrl / route (a)/(b)/(c) | T4 reply shape depends on T2 ruling — consistent by design |
| T3→T4 | normalizeTarget, createReverses(exec), connectCdp/navigateAndCheck | consistent |
| T4→T5 | {t:webviews|inspect|navigate, rid} | consistent; connection.ts already has request/reply waiters from phase 2 T7 (emu.avds) — reuse that pattern |
| T1 self | tests vs code | consistent |
| T2 self | inspectUrl hard-codes 127.0.0.1 | ok for phase 2.5; phase 3 public origin handled there |
| T3 self | normalizeTarget("::::") error | consistent |
| T4 self | exit cleanup in main.ts signals | consistent |
| T5 self | panel "画面右侧" | phase 2 T7 layout: device list left, screen fit via ResizeObserver — panel must take space from the fit area, not overflow |
| all | `pnpm test` / `pnpm test:it` | pnpm on PATH is nvm node16 (can't run .ts) |

Pre-flight: Ruling: run tests as `node --test gateway/test/*.test.ts shared/test/*.test.ts` (and `EMU_IT=1 node --test <it file>`) instead of pnpm — pnpm resolves to node16 — cost: none
Pre-flight: Ruling: webviews + reverses are per device: server creates them for the current session serial and closes/recreates on device switch (T4 owns the wiring; T1/T3 APIs unchanged since they take serial/exec) — spec talks about "the" emulator, phase 2 added switching — cost: small extra wiring in T4
Pre-flight: Ruling: T5 panel sits right of the screen inside the fit area; screen keeps fitting the remaining space (no overflow at 1400x800) — cost: none
Pre-flight: test app com.example.app.debug (a debug build with WebView debugging on) installed, device userdebug, no existing adb forward/reverse on emulator-5554 (verified)
Task 1: BASE 189038a; dispatched implementer (sonnet)
Task 1: implementer DONE_WITH_CONCERNS 972f9f9 (6 unit pass, it pass)
Task 1: review: Changes required — Important: freePort may hijack a foreign forward (ECONNRESET=free), module counter race; Minor: unused serial, doesNotThrow on async. Fix round 1 sent (all 4)
Task 1: fix round 1/5 implementer DONE c702f41 (8 unit pass, it pass)
Task 1: re-review round 1: all 4 addressed, no new Critical/Important
Task 1: note for Task 4: production wiring must pass freePort AND releasePort together (releasePort optional → leaked reservations otherwise)
Task 1: complete (commits 189038a..c702f41, review clean after fix round 1)
Task 2: BASE c702f41
Task 2: Ruling: server takes portOf as an injected optional dep (missing/unknown → 4404); real webviews wired in Task 4 — cost: none. Dispatched implementer (opus)
Task 2: implementer DONE d477647 (proxy tests 10/10, related 166 pass)
Task 2: Ruling: route (a) hosted DevTools front-end + gateway proxy — verified in Chrome 157 temp profile: handshake 101, Elements shows the test H5 page DOM, Network 15 requests after reload, no local-network prompt observed; WebView endpoint 403s any Origin so stripping is required, (b)/(c) unnecessary — cost if wrong: Task 5 falls back to (c) hint
Task 2: note for Task 4/5: inspectUrl returns string|undefined (frontendUrl optional) → Task 4 replies hint when undefined; first cold open may show blank Elements → hint "空白时在 DevTools 里按 Cmd+R"; hosted front-end needs chrome-devtools-frontend.appspot.com reachable
Task 2: review: spec ✅, quality Approved
Task 2: Ruling: reviewer "Important" server close() not terminating wss.clients not yet in conns — pre-existing, effect only a shutdown race; re-graded Minor and folded into Task 4 (owns server.ts/main.ts exit cleanup) — cost: tiny
Task 2: minor (deferred): proxy tests don't assert close codes (1011 on upstream error, 1000 passthrough)
Task 2: minor (deferred): sendableCode maps 2000-2999 to 1000 without a note
Task 2: complete (commits c702f41..d477647, review clean)
Task 3: BASE d477647
Task 3: implementer DONE 35c350f (16/16 targeted, 182 pass related)
Task 3: review: Changes required — loadEventFired listener registered after navigate reply (fast load → false timeout); concurrent ensure runs reverse twice (re-graded Important: adb reverse is idempotent, effect small); minor [::1] test. Fix round 1 sent
Task 3: fix round 1/5 implementer DONE f60ba53 (20/20 targeted, 186 pass)
Task 3: re-review round 1: all 3 addressed, no new breakage
Task 3: Ruling: re-review out-of-scope — removeAll ignores in-flight reverses (a reverse finishing after shutdown cleanup leaks) — folded into Task 4 (exit cleanup owner) — cost: tiny
Task 3: complete (commits d477647..f60ba53, review clean after fix round 1)
Task 4: BASE f60ba53
Task 4: dispatched implementer (opus) with task-4-brief.md + task-4-extra.md
Task 4: implementer DONE 2f1563d (201 pass, it 1/1; live exit cleanup: forward/reverse lists empty after SIGTERM)
Task 4: Ruling: exit cleanup lives in server close() (tools are per device inside the server) instead of main.ts calling webviews.close()/reverses.removeAll() directly — main.ts awaits close(); verified live — cost: none
Task 4: Ruling: accept extra reply {t:"inspect",rid,error} (page gone / listing failed) — otherwise the rid never resolves; Task 5 must handle it — cost: none
Task 4: review: spec ✅, quality Approved, no Critical/Important
Task 4: Ruling: re-graded reviewer minors to Important by effect — removeAll/close stop at first failed --remove (leak, Review Focus 5) and exit has no overall bound + second Ctrl+C ignored (hang) — fix round 1 sent, also folding minor 1 (terminate devtools proxies on device switch) — cost: one round
Task 4: minor (deferred): navigate without opts.debug replies 页面已关闭 (should say no device) — production always injects
Task 4: minor (deferred): wss.clients terminate test passes without the fix (defensive)
Task 4: fix round 1/5 implementer DONE ce407d1 (208 pass; live: SIGTERM exit 0.25s lists empty; 2nd SIGINT exits 0.057s)
Task 4: re-review round 1: all 3 addressed; new minor: exit.test.ts held the event loop ~10s (sleep(10_000)) — fixed by controller (sleep(200)), exit tests 4/4
Task 4: minor (deferred): list() and close() racing may removeForward the same socket twice (releasePort twice) — pre-existing
Task 4: complete (commits f60ba53..HEAD, review clean after fix round 1)
Task 5: BASE 6cc1957
Task 5: dispatched implementer (opus) with task-5-brief.md + task-5-extra.md
Task 5: Ruling (user instruction 2026-11-11): 审查 opens DevTools embedded in the current page (iframe pane), not a new tab — implementer told to verify framing (appspot headers, nsh CSP) and fall back to same-origin proxied front-end under /devtools-ui/ if needed; BLOCKED if neither works
Task 5: implementer DONE 41befbf (217 pass; 6/6 acceptance)
Task 5: Ruling: embedded DevTools via route (a): appspot front-end in an iframe with allow="local-network-access; local-network; loopback-network" (without it Chrome 157 blocks the ws with ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS); appspot sends no frame-blocking headers, nsh CSP only restricts connect-src — cost if wrong: switch to same-origin proxied front-end
Task 5: Ruling: accept out-of-scope gateway change — via adb reverse a dead local server yields net::ERR_EMPTY_RESPONSE; mapped to 连不上这个地址… only when a reverse was made (server.ts/cdp.ts, test first) — cost: none
Task 5: minor (deferred): data: preload page reported visible:true (never_attached/empty) is not marked 后台 — changing the rule is an owner decision
Task 5: minor (deferred): toolbar wraps to 2 rows when the DevTools pane is open (~420px middle column)
Task 5: review: spec ✅ (user override honored); Changes required — Important: iframe src unvalidated (fake devtools socket → javascript:/any https framed with local-network delegation); 3s poll continues while tab hidden. Fix round 1 sent incl. minors: drop clipboard-read, pane shows 页面已关闭 when its page/device goes away, ignore late inspect replies
Task 5: minor (deferred): stale list still clickable while disconnected (navigate fails fast)
Task 5: minor (deferred): ui/ellipsis and host/pending tests live under shared/test
Task 5: fix round 1/5 implementer committed 3b0d87f (223 pass): src allow-list at gateway+host, poll pauses when hidden, clipboard-read dropped, pane shows 页面已关闭; user-reported false 页面已关闭 root cause = /json timeout dropped socket's pages + list failure returned [] → keep last /json per live socket, reply error; Ruling: screencast pane removed by rewriting inspector.html → devtools_app.html (pending live check)
Task 5: env: adb shell wedged ~10:21 (adbd in guest). With user approval: adb kill-server/start-server (still offline) → gRPC setVmState RESET; device back, boot_completed=1. Implementer resumed to finish live re-verification; told to bound every adb shell with a timeout
Task 5: fix round 1 live re-verification passed (devtools_app.html: no screencast, panels work; 52 samples no false 页面已关闭; real close 1.0s; hidden-tab poll 0; cleanup empty)
Task 5: re-review round 1: all 6 addressed (incl. 2 user additions), no new breakage
Task 5: minor (deferred): per-socket /json cache has no TTL — a live socket whose /json keeps timing out keeps showing the last pages
Task 5: minor (deferred): late inspect reply discard verified by reading only
Task 5: complete (commits 6cc1957..3b0d87f, review clean after fix round 1)
Final review: dispatched (opus) on 189038a..3b0d87f
Final review: With fixes, no Critical. Important 1: data: preload page (visible:true + never_attached/empty) not marked 后台 (Review Focus 2 example)
Final: Ruling (user decision 2026-11-11): never_attached or empty counts as not visible → 后台, sorted after, dimmed
Final: Ruling: re-graded to fix in the final pass by effect — navigate has no overall cap (can exceed host's 15s → misleading 网关没有回应); forward failure leaks a reserved port; no backoff while adb fails (real adbd wedge happened this phase); no-device shows 没有可审查的 H5 instead of a device message
Final: minor (deferred): /devtools handshake has no Origin allow-list before phase 3 auth (not worse than main ws)
Final: minor (deferred): exit cap 3s < adb 5s timeout → a wedged adb leaves forwards (next start unaffected)
Final: fixed 5 items in 9d2b7dd (preload page → 后台, navigate 12s cap, release port on forward failure, adb failure backoff 3/6/12/30s, 没有连接设备) — each RED→GREEN, suite 229/229 pass (8 skipped it)
