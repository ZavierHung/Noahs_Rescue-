// Opt-in structured player protocol and bounded repair orchestration. This
// module is deliberately pure: no dotenv, network, files or game mutations.
import {
  safeLiveFailure,
  safeResponseStop,
  safeUsage,
  safeValidationDiagnostic,
} from "./live-simulation.mjs";

export const PEER_TOOL_NAME = "submit_peer_reviews";
export const SPEECH_TOOL_NAME = "submit_player_speech";
export const MAX_FORMAT_ATTEMPTS = 2;
export const MAX_REPAIRS_PER_MATCH = 2;

const integerEnum = (values) => ({
  type: "integer",
  enum: [
    ...new Set(
      values.filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ],
});
const idEnum = (players) => ({
  type: "string",
  enum: players.map((player) => player.id),
});

export function peerReviewTool(input) {
  const players = input.notebook.players;
  const eventIds = input.notebook.visibleEventSeqs;
  return {
    name: PEER_TOOL_NAME,
    description:
      "提交每名模拟玩家的同伴观察；不是人气投票。只能引用展示的真实行为，至少一条须涉及被评玩家，不得自评或重复评价。",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["reviews"],
      properties: {
        reviews: {
          type: "array",
          minItems: players.length,
          maxItems: players.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["reviewerId", "entries"],
            properties: {
              reviewerId: idEnum(players),
              entries: {
                type: "array",
                minItems: 1,
                maxItems: players.length - 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["targetId", "evidence"],
                  properties: {
                    targetId: idEnum(players),
                    rating: {
                      anyOf: [
                        { type: "integer", minimum: 1, maximum: 5 },
                        { type: "null" },
                      ],
                    },
                    comment: { type: "string", maxLength: 600 },
                    evidence: {
                      type: "array",
                      minItems: 1,
                      maxItems: 3,
                      uniqueItems: true,
                      items: integerEnum(eventIds),
                    },
                  },
                  anyOf: [
                    {
                      required: ["rating"],
                      properties: {
                        rating: { type: "integer", minimum: 1, maximum: 5 },
                      },
                    },
                    {
                      required: ["comment"],
                      properties: {
                        comment: {
                          type: "string",
                          minLength: 1,
                          maxLength: 600,
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  };
}

export function playerSpeechTool(input) {
  const eventIds = integerEnum(input.allowedEventSeqs).enum;
  return {
    name: SPEECH_TOOL_NAME,
    description:
      "只提交当前幸存者的申辩与实际事件编号；正文加引用尾注总长最多4000。所有引用必须可见且真实，至少一条涉及本人；不虚构既成行为。",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["playerId", "text", "evidence"],
      properties: {
        playerId: { type: "string", enum: [input.playerId] },
        text: { type: "string", minLength: 1, maxLength: 4000 },
        evidence: {
          type: "array",
          minItems: 1,
          maxItems: eventIds.length,
          uniqueItems: true,
          items: integerEnum(eventIds),
          contains: integerEnum(input.ownEventSeqs),
          minContains: 1,
        },
      },
    },
  };
}

export function forcedPlayerTool(tool) {
  if (![PEER_TOOL_NAME, SPEECH_TOOL_NAME].includes(tool?.name))
    throw new Error("invalid_tool_output");
  return { tools: [tool], tool_choice: { type: "tool", name: tool.name } };
}

export function parsePlayerTool(payload, expectedName) {
  if (payload?.stop_reason === "max_tokens")
    throw new Error("response_truncated");
  if (!["tool_use", "end_turn"].includes(payload?.stop_reason))
    throw new Error("invalid_tool_output");
  if (![PEER_TOOL_NAME, SPEECH_TOOL_NAME].includes(expectedName))
    throw new Error("invalid_tool_output");
  const calls = Array.isArray(payload?.content)
    ? payload.content.filter((block) => block?.type === "tool_use")
    : [];
  if (
    calls.length !== 1 ||
    calls[0].name !== expectedName ||
    !calls[0].input ||
    typeof calls[0].input !== "object" ||
    Array.isArray(calls[0].input)
  )
    throw new Error("invalid_tool_output");
  if (JSON.stringify(calls[0].input).length > 100000)
    throw new Error("response_too_large");
  // Never coerce string input, concatenate calls, or repair/strip a candidate.
  return structuredClone(calls[0].input);
}

const FORMAT_FAILURES = new Set([
  "invalid_json",
  "empty_response",
  "invalid_tool_output",
  "invalid_peer_reviews",
  "invalid_player_speech",
  "invalid_boarding",
  "invalid_boarding_evidence",
  "invalid_boarding_behavior_evidence",
  "ineligible_boarding",
  "boarding_capacity",
  "invalid_academic_citations",
  "ungrounded_academic_citation",
  "missing_academic_domain",
]);

export function structuredFailure(error) {
  if (error?.message === "truncated_response") return "response_truncated";
  if (error?.message === "invalid_tool_output") return "invalid_tool_output";
  return safeLiveFailure(error);
}

export const canRepairFormat = (error) =>
  FORMAT_FAILURES.has(structuredFailure(error));

export function safeFormatFeedback(error) {
  const code = structuredFailure(error);
  if (!FORMAT_FAILURES.has(code)) return null;
  const diagnostic = safeValidationDiagnostic(error);
  let reason = "invalid_shape";
  if (code === "missing_academic_domain") reason = "missing_domain";
  else if (
    [
      "unknown_player",
      "unknown_behavior_event",
      "event_not_in_visible_index",
      "wrong_speaker",
      "invalid_rating",
    ].includes(diagnostic?.reason)
  )
    reason = "invalid_enum";
  else if (
    ["not_object", "not_array", "non_integer_event"].includes(
      diagnostic?.reason,
    )
  )
    reason = "wrong_type";
  else if (diagnostic?.reason === "empty_text") reason = "missing_fields";
  return { code, reason, ...(diagnostic ? { path: diagnostic.path } : {}) };
}

export function safeAttemptMetadata(metadata = {}) {
  const result = {};
  for (const key of [
    "requests",
    "httpStatus",
    "providerCode",
    "httpElapsedMs",
    "requestMaxOutputTokens",
    "elapsedMs",
  ])
    if (
      Number.isSafeInteger(metadata[key]) &&
      metadata[key] >= 0 &&
      metadata[key] <= 1000000000
    )
      result[key] = metadata[key];
  const usage = safeUsage({ usage: metadata.usage });
  if (usage) result.usage = usage;
  if (
    metadata.stopReason !== undefined ||
    metadata.outputTruncated !== undefined
  ) {
    const stop = safeResponseStop({ stop_reason: metadata.stopReason });
    result.stopReason = stop.stopReason;
    result.outputTruncated =
      stop.outputTruncated || metadata.outputTruncated === true;
  }
  return result;
}

// Callbacks own persistence and the HTTP budget. reserveRepair must reserve the
// match-level allowance BEFORE the second attempt; the shared transport still
// enforces the absolute paid-request cap. No raw failed candidate is retained.
export async function runFormatRepair({
  invoke,
  validate,
  reserveRepair,
  onAttempt = async () => {},
  attemptMetadata = () => ({}),
  beforeAttempt = async () => {},
}) {
  let feedback = null;
  for (let attempt = 1; attempt <= MAX_FORMAT_ATTEMPTS; attempt++) {
    await beforeAttempt(attempt);
    const started = Date.now();
    try {
      const value = validate(
        await invoke({ attempt, formatFeedback: feedback }),
      );
      await onAttempt({
        attempt,
        status: "passed",
        ...safeAttemptMetadata(attemptMetadata()),
        elapsedMs: Date.now() - started,
      });
      return value;
    } catch (error) {
      const failure = structuredFailure(error);
      const diagnostic = safeValidationDiagnostic(error);
      const metadata = safeAttemptMetadata(attemptMetadata());
      await onAttempt({
        attempt,
        status: "failed",
        failure,
        ...metadata,
        elapsedMs: Date.now() - started,
        ...(diagnostic ? { validationDiagnostic: diagnostic } : {}),
      });
      if (
        attempt >= MAX_FORMAT_ATTEMPTS ||
        metadata.httpStatus >= 400 ||
        [1004, 2049].includes(metadata.providerCode) ||
        metadata.outputTruncated ||
        !canRepairFormat(error) ||
        !(await reserveRepair())
      )
        throw new Error(failure);
      feedback = safeFormatFeedback(error);
    }
  }
  throw new Error("stage_validation_failed");
}

export function reserveMatchRepair(state, limit = MAX_REPAIRS_PER_MATCH) {
  const used = state.repairRequests ?? 0;
  if (
    !Number.isInteger(used) ||
    used < 0 ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > MAX_REPAIRS_PER_MATCH
  )
    throw new Error("stage_validation_failed");
  if (used >= limit) return false;
  state.repairRequests = used + 1;
  return true;
}

export function maximumMatchRequests(survivors, structured = false) {
  if (!Number.isInteger(survivors) || survivors < 0 || survivors > 6)
    throw new Error("fixture_invalid");
  return 3 + 2 * survivors + (structured ? MAX_REPAIRS_PER_MATCH : 0);
}
