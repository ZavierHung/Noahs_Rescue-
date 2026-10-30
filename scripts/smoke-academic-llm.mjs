// Explicitly opted-in, bounded live check. Never opens or writes player saves.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAcademicRetriever } from "../server/src/academic/retriever.js";
import { validateLearning } from "../server/src/academic/learning.js";
import {
  createBoardingJudge,
  validateBoarding,
} from "../server/src/expedition/judgment.js";
import { simulate } from "../server/src/expedition/simulation.js";
import { createGodRepository } from "../server/src/god-repository.js";
import {
  createMiniMaxVerdictModel,
  safeMiniMaxValidationFailure,
} from "../server/src/llm/minimax.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/smoke-academic-llm.mjs --live\n" +
      "Loads the project .env only after --live. Runs a six-player seed-41 " +
      "simulation in memory and at most two real MiniMax-M3 HTTP requests " +
      "(initial + one discussion). No retry can exceed that budget.\n" +
      "Writes only test-results/academic-live-smoke.json; no live saves, " +
      "request prompts, keys or headers are logged. Exit 0 requires both " +
      "model stages and structural checks to pass. Human review is still required.",
  );
  process.exit(0);
}
if (args.length !== 1 || args[0] !== "--live") {
  console.error(
    "Live API use requires exactly --live. Use --help for details.",
  );
  process.exit(2);
}

const root = new URL("../", import.meta.url);
const output = new URL("test-results/academic-live-smoke.json", root);
const MODEL = "MiniMax-M3";
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  mode: "opt-in live model, deterministic in-memory fixture",
  provider: "minimax",
  model: MODEL,
  requestBudget: { total: 2, perStage: 1, actual: 0 },
  stages: [],
  result: "failed",
  limitations: [
    "This is a two-request smoke test, not a final-council or statistical quality evaluation.",
    "Only citation IDs, event existence, stage coverage, survivor eligibility and capacity are machine-validated.",
    "Whether cited scholarship actually supports each inference and whether the rebuttal was understood require human review.",
    "A rule-based fallback is recorded as a failed live-model check, never as model success.",
    "No live player save, request prompt, API key, authorization header or raw provider response is recorded.",
  ],
};
let key = "";
const privatePrompts = [];
const redact = (value) => {
  if (typeof value === "string") {
    let safe = value;
    if (key) safe = safe.replaceAll(key, "[REDACTED_API_KEY]");
    for (const prompt of privatePrompts)
      if (prompt) safe = safe.replaceAll(prompt, "[REDACTED_SYSTEM_PROMPT]");
    return safe;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redact(item)]),
    );
  return value;
};
function safeFailure(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const allowed = new Set([
    "not_configured",
    "invalid_json",
    "empty_response",
    "timeout",
    "request_budget_exhausted",
    "untrusted_api_endpoint",
    "invalid_fixture",
    "missing_survivor",
    "env_load_failed",
  ]);
  if (allowed.has(message) || /^http_\d{3}$/.test(message)) return message;
  if (error?.name === "AbortError" || error?.name === "TimeoutError")
    return "timeout";
  return "request_or_validation_failed";
}

