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
