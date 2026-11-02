import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main, runLiveBatch } from "../../scripts/simulate-learning-live.mjs";
import {
  allowMiniMaxEndpoint,
  buildStudentEvidencePacket,
  buildStudentSpeechNotebook,
  createStageRunner,
  formatSpeechForService,
  isAuthenticationFailure,
  parseLiveArguments,
  parsePlayerJson,
  privateRedactor,
  resumeBudget,
  safeLiveFailure,
  safeResponseStop,
  safeRetryAfterSeconds,
  safeValidationDiagnostic,
  safeUsage,
  validatePeerBatch,
  validatePlayerSpeech,
} from "../../scripts/lib/live-simulation.mjs";
import { fallbackBoarding } from "../src/expedition/judgment.js";
import { judgmentContext } from "../src/expedition/judgment.js";
import { simulate } from "../src/expedition/simulation.js";
import { localLearning } from "../src/academic/learning.js";

// No test loads a dotenv file or sends real HTTP. The full-workflow test uses
// the production judge/service/rules with a fake Anthropic transport.
const noop = () => {};
const secret = "not-a-live-key-only-test-secret";
const context = {
  players: [{ id: "P1" }, { id: "P2" }],
  globalEvents: [
    { seq: 1, actor: "P1", type: "donate" },
    { seq: 2, actor: "P2", type: "gather" },
    { seq: 3, actor: "P1", type: "discussion" },
  ],
};
const peerBatch = {
  reviews: [
    {
      reviewerId: "P1",
      entries: [
        { targetId: "P2", rating: 3, comment: "这是待核实观点", evidence: [2] },
      ],
    },
    {
      reviewerId: "P2",
      entries: [
        { targetId: "P1", rating: 4, comment: "这不是人气投票", evidence: [1] },
      ],
    },
  ],
};

test("live simulation defaults are dry, bounded and reject path traversal/unknown options", () => {
  const parsed = parseLiveArguments([]);
  assert.equal(parsed.live, false);
  assert.equal(parsed.matches, 20);
  assert.equal(parsed.maxRequests, 300);
  assert.equal(parsed.structured, false);
  assert.equal(parsed.concise, false);
  assert.equal(parseLiveArguments(["--structured", "--concise"]).concise, true);
  assert.equal(parsed.policyOffset, 0);
  assert.equal(parsed.godOutputTokens, 3000);
  assert.equal(
    parseLiveArguments(["--structured", "--matches", "1"]).maxRequests,
    17,
  );
  assert.equal(parseLiveArguments(["--structured"]).maxRequests, 300);
  assert.equal(parseLiveArguments(["--policy-offset", "3"]).policyOffset, 3);
  assert.equal(
    parseLiveArguments([
      "--live",
      "--max-requests",
      "15",
      "--run-id",
      "canary-20",
    ]).runId,
    "canary-20",
  );
  for (const args of [
    ["--matches", "21"],
    ["--matches", "0"],
    ["--matches", "1.5"],
    ["--max-requests", "301"],
    ["--matches", "1", "--max-requests", "16"],
    ["--run-id", "../secrets"],
    ["--run-id", "/tmp/x"],
    ["--run-id", "hello.world"],
    ["--resume", "run"],
    ["--live", "--dry-run"],
    ["--matches"],
    ["--api-key", secret],
    ["--live", "--live"],
    ["--run-id", "x", "--resume", "x"],
    ["--timeout-ms", "900000"],
    ["--concise"],
    ["--structured", "--concise", "--concise"],
    ["--policy-offset", "4"],
    ["--policy-offset", "-1"],
    ["--policy-offset", "1.5"],
    ["--structured", "--matches", "1", "--max-requests", "18"],
  ])
    assert.throws(() => parseLiveArguments(args), /invalid_arguments/);
});

test("god output cap is explicit, bounded, structured-only and rejected before dotenv or HTTP", async () => {
  for (const value of [3000, 5000, 8000])
    assert.equal(
      parseLiveArguments(["--structured", "--god-output-tokens", String(value)])
        .godOutputTokens,
      value,
    );
  assert.equal(
    parseLiveArguments(["--god-output-tokens", "3000"]).godOutputTokens,
    3000,
  );
  for (const args of [
    ["--god-output-tokens", "8000"],
    ...[0, 2999, 8001, 3000.5, "NaN", "Infinity"].map((value) => [
      "--structured",
      "--god-output-tokens",
      String(value),
    ]),
  ])
    assert.throws(
      () => parseLiveArguments(args),
      /invalid_boarding_output_token_limit/,
    );
  assert.equal(
    safeLiveFailure(new Error("invalid_boarding_output_token_limit")),
    "invalid_boarding_output_token_limit",
  );
  let loads = 0,
    requests = 0;
  await assert.rejects(
    runLiveBatch(
      { live: true, structured: false, godOutputTokens: 8000 },
      {
        loadEnv: () => {
          loads++;
        },
        fetchImpl: () => {
          requests++;
        },
      },
    ),
    /invalid_boarding_output_token_limit/,
  );
  assert.equal(loads, 0);
  assert.equal(requests, 0);
});

test("concise guidance is structured-only and rejected before environment loading", async () => {
  let loads = 0;
  await assert.rejects(
    runLiveBatch(
      { live: true, structured: false, concise: true },
      {
        loadEnv: () => {
          loads++;
        },
      },
    ),
    /invalid_arguments/,
  );
  assert.equal(loads, 0);
});

test("default CLI dry-run does not load env, call transport, or write outputs", async () => {
  let loads = 0,
    requests = 0;
  const outputs = [];
  const code = await main(["--matches", "1"], {
    loadEnv: () => {
      loads++;
      throw Error("must not load");
    },
    fetchImpl: () => {
      requests++;
      throw Error("must not request");
    },
    print: (message) => outputs.push(message),
  });
  assert.equal(code, 0);
  assert.equal(loads, 0);
  assert.equal(requests, 0);
  const result = JSON.parse(outputs[0]);
  assert.equal(result.actualHttpRequests, 0);
  assert.equal(result.matches[0].players, 6);
  assert.equal(result.matches[0].rounds, 8);
  assert.equal(result.boardingOutputTokenLimit, 3000);
  assert.equal(result.concise, false);
  assert.match(result.mode, /no .env, network, LLM or file writes/);
});

