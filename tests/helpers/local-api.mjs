import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createJsonStore } from "../../server/src/storage.js";
import { createGodRepository } from "../../server/src/god-repository.js";
import { createLocalRetriever } from "../../server/src/rag.js";
import { createAgentLoop } from "../../server/src/agent-loop.js";
import { createRoomRepository } from "../../server/src/rooms/repository.js";
import { createRoomService } from "../../server/src/rooms/service.js";
import { createTaskAssessor } from "../../server/src/rooms/assessment.js";
import { createTaskCatalog } from "../../server/src/rooms/tasks.js";
import { createRoomHandler } from "../../server/src/rooms/http.js";

// No .env loading and no model adapter: these tests can never spend API credits.
export async function startLocalTestApi() {
  const directory = await mkdtemp(path.join(tmpdir(), "noah-browser-test-"));
  const catalogDirectory = fileURLToPath(new URL("../../server/data/", import.meta.url));
  const repository = createRoomRepository(createJsonStore(directory));
  const godRepository = createGodRepository(catalogDirectory);
  const retriever = await createLocalRetriever(path.join(catalogDirectory, "knowledge.json"));
  const service = createRoomService({
    repository,
    agentLoop: createAgentLoop({ godRepository, retriever, random: () => 0 }),
    assessTask: createTaskAssessor({ godRepository }),
    taskCatalog: createTaskCatalog(catalogDirectory),
  });
  const handler = createRoomHandler(service);
  const server = createServer(async (request, response) => {
    request.res = response;
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      response.end();
      return;
    }
    const handled = await handler(request, new URL(request.url, "http://localhost"), {
      send: (res, status, body) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        });
        res.end(JSON.stringify(body));
      },
      bodyOf: async (req) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        return JSON.parse(Buffer.concat(chunks).toString() || "{}");
      },
    });
    if (!handled) {
      response.writeHead(404);
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    service,
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
}
