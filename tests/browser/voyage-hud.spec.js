import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { createGame } from "../../server/src/expedition/engine.js";
import { CHARACTERS } from "../../server/src/expedition/catalog.js";

let local;
let omitForecast;
test.beforeEach(async ({ page }) => {
  local = await testApi();
  omitForecast = false;
  await page.route("**/api/expeditions**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: local.base + url.pathname });
    if (
      omitForecast &&
      response.ok() &&
      route.request().method() === "GET" &&
      /^\/api\/expeditions\/EXP-[A-Z0-9]+$/.test(url.pathname)
    ) {
      const body = await response.json();
      delete body.floodForecast;
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
      return;
    }
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

function fixture() {
  return createGame(
    {
      learningMode: true,
      players: CHARACTERS.slice(0, 6).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { id: "EXP-VOYAGEHUD", seed: 11 },
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
  await expect(
    page.getByRole("region", { name: "方舟载客与洪水预告" }),
  ).toBeVisible();
}

test("always-visible planning shows next flood, live seat threshold, personal protection and remains read-only", async ({
  page,
}, info) => {
  const g = fixture();
  g.round = 5;
  g.floodLevel = 1;
  g.ark = { wood: 10, metal: 10, electricity: 10, seed: 3 };
  g.players[0].equipment = ["reserve-crate"];
  g.players[0].resources = { wood: 1, metal: 0, electricity: 0, seed: 1 };
  await load(page, g);
  const hud = page.getByRole("region", { name: "方舟载客与洪水预告" });
  await expect(hud.getByLabel("当前载客人数")).toHaveText("1");
  await expect(hud).toContainText("再捐 1 份物资");
  await expect(hud.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "16",
  );
  await expect(
    hud.getByRole("heading", { name: "下一次洪水 · 第 5 轮结束" }),
  ).toBeVisible();
  await expect(hud).toContainText("本轮末到来");
  await expect(hud.getByLabel("下次洪水个人基础缴纳")).toContainText("固定");
  await expect(
    hud.getByLabel("下次洪水个人基础缴纳").getByLabel("种子 1"),
  ).toBeVisible();
  await expect(hud.getByLabel("下次洪水方舟扣除")).toContainText(
    "方舟随机扣 2 份",
  );
  await page.screenshot({
    path: info.outputPath("voyage-first-screen-desktop.png"),
  });
  await hud.screenshot({ path: info.outputPath("voyage-default-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await hud.screenshot({ path: info.outputPath("voyage-default-phone.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await hud
    .getByText("查看每位玩家准备情况（含储备仓减免）", { exact: true })
    .click();
  const personal = hud.locator(".voyage-personal-grid > div").first();
  await expect(personal).toContainText("免额外选扣");
  await expect(personal).toContainText("现有物资足以缴纳");
  await expect(personal).toContainText("储备仓");
  expect((await local.service.get(g.id)).revision).toBe(g.revision);
  await hud.screenshot({
    path: info.outputPath("flood-and-capacity-desktop.png"),
  });
});

test("settling flood separately states actual deduction and forecasts only a future flood", async ({
  page,
}) => {
  const g = fixture();
  g.round = 3;
  g.floodLevel = 1;
  g.phase = "flood";
  g.pending = { kind: "flood", actor: "P2", index: 1 };
  const seq = g.events.length + 1;
  g.events.push(
    {
      seq,
      round: 3,
      type: "flood",
      actor: "system",
      text: "测试洪水记录",
      die: 3,
      resource: "metal",
      requested: 1,
      actual: 0,
      zone: 3,
    },
    {
      seq: seq + 1,
      round: 3,
      type: "flood_payment",
      actor: "P1",
      text: "测试已缴记录",
      lost: { wood: 1, metal: 0, electricity: 0, seed: 0 },
    },
  );
  await load(page, g);
  const hud = page.getByRole("region", { name: "方舟载客与洪水预告" });
  await expect(hud.getByRole("status")).toContainText("方舟已扣");
  await expect(hud.getByRole("status").getByLabel("金属 0")).toBeVisible();
  await expect(hud.getByRole("status")).toContainText("不会重复扣除");
  await expect(hud.getByRole("status")).toContainText("已缴 1/6 人");
  await expect(
    hud.getByRole("heading", { name: "下一次洪水 · 第 5 轮结束" }),
  ).toBeVisible();
  await expect(
    hud.getByRole("heading", { name: "下一次洪水 · 第 3 轮结束" }),
  ).toHaveCount(0);
});

test("last flood and full capacity have no misleading next threshold and fit a phone viewport", async ({
  page,
}, info) => {
  const g = fixture();
  g.round = 8;
  g.floodLevel = 3;
  g.ark = { wood: 26, metal: 26, electricity: 25, seed: 25 };
  await load(page, g);
  const hud = page.getByRole("region", { name: "方舟载客与洪水预告" });
  await expect(
    hud.getByRole("heading", { name: "本局无下一次洪水" }),
  ).toBeVisible();
  await expect(hud.getByLabel("当前载客人数")).toHaveText("6");
  await expect(hud).toContainText("已达本局上限 · 6 人");
  await expect(
    hud.getByRole("progressbar", { name: "方舟已满额" }),
  ).toHaveAttribute("aria-valuenow", "17");
  await expect(hud).not.toContainText("再捐");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await hud.screenshot({ path: info.outputPath("capacity-full-phone.png") });
});

test("missing forecast data remains unknown instead of falsely declaring no further flood", async ({
  page,
}) => {
  const g = fixture();
  omitForecast = true;
  await load(page, g);
  const hud = page.getByRole("region", { name: "方舟载客与洪水预告" });
  await expect(
    hud.getByRole("heading", { name: "洪水预告暂不可用" }),
  ).toBeVisible();
  await expect(hud).toContainText("请刷新获取洪水预告");
  await expect(hud).not.toContainText("本局无下一次洪水");
  await expect(hud).not.toContainText("洪水预告已结束");
  await expect(hud.getByLabel("当前载客人数")).toHaveText("0");
  await expect(hud).toContainText("再捐 17 份物资");
  await expect(hud.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect((await local.service.get(g.id)).revision).toBe(g.revision);
});
