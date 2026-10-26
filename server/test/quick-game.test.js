import assert from "node:assert/strict";
import test from "node:test";
import { startLocalTestApi } from "../../tests/helpers/local-api.mjs";
import { createClient } from "../../miniprogram/shared/client.js";
import { startQuickGame, quickStorageKey } from "../../miniprogram/shared/quick-game.js";

async function setup(t) {
  const api = await startLocalTestApi();
  t.after(() => api.close());
  const values = new Map();
  const storage = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, structuredClone(value)),
  };
  const request = async (path, method = "GET", data) => {
    const response = await fetch(api.base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  return { api, request, storage };
}

test("quick HTTP: one click starts six real players without touching a manual game or calling the god", async (t) => {
  const { api, request, storage } = await setup(t);
  const manual = createClient({ request, storage });
  t.after(() => manual.dispose());
  await manual.init();
  const before = await manual.create();
  const saved = structuredClone(storage.get("noah-player"));
  const messages = [];
  const room = await startQuickGame({
    request,
    storage,
    onProgress: (message) => messages.push(message),
  });
  assert.equal(room.status, "playing");
  assert.equal(Object.values(room.players).filter((p) => p.ready && p.online).length, 6);
  assert.equal(room.judgments.length, 0);
  assert.deepEqual(await api.service.get(before.id), before);
  assert.deepEqual(storage.get("noah-player"), saved);
  assert.equal(
    new Set(Object.keys(room.players).map((id) => storage.get(quickStorageKey(id)).clientId)).size,
    6,
  );
  assert.match(messages.at(-1), /已开始/);
  const again = await startQuickGame({ request, storage });
  assert.equal(again.id, room.id);
  assert.equal(again.events.filter((e) => e.type === "start").length, 1);
  assert.equal((await api.service.list()).length, 2);
});

test("quick HTTP: failed ready is not success and retry continues the same room", async (t) => {
  const { api, request, storage } = await setup(t);
  await assert.rejects(
    startQuickGame({
      storage,
      request: (path, method, data) => {
        if (data?.type === "ready" && data.roleId === "H03") throw new Error("offline");
        return request(path, method, data);
      },
    }),
    /准备失败/,
  );
  const [partial] = await api.service.list();
  assert.equal(partial.status, "lobby");
  assert.equal(Object.values(partial.players).filter((p) => p.ready).length, 5);
  const resumed = await startQuickGame({ request, storage });
  assert.equal(resumed.id, partial.id);
  assert.equal(resumed.status, "playing");
  assert.equal((await api.service.list()).length, 1);
});

test("quick HTTP: partial join failure resumes without replacing the lobby", async (t) => {
  const { api, request, storage } = await setup(t);
  await assert.rejects(
    startQuickGame({
      storage,
      request: (path, method, data) => {
        if (data?.type === "join" && data.roleId === "A02") throw new Error("offline");
        return request(path, method, data);
      },
    }),
    /加入失败/,
  );
  const [room] = await api.service.list();
  assert.equal(Object.keys(room.players).length, 5);
  const resumed = await startQuickGame({ request, storage });
  assert.equal(resumed.id, room.id);
  assert.equal(resumed.status, "playing");
});

test("quick HTTP: lost start response is recovered and start is not applied twice", async (t) => {
  const { api, request, storage } = await setup(t);
  await assert.rejects(
    startQuickGame({
      storage,
      request: async (path, method, data) => {
        const result = await request(path, method, data);
        if (data?.type === "start") throw new Error("response lost");
        return result;
      },
    }),
    /开局尚未确认/,
  );
  const [room] = await api.service.list();
  assert.equal(room.status, "playing");
  const resumed = await startQuickGame({ request, storage });
  assert.equal(resumed.id, room.id);
  assert.equal(resumed.events.filter((event) => event.type === "start").length, 1);
});

test("quick HTTP: lost create response survives new clients and does not leave an orphan lobby", async (t) => {
  const { api, request, storage } = await setup(t);
  await assert.rejects(
    startQuickGame({
      storage,
      request: async (path, method, data) => {
        const result = await request(path, method, data);
        if (path === "/api/rooms" && method === "POST") throw new Error("lost create response");
        return result;
      },
    }),
    /lost create response/,
  );
  const [original] = await api.service.list();
  assert.equal(original.status, "lobby");
  assert.ok(storage.get(quickStorageKey("A01")).pendingCreations.A01.requestId);
  const resumed = await startQuickGame({ request, storage });
  assert.equal(resumed.id, original.id);
  assert.equal(resumed.status, "playing");
  assert.equal((await api.service.list()).length, 1);
  assert.deepEqual(storage.get(quickStorageKey("A01")).pendingCreations, {});
});

test("quick HTTP: after finish a new test game starts while the old archive is retained", async (t) => {
  const { api, request, storage } = await setup(t);
  const first = await startQuickGame({ request, storage });
  await request(`/api/rooms/${first.id}/actions`, "POST", {
    ...storage.get(quickStorageKey("A01")),
    type: "finish",
  });
  const archived = await api.service.get(first.id);
  const next = await startQuickGame({ request, storage });
  assert.notEqual(next.id, first.id);
  assert.equal(next.status, "playing");
  assert.deepEqual(await api.service.get(first.id), archived);
  for (const id of Object.keys(next.players))
    assert.equal(storage.get(quickStorageKey(id)).roomId, next.id);
});

test("quick: an offline service never attempts to create a game", async () => {
  let posts = 0;
  await assert.rejects(
    startQuickGame({
      storage: { get: () => null, set: () => {} },
      request: async (_path, method) => {
        if (method === "POST") posts++;
        throw new Error("offline");
      },
    }),
    /无法连接/,
  );
  assert.equal(posts, 0);
});

test("quick HTTP: repeated concurrent activation is rejected before another room can be made", async (t) => {
  const { api, request, storage } = await setup(t);
  let resume;
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const running = startQuickGame({
    storage,
    request: async (...args) => {
      await gate;
      return request(...args);
    },
  });
  await assert.rejects(startQuickGame({ storage, request }), /正在进行/);
  resume();
  await running;
  assert.equal((await api.service.list()).length, 1);
});