test("only credential-free official MiniMax Anthropic endpoints are allowed", () => {
  for (const host of ["api.minimaxi.com", "api.minimax.io", "api.minimax.cn"])
    assert.equal(
      allowMiniMaxEndpoint(`https://${host}/anthropic/`),
      `https://${host}/anthropic`,
    );
  for (const value of [
    "http://api.minimaxi.com/anthropic",
    "https://api.minimaxi.com.evil.com/anthropic",
    "https://user:pass@api.minimaxi.com/anthropic",
    "https://api.minimaxi.com/anthropic?key=hello",
    "https://api.minimaxi.com/anthropic#secret",
    "https://api.minimaxi.com:8080/anthropic",
    "https://localhost/anthropic",
    "https://api.minimaxi.com/v1",
    "not a URL",
  ])
    assert.throws(() => allowMiniMaxEndpoint(value), /untrusted_api_endpoint/);
});

test("successful-output redaction strips secrets and full/partial prompt echoes", () => {
  const prompt =
    "PRIVATE_PROMPT_LONG_LINE_FOR_REDACTION\nSECOND_PRIVATE_RULE_LINE_LONG_ENOUGH";
  const redact = privateRedactor([secret, prompt]);
  const result = JSON.stringify(
    redact({
      statement: `${secret}; ${prompt}; SECOND_PRIVATE_RULE_LINE_LONG_ENOUGH; Bearer abcdefg; sk-123456789abcdef`,
      rows: [secret],
    }),
  );
  assert.doesNotMatch(
    result,
    /not-a-live-key|PRIVATE_PROMPT|SECOND_PRIVATE_RULE|abcdefg|sk-123/,
  );
  assert.match(result, /REDACTED/);
  assert.equal(
    safeLiveFailure(new Error(secret)),
    "request_or_validation_failed",
  );
});

test("peer and speech validators reject invented references, self reviews and opinions used as facts", () => {
  assert.deepEqual(validatePeerBatch(peerBatch, context), peerBatch);
  for (const mutate of [
    (v) => {
      v.reviews[0].reviewerId = "P7";
    },
    (v) => {
      v.reviews[1].reviewerId = "P1";
    },
    (v) => {
      v.reviews[0].entries[0].targetId = "P1";
    },
    (v) => {
      v.reviews[0].entries[0].rating = 6;
    },
    (v) => {
      v.reviews[0].entries[0].evidence = [888];
    },
    (v) => {
      v.reviews[0].entries[0].evidence = [1];
    },
    (v) => {
      v.reviews[1].entries[0].evidence = [3];
    },
  ]) {
    const value = structuredClone(peerBatch);
    mutate(value);
    assert.throws(
      () => validatePeerBatch(value, context),
      /invalid_peer_reviews/,
    );
  }
  const speech = {
    playerId: "P1",
    text: "我引用实际捐赠，但这不证明我比别人更好。",
    evidence: [1],
  };
  assert.deepEqual(validatePlayerSpeech(speech, context, "P1"), speech);
  assert.throws(
    () => validatePlayerSpeech({ ...speech, evidence: [2] }, context, "P1"),
    /invalid_player_speech/,
  );
  assert.throws(
    () => validatePlayerSpeech({ ...speech, evidence: [3] }, context, "P1"),
    /invalid_player_speech/,
  );
  assert.throws(
    () => validatePlayerSpeech(speech, context, "P2"),
    /invalid_player_speech/,
  );
});

test("provider body and usage parse only allowlisted data", () => {
  assert.deepEqual(
    parsePlayerJson({
      content: [
        { type: "thinking", text: "hidden" },
        { type: "text", text: '```json\n{"ok":true}\n```' },
      ],
    }),
    { ok: true },
  );
  assert.throws(
    () => parsePlayerJson({ content: [{ type: "text", text: "not json" }] }),
    /invalid_json/,
  );
  assert.deepEqual(
    safeUsage({
      usage: {
        input_tokens: 40,
        output_tokens: 20,
        secret,
        debug: "no",
        cache_read_input_tokens: -1,
      },
    }),
    { input_tokens: 40, output_tokens: 20 },
  );
  assert.equal(safeUsage({ usage: { arbitrary: 42 } }), null);
  assert.equal(safeUsage(null), null);
  assert.deepEqual(safeResponseStop({ stop_reason: secret }), {
    stopReason: "other",
    outputTruncated: false,
  });
  assert.deepEqual(safeResponseStop({ stop_reason: { raw: secret } }), {
    stopReason: "other",
    outputTruncated: false,
  });
  assert.deepEqual(safeResponseStop({ stop_reason: "max_tokens" }), {
    stopReason: "max_tokens",
    outputTruncated: true,
  });
  assert.throws(
    () =>
      parsePlayerJson({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"valid":true}' }],
      }),
    /response_truncated/,
  );
});

test("Retry-After telemetry accepts only bounded integer seconds, never dates or arbitrary header contents", () => {
  for (const value of ["0", "1", "60", "3600", "86400"])
    assert.equal(safeRetryAfterSeconds(value), Number(value));
  for (const value of [
    undefined,
    null,
    60,
    {},
    "",
    "-1",
    "+1",
    "1.5",
    " 60 ",
    "86401",
    "100000",
    "Fri, 30 Oct 2026 10:00:00 GMT",
    secret,
    "60\nprivate-header",
  ])
    assert.equal(safeRetryAfterSeconds(value), null);
});

test("peer optional rating/comment follows production, while evidence remains required", () => {
  const value = structuredClone(peerBatch);
  value.reviews[0].entries[0].rating = null;
  delete value.reviews[1].entries[0].comment;
  const result = validatePeerBatch(value, context, [1, 2]);
  assert.equal(result.reviews[0].entries[0].rating, null);
  assert.equal(result.reviews[1].entries[0].comment, "");
  delete value.reviews[0].entries[0].rating;
  assert.equal(
    validatePeerBatch(value, context).reviews[0].entries[0].rating,
    null,
  );
  value.reviews[0].entries[0].comment = "   ";
  assert.throws(
    () => validatePeerBatch(value, context),
    /invalid_peer_reviews/,
  );
  value.reviews[0].entries[0].comment = null;
  assert.throws(
    () => validatePeerBatch(value, context),
    /invalid_peer_reviews/,
  );
});

