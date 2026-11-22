import { test } from "node:test";
import assert from "node:assert/strict";
import { isDevtoolsSrc } from "../../host/src/devtools-src.ts";

const GOOD = "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7306/devtools/webview_devtools_remote_1/AB/TK_1-x";

test("appspot 前端、ws 指向本网关 /devtools/<socket>/<页面>/<票据> 时可以嵌入", () => {
  assert.equal(isDevtoolsSrc(GOOD, "7306"), true);
});

test("其他地址一律拒绝", () => {
  for (const bad of [
    "javascript:alert(1)",
    "http://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=127.0.0.1:7306/devtools/x/y",
    "https://evil.example/inspector.html?ws=127.0.0.1:7306/devtools/x/y",
    "https://chrome-devtools-frontend.appspot.com.evil.example/?ws=127.0.0.1:7306/devtools/x/y",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?wss=127.0.0.1:7306/devtools/x/y",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=127.0.0.1:9300/devtools/page/AB",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/inspector.html?ws=evil.example:7306/devtools/x/y",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7306/devtools/webview_devtools_remote_1/AB",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7306/devtools/webview_devtools_remote_1/AB/TK/x",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7306/devtools/webview_devtools_remote_1/AB/",
    "https://chrome-devtools-frontend.appspot.com/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:73060/devtools/s/AB/TK",
    "not a url",
  ]) assert.equal(isDevtoolsSrc(bad, "7306"), false, bad);
});

test("isDevtoolsSrc：网关自己提供的页面里，也认经网关代理的前端（http://127.0.0.1:<同一端口>/devtools-frontend/）", () => {
  const local = "http://127.0.0.1:7306/devtools-frontend/serve_rev/@abc/devtools_app.html?ws=127.0.0.1:7306/devtools/webview_devtools_remote_1/AB/TK_1-x";
  assert.equal(isDevtoolsSrc(local, "7306"), true);
  assert.equal(isDevtoolsSrc(local, "7307"), false);
  assert.equal(isDevtoolsSrc(local.replace("/devtools-frontend/", "/other/"), "7306"), false);
  assert.equal(isDevtoolsSrc(local.replace("http://127.0.0.1:7306", "http://evil.test"), "7306"), false);
});

test("isDevtoolsSrc：也认网关自己提供的 iOS WebKit 调试界面，ws 必须连回同一个网关的 /webinspector/ws/<应用>/<页面>/<票据>", () => {
  const ok = "http://127.0.0.1:7300/webinspector/Main.html?ws=127.0.0.1%3A7300%2Fwebinspector%2Fws%2FPID%253A1%2F1%2Ftk&ios=27.0&version=27.0";
  assert.equal(isDevtoolsSrc(ok, "7300"), true);
  assert.equal(isDevtoolsSrc(ok, "7301"), false);
  assert.equal(isDevtoolsSrc(ok.replace("Main.html", "Other.html"), "7300"), false);
  assert.equal(isDevtoolsSrc("http://evil.test/webinspector/Main.html?ws=127.0.0.1:7300/webinspector/ws/a/b/c", "7300"), false);
  assert.equal(isDevtoolsSrc("http://127.0.0.1:7300/webinspector/Main.html?ws=127.0.0.1:7300/devtools/a/b/c", "7300"), false);
});
