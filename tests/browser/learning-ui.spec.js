import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { createGame } from "../../server/src/expedition/engine.js";
import { CHARACTERS } from "../../server/src/expedition/catalog.js";
import { TILES } from "../../server/src/expedition/map.js";

let local;
test.beforeEach(async ({ page }) => {
  local = await testApi();
  await page.route("**/api/expeditions**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: local.base + url.pathname });
    await route.fulfill({
      response,
      headers: { ...response.headers(), "access-control-allow-origin": "*" },
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

function gatherFixture(learningMode = true) {
  const game = createGame(
    {
      learningMode,
      players: CHARACTERS.slice(0, 3).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { id: "EXP-LEARNINGUI", seed: 11 },
  );
  const tile = TILES.find(
    (t) => t.zone === 1 && t.resource && t.terrain !== "water",
  );
  game.phase = "gather";
  game.players[0].position = tile.id;
  game.players[0].equipment = ["mining-drone"];
  game.players[1].equipment = ["mining-drone"];
  return { game, tile };
}
async function loadFixture(page, game) {
  await local.store.write("expeditions.json", {
    schemaVersion: 1,
    games: [game],
  });
  await page.evaluate(
    (id) => localStorage.setItem("noah-expedition-id", id),
    game.id,
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "当前玩家操作" }),
  ).toBeVisible();
}

test("six-player quick start enables learning rules and host adjustments stay collapsed and explicit", async ({
  page,
}, info) => {
  await page
    .getByRole("button", { name: "六人快速开局 →", exact: true })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("第 1 / 8");
  const [row] = await local.service.list();
  const game = await local.service.get(row.id);
  expect(game.learningMode).toBe(true);
  expect(game.players).toHaveLength(6);
  expect(new Set(game.players.map((p) => p.spawn)).size).toBe(6);
  await expect(page.getByLabel("全局环境当前值", { exact: true })).toHaveText(
    "10",
  );
  await expect(
    page.getByLabel("世界环境滑条", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "前往本步操作 ↓" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("learning-start-desktop.png"),
  });
  await page
    .getByText("主持／实验模式（手动调整不计玩家贡献）", { exact: true })
    .click();
  await page.getByLabel("世界环境数值", { exact: true }).fill("9");
  await expect(
    page.getByRole("button", { name: "应用世界分数并结算灾难" }),
  ).toBeDisabled();
  expect((await local.service.get(row.id)).revision).toBe(game.revision);
  await page
    .getByLabel("世界调节原因", { exact: true })
    .fill("课堂实验：比较轻微变化");
  await page.getByRole("button", { name: "应用世界分数并结算灾难" }).click();
  await expect(page.getByLabel("全局环境当前值", { exact: true })).toHaveText(
    "9",
  );
  const saved = await local.service.get(row.id);
  expect(saved.players[0].worldImpact.environment).toBe(0);
  await page
    .getByText("主持／实验模式（手动调整不计玩家贡献）", { exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "全局共享世界状态" })
    .screenshot({ path: info.outputPath("compact-world-phone.png") });
});

test("new drone rules show the real benefit and cost, keyboard inspection is read-only, boosting is explicit", async ({
  page,
}) => {
  const { game, tile } = gatherFixture();
  await loadFixture(page, game);
  await page
    .locator(".equipment")
    .getByLabel("采矿无人机效果说明", { exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toContainText("可选增产");
  await expect(page.getByRole("tooltip")).toContainText("环境−1");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  const inspector = page.getByRole("region", { name: "P2 玩家只读详情" });
  await inspector.getByLabel("采矿无人机效果说明", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText("普通采集不加成");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "无人机增产 · 资源 +1 / 环境 −1" }),
  ).toHaveCount(0);
  expect((await local.service.get(game.id)).revision).toBe(game.revision);
  await page
    .getByRole("button", { name: "返回当前行动玩家", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "无人机增产 · 资源 +1 / 环境 −1",
      exact: true,
    })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("上交材料");
  const saved = await local.service.get(game.id);
  expect(saved.players[0].resources[tile.resource]).toBe(2);
  expect(saved.attributes.environment).toBe(9);
});

test("regular gathering avoids the drone cost while old saves retain automatic bonus and original tooltip", async ({
  page,
}) => {
  const fresh = gatherFixture();
  await loadFixture(page, fresh.game);
  await page
    .getByRole("button", { name: "常规采集 · 不额外消耗环境", exact: true })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("上交材料");
  const normal = await local.service.get(fresh.game.id);
  expect(normal.players[0].resources[fresh.tile.resource]).toBe(1);
  expect(normal.attributes.environment).toBe(10);
  const legacy = gatherFixture(false);
  await loadFixture(page, legacy.game);
  await expect(
    page.getByRole("button", { name: "无人机增产 · 资源 +1 / 环境 −1" }),
  ).toHaveCount(0);
  await page
    .locator(".equipment")
    .getByLabel("采矿无人机效果说明", { exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "常规采集同类资源额外+1",
  );
  await expect(page.getByRole("tooltip")).not.toContainText("可选增产");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "采集当前位置资源", exact: true })
    .click();
  await expect(page.locator(".journey-strip")).toContainText("上交材料");
  expect(
    (await local.service.get(legacy.game.id)).players[0].resources[
      legacy.tile.resource
    ],
  ).toBe(2);
});
