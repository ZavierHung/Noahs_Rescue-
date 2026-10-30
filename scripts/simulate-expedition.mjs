import { simulate } from "../server/src/expedition/simulation.js";
import {
  createBoardingJudge,
  fallbackBoarding,
} from "../server/src/expedition/judgment.js";
import { createGodRepository } from "../server/src/god-repository.js";
import { createAcademicRetriever } from "../server/src/academic/retriever.js";
import { fileURLToPath } from "node:url";
import { createExpeditionService } from "../server/src/expedition/service.js";
import { localLearning } from "../server/src/academic/learning.js";
import { isDeepStrictEqual } from "node:util";
const args = process.argv.slice(2);
const learningMode = args.includes("--learning");
const countArgs = args.filter((value) => value !== "--learning");
const count = Number(countArgs[0] || 20);
if (
  countArgs.length > 1 ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 500
)
  throw new Error("usage: simulate-expedition.mjs [1—500] [--learning]");
const data = fileURLToPath(new URL("../server/data/", import.meta.url));
const promptChecks = [];
let expectedPeerReviews = [];
const judge = createBoardingJudge({
  godRepository: createGodRepository(data),
  retriever: await createAcademicRetriever(),
  random: () => 0,
  ...(learningMode
    ? {
        // An in-process contract probe, NOT an LLM. It receives the same role prompt
        // and evidence object as an adapter, then returns the existing local rules.
        verdictModel: {
          enabled: true,
          model: "offline-rule-contract-probe",
          async generateBoarding(input) {
            promptChecks.push({
              stage: input.stage,
              passed:
                isDeepStrictEqual(
                  input.context.peerReviews.submissions,
                  expectedPeerReviews,
                ) &&
                input.context.peerReviews.trust ===
                  "unverified_player_opinions" &&
                input.context.peerReviews.complete === true &&
                input.rolePrompt.includes("不能按评分均值") &&
                input.rolePrompt.includes("未生存者可以评价同伴"),
            });
            return {
              ...fallbackBoarding(input.context, input.god),
              learning: localLearning(input.evidence, input.context),
            };
          },
        },
      }
    : {}),
});
let commands = 0,
  events = 0,
  donations = 0,
  conversations = 0,
  peerReviews = 0,
  peerReviewEntries = 0,
  waivers = 0,
  survivorCount = 0,
  boardedCount = 0,
  playerCount = 0;
