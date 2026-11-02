import test from "node:test";
import assert from "node:assert/strict";
import { publicCatalog } from "../src/expedition/catalog.js";

test("read-only card catalogue lists all types, not only held or currently active cards", () => {
  const catalog = publicCatalog();
  assert.equal(catalog.cards.actions.length, 2);
  assert.equal(catalog.cards.technology.length, 13);
  assert.equal(catalog.disasters.length, 12);
  assert.equal(new Set(catalog.disasters.map((c) => c.id)).size, 12);
  for (const dimension of ["economy", "environment", "society"]) {
    const cards = catalog.disasters.filter((c) => c.dimension === dimension);
    assert.equal(cards.length, 4);
    assert.deepEqual(
      cards.map((c) => c.triggerRange),
      ["1–2", "1–6", "14–19", "18–19"],
    );
  }
  assert.ok(catalog.disasters.every((c) => !Object.hasOwn(c, "triggerValue")));
  assert.ok(
    catalog.disasters.every((c) => c.image.width > 0 && c.image.height > 0),
  );
});

test("catalogue preserves original and learning variants independently without mutating source cards", () => {
  const before = publicCatalog();
  const eco = before.disasters.find((c) => c.id === "eco-collapse");
  assert.match(eco.effect, /不可再次/);
  assert.match(eco.learningEffect, /休养完整一轮/);
  assert.match(eco.learningImage.file, /eco-collapse-learning\.png$/);
  assert.notEqual(eco.image.file, eco.learningImage.file);
  eco.image.file = "not-the-source";
  eco.learningImage.file = "not-the-learning-source";
  const after = publicCatalog().disasters.find((c) => c.id === "eco-collapse");
  assert.notEqual(after.image.file, eco.image.file);
  assert.notEqual(after.learningImage.file, eco.learningImage.file);
  for (const id of ["mining-drone", "shared-supply-pod"]) {
    const card = before.cards.technology.find((c) => c.id === id);
    assert.ok(
      card.learningEffect && card.learningSummary && card.learningImage,
    );
    assert.notEqual(card.image, card.learningImage);
  }
});
