import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS } from "../src/expedition/catalog.js";
import { DISASTER_RULES, disastersForGame } from "../src/expedition/world.js";

test("changed learning cards use new portrait art without overwriting original assets", () => {
  const art = CARDS.technology
    .filter((c) => c.learningImage)
    .map((c) => ({ file: c.learningImage, original: c.image }));
  const eco = DISASTER_RULES.learningEffects["eco-collapse"];
  art.push({ file: eco.image, original: "/images/disasters/eco-collapse.jpg" });
  assert.equal(art.length, 3);
  for (const entry of art) {
    assert.notEqual(entry.file, entry.original);
    const bytes = readFileSync(
      new URL(`../../app/public${entry.file}`, import.meta.url),
    );
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    assert.ok(Math.abs(width / height - 5 / 7) < 0.002);
    assert.ok(width >= 1000 && height >= 1400);
  }
  const result = disastersForGame({ learningMode: true }, [
    {
      id: "eco-collapse",
      effect: "legacy",
      image: { file: "legacy", width: 1, height: 1 },
    },
  ])[0];
  assert.deepEqual(result.image, {
    file: eco.image,
    width: 1061,
    height: 1483,
  });
  assert.equal(result.sourceEffect, "legacy");
});
