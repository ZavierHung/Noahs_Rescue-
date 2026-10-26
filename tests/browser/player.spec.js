import { test, expect } from "@playwright/test";
import { startLocalTestApi } from "../helpers/local-api.mjs";

let local;
let pageErrors;
async function connect(page) {
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: local.base + url.pathname + url.search });
    await route.fulfill({
      response,
      headers: { ...response.headers(), "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/play");
  await expect(page.locator(".brand .online")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  local = await startLocalTestApi();
  pageErrors = [];
  await connect(page);
});
test.afterEach(async ({ page }) => {
  await page.close();
  await local.close();
  expect(pageErrors).toEqual([]);
});

test("player entry has a guide, isolated history, room codes and six independent browser identities", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "一键测试开局", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "第一次玩？查看玩法" }).click();
  await expect(page.getByRole("dialog")).toContainText("确认后才执行奖惩");
  await expect(page.getByRole("dialog")).toContainText("尚无账号与访问权限保护");
  await expect(page.getByRole("heading", { name: "第一次登上方舟", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "第一次登上方舟", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: testInfo.outputPath("player-guide.png"), fullPage: true });
  await page.getByRole("button", { name: "我了解了，返回游戏" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("player-entry.png"), fullPage: true });
  await page.getByRole("button", { name: "耳廓沙狐", exact: true }).click();
  await page.getByRole("button", { name: "新建一局", exact: true }).click();
  const [room] = await local.service.list();
  const code = room.id.slice(5);
  await expect(page.locator(".invite-panel strong")).toHaveText(code);
  await page.getByRole("button", { name: "我已准备", exact: true }).click();
  const contexts = [];
  const peers = [];
  try {
    for (const role of ["金狮绢猴", "北极熊", "船长", "商人", "猎人"]) {
      const context = await browser.newContext({
        baseURL: "http://localhost:3000",
        viewport: { width: 390, height: 844 },
      });
      contexts.push(context);
      const peer = await context.newPage();
      peers.push(peer);
      await connect(peer);
      await peer.getByRole("button", { name: "查看历史游戏", exact: true }).click();
      await expect(peer.getByRole("button", { name: "查看游戏详情" })).toHaveCount(0);
      await peer.getByRole("button", { name: "游戏", exact: true }).click();
      await peer.getByRole("button", { name: role, exact: true }).click();
      await peer.getByRole("button", { name: "加入游戏", exact: true }).click();
      await peer.getByRole("textbox", { name: "房间码", exact: true }).fill(code.toLowerCase());
      await peer.getByRole("button", { name: "使用房间码加入", exact: true }).click();
      await peer.getByRole("button", { name: "我已准备", exact: true }).click();
    }
    await expect(
      page.getByRole("button", { name: "开始游戏 · 6/6 已准备", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "开始游戏 · 6/6 已准备", exact: true }).click();
    for (const peer of [page, ...peers])
      await expect(peer.getByRole("heading", { name: "共同的世界", exact: true })).toBeVisible();
    expect((await local.service.get(room.id)).judgments).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toBeVisible();
    await expect(page.locator(".brand")).toContainText("耳廓沙狐");
    await page.screenshot({ path: testInfo.outputPath("player-playing.png"), fullPage: true });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("player invalid room code fails locally and a missing room produces a readable error", async ({
  page,
}) => {
  let joins = 0;
  await page.route("**/api/rooms/*/actions", async (route) => {
    joins++;
    await route.fallback();
  });
  await page.getByRole("button", { name: "加入游戏", exact: true }).click();
  await page.getByRole("textbox", { name: "房间码", exact: true }).fill("../nope");
  await page.getByRole("button", { name: "使用房间码加入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("请输入 8 位房间码");
  expect(joins).toBe(0);
  await page.getByRole("textbox", { name: "房间码", exact: true }).fill("0123ABCD");
  await page.getByRole("button", { name: "使用房间码加入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("未找到游戏");
  expect(joins).toBe(1);
});

test("player can recover a lost create response after reload without a second room", async ({
  page,
}) => {
  let lose = true;
  await page.route("**/api/rooms", async (route) => {
    if (!lose || route.request().method() !== "POST") return route.fallback();
    lose = false;
    await route.fetch({ url: local.base + "/api/rooms" });
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "新建一局", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试建房", exact: true })).toBeEnabled();
  const [created] = await local.service.list();
  await page.reload();
  await page.getByRole("button", { name: "重试建房", exact: true }).click();
  await expect(page.getByRole("heading", { name: /船员集结中/ })).toBeVisible();
  await expect(page.locator(".invite-panel strong")).toHaveText(created.id.slice(5));
  expect(await local.service.list()).toHaveLength(1);
  await expect(page.getByRole("button", { name: "重试建房", exact: true })).toHaveCount(0);
});
