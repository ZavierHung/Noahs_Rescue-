export const BOARDING_TOOL_NAME = "submit_boarding_verdict";

const FEEDBACK_CODES = new Set([
  "invalid_tool_output",
  "invalid_json",
  "empty_response",
  "invalid_boarding",
  "invalid_boarding_evidence",
  "invalid_boarding_behavior_evidence",
  "ineligible_boarding",
  "boarding_capacity",
  "invalid_academic_citations",
  "ungrounded_academic_citation",
  "missing_academic_domain",
]);
const FEEDBACK_REASONS = new Set([
  "missing_fields",
  "wrong_type",
  "invalid_enum",
  "invalid_shape",
  "missing_domain",
]);

// Only bounded diagnostics may be fed back. Never reflect a rejected provider
// body, exception message, full candidate, prompt, or credential into this field.
export function safeBoardingFormatFeedback(feedback) {
  if (!feedback || !FEEDBACK_CODES.has(feedback.code)) return null;
  return {
    code: feedback.code,
    ...(typeof feedback.path === "string" &&
    /^(?:statement|decisions|learning)(?:\[\d{1,3}\])?(?:\.(?:playerId|board|reason|evidence|sourceId|application|eventSeqs))?$/.test(
      feedback.path,
    )
      ? { path: feedback.path }
      : {}),
    ...(FEEDBACK_REASONS.has(feedback.reason)
      ? { reason: feedback.reason }
      : {}),
  };
}

export function boardingToolDefinition({
  context,
  evidence = [],
  academic,
  stage,
}) {
  const playerIds = context.players.map((player) => player.id);
  const eventSeqs = [
    ...new Set(context.globalEvents.map((event) => event.seq)),
  ];
  const eventReferences = {
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: { type: "integer", enum: eventSeqs },
  };
  const properties = {
    statement: { type: "string", minLength: 1 },
    decisions: {
      type: "array",
      minItems: playerIds.length,
      maxItems: playerIds.length,
      description:
        "每名玩家恰好一次；只能批准 eligible=true 的幸存者，总人数不超过 context.policy.seats。每个决定至少引用一条非意见类真实行为事件。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["playerId", "board", "reason", "evidence"],
        properties: {
          playerId: { type: "string", enum: playerIds },
          board: { type: "boolean" },
          reason: { type: "string", minLength: 1 },
          evidence: eventReferences,
        },
      },
    },
  };
  const required = ["statement", "decisions"];
  if (academic) {
    const sourceIds = [...new Set(evidence.map((source) => source.id))];
    required.push("learning");
    properties.learning = {
      type: "array",
      minItems: stage === "discussion" ? 2 : 3,
      maxItems: sourceIds.length,
      description:
        "sourceId 不得重复。初审和终审覆盖 economy、environment、society 三领域；讨论至少两篇。结合真实行为解释文献观点及适用局限，不以意见代替事实。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceId", "application", "eventSeqs"],
        properties: {
          sourceId: { type: "string", enum: sourceIds },
          application: { type: "string", minLength: 1 },
          eventSeqs: eventReferences,
        },
      },
    };
  }
  return {
    name: BOARDING_TOOL_NAME,
    description:
      "提交本阶段的登船裁决数据。这是结构化输出通道，不会执行游戏动作；所有裁决仍必须经过游戏规则和学术证据校验。",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required,
      properties,
    },
  };
}

export function parseBoardingToolResponse(payload) {
  if (payload?.stop_reason === "max_tokens")
    throw new Error("truncated_response");
  // Some compatible providers close an otherwise complete tool message with
  // end_turn. Both accepted terminators must still contain exactly one tool.
  if (!["tool_use", "end_turn"].includes(payload?.stop_reason))
    throw new Error("invalid_tool_output");
  const toolUses = Array.isArray(payload?.content)
    ? payload.content.filter((block) => block?.type === "tool_use")
    : [];
  const tool = toolUses[0];
  if (
    toolUses.length !== 1 ||
    tool.name !== BOARDING_TOOL_NAME ||
    !tool.input ||
    typeof tool.input !== "object" ||
    Array.isArray(tool.input)
  )
    throw new Error("invalid_tool_output");
  return tool.input;
}
