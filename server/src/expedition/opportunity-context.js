import { createHash } from "node:crypto";
import { MAP, TILES, FLAGS, neighbors } from "./map.js";

// Captured once when a learning game is created, not reconstructed at judgment
// time from a potentially revised map. No random numbers or scoring changes.
export function buildOpportunityContext(game) {
  const geometry = TILES.map(({ id, q, r, zone, terrain, resource }) => ({
    id,
    q,
    r,
    zone,
    terrain,
    resource,
  }));
  return {
    version: "spawn-opportunity-v1",
    mapVersion: MAP.version,
    mapHash: createHash("sha256")
      .update(JSON.stringify({ geometry, flags: FLAGS }))
      .digest("hex"),
    basis:
      "新局创建时的规则地图；沿可通行陆地六边形计算最短步数，洪水前、无装备加成。两步范围包括起点，资源格不是可得物资的保证。",
    limitations:
      "只描述部分起点机会，未包含抽牌、先后手、其他玩家、后续洪水与选择；不是努力、能力或道德分。不得虚构贡献、自动补偿船位或把位置优势当能力。",
    players: game.players.map((player) => {
      const flag = FLAGS.find((value) => value.id === player.spawn);
      const origin = TILES.find((tile) => tile.id === flag?.tileId);
      if (!origin)
        return { playerId: player.id, flagId: player.spawn, available: false };
      const steps = new Map([[origin.id, 0]]),
        queue = [origin];
      for (let i = 0; i < queue.length; i++) {
        const at = queue[i];
        for (const next of neighbors(at)) {
          if (next.terrain === "water" || steps.has(next.id)) continue;
          steps.set(next.id, steps.get(at.id) + 1);
          queue.push(next);
        }
      }
      const safe = queue
        .filter((tile) => tile.zone === 0)
        .map((tile) => steps.get(tile.id));
      const resources = queue.filter(
        (tile) => steps.get(tile.id) <= 2 && tile.resource,
      );
      return {
        playerId: player.id,
        flagId: flag.id,
        available: true,
        initialTileId: origin.id,
        minimumStepsToSafeZone: safe.length ? Math.min(...safe) : null,
        resourceTilesWithinTwoSteps: resources.length,
        resourceTypesWithinTwoSteps: [
          ...new Set(resources.map((tile) => tile.resource)),
        ].sort(),
      };
    }),
  };
}
