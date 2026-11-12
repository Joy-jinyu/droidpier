# SDD ledger — plan: docs/superpowers/plans/2026-11-11-phase3-share.md
Spec: docs/superpowers/specs/2026-11-11-android-emu-web-design.md §6.5/6.6. Branch feat/phase3-share from main d706c80 (phases 2 and 2.5 merged).

## Pre-flight scan
| Rows | Produces vs consumes | Finding |
|---|---|---|
| T1→T2 | hello handling in server.ts | both edit hello; T2 version check must run after Origin check, before/with token check — order: Origin(4003) → version(4002) → token(4001) |
| T1→T3 | close 4001 + {error bad-token}; token in hello | consistent |
| T1 vs phase 2.5 | /devtools/ proxy (no auth; comment points to T1) | gap: the DevTools iframe (appspot origin) opens /devtools/... — can't send hello/token. Needs its own rule |
| T2→T3 | 4002 + {error,code,upgrade} | consistent |
| T3 vs phase 2 | host derives gateway URL from location (phase 2 T4 ruling) | public page must use hash port; localhost page keeps location |
| T4→T5 | INSTALL_CMD placeholder | resolved by user answer below |
| T5→T6 | static files embedded; PUBLIC_ORIGIN | consistent |
| T6 vs site fork | site/ (astro, branch docs/site-design, other session) owns droid.devpier.dev root; web emulator under /app/ | deploy must combine site build + nsh build under /app/ — coordinate in T6 |
| T1 self | checkUpgrade(undefined)=false | but node/CLI clients (spike tools, tests) send no Origin — tests must set Origin |
| T4 self | Step 5 downloads ~2GB | needs user consent at that step |
| T7 self | needs a clean machine/user account | user step |
| all | `pnpm test` | use `node --test gateway/test/*.test.ts shared/test/*.test.ts` (pnpm → node16) |

