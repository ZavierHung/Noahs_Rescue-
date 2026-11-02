import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { createGame } from "../../server/src/expedition/engine.js";
import { CHARACTERS } from "../../server/src/expedition/catalog.js";

let local;
let mutationRequests;
test.beforeEach(async ({ page }) => {
  local = await testApi();
  mutationRequests = [];
  await page.route("**/api/expeditions**", async (route) => {
    const request = route.request();
    if (!["GET", "OPTIONS"].includes(request.method()))
      mutationRequests.push(request.url());
    const url = new URL(request.url());
    const response = await route.fetch({ url: local.base + url.pathname });
    await route.fulfill({
      response,
      headers: { ...response.headers(), "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("card-catalog-open")).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await page.close();
  await local.close();
});

test("all 27 card kinds can be browsed before starting; categories, real-rule search and keyboard hints are read-only", async ({
  page,
}, info) => {
  await page.getByTestId("card-catalog-open").click();
  const dialog = page.getByRole("dialog", { name: "卡牌图鉴", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".catalog-entry")).toHaveCount(27);
  // Lazy images are deliberately scrolled into view, so every asset is verified.
  for (const image of await dialog.locator(".catalog-entry img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  }
  await dialog
    .getByRole("heading", { name: "卡牌图鉴", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("card-catalog-desktop.png") });
  await expect(dialog).toContainText("学习版规则");
  await dialog.getByRole("button", { name: "手牌种类 2", exact: true }).click();
  await expect(dialog.locator(".catalog-entry")).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "预览邀约", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "预览科技", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "科技牌 13", exact: true }).click();
  await expect(dialog.locator(".catalog-entry")).toHaveCount(13);
  await dialog.getByLabel("查找卡牌或效果").fill("可选增产");
  await expect(dialog.locator(".catalog-entry")).toHaveCount(1);
  await dialog.getByLabel("查找卡牌或效果").press("Tab");
  await expect(
    dialog.getByLabel("采矿无人机效果说明", { exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tooltip")).toContainText("环境−1");
  await dialog
    .getByRole("button", { name: "预览采矿无人机", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "采矿无人机完整效果" }),
  ).toContainText("被拒绝的采集不消耗环境");
  await expect(
    dialog.getByRole("img", { name: "采矿无人机卡面", exact: true }),
  ).toHaveAttribute("src", /mining-drone-learning\.png$/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("card-catalog-open")).toBeFocused();
  expect(mutationRequests).toEqual([]);
  expect(await local.service.list()).toHaveLength(0);
});

test("disaster catalogue includes all thresholds, stacks extreme disasters and previews the matching learning artwork", async ({
  page,
}) => {
  await page.getByTestId("card-catalog-open").click();
  const dialog = page.getByRole("dialog", { name: "卡牌图鉴", exact: true });
  await dialog.getByRole("button", { name: "灾难牌 12", exact: true }).click();
  await expect(dialog.locator(".catalog-entry")).toHaveCount(12);
  await expect(dialog).toContainText("极端值同时叠加普通与极端灾难");
  await dialog.getByLabel("查找卡牌或效果").fill("生态崩坏");
  await dialog
    .getByRole("button", { name: "预览生态崩坏", exact: true })
    .click();
  const effect = dialog.getByRole("region", { name: "生态崩坏完整效果" });
  await expect(effect).toContainText("第r+2轮恢复");
  await expect(effect).toContainText("1–2 同时触发负向与极低灾难");
  await expect(effect).toContainText("18–19 同时触发正向与极高灾难");
  await expect(
    dialog.getByRole("img", { name: "生态崩坏卡面", exact: true }),
  ).toHaveAttribute("src", /eco-collapse-learning\.png$/);
  await dialog
    .getByRole("button", { name: "← 返回全部预览", exact: true })
    .click();
  await dialog.getByLabel("查找卡牌或效果").fill("不存在的卡牌");
  await expect(dialog).toContainText("没有找到对应卡牌");
  expect(mutationRequests).toEqual([]);
});

test("mobile catalogue remains usable during another player's turn, preserves old rules and never edits the save", async ({
  page,
}, info) => {
  const game = createGame(
    {
      players: CHARACTERS.slice(0, 3).map((character, i) => ({
        characterId: character.id,
        flagId: `P${i + 1}`,
      })),
    },
    { id: "EXP-CATALOGLEGACY", seed: 31 },
  );
  await local.store.write("expeditions.json", {
    schemaVersion: 1,
    games: [game],
  });
  await page.evaluate(
    (id) => localStorage.setItem("noah-expedition-id", id),
    game.id,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
    .click();
  const before = await local.service.get(game.id);
  mutationRequests.length = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("card-catalog-open").click();
  const dialog = page.getByRole("dialog", { name: "卡牌图鉴", exact: true });
  await expect(dialog).toContainText("当前旧版存档规则");
  await dialog.getByLabel("查找卡牌或效果").fill("采矿无人机");
  await dialog
    .getByRole("button", { name: "预览采矿无人机", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "采矿无人机完整效果" }),
  ).toContainText("常规采集同种资源额外+1");
  await expect(dialog).not.toContainText("可选增产");
  const art = dialog.getByRole("img", { name: "采矿无人机卡面", exact: true });
  await expect(art).toHaveAttribute("src", /mining-drone\.jpg$/);
  await art.scrollIntoViewIfNeeded();
  await expect
    .poll(() => art.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  const sizes = await art.evaluate((img) => ({
    natural: img.naturalWidth / img.naturalHeight,
    rendered: img.clientWidth / img.clientHeight,
  }));
  expect(Math.abs(sizes.natural - sizes.rendered)).toBeLessThan(0.01);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("card-catalog-mobile.png") });
  await dialog
    .getByRole("button", { name: "关闭卡牌图鉴", exact: true })
    .click();
  expect(mutationRequests).toEqual([]);
  expect(await local.service.get(game.id)).toEqual(before);
});
