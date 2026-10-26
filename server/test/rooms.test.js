import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createJsonStore } from "../src/storage.js";
import { createGodRepository } from "../src/god-repository.js";
import { createLocalRetriever } from "../src/rag.js";
import { createAgentLoop } from "../src/agent-loop.js";
import { createRoomRepository } from "../src/rooms/repository.js";
import { createRoomService } from "../src/rooms/service.js";
import { createTaskAssessor } from "../src/rooms/assessment.js";
import { createTaskCatalog } from "../src/rooms/tasks.js";
import { createRoomHandler } from "../src/rooms/http.js";
import { ROLES, proposalFor } from "../src/rooms/rules.js";
import { createClient, parseRoleCode } from "../../miniprogram/shared/client.js";

const dataDir = new URL("../data/", import.meta.url).pathname;
const identities = ROLES.map((r) => ({ roleId: r.id, clientId: `test_client_identity_${r.id}` }));
async function fixture(t, override = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "noah-rooms-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createJsonStore(directory);
  const godRepository = createGodRepository(dataDir);
  const retriever = await createLocalRetriever(path.join(dataDir, "knowledge.json"));
  const loop = createAgentLoop({ godRepository, retriever, random: () => 0 });
  const dependencies = {
    repository: createRoomRepository(store),
    taskCatalog: createTaskCatalog(dataDir),
    agentLoop: loop,
    assessTask: createTaskAssessor({ godRepository }),
    ...override,
  };
  const service = createRoomService(dependencies);
  const action = (id, type, input = {}, player = 0) =>
    service.action(id, { ...identities[player], type, ...input });
  const readyRoom = async () => {
    const room = await service.create(identities[0]);
    await Promise.all(
      identities.slice(1).map((who) => service.action(room.id, { ...who, type: "join" })),
    );
    await Promise.all(
      identities.map((who) => service.action(room.id, { ...who, type: "ready", ready: true })),
    );
    return action(room.id, "start");
  };
  return { service, dependencies, action, readyRoom, directory, loop };
}

test("six fixed roles, unique seats, ready/online gate, and safe public views", async (t) => {
  const f = await fixture(t);
  const room = await f.service.create(identities[0]);
  await assert.rejects(f.action(room.id, "start"), /六个角色/);
  await assert.rejects(f.action(room.id, "join", { clientId: "another_client_12345" }), /占用/);
  await assert.rejects(f.action(room.id, "join", { roleId: "H04" }), /无效/);
  await Promise.all(
    identities.slice(1).map((who) => f.service.action(room.id, { ...who, type: "join" })),
  );
  await Promise.all(
    identities.map((who) => f.service.action(room.id, { ...who, type: "ready", ready: true })),
  );
  await f.action(room.id, "leave", {}, 5);
  await assert.rejects(f.action(room.id, "start"), /六个角色/);
  await f.action(room.id, "join", {}, 5);
  await f.action(room.id, "ready", { ready: true }, 5);
  const started = await f.action(room.id, "start");
  assert.equal(started.status, "playing");
  assert.equal(Object.keys(started.players).length, 6);
  assert.equal(JSON.stringify(started).includes("clientId"), false);
  await assert.rejects(f.action(room.id, "start"), /六个角色/);
});

test("persistent create request keys survive concurrent retry and restart without duplicate rooms", async (t) => {
  const f = await fixture(t);
  const input = { ...identities[0], requestId: "creation_request_0001" };
  const rooms = await Promise.all([
    f.service.create(input),
    f.service.create(input),
    f.service.create(input),
  ]);
  assert.equal(new Set(rooms.map((room) => room.id)).size, 1);
  assert.equal((await f.service.list()).length, 1);
  const restarted = createRoomService({
    ...f.dependencies,
    repository: createRoomRepository(createJsonStore(f.directory)),
  });
  assert.deepEqual(await restarted.create(input), rooms[0]);
  assert.equal(rooms[0].creation, undefined);
  assert.equal(JSON.stringify(rooms[0]).includes(input.requestId), false);
  await assert.rejects(restarted.create({ ...input, roleId: "H01" }), /不能修改角色/);
  await assert.rejects(restarted.create({ ...input, previousGameId: rooms[0].id }), /不能修改角色/);
  await assert.rejects(restarted.create({ ...input, requestId: "short" }), /无效的建房/);
  const other = await restarted.create({ ...identities[1], requestId: input.requestId });
  assert.notEqual(other.id, rooms[0].id);
});

