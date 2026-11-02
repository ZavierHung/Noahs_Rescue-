import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../playwright.config.js";

test("browser automatic cleanup is confined to its own directory, not live experiment archives", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const shared = path.join(root, "test-results");
  const browser = path.resolve(root, config.outputDir);
  assert.equal(browser, path.join(shared, "browser"));
  assert.notEqual(browser, shared);
  const liveExample = path.join(shared, "learning20-structured-example");
  assert.ok(path.relative(browser, liveExample).startsWith(".."));
});
