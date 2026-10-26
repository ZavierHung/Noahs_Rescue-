import assert from "node:assert/strict";
import test from "node:test";
import { createClient, parseRoomCode } from "../../miniprogram/shared/client.js";
import { ROLES, blankScores } from "../src/rooms/rules.js";
import { prepareParty } from "../../miniprogram/shared/party.js";

function room(revision = 1, status = "lobby") {
  return {
    id: "GAME-client-test",
    revision,
    status,
    round: 1,
    scoreRevision: 0,
    players: { A03: { roleId: "A03", online: true, ready: false } },
    scores: blankScores(),
    events: [],
    judgments: [],
    activeDisasters: [],
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(request, options = {}) {
  const memory = new Map([
    [
      "client-test",
      { roleId: "A03", clientId: "test-client-credential", roomId: "GAME-client-test" },
    ],
  ]);
  const client = createClient({
    request,
    storageKey: "client-test",
    storage: { get: (k) => memory.get(k), set: (k, v) => memory.set(k, v) },
    ...options,
  });
  return { client, memory };
}

test("late polling response cannot roll a completed action back to an older room revision", async () => {
  const slow = deferred();
  let polls = 0;
  const { client } = fixture(async (path) => {
    if (path === "/api/roles") return ROLES;
    if (path.endsWith("/actions")) return room(2, "playing");
    if (path === "/api/rooms") return ++polls === 1 ? [room()] : slow.promise;
  });
  await client.init();
  client.openGame();
  const poll = client.refresh();
  await client.act("start");
  assert.equal(client.getState().room.revision, 2);
  slow.resolve([room()]);
  await poll;
  assert.equal(client.getState().room.revision, 2);
  assert.equal(client.getState().screen, "game");
});

test("polling recovers missing role metadata and clears connection errors after initial network failure", async () => {
  let offline = true;
  const { client } = fixture(async (path) => {
    if (offline) throw new Error("模拟断网");
    return path === "/api/roles" ? ROLES : [room()];
  });
  await client.init();
  assert.equal(client.getState().connected, false);
  offline = false;
  await client.refresh();
  assert.equal(client.getState().roles.length, 6);
  assert.equal(client.getState().role.name, "北极熊");
  assert.equal(client.getState().error, "");
});

test("successful create and join return the actual room; failure does not return an old room", async () => {
  let fail = false;
  const { client } = fixture(async (path) => {
    if (fail) throw new Error("模拟创建失败");
    if (path === "/api/roles") return ROLES;
    return room();
  });
  assert.equal((await client.create())?.id, "GAME-client-test");
  assert.equal((await client.join("GAME-client-test"))?.id, "GAME-client-test");
  fail = true;
  assert.equal(await client.create(), undefined);
  assert.match(client.getState().error, /创建失败/);
});

test("public view data contains neither undefined native setData fields nor local credentials", async () => {
  const unowned = { ...room(), players: {} };
  const { client } = fixture(async (path) => (path === "/api/roles" ? ROLES : [unowned]));
  await client.init();
  const view = client.getState();
  assert.equal(view.me, null);
  assert.equal(view.clientId, undefined);
  assert.deepEqual(view, JSON.parse(JSON.stringify(view)));
});

test("a disposed controller stops polling and must not overwrite a newer mounted identity", async () => {
  const slow = deferred();
  const { client, memory } = fixture(async (path) =>
    path === "/api/roles" ? ROLES : slow.promise,
  );
  const init = client.init();
  client.dispose();
  memory.set("client-test", { roleId: "H01", clientId: "new-mounted-credential", roomId: null });
  slow.resolve([room()]);
  await init;
  assert.equal(memory.get("client-test").roleId, "H01");
});

test("a background action cannot pull the player away from records after navigation", async () => {
  const slow = deferred();
  const { client } = fixture(async (path) =>
    path === "/api/roles" ? ROLES : path.endsWith("/actions") ? slow.promise : [room(1, "playing")],
  );
  await client.init();
  client.openGame();
  const action = client.act("advance");
  client.navigate("records");
  slow.resolve(room(2, "playing"));
  await action;
  assert.equal(client.getState().screen, "records");
  assert.equal(client.getState().room.revision, 2);
});

test("old polling errors cannot replace the result of a newer successful action", async () => {
  let rejectPoll;
  const slow = new Promise((_resolve, reject) => {
    rejectPoll = reject;
  });
  let polls = 0;
  const { client } = fixture(async (path) =>
    path === "/api/roles"
      ? ROLES
      : path.endsWith("/actions")
        ? room(2, "playing")
        : ++polls === 1
          ? [room()]
          : slow,
  );
  await client.init();
  const poll = client.refresh();
  await client.act("start");
  rejectPoll(new Error("过时的网络错误"));
  await poll;
  assert.equal(client.getState().connected, true);
  assert.equal(client.getState().error, "");
});

function partyStub() {
  return Array.from({ length: 6 }, () => {
    const view = {
      connected: true,
      busy: false,
      roomId: null,
      room: null,
      readyCount: 6,
      error: "",
    };
    return {
      getState: () => view,
      refresh: async () => {},
      create: async () => room(),
      join: async () => room(),
      act: async () => {
        view.roomId = room().id;
        return room();
      },
    };
  });
}
test("one-click party setup reports failed creation instead of reusing a previous room id", async () => {
  const clients = partyStub();
  let joined = false;
  Object.assign(clients[0].getState(), {
    roomId: "GAME-old",
    room: { status: "finished" },
    error: "创建失败",
  });
  clients[0].create = async () => undefined;
  clients[1].join = async () => {
    joined = true;
  };
  await assert.rejects(prepareParty(clients), /创建失败/);
  assert.equal(joined, false);
});
test("one-click party setup must not report success when one ready request fails", async () => {
  const clients = partyStub();
  clients[4].act = async () => undefined;
  await assert.rejects(prepareParty(clients), /准备失败/);
});
test("one-click party setup verifies all six ready states before reporting success", async () => {
  const clients = partyStub();
  assert.equal(await prepareParty(clients), room().id);
  const second = partyStub();
  second[5].getState().readyCount = 5;
  await assert.rejects(prepareParty(second), /尚未确认/);
});

test("room code entry accepts normalized short/full codes but never URLs or arbitrary paths", () => {
  assert.equal(parseRoomCode("  a1b2c3d4 "), "GAME-A1B2C3D4");
  assert.equal(parseRoomCode("game-1234abcd"), "GAME-1234ABCD");
  for (const invalid of [
    "",
    "../rooms",
    "ABCDEFGH",
    "https://host/GAME-1234ABCD",
    "GAME-123456789",
  ])
    assert.throws(() => parseRoomCode(invalid), /8 位房间码/);
});

test("pending creation is private, persists on uncertainty and clears on definite rejection", async () => {
  let failure = Object.assign(new Error("offline"), { status: 503 });
  const { client, memory } = fixture(async () => {
    throw failure;
  });
  await client.create();
  const pending = memory.get("client-test").pendingCreations.A03;
  assert.ok(pending.requestId);
  assert.equal(client.getState().pendingCreate, true);
  assert.equal(client.getState().pendingCreations, undefined);
  assert.equal(JSON.stringify(client.getState()).includes(pending.requestId), false);
  failure = Object.assign(new Error("invalid"), { status: 400 });
  await client.create();
  assert.equal(client.getState().pendingCreate, false);
});

test("player history is a view filter based on remembered rooms, not all local rooms", async () => {
  const unrelated = { ...room(), id: "GAME-unrelated" };
  const { client } = fixture(async (path) => (path === "/api/roles" ? ROLES : [room(), unrelated]));
  await client.init();
  assert.equal(client.getState().rooms.length, 2);
  assert.deepEqual(
    client.getState().myRooms.map((item) => item.id),
    [room().id],
  );
});