test("speech accepts seven or all visible refs unchanged and uses production's 4000-char submitted-text limit", () => {
  const full = {
    players: [{ id: "P1" }, { id: "P2" }],
    globalEvents: Array.from({ length: 10 }, (_, i) => ({
      seq: i + 1,
      actor: i % 2 ? "P2" : "P1",
      type: "donation",
    })),
  };
  const allowed = full.globalEvents.map((event) => event.seq);
  const value = {
    playerId: "P1",
    text: "这是事实与计划分开的测试。".repeat(160),
    evidence: [7, 6, 5, 4, 3, 2, 1],
  };
  assert.ok(value.text.length > 1800);
  assert.deepEqual(
    validatePlayerSpeech(value, full, "P1", allowed).evidence,
    value.evidence,
  );
  value.evidence = [...allowed].reverse();
  assert.deepEqual(
    validatePlayerSpeech(value, full, "P1", allowed).evidence,
    value.evidence,
  );
  assert.ok(formatSpeechForService(value).length < 4000);
  value.text = "文".repeat(
    4000 -
      formatSpeechForService({ text: "", evidence: value.evidence }).length,
  );
  assert.equal(formatSpeechForService(value).length, 4000);
  validatePlayerSpeech(value, full, "P1", allowed);
  value.text += "文";
  assert.throws(
    () => validatePlayerSpeech(value, full, "P1", allowed),
    (error) => safeValidationDiagnostic(error).textLength === 4001,
  );
  value.text = "正常长度";
  value.evidence = [2, 4, 6, 8, 10];
  assert.throws(
    () => validatePlayerSpeech(value, full, "P1", allowed),
    (error) =>
      safeValidationDiagnostic(error).reason === "no_event_involving_target",
  );
  value.evidence = [1, 2, 2];
  assert.throws(
    () => validatePlayerSpeech(value, full, "P1", allowed),
    (error) => safeValidationDiagnostic(error).reason === "duplicate_event",
  );
});

test("speech notebook adds true references from decisions, learning and dialogue without legitimizing unknown/opinion IDs", () => {
  const full = {
    players: [{ id: "P1" }, { id: "P2" }],
    globalEvents: [
      ...Array.from({ length: 10 }, (_, i) => ({
        seq: i + 1,
        actor: i % 2 ? "P2" : "P1",
        type: "donation",
        detail: "真实测试行为",
      })),
      { seq: 11, actor: "god", type: "judge", detail: "意见而非行为" },
    ],
  };
  const base = buildStudentEvidencePacket(full);
  assert.ok(!base.visibleEventSeqs.includes(1));
  const judgment = {
    verdict: {
      statement: "请核对事件 #5，未知事件 #999999 不能当事实。",
      decisions: [
        { playerId: "P1", evidence: [1] },
        { playerId: "P2", evidence: [2] },
      ],
      learning: [
        { sourceId: "test-source", application: "只是观点", eventSeqs: [3] },
      ],
    },
    history: [{ verdict: { decisions: [{ playerId: "P2", evidence: [4] }] } }],
    conversations: [
      {
        text: "我引用实际行为事件：#6",
        reply: "#11是裁决意见；#999998查无记录",
      },
    ],
  };
  const before = JSON.stringify({ full, base, judgment });
  const view = buildStudentSpeechNotebook(full, base, judgment, "P1");
  for (const seq of [1, 2, 3, 4, 5, 6])
    assert.ok(view.visibleEventSeqs.includes(seq));
  assert.ok(view.allowedEventSeqsByPlayer.P1.includes(1));
  assert.ok(!view.allowedEventSeqsByPlayer.P1.includes(2));
  assert.ok(!view.visibleEventSeqs.includes(11));
  assert.deepEqual(view.referenceDiagnostics.opinionEventSeqs, [11]);
  assert.deepEqual(
    view.referenceDiagnostics.unresolvedEventSeqs,
    [999998, 999999],
  );
  validatePlayerSpeech(
    {
      playerId: "P1",
      text: "我质疑之前忽略的真实事件。",
      evidence: [1, 2, 3, 4, 5, 6, 7],
    },
    full,
    "P1",
    view.visibleEventSeqs,
  );
  for (const invalidSeq of [11, 999998])
    assert.throws(
      () =>
        validatePlayerSpeech(
          { playerId: "P1", text: "测试", evidence: [1, invalidSeq] },
          full,
          "P1",
          view.visibleEventSeqs,
        ),
      /invalid_player_speech/,
    );
  assert.equal(JSON.stringify({ full, base, judgment }), before);
});

