# SDD ledger — plan: docs/superpowers/plans/2026-11-11-phase1-usable.md
Spec: docs/superpowers/specs/2026-11-11-android-emu-web-design.md
Branch: feat/phase1-usable (from feat/phase0-spike @ e22bb5c)

## Pre-flight scan
| pair / task | produces vs consumes | finding |
|---|---|---|
| T1→T2 | ClientMsg (key/text/touch) used by keyToMsg/textToMsgs | consistent |
| T1→T4 | protocol (hello/ready/status/resize, 20-byte header w/ BIN_FRAME), platform.ts | consistent |
| T1→T5 | decodeFrameHeader/binKind in host | consistent |
| T2→T3 | toDevice used by pointer tracker | consistent |
| T2→T5 | keyToMsg/textToMsgs in host | consistent |
| T3→T5 | createPointerTracker in host main | consistent |
| T4→T5 | ws://127.0.0.1:7300, hello/ready flow, static dir | static dir path ambiguous (see ruling) |
| T1 self | tests vs signatures; modifies sdk.ts/discovery.ts imports | ok |
| T2 self | tests vs rules | ok |
| T3 self | test file in shared/test imports host/src/pointer.ts (no DOM) | ok |
| T4 self | emulator.it.test.ts matches pnpm test glob gateway/test/*.test.ts | ok — must self-skip without EMU_IT=1 |
| T5 self | deletes ui/host.js then regenerates it via bun build; nsh.json still points to ./host.js | ok — build:host must run before nsh package |
Pre-flight: Ruling: T4 static dir = repo-root `.nsh/out/Emu Web` (observed in phase 0 when running `nsh package ui` from repo root), plan says confirm in Step 6 — cost: one constant
Pre-flight: Ruling: T5 Step 3 "用户的 Chrome" acceptance done in a real Chrome (isolated profile, CDP-driven real input) with screenshots shown to user; tearing check by screenshot burst + user eyeball — cost: user may want to try it themselves
Task 1: minor (deferred): bench-server.ts stale '16 字节头' comment vs shared 20-byte protocol (spike code)
Task 1: complete (commits 9f8cc50..93eeca4, review clean)
Task 2: minor (deferred): test uses '中文 abc' (space) vs brief '中文abc' — behavior identical
Task 2: minor (deferred): control chars (	,
,0x7f) in textToMsgs go clipboard path — acceptable for multi-line paste
Task 2: complete (commits 130d538..f41198e, review clean)
Task 3: Ruling: re-graded reviewer Minor 1 (cancel releases at rect center) and Minor 2 (double down without release) to Important by effect — Android sees the finger jump to center before lifting (spurious swipe/tap) / a stuck second down — cost if wrong: one small fix round
Task 3: fix round 1/5 (2 addressed, 0 open; commits 73d2129..5fb0243)
Task 3: complete (commits f41198e..5fb0243, review clean)
Task 3: minor (deferred): reviewer noted RED evidence was module-not-found (acceptable)
Task 4: Ruling: re-graded reviewer Minor 1 (non-integer frame size → mmap truncate fails, no frames ever) to Important — browser zoom 125% gives fractional DPR, which is plan Review Focus 2 — cost if wrong: small fix
Task 4: minor (deferred): session closed between getSession and onClosed registration (≤1s window); frames() after closed creates temp file
Task 4: minor (deferred): touch/key/text during hello processing silently dropped
Task 4: minor (deferred): test name "客户端不读" doesn't model a paused socket
Task 4: minor (deferred): only SIGINT handled; SIGTERM leaves mmap temp files
Task 4: minor (deferred): missing hw.lcd.* yields NaN device instead of reject
Task 4: minor (deferred): screenshot stream 'end' not handled
Task 4: fix round 1/5 (5 addressed, 0 open; commits 7a5ac89..7454f22)
Task 4: minor (deferred): enqueue captures conn.session at enqueue time (benign now; conn closes on emulator-closed)
Task 4: minor (deferred): main.ts `last` not cleared when session closes (close() idempotent)
Task 4: complete (commits 5fb0243..7454f22, review clean)
Task 5: minor (deferred): latency modulo wraps to ~4.29e9 when page clock < tsMs (main.ts:185, server.ts:108); per-second avg not "latest frame" (spec 6.7) — fix with phase 2 status display
Task 5: minor (deferred): rAF loop wakes every frame when idle (no GL work) — check in phase 2 Task 7 idle CPU
Task 5: minor (deferred): last frame stays on screen after disconnect/emulator exit (dim/clear)
Task 5: minor (deferred): non-composition input (dead keys, emoji picker, Cmd+V into textarea) dropped — phase 2 clipboard task
Task 5: minor (deferred): emu.key returns {ok:true} while disconnected
Task 5: minor (deferred): connection.ts JSON.parse no try/catch; no pixels.length check; Ctrl/Alt combos forward bare letter; Tab trapped; aria-hidden on focused textarea; no focus ring
Task 5: minor (deferred): build:ui hardcodes user-specific nsh/llvm paths — phase 3 packaging
Task 5: Ruling: implementer kept "模拟器已关闭" sticky over later no-emulator status and focused a hidden textarea for IME — matches Step 4 expectation / IME needs editable element — cost: none
Task 5: complete (commits 7454f22..b345e86, review clean)
Final review: opus, 0 Critical / 2 Important / 6 Minor; verdict "基本可以收尾，还需要一处小修"
Final: Ruling: Important 1 (stuck key/touch on blur, tab hidden, ws close) + SIGTERM/SIGHUP cleanup → one fix dispatch now — cost: small
Final: Ruling: Important 2 (gateway keeps streaming while tab hidden) → deferred into phase 2 Task 7 (pause/resume on visibilitychange), written into the phase 2 plan — cost: CPU burn while tab hidden until phase 2
Final: minor (deferred): per-frame 10MB alloc + Buffer.concat copy (emulator.ts:82, server.ts:95)
Final: minor (deferred): findRunning returns lowest live pid; doesn't try next on connect failure (pid reuse)
Final: minor (deferred): renderer lacks webglcontextlost handling
Final: minor (deferred): phase-0 tools (bench-server, fps-probe, smoke) live in gateway/src — move to spike/ before phase 3 packaging
Final: minor (deferred): Review Focus 3 (drag out of canvas) only unit-tested, not in real browser
Final: minor (deferred): CSS 540x1170 fixed; other aspect ratios stretch — phase 3
Final: fixed stuck keys/touches on blur/hidden/close + SIGTERM/SIGHUP — tests held-keys x3, server x2 RED→GREEN, suite 53/53 (4 skipped); re-review all addressed
Final: minor (deferred): cleanup handler not idempotent if two signals arrive (double srv.close)
