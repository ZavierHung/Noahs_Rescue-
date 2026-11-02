// Shared safety/validation primitives for the opt-in live simulation. Importing
// this module never reads environment files, sends HTTP, or touches game saves.
import { createHash } from "node:crypto";

export const LIVE_MODEL = "MiniMax-M3";
export const REQUESTS_PER_MATCH = 15; // reviews + initial + (speech + reply)*6 + final
export const BEHAVIOR_EXCLUSIONS = new Set([
  "peer_review",
  "discussion",
  "judge",
  "finalize",
]);
export const POLICIES = ["mixed", "balanced", "cautious", "generous"];

export function parseLiveArguments(args) {
  const options = {
    live: false,
    matches: 20,
    start: 2001,
    maxRequests: null,
    timeoutMs: 90000,
    runId: null,
    resume: false,
    structured: false,
    concise: false,
    policyOffset: 0,
    godOutputTokens: 3000,
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error("invalid_arguments");
    seen.add(arg);
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--live") {
      options.live = true;
      continue;
    }
    if (arg === "--dry-run") continue;
    if (arg === "--structured") {
      options.structured = true;
      continue;
    }
    if (arg === "--concise") {
      options.concise = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined || value.startsWith("--"))
      throw new Error("invalid_arguments");
    if (arg === "--matches") options.matches = Number(value);
    else if (arg === "--start") options.start = Number(value);
    else if (arg === "--max-requests") options.maxRequests = Number(value);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(value);
    else if (arg === "--policy-offset") options.policyOffset = Number(value);
    else if (arg === "--god-output-tokens")
      options.godOutputTokens = Number(value);
    else if (arg === "--run-id" || arg === "--resume") {
      if (options.runId) throw new Error("invalid_arguments");
      options.runId = value;
      options.resume = arg === "--resume";
    } else throw new Error("invalid_arguments");
  }
  if (seen.has("--live") && seen.has("--dry-run"))
    throw new Error("invalid_arguments");
  if (options.concise && !options.structured)
    throw new Error("invalid_arguments");
  if (
    !Number.isInteger(options.godOutputTokens) ||
    options.godOutputTokens < 3000 ||
    options.godOutputTokens > 8000 ||
    (!options.structured && options.godOutputTokens !== 3000)
  )
    throw new Error("invalid_boarding_output_token_limit");
  const maximum = Math.min(
    300,
    options.matches * (REQUESTS_PER_MATCH + (options.structured ? 2 : 0)),
  );
  options.maxRequests ??= maximum;
  if (
    !Number.isInteger(options.matches) ||
    options.matches < 1 ||
    options.matches > 20 ||
    !Number.isInteger(options.start) ||
    options.start < 1 ||
    options.start > 1000000 ||
    !Number.isInteger(options.maxRequests) ||
    options.maxRequests < 1 ||
    options.maxRequests > maximum ||
    !Number.isInteger(options.policyOffset) ||
    options.policyOffset < 0 ||
    options.policyOffset > 3 ||
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1000 ||
    options.timeoutMs > 120000 ||
    (options.runId &&
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(options.runId)) ||
    (options.resume && !options.live)
  )
    throw new Error("invalid_arguments");
  return options;
}

export function allowMiniMaxEndpoint(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("untrusted_api_endpoint");
  }
  if (
    url.protocol !== "https:" ||
    !["api.minimaxi.com", "api.minimax.cn", "api.minimax.io"].includes(
      url.hostname,
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !["/anthropic", "/anthropic/"].includes(url.pathname)
  )
    throw new Error("untrusted_api_endpoint");
  return `${url.origin}/anthropic`;
}

