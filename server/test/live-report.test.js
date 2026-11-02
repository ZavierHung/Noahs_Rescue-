import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  main,
  parseReportArguments,
  summarizeMetrics,
  summarizeRunDirectories,
} from "../../scripts/report-learning-live.mjs";

// Synthetic fixtures only. No real report, game save, env, LLM or network.
const SECRET = "PRIVATE_MODEL_TEXT_MUST_NOT_APPEAR_IN_METRICS";
const checks = {
  allStagesRealModel: true,
  allSurvivorsDiscussed: true,
  allPlayersReviewed: true,
  survivorOnly: true,
  capacityRespected: true,
  finalized: true,
};
function fixture(
  seed = 2001,
  { structured = true, repair = true, matchStatus = "passed" } = {},
) {
  const ids = [
    "players:reviews",
    "god:initial:all",
    "player:speech:P1",
    "god:discussion:P1",
    "god:final:all",
  ];
  const stages = ids.map((suffix, index) => {
    const requests = structured && repair && index === 0 ? 2 : 1;
    const row = {
      id: `${seed}:${suffix}`,
      status: "passed",
      requests,
      usage: {
        input_tokens: structured ? 99999 : 7,
        output_tokens: structured ? 99999 : 3,
      },
      value: { text: SECRET },
    };
    if (structured)
      row.attempts = Array.from({ length: requests }, (_, attempt) => ({
        status: attempt === requests - 1 ? "passed" : "failed",
        failure: attempt === requests - 1 ? null : "invalid_peer_reviews",
        requests: 1,
        usage: { input_tokens: 7, output_tokens: 3 },
        requestMaxOutputTokens: 6000,
      }));
    return row;
  });
  return {
    schemaVersion: 1,
    runId: `fixture-${seed}`,
    status: "complete",
    config: {
      start: seed,
      matches: 1,
      structured,
      boardingOutputTokenLimit: 6000,
    },
    stages,
    requestBudget: {
      actual: stages.reduce((sum, stage) => sum + stage.requests, 0),
    },
    matches: [
      {
        seed,
        status: matchStatus,
        survivors: 1,
        repairRequests: structured && repair ? 1 : 0,
        checks: { ...checks },
        verdict: SECRET,
        dialogue: SECRET,
        peerReviews: SECRET,
      },
    ],
    summary: { paidHttpRequests: 999999, usage: { input_tokens: 999999 } },
  };
}
async function save(parent, name, report, { archive = true } = {}) {
  const directory = path.join(parent, name);
  await mkdir(directory);
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report));
  if (archive)
    for (const match of report.matches)
      await writeFile(
        path.join(directory, `match-${match.seed}-events.json`),
        JSON.stringify({
          seed: match.seed,
          events: [{ seq: 1, detail: SECRET }],
        }),
      );
  return directory;
}

test("report CLI accepts explicit directories/history and rejects malformed counts or unknown switches", () => {
  assert.deepEqual(
    parseReportArguments(["run-a", "run-b", "--historical-requests", "27"]),
    { directories: ["run-a", "run-b"], historicalRequests: 27 },
  );
  assert.deepEqual(parseReportArguments(["--help"]), { help: true });
  for (const args of [
    [],
    ["--historical-requests", "27"],
    ["run", "--historical-requests", "-1"],
    ["run", "--historical-requests", "1.5"],
    ["run", "--historical-requests", SECRET],
    ["run", "--historical-requests"],
    ["run", "--live"],
    ["run", "--historical-requests", "1", "--historical-requests", "2"],
  ])
    assert.throws(() => parseReportArguments(args), /invalid_arguments/);
});