test("stop telemetry redacts unknown reasons and truncated valid JSON remains a failed stage", async () => {
  for (const stop_reason of ["max_tokens", secret]) {
    const report = ledger();
    const runner = createStageRunner({
      report,
      endpoint,
      persist: async () => {},
      fetchImpl: async () =>
        Response.json({
          stop_reason,
          content: [{ type: "text", text: '{"valid":true}' }],
        }),
    });
    const invoke = async () => {
      await runner.fetch(endpoint, {
        body: JSON.stringify({ max_tokens: 8000, system: secret }),
      });
      return { valid: true };
    };
    if (stop_reason === "max_tokens") {
      await assert.rejects(
        runner.run("truncated", {}, invoke, (value) => value),
        /response_truncated/,
      );
      assert.equal(report.stages[0].failure, "response_truncated");
      assert.equal(report.stages[0].value, undefined);
    } else {
      await runner.run("unknown-stop", {}, invoke, (value) => value);
      assert.equal(report.stages[0].stopReason, "other");
    }
    assert.equal(report.stages[0].requestMaxOutputTokens, 8000);
    assert.equal(report.requestBudget.actual, 1);
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});

test("peer count matches production 1..N-1, preserving all five reviews and rejecting duplicate/self/excess", () => {
  const six = {
    players: Array.from({ length: 6 }, (_, i) => ({ id: `P${i + 1}` })),
    globalEvents: Array.from({ length: 6 }, (_, i) => ({
      seq: i + 1,
      actor: `P${i + 1}`,
      type: "donation",
    })),
  };
  const candidate = {
    reviews: six.players.map((player) => ({
      reviewerId: player.id,
      entries: six.players
        .filter((target) => target.id !== player.id)
        .map((target) => ({
          targetId: target.id,
          rating: 3,
          comment: "明确的待核实测试观点",
          evidence: [Number(target.id.slice(1))],
        })),
    })),
  };
  assert.deepEqual(
    validatePeerBatch(candidate, six, [1, 2, 3, 4, 5, 6]),
    candidate,
  );
  const duplicate = structuredClone(candidate);
  duplicate.reviews[0].entries[4] = structuredClone(
    duplicate.reviews[0].entries[0],
  );
  assert.throws(
    () => validatePeerBatch(duplicate, six),
    (error) => safeValidationDiagnostic(error).reason === "duplicate_target",
  );
  const self = structuredClone(candidate);
  self.reviews[0].entries[0].targetId = "P1";
  assert.throws(
    () => validatePeerBatch(self, six),
    (error) => safeValidationDiagnostic(error).reason === "self_review",
  );
  const tooMany = structuredClone(candidate);
  tooMany.reviews[0].entries.push(
    structuredClone(tooMany.reviews[0].entries[0]),
  );
  assert.throws(
    () => validatePeerBatch(tooMany, six),
    (error) => {
      assert.equal(safeValidationDiagnostic(error).reason, "wrong_count");
      assert.equal(safeValidationDiagnostic(error).actualCount, 6);
      return true;
    },
  );
});

test("safe validation diagnostics identify the field/player/seq without leaking rejected model text", () => {
  const batch = structuredClone(peerBatch);
  batch.reviews[0].entries[0].evidence = [123456];
  assert.throws(
    () => validatePeerBatch(batch, context),
    (error) => {
      assert.deepEqual(safeValidationDiagnostic(error), {
        path: "reviews[0].entries[0].evidence[0]",
        reason: "unknown_behavior_event",
        reviewerId: "P1",
        targetId: "P2",
        eventSeq: 123456,
      });
      return true;
    },
  );
  batch.reviews[0].entries[0].evidence = [secret];
  assert.throws(
    () => validatePeerBatch(batch, context),
    (error) => {
      const safe = safeValidationDiagnostic(error);
      assert.equal(safe.reason, "non_integer_event");
      assert.equal(safe.eventSeq, undefined);
      assert.ok(!JSON.stringify(safe).includes(secret));
      return true;
    },
  );
  assert.equal(
    safeValidationDiagnostic({
      validationDiagnostic: {
        path: secret,
        reason: "unknown_player",
        raw: secret,
      },
    }),
    null,
  );
  assert.deepEqual(
    safeValidationDiagnostic({
      validationDiagnostic: {
        path: "playerId",
        reason: "wrong_speaker",
        playerId: secret,
        eventSeq: secret,
        raw: secret,
      },
    }),
    { path: "playerId", reason: "wrong_speaker" },
  );
  assert.throws(
    () => validatePeerBatch(peerBatch, context, [1, 999]),
    (error) => {
      assert.equal(
        safeValidationDiagnostic(error).reason,
        "event_not_in_visible_index",
      );
      return true;
    },
  );
});

test(
  "student notebook is compact, deterministic, factual and cannot mutate the full god context",
  { timeout: 30000 },
  () => {
    const { game } = simulate({
      seed: 2001,
      players: 6,
      policy: "mixed",
      learningMode: true,
    });
    const full = judgmentContext(game);
    const original = JSON.stringify(full);
    const notebook = buildStudentEvidencePacket(full);
    assert.equal(notebook.version, "student-evidence-v3");
    assert.equal(notebook.players.length, 6);
    assert.ok(notebook.evidenceIndex.length <= 6 * 14 + 3);
    assert.equal(notebook.globalEvents, undefined);
    assert.equal(notebook.facts, undefined);
    assert.ok(
      JSON.stringify(notebook).length < original.length * 0.1,
      "student facts should avoid >90% duplicate/context weight",
    );
    assert.deepEqual(notebook, buildStudentEvidencePacket(full));
    for (const player of full.players) {
      const row = notebook.players.find((item) => item.id === player.id);
      assert.deepEqual(row.donated, player.donated);
      assert.deepEqual(row.worldImpact, player.worldImpact);
      assert.equal(row.eligible, player.eligible);
      assert.ok(notebook.allowedEventSeqsByPlayer[player.id].length > 0);
      assert.ok(
        notebook.allowedEventSeqsByPlayer[player.id].length <=
          notebook.evidenceIndex.length,
      );
      for (const seq of notebook.allowedEventSeqsByPlayer[player.id]) {
        const event = full.globalEvents.find((event) => event.seq === seq);
        assert.ok(
          [event.actor, event.targetId, event.owner].includes(player.id),
        );
        assert.ok(notebook.evidenceIndex.some((event) => event.seq === seq));
      }
    }
    assert.ok(
      notebook.evidenceIndex.every((event) => event.effects === undefined),
    );
    assert.equal(JSON.stringify(full), original);
    assert.match(notebook.evidenceScope, /非完整航程/);
    // Regression for real v2 canary rejection: event 527 was sampled by P2,
    // but its recipient is P3, so both must be able to cite the displayed fact.
    const shared = full.globalEvents.find((event) => event.seq === 527);
    assert.equal(shared.actor, "P2");
    assert.equal(shared.targetId, "P3");
    assert.ok(notebook.visibleEventSeqs.includes(527));
    assert.ok(notebook.allowedEventSeqsByPlayer.P2.includes(527));
    assert.ok(notebook.allowedEventSeqsByPlayer.P3.includes(527));
    const comparisons = {
      reviews: full.players.map((player, index) => {
        const targetId = full.players[(index + 1) % full.players.length].id;
        return {
          reviewerId: player.id,
          entries: [
            {
              targetId,
              rating: 3,
              comment: "这是测试观点，引用不自动证明评论正确。",
              evidence: [notebook.allowedEventSeqsByPlayer[targetId][0]],
            },
          ],
        };
      }),
    };
    const unrelatedVisible = notebook.evidenceIndex.find(
      (event) => ![event.actor, event.targetId, event.owner].includes("P3"),
    );
    comparisons.reviews[0].entries[0] = {
      targetId: "P3",
      rating: 3,
      comment: "可以比较他人行为，但必须包含被评玩家的事实。",
      evidence: [unrelatedVisible.seq, 527],
    };
    const validated = validatePeerBatch(
      comparisons,
      full,
      notebook.visibleEventSeqs,
    );
    assert.deepEqual(
      validated.reviews[0].entries[0].evidence,
      [unrelatedVisible.seq, 527],
      "references must never be filtered, sorted or rewritten",
    );
    comparisons.reviews[0].entries[0].evidence = [unrelatedVisible.seq];
    assert.throws(
      () => validatePeerBatch(comparisons, full, notebook.visibleEventSeqs),
      (error) =>
        safeValidationDiagnostic(error).reason === "no_event_involving_target",
    );
    const hidden = full.globalEvents.find(
      (event) => !notebook.visibleEventSeqs.includes(event.seq),
    );
    comparisons.reviews[0].entries[0].evidence = [527, hidden.seq];
    assert.throws(
      () => validatePeerBatch(comparisons, full, notebook.visibleEventSeqs),
      (error) =>
        safeValidationDiagnostic(error).reason === "event_not_in_visible_index",
    );
    comparisons.reviews[0].entries[0].evidence = [527, 999999];
    assert.throws(
      () =>
        validatePeerBatch(comparisons, full, [
          ...notebook.visibleEventSeqs,
          999999,
        ]),
      (error) =>
        safeValidationDiagnostic(error).reason === "unknown_behavior_event",
    );
    const withOpinion = structuredClone(full);
    withOpinion.globalEvents.push({
      seq: 999999,
      type: "peer_review",
      actor: "P3",
    });
    assert.throws(
      () =>
        validatePeerBatch(comparisons, withOpinion, [
          ...notebook.visibleEventSeqs,
          999999,
        ]),
      (error) =>
        safeValidationDiagnostic(error).reason === "unknown_behavior_event",
    );
    notebook.players[0].donated.wood += 1000;
    notebook.world.environment = -1000;
    notebook.evidenceIndex[0].detail = "mutated student notebook";
    assert.equal(
      JSON.stringify(full),
      original,
      "student views must not alias the god's full source context",
    );
  },
);

test("stage ledger stores bounded validation diagnosis but never the invalid candidate", async () => {
  const report = ledger();
  const runner = createStageRunner({
    report,
    endpoint,
    persist: async () => {},
    fetchImpl: async () => {
      throw new Error("must not request");
    },
  });
  const candidate = structuredClone(peerBatch);
  candidate.reviews[0].entries[0].evidence = [123456];
  candidate.privateEcho = secret;
  await assert.rejects(
    runner.run(
      "invalid-peer",
      {},
      async () => candidate,
      (value) => validatePeerBatch(value, context),
    ),
    /invalid_peer_reviews/,
  );
  assert.equal(
    report.stages[0].validationDiagnostic.reason,
    "unknown_behavior_event",
  );
  assert.equal(report.stages[0].value, undefined);
  assert.ok(!JSON.stringify(report).includes(secret));
});

function ledger() {
  return { stages: [], requestBudget: { actual: 0, total: 15 } };
}
const endpoint = "https://api.minimaxi.com/anthropic/v1/messages";

test("paid HTTP is reserved before transport, bounded per stage, and never redirected", async () => {
  const report = ledger();
  let persistedReservation = false,
    requests = 0;
  const runner = createStageRunner({
    report,
    endpoint,
    persist: async () => {
      if (report.requestBudget.actual === 1) persistedReservation = true;
    },
    fetchImpl: async (_url, options) => {
      assert.ok(persistedReservation);
      assert.equal(options.redirect, "error");
      requests++;
      return Response.json({ usage: { input_tokens: 5, output_tokens: 2 } });
    },
  });
  await assert.rejects(
    runner.run(
      "one",
      {},
      async () => {
        await runner.fetch(endpoint, {});
        await runner.fetch(endpoint, {});
      },
      (value) => value,
    ),
    /request_budget_exhausted/,
  );
  assert.equal(requests, 1);
  assert.equal(report.requestBudget.actual, 1);
  assert.equal(report.stages[0].blockedRetries, 1);
  assert.equal(report.stages[0].status, "failed");
  assert.deepEqual(report.stages[0].usage, {
    input_tokens: 5,
    output_tokens: 2,
  });
});

test("completed stages replay without HTTP, changed context and unknown interrupted requests cannot retry", async () => {
  const report = ledger();
  let requests = 0;
  const runner = createStageRunner({
    report,
    endpoint,
    persist: async () => {},
    fetchImpl: async () => {
      requests++;
      return Response.json({});
    },
  });
  const invoke = async () => {
    await runner.fetch(endpoint, {});
    return { ok: true };
  };
  assert.deepEqual(await runner.run("one", { seed: 1 }, invoke, (v) => v), {
    ok: true,
  });
  assert.deepEqual(await runner.run("one", { seed: 1 }, invoke, (v) => v), {
    ok: true,
  });
  assert.equal(requests, 1);
  await assert.rejects(
    runner.run("one", { seed: 2 }, invoke, (v) => v),
    /resume_config_changed/,
  );
  report.stages[0].status = "running";
  await assert.rejects(
    runner.run("one", { seed: 1 }, invoke, (v) => v),
    /interrupted_request_not_retried/,
  );
  assert.equal(requests, 1);
});

test("resume budget only increases; known authentication failures open breaker", () => {
  const report = ledger();
  resumeBudget(report, 300);
  assert.equal(report.requestBudget.total, 300);
  assert.throws(
    () => resumeBudget(report, 15),
    /resume_budget_cannot_decrease/,
  );
  assert.equal(isAuthenticationFailure([{ httpStatus: 401 }]), true);
  assert.equal(
    isAuthenticationFailure([{ httpStatus: 400, providerCode: 1004 }]),
    true,
  );
  assert.equal(
    isAuthenticationFailure([{ httpStatus: 400, providerCode: 2013 }]),
    false,
  );
});

function fakeProvider(
  requests,
  {
    failAuth = false,
    malformed = false,
    allPeers = false,
    contractEdges = false,
    repairPeer = false,
    repairGod = false,
    brokenSpeech = false,
    rateLimitAt = 0,
    retryAfter = "60",
  } = {},
) {
  let peerFailures = 0,
    godFailures = 0;
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push({
      model: body.model,
      maxOutputTokens: body.max_tokens,
      tool: body.tool_choice?.name,
      concisePlayerGuidance:
        body.messages[0].content[0].text.includes(
          "简短提交：互评建议每人2个具体观察",
        ),
      conciseGodGuidance: body.messages[0].content[0].text.includes(
        "简明表达指引（仅优化表述，不改规则、事实或校验）",
      ),
      safeFeedback:
        body.messages[0].content[0].text.includes("上次提交未通过") ||
        body.messages[0].content[0].text.includes("安全错误"),
    });
    if (requests.length === rateLimitAt)
      return Response.json(
        { error: { message: secret } },
        {
          status: 429,
          headers: { "retry-after": retryAfter, "x-private-test": secret },
        },
      );
    if (failAuth)
      return Response.json(
        { error: { code: 1004, message: secret } },
        { status: 401 },
      );
    if (malformed)
      return Response.json({ content: [{ type: "text", text: "invalid" }] });
    const prompt = body.messages[0].content[0].text;
    let value;
    if (prompt.includes("INPUT_JSON")) {
      const input = JSON.parse(
        prompt.split("\nINPUT_JSON\n")[1].split("\nEND_INPUT_JSON\n")[0],
      );
      if (input.playerId) {
        const event = input.notebook.evidenceIndex.find(
          (event) =>
            event.actor === input.playerId && event.type === "donation",
        );
        value = {
          playerId: input.playerId,
          text: contractEdges
            ? "这是事实与计划分开的测试。".repeat(160)
            : "模拟测试：我有实际捐赠，但也应核对环境成本，不能以贡献总量证明人格。",
          evidence: contractEdges
            ? [
                event.seq,
                ...input.allowedEventSeqs
                  .filter((seq) => seq !== event.seq)
                  .slice(0, 6),
              ]
            : [event.seq],
        };
        if (contractEdges) assert.equal(value.evidence.length, 7);
        if (brokenSpeech) value.evidence = [99999999];
      } else {
        value = {
          reviews: input.notebook.players.map((player, index) => {
            const targets = allPeers
              ? input.notebook.players.filter(
                  (target) => target.id !== player.id,
                )
              : [input.notebook.players[(index + 1) % 6]];
            return {
              reviewerId: player.id,
              entries: targets.map(({ id: targetId }) => {
                const event = input.notebook.evidenceIndex.find(
                  (event) =>
                    event.actor === targetId && event.type === "donation",
                );
                const entry = {
                  targetId,
                  rating: 3,
                  comment: "程序化测试数据，不是实际模型或学生评价。",
                  evidence: [event.seq],
                };
                if (contractEdges && index === 0) entry.rating = null;
                if (contractEdges && index === 1) delete entry.comment;
                return entry;
              }),
            };
          }),
        };
        if (repairPeer && peerFailures++ === 0)
          value.reviews[0].entries[0].evidence = [99999999];
      }
    } else {
      const contextStart = prompt.indexOf("\n{") + 1;
      const contextEnd = prompt.indexOf("\n只输出 JSON");
      const input = JSON.parse(prompt.slice(contextStart, contextEnd));
      assert.ok(body.system.includes("完整角色设计提示词"));
      assert.ok(
        input.context.globalEvents.length > 100,
        "full causal record is retained",
      );
      assert.equal(input.context.peerReviews.complete, true);
      assert.equal(input.academic, true);
      assert.ok(
        input.context.facts.players.every((player) =>
          Array.isArray(player.donationEvents),
        ),
        "full god fact tables must remain present",
      );
      value = {
        ...fallbackBoarding(input.context, { id: "balanced" }),
        learning: localLearning(input.evidence, input.context),
      };
      if (repairGod && godFailures++ === 0)
        value.decisions.forEach((decision) => {
          decision.board = true;
        });
    }
    if (body.tools) {
      assert.equal(body.tools.length, 1);
      assert.equal(body.tool_choice.type, "tool");
      assert.equal(body.tools[0].name, body.tool_choice.name);
      if (prompt.includes("INPUT_JSON")) {
        assert.doesNotMatch(body.system, /只输出严格 JSON/);
        assert.match(body.system, /指定工具/);
      }
      return Response.json({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "mock-tool",
            name: body.tool_choice.name,
            input: value,
          },
        ],
        usage: { input_tokens: 42, output_tokens: 37 },
      });
    }
    return Response.json({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(value) }],
      usage: { input_tokens: 42, output_tokens: 37 },
    });
  };
}

