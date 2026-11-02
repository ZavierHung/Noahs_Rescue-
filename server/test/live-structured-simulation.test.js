import assert from "node:assert/strict";
import test from "node:test";
import {
  PEER_TOOL_NAME,
  SPEECH_TOOL_NAME,
  peerReviewTool,
  playerSpeechTool,
  forcedPlayerTool,
  parsePlayerTool,
  canRepairFormat,
  safeFormatFeedback,
  safeAttemptMetadata,
  runFormatRepair,
  reserveMatchRepair,
  maximumMatchRequests,
} from "../../scripts/lib/structured-simulation.mjs";
import {
  createStageRunner,
  validatePeerBatch,
} from "../../scripts/lib/live-simulation.mjs";

// These tests are pure helpers/mocks. No .env, HTTP, application saves, or paid
// model calls. Main runner integration is intentionally a separate step.
const players = Array.from({ length: 6 }, (_, index) => ({
  id: `P${index + 1}`,
}));
const peerInput = {
  notebook: { players, visibleEventSeqs: [11, 22, 33, 44, 55, 66] },
};
const speechInput = {
  playerId: "P2",
  allowedEventSeqs: [11, 22, 33, 44, 55, 66, 77],
  ownEventSeqs: [22, 44],
};
const secret = "TEST_PRIVATE_TEXT_MUST_NOT_BE_PERSISTED";

test("structured player schemas dynamically constrain real IDs, visible events and production counts", () => {
  const peer = peerReviewTool(peerInput);
  assert.equal(peer.name, PEER_TOOL_NAME);
  const rows = peer.input_schema.properties.reviews;
  assert.equal(rows.minItems, 6);
  assert.equal(rows.maxItems, 6);
  assert.deepEqual(
    rows.items.properties.reviewerId.enum,
    players.map((player) => player.id),
  );
  const entries = rows.items.properties.entries;
  assert.equal(entries.minItems, 1);
  assert.equal(entries.maxItems, 5);
  assert.equal(entries.items.properties.evidence.maxItems, 3);
  assert.deepEqual(
    entries.items.properties.evidence.items.enum,
    peerInput.notebook.visibleEventSeqs,
  );
  assert.equal(entries.items.additionalProperties, false);
  const speech = playerSpeechTool(speechInput);
  assert.equal(speech.name, SPEECH_TOOL_NAME);
  assert.deepEqual(speech.input_schema.properties.playerId.enum, ["P2"]);
  assert.equal(
    speech.input_schema.properties.evidence.maxItems,
    7,
    "no arbitrary five-reference cap",
  );
  assert.deepEqual(
    speech.input_schema.properties.evidence.contains.enum,
    [22, 44],
  );
  assert.equal(speech.input_schema.properties.text.maxLength, 4000);
  assert.deepEqual(forcedPlayerTool(peer), {
    tools: [peer],
    tool_choice: { type: "tool", name: PEER_TOOL_NAME },
  });
});

test("tool parser accepts exactly one matching object and never rewrites references", () => {
  const candidate = {
    playerId: "P2",
    text: "待核实观点",
    evidence: [44, 22, 11],
  };
  const payload = {
    stop_reason: "tool_use",
    content: [
      { type: "thinking", thinking: secret },
      { type: "tool_use", name: SPEECH_TOOL_NAME, input: candidate },
    ],
  };
  assert.deepEqual(parsePlayerTool(payload, SPEECH_TOOL_NAME), candidate);
  for (const content of [
    [],
    [{ type: "text", text: JSON.stringify(candidate) }],
    [{ type: "tool_use", name: "wrong_tool", input: candidate }],
    [
      {
        type: "tool_use",
        name: SPEECH_TOOL_NAME,
        input: JSON.stringify(candidate),
      },
    ],
    [{ type: "tool_use", name: SPEECH_TOOL_NAME, input: [] }],
    [payload.content[1], payload.content[1]],
  ])
    assert.throws(
      () => parsePlayerTool({ content }, SPEECH_TOOL_NAME),
      /invalid_tool_output/,
    );
  assert.throws(
    () =>
      parsePlayerTool(
        { ...payload, stop_reason: "max_tokens" },
        SPEECH_TOOL_NAME,
      ),
    /response_truncated/,
  );
  for (const stop_reason of [
    undefined,
    "stop_sequence",
    secret,
    { raw: secret },
  ])
    assert.throws(
      () => parsePlayerTool({ ...payload, stop_reason }, SPEECH_TOOL_NAME),
      /invalid_tool_output/,
    );
});

