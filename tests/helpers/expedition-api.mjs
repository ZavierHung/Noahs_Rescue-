import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createJsonStore } from "../../server/src/storage.js";
import { createExpeditionService } from "../../server/src/expedition/service.js";
import { createExpeditionHandler } from "../../server/src/expedition/http.js";
import { createBoardingJudge } from "../../server/src/expedition/judgment.js";
import { createGodRepository } from "../../server/src/god-repository.js";
import { createAcademicRetriever } from "../../server/src/academic/retriever.js";
export async function testApi() {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-expedition-test-"));
  const data = new URL("../../server/data/", import.meta.url).pathname;
  const store = createJsonStore(directory);
  // No env loading, no model construction: all tests are strictly offline.
  const judge = createBoardingJudge({
    godRepository: createGodRepository(data),
    retriever: await createAcademicRetriever(),
    random: () => 0,
  });
  const service = createExpeditionService({ store, judge }),
    handler = createExpeditionHandler(service);
  await service.list(); // Finish cold-store initialization before tests seed fixtures.
  const server = createServer(async (req, res) => {
    req.res = res;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const handled = await handler(req, new URL(req.url, "http://test"), {
      send: (r, status, body) => {
        r.writeHead(status, { "content-type": "application/json" });
        r.end(JSON.stringify(body));
      },
      bodyOf: async (r) => {
        let text = "";
        for await (const chunk of r) text += chunk;
        return JSON.parse(text || "{}");
      },
    });
    if (!handled) {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    service,
    store,
    directory,
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