test(
  "full service mock canary runs peer→initial→all survivors→final, pauses and resumes without rebilling completed match",
  { timeout: 120000 },
  async () => {
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "noah-live-runner-test-"),
    );
    const requests = [];
    const dependencies = {
      outputRoot,
      loadEnv: noop,
      env: { MINIMAX_API_KEY: secret },
      fetchImpl: fakeProvider(requests),
      print: noop,
    };
    const options = parseLiveArguments([
      "--live",
      "--matches",
      "2",
      "--start",
      "2001",
      "--max-requests",
      "15",
      "--run-id",
      "bounded-test",
    ]);
    const canary = await runLiveBatch(options, dependencies);
    assert.equal(canary.status, "paused_budget");
    assert.equal(canary.matches.length, 1);
    assert.equal(canary.matches[0].status, "passed");
    assert.equal(
      canary.matches[0].httpRequests,
      3 + 2 * canary.matches[0].survivors,
    );
    assert.ok(Object.values(canary.matches[0].checks).every(Boolean));
    const paidFirst = canary.requestBudget.actual;
    const resumed = await runLiveBatch(
      { ...options, resume: true, maxRequests: 30 },
      dependencies,
    );
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.summary.completedLiveMatches, 2);
    assert.equal(resumed.summary.failedMatches, 0);
    assert.equal(resumed.matches[0].httpRequests, paidFirst);
    assert.equal(requests.length, resumed.requestBudget.actual);
    assert.equal(resumed.summary.usageReportedRequests, requests.length);
    assert.ok(requests.every((request) => request.model === "MiniMax-M3"));
    assert.ok(
      requests.every(
        (request) =>
          !request.concisePlayerGuidance && !request.conciseGodGuidance,
      ),
      "legacy default requests receive no concise guidance",
    );
    const onDisk = await readFile(
      path.join(outputRoot, "bounded-test/report.json"),
      "utf8",
    );
    assert.ok(
      !/not-a-live-key|"authorization"\s*:|Bearer|以下是本次随机选中上帝的完整角色设计提示词/.test(
        onDisk,
      ),
      "saved checkpoint must not contain secrets, headers or full system prompts",
    );
    const count = requests.length;
    await runLiveBatch(
      { ...options, resume: true, maxRequests: 30 },
      dependencies,
    );
    assert.equal(
      requests.length,
      count,
      "a fully complete resume sends no additional requests",
    );
    const checkpointPath = path.join(outputRoot, "bounded-test/report.json");
    const altered = JSON.parse(await readFile(checkpointPath, "utf8"));
    altered.config.playerOutputTokenLimits.peerReviews = 3000;
    await writeFile(checkpointPath, JSON.stringify(altered));
    await assert.rejects(
      runLiveBatch({ ...options, resume: true, maxRequests: 30 }, dependencies),
      /resume_config_changed/,
    );
    assert.equal(
      requests.length,
      count,
      "changed output budget must be rejected before any HTTP",
    );
  },
);