test("replaying successor creation never archives the successor or changes the predecessor twice", async (t) => {
  const f = await fixture(t);
  const first = await f.readyRoom();
  const input = { ...identities[0], requestId: "creation_successor_001", previousGameId: first.id };
  const next = await f.service.create(input);
  const archived = await f.service.get(first.id);
  assert.equal(archived.status, "finished");
  assert.deepEqual(await f.service.create(input), next);
  assert.deepEqual(await f.service.get(first.id), archived);
  assert.equal((await f.service.get(next.id)).status, "lobby");
});

test("manual score edits validate bounds, stale revisions, reason, and log their source", async (t) => {
  const f = await fixture(t),
    room = await f.readyRoom();
  for (const value of [0, 20, 1.1, "9"])
    await assert.rejects(
      f.action(room.id, "score", {
        scope: "world",
        dimension: "environment",
        value,
        reason: "test",
        scoreRevision: 0,
      }),
      /1—19/,
    );
  await assert.rejects(
    f.action(room.id, "score", {
      scope: "world",
      dimension: "economy",
      value: 9,
      reason: "",
      scoreRevision: 0,
    }),
    /原因/,
  );
  const changed = await f.action(room.id, "score", {
    scope: "world",
    dimension: "environment",
    value: 2,
    reason: "桌游采集导致环境下降",
    scoreRevision: 0,
  });
  assert.equal(changed.scores.world.environment, 2);
  assert.ok(changed.activeDisasters.length);
  assert.equal(changed.events.at(-1).changes[0].before, 10);
  await assert.rejects(
    f.action(
      room.id,
      "score",
      { scope: "humans", dimension: "economy", value: 11, reason: "并发修改", scoreRevision: 0 },
      3,
    ),
    /已经变化/,
  );
});

test("live legacy disasters upgrade into the god snapshot while archives remain unchanged", async (t) => {
  const f = await fixture(t);
  const initial = await f.readyRoom();
  const oldCard = { id: 'low-carbon-pain', dimension: 'environment', band: 'high', name: '低碳转型阵痛', effect: '旧版效果', triggerValue: 14 };
  const historical = { id: 'historic', status: 'final', settlement: {}, stateSnapshot: { activeDisasters: [oldCard] } };
  await f.dependencies.repository.transact((data) => {
    const room = data.rooms[0];
    room.scores.world.environment = 14;
    room.activeDisasters = [oldCard];
    room.judgments.push(historical);
    data.rooms.push({ ...structuredClone(room), id: 'GAME-ARCHIVED', status: 'finished' });
  });
  const read = await f.service.get(initial.id);
  assert.equal(read.activeDisasters[0].id, 'resource-protection');
  assert.equal(read.activeDisasters[0].image.file, 'resource-protection.jpg');
  assert.deepEqual(read.judgments[0], historical);
  assert.deepEqual((await f.service.get('GAME-ARCHIVED')).activeDisasters, [oldCard]);
  const started = await f.action(initial.id, 'trigger');
  assert.deepEqual(started.judgments[1].stateSnapshot.activeDisasters, read.activeDisasters);
  assert.deepEqual(started.judgments[0], historical);
  assert.equal(started.scores.world.environment, 14);
  const stored = JSON.parse(await readFile(path.join(f.directory, 'rooms.json'), 'utf8'));
  assert.deepEqual(stored.rooms[0].activeDisasters, read.activeDisasters);
  assert.deepEqual(stored.rooms[1].activeDisasters, [oldCard]);
});

