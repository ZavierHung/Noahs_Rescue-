import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAgentLoop } from './agent-loop.js';
import { resolveDisasters } from './catalog.js';
import { createLocalRetriever } from './rag.js';
import { createJsonStore } from './storage.js';
import { createMiniMaxVerdictModel } from './llm/minimax.js';
import { createGodRepository } from './god-repository.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.GAME_DATA_DIR || path.resolve(sourceDirectory, '../data');
const store = createJsonStore(dataDirectory);
const godRepository = createGodRepository(dataDirectory);
await godRepository.list();
const retriever = await createLocalRetriever(path.join(dataDirectory, 'knowledge.json'));
const verdictModel = createMiniMaxVerdictModel();
const agentLoop = createAgentLoop({ godRepository, retriever, verdictModel });
const port = Number(process.env.GAME_API_PORT || 8787);
const DEFAULT_STATE = {
  round: 1,
  attributes: { economy: 10, environment: 10, society: 10 },
  activeDisasters: [],
  updatedAt: null,
};

function send(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://localhost:3000',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(payload));
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateAttributes(attributes) {
  for (const key of ['economy', 'environment', 'society']) {
    if (!Number.isInteger(attributes?.[key]) || attributes[key] < 1 || attributes[key] > 19) {
      throw new Error(`${key} 必须是 1—19 的整数。`);
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') return send(response, 204, {});
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(response, 200, { ok: true, rag: { model: retriever.model, documents: retriever.size }, llm: verdictModel.describe(), godPrompts: await godRepository.describe(), persistence: 'json' });
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      return send(response, 200, await store.read('state.json', DEFAULT_STATE));
    }

    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const input = await bodyOf(request);
      validateAttributes(input.attributes);
      const current = await store.read('state.json', { round: 1, activeDisasters: [] });
      const state = {
        ...current,
        attributes: input.attributes,
        activeDisasters: resolveDisasters(input.attributes, current.activeDisasters),
        updatedAt: new Date().toISOString(),
      };
      await store.write('state.json', state);
      return send(response, 200, state);
    }

    if (request.method === 'GET' && url.pathname === '/api/judgments') {
      const sessions = await store.read('judgments.json', []);
      return send(response, 200, sessions.toReversed());
    }

    if (request.method === 'POST' && url.pathname === '/api/judgments') {
      const input = await bodyOf(request);
      const state = await store.read('state.json', DEFAULT_STATE);
      validateAttributes(state.attributes);
      const session = await agentLoop.start(state, input.player);
      const sessions = await store.read('judgments.json', []);
      await store.write('judgments.json', [...sessions, session]);
      return send(response, 201, session);
    }

    const rebuttalMatch = url.pathname.match(/^\/api\/judgments\/([^/]+)\/rebuttal$/);
    if (request.method === 'POST' && rebuttalMatch) {
      const input = await bodyOf(request);
      if (!input.text?.trim()) throw new Error('反驳内容不能为空。');
      const sessions = await store.read('judgments.json', []);
      const index = sessions.findIndex((item) => item.id === rebuttalMatch[1]);
      if (index === -1) return send(response, 404, { error: '未找到该审判。' });
      const updated = await agentLoop.rebut(sessions[index], input.text.trim());
      sessions[index] = updated;
      await store.write('judgments.json', sessions);
      return send(response, 200, updated);
    }

    return send(response, 404, { error: '接口不存在。' });
  } catch (error) {
    return send(response, 400, { error: error.message || '请求处理失败。' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`World Balance API: http://localhost:${port}`);
});
