// Read-only accounting for explicitly supplied synthetic live-experiment runs.
// Never imports the live runner, loads env, sends HTTP, writes files, or accesses
// model text fields (stage.value, verdict, dialogue, peerReviews, prompts).
import { readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `Usage: node scripts/report-learning-live.mjs RUN_DIR [RUN_DIR ...] [--historical-requests N]
Reads report.json and checks match-<seed>-events.json existence, without reading
event archive contents or printing model text. Writes JSON summary only to stdout.
Structured attempt usage replaces (never adds to) stage-level usage. Missing
usage remains explicitly unknown. Duplicate actual seed observations remain conflicts;
the script never selects a successful retry over a failed observation.
Not-started plans are shown separately and are not counted as attempted reruns.
--historical-requests adds only an independently observed count whose original
reports cannot be recovered. Its usage, matches and success are unknown. The
caller must exclude requests already represented by supplied reports.
Identical/aliased directory inputs are warned and counted once. Unreadable or
invalid reports are reported with safe codes; exit 2 indicates such input gaps.
This is an archive/metadata check, not a new rule or academic-quality validation.
`;
const TOKEN_KEYS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
];
const CHECKS = [
  "allStagesRealModel",
  "allSurvivorsDiscussed",
  "allPlayersReviewed",
  "survivorOnly",
  "capacityRespected",
  "finalized",
];
const FAILURES = new Set([
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
  "response_truncated",
  "truncated_response",
  "response_too_large",
  "timeout",
  "request_failed",
  "request_or_validation_failed",
  "request_budget_exhausted",
  "interrupted_request_not_retried",
  "stage_validation_failed",
  "model_fallback",
  "fixture_invalid",
  "resume_config_changed",
  "not_configured",
]);
const integer = (value, maximum = 1e12) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const seedValid = (value) => integer(value, 1000020) && value > 0;
const emptyUsage = () => Object.fromEntries(TOKEN_KEYS.map((key) => [key, 0]));
const safeFailure = (value) =>
  FAILURES.has(value) ||
  (typeof value === "string" && /^http_[1-5][0-9]{2}$/.test(value))
    ? value
    : value == null
      ? null
      : "other_failure";
const stageId = (value, index) =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,6}:(?:players:reviews|player:speech:P[1-6]|god:(?:initial|final):all|god:discussion:P[1-6])$/.test(
    value,
  )
    ? value
    : `stage_${index + 1}`;
const status = (value) =>
  ["passed", "failed", "running"].includes(value) ? value : "unknown";

export function parseReportArguments(args) {
  const result = { directories: [], historicalRequests: 0 };
  let seenHistorical = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--historical-requests") {
      if (seenHistorical) throw new Error("invalid_arguments");
      seenHistorical = true;
      result.historicalRequests = Number(args[++index]);
      if (!integer(result.historicalRequests, 1e9))
        throw new Error("invalid_arguments");
    } else if (arg.startsWith("--") || !arg.trim())
      throw new Error("invalid_arguments");
    else result.directories.push(arg);
  }
  if (!result.directories.length || result.directories.length > 100)
    throw new Error("invalid_arguments");
  return result;
}

