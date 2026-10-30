import { arkCapacity, survivalState } from "./rules.js";
import { buildJudgmentFacts } from "./judgment-facts.js";

export const LEARNING_OUTCOME_VERSION = "learning-outcome-v1";

// A transparent learning scorecard, not a second moral ranking. The rule-based
// challenges never grant a seat and a popular peer rating never changes them.
export function buildLearningOutcome(game) {
  if (game.status === "playing") return null;
  const capacity = arkCapacity(game);
  const players = game.players.map((player) => ({
    ...player,
    survival: survivalState(game, player),
    eligible: survivalState(game, player).alive,
  }));
  const facts = buildJudgmentFacts({ players, globalEvents: game.events });
  const survivors = players.filter((player) => player.eligible).length;
  const survivalRate = survivors / players.length;
  const changes = facts.players.flatMap((player) => player.worldChanges);
  const repairActions = changes.filter(
    (event) => event.actualDelta?.environment > 0,
  ).length;
  const damageActions = changes.filter(
    (event) => event.actualDelta?.environment < 0,
  ).length;
  const playerNetChange = changes.reduce(
    (sum, event) => sum + (event.actualDelta?.environment || 0),
    0,
  );
  const manualAdjustments = game.events.filter(
    (event) => event.type === "world_manual",
  ).length;
  const unknownChanges = changes.some((event) => event.actualDelta === null);
  const ecologyAssessable = !manualAdjustments && !unknownChanges;
  const goals = [
    {
      id: "collective_survival",
      title: "共同守护",
      achieved: survivalRate >= 0.8,
      detail: `${survivors}/${players.length} 人生存；练习目标为至少 80%，死亡不等于品德判断。`,
    },
    {
      id: "shared_provision",
      title: "公共保障",
      achieved: capacity.seats / players.length >= 0.5,
      detail: `共同物资提供 ${capacity.seats} 个席位；练习目标为覆盖至少半数初始玩家，不代表席位已分配。`,
    },
    {
      id: "ecological_responsibility",
      title: "生态责任",
      achieved: ecologyAssessable ? playerNetChange >= 0 : null,
      detail: !ecologyAssessable
        ? "本局有手动世界调节或缺失变化证据，生态目标不评定；保留实际行为供讨论。"
        : `玩家实际环境净影响 ${playerNetChange >= 0 ? "+" : ""}${playerNetChange}；练习目标为不把净环境成本留给共同体，不把系统灾难归罪于个人。`,
    },
  ];
  const achieved = goals.filter((goal) => goal.achieved === true).length;
  const tier =
    achieved === goals.length
      ? "shared_resilience"
      : achieved > 0
        ? "partial_progress"
        : "review_required";
  const decisions = game.judgment?.verdict?.decisions || [];
  const submissions = game.peerReview?.submissions || [];
  return {
    version: LEARNING_OUTCOME_VERSION,
    tier,
    title:
      tier === "shared_resilience"
        ? "共同韧性航程"
        : tier === "partial_progress"
          ? "有收获，仍有取舍"
          : "复盘，再次启航",
    goals,
    collective: { survivors, total: players.length, survivalRate },
    ark: {
      seats: capacity.seats,
      units: capacity.units,
      unitsPerSeat: capacity.unitsPerSeat,
      canAccommodateSurvivors: survivors > 0 && capacity.seats >= survivors,
    },
    ecology: {
      environment: game.attributes.environment,
      playerNetChange,
      repairActions,
      damageActions,
      manualAdjustments,
    },
    personal: facts.players.map((player) => {
      const negative = player.worldChanges.find(
        (event) => event.actualDelta?.environment < 0,
      );
      const submission = submissions.find(
        (entry) => entry.reviewerId === player.playerId,
      );
      return {
        playerId: player.playerId,
        survived: player.eligible,
        boarded: game.judgment?.final
          ? decisions.some(
              (decision) =>
                decision.playerId === player.playerId && decision.board,
            )
          : null,
        donatedUnits: player.donatedTotalUnits,
        cooperationCount: player.cooperationCount,
        repairActions: player.worldChanges.filter(
          (event) => event.actualDelta?.environment > 0,
        ).length,
        repairedAfterHarm:
          !!negative &&
          player.worldChanges.some(
            (event) =>
              event.seq > negative.seq && event.actualDelta?.environment > 0,
          ),
        peerReviewSubmitted: !!submission,
        peerReviewWaived: submission?.waived || false,
        discussionSubmitted: !!game.judgment?.conversations?.some(
          (entry) => entry.playerId === player.playerId && !entry.waived,
        ),
      };
    }),
    boarding: {
      final: game.judgment?.final === true,
      decided: decisions.length > 0,
      boardedIds: decisions
        .filter((decision) => decision.board)
        .map((decision) => decision.playerId),
      source: !game.judgment
        ? "pending"
        : game.judgment.llm?.used
          ? "ai"
          : "rules_fallback",
    },
    disclaimer:
      "三项目标是本游戏的讨论约定，不是科学阈值、道德排名或学习成效证明。登船是另一项受生存与容量约束的决定；未登船不代表个人没有价值。修复尝试与提交反思只是可核对行为，不自动证明理解或弥补全部伤害。",
  };
}