export function safeLiveFailure(error) {
  if (error?.message === "truncated_response") return "response_truncated";
  const message = error?.message || "";
  const codes = new Set([
    "not_configured",
    "env_load_failed",
    "untrusted_api_endpoint",
    "invalid_arguments",
    "invalid_boarding_output_token_limit",
    "invalid_json",
    "invalid_tool_output",
    "empty_response",
    "timeout",
    "request_budget_exhausted",
    "interrupted_request_not_retried",
    "stage_validation_failed",
    "invalid_peer_reviews",
    "invalid_player_speech",
    "model_fallback",
    "fixture_invalid",
    "resume_config_changed",
    "resume_budget_cannot_decrease",
    "run_already_exists",
    "resume_not_found",
    "checkpoint_invalid",
    "source_fingerprint_failed",
    "invalid_boarding",
    "invalid_boarding_evidence",
    "invalid_boarding_behavior_evidence",
    "ineligible_boarding",
    "boarding_capacity",
    "invalid_academic_citations",
    "ungrounded_academic_citation",
    "missing_academic_domain",
    "request_failed",
    "response_too_large",
    "response_truncated",
  ]);
  if (codes.has(message) || /^http_\d{3}$/.test(message)) return message;
  if (["AbortError", "TimeoutError"].includes(error?.name)) return "timeout";
  return "request_or_validation_failed";
}

export function privateRedactor(privateTexts = []) {
  const clean = (value) => {
    if (typeof value === "string") {
      let text = value;
      for (const secret of privateTexts) {
        if (typeof secret !== "string" || !secret) continue;
        text = text.replaceAll(secret, "[REDACTED]");
        text = text.replaceAll(
          JSON.stringify(secret).slice(1, -1),
          "[REDACTED]",
        );
        for (const line of secret.split("\n"))
          if (line.length >= 24) text = text.replaceAll(line, "[REDACTED]");
      }
      return text
        .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, "[REDACTED]");
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, clean(v)]),
      );
    return value;
  };
  return clean;
}

export const contentHash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

export function safeUsage(payload) {
  const source = payload?.usage;
  if (!source || typeof source !== "object") return null;
  const fields = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ];
  const result = Object.fromEntries(
    fields
      .filter((key) => Number.isSafeInteger(source[key]) && source[key] >= 0)
      .map((key) => [key, source[key]]),
  );
  return Object.keys(result).length ? result : null;
}

export function safeResponseStop(payload) {
  const value = payload?.stop_reason;
  const known = new Set([
    "end_turn",
    "max_tokens",
    "stop_sequence",
    "tool_use",
  ]);
  return {
    stopReason:
      value === undefined || value === null
        ? null
        : known.has(value)
          ? value
          : "other",
    outputTruncated: value === "max_tokens",
  };
}

// Retry-After may also contain an HTTP date, arbitrary provider text, or an
// excessive wait. Retain only bounded integer seconds; never persist headers.
export function safeRetryAfterSeconds(value) {
  if (typeof value !== "string" || !/^[0-9]{1,5}$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86400 ? seconds : null;
}

export function parsePlayerJson(payload) {
  // A syntactically valid prefix is not evidence that the provider finished.
  if (payload?.stop_reason === "max_tokens")
    throw new Error("response_truncated");
  const text = payload?.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new Error("empty_response");
  if (text.length > 100000) throw new Error("response_too_large");
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new Error("invalid_json");
  }
}

const realEvents = (context) =>
  context.globalEvents.filter((e) => !BEHAVIOR_EXCLUSIONS.has(e.type));

const involves = (event, id) =>
  [event.actor, event.targetId, event.owner].includes(id);
const objectValue = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const VALIDATION_REASONS = new Set([
  "not_object",
  "not_array",
  "wrong_count",
  "unknown_player",
  "duplicate_player",
  "self_review",
  "duplicate_target",
  "invalid_rating",
  "empty_text",
  "text_too_long",
  "duplicate_event",
  "non_integer_event",
  "unknown_behavior_event",
  "event_not_in_visible_index",
  "no_event_involving_target",
  "wrong_speaker",
]);

function invalid(code, path, reason, details = {}) {
  const error = new Error(code);
  error.validationDiagnostic = { path, reason, ...details };
  throw error;
}