Pre-flight: Ruling: hello check order Origin → version → token (an outdated page gets the upgrade message even if its token is stale) — cost: none
Pre-flight: Ruling: /devtools/ upgrades (T1): accept Origin https://chrome-devtools-frontend.appspot.com (and the page's own allowed origins) ONLY on that path, and require a per-inspect ticket carried in the ws= path (`/devtools/<socket>/<id>?ticket=` or a path segment), issued by the gateway in the inspect reply to an authenticated connection, single-use or short-lived — closes the phase 2.5 deferred "no auth on /devtools" — cost: verify the DevTools front-end keeps the query/path when it builds the ws URL
Pre-flight: Ruling (user 2026-11-11): binary + install.sh hosted on Cloudflare Pages same domain: https://droid.devpier.dev/install.sh and /download/android-emu-web-darwin-arm64; INSTALL_CMD = `curl -fsSL https://droid.devpier.dev/install.sh | sh`; if the binary exceeds the Pages 25 MiB per-file limit, stop and report options (R2 / GitHub Release) — cost: re-host
Pre-flight: Ruling: tests run with node --test, not pnpm
Task 1: BASE d706c80
Task 1: Ruling: to keep the page usable between tasks, T1 adds the minimal host change: read token from location.hash and send it in hello (T3 adds storage/replaceState/failure handling) — cost: T3 refactors a few lines
Task 1: implementer DONE f3d8356 (248 pass)
Task 1: Ruling: devtools ticket as a path segment ws=127.0.0.1:<port>/devtools/<socket>/<pageId>/<ticket> — verified Chrome 157 + appspot keeps it — cost: none
Task 1: note for T3/T6: fresh Chrome profiles leave the LNA prompt for the appspot iframe unanswered; browser checks used --disable-features=LocalNetworkAccessChecks — real prompt must be tested in T3/T6
Task 1: review: spec ✅, quality Approved (boundary attacks all held)
Task 1: Ruling: DevTools' own Reconnect fails with single-use tickets — candidate rule "ticket reusable for the same socket/page while the issuing authenticated connection lives" deferred to the final fix pass (gateway), 重新加载控制台 covers it meanwhile — cost: users who press DevTools' Reconnect see a disconnect
Task 1: minor (deferred): any page can detect the gateway/port via 4003 (accepted trade-off of Review Focus 5) — note in spec
Task 1: minor (deferred): ticket travels to appspot in the iframe query (single-use, 60s) — note in spec
Task 1: minor (deferred): inspect issues a ticket even when replying hint
Task 1: minor (deferred): spike/measure.ts, check-rotate.ts open 7300 without token
Task 1: complete (commits d706c80..f3d8356, review clean)
Task 2: BASE f3d8356
Task 2: implementer DONE 7441f92
Task 2: review: spec ✅; Changes required — <Text selectable> invalid in nsh (types.d.ts), upgrade command not copyable (re-graded Important, reviewer said Critical). Fix round 1 sent: userSelect + 复制命令 button via emu.copy, clipboard stubbed in test
Task 2: fix round 1/5 implementer 0f80643 (252 pass): userSelect + 复制命令 button; found race — hostEvent emitted before the App mounts is lost (createHost runs before runModule), fixed for version errors by returning the stored state from emu.status call
Task 2: note for Task 3: the early-hostEvent race applies to every connection state (bad-token, lna-denied, need-launch…) — the App must read state via emu.status call after mount; make host keep the latest state as single source
Task 2: re-review round 1: findings addressed, but the race fix returned {state,serial,upgrade} only — App's emu.status handler ignored upgrade (empty command) and crashed on s.boots.map. Controller fixed: host returns full status shape + state/upgrade override, App applies s.upgrade. Verified in browser with fake outdated gateway (race path): command shown, no new console error; suite green
Task 2: complete (commits f3d8356..HEAD, review clean after fix round 1 + controller fix)
Task 3: BASE 3de4796
Task 3: implementer DONE 9f4cc82 (259 pass); LNA simulated via CDP Browser.setPermission (local-network-access/local-network/loopback-network) + --ip-address-space-overrides; Chrome 157 throws SyntaxError on targetAddressSpace option (fallback works)
Task 3: Ruling: refine public-page failure by permission state — denied → lna-denied, prompt → new lna-prompt text, granted/unsupported → no-gateway (brief rule "3 failures → lna-denied" misleads when the prompt is pending or the gateway is off) — cost: one extra state
Task 3: Ruling: cache targetAddressSpace support after first SyntaxError; add rev to status to stop a stale emu.status result overwriting a newer event — sent to implementer before review
Task 3: follow-ups d82fc45 (261 pass). Ruling: accept implementer addition — a socket still CONNECTING after 3s on a public page triggers the permission query (a pending real prompt never fails the socket, observed >25s) → lna-prompt at ~4s — cost: none
Task 3: review: spec ✅, quality Approved
Task 3: minor (deferred → final pass candidate): reconnect every 1s forever in lna-denied/lna-prompt/no-gateway (pause when hidden or back off to 5s)
Task 3: minor (deferred): Android Chrome passes isSupportedBrowser (desktop-only not specified)
Task 3: minor (deferred): only 127.0.0.1/localhost/[::1] count as loopback; no hashchange listener; lna-prompt card uses danger color; brief stale lna-prompt after 阻止 (~2s); 4002 without message leaves state; `upgrade` field also carries the install command
Task 3: complete (commits 3de4796..d82fc45, review clean)
Task 4: BASE d82fc45
Task 4: user decisions 2026-11-12: Step 5 clean-environment install (~2GB into temp ANDROID_HOME/AVD_HOME) approved; the SDK license must be clicked by the user personally — implementer stops at the license stage, leaves the test gateway running, and hands the page link to the controller
Ruling (user 2026-11-12): all further decisions follow the controller recommendation without asking; exceptions: licence click (user personally), Cloudflare credentials/login, outward publish
Task 4: implementer b68d1ed + e5ff018 (276 pass). Step 5 finding: cmdline-tools 23.0 sdkmanager wraps the new Android CLI — installs without any licence prompt, writes licenses/ itself, and writes ~/.android/bin/android-cli (90MB) + ~/.android/cli (metrics queue). Stopped before system image.
Task 4: Ruling: pin cmdline-tools to the newest classic-sdkmanager revision that prompts per package (22.0 first, verified in a throwaway dir); explicit revision from the manifest — the spec requires the user to accept licences personally and no surprise writes to the home dir — cost: older tools
Task 4: cleanup by controller: moved ~/.android/bin and ~/.android/cli (created 2026-11-12 01:08 by the test) to ~/.Trash/emu-web-test-android-cli
Task 4: Ruling: clean-env gateway must not see the user's emulator-5554 via the shared discovery dir — isolate in the run
Task 4: commits 2ba04d6 (pin cmdline-tools 22.0, verified prompts, no home writes) + 7c1d66d (licence text from header line); 279 pass. Step 5 paused at emulator licence prompt, waiting for the user (gateway on 7306)
Task 4: second licence android-sdk-arm-dbt-license accepted at 09:57 — confirmed by the user ("是我点的")
Ruling (user request 2026-11-12): add Task 4b after Task 4 — "创建设备" dialog lets the user pick device model (avdmanager list device, phones first, default Pixel 5) and Android version (installed system images + downloadable google_apis arm64-v8a images from the manifest with size, default android-34); picking an uninstalled version goes through the same confirm + licence flow; AVD name derived from model+API, editable. Not mixed into the running Task 4 Step 5.
Task 4: Step 5 blocked by disk full (system image unpack failed at 55%, the disk was nearly full); env cleaned; commit 0638ba0 (progress after licence)
Task 4: Ruling: add a free-space guard (download + unpacked size vs statfs, 1 GB margin, button disabled when short); verify AVD creation + boot from the page with the user's SDK + temp AVD home (no download); full from-zero install moves to Task 7 — cost: from-zero path unverified until Task 7
Task 4: de7ca40 free-space guard (282 pass); AVD created from the page (config hw.ramSize=4096, 1080x2340, android-34) via a temp SDK symlinked read-only to the user's SDK + temp AVD home; boot failed: emulator needs 12288 MB for userdata, 4.9 GB free. Ruling: boot-and-see-screen moves to Task 7 with the from-zero run (needs ~18 GB free) — cost: boot path of a page-created AVD unverified until then
Task 4: review: spec ✅; Changes required — Important: licence accept not bound to the shown licence; discovery filter hides emulators from Studio/custom env; no clear Java-missing message; 23.0+ confirm copy not informed consent. Fix round 1 sent incl. minors (server-side disk check, kill installer children on exit, fetch timeout, latest-exists before download, env error not hidden, reject test, prompt counter)
Task 4: fix round 1/5 implementer a2af92f (304 pass); licence id bound at gateway+installer; discovery filter only with explicit ANDROID_AVD_HOME (single owner discovery.ts); java item; shared spaceCheck; fake-installer browser check
Task 4: re-review round 1: all 10 addressed (304 pass)
Task 4: minor (deferred): install() IIFE not wrapped — an unexpected throw would leave installing=true
Task 4: minor (deferred): answered signal not reset on dialog close (harmless with monotonic ids)
Task 4: complete (commits d82fc45..a2af92f, review clean after fix round 1; boot + from-zero run moved to Task 7)
Task 4b: BASE a2af92f
Task 4b: implementer DONE_WITH_CONCERNS c9b75a3 (326 pass); sys-img manifest dl.google.com/.../sys-img/google_apis/sys-img2-3.xml; installed size = download × 3 (measured on 4 images); phones only; createAvd fully re-checked server-side
Task 4b: incident: test gateway briefly attached to the user's emulator-5554 (~5s, read size only, no page, no input) because the discovery filter matches AVD by name, not path — to fix (match avd.dir under ANDROID_AVD_HOME)
Task 4b: review: spec ✅; Changes required — Critical: discovery ownFilter matches by name only (caused the 5554 attach), must match avd.dir realpath under ANDROID_AVD_HOME. Fix round 1 sent incl. minors (name must start alnum, revision/size parsing, single-flight catalog, focus/scroll selected)
Task 4b: fix round 1/5 implementer b319ab6..3cb4752 (332 pass); live log confirms 5554 not taken over in filtered mode
Task 4b: re-review round 1: all 5 addressed, no new breakage
Task 4b: complete (commits a2af92f..3cb4752, review clean after fix round 1)
Task 5: BASE 3cb4752
Task 5: implementer DONE_WITH_CONCERNS 990e0e7 (336 pass): binary 65.0 MiB, .tar.xz 17.7 MiB; startup 0.65–1.14 s first run, ~0.1 s after; gRPC works inside the binary (ready + first frame, read-only)
Task 5: Ruling: download is android-emu-web-darwin-arm64.tar.xz (+ .tar.xz.sha256) — gzip -9 still >25 MiB, xz -9 17.7 MiB, /usr/bin/tar unpacks it — cost: Task 6 must upload these names
Task 5: Ruling: no --bytecode; .br/.gz not embedded; sharp stays (bench-server uses it, not bundled); build:bin uses bun
Task 5: note: ad-hoc signed only (spctl rejected) — browser-downloaded binaries would be quarantined; site must give only the curl command
Task 5: review: spec ✅; Changes required — curl lacked --proto =https (redirect downgrade). Controller fixed: --proto/--proto-redir =https + --tlsv1.2, only http://127.0.0.1:* test bases allowed; trust-model comment; test "localhost http base refused" RED→GREEN; suite 337 pass
Task 5: complete (commits 3cb4752..HEAD)
Task 6: BASE c1c0f09
Task 6 (prep): implementer DONE_WITH_CONCERNS dc5318f, 7a38a58 (346 pass); dist/pages 35M/594 files; simulated public page (droid.test → 127.0.0.1, ip-address-space override) connects with LNA allowed, lna-denied when denied
Task 6: Ruling: gateway opens the local page by default; `--public` opens https://droid.devpier.dev/app/; `--allow-origin <origin>` for local tests; PUBLIC_ORIGIN lives in auth.ts; build-pages fails when /app/ CSP blocks the DevTools iframe
Task 6: Ruling (controller, user delegated decisions): the site's /app/ CSP needs frame-src https://chrome-devtools-frontend.appspot.com (measured: without it embedded DevTools is blocked) — sent to the site session (owner of site/)
Task 6: env: emulator-5554 adb shell wedged again (adb devices ok, shell times out, no stuck shells of ours) — second time; reported to user, not reset
Task 6 (prep): review: spec ✅, quality Approved
Task 6: minor (deferred): build-pages checks input presence, not freshness (stale binary after a failed build:bin)
Task 6: minor (deferred): no build:pages script in package.json; deploy.md doesn't state Node ≥22.6
Task 6: prep complete (commits c1c0f09..7a38a58). Deploy blocked on: site CSP frame-src commit (site session awaiting the user's confirmation), user's `wrangler login`
Task 6: DEPLOYED with user confirmation (2026-11-12): site d3b1cfb built in an isolated temp copy + binary/UI at feat/phase3-share; Pages project android-emu-web created with --force (wrangler 4.160 delegates Pages to Workers otherwise; nothing deployed by the failed attempt); 590 files uploaded; android-emu-web.pages.dev serves /, /app/ (app CSP with frame-src), install.sh, download sha256 matching dist
Task 6: custom domain droid.devpier.dev added via API (pending: CNAME record not set — the CLI login could not edit DNS); user must add CNAME droid → android-emu-web.pages.dev (proxied) in the Cloudflare dashboard
Task 6: CNAME droid → android-emu-web.pages.dev (proxied) added by controller in the Cloudflare dashboard at the user request ("你去加"); domain active; https://droid.devpier.dev / /app/ /install.sh 200, sha256 matches, /app/ CSP has frame-src
Task 6: REAL public-page test by the user: droid.devpier.dev/app/ connected to the local gateway after LNA allow (screen + 已连接). H5 list failed only because adbd in emulator-5554 was wedged (2nd time); guest reset via gRPC with user approval
Task 6c (added, user question "网页可以发起重启指令嘛"): Ruling — yes: add a page action "重启模拟器" via gRPC setVmState RESET (works even when adbd is wedged), behind a confirmation dialog; show it inline when an adb-unresponsive error is detected; plus friendly adb-unresponsive message and root-cause the repeated adbd wedge (3s webviews poll)
Task 6c: BASE c1c0f09.. HEAD at dispatch
Task 6c: Ruling (user request): auto-close the embedded DevTools pane when the inspected page is really gone (successful list without it, serial change, reboot) — replaces the 页面已关闭 label; never on a failed list; brief note in the H5 panel
Task 6c: implementer DONE_WITH_CONCERNS 13646f5, 164b952, 0ed3a9b (376 pass); real restart from the page 14 s; console auto-close 1.8 s; adb-unresponsive message verified with a fake hanging adb
Task 6c: Rulings: reboot outside the input queue, input dropped while rebooting; one reboot gateway-wide, after hello; boot done = boot_completed 1 after a not-1, 120 s cap; per-device adb queue for all device-scoped adb; H5 poll 3 s while a console is open else 5 s after 3 successes; console closes on serial change (incl. 0) or reboot
Task 6c: root cause not reproduced (1500 calls, 600 killed mid-transfer, adbd healthy); inferred: emulator 32.1.14 running ~22 h across many sleep/wake cycles; fixed contributors: paste keyevent adb call had no timeout; adb processes left behind on gateway exit
Task 6c: review: spec ✅, quality Approved
Task 6c: minor (deferred): exit cleanup now queues behind a stuck adb call → may exceed the 3 s exit bound (forwards left in the adb server)
Task 6c: minor (deferred): adb never back → 重启中 for the full 120 s with input dropped (gRPC input doesn't need adb)
Task 6c: minor (deferred): e.killed also true for maxBuffer/killAdbChildren → misclassified as unresponsive; rebooting keyed by serial only; H5 panel shows 重启中 as a red failure and keeps stale 审查 buttons; AdbStuck restart button not disabled when not connected; no replay guard on reboot (auth + confirm + single flight)
Task 6c: complete (commits 7a38a58..0ed3a9b, review clean)
Release: built 0ed3a9b artifacts in a temp worktree (main checkout has someone else uncommitted ui/App.tsx redesign, not ours); 7302 test gateway restarted from it; redeploy of droid.devpier.dev blocked by the permission classifier (Production Deploy) — needs the user approval. User installed cmdline-tools 22.0 into the real SDK via the page (gateway log "页面确认安装：cmdline-tools")
Release: redeployed 0ed3a9b to droid.devpier.dev with user approval ("同意部署"); live sha256 e5aab512… and host bundle match the build
Release: user asked to release the theme change ("把主题改动提交一起发布"); it was already committed as 36cc16b (by another session, 16:12) — note it changes the console rule to stay open with 审查的页面已关闭 and attach to the next foreground page, and removes the H5 page-list panel; suite 376 pass; built in temp worktree, local smoke (new layout renders, no console errors); deployed
Ruling (user 2026-11-12): product + command renamed to Droidpier / `droidpier` (domain unchanged); also switch the gateway default to open the public page (verified live by the user); docs/superpowers history keeps the old name
Rename: ce06dc4 + aaa2ac5 (droidpier; --public no-op alias; --local opens loopback); localStorage key droidpier.launch
User test: installed via curl but the page showed need-launch; users do not know to run the gateway. Fix need-launch copy to two steps before the rename release.
Ruling (user decision 2026-11-12): drop the launch token; the gateway trusts connections by exact Origin allow-list only (droid.devpier.dev + its own loopback page). The page probes ws://127.0.0.1:7300 (or #port / stored port) and auto-connects as soon as the gateway runs; need-launch keeps polling. DevTools tickets stay. Reason: refresh after install had no way to get the token. Cost: non-browser local processes can drive the gateway (they could already use adb).
Token removal: 66bcf3a, ed30eaf (386 pass; browser: connect without token, stop→card, restart→auto reconnect ~1s); ea32ef9 controller fix: stop persisting the port (stale port after returning to 7300); release ea32ef9 built (sha256 ca9af441…); site docs still describe tokens → asked the site session to update
Release: deployed ea32ef9 (Droidpier, no token, auto-detect) with user approval; live sha256 ca9af441…, title Droidpier; stopped old 7300 preview and 7302 test gateway
Release: site 94857d7 (no-token docs) deployed with user approval
