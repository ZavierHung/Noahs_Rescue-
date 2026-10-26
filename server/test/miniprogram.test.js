import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { createClient, parseRoleCode, parseRoomCode } from "../../miniprogram/shared/client.js";
import * as guide from "../../miniprogram/shared/player-guide.js";
import { startQuickGame, quickStorageKey } from "../../miniprogram/shared/quick-game.js";
import { startLocalTestApi } from "../../tests/helpers/local-api.mjs";

const root = new URL("../../miniprogram/", import.meta.url);
test("native project config resolves all pages; JS syntax and WXML handler bindings are valid", async () => {
  const app = JSON.parse(await readFile(new URL("app.json", root), "utf8"));
  const project = JSON.parse(await readFile(new URL("project.config.json", root), "utf8"));
  assert.equal(project.compileType, "miniprogram");
  assert.equal(project.setting.es6, true);
  for (const page of app.pages) {
    const js = await readFile(new URL(`${page}.js`, root), "utf8");
    const wxml = await readFile(new URL(`${page}.wxml`, root), "utf8");
    JSON.parse(await readFile(new URL(`${page}.json`, root), "utf8"));
    execFileSync(process.execPath, ["--check", new URL(`${page}.js`, root).pathname]);
    let definition;
    // Only imports are removed: execute the actual Page definition, not a copy.
    vm.runInNewContext(js.replace(/^import[\s\S]*?;\n/gm, ""), {
      ...guide,
      parseRoomCode,
      Page: (value) => {
        definition = value;
      },
      createClient,
      parseRoleCode,
    });
    for (const binding of wxml.matchAll(/(?:bind\w+|catch\w+)="(\w+)"/g))
      assert.equal(
        typeof definition[binding[1]],
        "function",
        `missing native handler ${binding[1]}`,
      );
    for (const screen of [
      "role",
      "rooms",
      "lobby",
      "game",
      "report",
      "records",
      "detail",
      "finished",
    ])
      assert.ok(wxml.includes(`screen === '${screen}'`));
    assert.match(wxml, /bindtap="settle"/);
    assert.match(wxml, /min="1" max="19"/);
    assert.match(js, /wx\.scanCode/);
  }
});

