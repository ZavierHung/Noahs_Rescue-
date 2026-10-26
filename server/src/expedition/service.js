import { randomUUID } from "node:crypto";
import { createGame, command, viewGame } from "./engine.js";
import { publicCatalog } from "./catalog.js";

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
        if (input.type === "judge" || input.type === "rebut") {
          if (input.type === "judge" && original.status !== "awaiting_judgment")
            throw new Error("只能在第八回合结束时审判");
          if (input.type === "rebut" && original.status !== "review")
            throw new Error("仅能对初次终局裁决申辩一次");
          const text =
            input.type === "rebut" ? String(input.text || "").trim() : "";
          if (input.type === "rebut" && (!text || text.length > 4000))
            throw new Error("请填写不超过 4000 字的申辩");
          updated = structuredClone(original);
          updated.judgment = await judge(original, { rebuttal: text });
          updated.status = input.type === "rebut" ? "finished" : "review";
          updated.revision++;
          updated.events.push({
            seq: updated.events.length + 1,
            round: 8,
            actor: "god",
            type: input.type,
            detail: updated.judgment.verdict.statement,
          });
        } else if (input.type === "finalize") {
          if (original.status !== "review")
            throw new Error("尚无可确认的终局裁决");
          updated = structuredClone(original);
          updated.status = "finished";
          updated.judgment.final = true;
          updated.revision++;
          updated.events.push({
            seq: updated.events.length + 1,
            round: 8,
            actor: "system",
            type: "finalize",
            detail: "确认终局登舟名单",
          });
        } else updated = command(original, input);
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
