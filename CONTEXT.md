# Droidpier

Droidpier drives the official Android emulator from a web page. This file names the concepts its code, UI and
discussions use, so that one thing has one name. Where the page shows a Chinese label for a concept, the label is
given in parentheses.

## Language

### The pieces

**Gateway**:
The local program (`droidpier`, `gateway/src/`) that finds, starts and stops emulators and connects them to the page
over a WebSocket on `127.0.0.1`. One per Mac, default port 7300.
_Avoid_: server, backend, daemon, bridge

**Page**:
The nsh TSX app the user operates (`ui/App.tsx`): the device list, the keys, status, dialogs. The **public page** is
the copy at `https://droid.devpier.dev/app/`; the **local page** is the same build served by the gateway at
`http://127.0.0.1:<port>/app/`.
_Avoid_: frontend, client, web app, site (the site is the docs and landing page at `droid.devpier.dev`)

**Host module**:
The JavaScript inside the page (`host/src/`, bundled into `ui/host.js`, loaded through nsh's `web.host`) that owns the
WebSocket, draws frames on the canvas and takes pointer and keyboard input. The page reaches it through
`host.call("emu.*")` and hears from it through `host.on(...)`.
_Avoid_: host (alone: ambiguous with the Mac), renderer (one part of it), SDK

**Emulator**:
The official Android emulator process, started headless with `-no-window -grpc <port>`. Droidpier never modifies it.
_Avoid_: simulator, device (the emulated phone), VM, qemu

### Devices

**AVD**:
An Android Virtual Device: a configured phone the emulator can boot, listed in the sidebar (设备).

**AVD id**:
The name that identifies an AVD: what `emulator -list-avds` prints, the `<id>.ini` in the AVD home, `avd.id` in a
discovery file. The device list and starting an AVD use it.
_Avoid_: AVD name (ambiguous), display name

**Display name**:
`avd.name` in a discovery file and `avd.ini.displayname` in config: a human label that may differ from the id
(`Resizable (Experimental)` for `Resizable_Experimental`). Never used to match anything.

**Discovery file**:
`pid_<pid>.ini` that a running emulator writes in the discovery directory, holding its serial, gRPC port, optional
token and AVD id. How the gateway finds running emulators.

**Serial**:
The emulator's console port (5554, 5556, ...); adb names the device `emulator-<serial>`. Only emulators have one;
anything that must also work for a phone uses the Device id.
_Avoid_: port (the gRPC port is a different one), device id (that is the adb name, below)

**Device id**:
The name adb gives a device and the gateway's key for it: `emulator-5554` for an emulator, the USB serial
(`R5CR10WN52H`) or `host:port` for a phone. Sent to the page as `ready.deviceId`.
_Avoid_: serial (that is the emulator's console port), udid

**Running state**:
What the device list knows about an AVD: `no` (not running), `grpc` (running with gRPC, the gateway can attach) or
`no-grpc` (running without gRPC, started elsewhere, cannot be attached).

**Boot job**:
The gateway's start of one AVD (`startAvd`): spawning, then booting until `sys.boot_completed` is 1, then ready or
failed. Shown as 启动中 N 秒 while it lasts.
_Avoid_: launch, startup task

**Session**:
The gateway's connection to one running emulator (`EmulatorSession`): its frame stream, input, rotation, clipboard and
exit. A WebSocket connection is attached to at most one session at a time; the gateway works with one emulator at a
time.
_Avoid_: connection (that is the page's WebSocket), device

**Current device**:
The AVD whose session the page is attached to: named in the header and marked 当前画面 in the device list.

### Connection

**Connection state**:
What the page shows about its link to the gateway and the emulator: `connecting`, `connected`, `no-emulator`,
`emulator-closed`, `booting`, `rebooting`, `disconnected`, plus the ones that stop it from working until the user acts:
`gateway-outdated`, `page-outdated`, `unsupported-browser`, `lna-denied`, `lna-prompt`, `bad-origin`, `no-gateway`.
_Avoid_: status (the message that carries it), mode

**Protocol version**:
`PROTOCOL_VERSION` in `shared/protocol.ts`. The page sends it in `hello`; when it differs from the gateway's, the
gateway answers with an error and the page says which side is outdated (`gateway-outdated`: rerun the install command; `page-outdated`: reload the page).

**Allowed origin**:
A page origin the gateway accepts a WebSocket from: the public page, its own local page, and any `--allow-origin`.
_Avoid_: whitelist, CORS

**Local network access** (LNA):
Chrome's permission for a public https page to connect to `127.0.0.1`; the user allows it once per site. Denied or
not yet answered shows as `lna-denied` / `lna-prompt`.

**Rev**:
The increasing number the host module puts on each state event it sends the page (status, setup, uploads, catalog), so a
late, older one is not applied over a newer one.
_Avoid_: version (that is the protocol's), sequence (frames have a `seq`)

### Using the device

**Keys**:
The buttons beside the device frame: rotate, screenshot, restart, install APK, power, volume, back, home, recents.
_Avoid_: toolbar, controls

**Upload**:
A file dropped onto the device: an APK is installed, other files are copied to the device's Download folder; split
APK bundles (`.xapk`, `.apks`, `.aab`, `.apkm`) are refused. Sent in windows the gateway acknowledges.
_Avoid_: transfer, push

**adb stuck**:
The state where the emulator's adbd stops answering (`AdbUnresponsive`, code `adb-unresponsive`); the page offers to
restart the emulator.
_Avoid_: adb down, adb error

### H5 debugging

**H5 page**:
A WebView page inside an app on the device that can be inspected (a debug build, or WebView debugging enabled). The
H5 key appears while one is visible in the foreground app, and stays while the console is open.
_Avoid_: web page, webview (the Android component), tab

**Console** (控制台):
The embedded Chrome DevTools frontend inspecting one H5 page, proxied through the gateway with a one-time ticket.
_Avoid_: devtools panel, inspector

**Dev server**:
A web server on the user's Mac that an H5 page is pointed at; the gateway adds an `adb reverse` so the device reaches
it at the same `localhost` port.
_Avoid_: local server, proxy

### First run

**Environment check**:
The gateway's report of which Android SDK pieces are present and what is missing (`EnvReport`).

**Install**:
Installing a missing SDK piece or creating an AVD from the page, after the user confirms and accepts each licence
(许可证) in the page.
_Avoid_: setup (the whole first-run flow), download
