import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { simulate } from "../../server/src/expedition/simulation.js";
import { tileById, TILES } from "../../server/src/expedition/map.js";
import { createGame, command } from "../../server/src/expedition/engine.js";
import { CHARACTERS, CARDS } from "../../server/src/expedition/catalog.js";
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
async function openHostControls(page) {
  const controls = page.locator(".world-lab");
  if (!(await controls.evaluate((node) => node.open)))
    await controls
      .getByText("主持／实验模式（手动调整不计玩家贡献）", { exact: true })
      .click();
  await expect(
    page.getByRole("slider", { name: "世界经济滑条" }),
  ).toBeVisible();
}
test("card hints cover characters, both actions and every technology; keyboard and hover never perform actions", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const character = page.locator(".character-grid .card-hint-trigger").first();
  await character.hover();
  await expect(page.getByRole("tooltip")).toContainText("没有额外技能");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const g = inspectionFixture();
  g.players[0].hand = [
    { uid: "C400", id: "invitation" },
    { uid: "C401", id: "technology" },
  ];
  g.players[0].equipment = CARDS.technology.map((c) => c.id);
  await loadInspectionFixture(page, g);
  for (const c of CARDS.actions) {
    await page
      .locator(".hand-cards")
      .getByLabel(`${c.name}效果说明`, { exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toContainText(c.effectSummary);
    await page.keyboard.press("Escape");
  }
  for (const c of CARDS.technology) {
    await page
      .locator(".equipment")
      .getByLabel(`${c.name}效果说明`, { exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toContainText(c.effectSummary);
    await expect(page.getByRole("tooltip")).toContainText("共享世界");
    await page.keyboard.press("Escape");
  }
  await page
    .locator(".hand-cards")
    .getByLabel("邀约效果说明", { exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toContainText("不是交换");
  await page
    .getByRole("tooltip")
    .screenshot({ path: info.outputPath("card-rule-tooltip.png") });
  await page.keyboard.press("Escape");
  expect((await local.service.get(g.id)).revision).toBe(g.revision);
  expect(errors).toEqual([]);
});

test("flood and read-only card hints fit phone viewport, click retains full implemented text", async ({
  page,
}, info) => {
  const g = inspectionFixture();
  await loadInspectionFixture(page, g);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("洪水上涨追踪效果说明", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("种子1");
  const rect = await page.getByRole("tooltip").boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "查看洪水卡 ↗" }).click();
  await expect(page.getByRole("dialog")).toContainText("本版实际规则");
  await expect(page.getByRole("dialog")).toContainText("第3/5/7轮末");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  const inspector = page.getByRole("region", { name: "P2 玩家只读详情" });
  await inspector.getByLabel("空间戒指效果说明", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("手牌上限变为8");
  await page.keyboard.press("Escape");
  await inspector
    .getByRole("button", { name: "查看科技卡面", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("从13种科技");
  await page.getByRole("dialog").getByRole("img").hover();
  await expect(page.getByRole("tooltip")).toContainText("抽2张科技");
  expect(
    await page.getByRole("tooltip").evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  ).toBe(true);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page
    .getByRole("dialog")
    .screenshot({ path: info.outputPath("card-details-phone.png") });
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await local.service.get(g.id)).revision).toBe(g.revision);
});

test("game goals and academic catalogue expose provenance, Chinese conclusions and honest archive state", async ({
  page,
}, info) => {
  await expect(
    page.getByRole("region", { name: "游戏核心目标" }),
  ).toContainText("活下来不等于一定能登船");
  await page.getByRole("button", { name: "规则与本地约定" }).click();
  await page
    .getByText("学术文献目录 · 中文结论与原文", { exact: true })
    .click();
  const library = page.locator(".academic-library");
  await expect(library.locator(".academic-source")).toHaveCount(22);
  await expect(library).toContainText("经济 7 份，环境 7 份，社会 8 份");
  await expect(library).toContainText("11 本教材");
  const textbook = library.locator('[data-source-id="core-economy-2022"]');
  await expect(textbook).toContainText("帕累托效率");
  await expect(textbook).toContainText("教材理论");
  await textbook.getByText("出处、原文与检索依据", { exact: true }).click();
  await expect(
    textbook.getByRole("link", { name: "原文教材章节 ↗" }),
  ).toHaveAttribute(
    "href",
    "https://books.core-econ.org/the-economy-v1/book/text/05.html",
  );
  await expect(textbook).toContainText("仅保留外部链接，未本地归档");
  await expect(textbook).not.toContainText("待下载");
  const source = library.locator('[data-source-id="acemoglu-2009"]');
  await source.getByText("出处、原文与检索依据", { exact: true }).click();
  await expect(
    source.getByRole("link", { name: "官方出处 ↗" }),
  ).toHaveAttribute("href", "https://www.nber.org/papers/w15451");
  await expect(
    source.getByRole("link", { name: "原文 PDF ↗" }),
  ).toHaveAttribute("href", "https://www.nber.org/papers/w15451.pdf");
  await expect(source).toContainText("工作论文");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await source.screenshot({
    path: info.outputPath("academic-source-phone.png"),
  });
  await textbook.screenshot({
    path: info.outputPath("textbook-source-phone.png"),
  });
});

test("discussion updates scholarly evidence and keeps earlier retrieval snapshots visible after refresh", async ({
  page,
}, info) => {
  const g = inspectionFixture();
  g.status = "awaiting_judgment";
  g.phase = "judgment";
  g.round = 8;
  g.players.forEach((p) => {
    p.position = "0,0";
  });
  g.ark.wood = 17;
  await loadInspectionFixture(page, g);
  await page.getByRole("button", { name: "请上帝审判这段航程" }).click();
  const panel = page.getByRole("region", { name: "登船审议" });
  await panel
    .getByLabel("玩家登船陈述")
    .fill("我受伤了，保留种子救生；应考虑资源少的处境和公平。");
  await panel.getByRole("button", { name: "提交发言并听取回应" }).click();
  await page.reload();
  await panel.getByText("本阶段学术依据与行为分析", { exact: true }).click();
  const current = panel.locator(".academic-current");
  await expect(current).toContainText("不代表模型理解了申辩");
  await expect(current.locator(".academic-source")).toHaveCount(6);
  await expect(current).toContainText("社会选择的可能性");
  const saved = await local.service.get(g.id);
  expect(saved.judgment.history).toHaveLength(2);
  expect(saved.judgment.history[0].rag.query).not.toContain("资源少的处境");
  expect(saved.judgment.rag.query).toContain("资源少的处境");
  await current.screenshot({
    path: info.outputPath("academic-discussion.png"),
  });
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
    if ([2, 4, 6].includes(round)) {
      const eventPanel = page.getByRole("region", { name: "公共事件二选一" });
      await expect(eventPanel).toBeVisible();
      await eventPanel
        .getByRole("button", { name: /^选择公共方案：/ })
        .first()
        .click();
      await expect(eventPanel).toHaveCount(0);
    }
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
  // UI-created games use the learning flow: a lone player has nobody to
  // evaluate, so explicitly waive rather than bypassing the review gate.
  await page
    .getByRole("button", { name: "未观察到，跳过互评", exact: true })
    .click();
  await page.getByRole("button", { name: "请上帝审判这段航程" }).click();
  await expect(page.locator(".boarding-decision")).toHaveCount(1);
  await expect(page.locator(".action-panel")).toContainText("本地规则审议");
  // No resources were gathered: no survivors/capacity, so no fabricated interview.
  await expect(page.getByLabel("玩家登船陈述", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "完成交互，请上帝敲定最终名单" })
    .click();
  await expect(page.locator(".boarding-panel > .overline")).toContainText(
    "最终名单",
  );
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
  await openHostControls(page);
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
  await page.getByLabel("财富悬殊效果说明", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("交1金属");
  await page.keyboard.press("Escape");
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
  await openHostControls(page);
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
  await openHostControls(page);
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
  if (g.status === "playing")
    await expect(page.locator(".action-panel .overline")).toContainText(
      g.pending?.actor || "P1",
    );
  else
    await expect(page.getByRole("region", { name: "登船审议" })).toBeVisible();
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
  await page.getByRole("button", { name: "想要电力", exact: true }).click();
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
  await openHostControls(page);
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
  await openHostControls(page);
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
    resource: "metal",
    actor: "P1",
    revision: g.revision,
  });
  await loadInspectionFixture(page, g);
  await expect(
    page.getByRole("heading", { name: "收到资源邀约" }),
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
  await page
    .getByRole("button", { name: "接受邀约并领取", exact: true })
    .click();
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
test("invitation can be sent from the hand and the recipient response is brought into view", async ({
  page,
}, info) => {
  const fixture = inspectionFixture();
  await loadInspectionFixture(page, fixture);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".hand-cards")
    .getByRole("button", { name: "使用", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "邀约领取流程" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "邀约卡 · 选择同伴与资源" }),
  ).toBeInViewport();
  await page.getByLabel("邀约对象", { exact: true }).selectOption("P2");
  await page.getByRole("button", { name: "想要金属", exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("invitation-compose-phone.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "发送邀约", exact: true }).click();
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  await expect(
    page.getByRole("button", { name: "接受邀约并领取", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "接受邀约并领取", exact: true })
    .click();
  const saved = await local.service.get(fixture.id);
  expect(saved.pending).toBeNull();
  expect(saved.activePlayerId).toBe("P1");
  expect(saved.players[0].resources.metal).toBe(1);
  expect(saved.players[1].resources.wood).toBe(1);
  expect(saved.players[0].hand).toHaveLength(0);
  await expect(page.getByText(/邀约已完成，双方各获得/)).toBeVisible();
});
test("invitation allows far nearest players and zero inventory; cancelling does not change state", async ({
  page,
}) => {
  const g = inspectionFixture();
  g.players[0].position = "0,0";
  g.players[1].position = "3,0";
  g.players[2].position = "4,0";
  g.players.forEach(
    (p) => (p.resources = { wood: 0, metal: 0, electricity: 0, seed: 0 }),
  );
  await loadInspectionFixture(page, g);
  const before = await local.service.get(g.id);
  await page
    .locator(".hand-cards")
    .getByRole("button", { name: "使用", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "邀约领取流程" });
  await expect(panel).toBeFocused();
  await panel.getByLabel("邀约对象", { exact: true }).selectOption("P2");
  await expect(
    panel.getByRole("button", { name: "发送邀约", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  expect(await local.service.get(g.id)).toEqual(before);
});
test("invitation reject/retry and refresh preserve the recipient choice and settle only once", async ({
  page,
}, info) => {
  const g = inspectionFixture();
  await loadInspectionFixture(page, g);
  async function send() {
    await page
      .locator(".hand-cards")
      .getByRole("button", { name: "使用", exact: true })
      .click();
    await page.getByLabel("邀约对象", { exact: true }).selectOption("P2");
    await page.getByRole("button", { name: "想要金属", exact: true }).click();
    await page.getByRole("button", { name: "发送邀约", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "收到资源邀约" }),
    ).toBeVisible();
  }
  await send();
  const offered = await local.service.get(g.id);
  expect(offered.players[0].resources.wood).toBe(3);
  expect(offered.players[0].hand).toHaveLength(1);
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(page.getByText(/对方拒绝，未增加或扣除资源/)).toBeVisible();
  const rejected = await local.service.get(g.id);
  expect(rejected.activePlayerId).toBe("P1");
  expect(rejected.players[0].resources.wood).toBe(3);
  expect(rejected.players[0].hand).toHaveLength(1);
  await send();
  await page.reload();
  const panel = page.getByRole("region", { name: "邀约领取流程" });
  await expect(
    panel.getByRole("button", { name: "接受邀约并领取", exact: true }),
  ).toBeInViewport();
  await expect(panel).toContainText("你可独立选择");
  await panel.screenshot({
    path: info.outputPath("invitation-response.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: info.outputPath("invitation-response-phone.png"),
    animations: "disabled",
  });
  await panel
    .getByRole("button", { name: "接受邀约并领取", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  const saved = await local.service.get(g.id);
  expect(
    saved.events.filter((e) => e.type === "invitation_offer"),
  ).toHaveLength(2);
  expect(
    saved.events.filter((e) => e.type === "invitation_accept"),
  ).toHaveLength(1);
  expect(saved.players[0].resources.wood).toBe(3);
  expect(saved.players[1].resources.wood).toBe(1);
  await page.reload();
  expect((await local.service.get(g.id)).players[0].resources.wood).toBe(3);
});
test("boarding council gives each survivor an independent turn, survives refresh and enforces resource capacity", async ({
  page,
}, info) => {
  const g = inspectionFixture();
  g.status = "awaiting_judgment";
  g.phase = "judgment";
  g.round = 8;
  g.floodLevel = 3;
  g.players[0].position = "0,0";
  g.players[1].position = "1,0";
  g.players[2].position = "5,0";
  g.ark = { wood: g.rules.arkUnitsPerSeat, metal: 0, electricity: 0, seed: 0 };
  await loadInspectionFixture(page, g);
  await page.getByRole("button", { name: "请上帝审判这段航程" }).click();
  const panel = page.getByRole("region", { name: "登船审议" });
  await expect(panel).toContainText("当前容量 1 人");
  await expect(panel).toContainText("幸存 2 / 3 人");
  await expect(
    panel.getByRole("button", { name: "完成交互，请上帝敲定最终名单" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  await expect(panel.getByLabel("玩家登船陈述")).toHaveCount(0);
  await panel.getByRole("button", { name: "返回当前发言玩家" }).click();
  await panel
    .getByLabel("玩家登船陈述")
    .fill("请核对我的真实贡献，不应增加船容量。");
  await panel.getByRole("button", { name: "提交发言并听取回应" }).click();
  await page.reload();
  await expect(panel).toContainText("剩余 1 人");
  await expect(panel).toContainText("请核对我的真实贡献");
  await panel.getByRole("button", { name: "该玩家放弃发言" }).click();
  await panel
    .getByRole("button", { name: "完成交互，请上帝敲定最终名单" })
    .click();
  await expect(panel).toContainText("最终名单");
  const saved = await local.service.get(g.id);
  expect(saved.status).toBe("finished");
  expect(saved.judgment.conversations.map((c) => c.playerId)).toEqual([
    "P1",
    "P2",
  ]);
  expect(saved.judgment.verdict.decisions.filter((d) => d.board)).toHaveLength(
    1,
  );
  expect(
    saved.judgment.verdict.decisions.find((d) => d.playerId === "P3").board,
  ).toBe(false);
  expect(saved.ark).toEqual(g.ark);
  await expect(
    page.getByRole("region", { name: "操作撤回与重做" }),
  ).toContainText("航程证据已锁定");
  await expect(page.getByRole("button", { name: /撤回上一步/ })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: info.outputPath("boarding-final-phone.png") });
});

test("undo/redo confirmation, cancel, inspection permissions, persistence and audit work on mobile", async ({
  page,
}, info) => {
  const g = inspectionFixture();
  await loadInspectionFixture(page, g);
  const panel = page.getByRole("region", { name: "操作撤回与重做" });
  const undo = panel.getByRole("button", { name: /撤回上一步/ });
  const redo = panel.getByRole("button", { name: /↷ 重做/ });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await page.getByRole("button", { name: "完成出牌，进入移动" }).click();
  await expect(undo).toBeEnabled();
  const before = await local.service.get(g.id);
  await undo.click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("P1");
  await expect(
    confirmation.getByRole("button", { name: "取消，保持现状" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  expect(await local.service.get(g.id)).toEqual(before);
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  await expect(undo).toBeDisabled();
  await expect(panel).toContainText("只读查看");
  await page
    .getByRole("button", { name: "返回当前行动玩家", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await undo.click();
  await expect(confirmation).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: info.outputPath("undo-confirm-phone.png") });
  await confirmation
    .getByRole("button", { name: "确认撤回", exact: true })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("使用手牌");
  await expect(redo).toBeEnabled();
  await page.reload();
  await expect(redo).toBeEnabled();
  await redo.click();
  await confirmation
    .getByRole("button", { name: "确认重做", exact: true })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("选择移动");
  const after = await local.service.get(g.id);
  expect(after.revision).toBe(before.revision + 2);
  expect(after.events).toEqual(before.events);
  expect(after.historyAudit.map((e) => e.type)).toEqual(["undo", "redo"]);
  await page
    .getByRole("button", { name: "撤回与重做记录", exact: true })
    .click();
  await expect(page.locator(".history-audit details")).toHaveCount(2);
  await expect(page.locator(".history-audit")).toContainText(
    "被撤回事件不计入有效航程或上帝审议",
  );
});

test("undoing an accepted invitation restores the recipient flow and can branch to refusal", async ({
  page,
}) => {
  const g = inspectionFixture();
  await loadInspectionFixture(page, g);
  await page
    .locator(".hand-cards")
    .getByRole("button", { name: "使用", exact: true })
    .click();
  await page.getByLabel("邀约对象", { exact: true }).selectOption("P2");
  await page.getByRole("button", { name: "想要金属", exact: true }).click();
  await page.getByRole("button", { name: "发送邀约", exact: true }).click();
  await page
    .getByRole("button", { name: "接受邀约并领取", exact: true })
    .click();
  await expect(page.locator(".action-panel .overline")).toContainText("P1");
  await page.getByRole("button", { name: /撤回上一步/ }).click();
  await page.getByRole("button", { name: "确认撤回", exact: true }).click();
  await expect(page.locator(".action-panel .overline")).toContainText("P2");
  await expect(
    page.getByRole("heading", { name: "收到资源邀约" }),
  ).toBeVisible();
  const view = await local.service.get(g.id);
  expect(view.players[0].resources.metal).toBe(0);
  expect(view.players[1].resources.wood).toBe(0);
  expect(view.players[0].hand).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(page.locator(".action-panel .overline")).toContainText("P1");
  await expect(page.getByRole("button", { name: /↷ 重做/ })).toBeDisabled();
  const refused = await local.service.get(g.id);
  expect(refused.events.some((e) => e.type === "invitation_accept")).toBe(
    false,
  );
  expect(refused.historyAudit.at(-1).type).toBe("branch");
});

test("stale undo confirmation cannot roll back another action; same-phase rollback clears world drafts", async ({
  page,
}) => {
  const g = inspectionFixture();
  await loadInspectionFixture(page, g);
  let view = await local.service.get(g.id);
  view = await local.service.action(g.id, {
    type: "set_world",
    actor: "P1",
    revision: view.revision,
    attributes: { economy: 11, environment: 10, society: 10 },
    reason: "first",
  });
  await expect(page.getByLabel("全局经济当前值")).toHaveText("11");
  await page.getByRole("button", { name: /撤回上一步/ }).click();
  view = await local.service.action(g.id, {
    type: "set_world",
    actor: "P1",
    revision: view.revision,
    attributes: { economy: 12, environment: 10, society: 10 },
    reason: "second",
  });
  await expect(page.getByRole("alertdialog")).toContainText("状态已更新");
  await expect(
    page.getByRole("button", { name: "确认撤回", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "取消，保持现状" }).click();
  expect((await local.service.get(g.id)).revision).toBe(view.revision);
  await openHostControls(page);
  const slider = page.getByLabel("世界经济滑条");
  await slider.fill("15");
  await expect(slider).toHaveValue("15");
  await page.getByRole("button", { name: /撤回上一步/ }).click();
  await page.getByRole("button", { name: "确认撤回", exact: true }).click();
  await expect(page.getByLabel("全局经济当前值")).toHaveText("11");
  await openHostControls(page);
  await expect(slider).toHaveValue("11");
});
test("flood warning shows ark loss, fixed and selectable costs, discount and real payment with icons", async ({
  page,
}, info) => {
  let g = inspectionFixture();
  g.round = 7;
  g.floodLevel = 2;
  g.turn = 2;
  g.phase = "donate";
  g.ark = { wood: 2, metal: 2, electricity: 2, seed: 0 };
  g.players[0].resources = { wood: 2, metal: 0, electricity: 2, seed: 2 };
  g.players[1].resources = { wood: 1, metal: 0, electricity: 0, seed: 1 };
  g.players[1].equipment = ["reserve-crate"];
  g = command(g, { type: "skip", actor: "P3", revision: g.revision });
  await loadInspectionFixture(page, g);
  const panel = page.getByRole("region", { name: "洪水扣除与缴纳明细" });
  await expect(
    panel.getByRole("heading", { name: "洪水已到来 · 请逐人结算" }),
  ).toBeInViewport();
  await expect(panel.getByLabel("方舟本次扣除")).toContainText("应扣 3 份");
  await expect(panel.getByLabel("方舟本次扣除")).toContainText("实际扣除 2 份");
  await expect(panel).toContainText("① 固定扣除");
  await expect(panel).toContainText("② 额外选扣");
  await expect(panel.locator(".resource-icon svg").first()).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "确认缴纳本次物资", exact: true }),
  ).toBeDisabled();
  const initial = await local.service.get(g.id);
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  await expect(panel).toContainText("只有 P1 可以确认这笔缴纳");
  await expect(
    panel.getByRole("button", { name: "确认缴纳本次物资", exact: true }),
  ).toHaveCount(0);
  expect((await local.service.get(g.id)).revision).toBe(initial.revision);
  await panel
    .getByRole("button", { name: "返回缴纳玩家", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "选择扣除木头", exact: true })
    .click();
  const preview = panel.getByLabel("本次实际缴纳预览");
  for (const name of ["木头 1", "电力 1", "种子 1"])
    await expect(preview.getByLabel(name, { exact: true })).toBeVisible();
  await panel.screenshot({
    path: info.outputPath("flood-payment-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: info.outputPath("flood-payment-phone.png"),
    animations: "disabled",
  });
  await panel
    .getByRole("button", { name: "确认缴纳本次物资", exact: true })
    .click();
  await expect(panel).toContainText("现在由 P2");
  await expect(panel).toContainText("储备仓生效");
  await expect(
    panel.getByLabel("本次实际缴纳预览").getByLabel("种子 1", { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "确认本次扣除 / 无可扣资源", exact: true })
    .click();
  await expect(panel).toContainText("现在由 P3");
  await expect(panel.getByLabel("本次实际缴纳预览")).toContainText("无");
  await panel
    .getByRole("button", { name: "确认本次扣除 / 无可扣资源", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  const saved = await local.service.get(g.id);
  expect(saved.round).toBe(8);
  expect(saved.ark).toEqual(initial.ark);
  expect(saved.players[0].resources).toEqual({
    wood: 1,
    metal: 0,
    electricity: 1,
    seed: 1,
  });
  expect(saved.players[1].resources.wood).toBe(1);
  expect(saved.players[1].resources.seed).toBe(0);
  expect(saved.events.filter((e) => e.type === "flood_payment")).toHaveLength(
    3,
  );
});