test("world scores trigger, change and clear document cards; team scores do not trigger world disasters", async (t) => {
  const f = await fixture(t);
  let room = await f.readyRoom();
  const score = async (scope, dimension, value) => {
    room = await f.action(room.id, 'score', { scope, dimension, value, scoreRevision: room.scoreRevision, reason: '灾难卡回归测试' });
    return room.activeDisasters;
  };
  assert.deepEqual(await score('humans', 'economy', 18), []);
  assert.equal((await score('world', 'economy', 18))[0].name, '财富悬殊');
  assert.equal(room.scores.world.society, 10); // Reading a card never silently executes it twice.
  assert.equal((await score('world', 'economy', 14))[0].id, 'develop-first');
  assert.deepEqual(await score('world', 'economy', 10), []);
});

test("full god loop keeps scores unchanged until confirmation; repeated settlement is idempotent; trigger repeats", async (t) => {
  const f = await fixture(t),
    initial = await f.readyRoom();
  const started = await f.action(initial.id, "trigger");
  const session = started.judgments[0],
    judgmentId = session.id;
  assert.equal(session.stateSnapshot.gameId, initial.id);
  assert.deepEqual(session.stateSnapshot.teamScores.animals, initial.scores.animals);
  assert.ok(session.rag.evidence.length);
  assert.ok(session.trace.some((step) => step.step === "await_rebuttal"));
  assert.equal(session.god.prompt, undefined);
  assert.ok(session.stateSnapshot.recentActions.length);
  await assert.rejects(f.action(initial.id, "trigger"), /当前神谕/);
  await assert.rejects(f.action(initial.id, "advance"), /当前神谕/);
  await assert.rejects(f.action(initial.id, "score", { scoreRevision: 0 }), /当前神谕/);
  await assert.rejects(f.action(initial.id, "rebut", { judgmentId, text: "补救" }), /先汇报/);
  const reported = await f.action(
    initial.id,
    "report",
    { judgmentId, text: "已完成：两队共享资源并合作修复湿地。" },
    3,
  );
  assert.equal(reported.judgments[0].taskReports[0].assessment.completed, true);
  const final = await f.action(
    initial.id,
    "rebut",
    { judgmentId, text: "我们已付出修复成本，希望减轻惩罚。" },
    3,
  );
  assert.equal(final.judgments[0].status, "final");
  assert.ok(final.judgments[0].finalVerdict.measures.length);
  assert.deepEqual(final.scores, initial.scores);
  assert.deepEqual((await f.service.get(initial.id)).scores, initial.scores); // cancel/return is read-only
  const [settled1, settled2] = await Promise.all([
    f.action(initial.id, "settle", { judgmentId }),
    f.action(initial.id, "settle", { judgmentId }, 4),
  ]);
  assert.deepEqual(settled1.scores, settled2.scores);
  assert.equal(settled2.events.filter((e) => e.type === "settle").length, 1);
  assert.equal(settled2.scoreRevision, 1);
  const round2 = await f.action(initial.id, "advance");
  assert.equal(round2.round, 2);
  const next = await f.action(initial.id, "trigger");
  assert.equal(next.judgments.length, 2);
  assert.notEqual(next.judgments[1].id, judgmentId);
});

test("proposals clamp to 1–19 and target the triggering faction", () => {
  const room = {
    scores: { world: { environment: 19 }, humans: { society: 19, economy: 1 } },
    scoreRevision: 2,
  };
  const session = { player: { id: "H01" }, finalVerdict: { tone: "reward" } };
  assert.deepEqual(
    proposalFor(room, session).changes.map((c) => c.delta),
    [0, 0],
  );
  room.scores.world.environment = 1;
  session.finalVerdict.tone = "penalty";
  assert.deepEqual(
    proposalFor(room, session).changes.map((c) => c.delta),
    [0, 0],
  );
});

