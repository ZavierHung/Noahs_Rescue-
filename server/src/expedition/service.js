import { randomUUID } from "node:crypto";
import { createGame, command, viewGame } from "./engine.js";
import { publicCatalog } from "./catalog.js";
import { requireRule } from "./runtime.js";
import { judgmentContext, validateBoarding } from "./judgment.js";
import { gameplayState, recordAction, restoreHistory } from "./history.js";

export function createExpeditionService({ store, judge }) {
  const queues = new Map();
  // Serialize the first read too: the JSON store creates a missing file on read.
  // Otherwise a first list request could overwrite a simultaneously created game.
  let writes = store
    .read("expeditions.json", { schemaVersion: 1, games: [] })
    .then(() => {});
  function serial(id, fn) {
    const task = (queues.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(id, task);
    task
      .finally(() => {
        if (queues.get(id) === task) queues.delete(id);
      })
      .catch(() => {});
    return task;
  }
  function transaction(fn) {
    const task = writes
      .catch(() => {})
      .then(async () => {
        const data = await store.read("expeditions.json", {
          schemaVersion: 1,
          games: [],
        });
        const result = await fn(data);
        await store.write("expeditions.json", data);
        return result;
      });
    writes = task;
    return task;
  }
  async function get(id) {
    await writes.catch(() => {});
    const data = await store.read("expeditions.json", {
      schemaVersion: 1,
      games: [],
    });
    const game = data.games.find((g) => g.id === id);
    if (!game) throw Object.assign(new Error("未找到该局"), { status: 404 });
    return game;
  }
  return {
    catalog: publicCatalog,
    async list() {
      await writes.catch(() => {});
      const d = await store.read("expeditions.json", {
        schemaVersion: 1,
        games: [],
      });
      return d.games
        .map((g) => ({
          id: g.id,
          round: g.round,
          status: g.status,
          players: g.players.map((p) => p.name),
        }))
        .toReversed();
    },
    get: async (id) => viewGame(await get(id)),
    create: (input) =>
      transaction((data) => {
        const game = createGame(input, {
          id: `EXP-${randomUUID().slice(0, 8).toUpperCase()}`,
        });
        data.games.push(game);
        return viewGame(game);
      }),
    action: (id, input) =>
      serial(id, async () => {
        const original = await get(id);
        if (input.type === "judge" && original.judgment)
          return viewGame(original);
        if (input.revision !== original.revision)
          throw Object.assign(new Error("状态已更新，请刷新后重试"), {
            status: 409,
          });
        let updated;
        if (["undo", "redo"].includes(input.type)) {
          updated = restoreHistory(original, input);
        } else if (
          ["judge", "discuss", "rebut", "finalize"].includes(input.type)
        ) {
          const initial = input.type === "judge",
            final = input.type === "finalize";
          requireRule(
            initial
              ? original.status === "awaiting_judgment"
              : original.status === "review",
            initial ? "只能在第八回合结束时审判" : "终局审议已经结束或尚未开始",
          );
          const context = judgmentContext(original);
          const responded = new Set(
            original.judgment?.conversations?.map((c) => c.playerId) || [],
          );
          const remaining = context.players.filter(
            (p) => p.eligible && !responded.has(p.id),
          );
          let text = "",
            playerId = null;
          if (final)
            requireRule(
              !remaining.length,
              "请先让每位幸存玩家发言或明确放弃，再进行最终裁决",
            );
          else if (!initial) {
            requireRule(
              remaining.length && input.actor === remaining[0].id,
              "请由当前幸存玩家回应，每人只能回应一次",
            );
            playerId = input.actor;
            text = typeof input.text === "string" ? input.text.trim() : "";
            requireRule(
              input.waive === true || (text.length > 0 && text.length <= 4000),
              "请填写不超过 4000 字的发言，或明确放弃",
            );
          }
          updated = structuredClone(original);
          updated.judgment = await judge(gameplayState(original), {
            stage: initial ? "initial" : final ? "final" : "discussion",
            playerId,
            text,
            waive: input.waive === true,
          });
          // A model/custom adapter can only return a validated list, never gameplay mutations.
          updated.judgment.verdict = validateBoarding(
            updated.judgment.verdict,
            context,
            updated.judgment.rag?.evidence || [],
          );
          updated.status = final ? "finished" : "review";
          updated.judgment.final = final;
          // Release checkpoints only after a successful, validated judgment.
          updated.historyState = { version: 1, undo: [], redo: [] };
          updated.revision++;
          updated.events.push({
            seq: updated.events.length + 1,
            round: 8,
            actor: playerId || "god",
            type: initial ? "judge" : final ? "finalize" : "discussion",
            text: text || null,
            waived: input.waive === true,
            detail: updated.judgment.verdict.statement,
          });
        } else
          updated = recordAction(
            original,
            command(gameplayState(original), input),
            input,
          );
        return transaction((data) => {
          const index = data.games.findIndex((g) => g.id === id);
          if (data.games[index].revision !== original.revision)
            throw new Error("存档发生并发变化");
          data.games[index] = updated;
          return viewGame(updated);
        });
      }),
  };
}
