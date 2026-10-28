import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { simulate } from "../../server/src/expedition/simulation.js";
import { tileById, TILES } from "../../server/src/expedition/map.js";
import { createGame, command } from "../../server/src/expedition/engine.js";
import { CHARACTERS } from "../../server/src/expedition/catalog.js";
let local;
test.beforeEach(async ({ page }) => {
  local = await testApi();
  await page.route("**/api/expeditions**", async (route) => {
    const url = new URL(route.request().url());
    const res = await route.fetch({ url: local.base + url.pathname });
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "01 / 选择同行者" }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await page.close();
  await local.close();
});
test("choose among ten avatars and flag spawns; board movement, gather, donation, refresh and card artwork", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".character-pick")).toHaveCount(10);
  await expect(
    page.getByRole("button", { name: "出生旗子 P2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "出生旗子 P2", exact: true }).click();
  await expect(page.getByLabel("出生旗子", { exact: true })).toHaveValue("P2");
  // P2 starts on an empty coastal stretch; use P1 for the first-turn gather test.
  await page.getByRole("button", { name: "出生旗子 P1", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("character-and-spawn.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "确认角色与旗子 · 开始航程 →" })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("第 1 / 8");
  const [summary] = await local.service.list();
  let g = await local.service.get(summary.id);
  expect(g.players[0].spawn).toBe("P1");
  await page.getByRole("button", { name: "完成出牌，进入移动" }).click();
  await expect(page.locator(".journey-strip")).toContainText("选择移动");
  g = await local.service.get(g.id);
  const id = Object.keys(g.reachable).find((id) => tileById(id).resource);
  expect(id).toBeTruthy();
  await page.getByRole("button", { name: new RegExp(`^格子 ${id}，`) }).click();
  await page.getByRole("button", { name: `移动到 ${id}`, exact: true }).click();
  await page
    .getByRole("button", { name: "采集当前位置资源", exact: true })
    .click();
  g = await local.service.get(g.id);
  const resource = tileById(id).resource;
  const labels = {
    wood: "木头",
    metal: "金属",
    electricity: "电力",
    seed: "种子",
  };
  await page.getByLabel(`上交${labels[resource]}`, { exact: true }).fill("1");
  await expect(
    page.getByLabel(`上交${labels[resource]}`, { exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "上交材料并结束行动" }).click();
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  g = await local.service.get(g.id);
  expect(g.ark[resource]).toBe(1);
  expect(g.donations).toHaveLength(1);
  await page.getByRole("button", { name: "方舟捐赠记录", exact: true }).click();
  await expect(page.locator(".donation-list")).toContainText(
    `${labels[resource]} 1`,
  );
  await page.getByRole("button", { name: "查看洪水卡 ↗" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const img = page.getByRole("dialog").getByRole("img");
  await expect
    .poll(() => img.evaluate((i) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".journey-strip")).toContainText(g.id);
  await expect(page.locator(".ark-resources")).toContainText("1");
  await page.screenshot({
    path: info.outputPath("web-map-game.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
test("full eight-round browser flow, three flood settlements and terminal god review with audit evidence", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  // One hot-seat browser walks every turn and every flood; no setup bypasses.
  await page.getByRole("button", { name: "移除此玩家", exact: true }).click();
  await page.getByRole("button", { name: "移除此玩家", exact: true }).click();
  await page
    .getByRole("button", { name: "确认角色与旗子 · 开始航程 →" })
    .click();
  for (let round = 1; round <= 8; round++) {
    await expect(page.locator(".journey-strip")).toContainText(
      `第 ${round} / 8`,
    );
    await page.getByRole("button", { name: "完成出牌，进入移动" }).click();
    await expect(page.locator(".journey-strip")).toContainText("选择移动");
    // Move toward the center to survive shrinkage, using real reachable hexes.
    const [summary] = await local.service.list(),
      g = await local.service.get(summary.id);
    const target = Object.keys(g.reachable).sort(
      (a, b) =>
        Math.hypot(tileById(a).x - 500, tileById(a).y - 500) -
        Math.hypot(tileById(b).x - 500, tileById(b).y - 500),
    )[0];
    await page
      .getByRole("button", { name: new RegExp(`^格子 ${target}，`) })
      .click();
    await page
      .getByRole("button", { name: `移动到 ${target}`, exact: true })
      .click();
    await page.getByRole("button", { name: "本回合不采集" }).click();
    await page.getByRole("button", { name: "不上交，结束行动" }).click();
    if ([3, 5, 7].includes(round)) {
      await expect(
        page.getByRole("heading", { name: "支付本次洪水损失" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "确认本次扣除 / 无可扣资源" })
        .click();
    }
  }
  await page.getByRole("button", { name: "请上帝审判这段航程" }).click();
  await expect(page.locator(".boarding-decision")).toHaveCount(1);
  await expect(page.locator(".action-panel")).toContainText("本地规则裁决");
  await page
    .getByLabel("终局申辩", { exact: true })
    .fill("请核对我向方舟移动的完整路线。");
  await page.getByRole("button", { name: "提交申辩，听取最终裁决" }).click();
  await expect(page.getByLabel("终局申辩", { exact: true })).toHaveCount(0);
  const [summary] = await local.service.list(),
    finished = await local.service.get(summary.id);
  expect(finished.status).toBe("finished");
  expect(
    finished.judgment.context.globalEvents.filter((e) => e.type === "flood"),
  ).toHaveLength(3);
  await page.screenshot({
    path: info.outputPath("terminal-judgment.png"),
    fullPage: true,
    animations: "disabled",
  });
});
test("six-player simulated match loads full history and responsive layout without horizontal overflow", async ({
  page,
}, info) => {
  const { game } = simulate({ seed: 18, players: 6 });
  game.id = "EXP-BROWSER";
  await local.store.write("expeditions.json", {
    schemaVersion: 1,
    games: [game],
  });
  await page.evaluate(
    (id) => localStorage.setItem("noah-expedition-id", id),
    game.id,
  );
  await page.reload();
  await expect(page.locator(".player-roster article")).toHaveCount(6);
  await page.getByRole("button", { name: "请上帝审判这段航程" }).click();
  await expect(page.locator(".boarding-decision")).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("map-phone-width.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("manual world sliders apply once, stack disaster cards, persist globally, and support protection confirmation", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "确认角色与旗子 · 开始航程 →" })
    .click();
  const panel = page.getByRole("region", { name: "全局共享世界状态" });
  await expect(page.getByLabel("全局经济当前值")).toHaveText("10");
  const slider = page.getByRole("slider", { name: "世界经济滑条" });
  await slider.focus();
  for (let i = 0; i < 8; i++) await slider.press("ArrowRight");
  await expect(page.getByLabel("世界经济数值")).toHaveValue("18");
  await expect(page.getByLabel("全局经济当前值")).toHaveText("10");
  await page.getByLabel("世界调节原因").fill("测试极高经济叠加");
  await page.getByRole("button", { name: "应用世界分数并结算灾难" }).click();
  await expect(page.getByLabel("全局经济当前值")).toHaveText("18");
  await expect(page.locator('[data-disaster-id="develop-first"]')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-disaster-id="wealth-gap"]')).toHaveCount(1);
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(".action-panel .overline")).toContainText(
      `P${i + 1}`,
    );
    await page.getByRole("button", { name: "领取金属", exact: true }).click();
  }
  await expect(page.getByLabel("灾难效果选择")).toHaveCount(0);
  const [row] = await local.service.list(),
    first = await local.service.get(row.id);
  expect(
    first.events.filter(
      (e) => e.type === "disaster_resource" && e.mode === "disaster_gain",
    ),
  ).toHaveLength(3);
  await page.getByLabel("世界经济数值").fill("19");
  await page.getByLabel("世界调节原因").fill("同档不重复");
  await page.getByRole("button", { name: "应用世界分数并结算灾难" }).click();
  await expect(page.getByLabel("全局经济当前值")).toHaveText("19");
  const second = await local.service.get(row.id);
  expect(
    second.events.filter(
      (e) => e.type === "disaster_resource" && e.mode === "disaster_gain",
    ),
  ).toHaveLength(3);
  await page.reload();
  await expect(page.getByLabel("全局经济当前值")).toHaveText("19");
  await expect(page.locator(".player-roster")).not.toContainText("经济");
  await page.getByLabel("世界环境数值").fill("17");
  await page.getByLabel("世界调节原因").fill("测试资源保护");
  await page.getByRole("button", { name: "应用世界分数并结算灾难" }).click();
  await expect(page.getByLabel("全局环境当前值")).toHaveText("17");
  const tile = TILES.find((t) => t.resource === "wood" && t.zone === 1);
  await page
    .getByRole("button", { name: new RegExp(`^格子 ${tile.id}，`) })
    .click();
  await page.getByLabel("资源保护条件说明").fill("玩家确认保护这片林地");
  await page.getByRole("button", { name: "确认成功保护 · 环境 +1" }).click();
  await expect(page.getByLabel("全局环境当前值")).toHaveText("18");
  await expect(page.locator('[data-disaster-id="eco-conflict"]')).toHaveCount(
    1,
  );
  await expect(
    page.locator('[data-disaster-id="resource-protection"]'),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("shared-world-and-stacked-disasters.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: info.outputPath("shared-world-phone.png"),
    animations: "disabled",
  });
});

test("eco response spends actual resources, cancels tech, and preserves shared world", async ({
  page,
}) => {
  let g = createGame(
    {
      players: CHARACTERS.slice(0, 2).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { id: "EXP-ECOUI", seed: 1 },
  );
  g = command(g, {
    type: "set_world",
    actor: "P1",
    revision: g.revision,
    attributes: { economy: 10, environment: 18, society: 10 },
    reason: "生态响应浏览器夹具",
  });
  g.players[0].position = "0,0";
  g.players[1].position = "1,0";
  g.players[1].resources.wood = 1;
  g.phase = "choice";
  g.pending = {
    kind: "technology",
    actor: "P1",
    choices: ["mining-drone"],
    resume: "cards",
  };
  await local.store.write("expeditions.json", { schemaVersion: 1, games: [g] });
  await page.evaluate(
    (id) => localStorage.setItem("noah-expedition-id", id),
    g.id,
  );
  await page.reload();
  await page.getByRole("button", { name: "采矿无人机", exact: true }).click();
  await page
    .getByRole("button", { name: "获得 采矿无人机 的收益", exact: true })
    .click();
  await expect(page.getByLabel("灾难效果选择")).toContainText("生态管制冲突");
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  await page
    .getByRole("button", { name: "支付并阻止木头", exact: true })
    .click();
  await expect(page.getByLabel("灾难效果选择")).toHaveCount(0);
  await expect(page.getByLabel("全局环境当前值")).toHaveText("18");
  const saved = await local.service.get(g.id);
  expect(saved.players[1].resources.wood).toBe(0);
  expect(saved.players[0].equipment).not.toContain("mining-drone");
  expect(saved.events.some((e) => e.type === "ecology_block")).toBe(true);
});

function inspectionFixture() {
  const g = createGame(
    {
      players: CHARACTERS.slice(0, 3).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
        name: `测试玩家${i + 1}`,
      })),
    },
    { id: "EXP-INSPECT", seed: 11 },
  );
  g.players.forEach((p) => {
    p.position = "0,0";
  });
  g.players[0].hand = [{ id: "invitation", uid: "C100" }];
  g.players[0].resources.wood = 3;
  g.players[1].hand = [
    { id: "technology", uid: "C101" },
    { id: "invitation", uid: "C102" },
  ];
  g.players[1].equipment = ["aid-beacon", "space-ring"];
  g.players[1].resources.metal = 2;
  g.players[1].donated.seed = 4;
  g.players[1].worldImpact.economy = 2;
  g.players[2].hand = [];
  g.cardCounter = 102;
  return g;
}
async function loadInspectionFixture(page, g) {
  await local.store.write("expeditions.json", { schemaVersion: 1, games: [g] });
  await page.evaluate(
    (id) => localStorage.setItem("noah-expedition-id", id),
    g.id,
  );
  await page.reload();
  await expect(page.locator(".action-panel .overline")).toContainText(
    g.pending?.actor || "P1",
  );
}
test("inspect player cards and inventories read-only, clear action drafts, then return to the real actor", async ({
  page,
}, info) => {
  const fixture = inspectionFixture();
  await loadInspectionFixture(page, fixture);
  const initial = await local.service.get(fixture.id);
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/expeditions")
    )
      posts++;
  });
  // An unfinished invitation must not leak into another player's view.
  await page
    .locator(".hand-cards")
    .getByRole("button", { name: "使用", exact: true })
    .click();
  await page.getByLabel("给出木头", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  const inspector = page.getByRole("region", { name: "P2 玩家只读详情" });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("测试玩家2");
  await expect(inspector.locator(".hand-heading")).toContainText("2 / 8");
  await expect(
    inspector.locator(".inspection-inventory").first(),
  ).toContainText("金属2");
  await expect(inspector.locator(".inspection-inventory").nth(1)).toContainText(
    "种子4",
  );
  await expect(inspector).toContainText("互助信标");
  await expect(inspector).toContainText("空间戒指");
  await expect(inspector.locator(".inspection-impact")).toContainText("经济 2");
  await expect(page.locator(".action-panel")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(使用|弃置|使用互助信标交换|发送交换请求|完成出牌，进入移动 →)$/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("slider", { name: "世界经济滑条" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "应用世界分数并结算灾难" }),
  ).toBeDisabled();
  await expect(page.getByLabel("玩家查看与行动状态")).toContainText(
    "当前行动：P1",
  );
  await inspector
    .getByRole("button", { name: "查看科技卡面", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await inspector
    .getByRole("button", { name: "查看互助信标卡面", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await inspector.screenshot({
    path: info.outputPath("player-inspector-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await inspector.screenshot({
    path: info.outputPath("player-inspector-phone.png"),
    animations: "disabled",
  });
  const third = page.getByRole("button", {
    name: "查看 P3 玩家详情",
    exact: true,
  });
  await third.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "P3 玩家只读详情" }),
  ).toContainText("暂无手牌");
  await expect(
    page.getByRole("region", { name: "P3 玩家只读详情" }),
  ).toContainText("暂无已生效科技");
  expect(posts).toBe(0);
  expect(await local.service.get(fixture.id)).toEqual(initial);
  await page
    .getByRole("button", { name: "返回当前行动玩家", exact: true })
    .click();
  await expect(page.locator(".action-panel .overline")).toContainText("P1");
  await expect(page.locator(".trade-form")).toHaveCount(0);
  await expect(
    page.getByRole("slider", { name: "世界经济滑条" }),
  ).toBeEnabled();
  for (const name of [
    "完成出牌，进入移动",
    "本回合不移动",
    "本回合不采集",
    "不上交，结束行动",
  ])
    await page.getByRole("button", { name, exact: false }).click();
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  expect((await local.service.get(fixture.id)).turn).toBe(1);
  expect(posts).toBe(4);
});
test("inspection does not steal a pending trade response or its resumed turn", async ({
  page,
}) => {
  let g = inspectionFixture();
  g = command(g, {
    type: "play",
    cardUid: "C100",
    targetId: "P2",
    give: { wood: 1 },
    receive: { metal: 1 },
    actor: "P1",
    revision: g.revision,
  });
  await loadInspectionFixture(page, g);
  await expect(
    page.getByRole("heading", { name: "收到资源交换请求" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "查看 P1 玩家详情", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "P1 玩家只读详情" }),
  ).toBeVisible();
  await expect(page.locator(".pending-choice")).toHaveCount(0);
  await expect(page.getByLabel("玩家查看与行动状态")).toContainText(
    "当前行动：P2",
  );
  expect((await local.service.get(g.id)).pending.actor).toBe("P2");
  await page
    .getByRole("button", { name: "返回当前行动玩家", exact: true })
    .click();
  await page.getByRole("button", { name: "接受交换", exact: true }).click();
  await expect(page.locator(".action-panel .overline")).toContainText("P1");
  const saved = await local.service.get(g.id);
  expect(saved.pending).toBeNull();
  expect(saved.players[0].resources.metal).toBe(1);
  expect(saved.players[1].resources.wood).toBe(1);
});
test("polling keeps another player's inspection read-only as the actual turn changes", async ({
  page,
}) => {
  const fixture = inspectionFixture();
  await loadInspectionFixture(page, fixture);
  await page
    .getByRole("button", { name: "查看 P3 玩家详情", exact: true })
    .click();
  let game = await local.service.get(fixture.id);
  for (let i = 0; i < 4; i++)
    game = await local.service.action(game.id, {
      type: "skip",
      actor: game.activePlayerId,
      revision: game.revision,
    });
  await expect(page.getByLabel("玩家查看与行动状态")).toContainText(
    "当前行动：P2",
  );
  await expect(
    page.getByRole("region", { name: "P3 玩家只读详情" }),
  ).toBeVisible();
  await expect(page.locator(".action-panel")).toHaveCount(0);
  await page
    .getByRole("button", { name: "返回当前行动玩家", exact: true })
    .click();
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  await page.reload();
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  await expect(page.locator(".player-inspector")).toHaveCount(0);
});