// Intentionally whitelist metric fields rather than traversing arbitrary values.
export function summarizeMetrics(report) {
  const warnings = [],
    attempts = [],
    knownUsageTotals = emptyUsage();
  let stageHttpRequests = 0,
    stageCountsKnown = true;
  for (const [index, stage] of report.stages.entries()) {
    const id = stageId(stage?.id, index);
    if (integer(stage?.requests)) stageHttpRequests += stage.requests;
    else stageCountsKnown = false;
    const records = Array.isArray(stage?.attempts) ? stage.attempts : [stage];
    let counted = 0,
      countsKnown = true;
    for (const [ordinal, record] of records.entries()) {
      const requests = integer(record?.requests) ? record.requests : null;
      if (requests == null) countsKnown = false;
      else counted += requests;
      const usage = {};
      for (const key of TOKEN_KEYS)
        if (integer(record?.usage?.[key])) {
          usage[key] = record.usage[key];
          knownUsageTotals[key] += record.usage[key];
        }
      attempts.push({
        stageId: id,
        ordinal: ordinal + 1,
        accountingSource: Array.isArray(stage?.attempts)
          ? "attempt"
          : "legacy_stage",
        status: status(record?.status),
        failure: safeFailure(record?.failure),
        requests,
        repair: Array.isArray(stage?.attempts) && ordinal > 0,
        usage: Object.keys(usage).length ? usage : null,
        completeTokenUsage:
          integer(usage.input_tokens) && integer(usage.output_tokens),
        outputTokenLimit: integer(record?.requestMaxOutputTokens, 1000000)
          ? record.requestMaxOutputTokens
          : null,
      });
    }
    if (
      Array.isArray(stage?.attempts) &&
      (!countsKnown || !integer(stage.requests) || counted !== stage.requests)
    )
      warnings.push({ code: "stage_attempt_request_mismatch", stageId: id });
  }
  const recordedHttpRequests = integer(report.requestBudget?.actual)
    ? report.requestBudget.actual
    : null;
  const attemptHttpRequests = attempts.every((item) => item.requests != null)
    ? attempts.reduce((sum, item) => sum + item.requests, 0)
    : null;
  if (
    !stageCountsKnown ||
    recordedHttpRequests == null ||
    stageHttpRequests !== recordedHttpRequests ||
    attemptHttpRequests !== recordedHttpRequests
  )
    warnings.push({ code: "request_ledger_mismatch" });
  const usageReportedResponses = attempts.filter((item) => item.usage).length;
  const completeUsageResponses = attempts.filter(
    (item) => item.completeTokenUsage && item.requests > 0,
  ).length;
  const recordedRepairReservations = report.matches.reduce(
    (sum, item) =>
      sum + (integer(item?.repairRequests) ? item.repairRequests : 0),
    0,
  );
  const repairHttpRequests = attempts.reduce(
    (sum, item) => sum + (item.repair ? item.requests || 0 : 0),
    0,
  );
  return {
    recordedHttpRequests,
    stageHttpRequests: stageCountsKnown ? stageHttpRequests : null,
    attemptHttpRequests,
    requestCountConsistent: !warnings.some((item) =>
      /request_/.test(item.code),
    ),
    knownUsageTotals,
    usageReportedResponses,
    completeUsageResponses,
    requestsWithoutCompleteUsage:
      recordedHttpRequests == null
        ? null
        : Math.max(0, recordedHttpRequests - completeUsageResponses),
    failedAttempts: attempts.filter((item) => item.status === "failed").length,
    incompleteAttempts: attempts.filter(
      (item) => !["passed", "failed"].includes(item.status),
    ).length,
    repairHttpRequests,
    recordedRepairReservations,
    attempts,
    warnings,
  };
}

function stageCompletion(report, seed, survivors) {
  if (!integer(survivors, 6)) return false;
  const relevant = report.stages.filter(
    (stage) => typeof stage?.id === "string" && stage.id.startsWith(`${seed}:`),
  );
  const required = [
    `${seed}:players:reviews`,
    `${seed}:god:initial:all`,
    `${seed}:god:final:all`,
  ];
  if (
    relevant.length !== 3 + 2 * survivors ||
    relevant.some((stage) => stage.status !== "passed")
  )
    return false;
  if (
    !required.every(
      (id) => relevant.filter((stage) => stage.id === id).length === 1,
    )
  )
    return false;
  const ids = (suffix) =>
    relevant
      .map(
        (stage) =>
          stage.id.match(new RegExp(`^${seed}:${suffix}:(P[1-6])$`))?.[1],
      )
      .filter(Boolean)
      .sort();
  const speeches = ids("player:speech"),
    replies = ids("god:discussion");
  return (
    speeches.length === survivors &&
    new Set(speeches).size === survivors &&
    JSON.stringify(speeches) === JSON.stringify(replies)
  );
}

async function archiveStatus(directory, seed) {
  try {
    const info = await lstat(path.join(directory, `match-${seed}-events.json`));
    return !info.isFile()
      ? "not_regular_file"
      : info.size > 0
        ? "present"
        : "empty";
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "unreadable";
  }
}

async function matchObservation(match, report, directory, runIndex) {
  const seed = match.seed,
    declaredStatus = status(match.status);
  const archive = await archiveStatus(directory, seed);
  const hardChecksPassed =
    CHECKS.every((key) => match.checks?.[key] === true) &&
    Object.values(match.checks || {}).every((value) => value === true);
  const stagesComplete = stageCompletion(report, seed, match.survivors);
  const reasons = [];
  if (declaredStatus === "passed") {
    if (!hardChecksPassed) reasons.push("hard_checks_missing_or_failed");
    if (!stagesComplete) reasons.push("stage_metadata_incomplete");
    if (archive !== "present") reasons.push("event_archive_unavailable");
  }
  return {
    seed,
    runIndex,
    declaredStatus,
    state:
      declaredStatus === "failed"
        ? "failed"
        : declaredStatus === "passed" && !reasons.length
          ? "verified_complete"
          : "unfinished",
    failure: safeFailure(match.failure),
    hardChecksPassed,
    stagesComplete,
    eventArchive: archive,
    reasons,
  };
}