test("exit/reconnect and restart preserve rooms, and new game archives without overwriting", async (t) => {
  const f = await fixture(t),
    room = await f.readyRoom();
  await f.action(room.id, "leave");
  await assert.rejects(f.action(room.id, "trigger"), /已离开/);
  const rejoined = await f.action(room.id, "join");
  assert.deepEqual(rejoined.scores, room.scores);
  const restarted = createRoomService(f.dependencies);
  assert.equal((await restarted.get(room.id)).status, "playing");
  const newRoom = await restarted.create({ ...identities[0], previousGameId: room.id });
  assert.notEqual(newRoom.id, room.id);
  assert.equal((await restarted.get(room.id)).status, "finished");
  assert.equal(newRoom.status, "lobby");
  await assert.rejects(f.action(room.id, "join"), /已结束/);
  await assert.rejects(f.action(room.id, "score"), /只读/);
  const disk = JSON.parse(await readFile(path.join(f.directory, "rooms.json"), "utf8"));
  assert.equal(disk.rooms.length, 2);
});

test("slow AI in one room does not block a separate room, duplicate triggers serialize", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const slow = createRoomService({
    ...f.dependencies,
    agentLoop: {
      ...f.loop,
      start: async (...args) => {
        entered();
        await waiting;
        return f.loop.start(...args);
      },
    },
  });
  const room = await f.readyRoom();
  const ai = slow.action(room.id, { ...identities[0], type: "trigger" });
  await started;
  const unrelated = await slow.create(identities[1]);
  assert.equal(unrelated.status, "lobby");
  const duplicate = slow.action(room.id, { ...identities[0], type: "trigger" });
  release();
  await ai;
  await assert.rejects(duplicate, /当前神谕/);
});

test("failed model operation does not corrupt persistent state or poison its room queue", async (t) => {
  const f = await fixture(t),
    room = await f.readyRoom();
  const broken = createRoomService({
    ...f.dependencies,
    agentLoop: {
      start: async () => {
        throw new Error("simulated failure");
      },
    },
  });
  await assert.rejects(broken.action(room.id, { ...identities[0], type: "trigger" }), /simulated/);
  const after = await broken.get(room.id);
  assert.equal(after.judgments.length, 0);
  const next = await broken.action(room.id, { ...identities[0], type: "advance" });
  assert.equal(next.round, 2);
});

test("assessment fallback explicitly handles insufficient evidence and model failure", async () => {
  const fallback = createTaskAssessor({ godRepository: {} });
  assert.equal((await fallback({}, "尚未完成修复")).completed, false);
  assert.equal((await fallback({}, "已完成修复")).used, false);
  const assessor = createTaskAssessor({
    godRepository: { get: async () => ({ prompt: "full" }) },
    verdictModel: {
      enabled: true,
      model: "MiniMax-M3.0",
      generateAssessment: async () => {
        throw new Error("http_503");
      },
    },
  });
  const result = await assessor(
    { god: { id: "balanced" }, stateSnapshot: {}, rag: { evidence: [] } },
    "已完成修复",
  );
  assert.equal(result.used, false);
  assert.equal(result.fallbackReason, "http_503");
});

test("data-backend tasks cover ecology, cooperation, resources, balance and reflection", async () => {
  const catalog = createTaskCatalog(dataDir);
  for (const [values, round, id] of [
    [[10, 10, 3], 1, "restoration"],
    [[10, 3, 10], 1, "cooperation"],
    [[3, 10, 10], 1, "resource"],
    [[10, 10, 10], 1, "balance"],
    [[10, 10, 10], 2, "reflection"],
  ]) {
    const [economy, society, environment] = values;
    const task = await catalog.choose({
      round,
      scores: { world: { economy, society, environment } },
    });
    assert.equal(task.id, id);
    assert.ok(task.criteria);
    assert.equal(task.durationRounds, 1);
  }
});