test(
  "structured dry-run preserves policy cycle offsets without loading env, transport or files",
  { timeout: 30000 },
  async () => {
    const lines = [];
    await main(
      [
        "--structured",
        "--concise",
        "--matches",
        "1",
        "--start",
        "2008",
        "--policy-offset",
        "3",
        "--god-output-tokens",
        "8000",
      ],
      {
        loadEnv: () => {
          throw new Error("unexpected environment access");
        },
        fetchImpl: () => {
          throw new Error("unexpected network");
        },
        print: (line) => lines.push(line),
      },
    );
    const report = JSON.parse(lines[0]);
    assert.equal(report.structured, true);
    assert.equal(report.concise, true);
    assert.equal(report.policyOffset, 3);
    assert.equal(report.boardingOutputTokenLimit, 8000);
    assert.equal(report.plannedMaxHttpRequests, 17);
    assert.equal(report.actualHttpRequests, 0);
    assert.equal(report.matches[0].policy, "generous");
    assert.equal(report.matches[0].seed, 2008);
  },
);

test(
  "full structured service keeps both failed attempts, repairs at most twice, resumes safely and freezes protocol/policy",
  { timeout: 120000 },
  async () => {
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "noah-structured-repair-test-"),
    );
    const requests = [];
    const dependencies = {
      outputRoot,
      loadEnv: noop,
      env: { MINIMAX_API_KEY: secret },
      fetchImpl: fakeProvider(requests, {
        repairPeer: true,
        repairGod: true,
        allPeers: true,
        contractEdges: true,
      }),
      print: noop,
    };
    const options = parseLiveArguments([
      "--live",
      "--structured",
      "--concise",
      "--matches",
      "2",
      "--start",
      "2001",
      "--max-requests",
      "17",
      "--run-id",
      "structured-test",
      "--god-output-tokens",
      "8000",
    ]);
    const report = await runLiveBatch(options, dependencies);
    assert.equal(report.status, "paused_budget");
    assert.equal(report.matches[0].status, "passed");
    assert.ok(Object.values(report.matches[0].checks).every(Boolean));
    assert.equal(report.matches[0].reviewEntries, 30);
    assert.equal(report.matches[0].repairRequests, 2);
    assert.equal(
      report.matches[0].httpRequests,
      3 + 2 * report.matches[0].survivors + 2,
    );
    assert.equal(report.summary.failedAttempts, 2);
    assert.equal(report.summary.failedModelStages, 0);
    assert.equal(report.summary.usageReportedRequests, requests.length);
    assert.equal(report.summary.usage.input_tokens, 42 * requests.length);
    assert.equal(report.summary.usage.output_tokens, 37 * requests.length);
    assert.equal(report.config.perStageRequests, 2);
    assert.equal(report.config.maximumRepairsPerMatch, 2);
    assert.equal(report.config.boardingOutputTokenLimit, 8000);
    assert.equal(report.config.concise, true);
    assert.equal(
      report.requestBudget.reservedWorstCasePerMatch,
      "3+2*actualSurvivors+2",
    );
    const failed = report.stages
      .flatMap((stage) => stage.attempts)
      .filter((attempt) => attempt.status === "failed");
    assert.equal(failed[0].failure, "invalid_peer_reviews");
    assert.equal(failed[0].validationDiagnostic.eventSeq, 99999999);
    assert.equal(failed[1].failure, "boarding_capacity");
    assert.equal(requests.filter((request) => request.safeFeedback).length, 2);
    assert.ok(
      requests
        .filter((request) => request.tool === "submit_peer_reviews")
        .every((request) => request.maxOutputTokens === 8000),
    );
    assert.ok(
      requests
        .filter((request) => request.tool === "submit_player_speech")
        .every((request) => request.maxOutputTokens === 3000),
    );
    assert.ok(
      requests
        .filter((request) => request.tool === "submit_boarding_verdict")
        .every((request) => request.maxOutputTokens === 8000),
    );
    assert.ok(
      report.stages
        .filter((stage) => stage.id.includes(":god:"))
        .every((stage) =>
          stage.attempts.every(
            (attempt) => attempt.requestMaxOutputTokens === 8000,
          ),
        ),
    );
    assert.ok(
      report.stages.every(
        (stage) =>
          stage.requests <= 2 &&
          stage.attempts.every((attempt) => attempt.requests === 1),
      ),
    );
    const firstPaid = requests.length;
    assert.ok(
      requests
        .filter((request) => request.tool === "submit_boarding_verdict")
        .every((request) => request.conciseGodGuidance),
    );
    assert.ok(
      requests
        .filter((request) => request.tool !== "submit_boarding_verdict")
        .every((request) => request.concisePlayerGuidance),
    );
    for (const change of [
      { policyOffset: 1 },
      { structured: false, godOutputTokens: 3000, concise: false },
      { godOutputTokens: 3000 },
      { concise: false },
    ])
      await assert.rejects(
        runLiveBatch(
          { ...options, ...change, resume: true, maxRequests: 34 },
          dependencies,
        ),
        /resume_config_changed/,
      );
    assert.equal(requests.length, firstPaid);
    const resumed = await runLiveBatch(
      { ...options, resume: true, maxRequests: 34 },
      dependencies,
    );
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.summary.completedLiveMatches, 2);
    assert.equal(resumed.matches[0].httpRequests, firstPaid);
    assert.equal(resumed.summary.failedAttempts, 2);
    assert.equal(resumed.summary.repairRequests, 2);
    assert.equal(resumed.summary.usageReportedRequests, requests.length);
    assert.equal(resumed.summary.usage.input_tokens, requests.length * 42);
    const checkpoint = await readFile(
      path.join(outputRoot, "structured-test/report.json"),
      "utf8",
    );
    assert.doesNotMatch(
      checkpoint,
      /not-a-live-key|\"authorization\"\s*:|Bearer|完整角色设计提示词|INPUT_JSON/,
    );
    const count = requests.length;
    await runLiveBatch(
      { ...options, resume: true, maxRequests: 34 },
      dependencies,
    );
    assert.equal(requests.length, count);
  },
);