export async function summarizeRunDirectory(directory, runIndex = 1) {
  const base = { runIndex, directory: path.resolve(directory) };
  let report;
  try {
    const filename = path.join(base.directory, "report.json");
    const info = await lstat(filename);
    if (!info.isFile() || info.size > 64 * 1024 * 1024)
      return {
        ...base,
        status: "unavailable",
        error: "report_not_regular_or_too_large",
        observations: [],
      };
    // JSON decoding necessarily reads the containing file; only whitelisted
    // metadata is accessed below. Model outputs are neither analyzed nor emitted.
    report = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    return {
      ...base,
      status: "unavailable",
      error:
        error.code === "ENOENT"
          ? "report_missing"
          : "report_unreadable_or_invalid",
      observations: [],
    };
  }
  if (
    report?.schemaVersion !== 1 ||
    !Array.isArray(report.stages) ||
    !Array.isArray(report.matches) ||
    !seedValid(report.config?.start) ||
    !integer(report.config?.matches, 20) ||
    report.config.matches < 1
  )
    return {
      ...base,
      status: "unavailable",
      error: "report_schema_invalid",
      observations: [],
    };
  const metrics = summarizeMetrics(report),
    observations = [];
  const plannedSeeds = Array.from(
    { length: report.config.matches },
    (_, index) => report.config.start + index,
  );
  for (const match of report.matches) {
    if (!seedValid(match?.seed)) {
      metrics.warnings.push({ code: "invalid_match_seed" });
      continue;
    }
    observations.push(
      await matchObservation(match, report, base.directory, runIndex),
    );
    if (!plannedSeeds.includes(match.seed))
      metrics.warnings.push({
        code: "match_seed_outside_plan",
        seed: match.seed,
      });
  }
  for (const seed of plannedSeeds)
    if (!observations.some((item) => item.seed === seed))
      observations.push({
        seed,
        runIndex,
        declaredStatus: "not_started",
        state: "unfinished",
        eventArchive: "not_checked",
        reasons: ["match_not_started"],
      });
  return {
    ...base,
    status: "available",
    runId:
      typeof report.runId === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(report.runId)
        ? report.runId
        : null,
    reportStatus: [
      "running",
      "complete",
      "complete_with_failures",
      "circuit_open",
      "paused_budget",
    ].includes(report.status)
      ? report.status
      : "unknown",
    protocol: {
      structured:
        typeof report.config.structured === "boolean"
          ? report.config.structured
          : null,
      concise:
        typeof report.config.concise === "boolean"
          ? report.config.concise
          : null,
      boardingOutputTokenLimit: integer(
        report.config.boardingOutputTokenLimit,
        8000,
      )
        ? report.config.boardingOutputTokenLimit
        : null,
    },
    plannedSeeds,
    metrics,
    observations,
    matchCounts: {
      verifiedComplete: observations.filter(
        (item) => item.state === "verified_complete",
      ).length,
      failed: observations.filter((item) => item.state === "failed").length,
      unfinished: observations.filter((item) => item.state === "unfinished")
        .length,
      declaredPassedButUnverifiable: observations.filter(
        (item) =>
          item.declaredStatus === "passed" &&
          item.state !== "verified_complete",
      ).length,
    },
  };
}

