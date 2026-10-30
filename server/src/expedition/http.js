import { createAcademicRetriever } from "../academic/retriever.js";
import { originalDocument } from "../academic/archive.js";

export function createExpeditionHandler(service) {
  return async (request, url, { send, bodyOf }) => {
    if (!url.pathname.startsWith("/api/expeditions")) return false;
    try {
      const path = url.pathname;
      if (
        request.method === "GET" &&
        (path === "/api/expeditions/knowledge" ||
          path.startsWith("/api/expeditions/knowledge/original/"))
      ) {
        const retriever = await createAcademicRetriever();
        if (path === "/api/expeditions/knowledge") {
          const sources = await Promise.all(
            retriever.library.sources.map(async (s) => {
              const original = await originalDocument(s);
              return {
                ...s,
                archive: original
                  ? {
                      status: "available",
                      sha256: original.sha256,
                      bytes: original.bytes,
                      localUrl: `/api/expeditions/knowledge/original/${s.id}`,
                    }
                  : {
                      status: ["web", "link"].includes(s.originalFormat)
                        ? "external"
                        : "pending",
                    },
              };
            }),
          );
          send(request.res, 200, { ...retriever.describe(), sources });
        } else {
          const id = path.slice("/api/expeditions/knowledge/original/".length);
          const source = retriever.library.sources.find((s) => s.id === id);
          const original = source && (await originalDocument(source));
          if (!original)
            send(request.res, 404, {
              error: "原件尚未归档或文献不存在，请使用官方原文链接。",
            });
          else {
            request.res.writeHead(200, {
              "content-type": "application/pdf",
              "x-content-type-options": "nosniff",
              "content-disposition": `inline; filename="${source.id}.pdf"`,
            });
            request.res.end(original.data);
          }
        }
        return true;
      }
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
