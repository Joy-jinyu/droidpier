# AGENTS.md

Droidpier drives the official Android emulator from a web page. The emulator runs headless (`-no-window -grpc
<port>`) on the user's Mac; a small local **gateway** (Node + TypeScript) finds it, streams its screen to a page in
Chrome or Edge over a WebSocket on `127.0.0.1`, and sends input back over gRPC and adb. The **page** is an
[nsh](https://github.com/longbridge/nsh) TSX app built for the web target and served as static files from
`https://droid.devpier.dev/app/`; a **host module** (`host.js`) runs inside the page, draws frames on a WebGL2 canvas,
takes mouse and keyboard input directly and owns the WebSocket. The terms are defined in [CONTEXT.md](CONTEXT.md).

This file is the short version. The design and its decisions are in `docs/superpowers/specs/`, the phase plans and
their execution ledgers in `docs/superpowers/plans/`, and the module comments in the code are the reference for how a
module works inside.

## Layout

```
gateway/src/     The gateway (runs on Node 22.6+ directly from TypeScript; bundled into one binary for release)
  main.ts          Entry: parses flags, wires the modules below into the server, opens the page
  server.ts        WebSocket + HTTP server: hello and version check, sessions per connection, status and boot
                   broadcasts, input, uploads, H5 debugging, the local copy of the page
  auth.ts          The Origin allowlist checked on every WebSocket upgrade
  discovery.ts     Reads emulator discovery files (pid_<pid>.ini); which running emulators the gateway may attach to
  avd.ts           Lists AVDs (emulator -list-avds + config.ini) with their running state
  lifecycle.ts     Starts an AVD and waits for sys.boot_completed (the boot job); stops one
  emulator.ts      One connected emulator (EmulatorSession): frames, touch, keys, rotation, clipboard, exit
  session-cache.ts The current session, rediscovered after it exits
  sdk.ts           gRPC client loaded from the SDK's emulator_controller.proto (no generated code is committed)
  adb.ts           adb calls with timeouts and a per-device queue; AdbUnresponsive
  webviews.ts, cdp.ts, devtools-proxy.ts, reverse.ts   H5 debugging: list WebView pages, drive them over CDP,
                   proxy the DevTools frontend, adb reverse to a local dev server
  setup.ts, installer.ts, catalog.ts   First-run environment check, SDK installs, device models and system images
  platform.ts      Everything platform specific: SDK paths, binary names, the discovery directory
  page-url.ts      The default port (7300) and the page address the gateway opens
  service.ts, self-update.ts   The background service (LaunchAgent) and its hourly self-update from the public page's
                   /download/
  reboot.ts, boot-log.ts, exit.ts, already-running.ts, upload-temp.ts, latest-frame.ts   Smaller pieces named by file
  bench-server.ts, fps-probe.ts, smoke.ts   Phase 0 experiments, not part of the product
gateway/test/    node:test tests; *.it.test.ts need a running emulator (EMU_IT=1)
host/src/        The host module (bundled by bun into ui/host.js): connection, renderer, pointer and keys,
                 clipboard sync, uploads, request/reply pairing, which gateway port to use, the check on the
                 DevTools iframe address (devtools-src.ts)
ui/              The page: App.tsx (nsh TSX, the whole UI) and small pure helpers next to it; nsh.json
shared/          Code the gateway, the host module and the page all use: protocol.ts (every message, close code
                 and the protocol version), input mapping, screen geometry, upload framing, AVD and disk rules,
                 the dev server address the user types (target-url.ts)
shared/test/     Tests for shared/ and for the pure logic of host/src and ui/
scripts/         build-binary.ts (single-file gateway), build-pages.ts and serve-pages.ts (the Pages deploy
                 directory), install.sh (the public install script), scrub-paths.ts
spike/           Phase 0 experiments and their notes (spike/NOTES.md)
docs/            deploy.md (deploying droid.devpier.dev), superpowers/ (design spec, plans, ledgers)
```

## Documentation

| Changing | Read |
|---|---|
| anything about the architecture, goals and non-goals | `docs/superpowers/specs/2026-11-11-android-emu-web-design.md` |
| frame transport and its measured numbers | the spec's section 6.1, `spike/NOTES.md` |
| embedding the canvas and host module in the nsh page | the spec's section 5, "nsh 嵌入验证" in `spike/NOTES.md` |
| security: the Origin allowlist, the public page reaching 127.0.0.1 | `gateway/src/auth.ts`, the spec's section 6.5 |
| the WebSocket protocol | `shared/protocol.ts` |
| the release build and deploying the public page | `docs/deploy.md`, `scripts/` |
| user-facing behavior and wording | the public docs at https://droid.devpier.dev/docs/ |

## Commands

The lockfile is pnpm 8's (`lockfileVersion: '6.0'`); pnpm 9 and later refuse it.

```sh
npx pnpm@8 install --frozen-lockfile     # dependencies (or pnpm install with pnpm 8)
npm test                                 # all unit tests: node --test gateway/test/*.test.ts shared/test/*.test.ts
node --test gateway/test/avd.test.ts     # one file
EMU_IT=1 node --test gateway/test/emulator.it.test.ts   # integration tests against a running emulator
npm start                                # the gateway from source on port 7300
node gateway/src/main.ts --port 7306 --no-open          # on another port, without opening the browser
bun run build:host                       # host/src → ui/host.js
NSH=/path/to/nsh bun run build:ui        # the page → .nsh/out/Droidpier (needs llvm; LLVM_BIN if not Homebrew's)
NSH=/path/to/nsh bun run build:bin       # build:ui, then the gateway binary → dist/droidpier-darwin-arm64(.tar.xz)
```

The gateway serves its own copy of the page (`--local`, `http://127.0.0.1:<port>/app/`) from `.nsh/out/Droidpier`
(embedded in the release binary). In a source checkout without `build:ui`, `/app/` is a 404: use the public page.

## Rules

- **The page and the gateway are released separately.** The public page updates when it is deployed; each user's
  gateway updates when they rerun the install script. The page sends its `PROTOCOL_VERSION` in `hello`; the gateway
  checks it with `compatibility()` and, on a mismatch, answers with an error saying whether the gateway or the page is
  out of date (`gateway/src/server.ts`). A change that an older page or an
  older gateway cannot handle bumps `PROTOCOL_VERSION`. Any difference in the version makes the two refuse to work
  together until one is updated, so a change both sides can ignore safely (an optional field, a new message the other
  side drops) keeps it.
- **The protocol is declared in `shared/`.** Message types (`ClientMsg`, `ServerMsg`), close codes and the frame
  header are in `shared/protocol.ts`, upload framing in `shared/upload.ts`. Add new messages and codes there and import
  them on both sides instead of writing the number or the shape again. Close codes keep their meaning once shipped
  (`CLOSE_BAD_TOKEN` stays 4001: old gateways use it).
- **The gateway is local only.** It listens on `127.0.0.1` and accepts a WebSocket only from an allowed Origin
  (`auth.ts`: the public page, its own local page, and `--allow-origin` values). Never widen the listen address or the
  allowlist, and never add an endpoint that skips the check. The DevTools proxy takes one-time tickets.
- **Nothing leaves the Mac.** The public page is static; no device data, frames or files go anywhere but the local
  gateway.
- **The emulator is the official one, unchanged.** Talk to it through gRPC (`emulator_controller.proto`, loaded from
  the SDK) and adb only. Droidpier must work without Android Studio running.
- **adb can hang.** Every adb call has a timeout (`adb.ts`); a device whose adbd stops answering surfaces as
  `AdbUnresponsive` and the page offers to restart the emulator. Never wait on adb without a bound.
- **Low latency, low idle cost.** Frames go through a single-slot buffer that drops old frames instead of queueing
  (`LatestFrame`); the renderer draws only in `requestAnimationFrame` and schedules none without a new frame. An idle
  page and gateway must not keep the Mac busy: being slower than scrcpy or busy while idle counts as a failure (the
  spec's non-goals).
- **Platform specifics live in `gateway/src/platform.ts`.** Only Apple Silicon macOS is supported today, but Intel
  Macs and Windows will be: SDK paths, binary names, image ABIs and build targets are not written anywhere else.
- **Installs ask first.** The first-run guide installs SDK pieces only after the user confirms, and the user accepts
  each licence in the page; the gateway never accepts one on their behalf.
- **Dependency injection for tests.** Modules that touch processes, files, adb or the clock take their dependencies
  as an object with real defaults (`LifecycleDeps`, `InstallerDeps`, `EnvDeps`, ...) so tests replace them; keep new
  side effects behind the same pattern.

## Code conventions

- TypeScript run directly by Node 22.6+ (type stripping): only erasable syntax, so no `enum`, `namespace` or
  parameter properties. Imports in `gateway/`, `host/` and `shared/` name the `.ts` file; `ui/` imports omit it (nsh
  resolves them).
- Code comments, log lines and user-facing strings (the page, gateway messages, errors) are in Chinese, as the
  existing code is; README and these guides are in English. Comments explain why, and carry the source of measured
  numbers (version and date: "2026-11-12 实测").
- Pure logic goes in a small module with its own test (`ui/h5-poll.ts`, `shared/screen.ts`); `ui/App.tsx` and
  `host/src/main.ts` wire them together.
- Tests use `node:test` and `node:assert/strict`; one test file per module, named after it. Tests for `host/src` and
  `ui/` live in `shared/test/`.
- The page is nsh TSX: primitives from `nsh`, `<If>` and `<Each>` without import, and the host is reached only
  through `host.call("emu.*", ...)` and `host.on(...)` (allowed by `capabilities.host` in `ui/nsh.json`).
- Dependencies: `ws`, `@grpc/grpc-js`, `@grpc/proto-loader` and `sharp`. Adding one needs a reason a reviewer accepts.

## Commits and pull requests

Details and examples: "Commits and pull requests" in [CONTRIBUTING.md](CONTRIBUTING.md).

- All changes go through a pull request against `main`; never push to `main` directly.
- Subjects and PR titles are `<area>: <What the change does>`: one lower-case area (`gateway`, `host`, `ui`,
  `protocol`, `install`, `build`, `docs`, `spike`), then an imperative sentence starting with a capital letter, no
  trailing period, about 72 characters in all. No conventional prefixes (`fix:`, `feat:`). Say what it does for the
  user, not which files changed.
- The body explains why, wrapped at 72 columns: the problem, the cause, the fix and what it costs.
- One commit / PR does one thing; no unrelated refactors, cleanup or formatting.
- A PR that changes the protocol says so and states whether `PROTOCOL_VERSION` moved and why.

## Verification after changes

1. `npm test`. New behavior comes with a test that fails without the change.
2. Gateway changes that touch the emulator, adb or discovery: run the gateway from source against a real emulator
   (`node gateway/src/main.ts --port <port> --no-open`) and check what it reports. A WebSocket client sending
   `hello` with `Origin: https://droid.devpier.dev` and then `{"t":"avds"}` shows the AVD list without a page.
   `EMU_IT=1` runs the integration tests.
3. Page and host changes: rebuild (`build:host`, `build:ui`) and check the page in Chrome against a running gateway
   and emulator: screenshots, and the states the change touches (booting, connected, rebooting, disconnected,
   outdated page or gateway).
4. Only one gateway can listen on a port. Stopping a user's running `droidpier` to test another build is their call;
   run the build under test on another port instead when you can.