export async function summarizeRunDirectories(
  directories,
  { historicalRequests = 0 } = {},
) {
  if (
    !Array.isArray(directories) ||
    !directories.length ||
    !integer(historicalRequests, 1e9)
  )
    throw new Error("invalid_arguments");
  const runs = [],
    warnings = [],
    seen = new Set();
  for (const directory of directories) {
    let canonical = path.resolve(directory);
    try {
      canonical = await realpath(canonical);
    } catch {
      /* Missing paths remain explicit unavailable inputs. */
    }
    if (seen.has(canonical)) {
      warnings.push({
        code: "duplicate_directory_not_counted",
        directory: path.resolve(directory),
      });
      continue;
    }
    seen.add(canonical);
    runs.push(await summarizeRunDirectory(canonical, runs.length + 1));
  }
  const available = runs.filter((run) => run.status === "available"),
    cohortRows = new Map();
  const cohortRow = (seed) => {
    if (!cohortRows.has(seed))
      cohortRows.set(seed, { observations: [], plans: [] });
    return cohortRows.get(seed);
  };
  for (const run of available) {
    for (const seed of run.plannedSeeds)
      cohortRow(seed).plans.push({
        runIndex: run.runIndex,
        attempted: run.observations.some(
          (item) => item.seed === seed && item.declaredStatus !== "not_started",
        ),
      });
    for (const observation of run.observations) {
      if (observation.declaredStatus !== "not_started")
        cohortRow(observation.seed).observations.push(observation);
    }
  }
  const cohort = [...cohortRows]
    .sort(([left], [right]) => left - right)
    .map(([seed, { observations, plans }]) => ({
      seed,
      state:
        observations.length > 1
          ? "duplicate_conflict"
          : observations[0]?.state || "unfinished",
      actualObservationCount: observations.length,
      planCount: plans.length,
      plans,
      observations,
    }));
  const knownUsageTotals = emptyUsage();
  for (const run of available)
    for (const key of TOKEN_KEYS)
      knownUsageTotals[key] += run.metrics.knownUsageTotals[key];
  const knownArchivedHttpRequests = available.reduce(
    (sum, run) => sum + (run.metrics.recordedHttpRequests || 0),
    0,
  );
  const completeUsageResponses = available.reduce(
    (sum, run) => sum + run.metrics.completeUsageResponses,
    0,
  );
  const totals = {
    availableRuns: available.length,
    unavailableRuns: runs.length - available.length,
    knownArchivedHttpRequests,
    historicalRequestsWithoutArchive: historicalRequests,
    totalKnownHttpRequests: knownArchivedHttpRequests + historicalRequests,
    requestTotalsCompleteForSuppliedRuns: runs.every(
      (run) => run.status === "available" && run.metrics.requestCountConsistent,
    ),
    knownUsageTotals,
    usageReportedResponses: available.reduce(
      (sum, run) => sum + run.metrics.usageReportedResponses,
      0,
    ),
    completeUsageResponses,
    knownRequestsWithoutCompleteUsage: Math.max(
      0,
      knownArchivedHttpRequests + historicalRequests - completeUsageResponses,
    ),
    failedAttempts: available.reduce(
      (sum, run) => sum + run.metrics.failedAttempts,
      0,
    ),
    incompleteAttempts: available.reduce(
      (sum, run) => sum + run.metrics.incompleteAttempts,
      0,
    ),
    repairHttpRequests: available.reduce(
      (sum, run) => sum + run.metrics.repairHttpRequests,
      0,
    ),
    recordedRepairReservations: available.reduce(
      (sum, run) => sum + run.metrics.recordedRepairReservations,
      0,
    ),
  };
  const duplicateSeeds = cohort
    .filter((row) => row.state === "duplicate_conflict")
    .map((row) => row.seed);
  if (duplicateSeeds.length)
    warnings.push({
      code: "duplicate_seed_conflicts_no_success_selection",
      seeds: duplicateSeeds,
    });
  return {
    schemaVersion: 1,
    mode: "read_only_archive_metadata_accounting",
    runs,
    totals,
    cohort: {
      uniqueSeeds: cohort.length,
      verifiedComplete: cohort.filter(
        (row) => row.state === "verified_complete",
      ).length,
      failed: cohort.filter((row) => row.state === "failed").length,
      unfinished: cohort.filter((row) => row.state === "unfinished").length,
      duplicateSeeds,
      allVerifiablyComplete:
        cohort.length > 0 &&
        cohort.every((row) => row.state === "verified_complete") &&
        totals.unavailableRuns === 0 &&
        totals.requestTotalsCompleteForSuppliedRuns,
      seeds: cohort,
    },
    historical: {
      requests: historicalRequests,
      provenance:
        "caller_supplied_observed_requests_without_recoverable_original_reports",
      originalReportsAvailable: false,
      usage: null,
      matches: null,
      successes: null,
      overlapWithSuppliedReportsIndependentlyVerified: false,
    },
    warnings,
    limitations: [
      "Only explicitly supplied report metadata and event-archive existence are checked; model text and event contents are not inspected. This does not revalidate academic interpretation or establish human learning gains.",
      "Known token totals include only recorded response usage. Missing fields and historical usage are unknown, never estimated.",
      "Historical requests must exclude supplied archives. No match, source, usage, or successful completion is invented for missing original reports.",
      "Two or more actual observations of a seed are an unresolved cohort conflict, including failed or running matches. Not-started plans remain visible but are not attempted reruns. Counts never select the more favorable observation.",
      "Counters record reserved HTTP attempts, including interrupted requests; they are not an independently verified billing invoice.",
    ],
  };
}

export async function main(
  args = process.argv.slice(2),
  { print = (value) => process.stdout.write(value + "\n") } = {},
) {
  const options = parseReportArguments(args);
  if (options.help) {
    print(HELP);
    return 0;
  }
  const report = await summarizeRunDirectories(options.directories, options);
  print(JSON.stringify(report, null, 2));
  return report.totals.unavailableRuns ? 2 : 0;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write("[live-report] invalid_arguments_or_read_failure\n");
      process.exitCode = 1;
    });