const matches = [];
function assertBoarding(reviewed) {
  const context = reviewed.judgment.context;
  const decisions = reviewed.judgment.verdict.decisions;
  if (
    decisions.filter((decision) => decision.board).length >
      context.policy.seats ||
    decisions.some(
      (decision) =>
        decision.board &&
        !context.players.find((player) => player.id === decision.playerId)
          ?.eligible,
    )
  )
    throw new Error("boarding violated physical eligibility or capacity");
}
for (let seed = 1; seed <= count; seed++) {
  const result = simulate({
    seed,
    players: learningMode ? 6 : (seed % 6) + 1,
    learningMode,
  });
  let memory = { schemaVersion: 1, games: [result.game] };
  const store = {
    read: async () => structuredClone(memory),
    write: async (_name, value) => {
      memory = structuredClone(value);
    },
  };
  const service = createExpeditionService({ store, judge });
  let reviewed = await service.get(result.game.id);
  if (learningMode) {
    while (!reviewed.peerReviewSummary.complete) {
      const actor = reviewed.peerReviewSummary.activeReviewerId;
      const actorIndex = reviewed.players.findIndex(
        (player) => player.id === actor,
      );
      const waive = (seed + actorIndex) % 2 === 0;
      const target =
        reviewed.players[(actorIndex + 1) % reviewed.players.length];
      const event = [...reviewed.events]
        .reverse()
        .find(
          (event) =>
            event.actor === target.id &&
            !["peer_review", "discussion", "judge", "finalize"].includes(
              event.type,
            ),
        );
      if (!waive && !event)
        throw new Error("review fixture has no real target event");
      reviewed = await service.action(result.game.id, {
        type: "peer_review",
        actor,
        revision: reviewed.revision,
        ...(waive
          ? { waive: true }
          : {
              entries: [
                {
                  targetId: target.id,
                  rating: 3,
                  comment: `机器人程序化测试意见（非真实学生反馈）：我引用 ${target.id} 的真实事件 #${event.seq}「${event.detail || event.type}」，3分只是测试评分，不代表事实认定或席位资格。`,
                  evidence: [event.seq],
                },
              ],
            }),
      });
    }
    expectedPeerReviews = structuredClone(
      reviewed.peerReviewSummary.submissions,
    );
    peerReviews += expectedPeerReviews.filter((entry) => !entry.waived).length;
    waivers += expectedPeerReviews.filter((entry) => entry.waived).length;
    peerReviewEntries += expectedPeerReviews.reduce(
      (sum, entry) => sum + entry.entries.length,
      0,
    );
  }
  reviewed = await service.action(result.game.id, {
    type: "judge",
    revision: reviewed.revision,
  });
  assertBoarding(reviewed);
  while (reviewed.reviewRemaining.length) {
    reviewed = await service.action(result.game.id, {
      type: "discuss",
      actor: reviewed.activePlayerId,
      revision: reviewed.revision,
      text: learningMode
        ? "机器人程序化反思：请按真实日志核对我的捐赠、合作和环境成本。若重来，我会比较自救储备与共同物资；这不是已经证明的学习成效。"
        : "请按真实日志核对我的捐赠、合作和伤害记录。",
    });
    assertBoarding(reviewed);
  }
  reviewed = await service.action(result.game.id, {
    type: "finalize",
    revision: reviewed.revision,
  });
  assertBoarding(reviewed);
  const judgment = reviewed.judgment;
  if (reviewed.status !== "finished" || !judgment.final)
    throw Error("council did not finalize");
  conversations += judgment.conversations.length;
  if (learningMode) {
    if (
      !isDeepStrictEqual(
        judgment.context.peerReviews.submissions,
        expectedPeerReviews,
      ) ||
      judgment.llm.model !== "offline-rule-contract-probe" ||
      !judgment.llm.used ||
      !reviewed.learningOutcome?.boarding.final
    )
      throw new Error("learning council contract did not complete");
    const survivors = judgment.context.players.filter(
      (player) => player.eligible,
    ).length;
    const boarded = judgment.verdict.decisions.filter(
      (decision) => decision.board,
    ).length;
    survivorCount += survivors;
    boardedCount += boarded;
    playerCount += reviewed.players.length;
    matches.push({
      seed,
      players: reviewed.players.length,
      survivors,
      seats: reviewed.capacity.seats,
      boarded,
      reviews: expectedPeerReviews.filter((entry) => !entry.waived).length,
      waivers: expectedPeerReviews.filter((entry) => entry.waived).length,
      discussions: judgment.conversations.length,
      outcome: reviewed.learningOutcome.tier,
    });
  }
  if (
    result.game.round !== 8 ||
    result.game.events.filter((e) => e.type === "flood").length !== 3
  )
    throw new Error("round/flood schedule invalid");
  if (judgment.verdict.decisions.length !== result.game.players.length)
    throw new Error("incomplete boarding verdict");
  commands += result.commands;
  events += result.game.events.length;
  donations += result.game.donations.length;
}
if (
  learningMode &&
  (promptChecks.length !== conversations + count * 2 ||
    promptChecks.some((check) => !check.passed))
)
  throw new Error(
    "peer opinions or trust boundary missing from a model-interface prompt",
  );
console.log(
  JSON.stringify(
    {
      matches: count,
      roundsPerMatch: 8,
      commands,
      events,
      donations,
      conversations,
      council: learningMode
        ? "every player reviews or explicitly waives → initial → every survivor discusses → final; real service with memory-only JSON store"
        : "initial → every survivor discusses → final; real service with memory-only JSON store",
      mode: "isolated deterministic simulation; no LLM/API key or live save access",
      ...(learningMode
        ? {
            learningMode: true,
            playersPerMatch: 6,
            policy: "balanced deterministic bot; seeds 1 through matches",
            peerReviews,
            peerReviewEntries,
            waivers,
            promptContractChecks: promptChecks.length,
            testAdapter:
              "offline-rule-contract-probe; llm.used is an adapter-contract marker only, NOT a real model call",
            realLLMCalls: 0,
            observations:
              "All comments, scores, and reflections are procedural bot fixtures, not real student feedback or evidence of learning effectiveness.",
            survivors: survivorCount,
            boarded: boardedCount,
            survivalRate: survivorCount / playerCount,
            boardingRate: boardedCount / playerCount,
            matchResults: matches,
          }
        : {}),
      result: "passed",
    },
    null,
    2,
  ),
);