test("re-scanning a role restores that role’s remembered game instead of losing the reconnect link", async () => {
  const saved = new Map();
  const room = {
    id: "GAME-remembered",
    status: "playing",
    players: { A03: { online: false } },
    scores: {
      animals: { economy: 10, society: 10, environment: 10 },
      humans: { economy: 10, society: 10, environment: 10 },
      world: { economy: 10, society: 10, environment: 10 },
    },
    judgments: [],
    events: [],
  };
  saved.set("remember", { roleId: "A03", clientId: "test_remembered_client", roomId: room.id });
  const client = createClient({
    storageKey: "remember",
    storage: { get: (key) => saved.get(key), set: (key, value) => saved.set(key, value) },
    request: async (path) => (path === "/api/roles" ? ROLES : [room]),
  });
  await client.init();
  client.selectRole("H01");
  assert.equal(client.getState().roomId, null);
  client.selectRole("A03");
  assert.equal(client.getState().roomId, room.id);
  assert.equal(client.getState().room.id, room.id);
  client.openGame();
  assert.equal(client.getState().screen, "role", "offline players must use explicit reconnect");
});

test("role cards accept six IDs or namespaced QR payloads only", () => {
  assert.equal(parseRoleCode("noahs-rescue://role/A03"), "A03");
  assert.equal(parseRoleCode("H01"), "H01");
  assert.throws(() => parseRoleCode("https://evil.test/?role=A03"), /不是有效/);
  assert.throws(() => parseRoleCode("A04"), /不是有效/);
});

test("HTTP + six shared mobile controllers complete a local match, persist and reconnect", async (t) => {
  const f = await fixture(t),
    handler = createRoomHandler(f.service);
  const server = createServer(async (req, res) => {
    req.res = res;
    const handled = await handler(req, new URL(req.url, "http://localhost"), {
      send: (response, status, value) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      },
      bodyOf: async (request) => {
        const chunks = [];
        for await (const c of request) chunks.push(c);
        return JSON.parse(Buffer.concat(chunks).toString() || "{}");
      },
    });
    if (!handled) {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = "GET", data) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const saved = new Map(),
    storage = { get: (key) => saved.get(key), set: (key, value) => saved.set(key, value) };
  const clients = ROLES.map((role) =>
    createClient({
      request,
      storage,
      storageKey: role.id,
      initialRole: role.id,
      wait: () => new Promise((resolve) => setImmediate(resolve)),
    }),
  );
  await Promise.all(clients.map((c) => c.init()));
  await clients[0].create();
  const id = clients[0].getState().roomId;
  await Promise.all(clients.slice(1).map((c) => c.join(id)));
  await Promise.all(clients.map((c) => c.act("ready", { ready: true })));
  await clients[0].act("start");
  await Promise.all(clients.map((c) => c.refresh()));
  assert.ok(clients.every((c) => c.getState().screen === "game"));
  await clients[0].act("trigger");
  const judgmentId = clients[0].getState().oracle.id;
  await clients[3].act("report", { judgmentId, text: "已完成：双方协作修复湿地，共享物资。" });
  await clients[3].act("rebut", { judgmentId, text: "我们承诺继续合作。" });
  await clients[2].act("settle", { judgmentId });
  await Promise.all(clients.map((c) => c.refresh()));
  assert.ok(clients.every((c) => c.getState().room.scoreRevision === 1));
  await clients[5].act("leave");
  clients[5].dispose();
  const reconnected = createClient({ request, storage, storageKey: "H03" });
  await reconnected.init();
  assert.equal(reconnected.getState().roomId, id);
  await reconnected.join(id);
  assert.equal(reconnected.getState().screen, "game");
  await clients[0].act("finish");
  await clients[0].create();
  const secondId = clients[0].getState().roomId;
  await clients[0].detail(id);
  await clients[0].refresh();
  assert.equal(
    clients[0].getState().room.id,
    id,
    "archive detail must not be replaced by background refresh",
  );
  clients[0].openGame();
  assert.equal(clients[0].getState().room.id, secondId);
  assert.equal(clients[0].getState().screen, "lobby");
  assert.ok(clients.every((c) => !c.getState().error));
});
