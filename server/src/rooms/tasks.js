import { readFile } from "node:fs/promises";
import path from "node:path";

// Task text lives in the data backend, independent of UI and god personas.
export function createTaskCatalog(dataDirectory) {
  return {
    async choose(room) {
      const tasks = JSON.parse(await readFile(path.join(dataDirectory, "tasks.json"), "utf8"));
      if (
        !Array.isArray(tasks) ||
        tasks.length !== 5 ||
        new Set(tasks.map((t) => t.id)).size !== 5 ||
        tasks.some(
          (t) =>
            !["id", "title", "category", "instruction", "criteria"].every(
              (key) => typeof t[key] === "string" && t[key].trim(),
            ) || t.durationRounds !== 1,
        )
      )
        throw new Error("神谕任务目录配置无效。");
      const { economy, society, environment } = room.scores.world;
      const spread =
        Math.max(economy, society, environment) - Math.min(economy, society, environment);
      const id =
        spread <= 2
          ? room.round % 2
            ? "balance"
            : "reflection"
          : environment <= society && environment <= economy
            ? "restoration"
            : society <= economy
              ? "cooperation"
              : "resource";
      const task = tasks.find((t) => t.id === id);
      if (!task) throw new Error("缺少对应的神谕任务。");
      return task;
    },
  };
}