// Errors may contain hostile model fields. Persist only a known path/reason,
// safe player IDs and bounded numeric metadata, NEVER the rejected value/text.
export function safeValidationDiagnostic(error) {
  const diagnostic = error?.validationDiagnostic;
  if (
    !objectValue(diagnostic) ||
    !VALIDATION_REASONS.has(diagnostic.reason) ||
    typeof diagnostic.path !== "string" ||
    diagnostic.path.length > 120 ||
    !/^(?:reviews(?:\[\d{1,2}\])?(?:\.(?:reviewerId|entries)(?:\[\d{1,2}\])?)?(?:\.(?:targetId|rating|comment|evidence)(?:\[\d{1,2}\])?)?|playerId|text|evidence(?:\[\d{1,2}\])?)$/.test(
      diagnostic.path,
    )
  )
    return null;
  const safe = { path: diagnostic.path, reason: diagnostic.reason };
  for (const key of ["reviewerId", "targetId", "playerId"])
    if (typeof diagnostic[key] === "string" && /^P[1-6]$/.test(diagnostic[key]))
      safe[key] = diagnostic[key];
  for (const key of ["eventSeq", "actualCount", "expectedCount", "textLength"])
    if (
      Number.isSafeInteger(diagnostic[key]) &&
      diagnostic[key] >= 0 &&
      diagnostic[key] <= 1000000000
    )
      safe[key] = diagnostic[key];
  return safe;
}

function validateEventRefs(
  refs,
  events,
  { code, path, maximum, targetId, reviewerId, allowed },
) {
  const metadata = { targetId, reviewerId };
  if (!Array.isArray(refs)) invalid(code, path, "not_array", metadata);
  if (!refs.length || refs.length > maximum)
    invalid(code, path, "wrong_count", {
      ...metadata,
      actualCount: refs.length,
    });
  if (new Set(refs).size !== refs.length)
    invalid(code, path, "duplicate_event", metadata);
  refs.forEach((seq, index) => {
    const itemPath = `${path}[${index}]`;
    if (!Number.isInteger(seq))
      invalid(code, itemPath, "non_integer_event", metadata);
    if (!events.some((event) => event.seq === seq))
      invalid(code, itemPath, "unknown_behavior_event", {
        ...metadata,
        eventSeq: seq,
      });
    if (allowed && !allowed.includes(seq))
      invalid(code, itemPath, "event_not_in_visible_index", {
        ...metadata,
        eventSeq: seq,
      });
  });
  if (
    !refs.some((seq) =>
      events.some((event) => event.seq === seq && involves(event, targetId)),
    )
  )
    invalid(code, path, "no_event_involving_target", metadata);
}

export function validatePeerBatch(value, context, visibleEventSeqs = null) {
  const code = "invalid_peer_reviews";
  if (!objectValue(value)) invalid(code, "reviews", "not_object");
  if (!Array.isArray(value.reviews)) invalid(code, "reviews", "not_array");
  if (value.reviews.length !== context.players.length)
    invalid(code, "reviews", "wrong_count", {
      actualCount: value.reviews.length,
      expectedCount: context.players.length,
    });
  const seen = new Set(),
    events = realEvents(context);
  return {
    reviews: value.reviews.map((review, reviewIndex) => {
      const at = `reviews[${reviewIndex}]`;
      if (!objectValue(review)) invalid(code, at, "not_object");
      const reviewerId = review.reviewerId;
      if (!context.players.some((p) => p.id === reviewerId))
        invalid(code, `${at}.reviewerId`, "unknown_player");
      if (seen.has(reviewerId))
        invalid(code, `${at}.reviewerId`, "duplicate_player", { reviewerId });
      seen.add(reviewerId);
      if (!Array.isArray(review.entries))
        invalid(code, `${at}.entries`, "not_array", { reviewerId });
      // Match the production peer-review contract: every other player may be
      // reviewed. The prompt's short-answer recommendation is not a rule.
      if (
        review.entries.length < 1 ||
        review.entries.length >= context.players.length
      )
        invalid(code, `${at}.entries`, "wrong_count", {
          reviewerId,
          actualCount: review.entries.length,
        });
      const targets = new Set();
      return {
        reviewerId,
        entries: review.entries.map((entry, index) => {
          const entryPath = `${at}.entries[${index}]`;
          if (!objectValue(entry))
            invalid(code, entryPath, "not_object", { reviewerId });
          const metadata = { reviewerId, targetId: entry.targetId };
          if (!context.players.some((p) => p.id === entry.targetId))
            invalid(code, `${entryPath}.targetId`, "unknown_player", {
              reviewerId,
            });
          if (entry.targetId === reviewerId)
            invalid(code, `${entryPath}.targetId`, "self_review", metadata);
          if (targets.has(entry.targetId))
            invalid(
              code,
              `${entryPath}.targetId`,
              "duplicate_target",
              metadata,
            );
          const rating = entry.rating ?? null;
          if (
            rating !== null &&
            (!Number.isInteger(rating) || rating < 1 || rating > 5)
          )
            invalid(code, `${entryPath}.rating`, "invalid_rating", metadata);
          if (entry.comment !== undefined && typeof entry.comment !== "string")
            invalid(code, `${entryPath}.comment`, "empty_text", metadata);
          const comment = (entry.comment || "").trim();
          if (rating === null && !comment)
            invalid(code, `${entryPath}.comment`, "empty_text", metadata);
          if (comment.length > 600)
            invalid(code, `${entryPath}.comment`, "text_too_long", {
              ...metadata,
              textLength: comment.length,
            });
          validateEventRefs(entry.evidence, events, {
            code,
            path: `${entryPath}.evidence`,
            maximum: 3,
            ...metadata,
            // All references must be real and visible. Only at least one must
            // involve the target: comparisons with others remain legitimate.
            allowed: visibleEventSeqs,
          });
          targets.add(entry.targetId);
          return {
            targetId: entry.targetId,
            rating,
            comment,
            evidence: [...entry.evidence],
          };
        }),
      };
    }),
  };
}

