import { test } from "node:test";
import assert from "node:assert/strict";
import { parseZoom, stepZoom, ZOOM_STEPS } from "../zoom.ts";

test("parseZoom 认得档位里的值，字符串也行", () => {
  assert.equal(parseZoom(1.5), 1.5);
  assert.equal(parseZoom("0.75"), 0.75);
});

test("parseZoom 没存过或不是档位时适应窗口", () => {
  assert.equal(parseZoom(null), 1);
  assert.equal(parseZoom("abc"), 1);
  assert.equal(parseZoom(3), 1);
  assert.equal(parseZoom(""), 1);
});

test("stepZoom 一档一档走，到头停住", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(ZOOM_STEPS[0], -1), ZOOM_STEPS[0]);
  assert.equal(stepZoom(ZOOM_STEPS.at(-1)!, 1), ZOOM_STEPS.at(-1));
});
