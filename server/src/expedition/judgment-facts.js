// Deterministic reading aid for the council. This is not a score or a verdict.
// Only frozen context data is used; never fetch newer game state or interpret
// action.effects/equipment snapshots as a card use or a personal donation.
export const JUDGMENT_FACTS_VERSION = "boarding-facts-v1";
const RESOURCES = ["wood", "metal", "electricity", "seed"];
const ATTRIBUTES = ["economy", "environment", "society"];
const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);
const chronological = (a, b) =>
  (a.round ?? 0) - (b.round ?? 0) || a.seq - b.seq;
const fields = (event, names) =>
  Object.fromEntries(
    ["seq", "round", "actor", ...names]
      .filter((name) => event[name] !== undefined)
      .map((name) => [name, clone(event[name])]),
  );
const resourceAmounts = (amounts) =>
  amounts &&
  Object.fromEntries(
    RESOURCES.map((resource) => [resource, amounts[resource] ?? 0]),
  );
function actualDelta(event) {
  if (event.applied) return clone(event.applied);
  if (
    ATTRIBUTES.every(
      (attribute) =>
        Number.isFinite(event.before?.[attribute]) &&
        Number.isFinite(event.after?.[attribute]),
    )
  )
    return Object.fromEntries(
      ATTRIBUTES.map((attribute) => [
        attribute,
        event.after[attribute] - event.before[attribute],
      ]),
    );
  return null; // Missing old evidence must not be invented from requested delta.
}
function worldChange(event) {
  return {
    ...fields(event, ["source"]),
    requestedDelta: clone(event.requested) ?? null,
    actualDelta: actualDelta(event),
  };
}

export function buildJudgmentFacts(context) {
  const events = [...context.globalEvents].sort(chronological);
  const playerIds = new Set(context.players.map((player) => player.id));
  return {
    version: JUDGMENT_FACTS_VERSION,
    basis:
      "仅由本次冻结 context.players 与 context.globalEvents 确定性提取；不使用当前可变游戏状态。",
    interpretation: {
      donatedTotals:
        "权威累计值来自玩家 donated；共享补给、收到邀约资源和持有物资不是向方舟捐赠。",
      technology:
        "只按 type=technology 的事件计次；world_change 是同次使用造成的变化，不再次计数；action/equipment 不作为使用证据。",
      worldChanges:
        "actualDelta 是真实应用值，可能因1—19上下限不同于 requestedDelta；系统灾难影响不归到个人。",
      cooperation:
        "invitation_accept/trade_accept 的 actor 为发起人、targetId 为受邀人；双方均参与一次合作，邀约不是交换。",
      chronology:
        "按 round、seq 排序；同一张卡只出现一次不可描述为多次；比较其他玩家须明确其 playerId。",
      scope:
        "事实表不决定公平排序，不验证自然语言推论；完整原始 globalEvents 保留供复核。",
    },
    globalFloodEvents: events
      .filter((event) => event.type === "flood")
      .map((event) =>
        fields(event, [
          "detail",
          "die",
          "resource",
          "requested",
          "actual",
          "zone",
        ]),
      ),
    systemWorldChanges: events
      .filter(
        (event) => event.type === "world_change" && !playerIds.has(event.actor),
      )
      .map(worldChange),
    players: context.players.map((player) => {
      const own = events.filter((event) => event.actor === player.id);
      const technologyUses = own
        .filter((event) => event.type === "technology")
        .map((event) => fields(event, ["cardId", "detail"]));
      const counts = new Map();
      for (const use of technologyUses) {
        if (typeof use.cardId !== "string") continue;
        counts.set(use.cardId, (counts.get(use.cardId) || 0) + 1);
      }
      const cooperationEvents = events
        .filter(
          (event) =>
            ["invitation_accept", "trade_accept"].includes(event.type) &&
            (event.actor === player.id || event.targetId === player.id),
        )
        .map((event) => ({
          ...fields(event, [
            "type",
            "targetId",
            "ownerResource",
            "recipientResource",
            "give",
            "receive",
          ]),
          role: event.actor === player.id ? "initiator" : "recipient",
          counterpartyId:
            event.actor === player.id ? event.targetId : event.actor,
        }));
      const donatedTotals = resourceAmounts(player.donated) ?? null;
      return {
        playerId: player.id,
        donatedTotals,
        donatedTotalUnits: donatedTotals
          ? Object.values(donatedTotals).reduce(
              (sum, amount) => sum + amount,
              0,
            )
          : null,
        donationEvents: own
          .filter((event) => event.type === "donation")
          .map((event) => ({
            ...fields(event, []),
            recordedPlayerId: event.donation?.playerId ?? event.actor,
            amounts: resourceAmounts(event.donation?.amounts) ?? null,
          })),
        technologyUseCount: technologyUses.length,
        technologyCounts: Object.fromEntries(counts),
        technologyUses,
        worldImpactTotals: clone(player.worldImpact) ?? null,
        worldChanges: own
          .filter((event) => event.type === "world_change")
          .map(worldChange),
        cooperationCount: cooperationEvents.length,
        cooperationPartners: [
          ...new Set(
            cooperationEvents
              .map((event) => event.counterpartyId)
              .filter(Boolean),
          ),
        ],
        cooperationEvents,
        publicSupplyEvents: own
          .filter((event) => event.type === "supply_pool")
          .map((event) => fields(event, ["pool"])),
        floodPayments: own
          .filter((event) => event.type === "flood_payment")
          .map((event) =>
            fields(event, ["lost", "injury", "requested", "protected"]),
          ),
        evacuationEvents: own
          .filter((event) => event.type === "evacuate")
          .map((event) => fields(event, ["path"])),
        survival: clone(player.survival) ?? null,
        eligible: player.eligible ?? null,
        survivalEvents: own
          .filter((event) => event.type === "survival")
          .map((event) =>
            fields(event, [
              "alive",
              "safe",
              "injury",
              "seedsUsed",
              "remainingInjury",
              "tolerance",
              "reason",
            ]),
          ),
      };
    }),
  };
}

export function withJudgmentFacts(context) {
  if (context.facts?.version === JUDGMENT_FACTS_VERSION) return context;
  // Do not mutate a saved context/history entry. Old saves receive a new view
  // built from their frozen evidence, not from a possibly changed current game.
  return { ...context, facts: buildJudgmentFacts(context) };
}