test("format feedback is enumerated and never includes raw errors or candidates", () => {
  const error = new Error("invalid_peer_reviews");
  error.validationDiagnostic = {
    path: "reviews[0].entries[0].evidence[0]",
    reason: "unknown_behavior_event",
    eventSeq: 99,
    raw: secret,
  };
  assert.deepEqual(safeFormatFeedback(error), {
    code: "invalid_peer_reviews",
    reason: "invalid_enum",
    path: "reviews[0].entries[0].evidence[0]",
  });
  assert.equal(safeFormatFeedback(new Error(secret)), null);
  assert.ok(
    !JSON.stringify(
      safeAttemptMetadata({
        body: secret,
        usage: { input_tokens: 4, raw: secret },
        stopReason: secret,
      }),
    ).includes(secret),
  );
  assert.deepEqual(
    safeAttemptMetadata({
      body: secret,
      usage: { input_tokens: 4, raw: secret },
      stopReason: secret,
    }),
    {
      usage: { input_tokens: 4 },
      stopReason: "other",
      outputTruncated: false,
    },
  );
});

test("one bounded repair records failed attempt and later success separately", async () => {
  const state = {},
    attempts = [],
    contexts = [];
  let calls = 0;
  const context = {
    players,
    globalEvents: players.map((player, index) => ({
      seq: peerInput.notebook.visibleEventSeqs[index],
      actor: player.id,
      type: "donation",
    })),
  };
  const valid = {
    reviews: players.map((player, index) => ({
      reviewerId: player.id,
      entries: [
        {
          targetId: players[(index + 1) % 6].id,
          rating: 3,
          comment: "这是待核实意见",
          evidence: [peerInput.notebook.visibleEventSeqs[(index + 1) % 6]],
        },
      ],
    })),
  };
  const result = await runFormatRepair({
    invoke: async (input) => {
      calls++;
      contexts.push(input);
      if (calls === 1) {
        const bad = structuredClone(valid);
        bad.reviews[0].entries[0].evidence = [11, 22, 33, 44];
        return bad;
      }
      return valid;
    },
    validate: (value) =>
      validatePeerBatch(value, context, peerInput.notebook.visibleEventSeqs),
    reserveRepair: async () => reserveMatchRepair(state),
    onAttempt: async (record) => attempts.push(record),
    attemptMetadata: () => ({
      requests: 1,
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
  });
  assert.deepEqual(result, valid);
  assert.equal(calls, 2);
  assert.equal(state.repairRequests, 1);
  assert.deepEqual(
    attempts.map(({ status, failure }) => ({ status, failure })),
    [
      { status: "failed", failure: "invalid_peer_reviews" },
      { status: "passed", failure: undefined },
    ],
  );
  assert.equal(attempts[0].validationDiagnostic.reason, "wrong_count");
  assert.equal(contexts[0].formatFeedback, null);
  assert.deepEqual(contexts[1].formatFeedback, {
    code: "invalid_peer_reviews",
    reason: "invalid_shape",
    path: "reviews[0].entries[0].evidence",
  });
  assert.ok(attempts.every((attempt) => attempt.usage.input_tokens === 10));
  assert.ok(!JSON.stringify(attempts).includes("candidate"));
});

test("all stages share only two repairs per match and no stage gets a third attempt", async () => {
  const state = {};
  let calls = 0;
  for (let stage = 0; stage < 3; stage++) {
    let attemptCalls = 0;
    const task = runFormatRepair({
      invoke: async () => {
        calls++;
        if (++attemptCalls === 1) throw new Error("invalid_json");
        return { ok: true };
      },
      validate: (value) => value,
      reserveRepair: async () => reserveMatchRepair(state),
    });
    if (stage < 2) assert.deepEqual(await task, { ok: true });
    else await assert.rejects(task, /invalid_json/);
  }
  assert.equal(calls, 5);
  assert.equal(state.repairRequests, 2);
  let brokenCalls = 0;
  await assert.rejects(
    runFormatRepair({
      invoke: async () => {
        brokenCalls++;
        throw new Error("invalid_tool_output");
      },
      validate: (value) => value,
      reserveRepair: async () => true,
    }),
    /invalid_tool_output/,
  );
  assert.equal(brokenCalls, 2);
});

test("authentication, HTTP, timeout, truncation and absolute budget failures never pay for a repair", async () => {
  for (const code of [
    "http_401",
    "http_403",
    "http_429",
    "http_500",
    "timeout",
    "not_configured",
    "response_truncated",
    "truncated_response",
    "request_budget_exhausted",
    secret,
  ]) {
    let calls = 0,
      reservations = 0;
    const attempts = [];
    assert.equal(canRepairFormat(new Error(code)), false);
    await assert.rejects(
      runFormatRepair({
        invoke: async () => {
          calls++;
          throw new Error(code);
        },
        validate: (value) => value,
        reserveRepair: async () => {
          reservations++;
          return true;
        },
        onAttempt: async (record) => attempts.push(record),
      }),
    );
    assert.equal(calls, 1);
    assert.equal(reservations, 0);
    assert.ok(!JSON.stringify(attempts).includes(secret));
  }
});

test("new match reservation is based on actual surviving players and two possible repairs", () => {
  assert.equal(maximumMatchRequests(6, true), 17);
  assert.equal(maximumMatchRequests(4, true), 13);
  assert.equal(maximumMatchRequests(0, true), 5);
  assert.equal(maximumMatchRequests(6, false), 15);
  assert.throws(() => maximumMatchRequests(7, true), /fixture_invalid/);
});

test("provider auth metadata or truncation prevents repair even when parser reports a format failure", async () => {
  for (const metadata of [
    { httpStatus: 401 },
    { httpStatus: 500 },
    { providerCode: 1004 },
    { providerCode: 2049 },
    { outputTruncated: true },
  ]) {
    let calls = 0,
      reservations = 0;
    await assert.rejects(
      runFormatRepair({
        invoke: async () => {
          calls++;
          throw new Error("invalid_tool_output");
        },
        validate: (value) => value,
        attemptMetadata: () => metadata,
        reserveRepair: async () => {
          reservations++;
          return true;
        },
      }),
      /invalid_tool_output/,
    );
    assert.equal(calls, 1);
    assert.equal(reservations, 0);
  }
});

test("structured transport enforces the absolute HTTP cap and rejects hidden second calls inside an attempt", async () => {
  for (const hiddenSecondCall of [false, true]) {
    const report = {
      stages: [],
      requestBudget: { actual: 0, total: hiddenSecondCall ? 2 : 1 },
    };
    const match = {};
    let transportCalls = 0;
    const endpoint = "https://api.minimaxi.com/anthropic/v1/messages";
    const runner = createStageRunner({
      report,
      endpoint,
      persist: async () => {},
      fetchImpl: async () => {
        transportCalls++;
        return Response.json({
          stop_reason: "tool_use",
          usage: { input_tokens: 4 },
          content: [],
        });
      },
      formatRepair: {
        run: runFormatRepair,
        reserve: async () =>
          report.requestBudget.actual < report.requestBudget.total &&
          reserveMatchRepair(match),
      },
    });
    await assert.rejects(
      runner.run(
        "bounded",
        {},
        async () => {
          await runner.fetch(endpoint, {
            body: JSON.stringify({ max_tokens: 8000 }),
          });
          if (hiddenSecondCall) await runner.fetch(endpoint, { body: "{}" });
          throw new Error("invalid_tool_output");
        },
        (value) => value,
      ),
      hiddenSecondCall ? /request_budget_exhausted/ : /invalid_tool_output/,
    );
    assert.equal(transportCalls, 1);
    assert.equal(report.requestBudget.actual, 1);
    assert.equal(report.stages[0].attempts.length, 1);
    assert.equal(report.stages[0].attempts[0].requests, 1);
    assert.equal(match.repairRequests, undefined);
  }
});