test("structured attempt tokens replace stage/summary totals; legacy usage and unknown history stay separate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noah-report-test-"));
  const first = await save(root, "structured", fixture());
  const second = await save(
    root,
    "legacy",
    fixture(2002, { structured: false }),
  );
  const before = await readFile(path.join(first, "report.json"), "utf8");
  const filesBefore = await readdir(first);
  const result = await summarizeRunDirectories([first, second], {
    historicalRequests: 27,
  });
  assert.equal(result.runs[0].metrics.attempts.length, 6);
  assert.equal(result.runs[0].metrics.knownUsageTotals.input_tokens, 42);
  assert.equal(result.runs[0].metrics.failedAttempts, 1);
  assert.equal(result.runs[0].metrics.repairHttpRequests, 1);
  assert.equal(result.runs[0].metrics.recordedRepairReservations, 1);
  assert.equal(result.totals.knownArchivedHttpRequests, 11);
  assert.equal(result.totals.totalKnownHttpRequests, 38);
  assert.equal(result.totals.knownUsageTotals.input_tokens, 77);
  assert.equal(result.totals.knownUsageTotals.output_tokens, 33);
  assert.equal(result.totals.knownRequestsWithoutCompleteUsage, 27);
  assert.equal(result.totals.requestTotalsCompleteForSuppliedRuns, true);
  assert.equal(result.cohort.verifiedComplete, 2);
  assert.equal(result.cohort.allVerifiablyComplete, true);
  assert.equal(result.historical.originalReportsAvailable, false);
  assert.equal(result.historical.usage, null);
  assert.equal(result.historical.matches, null);
  assert.equal(result.historical.successes, null);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  assert.equal(await readFile(path.join(first, "report.json"), "utf8"), before);
  assert.deepEqual(await readdir(first), filesBefore);
});

test("complete success requires hard checks, full stage metadata and the original event archive", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "noah-report-evidence-test-"),
  );
  const missing = await save(root, "missing-archive", fixture(), {
    archive: false,
  });
  const badChecks = fixture(2002);
  badChecks.matches[0].checks.capacityRespected = false;
  const incompleteStages = fixture(2003);
  incompleteStages.stages.pop();
  const failed = fixture(2004, { matchStatus: "failed" });
  const result = await summarizeRunDirectories([
    missing,
    await save(root, "bad-checks", badChecks),
    await save(root, "missing-final", incompleteStages),
    await save(root, "failed", failed),
  ]);
  assert.equal(result.cohort.verifiedComplete, 0);
  assert.equal(result.cohort.unfinished, 3);
  assert.equal(result.cohort.failed, 1);
  assert.equal(result.cohort.allVerifiablyComplete, false);
  assert.equal(result.runs[0].observations[0].eventArchive, "missing");
  assert.deepEqual(result.runs[0].observations[0].reasons, [
    "event_archive_unavailable",
  ]);
  assert.ok(
    result.runs[1].observations[0].reasons.includes(
      "hard_checks_missing_or_failed",
    ),
  );
  assert.ok(
    result.runs[2].observations[0].reasons.includes(
      "stage_metadata_incomplete",
    ),
  );
  assert.equal(
    result.runs[3].observations[0].state,
    "failed",
    "a failed match can never become success from positive checks",
  );
});

test("duplicate seeds retain conflicting observations and never select a favorable retry", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "noah-report-duplicates-test-"),
  );
  const first = await save(root, "first", fixture());
  const retry = fixture(2001, { matchStatus: "failed" });
  retry.runId = "separate-retry";
  const result = await summarizeRunDirectories([
    first,
    await save(root, "second", retry),
  ]);
  assert.equal(result.totals.knownArchivedHttpRequests, 12);
  assert.equal(result.cohort.uniqueSeeds, 1);
  assert.deepEqual(result.cohort.duplicateSeeds, [2001]);
  assert.equal(result.cohort.seeds[0].state, "duplicate_conflict");
  assert.equal(result.cohort.seeds[0].observations.length, 2);
  assert.equal(result.cohort.verifiedComplete, 0);
  assert.equal(result.cohort.failed, 0);
  assert.equal(result.cohort.allVerifiablyComplete, false);
  assert.ok(
    result.warnings.some(
      (warning) =>
        warning.code === "duplicate_seed_conflicts_no_success_selection",
    ),
  );
  const alias = await summarizeRunDirectories([first, path.join(first, ".")]);
  assert.equal(alias.runs.length, 1);
  assert.equal(alias.totals.knownArchivedHttpRequests, 6);
  assert.ok(
    alias.warnings.some(
      (warning) => warning.code === "duplicate_directory_not_counted",
    ),
  );
});