try {
  try {
    // Like server/package.json: existing process variables take precedence.
    process.loadEnvFile(fileURLToPath(new URL(".env", root)));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("env_load_failed");
  }
  key = process.env.MINIMAX_API_KEY || "";
  if (!key.trim()) throw new Error("not_configured");
  const baseUrl =
    process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/anthropic";
  const endpoint = new URL(baseUrl);
  if (
    endpoint.protocol !== "https:" ||
    !["api.minimaxi.com", "api.minimax.cn", "api.minimax.io"].includes(
      endpoint.hostname,
    ) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("untrusted_api_endpoint");
  const configuredTimeout = Number(process.env.MINIMAX_TIMEOUT_MS || 60000);
  const timeoutMs = Math.min(
    120000,
    Math.max(
      1000,
      Number.isFinite(configuredTimeout) ? configuredTimeout : 60000,
    ),
  );
  report.timeoutMs = timeoutMs;
  let transport = null;
  const model = createMiniMaxVerdictModel({
    apiKey: key,
    baseUrl,
    model: MODEL,
    timeoutMs,
    // The adapter retries malformed JSON once. This guard prevents that retry
    // from making an extra paid HTTP request within either stage.
    fetchImpl: async (url, options) => {
      if (
        !transport ||
        transport.requests >= 1 ||
        report.requestBudget.actual >= 2
      ) {
        if (transport) transport.blockedRetries++;
        throw new Error("request_budget_exhausted");
      }
      transport.requests++;
      report.requestBudget.actual++;
      try {
        const response = await fetch(url, {
          ...options,
          redirect: "error", // Never forward a credential to a redirected host.
        });
        transport.httpStatus = response.status;
        return response;
      } catch (error) {
        transport.failure = safeFailure(error);
        throw error;
      }
    },
  });
  const verdictModel = {
    ...model,
    async generateBoarding(context) {
      privatePrompts.push(context.god.prompt, context.rolePrompt);
      try {
        const candidate = await model.generateBoarding(context);
        try {
          const validated = validateBoarding(
            candidate,
            context.context,
            context.evidence,
          );
          if (context.academic)
            validateLearning(
              validated.learning,
              context.evidence,
              context.context,
              {
                required: true,
                stage: context.stage,
              },
            );
        } catch (error) {
          // Keep only an enumerated reason. The candidate may contain invented
          // facts or sensitive echoes and is deliberately never persisted.
          transport.validationFailure = safeMiniMaxValidationFailure(error);
          throw error;
        }
        return candidate;
      } catch (error) {
        transport.failure = safeFailure(error);
        // Adapter supplies only sanitized code/type/message. Never preserve the
        // raw response, arbitrary Error fields, request headers, or prompts.
        if (error.providerError) transport.providerError = error.providerError;
        throw error;
      }
    },
  };
  const godRepository = createGodRepository(
    fileURLToPath(new URL("server/data/", root)),
  );
  const gods = await godRepository.list();
  const personaIndex = gods.findIndex((god) => god.id === "balanced");
  if (personaIndex < 0) throw new Error("invalid_fixture");
  const retriever = await createAcademicRetriever();
  const judge = createBoardingJudge({
    godRepository,
    retriever,
    verdictModel,
    random: () => (personaIndex + 0.5) / gods.length,
  });
  const { game, commands } = simulate({ seed: 41, players: 6 });
  game.id = "ACADEMIC-LIVE-SMOKE-SEED-41";
  if (game.status !== "awaiting_judgment" || game.players.length !== 6)
    throw new Error("invalid_fixture");
  report.corpus = retriever.describe();
  report.fixture = {
    seed: 41,
    players: 6,
    policy: "balanced",
    commands,
    round: game.round,
    status: game.status,
    eventCount: game.events.length,
    attributes: game.attributes,
  };

  async function runStage(input) {
    transport = {
      requests: 0,
      blockedRetries: 0,
      httpStatus: null,
      failure: null,
      providerError: null,
      validationFailure: null,
    };
    const started = Date.now();
    const result = await judge(game, input);
    const context = result.context;
    const evidence = result.rag.evidence;
    const validity = { boardingSchema: false, academicCitations: false };
    try {
      validateBoarding(result.verdict, context, evidence);
      validity.boardingSchema = true;
      validateLearning(result.verdict.learning, evidence, context, {
        required: true,
        stage: input.stage,
      });
      validity.academicCitations = true;
    } catch {
      // Report the independent check, never copy raw model/parser errors.
    }
    const admitted = result.verdict.decisions.filter(
      (decision) => decision.board,
    );
    const checks = {
      ...validity,
      realModelUsed: result.llm.used,
      allPlayersCovered:
        result.verdict.decisions.length === context.players.length &&
        new Set(result.verdict.decisions.map((d) => d.playerId)).size ===
          context.players.length,
      survivorOnly: admitted.every(
        (d) => context.players.find((p) => p.id === d.playerId)?.eligible,
      ),
      withinCapacity: admitted.length <= context.policy.seats,
      provisional: result.final === false,
      discussionRecorded:
        input.stage !== "discussion" ||
        result.conversations.some(
          (c) => c.playerId === input.playerId && c.text === input.text,
        ),
      currentRebuttalUsedForRetrieval:
        input.stage !== "discussion" || result.rag.focus === input.text,
    };
    const citations = (result.verdict.learning || []).map((item) => {
      const source = evidence.find((s) => s.id === item.sourceId);
      return {
        sourceId: item.sourceId,
        title: source?.title,
        domain: source?.domain,
        perspective: source?.perspective,
        events: item.eventSeqs.map((seq) => {
          const event = context.globalEvents.find((e) => e.seq === seq);
          return {
            seq,
            type: event?.type,
            actor: event?.actor,
            detail: event?.detail,
          };
        }),
      };
    });
    report.stages.push({
      stage: input.stage,
      playerId: input.playerId || null,
      rebuttal: input.text || null,
      durationMs: Date.now() - started,
      llm: result.llm,
      transport: { ...transport },
      persona: result.god.id,
      eligiblePlayerIds: context.players
        .filter((p) => p.eligible)
        .map((p) => p.id),
      capacity: context.policy.capacity,
      boardedPlayerIds: admitted.map((d) => d.playerId),
      retrieval: evidence.map((s) => ({
        id: s.id,
        domain: s.domain,
        perspective: s.perspective,
        match: s.match,
      })),
      citations,
      verdict: result.verdict,
      checks,
      structuralPass: Object.values(checks).every(Boolean),
      semanticReview: "required; not automatically graded",
    });
    game.judgment = result;
    return result;
  }

  console.log(
    "Running isolated six-player initial review (request 1/2). No credentials or prompts are printed.",
  );
  const initial = await runStage({ stage: "initial" });
  const survivor = initial.context.players.find((p) => p.eligible);
  if (!survivor) throw new Error("missing_survivor");
  const ownEvents = initial.context.globalEvents
    .filter((e) => e.actor === survivor.id)
    .slice(-3)
    .map((e) => e.seq);
  const rebuttal = `我是${survivor.id}。请复核我的实际事件 ${ownEvents.join("、")}；不要求把我的说法当成既定事实。我质疑只按捐赠数量排序：洪水脆弱性、保留种子救生和合作机会是否应纳入公平比较？请结合公共资源治理与韧性研究回应，同时指出文献的局限。我的保命资源不能凭空算作捐赠，也不能靠论文增加席位或让已死亡玩家登船。`;
  console.log(
    "Running one survivor discussion (request 2/2); no final judgment is requested.",
  );
  await runStage({
    stage: "discussion",
    playerId: survivor.id,
    text: rebuttal,
  });
  report.result =
    report.stages.length === 2 && report.stages.every((s) => s.structuralPass)
      ? "structural_pass_human_review_required"
      : "live_model_or_structural_failure";
} catch (error) {
  report.failure = safeFailure(error);
} finally {
  await mkdir(new URL("test-results/", root), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(redact(report), null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        result: report.result,
        requests: report.requestBudget.actual,
        stages: report.stages.map((s) => ({
          stage: s.stage,
          modelUsed: s.llm.used,
          structuralPass: s.structuralPass,
          fallbackReason: s.llm.fallbackReason,
        })),
        failure: report.failure || null,
        report: "test-results/academic-live-smoke.json",
        semanticReview: "required",
      },
      null,
      2,
    ),
  );
  process.exitCode =
    report.result === "structural_pass_human_review_required" ? 0 : 1;
}
