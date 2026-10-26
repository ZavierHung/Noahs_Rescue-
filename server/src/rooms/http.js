import { randomUUID } from "node:crypto";

// AI requests become pollable jobs so mobile requests never wait on an LLM.
// Jobs are ephemeral; only completed domain operations are committed to JSON.
export function createRoomHandler(service) {
  const jobs = new Map();
  return async (request, url, { send, bodyOf }) => {
    const path = url.pathname;
    if (
      !path.startsWith("/api/rooms") &&
      !path.startsWith("/api/room-jobs") &&
      path !== "/api/roles"
    )
      return false;
    const reply = (status, payload) => {
      send(request.res, status, payload);
      return true;
    };
    try {
      if (request.method === "GET" && path === "/api/roles") return reply(200, service.roles);
      if (request.method === "GET" && path === "/api/rooms")
        return reply(200, await service.list());
      if (request.method === "POST" && path === "/api/rooms")
        return reply(201, await service.create(await bodyOf(request)));
      const match = path.match(/^\/api\/rooms\/([^/]+)(?:\/(actions))?$/);
      if (match && request.method === "GET" && !match[2])
        return reply(200, await service.get(match[1]));
      if (match && request.method === "POST" && match[2]) {
        const input = await bodyOf(request);
        if (["trigger", "report", "rebut"].includes(input.type)) {
          for (const [id, job] of jobs)
            if (Date.now() - job.createdAt > 15 * 60_000) jobs.delete(id);
          const jobId = randomUUID();
          const job = { status: "running", createdAt: Date.now() };
          jobs.set(jobId, job);
          service.action(match[1], input).then(
            (result) => Object.assign(job, { status: "done", result }),
            (error) => Object.assign(job, { status: "failed", error: error.message }),
          );
          return reply(202, { jobId });
        }
        return reply(200, await service.action(match[1], input));
      }
      const jobMatch = path.match(/^\/api\/room-jobs\/([\w-]+)$/);
      if (jobMatch && request.method === "GET") {
        const job = jobs.get(jobMatch[1]);
        return job
          ? reply(200, job)
          : reply(404, { error: "任务不存在或服务已重启，请刷新游戏确认结果。" });
      }
      return reply(404, { error: "接口不存在。" });
    } catch (error) {
      return reply(error.status || 400, { error: error.message });
    }
  };
}
