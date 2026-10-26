import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { simulate } from "../../server/src/expedition/simulation.js";
import { tileById } from "../../server/src/expedition/map.js";
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
