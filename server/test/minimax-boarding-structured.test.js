import assert from "node:assert/strict";
import test from "node:test";

import { createMiniMaxVerdictModel } from "../src/llm/minimax.js";
import {
  BOARDING_TOOL_NAME,
  boardingToolDefinition,
  parseBoardingToolResponse,
  safeBoardingFormatFeedback,
} from "../src/llm/boarding-tool.js";
import { validateBoarding } from "../src/expedition/judgment.js";
import { validateLearning } from "../src/academic/learning.js";

const apiKey = "sk-test-key-must-never-appear-in-errors";
const godPrompt = "完整人设第一行\n完整人设第二行：保留价值观与细则。\nEND_GOD";
const rolePrompt =
  "完整职责第一行\n完整职责第二行：登船资格及容量不可改。\nEND_ROLE";
const input = {
  god: { id: "balanced", prompt: godPrompt },
  rolePrompt,
  stage: "initial",
  context: {
    players: [
      { id: "P1", eligible: true, fullHistorySentinel: "PLAYER_COMPLETE" },
      { id: "P2", eligible: false },
    ],
    policy: { seats: 1 },
    globalEvents: [
      { seq: 1, type: "donate", actor: "P1", detail: "FULL_EVENT_ONE" },
      { seq: 2, type: "gather", actor: "P2", detail: "FULL_EVENT_TWO" },
      { seq: 3, type: "peer_review", actor: "P1" },
    ],
  },
  evidence: [
    { id: "eco-a", domain: "economy", text: "ECONOMY_COMPLETE" },
    { id: "env-b", domain: "environment", text: "ENVIRONMENT_COMPLETE" },
    { id: "soc-c", domain: "society", text: "SOCIETY_COMPLETE" },
  ],
  conversations: [{ playerId: "P1", text: "完整发言：我捐献了木头。" }],
  previous: null,
  rebuttal: "完整当前反驳内容",
  academic: true,
};

function verdict() {
  return {
    statement: "以行为、共同生存和文献为依据的初步审议。",
    decisions: [
      { playerId: "P1", board: true, reason: "捐献公共物资。", evidence: [1] },
      {
        playerId: "P2",
        board: false,
        reason: "不满足生存资格。",
        evidence: [2],
      },
    ],
    learning: input.evidence.map((source) => ({
      sourceId: source.id,
      application: "以真实事件讨论观点，并说明游戏不能覆盖现实复杂性。",
      eventSeqs: [1],
    })),
  };
}

function payload(value = verdict(), overrides = {}) {
  return {
    stop_reason: "tool_use",
    content: [
      { type: "thinking", thinking: "PRIVATE_REASONING_MUST_NOT_RETURN" },
      {
        type: "tool_use",
        id: "call_1",
        name: BOARDING_TOOL_NAME,
        input: value,
      },
    ],
    ...overrides,
  };
}

function mockModel(responsePayload, options = {}) {
  const requests = [];
  return {
    requests,
    model: createMiniMaxVerdictModel({
      apiKey,
      structuredBoarding: true,
      fetchImpl: async (url, init) => {
        requests.push({ url, ...init, body: JSON.parse(init.body) });
        return { ok: true, json: async () => structuredClone(responsePayload) };
      },
      ...options,
    }),
  };
}

test("boarding tool schema binds all player, event and current RAG source IDs", () => {
  const tool = boardingToolDefinition(input);
  assert.equal(tool.name, BOARDING_TOOL_NAME);
  const schema = tool.input_schema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["statement", "decisions", "learning"]);
  assert.equal(schema.properties.decisions.minItems, 2);
  assert.equal(schema.properties.decisions.maxItems, 2);
  assert.deepEqual(schema.properties.decisions.items.properties.playerId.enum, [
    "P1",
    "P2",
  ]);
  assert.deepEqual(
    schema.properties.decisions.items.properties.evidence.items.enum,
    [1, 2, 3],
  );
  assert.equal(
    schema.properties.decisions.items.properties.board.type,
    "boolean",
  );
  assert.deepEqual(schema.properties.learning.items.properties.sourceId.enum, [
    "eco-a",
    "env-b",
    "soc-c",
  ]);
  assert.equal(schema.properties.learning.minItems, 3);
  assert.equal(
    boardingToolDefinition({ ...input, stage: "discussion" }).input_schema
      .properties.learning.minItems,
    2,
  );
  assert.equal(
    boardingToolDefinition({ ...input, stage: "final" }).input_schema.properties
      .learning.minItems,
    3,
  );
  const noAcademic = boardingToolDefinition({
    ...input,
    academic: false,
  }).input_schema;
  assert.deepEqual(noAcademic.required, ["statement", "decisions"]);
  assert.equal(noAcademic.properties.learning, undefined);
});

