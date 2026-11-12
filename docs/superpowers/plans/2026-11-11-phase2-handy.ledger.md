# SDD ledger — plan: docs/superpowers/plans/2026-11-11-phase2-handy.md
Spec: docs/superpowers/specs/2026-11-11-android-emu-web-design.md
Branch: feat/phase2-handy (from feat/phase1-usable @ f3e969c)
Carry-in: phase 1 deferred minors in docs/superpowers/plans/2026-11-11-phase1-usable.ledger.md

## Pre-flight scan
| pair / task | produces vs consumes | finding |
|---|---|---|
| T1→T2 | AvdInfo, listAvds, discovery avdName | consistent |
| T1 self | adds avdName to Discovery (discovery.ts owned by phase 1) | ok — additive optional field |
| T2 self | "会话改为可以切换": phase 1 has session-cache.ts + main.ts getSession | ruling below |
| T3→T5/T6/T7 | toDevice(…, rotation) used by pointer tracker & wheel | host must pass current rotation; App placeholder View is fixed 540x1170 | ruling below |
| T4 self | BIN_SCREENSHOT=2 reserved in phase 1 protocol | consistent |
| T5 self | Cmd+V paste path; phase-1 deferred minor: Cmd+V into textarea dropped | fold in |
| T6 self | wheelToSwipe in shared/input-map.ts | consistent |
| T7 self | UI + Step 2.5 pause/resume + idle CPU; phase-1 deferred: latency wrap, stale last frame, emu.key ok while disconnected, JSON.parse no try, rAF idle loop | fold in |
| all | each task edits shared/protocol.ts + gateway/src/server.ts + host/src/main.ts | sequential only (as required) |
Pre-flight: Ruling: T2 session switching builds on phase-1 session-cache.ts (cachedSession) — start/use invalidate the cache and point it at the new Running; no new abstraction — cost: none
Pre-flight: Ruling: T3 landscape needs the nsh placeholder View size to follow orientation; host pushes hostEvent emu.orientation and App.tsx swaps width/height — cost: one extra event
Pre-flight: Ruling: phase-1 deferred minors folded into T5 (Cmd+V in textarea) and T7 (latency wrap & latest-frame latency, stale frame dim on disconnect, emu.key {ok:false} when not connected, JSON.parse try/catch in connection.ts, rAF only when frames arrive) — cost: T5/T7 slightly larger
Task 1: minor (deferred): resolveConfigIni return type says undefined but never returns it
Task 1: minor (deferred): scanAllRunning duplicates kv parsing of parseDiscovery (extract parseKv)
Task 1: minor (deferred): emulatorBin()/adbBin() not injectable in listAvds deps
Task 1: fix round 1/5 (1 addressed, 0 open; commits 2e11f61..f05a46d)
Task 1: complete (commits f3e969c..f05a46d, review clean)
Task 2: Ruling: accept implementer's change — gateway keeps the WebSocket open on no-emulator/emulator-closed (no 4004 close) and rediscovers every 1s, so the page can send start without a device; CLOSE_NO_EMULATOR kept; host side adapts in Task 7 — cost: phase-1 host relies on 4004 reconnect path; reviewer to check behavior
Task 2: Ruling: re-graded reviewer Minor 3 (getprop exec no timeout), 4 (concurrent use leaks a session), 7 (use failure after boot leaves page on "booting"), 10 (no server-level test for Review Focus 2) to Important by effect — stuck UI / leaked gRPC client+interval / untested plan focus — cost: larger fix round
Task 2: minor (deferred): listAvds says grpc but findRunning(name) null → spawns anyway (emulator AVD lock prevents dup)
Task 2: minor (deferred): already-gRPC AVD considered ready without boot_completed check (brief mandates immediate ready)
Task 2: minor (deferred): boot.progress typed string; tighten to union
Task 2: minor (deferred): process.kill(-pid) POSIX-only outside platform.ts
Task 2: fix round 1/5 (6 addressed, 0 open; commits 018dbec..9ce5033)
Task 2: complete (commits f05a46d..9ce5033, review clean)
Task 3: Ruling: re-graded reviewer Minor 1 (rotation tracked only from own rotate calls) to Important — external rotation gives wrong taps = plan Review Focus 4; fix via img.format.rotation in drain() (~10 lines) — cost: one fix round
Task 3: minor (deferred): page opened while device already landscape → extra subscription / brief wrong aspect on first frame
Task 3: minor (deferred): concurrent rotate from two connections may only turn 90°
Task 3: minor (deferred): readModel failure defaults to 0° without a log
Task 3: minor (deferred): two server tests assert client msgs after waiting on server state; rotate-error branch untested
Task 3: fix round 1/5 (1 addressed, 0 open; commits cc9c515..3db5d4b)
Task 3: minor (deferred): no frame ⇒ no external-rotation update (no streamPhysicalModel in 32.1.14; polling would desync)
Task 3: minor (deferred): onRotation listeners can't be removed
Task 3: complete (commits 3153727..3db5d4b, review clean)
Task 4: Ruling: host derives the gateway ws URL from location (same host:port when the page is served by the gateway over http from 127.0.0.1/localhost), fallback ws://127.0.0.1:7300 — lets subagents test on 7301 while the user previews on 7300; also needed in phase 3 for the localhost fallback page — cost: none
Task 4: note for Task 7: host ConnState / App LABEL lack the 'booting' status added in Task 2 (tsserver error connection.ts:69) — page would show undefined label while booting
Task 4: fix round 1/5 (3 addressed, 0 open; commits afd554a..fce051f)
Task 4: minor (deferred): screenshotName doesn't sanitize avdName (SDK names are [A-Za-z0-9_.])
Task 4: complete (commits 3db5d4b..fce051f, review clean)
Task 5: side effect: implementer's first run overwrote the user's Mac clipboard (pbpaste got empty → possible image lost; later restore dropped HTML flavor) — reported to user
Task 5: cleanup: killed leftover test gateway 7301 (pid 55573, Task 4) and test Chrome 9452 (pid 44086)
Task 5: Ruling: reviewer Important 1 (brief mandates per-char ASCII paste vs Review Focus 5) — paste always goes {t:"text"} (clipboard+paste); textToMsgs stays for compositionend; plan text overridden by spec Review Focus 5 — cost: ASCII paste overwrites device clipboard (expected for paste)
Task 5: Ruling: re-graded Minor 3 (clip stream never reconnects), 5 (Option chars / emoji picker dropped by input handler), 4 (device-copy it test can write the user's Mac clipboard via their open page on 7300) to Important by effect — cost: larger fix round
Task 5: minor (deferred): copy bar pushes the screen down (make it an overlay) — Task 7
Task 5: minor (deferred): copy-bar click failure swallowed silently — Task 7
Task 5: minor (deferred): client {t:"clip"} has no sender in host (kept per brief)
Task 5: minor (deferred): possible double sync with emulator window's own host clipboard sharing (unverified)
Task 5: minor (deferred): copy bar text differs slightly from plan wording
Task 5: fix round 1/5 (5 addressed, 0 open; commits fa5f9ff..0317f3e)
Task 5: complete (commits fce051f..0317f3e, review clean)
Task 6: Ruling: plan's wheelToSwipe is portrait-only; add a rotation param so the swipe runs along the screen's vertical axis in device space (device X axis at 90/270), consistent with toDevice — cost: one extra test table
Task 6: Ruling: re-graded Minor 4 (deltaMode line/page → 9px swipe = tap) and Minor 5 (hidden tab throttles setTimeout → long press) to Important by effect (spurious taps / long-press) — cost: small
Task 6: minor (deferred): swipePendingAt converted at event time, sent with the rotation at send time (mid-swipe rotation edge case)
Task 6: fix round 1/5 (implementer reports 5 addressed; commit 4fc35c0; re-review dispatched)
Task 7: Ruling: user saw the screen cut off at 7300 (fixed 540x1170 CSS box, host/src/main.ts:24-37 + ui/App.tsx placeholder). Task 7 adds fit-to-window: screen box scales to the space left under the toolbar keeping device aspect ratio, recomputed on window resize/rotation, frame size re-requested as CSS×DPR (debounced) — user-reported, plan had no fit step — cost if wrong: one layout rework
Task 6: re-review round 1: all 5 addressed, no new Critical/Important
Task 6: minor (deferred): wheelToSwipe accumulated delta recomputed with new rotation if rotation changes between timer ticks
Task 6: Ruling: re-review out-of-scope — abortWheelSwipe returns early when swipeSending=false so a pending 50ms wheelTimer still fires after pointerdown/blur (touch crossing) — folded into Task 7 (host/src/main.ts is in T7 scope) — cost: tiny
Task 6: Ruling: re-review out-of-scope Medium — rotate() sets rotation optimistically (gateway/src/emulator.ts:258-263, server.ts:115-121); with Android auto-rotate off the page goes landscape while device stays portrait until a frame corrects it, input mis-mapped meanwhile — carried to final review fix pass (gateway, not in any remaining task) — cost: rotate button misbehaves for users with auto-rotate off until then
Task 6: complete (commits 0317f3e..4fc35c0, review clean after fix round 1)
Task 7: BASE 4fc35c0
Task 7: dispatched implementer (opus) with task-7-brief.md + task-7-extra.md
Task 7: implementer DONE_WITH_CONCERNS ffd9f17 (147 tests pass); concerns: ready.serial added, extra "switch to" button, clipboard success path untested, rotation w/ auto-rotate off, UI convention a11y checks skipped
Task 7: review: spec ✅, quality Approved, no Critical/Important
Task 7: minor (deferred): App.tsx host.call(...).then typed callbacks vs HostValue (type-only, pre-existing pattern)
Task 7: minor (deferred): role="status" not in nsh AccessibilityRole union
Task 7: minor (deferred): emu.avds waiters hang to 30s timeout if socket closes before reply
Task 7: minor (deferred): boot seconds counted from host's first boot msg
Task 7: minor (deferred): UI conventions: keyboard / text zoom / reduced-motion / 375px not checked
Task 7: complete (commits 4fc35c0..ffd9f17, review clean)
Final review: dispatched (opus) on f3e969c..ffd9f17
Final review: Ready to merge, no Critical/Important (targeted tests 131/131)
Final: Ruling: carried rotation question — reviewer shows frames follow the physical body (SkinRotation), the optimistic rotation equals what frames will report, and taps on the sideways picture hit (task7-tap-landscape.png); matches Android Studio with auto-rotate off — withdrawn as a defect; the Task 6 Ruling's premise was wrong — cost if wrong: rotate button misleads users with auto-rotate off
Final: minor (deferred): externally booting AVD (discovery file without grpc.port, not yet in adb) shown 未运行 → second spawn hits AVD lock, unclear error (avd.ts:155-165, lifecycle.ts:102-121)
Final: minor (deferred): rotation transition — old portrait frame stretched into landscape box until first new frame; possible 90→0→90 bounce (inferred)
Final: minor (deferred): paste/clip/touch failures only logged in gateway (server.ts:199), no {t:"error"} to page; >4MB clipboard may exceed gRPC limit (inferred)
Final: minor (deferred): clip stream reconnect skips first value, a copy during the 1s gap is lost (emulator.ts:87-103)
Final: minor (deferred): listAvds runs unquoted shell strings, SDK path with spaces breaks (avd.ts:117,129) — use execFile
