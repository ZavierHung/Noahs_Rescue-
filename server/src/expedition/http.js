export function createExpeditionHandler(service) {
  return async (request, url, { send, bodyOf }) => {
    if (!url.pathname.startsWith("/api/expeditions")) return false;
    try {
      const path = url.pathname;
      if (request.method === "GET" && path === "/api/expeditions/catalog")
        send(request.res, 200, service.catalog());
      else if (request.method === "GET" && path === "/api/expeditions")
        send(request.res, 200, await service.list());
      else if (request.method === "POST" && path === "/api/expeditions")
        send(request.res, 201, await service.create(await bodyOf(request)));
      else {
        const match = path.match(
          /^\/api\/expeditions\/(EXP-[A-Z0-9]+)(\/actions)?$/,
        );
        if (!match) send(request.res, 404, { error: "接口不存在" });
        else if (request.method === "GET" && !match[2])
          send(request.res, 200, await service.get(match[1]));
        else if (request.method === "POST" && match[2])
          send(
            request.res,
            200,
            await service.action(match[1], await bodyOf(request)),
          );
        else send(request.res, 405, { error: "不支持的操作" });
      }
    } catch (error) {
      send(request.res, error.status || 400, {
        error: error.message || "游戏操作失败",
      });
    }
    return true;
  };
}