test("native lifecycle and QR selection wire into the same controller, with platform calls mocked", async () => {
  const js = await readFile(new URL("pages/index/index.js", root), "utf8");
  let page,
    ticks = 0,
    cleared = 0,
    pullStopped = false;
  const memory = new Map();
  const wx = {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    request: (options) =>
      options.success({
        statusCode: 200,
        data: options.url.endsWith("/api/roles")
          ? [{ id: "A03", name: "北极熊", team: "animals", badge: "BEAR" }]
          : [],
      }),
    scanCode: (options) => options.success({ result: "noahs-rescue://role/A03" }),
    showToast: () => {},
    stopPullDownRefresh: () => {
      pullStopped = true;
    },
  };
  vm.runInNewContext(js.replace(/^import[\s\S]*?;\n/gm, ""), {
    ...guide,
    parseRoomCode,
    Page: (value) => {
      page = value;
    },
    createClient,
    parseRoleCode,
    API_BASE: "http://test",
    wx,
    setInterval: () => ++ticks,
    clearInterval: () => cleared++,
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.connected, true);
  page.scan();
  assert.equal(page.data.roleId, "A03");
  page.onShow();
  assert.equal(ticks, 1);
  await page.onPullDownRefresh();
  assert.equal(pullStopped, true);
  page.onHide();
  page.onUnload();
  assert.ok(cleared >= 3);
});

test("native role/room switches clear stale score edits and drafts, including null oracle transitions", async () => {
  const js = await readFile(new URL("pages/index/index.js", root), "utf8");
  let page, update;
  vm.runInNewContext(js.replace(/^import[\s\S]*?;\n/gm, ""), {
    ...guide,
    parseRoomCode,
    Page: (value) => {
      page = value;
    },
    createClient: (options) => {
      update = options.onChange;
      return { init() {} };
    },
    parseRoleCode,
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad({});
  Object.assign(page.data, {
    roleId: "A03",
    roomId: "GAME-old",
    oracle: { id: "old-oracle" },
    room: { status: "playing" },
    pending: false,
    edit: { value: 1, scoreRevision: 0 },
    reason: "旧房间调整原因",
    reportText: "旧房间汇报",
    rebuttalText: "旧房间驳斥",
  });
  update({
    roleId: "H01",
    roomId: "GAME-new",
    room: { status: "playing" },
    oracle: null,
    pending: false,
  });
  assert.equal(page.data.edit, null);
  assert.equal(page.data.reason, "");
  assert.equal(page.data.reportText, "");
  assert.equal(page.data.rebuttalText, "");
  Object.assign(page.data, { edit: { value: 2 }, reason: "未保存调整" });
  update({
    roleId: "H01",
    roomId: "GAME-new",
    room: { status: "playing" },
    oracle: { id: "new" },
    pending: true,
  });
  assert.equal(page.data.edit, null);
});

test("native quick start uses real HTTP, switches six test identities and restores the manual game", async (t) => {
  const local = await startLocalTestApi();
  t.after(() => local.close());
  const js = await readFile(new URL("pages/index/index.js", root), "utf8");
  const memory = new Map();
  let page;
  vm.runInNewContext(js.replace(/^import[\s\S]*?;\n/gm, ""), {
    ...guide,
    parseRoomCode,
    Page: (value) => {
      page = value;
    },
    createClient,
    parseRoleCode,
    startQuickGame,
    quickStorageKey,
    API_BASE: local.base,
    clearInterval() {},
    wx: {
      getStorageSync: (key) => memory.get(key),
      setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
      request: (options) =>
        fetch(options.url, {
          method: options.method,
          headers: options.header,
          ...(options.data ? { body: JSON.stringify(options.data) } : {}),
        })
          .then(async (response) =>
            options.success({ statusCode: response.status, data: await response.json() }),
          )
          .catch(options.fail),
    },
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.attachClient();
  await page.client.init();
  const manual = await page.client.create();
  page.toggleGuide();
  assert.equal(page.data.showGuide, true);
  assert.equal(page.data.guide.length, 5);
  page.toggleGuide();
  page.roomCodeInput({ detail: { value: "../invalid" } });
  await page.joinCode();
  assert.match(page.data.error, /8 位房间码/);
  page.roomCodeInput({ detail: { value: manual.id.slice(5).toLowerCase() } });
  await page.joinCode();
  assert.equal(page.data.room.id, manual.id);
  await page.quickStart();
  assert.equal(page.data.testMode, true);
  assert.equal(page.data.room.status, "playing");
  assert.equal(page.data.screen, "game");
  const id = page.data.room.id;
  await page.selectRole({ currentTarget: { dataset: { id: "H01" } } });
  assert.equal(page.data.roleId, "H01");
  assert.equal(page.data.room.id, id);
  assert.equal(page.data.me.online, true);
  await page.quickStart();
  assert.equal(page.data.room.id, id);
  assert.equal((await local.service.list()).length, 2);
  await page.manualMode();
  assert.equal(page.data.testMode, false);
  assert.equal(page.data.room.id, manual.id);
  assert.equal(page.data.screen, "lobby");
  page.onUnload();
});

test("native disaster cards preserve proportions and preview only the selected packaged card", async () => {
  const js = await readFile(new URL('pages/index/index.js', root), 'utf8');
  const wxml = await readFile(new URL('pages/index/index.wxml', root), 'utf8');
  assert.match(wxml, /class="disaster-art"[^>]+mode="widthFix"/);
  let page, preview;
  vm.runInNewContext(js.replace(/^import[\s\S]*?;\n/gm, ''), {
    ...guide,
    Page: (value) => { page = value; },
    wx: { previewImage: (options) => { preview = options; } },
  });
  page.data.room = { activeDisasters: [
    { id: 'deflation', image: { file: 'deflation.jpg' } },
    { id: 'depression', image: { file: 'depression.jpg' } },
    { id: 'legacy-no-image' },
  ] };
  page.previewDisaster({ currentTarget: { dataset: { id: 'depression' } } });
  assert.equal(preview.current, '/assets/disasters/depression.jpg');
  assert.equal(preview.urls.length, 2);
  preview = null;
  page.previewDisaster({ currentTarget: { dataset: { id: 'legacy-no-image' } } });
  assert.equal(preview, null);
});

test("mobile artwork is packaged locally, byte-identical on web/native and below 600 KB total", async () => {
  let total = 0;
  for (const name of ["ark-companions.jpg", "oracle-sanctuary.jpg"]) {
    const native = await readFile(new URL(`assets/${name}`, root));
    const web = await readFile(new URL(`../../app/public/images/${name}`, import.meta.url));
    assert.deepEqual(native, web);
    assert.equal(native.subarray(0, 2).toString("hex"), "ffd8");
    total += native.length;
  }
  assert.ok(total < 600 * 1024);
});