export function formatSpeechForService({ text, evidence }) {
  return `${text.trim()}\n引用实际行为事件：${evidence.map((seq) => `#${seq}`).join("、")}`;
}

export function validatePlayerSpeech(value, context, playerId, allowed = null) {
  const code = "invalid_player_speech";
  if (!objectValue(value))
    invalid(code, "playerId", "not_object", { playerId });
  if (value.playerId !== playerId)
    invalid(code, "playerId", "wrong_speaker", { playerId });
  if (typeof value.text !== "string" || !value.text.trim())
    invalid(code, "text", "empty_text", { playerId });
  const text = value.text.trim();
  if (text.length > 4000)
    invalid(code, "text", "text_too_long", {
      playerId,
      textLength: text.length,
    });
  const events = realEvents(context);
  validateEventRefs(value.evidence, events, {
    code,
    path: "evidence",
    // The production action accepts text, not a five-reference schema. The
    // natural maximum is the finite set shown to this actor, not an arbitrary
    // count. All references remain unique, real, visible and target-grounded.
    maximum: allowed?.length ?? events.length,
    targetId: playerId,
    allowed,
  });
  const normalized = { playerId, text, evidence: [...value.evidence] };
  const submittedLength = formatSpeechForService(normalized).length;
  if (submittedLength > 4000)
    invalid(code, "text", "text_too_long", {
      playerId,
      textLength: submittedLength,
    });
  return normalized;
}

const EVIDENCE_GROUPS = [
  ["donation"],
  ["world_change"],
  ["technology"],
  ["invitation_accept", "trade_accept"],
  ["steal", "public_event_choice", "supply_pool"],
  ["flood_payment"],
  ["survival", "evacuate"],
];

function compactEvent(event) {
  const result = {};
  for (const field of [
    "seq",
    "round",
    "type",
    "actor",
    "targetId",
    "owner",
    "cardId",
    "source",
    "ownerResource",
    "recipientResource",
    "resource",
    "requested",
    "actual",
    "lost",
    "injury",
    "alive",
    "safe",
    "seedsUsed",
    "remainingInjury",
    "die",
  ])
    if (event[field] !== undefined)
      result[field] = structuredClone(event[field]);
  if (typeof event.detail === "string")
    result.detail = event.detail.slice(0, 140);
  if (event.donation?.amounts)
    result.donated = structuredClone(event.donation.amounts);
  if (event.type === "world_change") {
    result.actualDelta =
      event.applied ||
      (event.before && event.after
        ? Object.fromEntries(
            ["economy", "environment", "society"].map((key) => [
              key,
              event.after[key] - event.before[key],
            ]),
          )
        : null);
  }
  return result;
}