test(
  "structured full service cannot repair a third stage after two match repairs, and auth never retries",
  { timeout: 120000 },
  async () => {
    for (const auth of [false, true]) {
      const outputRoot = await mkdtemp(
        path.join(os.tmpdir(), "noah-structured-stop-test-"),
      );
      const requests = [];
      const report = await runLiveBatch(
        parseLiveArguments([
          "--live",
          "--structured",
          "--matches",
          "1",
          "--run-id",
          "stop-test",
        ]),
        {
          outputRoot,
          loadEnv: noop,
          env: { MINIMAX_API_KEY: secret },
          fetchImpl: fakeProvider(requests, {
            repairPeer: true,
            repairGod: true,
            brokenSpeech: true,
            failAuth: auth,
          }),
          print: noop,
        },
      );
      assert.equal(report.matches[0].status, "failed");
      assert.equal(report.summary.completedLiveMatches, 0);
      assert.equal(requests.length, auth ? 1 : 5);
      assert.equal(report.matches[0].repairRequests, auth ? 0 : 2);
      assert.equal(report.stages.at(-1).attempts.length, 1);
      assert.equal(report.stages.at(-1).attempts[0].status, "failed");
      assert.ok(
        requests.every(
          (request) =>
            !request.concisePlayerGuidance && !request.conciseGodGuidance,
        ),
        "structured defaults also keep concise guidance disabled",
      );
      if (auth)
        assert.equal(report.breaker, "authentication_or_access_failure");
      else assert.equal(report.stages.at(-1).failure, "invalid_player_speech");
    }
  },
);

test(
  "auth failure stops on the first paid request and never reports fallback success",
  { timeout: 60000 },
  async () => {
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "noah-live-auth-test-"),
    );
    const requests = [];
    const options = parseLiveArguments([
      "--live",
      "--matches",
      "20",
      "--run-id",
      "auth-test",
    ]);
    const report = await runLiveBatch(options, {
      outputRoot,
      loadEnv: noop,
      env: { MINIMAX_API_KEY: secret },
      fetchImpl: fakeProvider(requests, { failAuth: true }),
      print: noop,
    });
    assert.equal(requests.length, 1);
    assert.equal(report.status, "circuit_open");
    assert.equal(report.breaker, "authentication_or_access_failure");
    assert.equal(report.summary.completedLiveMatches, 0);
    assert.equal(report.matches[0].failure, "http_401");
    assert.doesNotMatch(
      await readFile(path.join(outputRoot, "auth-test/report.json"), "utf8"),
      /not-a-live-key/,
    );
  },
);