test("boarding tool parser accepts only one named tool object and excludes reasoning", () => {
  assert.deepEqual(parseBoardingToolResponse(payload()), verdict());
  assert.deepEqual(
    parseBoardingToolResponse(payload(verdict(), { stop_reason: "end_turn" })),
    verdict(),
  );
  assert.doesNotMatch(
    JSON.stringify(parseBoardingToolResponse(payload())),
    /PRIVATE_REASONING/,
  );
  for (const invalid of [
    null,
    {},
    payload(verdict(), { stop_reason: "pause_turn" }),
    payload(verdict(), { content: [] }),
    payload(verdict(), {
      content: [{ type: "text", text: JSON.stringify(verdict()) }],
    }),
    payload(verdict(), {
      content: [
        {
          type: "tool_use",
          name: "execute_command",
          input: { command: "ignored" },
        },
      ],
    }),
    payload(verdict(), {
      content: [payload().content[1], payload().content[1]],
    }),
    payload(verdict(), {
      content: [
        payload().content[1],
        { type: "tool_use", name: "unknown", input: {} },
      ],
    }),
    payload(null),
    payload([]),
    payload(JSON.stringify(verdict())),
  ])
    assert.throws(
      () => parseBoardingToolResponse(invalid),
      /^Error: invalid_tool_output$/,
    );
  assert.throws(
    () =>
      parseBoardingToolResponse(
        payload(verdict(), { stop_reason: "max_tokens" }),
      ),
    /^Error: truncated_response$/,
  );
});

test("format feedback only includes bounded safe codes, paths and reason enums", () => {
  assert.deepEqual(
    safeBoardingFormatFeedback({
      code: "invalid_boarding_evidence",
      path: "decisions[1].evidence",
      reason: "invalid_enum",
      secret: apiKey,
    }),
    {
      code: "invalid_boarding_evidence",
      path: "decisions[1].evidence",
      reason: "invalid_enum",
    },
  );
  assert.deepEqual(
    safeBoardingFormatFeedback({
      code: "missing_academic_domain",
      path: apiKey,
      reason: godPrompt,
    }),
    { code: "missing_academic_domain" },
  );
  assert.equal(safeBoardingFormatFeedback({ code: apiKey }), null);
  assert.equal(safeBoardingFormatFeedback(null), null);
});

test("opt-in structured boarding keeps complete persona, role and context and makes one HTTP call", async () => {
  const { model, requests } = mockModel(payload());
  const result = await model.generateBoarding(input);
  assert.deepEqual(result, verdict());
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, "https://api.minimaxi.com/anthropic/v1/messages");
  assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
  assert.equal(request.body.model, "MiniMax-M3");
  assert.equal(request.body.max_tokens, 3000);
  assert.ok(request.body.system.includes(`${godPrompt}\n\n${rolePrompt}`));
  const { god, rolePrompt: ignored, ...dynamicContext } = input;
  assert.ok(
    request.body.messages[0].content[0].text.includes(
      JSON.stringify(dynamicContext),
    ),
  );
  assert.deepEqual(request.body.tool_choice, {
    type: "tool",
    name: BOARDING_TOOL_NAME,
  });
  assert.equal(request.body.tools.length, 1);
  assert.deepEqual(request.body.tools[0], boardingToolDefinition(input));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING|sk-test/);
});

test("structured adapter never retries invalid tool output or truncation", async () => {
  for (const [response, code] of [
    [payload(verdict(), { content: [] }), "invalid_tool_output"],
    [payload(verdict(), { stop_reason: "max_tokens" }), "truncated_response"],
  ]) {
    const { model, requests } = mockModel(response);
    await assert.rejects(
      model.generateBoarding(input),
      (error) => error.message === code && Object.keys(error).length === 0,
    );
    assert.equal(requests.length, 1);
  }
});

