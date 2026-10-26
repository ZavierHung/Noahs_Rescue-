import assert from "node:assert/strict";
import test from "node:test";
import { checkReleaseFiles, PROTECTED_FILES } from "../../scripts/release-check.mjs";
const good = {
  tracked: [".env.example", "README.md"],
  ignored: PROTECTED_FILES,
  version: "0.2.0-alpha.1",
  playerVersion: "0.2.0-alpha.1",
  template: "MINIMAX_API_KEY=\n",
};
test("local release gate rejects tracked credentials/runtime archives without exposing values", () => {
  assert.deepEqual(checkReleaseFiles(good), []);
  for (const file of [
    ".env",
    "server/.env.local",
    "server/data/rooms.json",
    "miniprogram/config.local.js",
  ])
    assert.ok(
      checkReleaseFiles({ ...good, tracked: [file] }).some((message) => message.includes(file)),
    );
  const messages = checkReleaseFiles({
    ...good,
    template: "MINIMAX_API_KEY=fake-nonempty-value\n",
  });
  assert.equal(messages.length, 1);
  assert.equal(messages.join().includes("fake-nonempty-value"), false);
});
test("local release gate requires ignore rules and a consistent displayed version", () => {
  assert.equal(checkReleaseFiles({ ...good, ignored: [] }).length, PROTECTED_FILES.length);
  assert.ok(
    checkReleaseFiles({ ...good, version: "old" }).some((message) => message.includes("版本")),
  );
});
