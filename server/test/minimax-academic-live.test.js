import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalMiniMaxModel,
  createMiniMaxVerdictModel,
  safeMiniMaxValidationFailure,
  sanitizeMiniMaxProviderError,
} from "../src/llm/minimax.js";
import { validateBoarding } from "../src/expedition/judgment.js";
import { validateLearning } from "../src/academic/learning.js";

// Entirely mocked transport: these tests never load .env or send a live request.
const god = {
  id: "balanced",
  prompt: "FULL_PRIVATE_GOD_PROMPT_FOR_REDACTION_TEST",
};
const context = {
  god,
  rolePrompt: "PRIVATE_ACADEMIC_SYSTEM_RULES_FOR_REDACTION_TEST",
  stage: "initial",
  academic: true,
  context: { players: [], globalEvents: [], policy: { seats: 0 } },
  evidence: [{ id: "sen-1998", domain: "society", content: "测试中文材料" }],
  conversations: [],
};

test("legacy M3.0 label maps only to the same official M3 model", async () => {
  assert.equal(canonicalMiniMaxModel("MiniMax-M3.0"), "MiniMax-M3");
  assert.equal(canonicalMiniMaxModel("MiniMax-M3"), "MiniMax-M3");
  assert.equal(
    canonicalMiniMaxModel("MiniMax-M3.1-Flash"),
    "MiniMax-M3.1-Flash",
  );
  assert.equal(canonicalMiniMaxModel("future-model"), "future-model");
  let request;
  const model = createMiniMaxVerdictModel({
    apiKey: "test-key",
    model: "MiniMax-M3.0",
    baseUrl: "https://api.minimaxi.com/anthropic",
    fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        json: async () => ({
          content: [
            {
              type: "text",
              text: '{"statement":"test","decisions":[],"learning":[]}',
            },
          ],
        }),
      };
    },
  });
  await model.generateBoarding(context);
  assert.equal(model.model, "MiniMax-M3");
  assert.equal(request.body.model, "MiniMax-M3");
  assert.equal(request.url, "https://api.minimaxi.com/anthropic/v1/messages");
  assert.match(request.body.system, /FULL_PRIVATE_GOD_PROMPT/);
  assert.equal(request.body.max_tokens, 3000);
});

test("provider diagnostic keeps only bounded code/type/message, never secrets or prompts", async () => {
  const secret = "secret-must-not-be-in-diagnostic";
  let requestCount = 0;
  const model = createMiniMaxVerdictModel({
    apiKey: secret,
    fetchImpl: async (_url, init) => {
      requestCount++;
      const body = JSON.parse(init.body);
      return {
        ok: false,
        status: 400,
        json: async () => ({
          type: "error",
          error: {
            code: 2013,
            type: "invalid_request_error",
            message: `invalid params ${secret} ${body.system} ${body.messages[0].content[0].text} ${"x".repeat(1000)}`,
            raw_request: init,
          },
          request: init,
          authorization: secret,
        }),
      };
    },
  });
  await assert.rejects(model.generateBoarding(context), (error) => {
    assert.equal(error.message, "http_400");
    assert.deepEqual(Object.keys(error.providerError).sort(), [
      "code",
      "message",
      "type",
    ]);
    assert.equal(error.providerError.code, 2013);
    assert.equal(error.providerError.type, "invalid_request_error");
    assert.ok(error.providerError.message.length <= 500);
    const serialized = JSON.stringify(error.providerError);
    assert.doesNotMatch(
      serialized,
      /secret-must-not|FULL_PRIVATE_GOD|PRIVATE_ACADEMIC|测试中文材料|authorization|raw_request/,
    );
    return true;
  });
  assert.equal(requestCount, 1, "HTTP 400 must not retry or change models");
});

test("malformed provider body and arbitrary transport errors remain safely bounded", async () => {
  const model = createMiniMaxVerdictModel({
    apiKey: "secret-must-not-leak",
    fetchImpl: async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("raw HTML containing secret-must-not-leak");
      },
    }),
  });
  await assert.rejects(model.generateBoarding(context), (error) => {
    assert.equal(error.message, "http_502");
    assert.equal(error.providerError, null);
    return true;
  });
  const transportFailure = createMiniMaxVerdictModel({
    apiKey: "secret-must-not-leak",
    fetchImpl: async () => {
      throw new Error("secret-must-not-leak and request prompt");
    },
  });
  await assert.rejects(
    transportFailure.generateBoarding(context),
    /^Error: request_failed$/,
  );
});