test("concise guidance is append-only opt-in with complete context and unchanged schema", async () => {
  for (const stage of ["initial", "discussion", "final"]) {
    const stageInput = { ...input, stage };
    const candidate = verdict();
    candidate.statement = "完整声明".repeat(170);
    candidate.decisions[0].reason = "完整理由".repeat(60);
    candidate.learning[0].application = "完整观点及局限".repeat(50);
    const baseline = mockModel(payload(candidate), {
      boardingOutputTokenLimit: 6000,
    });
    const explicitFalse = mockModel(payload(candidate), {
      boardingOutputTokenLimit: 6000,
      conciseBoarding: false,
    });
    const concise = mockModel(payload(candidate), {
      boardingOutputTokenLimit: 6000,
      conciseBoarding: true,
    });
    await baseline.model.generateBoarding(stageInput);
    await explicitFalse.model.generateBoarding(stageInput);
    const result = await concise.model.generateBoarding(stageInput);
    const originalBody = baseline.requests[0].body;
    const conciseBody = concise.requests[0].body;
    assert.deepEqual(explicitFalse.requests[0].body, originalBody);
    assert.equal(concise.requests.length, 1);
    assert.deepEqual(
      result,
      candidate,
      "guidance must not truncate or rewrite the model candidate",
    );
    assert.equal(conciseBody.system, originalBody.system);
    assert.ok(conciseBody.system.includes(`${godPrompt}\n\n${rolePrompt}`));
    assert.equal(conciseBody.max_tokens, 6000);
    assert.deepEqual(conciseBody.tools, originalBody.tools);
    assert.deepEqual(conciseBody.tool_choice, originalBody.tool_choice);
    const originalPrompt = originalBody.messages[0].content[0].text;
    const concisePrompt = conciseBody.messages[0].content[0].text;
    assert.ok(concisePrompt.startsWith(originalPrompt));
    const { god, rolePrompt: ignored, ...dynamicContext } = stageInput;
    assert.ok(concisePrompt.includes(JSON.stringify(dynamicContext)));
    const appended = concisePrompt.slice(originalPrompt.length);
    for (const text of [
      "简明表达指引（仅优化表述，不改规则、事实或校验）",
      "600字",
      "220字",
      "300字",
      "三领域的3篇",
      "discussion 选2篇",
      "1—3条",
      "不增加评分权重",
      "remainingInjury 是救生后剩余伤势，不是耐受余量",
      "没有被系统分派公共决策机会，不等于拒绝参与",
      "before/after",
      "requested",
      "applied",
      "实际参与双方",
      "名单叙述必须与 decisions 一致",
    ]) {
      assert.ok(appended.includes(text), `missing guidance: ${text}`);
    }
    assert.ok(!originalPrompt.includes("简明表达指引"));
  }
});

test("concise option leaves legacy requests unchanged and does not invent non-academic requirements", async () => {
  const response = {
    content: [{ type: "text", text: JSON.stringify(verdict()) }],
  };
  const legacy = mockModel(response, { structuredBoarding: false });
  const legacyConcise = mockModel(response, {
    structuredBoarding: false,
    conciseBoarding: true,
  });
  await legacy.model.generateBoarding(input);
  await legacyConcise.model.generateBoarding(input);
  assert.deepEqual(legacyConcise.requests[0].body, legacy.requests[0].body);
  const nonAcademic = mockModel(payload(), { conciseBoarding: true });
  await nonAcademic.model.generateBoarding({ ...input, academic: false });
  const prompt = nonAcademic.requests[0].body.messages[0].content[0].text;
  assert.ok(prompt.includes("简明表达指引"));
  assert.ok(!prompt.includes("三领域的3篇"));
  assert.equal(
    nonAcademic.requests[0].body.tools[0].input_schema.properties.learning,
    undefined,
  );
});

test("structured boarding accepts only bounded integer output budgets without changing the default", async () => {
  for (const boardingOutputTokenLimit of [3000, 6000, 8000]) {
    const { model, requests } = mockModel(payload(), {
      boardingOutputTokenLimit,
    });
    assert.deepEqual(await model.generateBoarding(input), verdict());
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.max_tokens, boardingOutputTokenLimit);
    assert.ok(
      requests[0].body.system.includes(`${godPrompt}\n\n${rolePrompt}`),
    );
    const { god, rolePrompt: ignored, ...dynamicContext } = input;
    assert.ok(
      requests[0].body.messages[0].content[0].text.includes(
        JSON.stringify(dynamicContext),
      ),
    );
    assert.deepEqual(requests[0].body.tools[0], boardingToolDefinition(input));
  }
  for (const boardingOutputTokenLimit of [
    NaN,
    Infinity,
    -Infinity,
    0,
    2999,
    8001,
    6000.5,
    "6000",
    null,
    apiKey,
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        createMiniMaxVerdictModel({
          apiKey,
          structuredBoarding: true,
          boardingOutputTokenLimit,
          fetchImpl: async () => {
            calls++;
            throw new Error("must_not_send");
          },
        }),
      /^Error: invalid_boarding_output_token_limit$/,
    );
    assert.equal(calls, 0);
  }
});

