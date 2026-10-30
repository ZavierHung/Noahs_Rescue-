import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { createGame, command } from "../../server/src/expedition/engine.js";
import { CARDS, CHARACTERS } from "../../server/src/expedition/catalog.js";

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
function fresh(learningMode = true) {
  return createGame(
    {
      learningMode,
      players: CHARACTERS.slice(0, 3).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { id: "EXP-PUBLICEVENTUI", seed: 11 },
  );
}
async function load(page, game) {
  await local.store.write("expeditions.json", {
    schemaVersion: 1,
    games: [game],
  });
  await page.evaluate(
    (id) => localStorage.setItem("noah-expedition-id", id),
    game.id,
  );
  await page.reload();
  await expect(page.locator(".journey-strip")).toContainText(
    `第 ${game.round} / 8`,
  );
}

test("public event exposes two known tradeoffs with icons, keyboard hints and real actor-only resolution", async ({
  page,
}, info) => {
  let game = fresh();
  expect(game.learningVersion).toBe("student-learning-v2");
  game.turn = game.players.length - 1;
  game.phase = "donate";
  game = command(game, {
    type: "skip",
    actor: game.players.at(-1).id,
    revision: game.revision,
  });
  expect(game.pending?.kind).toBe("public_event");
  const { card, actor } = game.pending;
  const option = card.options[0];
  const other = game.players.find((p) => p.id !== actor);
  await load(page, game);
  const panel = page.getByRole("region", { name: "公共事件二选一" });
  await expect(panel).toBeFocused();
  await expect(panel).toContainText(card.title);
  await expect(panel).toContainText(card.concept);
  await expect(panel).toContainText(card.limitations);
  await expect(panel).toContainText("本局第 1 / 3 次公共事件");
  await expect(panel).toContainText("模型边界");
  await expect(panel).toContainText("公共收益不计个人捐赠");
  await expect(
    panel.getByRole("button", { name: /^选择公共方案：/ }),
  ).toHaveCount(2);
  await expect(panel.locator(".resource-icon svg").first()).toBeVisible();
  await panel
    .getByLabel(`${card.title}：${option.label}效果说明`, { exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toContainText(option.summary);
  await expect(page.getByRole("tooltip")).toContainText("共享世界");
  await page.keyboard.press("Escape");
  for (const button of await page
    .locator(".hand-cards")
    .getByRole("button", { name: /^(使用|弃置)$/ })
    .all())
    await expect(button).toBeDisabled();
  const before = await local.service.get(game.id);
  await page
    .getByRole("button", { name: `查看 ${other.id} 玩家详情`, exact: true })
    .click();
  await expect(panel).toContainText("只有轮值决策者可以选择");
  for (const button of await panel
    .getByRole("button", { name: /^选择公共方案：/ })
    .all())
    await expect(button).toBeDisabled();
  expect((await local.service.get(game.id)).revision).toBe(before.revision);
  await panel
    .getByRole("button", { name: "返回公共事件决策者", exact: true })
    .click();
  await panel.screenshot({ path: info.outputPath("public-event-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: info.outputPath("public-event-phone.png") });
  await panel
    .getByRole("button", { name: `选择公共方案：${option.label}`, exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  const saved = await local.service.get(game.id);
  expect(saved.publicEvents.choices).toHaveLength(1);
  expect(saved.publicEvents.choices[0].decisionActor).toBe(actor);
  expect(saved.publicEvents.choices[0].optionId).toBe(option.id);
  expect(saved.players.map((p) => p.donated)).toEqual(
    before.players.map((p) => p.donated),
  );
  for (const [resource, amount] of Object.entries(option.effects.ark))
    expect(saved.ark[resource]).toBe(before.ark[resource] + amount);
  await page.reload();
  await expect(panel).toHaveCount(0);
  expect((await local.service.get(game.id)).publicEvents.choices).toHaveLength(
    1,
  );
});

test("learning card PNGs load and describe current effects while legacy saves retain original images", async ({
  page,
}, info) => {
  async function cardFixture(learningMode) {
    let game = fresh(learningMode);
    game = command(game, {
      type: "set_world",
      actor: "P1",
      revision: game.revision,
      attributes: { economy: 10, environment: 5, society: 10 },
      reason: "独立卡面测试",
    });
    game.phase = "choice";
    game.pending = {
      kind: "technology",
      actor: "P1",
      choices: ["mining-drone", "shared-supply-pod"],
    };
    await load(page, game);
  }
  await cardFixture(true);
  const images = [
    ["/images/expedition/cards/mining-drone-learning.png", "可选增产"],
    ["/images/expedition/cards/shared-supply-pod-learning.png", "库存少者先选"],
    ["/images/disasters/eco-collapse-learning.png", "休养一整轮"],
  ];
  for (const [src, text] of images) {
    const img = page.locator(`img[src="${src}"]`).first();
    await expect
      .poll(() =>
        img.evaluate((node) => node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
    await img.hover();
    await expect(page.getByRole("tooltip")).toContainText(text);
    await page.keyboard.press("Escape");
  }
  await page
    .locator(".tech-options")
    .screenshot({ path: info.outputPath("updated-technology-card-art.png") });
  await page
    .locator('[data-disaster-id="eco-collapse"]')
    .screenshot({ path: info.outputPath("updated-disaster-card-art.png") });
  await page
    .locator('[data-disaster-id="eco-collapse"]')
    .getByRole("button", { name: /卡牌大图/ })
    .click();
  const preview = page.getByRole("dialog");
  const newDisaster = preview.locator(
    'img[src="/images/disasters/eco-collapse-learning.png"]',
  );
  await expect
    .poll(() =>
      newDisaster.evaluate((node) => node.complete && node.naturalWidth > 0),
    )
    .toBe(true);
  await expect(preview).toContainText("休养一整轮");
  await page.keyboard.press("Escape");
  await cardFixture(false);
  for (const id of ["mining-drone", "shared-supply-pod"]) {
    const original = CARDS.technology.find((c) => c.id === id);
    const image = page.locator(`.tech-options img[src="${original.image}"]`);
    await expect
      .poll(() =>
        image.evaluate((node) => node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
  }
  await expect(page.locator('img[src$="-learning.png"]')).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "公共事件二选一" }),
  ).toHaveCount(0);
});