// Student actors see a deterministic, explicitly partial evidence notebook.
// The production god STILL receives its untouched complete causal context.
// Avoid action.effects snapshots and duplicate facts/globalEvents in each
// student's input. Summaries use authoritative totals; examples never inflate
// those totals. Preserve at most two latest events in each semantic category.
export function buildStudentEvidencePacket(context) {
  const events = realEvents(context);
  const selected = new Map();
  const allowedEventSeqsByPlayer = {};
  const players = context.players.map((player) => {
    const own = events.filter((event) => involves(event, player.id));
    const examples = new Map();
    for (const kinds of EVIDENCE_GROUPS)
      for (const event of own
        .filter((event) => kinds.includes(event.type))
        .slice(-2))
        examples.set(event.seq, event);
    // Old/minimal fixtures without semantic events still provide real evidence.
    if (!examples.size && own.length) examples.set(own.at(-1).seq, own.at(-1));
    for (const [seq, event] of examples) selected.set(seq, event);
    const facts = context.facts?.players?.find(
      (entry) => entry.playerId === player.id,
    );
    const opportunity = context.opportunityContext?.players?.find(
      (entry) => entry.playerId === player.id,
    );
    return {
      id: player.id,
      donated: player.donated,
      worldImpact: player.worldImpact,
      resourcesRemaining: player.resources,
      eligible: player.eligible,
      survival: player.survival,
      ...(facts
        ? {
            technologyUseCount: facts.technologyUseCount,
            technologyCounts: facts.technologyCounts,
            cooperationCount: facts.cooperationCount,
            cooperationPartners: facts.cooperationPartners,
          }
        : {}),
      ...(opportunity ? { initialOpportunity: opportunity } : {}),
    };
  });
  for (const event of events.filter((event) => event.type === "flood"))
    selected.set(event.seq, event);
  const evidenceIndex = [...selected.values()]
    .sort((a, b) => a.seq - b.seq)
    .map(compactEvent);
  // Membership is based on the FINAL shared index, not who originally sampled
  // the event. A cooperation selected by P2 is also a visible P3 fact when P3
  // was the recipient, even if P3 has newer cooperation examples of their own.
  for (const player of context.players)
    allowedEventSeqsByPlayer[player.id] = evidenceIndex
      .filter((event) => involves(event, player.id))
      .map((event) => event.seq);
  return structuredClone({
    version: "student-evidence-v3",
    round: context.round,
    world: context.attributes,
    ark: context.ark,
    seats: context.policy?.seats,
    policy:
      "生存与船位是硬约束；互评是待核实观点，不是投票或人格评分。捐赠与世界影响为实际累计，例子不是总计。",
    evidenceScope:
      "例子是每人每类最多最后2条真实行为的确定性子集，非完整航程。未列入事件不代表没有发生；不得据此声称从未行动。全量日志只保留给上帝核对。",
    opportunityLimitations:
      context.opportunityContext?.limitations ||
      "机会信息未提供，不得假设出生优劣。",
    players,
    allowedEventSeqsByPlayer,
    visibleEventSeqs: evidenceIndex.map((event) => event.seq),
    evidenceIndex,
  });
}