test("a larger structured boarding budget does not alter legacy boarding or laboratory budgets", async () => {
  const legacy = mockModel(
    { content: [{ type: "text", text: JSON.stringify(verdict()) }] },
    { structuredBoarding: false, boardingOutputTokenLimit: 6000 },
  );
  await legacy.model.generateBoarding(input);
  assert.equal(legacy.requests[0].body.max_tokens, 3000);
  assert.equal(legacy.requests[0].body.tools, undefined);
  const lab = mockModel(
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            completed: true,
            reason: "依据报告提出建议。",
          }),
        },
      ],
    },
    { boardingOutputTokenLimit: 8000 },
  );
  await lab.model.generateAssessment({
    god: input.god,
    task: "任务",
    report: "完成报告",
  });
  assert.equal(lab.requests[0].body.max_tokens, 1200);
  assert.equal(lab.requests[0].body.tools, undefined);
});

test("structured adapter appends sanitized feedback without changing full dynamic context", async () => {
  const { model, requests } = mockModel(payload());
  await model.generateBoarding({
    ...input,
    formatFeedback: {
      code: "missing_academic_domain",
      path: apiKey,
      reason: apiKey,
      raw: godPrompt,
    },
  });
  const prompt = requests[0].body.messages[0].content[0].text;
  const { god, rolePrompt: ignored, ...dynamicContext } = input;
  assert.ok(prompt.includes(JSON.stringify(dynamicContext)));
  assert.ok(prompt.includes('"code":"missing_academic_domain"'));
  assert.ok(requests[0].body.system.includes(`${godPrompt}\n\n${rolePrompt}`));
  assert.ok(!prompt.includes(apiKey));
  assert.ok(!prompt.includes(godPrompt));
});

test("structured adapter errors do not expose response, credential or full prompts", async () => {
  const { model } = mockModel(null, {
    fetchImpl: async () => {
      throw new Error(`${apiKey} ${godPrompt} ${rolePrompt}`);
    },
  });
  await assert.rejects(
    model.generateBoarding(input),
    (error) =>
      error.message === "request_failed" && Object.keys(error).length === 0,
  );
  const reflected = mockModel(null, {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          message: `${apiKey} ${godPrompt} ${rolePrompt}`,
          code: "auth_failed",
          type: "authentication_error",
        },
      }),
    }),
  });
  await assert.rejects(reflected.model.generateBoarding(input), (error) => {
    const saved = JSON.stringify({ message: error.message, ...error });
    return (
      error.message === "http_401" &&
      !saved.includes(apiKey) &&
      !saved.includes("END_GOD") &&
      !saved.includes("END_ROLE")
    );
  });
});

test("structured output still requires unchanged production survival, capacity, uniqueness and academic validation", async () => {
  const { model } = mockModel(payload());
  const value = await model.generateBoarding(input);
  assert.deepEqual(
    validateBoarding(value, input.context, input.evidence),
    value,
  );
  validateLearning(value.learning, input.evidence, input.context, {
    required: true,
    stage: "initial",
  });
  const ineligible = verdict();
  ineligible.decisions[1].board = true;
  assert.throws(
    () => validateBoarding(ineligible, input.context, input.evidence),
    /ineligible_boarding/,
  );
  assert.throws(
    () =>
      validateBoarding(
        value,
        { ...input.context, policy: { seats: 0 } },
        input.evidence,
      ),
    /boarding_capacity/,
  );
  const duplicate = verdict();
  duplicate.decisions[1].playerId = "P1";
  assert.throws(
    () => validateBoarding(duplicate, input.context, input.evidence),
    /invalid_boarding_evidence/,
  );
  const missingDomainSources = input.evidence.map((source) => ({
    ...source,
    domain: "economy",
  }));
  assert.throws(
    () =>
      validateLearning(value.learning, missingDomainSources, input.context, {
        required: true,
        stage: "initial",
      }),
    /missing_academic_domain/,
  );
});

test("structured boarding opt-in does not change the default JSON protocol", async () => {
  const { model, requests } = mockModel(
    { content: [{ type: "text", text: JSON.stringify(verdict()) }] },
    { structuredBoarding: false },
  );
  assert.deepEqual(await model.generateBoarding(input), verdict());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(requests[0].body.tool_choice, undefined);
});

test("enabling structured boarding leaves the laboratory JSON methods unchanged", async () => {
  const labValue = {
    classification: "平衡发展型",
    tone: "reward",
    title: "协作鼓励",
    statement: "依据实验台状态作出判断。",
    measures: ["合作效率 +1"],
  };
  const { model, requests } = mockModel({
    content: [{ type: "text", text: JSON.stringify(labValue) }],
  });
  const result = await model.generateInitial({
    god: input.god,
    state: { attributes: { economy: 10, environment: 10, society: 10 } },
    evidence: [],
    ruleDraft: labValue,
  });
  assert.deepEqual(result, labValue);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(requests[0].body.tool_choice, undefined);
});
