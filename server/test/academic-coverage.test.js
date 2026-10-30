import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createAcademicRetriever,
  isTeachingSource,
  validateLibrary,
} from "../src/academic/retriever.js";

const query = "检索 最多 高度";
function source(id, overrides = {}) {
  return {
    id,
    title: "覆盖测试资料",
    originalTitle: "Coverage fixture",
    authors: "Test author",
    year: 2026,
    publisher: "Test fixture",
    kind: "textbook",
    domain: "economy",
    perspective: "balanced",
    edition: "Fixture edition",
    workId: id,
    concepts: ["覆盖测试"],
    content: "仅用于独立覆盖测试，不是学术知识。",
    limitations: "不可用于真实判断。",
    application: "检验检索覆盖。",
    authority: "测试资料。",
    rights: "测试资料。",
    locator: "测试条目。",
    verification: "独立测试夹具。",
    url: "https://example.org/source",
    originalUrl: "https://example.org/source",
    originalFormat: "web",
    tags: ["检索", "最多", "高度"],
    ...overrides,
  };
}
function leadingBooks() {
  return [
    source("book-a"),
    source("book-b"),
    source("book-c", { domain: "society", perspective: "radical" }),
    source("book-d", { domain: "environment", perspective: "radical" }),
  ];
}
async function fixture(t, sources) {
  const directory = await mkdtemp(path.join(tmpdir(), "academic-coverage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "library.json");
  await writeFile(filename, JSON.stringify({ version: "fixture", sources }));
  return createAcademicRetriever(filename);
}

test("coverage tries the next feasible research source without losing top hits, domains or existing lenses", async (t) => {
  const retriever = await fixture(t, [
    ...leadingBooks(),
    source("research-a", {
      kind: "peer-reviewed-article",
      perspective: "radical",
      tags: ["检索"],
    }),
    source("research-b", {
      kind: "peer-reviewed-article",
      domain: "society",
      perspective: "radical",
      tags: ["检索"],
    }),
  ]);
  const ranked = retriever.search(query, 6, { persona: "balanced" });
  assert.deepEqual(
    ranked.map((s) => s.id),
    ["book-a", "book-b", "book-c", "book-d", "research-a", "research-b"],
  );
  const result = retriever.search(query, 4, {
    persona: "balanced",
    coverage: true,
  });
  // research-a cannot replace either unique non-economy domain, and the two
  // economy hits are reserved. research-b can replace the society textbook.
  assert.deepEqual(
    result.map((s) => s.id),
    ["book-a", "book-b", "research-b", "book-d"],
  );
  assert.equal(result[2].match.selection, "research_context");
  assert.deepEqual(result.slice(0, 2), ranked.slice(0, 2));
  assert.equal(new Set(result.map((s) => s.domain)).size, 3);
  assert.ok(result.some((s) => s.perspective === "balanced"));
  assert.ok(result.some((s) => s.perspective !== "balanced"));
  assert.ok(result.some(isTeachingSource));
  assert.ok(result.some((s) => !isTeachingSource(s)));
});

test("textbooks and a teaching guide cannot impersonate research or pull in an unrelated paper", async (t) => {
  const retriever = await fixture(t, [
    ...leadingBooks(),
    source("guide-a", {
      kind: "teaching_guide",
      domain: "society",
      perspective: "radical",
      tags: ["检索"],
    }),
    source("unrelated-paper", {
      kind: "peer-reviewed-article",
      tags: ["不相干主题"],
    }),
  ]);
  const constrained = retriever.search(query, 4, {
    persona: "balanced",
    coverage: true,
  });
  assert.deepEqual(
    constrained.map((s) => s.id),
    leadingBooks().map((s) => s.id),
  );
  const allHits = retriever.search(query, 6, {
    persona: "balanced",
    coverage: true,
  });
  assert.equal(allHits.length, 5);
  assert.ok(allHits.some((s) => s.kind === "teaching_guide"));
  for (const result of [constrained, allHits]) {
    assert.ok(result.every(isTeachingSource));
    assert.ok(result.every((s) => s.match.selection !== "research_context"));
    assert.ok(result.every((s) => s.id !== "unrelated-paper"));
  }
});

test("work statistics count several chapters of one book once and distinguish a guide from a textbook", async (t) => {
  const retriever = await fixture(t, [
    source("book-a-chapter-one", { workId: "shared-book" }),
    source("book-a-chapter-two", { workId: "shared-book" }),
    source("book-b", { workId: "different-book" }),
    source("guide-a", { kind: "teaching_guide", workId: "shared-guide" }),
    source("guide-b", { kind: "teaching_guide", workId: "shared-guide" }),
    source("paper-a", { kind: "peer-reviewed-article", workId: undefined }),
  ]);
  const metadata = retriever.describe();
  assert.equal(metadata.sources, 6);
  assert.equal(metadata.statistics.works, 4);
  assert.equal(metadata.statistics.textbooks, 2);
  assert.equal(metadata.statistics.kinds.textbook, 3);
  assert.equal(metadata.statistics.kinds.teaching_guide, 2);
  assert.equal(metadata.statistics.kinds["peer-reviewed-article"], 1);
});

test("teaching-guide traceability metadata is validated just like textbook metadata", () => {
  for (const patch of [
    { edition: undefined },
    { workId: undefined },
    { concepts: [] },
    { concepts: [""] },
  ]) {
    assert.throws(
      () =>
        validateLibrary({
          version: "fixture",
          sources: [source("guide-a", { kind: "teaching_guide", ...patch })],
        }),
      /invalid_textbook_metadata/,
    );
  }
});