export function buildStudentSpeechNotebook(
  context,
  notebook,
  judgment,
  playerId,
) {
  const requested = new Set([
    ...(notebook.allowedEventSeqsByPlayer[playerId] || []),
    ...notebook.evidenceIndex
      .filter((event) => event.type === "flood")
      .map((event) => event.seq),
  ]);
  const add = (seq) => {
    if (Number.isSafeInteger(seq) && seq > 0 && seq <= 1000000000)
      requested.add(seq);
  };
  const addText = (text) => {
    if (typeof text !== "string") return;
    // Only explicitly labeled event references, never scores, years or totals.
    for (const match of text.matchAll(
      /#\s*([0-9]{1,9})\b|(?:事件|event|seq)\s*(?:编号|序号|号|[:：=#])?\s*([0-9]{1,9})(?:\b|号)/giu,
    ))
      add(Number(match[1] || match[2]));
  };
  const addVerdict = (verdict) => {
    if (!verdict) return;
    addText(verdict.statement);
    for (const decision of verdict.decisions || []) {
      for (const seq of decision.evidence || []) add(seq);
      addText(decision.reason);
    }
    for (const learning of verdict.learning || []) {
      for (const seq of learning.eventSeqs || []) add(seq);
      addText(learning.application);
    }
  };
  addVerdict(judgment.verdict);
  for (const stage of judgment.history || []) addVerdict(stage.verdict);
  for (const conversation of judgment.conversations || []) {
    addText(conversation.text);
    addText(conversation.reply);
    addText(conversation.question);
  }
  for (const question of judgment.questions || []) addText(question.text);
  const allEvents = new Map(
    context.globalEvents.map((event) => [event.seq, event]),
  );
  const evidenceIndex = [],
    unresolvedEventSeqs = [],
    opinionEventSeqs = [];
  for (const seq of [...requested].sort((a, b) => a - b)) {
    const event = allEvents.get(seq);
    if (!event) unresolvedEventSeqs.push(seq);
    else if (BEHAVIOR_EXCLUSIONS.has(event.type)) opinionEventSeqs.push(seq);
    else evidenceIndex.push(compactEvent(event));
  }
  const visibleEventSeqs = evidenceIndex.map((event) => event.seq);
  const ownEventSeqs = evidenceIndex
    .filter((event) => involves(event, playerId))
    .map((event) => event.seq);
  return structuredClone({
    ...notebook,
    evidenceScope: `${notebook.evidenceScope} 本发言页另补入当前和此前裁决/文献应用/对话明确引用的真实行为，允许质疑裁决；引用存在不代表其解释正确。`,
    referenceDiagnostics: {
      unresolvedEventSeqs,
      opinionEventSeqs,
      note: "未找到的编号与意见事件不可作为行为证据；可以指出证据不足，不得补造行为。",
    },
    allowedEventSeqsByPlayer: { [playerId]: ownEventSeqs },
    visibleEventSeqs,
    evidenceIndex,
  });
}