test("sanitizer rejects nested diagnostic values and supports MiniMax base_resp", () => {
  assert.deepEqual(
    sanitizeMiniMaxProviderError({
      base_resp: { status_code: 1004, status_msg: "authentication failed" },
      token: "secret",
    }),
    { code: 1004, message: "authentication failed" },
  );
  assert.equal(
    sanitizeMiniMaxProviderError({
      error: {
        code: { token: "secret" },
        type: [],
        message: { prompt: "secret" },
      },
    }),
    null,
  );
  assert.equal(sanitizeMiniMaxProviderError(null), null);
});

test("legacy invalid model diagnostic is observable without leaking the request", async () => {
  const model = createMiniMaxVerdictModel({
    apiKey: "mock-key",
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "invalid params, unknown model 'MiniMax-M3.0' (2013)",
        },
      }),
    }),
  });
  await assert.rejects(model.generateBoarding(context), (error) => {
    assert.equal(
      error.providerError.message,
      "invalid params, unknown model 'MiniMax-M3.0' (2013)",
    );
    assert.equal(error.providerError.type, "invalid_request_error");
    return true;
  });
});

test("academic boarding output example explicitly includes learning and stage coverage; legacy mode stays compatible", async () => {
  const requests = [];
  const model = createMiniMaxVerdictModel({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({
          content: [
            {
              type: "text",
              text: '{"statement":"test","decisions":[],"learning":[]}',
            },
          ],
        }),
      };
    },
  });
  for (const stage of ["initial", "discussion", "final"])
    await model.generateBoarding({ ...context, stage });
  await model.generateBoarding({ ...context, academic: false });
  for (const request of requests.slice(0, 3)) {
    const prompt = request.messages[0].content[0].text;
    assert.match(prompt, /结构示例：.*"learning":\[\{"sourceId":/s);
    assert.match(prompt, /"application":.*"eventSeqs":\[1\]/s);
    assert.match(prompt, /initial 与 final 至少3篇不同文献/);
    assert.match(prompt, /economy、environment、society/);
    assert.match(prompt, /discussion 至少2篇不同文献/);
    assert.match(prompt, /不得省略 learning/);
    assert.match(request.system, /FULL_PRIVATE_GOD_PROMPT_FOR_REDACTION_TEST/);
  }
  assert.doesNotMatch(
    requests[3].messages[0].content[0].text,
    /"learning":|learning 是必填数组/,
  );
});

test("HTTP 200 missing learning can be diagnosed safely without preserving an invalid candidate", async () => {
  const fixture = {
    players: [{ id: "P1", eligible: true }],
    policy: { seats: 1 },
    globalEvents: [{ seq: 1 }],
  };
  const value = {
    statement: "测试裁决",
    decisions: [{ playerId: "P1", board: true, reason: "测试", evidence: [1] }],
  };
  const model = createMiniMaxVerdictModel({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify(value) }],
      }),
    }),
  });
  const candidate = await model.generateBoarding({
    ...context,
    context: fixture,
  });
  let diagnostic = null;
  try {
    const validated = validateBoarding(candidate, fixture, context.evidence);
    validateLearning(validated.learning, context.evidence, fixture, {
      required: true,
      stage: "initial",
    });
  } catch (error) {
    diagnostic = safeMiniMaxValidationFailure(error);
  }
  assert.equal(diagnostic, "invalid_academic_citations");
  assert.equal(
    safeMiniMaxValidationFailure(new Error("ungrounded_academic_citation")),
    "ungrounded_academic_citation",
  );
  assert.equal(
    safeMiniMaxValidationFailure(new Error("missing_academic_domain")),
    "missing_academic_domain",
  );
  assert.equal(
    safeMiniMaxValidationFailure(
      new Error("secret-key and full private candidate"),
    ),
    "unknown_validation_failure",
  );
  assert.equal(
    safeMiniMaxValidationFailure(null),
    "unknown_validation_failure",
  );
});
