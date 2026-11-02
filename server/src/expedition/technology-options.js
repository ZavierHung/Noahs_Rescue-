// Read-only UI capabilities, shared with command validation where applicable.
// Never draws cards, consumes RNG, applies effects, or changes an existing save.
import { CARDS } from "./catalog.js";
import { tileById, distance } from "./map.js";
import { handLimit } from "./world.js";
import { rulesFor } from "./rules.js";
import { sum } from "./runtime.js";

export const PASSIVE_TECHNOLOGIES = new Set([
  "space-ring",
  "skateboard-shoes",
  "mining-drone",
  "reserve-crate",
  "aid-beacon",
  "famed-blade",
]);
export const inContact = (a, b) =>
  !!a &&
  !!b &&
  a.id !== b.id &&
  distance(tileById(a.position), tileById(b.position)) <= 1;

export function clawTargetReason(player, target) {
  if (!inContact(player, target)) return "机械爪需要同格或相邻玩家";
  if (player.roundFlags.noConflictWith.includes(target.id))
    return "本回合已与此玩家互助，不能争夺";
  return "";
}

export function beaconBlockedReason(game, player) {
  if (!player.equipment.includes("aid-beacon")) return "尚未部署互助信标";
  if (player.roundFlags.beacon) return "本回合已完成一次交换，下回合恢复";
  if (game.status !== "playing") return "航程已结束，不能再交换";
  if (game.pending) return "请先完成当前卡牌或洪水结算";
  if (!["cards", "move", "gather", "donate"].includes(game.phase))
    return "当前步骤不能发起交换";
  if (!sum(player.resources)) return "你没有可交换物资，请先采集";
  const nearby = game.players.filter((other) => inContact(player, other));
  if (!nearby.length) return "附近没有玩家：先移动到他人同格或相邻一格";
  if (!nearby.some((other) => sum(other.resources)))
    return "附近玩家没有可交换物资，双方需各有一份";
  return "";
}

export function technologyOptions(game, player) {
  const choices =
    game.pending?.kind === "technology"
      ? game.pending.choices.map((id) => {
          const duplicate =
            PASSIVE_TECHNOLOGIES.has(id) && player.equipment.includes(id);
          const targets =
            id === "recycling-claw"
              ? game.players
                  .filter((other) => other.id !== player.id)
                  .map((other) => ({
                    playerId: other.id,
                    reason: clawTargetReason(player, other),
                    empty: !sum(other.resources),
                  }))
              : [];
          let blockedReason = "",
            warning = "";
          if (id === "alchemy-furnace" && sum(player.resources) < 2)
            blockedReason = "炼金炉需要至少两份现有资源；可选择另一张或放弃";
          if (
            id === "recycling-claw" &&
            !targets.some((target) => !target.reason)
          )
            blockedReason = "没有可争夺的同格或相邻玩家；可选择另一张或放弃";
          if (duplicate) warning = "已部署：重复选择不叠加，也不再改变世界分数";
          else if (id === "ruins-blueprint" && !game.discard.length)
            warning = "弃牌堆为空：没有可回收手牌，仍结算本牌世界变化";
          else if (
            ["ruins-blueprint", "rapid-prototyper"].includes(id) &&
            player.hand.length >= handLimit(game, player)
          )
            warning = "手牌已满：领取时须先在手牌区弃置一张";
          else if (id === "aid-beacon")
            warning =
              "部署后需主动发起交换；双方同格或相邻、各有一份物资并经对方同意";
          return { id, blockedReason, warning, targets };
        })
      : [];
  const descriptions = {
    "space-ring": `自动生效 · 当前手牌上限 ${handLimit(game, player)}（含灾难修正）`,
    "skateboard-shoes": `自动生效 · 常规移动最多 ${rulesFor(game).baseMove + 1} 格`,
    "mining-drone": game.learningMode
      ? "采集步骤可主动选择增产：资源 +1、环境 −1"
      : "自动生效 · 常规采集同类资源额外 +1，仍受灾难限制",
    "reserve-crate": "自动生效 · 洪水结算少付一份，缴纳面板会显示减免",
    "famed-blade":
      "等待触发 · 洪水缴纳后仍处淹没区，出现额外移动选择并消耗名刀",
    "aid-beacon":
      beaconBlockedReason(game, player) ||
      "可以交换 · 选一名同格或相邻玩家，双方各交换一份",
  };
  return {
    choices,
    equipment: player.equipment.map((id) => ({
      id,
      description:
        descriptions[id] ||
        CARDS.technology.find((card) => card.id === id)?.implementedEffect ||
        "",
    })),
  };
}