test("unstarted planned seeds and missing reports are explicit gaps, not invented matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noah-report-gaps-test-"));
  const report = fixture();
  report.config.matches = 3;
  const directory = await save(root, "part-finished", report);
  const result = await summarizeRunDirectories(
    [directory, path.join(root, "deleted")],
    { historicalRequests: 27 },
  );
  assert.equal(result.cohort.uniqueSeeds, 3);
  assert.equal(result.cohort.verifiedComplete, 1);
  assert.equal(result.cohort.unfinished, 2);
  assert.equal(result.totals.unavailableRuns, 1);
  assert.equal(result.totals.totalKnownHttpRequests, 33);
  assert.equal(result.totals.requestTotalsCompleteForSuppliedRuns, false);
  assert.equal(result.cohort.allVerifiablyComplete, false);
  assert.equal(result.runs[1].error, "report_missing");
  const lines = [];
  assert.equal(
    await main([directory, path.join(root, "deleted")], {
      print: (line) => lines.push(line),
    }),
    2,
  );
  assert.equal(JSON.parse(lines[0]).cohort.unfinished, 2);
});

test("unstarted old plans do not create a duplicate attempt but remain visible alongside a new real observation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noah-report-plans-test-"));
  const oldPlan = fixture(2004);
  oldPlan.runId = "old-unstarted-plan";
  oldPlan.matches = [];
  oldPlan.stages = [];
  oldPlan.requestBudget.actual = 0;
  const planned = await save(root, "old-plan", oldPlan, { archive: false });
  const actual = await save(root, "new-actual", fixture(2004));
  const result = await summarizeRunDirectories([planned, actual]);
  const row = result.cohort.seeds[0];
  assert.equal(result.cohort.uniqueSeeds, 1);
  assert.equal(result.cohort.verifiedComplete, 1);
  assert.deepEqual(result.cohort.duplicateSeeds, []);
  assert.equal(row.state, "verified_complete");
  assert.equal(row.actualObservationCount, 1);
  assert.equal(row.observations.length, 1);
  assert.equal(row.planCount, 2);
  assert.deepEqual(
    row.plans.map((plan) => plan.attempted),
    [false, true],
  );
  assert.equal(result.totals.knownArchivedHttpRequests, 6);
  const plansOnly = await summarizeRunDirectories([planned]);
  assert.equal(plansOnly.cohort.seeds[0].state, "unfinished");
  assert.equal(plansOnly.cohort.seeds[0].actualObservationCount, 0);
  assert.equal(plansOnly.cohort.seeds[0].planCount, 1);
  const running = fixture(2004, { matchStatus: "running" });
  running.runId = "separate-running-attempt";
  const conflict = await summarizeRunDirectories([
    planned,
    actual,
    await save(root, "running", running),
  ]);
  assert.deepEqual(conflict.cohort.duplicateSeeds, [2004]);
  assert.equal(conflict.cohort.verifiedComplete, 0);
  assert.equal(conflict.cohort.seeds[0].actualObservationCount, 2);
  assert.equal(conflict.cohort.seeds[0].planCount, 3);
  assert.deepEqual(
    conflict.cohort.seeds[0].observations.map((item) => item.declaredStatus),
    ["passed", "running"],
  );
});

test("safe malformed reports and metadata failures never disclose provider/model text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noah-report-safe-test-"));
  const bad = await save(root, "bad", fixture());
  await writeFile(path.join(bad, "report.json"), `{unparseable:${SECRET}`);
  const result = await summarizeRunDirectories([bad]);
  assert.equal(result.runs[0].error, "report_unreadable_or_invalid");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  const report = fixture();
  Object.defineProperty(report.stages[0], "value", {
    get() {
      throw new Error("must not access model text");
    },
  });
  Object.defineProperty(report.matches[0], "verdict", {
    get() {
      throw new Error("must not access verdict");
    },
  });
  report.stages[0].attempts[0].failure = SECRET;
  const metrics = summarizeMetrics(report);
  assert.equal(metrics.attempts[0].failure, "other_failure");
  assert.doesNotMatch(JSON.stringify(metrics), new RegExp(SECRET));
});

test("missing usage and interrupted attempts remain unknown without falling back to duplicate stage usage", async () => {
  const report = fixture();
  delete report.stages[0].attempts[0].usage;
  report.stages[0].attempts[0].status = "running";
  const metrics = summarizeMetrics(report);
  assert.equal(metrics.knownUsageTotals.input_tokens, 35);
  assert.equal(metrics.requestsWithoutCompleteUsage, 1);
  assert.equal(metrics.incompleteAttempts, 1);
  assert.equal(metrics.attempts[0].usage, null);
  report.requestBudget.actual++;
  assert.equal(summarizeMetrics(report).requestCountConsistent, false);
  assert.ok(
    summarizeMetrics(report).warnings.some(
      (warning) => warning.code === "request_ledger_mismatch",
    ),
  );
});