// Only one stage is active at a time. Reservation is persisted BEFORE HTTP,
// so an interrupted paid request is never silently resent during resume.
export function createStageRunner({
  report,
  persist,
  fetchImpl,
  endpoint,
  redact = (v) => v,
  progress = () => {},
  formatRepair = null,
}) {
  let current = null;
  let currentAttempt = null;
  const guardedFetch = async (url, options) => {
    const record = currentAttempt || current;
    if (
      !current ||
      current.requests >= (formatRepair ? 2 : 1) ||
      record.requests >= 1 ||
      report.requestBudget.actual >= report.requestBudget.total
    ) {
      if (current) current.blockedRetries++;
      throw new Error("request_budget_exhausted");
    }
    if (String(url) !== endpoint) throw new Error("untrusted_api_endpoint");
    current.requests++;
    if (record !== current) record.requests++;
    report.requestBudget.actual++;
    current.requestState = "reserved_before_http";
    record.requestState = "reserved_before_http";
    try {
      const maximum = JSON.parse(options.body).max_tokens;
      if (Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 1000000)
        record.requestMaxOutputTokens = maximum;
    } catch {
      /* Never persist request contents, only a validated numeric cap. */
    }
    await persist();
    progress({
      type: "http_start",
      stage: current.id,
      actual: report.requestBudget.actual,
      total: report.requestBudget.total,
    });
    const start = Date.now();
    try {
      const response = await fetchImpl(url, { ...options, redirect: "error" });
      record.httpStatus = response.status;
      current.httpStatus = response.status;
      if (response.status === 429) {
        const seconds = safeRetryAfterSeconds(
          response.headers?.get?.("retry-after"),
        );
        if (seconds !== null) {
          record.retryAfterSeconds = seconds;
          current.retryAfterSeconds = seconds;
        }
      }
      // A cloned response lets the real adapter parse the untouched original.
      try {
        const payload = await response.clone().json();
        record.usage = safeUsage(payload);
        Object.assign(record, safeResponseStop(payload));
        const code = payload?.error?.code ?? payload?.base_resp?.status_code;
        // Numbers only: no raw provider messages or arbitrary fields persisted.
        if (Number.isSafeInteger(code)) {
          record.providerCode = code;
          current.providerCode = code;
        }
      } catch {
        /* Body errors are handled by the real adapter. */
      }
      return response;
    } catch (error) {
      record.failure = safeLiveFailure(error);
      throw error;
    } finally {
      record.httpElapsedMs = Date.now() - start;
      record.requestState = "returned_or_threw";
      current.requestState = "returned_or_threw";
      await persist();
    }
  };

  async function run(id, context, invoke, validate) {
    if (current) throw new Error("stage_validation_failed");
    const contextHash = contentHash(context);
    let stage = report.stages.find((item) => item.id === id);
    if (stage) {
      if (stage.contextHash !== contextHash)
        throw new Error("resume_config_changed");
      if (stage.status === "passed")
        return validate(structuredClone(stage.value));
      if (stage.status === "failed")
        throw new Error(stage.failure || "stage_validation_failed");
      stage.status = "failed";
      stage.failure = "interrupted_request_not_retried";
      await persist();
      throw new Error(stage.failure);
    }
    stage = {
      id,
      contextHash,
      inputCharacters: JSON.stringify(context).length,
      status: "running",
      requests: 0,
      blockedRetries: 0,
      httpStatus: null,
      startedAt: new Date().toISOString(),
      usage: null,
    };
    report.stages.push(stage);
    current = stage;
    const start = Date.now();
    await persist();
    try {
      let value;
      if (formatRepair) {
        stage.attempts = [];
        value = await formatRepair.run({
          beforeAttempt: async (attempt) => {
            currentAttempt = { attempt, status: "running", requests: 0 };
            stage.attempts.push(currentAttempt);
            await persist();
          },
          invoke: async (input) => {
            const candidate = await invoke(input);
            if (currentAttempt.outputTruncated)
              throw new Error("response_truncated");
            return candidate;
          },
          validate: (candidate) => validate(redact(candidate)),
          reserveRepair: formatRepair.reserve,
          attemptMetadata: () => currentAttempt,
          onAttempt: async (record) => {
            Object.assign(currentAttempt, record);
            await persist();
          },
        });
      } else {
        const candidate = await invoke();
        if (stage.outputTruncated) throw new Error("response_truncated");
        // Redact BEFORE validation and persistence, even on successful responses.
        value = validate(redact(candidate));
      }
      stage.status = "passed";
      stage.value = value;
      return structuredClone(value);
    } catch (error) {
      stage.status = "failed";
      // The production adapter may attempt a blocked JSON retry after a
      // truncated answer. Preserve the actual stop condition rather than hide
      // it behind the guard's request_budget_exhausted diagnostic.
      stage.failure = (currentAttempt || stage).outputTruncated
        ? "response_truncated"
        : safeLiveFailure(error);
      const diagnostic = safeValidationDiagnostic(error);
      if (diagnostic) stage.validationDiagnostic = diagnostic;
      throw new Error(stage.failure);
    } finally {
      stage.elapsedMs = Date.now() - start;
      current = null;
      currentAttempt = null;
      await persist();
      progress({
        type: "stage_end",
        stage: id,
        status: stage.status,
        elapsedMs: stage.elapsedMs,
        actual: report.requestBudget.actual,
        total: report.requestBudget.total,
        failure: stage.failure || null,
      });
    }
  }
  return { fetch: guardedFetch, run };
}

export function isAuthenticationFailure(stages) {
  return stages.some(
    (stage) =>
      [401, 403].includes(stage.httpStatus) ||
      [1004, 2049].includes(stage.providerCode),
  );
}

export function resumeBudget(report, maximum) {
  if (
    !Number.isInteger(maximum) ||
    maximum < report.requestBudget.total ||
    maximum < report.requestBudget.actual
  )
    throw new Error("resume_budget_cannot_decrease");
  report.requestBudget.total = maximum;
}