test(
  "HTTP 429 immediately stops the batch for peer or god stages, saves only numeric retry seconds, and resume stays closed",
  { timeout: 60000 },
  async () => {
    for (const { structured, limitAt, retryAfter, expectedDelay } of [
      { structured: false, limitAt: 1, retryAfter: "60", expectedDelay: 60 },
      { structured: true, limitAt: 2, retryAfter: secret, expectedDelay: null },
      { structured: true, limitAt: 1, retryAfter: "120", expectedDelay: 120 },
    ]) {
      const outputRoot = await mkdtemp(
        path.join(os.tmpdir(), "noah-live-rate-limit-test-"),
      );
      const requests = [];
      const options = parseLiveArguments([
        "--live",
        ...(structured ? ["--structured"] : []),
        "--matches",
        "4",
        "--run-id",
        "rate-limit-test",
      ]);
      const dependencies = {
        outputRoot,
        loadEnv: noop,
        env: { MINIMAX_API_KEY: secret },
        fetchImpl: fakeProvider(requests, {
          rateLimitAt: limitAt,
          retryAfter,
        }),
        print: noop,
      };
      const report = await runLiveBatch(options, dependencies);
      assert.equal(report.status, "circuit_open");
      assert.equal(report.breaker, "rate_limited");
      assert.equal(
        report.matches.length,
        1,
        "429 must not charge the next planned match",
      );
      assert.equal(
        report.consecutiveFailures,
        1,
        "do not wait for three failed matches",
      );
      assert.equal(report.matches[0].status, "failed");
      assert.equal(report.matches[0].failure, "http_429");
      assert.equal(report.summary.completedLiveMatches, 0);
      assert.equal(report.requestBudget.actual, limitAt);
      assert.equal(requests.length, limitAt);
      assert.equal(report.summary.repairRequests, 0);
      assert.equal(report.rateLimit.httpStatus, 429);
      assert.equal(report.rateLimit.retryAfterSeconds, expectedDelay);
      const stage = report.stages.at(-1);
      assert.equal(stage.httpStatus, 429);
      assert.equal(stage.retryAfterSeconds, expectedDelay ?? undefined);
      if (structured) {
        assert.equal(stage.attempts.length, 1);
        assert.equal(
          stage.attempts[0].retryAfterSeconds,
          expectedDelay ?? undefined,
        );
      }
      const checkpoint = await readFile(
        path.join(outputRoot, "rate-limit-test/report.json"),
        "utf8",
      );
      assert.doesNotMatch(
        checkpoint,
        /not-a-live-key|x-private-test|retry-after|\"headers\"|\"authorization\"/,
      );
      const resumed = await runLiveBatch(
        { ...options, resume: true },
        dependencies,
      );
      assert.equal(resumed.breaker, "rate_limited");
      assert.equal(
        requests.length,
        limitAt,
        "resume cannot silently retry a rate-limited batch",
      );
    }
  },
);

test(
  "full six-player service accepts five reviews each through final council without trimming",
  { timeout: 60000 },
  async () => {
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "noah-live-five-peers-test-"),
    );
    const requests = [];
    const options = parseLiveArguments([
      "--live",
      "--matches",
      "1",
      "--start",
      "2001",
      "--run-id",
      "all-five-peers",
    ]);
    const report = await runLiveBatch(options, {
      outputRoot,
      loadEnv: noop,
      env: { MINIMAX_API_KEY: secret },
      fetchImpl: fakeProvider(requests, {
        allPeers: true,
        contractEdges: true,
      }),
      print: noop,
    });
    assert.equal(report.status, "complete");
    assert.equal(report.summary.completedLiveMatches, 1);
    assert.equal(report.matches[0].reviewEntries, 30);
    assert.ok(
      report.matches[0].peerReviews[0].entries.every(
        (entry) => entry.rating === null,
      ),
    );
    assert.ok(
      report.matches[0].peerReviews[1].entries.every(
        (entry) => entry.comment === "",
      ),
    );
    const speechStages = report.stages.filter((stage) =>
      stage.id.includes("player:speech"),
    );
    assert.equal(speechStages.length, 6);
    assert.ok(
      speechStages.every(
        (stage) =>
          stage.value.evidence.length === 7 && stage.value.text.length > 1800,
      ),
    );
    for (const dialogue of report.matches[0].dialogue) {
      const stage = speechStages.find(
        (stage) => stage.value.playerId === dialogue.playerId,
      );
      assert.equal(dialogue.text, formatSpeechForService(stage.value));
      assert.ok(dialogue.text.length <= 4000);
    }
    assert.ok(
      report.matches[0].peerReviews.every(
        (review) => review.entries.length === 5,
      ),
    );
    assert.equal(
      report.stages[0].value.reviews.reduce(
        (n, review) => n + review.entries.length,
        0,
      ),
      30,
    );
    assert.ok(Object.values(report.matches[0].checks).every(Boolean));
    assert.equal(report.requestBudget.actual, 15);
    assert.deepEqual(report.config.playerOutputTokenLimits, {
      peerReviews: 8000,
      speech: 3000,
    });
    assert.equal(requests[0].maxOutputTokens, 8000);
    assert.ok(
      requests.slice(1).every((request) => request.maxOutputTokens === 3000),
    );
    assert.equal(report.stages[0].requestMaxOutputTokens, 8000);
    assert.ok(
      report.stages
        .filter((stage) => stage.id.includes("player:speech"))
        .every((stage) => stage.requestMaxOutputTokens === 3000),
    );
    assert.ok(
      report.stages.every(
        (stage) =>
          stage.stopReason === "end_turn" && stage.outputTruncated === false,
      ),
    );
  },
);

test(
  "three malformed non-auth matches trip breaker, one request each, zero success",
  { timeout: 120000 },
  async () => {
    const outputRoot = await mkdtemp(
      path.join(os.tmpdir(), "noah-live-breaker-test-"),
    );
    const requests = [];
    const options = parseLiveArguments([
      "--live",
      "--matches",
      "20",
      "--run-id",
      "breaker-test",
    ]);
    const report = await runLiveBatch(options, {
      outputRoot,
      loadEnv: noop,
      env: { MINIMAX_API_KEY: secret },
      fetchImpl: fakeProvider(requests, { malformed: true }),
      print: noop,
    });
    assert.equal(requests.length, 3);
    assert.equal(report.status, "circuit_open");
    assert.equal(report.breaker, "three_consecutive_failed_matches");
    assert.equal(report.summary.completedLiveMatches, 0);
    assert.equal(report.summary.failedMatches, 3);
    assert.equal(report.summary.ratesForSuccessfulMatchesOnly, null);
  },
);
