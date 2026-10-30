import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createAcademicRetriever,
  validateLibrary,
  normalizeQuery,
} from "../src/academic/retriever.js";
import { evaluateRetrieval } from "../src/academic/evaluation.js";
import { archiveSource, originalDocument } from "../src/academic/archive.js";
import { createGame } from "../src/expedition/engine.js";
import {
  CARDS,
  CHARACTERS,
  EFFECT_SUMMARIES,
} from "../src/expedition/catalog.js";
import { DISASTERS } from "../src/catalog.js";
import {
  createBoardingJudge,
  judgmentContext,
  fallbackBoarding,
} from "../src/expedition/judgment.js";
import { createGodRepository } from "../src/god-repository.js";
import { createMiniMaxVerdictModel } from "../src/llm/minimax.js";
import { validateLearning } from "../src/academic/learning.js";
import { testApi } from "../../tests/helpers/expedition-api.mjs";

const retriever = await createAcademicRetriever();
const gods = createGodRepository(new URL("../data/", import.meta.url).pathname);
function fixture() {
  const g = createGame(
    {
      players: CHARACTERS.slice(0, 3).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { seed: 7 },
  );
  g.status = "awaiting_judgment";
  g.phase = "judgment";
  g.round = 8;
  g.players.forEach((p) => {
    p.position = "0,0";
    p.floodInjury = 0;
  });
  g.players[2].floodInjury = 999;
  g.ark.wood = 17;
  return g;
}
function citedVerdict(context, evidence, stage = "initial") {
  const value = fallbackBoarding(context);
  value.learning = ["economy", "environment", "society"]
    .map((domain) => evidence.find((s) => s.domain === domain))
    .filter(Boolean)
    .map((s) => ({
      sourceId: s.id,
      application: `${s.application} 但须注意：${s.limitations}`,
      eventSeqs: [context.globalEvents[0].seq],
    }));
  return value;
}
test("expanded catalogue distinguishes 22 works, 11 textbooks and one teaching guide, with traceable Chinese concepts", () => {
  assert.equal(retriever.size, 22);
  assert.equal(new Set(retriever.library.sources.map((s) => s.id)).size, 22);
  assert.deepEqual(
    ["economy", "environment", "society"].map(
      (d) => retriever.library.sources.filter((s) => s.domain === d).length,
    ),
    [7, 7, 8],
  );
  assert.deepEqual(
    ["radical", "balanced", "conservative"].map(
      (d) =>
        retriever.library.sources.filter((s) => s.perspective === d).length,
    ),
    [6, 9, 7],
  );
  assert.equal(retriever.describe().statistics.works, 22);
  assert.equal(retriever.describe().statistics.textbooks, 11);
  assert.equal(retriever.describe().statistics.kinds.teaching_guide, 1);
  const teaching = retriever.library.sources.filter((s) =>
    ["textbook", "teaching_guide"].includes(s.kind),
  );
  assert.equal(new Set(teaching.map((s) => s.workId)).size, 12);
  for (const s of teaching) {
    assert.ok(
      s.edition &&
        s.concepts.length >= 3 &&
        s.verification.includes("2026-10-30"),
    );
    assert.ok(["pdf", "web", "link"].includes(s.originalFormat));
  }
  for (const s of retriever.library.sources) {
    assert.match(s.content, /[\u4e00-\u9fff]/);
    assert.ok(s.originalExcerpt.split(/\s+/).length <= 25);
  }
  const invalid = structuredClone(retriever.library);
  invalid.sources[0].url = "file:///secret";
  assert.throws(() => validateLibrary(invalid), /unsafe/);
  assert.match(retriever.hash, /^[a-f0-9]{64}$/);
});
test("textbook metadata and supporting URLs are validated; chapters never inflate distinct book counts", () => {
  for (const corrupt of [
    (s) => {
      delete s.edition;
    },
    (s) => {
      s.concepts = [];
    },
    (s) => {
      s.originalFormat = "exe";
    },
    (s) => {
      s.supportingUrls = [
        { title: "bad", url: "https://user@source.example/" },
      ];
    },
  ]) {
    const library = structuredClone(retriever.library);
    corrupt(library.sources.find((s) => s.kind === "textbook"));
    assert.throws(() => validateLibrary(library));
  }
});
test("all bilingual and natural-language smoke cases retrieve a relevant top-three source; unrelated queries abstain", async () => {
  const cases = JSON.parse(
    await readFile(
      new URL("../data/academic/evaluation-cases.json", import.meta.url),
      "utf8",
    ),
  );
  const results = evaluateRetrieval(retriever, cases);
  assert.equal(results.current.all.passed, cases.length);
  assert.ok(results.current.en.rate > results.hashOnlyBaseline.en.rate);
  assert.deepEqual(retriever.search("", 6), []);
  assert.match(normalizeQuery("clean technology"), /清洁技术/);
});
test("persona lenses differ without excluding other viewpoints and all three domains", () => {
  const query = "经济 环境 社会 合作 公平 风险 科技 创新 洪水";
  const views = ["radical", "balanced", "conservative"].map((persona) => {
    const hits = retriever.search(query, 6, { persona, coverage: true });
    assert.equal(new Set(hits.map((s) => s.domain)).size, 3);
    assert.ok(hits.some((s) => s.perspective === persona));
    assert.ok(hits.some((s) => s.perspective !== persona));
    assert.ok(hits.some((s) => s.kind === "textbook"));
    assert.ok(
      hits.some((s) => !["textbook", "teaching_guide"].includes(s.kind)),
    );
    return hits.map((s) => s.id).join(",");
  });
  assert.ok(new Set(views).size > 1);
  assert.equal(
    retriever.search("planetary boundaries", 1, { persona: "radical" })[0].id,
    "richardson-2023",
  );
});
test("every stage re-retrieves current rebuttal, keeps immutable earlier evidence and avoids claiming offline comprehension", async () => {
  const g = fixture();
  const judge = createBoardingJudge({
    godRepository: gods,
    retriever,
    random: () => 0,
  });
  g.judgment = await judge(g);
  const initial = structuredClone(g.judgment.rag);
  g.judgment = await judge(g, {
    stage: "discussion",
    playerId: "P1",
    text: "清洁技术创新、研发、转型",
  });
  assert.equal(g.judgment.rag.evidence[0].id, "acemoglu-2009");
  g.judgment = await judge(g, {
    stage: "discussion",
    playerId: "P2",
    text: "我受伤了，留下种子救生，贫困处境和公平不能忽略",
  });
  assert.ok(
    ["sen-1998", "ipcc-synthesis-2023"].includes(g.judgment.rag.evidence[0].id),
  );
  assert.deepEqual(g.judgment.history[0].rag, initial);
  assert.match(g.judgment.verdict.statement, /不理解自由文本/);
  assert.equal(g.judgment.llm.used, false);
  assert.equal(g.judgment.rag.libraryHash, retriever.hash);
  const final = await judge(g, { stage: "final" });
  assert.match(final.rag.query, /清洁技术创新/);
  assert.match(final.rag.query, /种子救生/);
  assert.equal(final.history.length, 4);
  assert.equal(final.final, true);
  assert.ok(final.verdict.decisions.filter((d) => d.board).length <= 1);
});
test("real M3 adapter receives complete persona, academic constraints, current sources and rebuttal (mock transport only)", async () => {
  let payload;
  const g = fixture();
  const model = createMiniMaxVerdictModel({
    apiKey: "test-not-a-real-key",
    baseUrl: "https://example.invalid",
    model: "MiniMax-M3.0",
    fetchImpl: async (_url, init) => {
      payload = JSON.parse(init.body);
      const text = payload.messages[0].content[0].text;
      const context = JSON.parse(
        text.slice(text.indexOf("\n") + 1, text.lastIndexOf("\n")),
      );
      const teaching = context.evidence.filter((s) =>
        ["textbook", "teaching_guide"].includes(s.kind),
      );
      assert.ok(
        teaching.length > 0,
        "new teaching material must reach the actual adapter payload",
      );
      assert.ok(
        teaching.every((s) => s.edition && s.concepts.length && s.limitations),
      );
      return {
        ok: true,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                citedVerdict(context.context, context.evidence),
              ),
            },
          ],
        }),
      };
    },
  });
  const judge = createBoardingJudge({
    godRepository: gods,
    retriever,
    verdictModel: model,
    random: () => 0,
  });
  const result = await judge(g, {
    stage: "discussion",
    playerId: "P1",
    text: "请复核我保留种子救生的理由",
  });
  assert.equal(result.llm.used, true);
  assert.equal(payload.model, "MiniMax-M3");
  assert.ok(payload.system.includes((await gods.list())[0].prompt));
  assert.match(payload.system, /学术阅读规则/);
  assert.match(payload.system, /不得编造书目/);
  assert.match(payload.system, /kind=textbook/);
  assert.match(payload.messages[0].content[0].text, /保留种子救生/);
  assert.equal(result.verdict.learning.length, 3);
});
test("fabricated citations, fake events, omitted domains, dead boarding or overcapacity all fail closed", async () => {
  const g = fixture();
  for (const corrupt of [
    (v) => {
      v.learning[0].sourceId = "invented-paper";
    },
    (v) => {
      v.learning[0].eventSeqs = [999999];
    },
    (v) => {
      v.learning = [];
    },
    (v) => {
      delete v.learning;
    },
    (v) => {
      v.decisions[2].board = true;
    },
    (v) => {
      v.decisions[0].board = true;
      v.decisions[1].board = true;
    },
  ]) {
    const judge = createBoardingJudge({
      godRepository: gods,
      retriever,
      random: () => 0,
      verdictModel: {
        enabled: true,
        generateBoarding: async ({ context, evidence }) => {
          const v = citedVerdict(context, evidence);
          corrupt(v);
          return v;
        },
      },
    });
    const result = await judge(g);
    assert.equal(result.llm.used, false);
    assert.equal(result.llm.fallbackReason, "model_or_validation_failed");
    const discussion = await judge(g, {
      stage: "discussion",
      playerId: "P1",
      text: "请按真实日志复核",
    });
    assert.equal(discussion.llm.used, false);
    assert.match(discussion.verdict.statement, /不理解自由文本/);
    assert.equal(result.verdict.decisions[2].board, false);
    assert.ok(result.verdict.decisions.filter((d) => d.board).length <= 1);
    assert.ok(
      result.verdict.learning.every((l) =>
        result.rag.evidence.some((s) => s.id === l.sourceId),
      ),
    );
  }
});
test("a source outside the current retrieval cannot be cited, even if it exists elsewhere", () => {
  const context = judgmentContext(fixture());
  assert.throws(
    () =>
      validateLearning(
        [{ sourceId: "sen-1998", application: "公平", eventSeqs: [1] }],
        [retriever.library.sources[0]],
        context,
      ),
    /ungrounded/,
  );
});
test("PDF archive refuses HTML/access challenges and unsafe paths; validates bytes and hashes on read", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-pdf-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = retriever.library.sources[0];
  const html = await archiveSource(source, {
    directory,
    fetchImpl: async () => new Response("<html>captcha</html>"),
  });
  assert.equal(html.status, "pending");
  assert.equal(await originalDocument(source, directory), null);
  const fakePdfBytes = "%PDF-1.4\nunit-test-only\n%%EOF";
  const saved = await archiveSource(source, {
    directory,
    fetchImpl: async () =>
      new Response(fakePdfBytes, {
        headers: { "content-type": "application/pdf" },
      }),
  });
  assert.equal(saved.status, "available");
  assert.equal(
    (await originalDocument(source, directory)).sha256,
    saved.sha256,
  );
  await assert.rejects(
    originalDocument({ id: "../secret" }, directory),
    /invalid_source/,
  );
  await writeFile(path.join(directory, `${source.id}.pdf`), "not a pdf");
  assert.equal(await originalDocument(source, directory), null);
});
test("PDF archive falls back from a publisher 403 to a curated public mirror and records the actual source", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-pdf-mirror-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = {
    id: "mirror-test",
    originalUrl: "https://publisher.example/paper.pdf",
    archiveUrls: ["https://institute.example/paper.pdf"],
  };
  const seen = [];
  const saved = await archiveSource(source, {
    directory,
    fetchImpl: async (url) => {
      seen.push(url);
      return url === source.originalUrl
        ? new Response("Forbidden", { status: 403 })
        : new Response("%PDF-1.4\nmirror-only-fixture\n%%EOF");
    },
  });
  assert.deepEqual(seen, [source.originalUrl, ...source.archiveUrls]);
  assert.equal(saved.status, "available");
  assert.equal(saved.downloadUrl, source.archiveUrls[0]);
  assert.equal(saved.requestedUrl, source.archiveUrls[0]);
  assert.equal(saved.provenance, "recorded_download");
  assert.equal(saved.attempts[0].reason, "http_403");
  assert.equal(saved.attempts[1].status, "available");
  const sidecar = JSON.parse(
    await readFile(path.join(directory, `${source.id}.archive.json`), "utf8"),
  );
  assert.equal(sidecar.downloadUrl, source.archiveUrls[0]);
  assert.equal(sidecar.sha256, saved.sha256);
  const cached = await archiveSource(source, {
    directory,
    fetchImpl: async () => assert.fail("cache should not access the network"),
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.downloadUrl, saved.downloadUrl);
  assert.deepEqual(cached.attempts, saved.attempts);
  assert.equal(cached.sha256, saved.sha256);
});
test("PDF archive rejects an HTML mirror then tries the next curated URL without saving an access challenge", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "noah-pdf-html-fallback-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = {
    id: "html-mirror",
    originalUrl: "https://publisher.example/paper.pdf",
    archiveUrls: [
      "https://first.example/paper.pdf",
      "https://second.example/paper.pdf",
    ],
  };
  const saved = await archiveSource(source, {
    directory,
    fetchImpl: async (url) =>
      url === source.originalUrl
        ? new Response("Forbidden", { status: 403 })
        : url === source.archiveUrls[0]
          ? new Response("<html>not the article</html>", {
              headers: { "content-type": "application/pdf" },
            })
          : new Response("%PDF-1.4\nfinal-mirror-fixture\n%%EOF"),
  });
  assert.equal(saved.status, "available");
  assert.equal(saved.downloadUrl, source.archiveUrls[1]);
  assert.deepEqual(
    saved.attempts.map((attempt) => attempt.reason || "ok"),
    ["http_403", "not_pdf_or_access_challenge", "ok"],
  );
  assert.match(
    (await originalDocument(source, directory)).data.toString(),
    /final-mirror-fixture/,
  );
});
test("PDF archive preserves legacy manifest provenance but never invents provenance for an unknown cache", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-pdf-legacy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = {
    id: "legacy-source",
    originalUrl: "https://publisher.example/paper.pdf",
  };
  await writeFile(
    path.join(directory, `${source.id}.pdf`),
    "%PDF-1.4\nlegacy-fixture\n%%EOF",
  );
  const document = await originalDocument(source, directory);
  const noNetwork = async () =>
    assert.fail("existing files should not be replaced");
  const unknown = await archiveSource(source, {
    directory,
    fetchImpl: noNetwork,
  });
  assert.equal(unknown.status, "available");
  assert.equal(unknown.provenance, "unknown");
  assert.equal(unknown.reason, "cache_provenance_unknown");
  assert.equal(unknown.downloadUrl, undefined);
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({
      results: [
        {
          id: source.id,
          originalUrl: source.originalUrl,
          status: "available",
          sha256: document.sha256,
          bytes: document.bytes,
        },
      ],
    }),
  );
  const migrated = await archiveSource(source, {
    directory,
    fetchImpl: noNetwork,
  });
  assert.equal(migrated.status, "available");
  assert.equal(migrated.downloadUrl, source.originalUrl);
  assert.equal(migrated.provenance, "legacy_manifest_original_url");
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({
      archiveFormat: 2,
      results: [
        { id: source.id, originalUrl: source.originalUrl, ...migrated },
      ],
    }),
  );
  const preserved = await archiveSource(source, {
    directory,
    fetchImpl: noNetwork,
  });
  assert.equal(preserved.downloadUrl, source.originalUrl);
  assert.equal(preserved.provenance, migrated.provenance);
  await writeFile(
    path.join(directory, `${source.id}.pdf`),
    "%PDF-1.4\nchanged-fixture\n%%EOF",
  );
  const mismatch = await archiveSource(source, {
    directory,
    fetchImpl: noNetwork,
  });
  assert.equal(mismatch.status, "pending");
  assert.equal(mismatch.reason, "cache_integrity_mismatch");
  assert.equal(mismatch.downloadUrl, undefined);
  assert.match(
    (await originalDocument(source, directory)).data.toString(),
    /changed-fixture/,
  );
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({
      archiveFormat: 2,
      results: [
        { id: source.id, originalUrl: source.originalUrl, ...mismatch },
      ],
    }),
  );
  assert.equal(
    (await archiveSource(source, { directory, fetchImpl: noNetwork })).reason,
    "cache_integrity_mismatch",
  );
});
test("PDF archive records safe redirects and refuses non-HTTPS or credentialed source and redirect URLs", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-pdf-url-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = {
    id: "url-check",
    originalUrl: "https://publisher.example/paper.pdf",
  };
  for (const source of [
    { ...base, originalUrl: "http://publisher.example/paper.pdf" },
    { ...base, originalUrl: "https://user:secret@publisher.example/paper.pdf" },
    { ...base, archiveUrls: ["file:///private/paper.pdf"] },
    { ...base, archiveUrls: ["https://user@institute.example/paper.pdf"] },
  ]) {
    const result = await archiveSource(source, {
      directory,
      fetchImpl: async () => assert.fail("unsafe URL must not be requested"),
    });
    assert.equal(result.status, "pending");
    assert.equal(result.reason, "unsafe_archive_url");
    assert.deepEqual(result.attempts, []);
  }
  for (const location of [
    "http://cdn.example/paper.pdf",
    "https://user:secret@cdn.example/paper.pdf",
  ]) {
    let calls = 0;
    const result = await archiveSource(base, {
      directory,
      fetchImpl: async (_url, init) => {
        calls += 1;
        assert.equal(init.redirect, "manual");
        return new Response(null, { status: 302, headers: { location } });
      },
    });
    assert.equal(result.reason, "unsafe_archive_url");
    assert.equal(calls, 1);
    assert.equal(await originalDocument(base, directory), null);
  }
  const finalUrl = "https://cdn.example/paper.pdf";
  const saved = await archiveSource(base, {
    directory,
    fetchImpl: async (url) =>
      url === base.originalUrl
        ? new Response(null, { status: 302, headers: { location: finalUrl } })
        : new Response("%PDF-1.4\nredirect-fixture\n%%EOF"),
  });
  assert.equal(saved.status, "available");
  assert.equal(saved.requestedUrl, base.originalUrl);
  assert.equal(saved.downloadUrl, finalUrl);
});
test("a failed archive source is isolated from another source's successful download", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-pdf-isolation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sources = [
    { id: "failed-source", originalUrl: "https://offline.example/paper.pdf" },
    { id: "good-source", originalUrl: "https://online.example/paper.pdf" },
  ];
  const results = await Promise.all(
    sources.map((source) =>
      archiveSource(source, {
        directory,
        fetchImpl: async () => {
          if (source.id === "failed-source") throw new Error("unavailable");
          return new Response("%PDF-1.4\nisolated-fixture\n%%EOF");
        },
      }),
    ),
  );
  assert.equal(results[0].status, "pending");
  assert.equal(results[0].reason, "network_or_timeout");
  assert.equal(results[1].status, "available");
  assert.equal(await originalDocument(sources[0], directory), null);
  assert.ok(await originalDocument(sources[1], directory));
});
test("web and link-only originals are intentional external references, never failed PDFs or fetches", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "academic-web-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const format of ["web", "link"]) {
    const source = {
      id: "external-test",
      originalUrl: "https://example.org/chapter",
      originalFormat: format,
    };
    const result = await archiveSource(source, {
      directory,
      fetchImpl: () => {
        throw new Error("must_not_fetch");
      },
    });
    assert.equal(result.status, "external");
    // A stale PDF must not be served after changing the registered format.
    await writeFile(path.join(directory, `${source.id}.pdf`), "%PDF-1.7 stale");
    assert.equal(await originalDocument(source, directory), null);
    assert.equal(
      (
        await archiveSource(
          { ...source, originalUrl: "file:///private" },
          { directory },
        )
      ).reason,
      "unsafe_archive_url",
    );
  }
});
test("library HTTP exposes Chinese source records; missing or unlisted originals return 404", async (t) => {
  const local = await testApi();
  t.after(local.close);
  const response = await fetch(`${local.base}/api/expeditions/knowledge`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.sources.length, 22);
  assert.equal(data.statistics.textbooks, 11);
  assert.equal(
    data.sources.find((s) => s.id === "core-economy-2022").archive.status,
    "external",
  );
  assert.equal(
    (
      await fetch(
        `${local.base}/api/expeditions/knowledge/original/core-economy-2022`,
      )
    ).status,
    404,
  );
  assert.equal(data.semanticModel, false);
  assert.equal(
    (await fetch(`${local.base}/api/expeditions/knowledge/original/not-listed`))
      .status,
    404,
  );
  assert.equal(
    (
      await fetch(
        `${local.base}/api/expeditions/knowledge/original/%2e%2e%2fsecrets`,
      )
    ).status,
    404,
  );
});
test("all 15 cards, 12 disasters, 10 characters and flood have concise implemented descriptions", () => {
  const cards = [...CARDS.actions, ...CARDS.technology];
  assert.equal(cards.length, 15);
  for (const c of cards) {
    assert.ok(c.effectSummary && c.effectSummary.length < 100, c.id);
    assert.ok(c.implementedEffect);
  }
  for (const group of Object.values(DISASTERS))
    for (const list of Object.values(group))
      for (const card of list)
        assert.ok(
          card.effectSummary && card.effectSummary.length < 100,
          card.id,
        );
  assert.equal(CHARACTERS.length, 10);
  assert.ok(
    CHARACTERS.every((c) => c.implementedEffect.includes("没有额外技能")),
  );
  assert.match(EFFECT_SUMMARIES.flood, /3\/5\/7/);
  assert.match(CARDS.actions[0].effectSummary, /不是交换/);
  assert.match(
    CARDS.technology.find((c) => c.id === "recycling-claw").effectSummary,
    /满手直接弃置/,
  );
});
