import { test, expect } from "@playwright/test";
import { startLocalTestApi } from "../helpers/local-api.mjs";

let local;
let pageErrors;
test.beforeEach(async ({ page }) => {
  local = await startLocalTestApi();
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Keep the real rendered app and real HTTP service; only redirect its base URL
  // to the isolated test instance. Never touch the user's running :8787 API.
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: local.base + url.pathname + url.search });
    await route.fulfill({
      response,
      headers: { ...response.headers(), "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/mobile");
  await expect(page.getByRole("region", { name: "北极熊的手机" })).toContainText("已连接");
});
test.afterEach(async ({ page }) => {
  await page.close();
  await local?.close();
  expect(pageErrors).toEqual([]);
});

async function sixReady(page) {
  await page.getByRole("button", { name: "六人同屏模拟", exact: true }).click();
  await expect(page.locator(".phone")).toHaveCount(6);
  await expect(page.locator(".brand .online")).toHaveCount(6);
  await page.getByRole("button", { name: "一键建房并准备六人", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "六人准备完成" })).toBeVisible();
  const fox = page.getByRole("region", { name: "耳廓沙狐的手机" });
  await fox.getByRole("button", { name: "开始游戏 · 6/6 已准备", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  return fox;
}

test("six real browser players: score, god/RAG, report/rebuttal, manual settlement, reconnect and archive", async ({
  page,
}, testInfo) => {
  const fox = await sixReady(page);
  const captain = page.getByRole("region", { name: "船长的手机" });
  const hunter = page.getByRole("region", { name: "猎人的手机" });
  await fox.getByRole("button", { name: "调整世界环境，当前10", exact: true }).click();
  await fox.getByRole("slider").focus();
  await fox.getByRole("slider").press("Home");
  await fox.getByRole("slider").press("ArrowRight");
  await fox.getByRole("textbox", { name: "分数调整原因" }).fill("浏览器测试：采集资源后环境下降");
  await fox.getByRole("button", { name: "保存分数并留档" }).click();
  await expect(fox.getByRole("button", { name: "调整世界环境，当前2" })).toBeVisible();
  await expect(hunter.getByRole("button", { name: "调整世界环境，当前2" })).toBeVisible();
  await fox.getByRole("button", { name: "触发上帝", exact: true }).click();
  await expect(fox.getByRole("heading", { name: "大地的喘息" })).toBeVisible();
  await fox.locator("summary").filter({ hasText: "本地 RAG 知识依据" }).click();
  await expect(fox.locator(".knowledge p")).toHaveCount(3);
  await captain.getByRole("button", { name: "回应神谕 / 查看奖惩" }).click();
  await captain
    .getByRole("textbox", { name: "汇报桌面行动" })
    .fill("已完成：双方共享物资，协作修复湿地并记录资源支出。");
  await captain.getByRole("button", { name: "提交行动评估" }).click();
  await expect(
    captain.getByRole("heading", { name: "建议判定：已完成", exact: true }),
  ).toBeVisible();
  await captain
    .getByRole("textbox", { name: "向上帝驳斥 / 补充说明（可选）" })
    .fill("我们承担了修复成本，希望减轻惩罚。");
  await captain.getByRole("button", { name: "听取最终裁决" }).click();
  await expect(captain.getByRole("button", { name: "确认并结算", exact: true })).toBeVisible();
  let room = (await local.service.list())[0];
  expect(room.scores.world.environment).toBe(2);
  expect(room.events.filter((e) => e.type === "settle")).toHaveLength(0);
  await captain.getByRole("button", { name: "暂不确认，返回游戏" }).click();
  await expect(captain.getByRole("button", { name: "调整世界环境，当前2" })).toBeDisabled();
  await captain.getByRole("button", { name: "回应神谕 / 查看奖惩" }).click();
  await captain.getByRole("button", { name: "确认并结算", exact: true }).click();
  await expect(captain.getByRole("heading", { name: "共同的世界" })).toBeVisible();
  room = (await local.service.list())[0];
  expect(room.events.filter((e) => e.type === "settle")).toHaveLength(1);
  const worldChange = room.judgments[0].proposal.changes.find((c) => c.scope === "world");
  expect(room.scores.world.environment).toBe(worldChange.after);
  await hunter.getByRole("button", { name: "暂时退出" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
  await hunter.getByRole("button", { name: `回到 ${room.id}`, exact: true }).click();
  await expect(hunter.getByRole("heading", { name: "共同的世界" })).toBeVisible();
  await hunter.getByRole("button", { name: "再次触发上帝" }).click();
  await expect(hunter.getByRole("button", { name: "提交行动评估" })).toBeVisible();
  expect((await local.service.get(room.id)).judgments).toHaveLength(2);
  await hunter.getByRole("textbox", { name: "汇报桌面行动" }).fill("未完成，还没有采取修复行动。");
  await hunter.getByRole("button", { name: "提交行动评估" }).click();
  await expect(hunter.getByRole("heading", { name: "建议判定：证据不足 / 未完成" })).toBeVisible();
  await hunter.getByRole("button", { name: "听取最终裁决" }).click();
  await hunter.getByRole("button", { name: "确认并结算", exact: true }).click();
  await hunter.getByRole("button", { name: "结束本局" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "这一程，已被记住。" })).toHaveCount(6);
  await hunter.getByRole("button", { name: "查看完整记录" }).click();
  await expect(hunter.getByRole("heading", { name: "全部操作与分数来源" })).toBeVisible();
  await expect(hunter.locator(".archive-oracle")).toHaveCount(2);
  const secondRow = await page
    .locator(".phone")
    .evaluateAll((phones) => phones.slice(3).map((phone) => phone.getBoundingClientRect().top));
  expect(Math.max(...secondRow) - Math.min(...secondRow)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("six-player-archive.png"), fullPage: true });
  await page.reload();
  const bear = page.getByRole("region", { name: "北极熊的手机" });
  await bear.getByRole("button", { name: "查看历史游戏" }).click();
  await bear.getByRole("button", { name: "查看游戏详情" }).click();
  await expect(bear.getByRole("heading", { name: room.id, exact: true })).toBeVisible();
});

test("phone viewport has no horizontal overflow and five missing players cannot start", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bear = page.getByRole("region", { name: "北极熊的手机" });
  await bear.getByRole("button", { name: "新建一局", exact: true }).click();
  await bear.getByRole("button", { name: "我已准备", exact: true }).click();
  await expect(
    bear.getByRole("button", { name: "开始游戏 · 1/6 已准备", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("phone-lobby.png"), fullPage: true });
});

test("a failed ready request is shown as failure, not a false six-player success", async ({
  page,
}) => {
  await page.getByRole("button", { name: "六人同屏模拟", exact: true }).click();
  await expect(page.locator(".brand .online")).toHaveCount(6);
  await page.route("**/api/rooms/*/actions", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.type === "ready" && body.roleId === "H03")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "模拟准备请求失败" }),
      });
    await route.fallback();
  });
  await page.getByRole("button", { name: "一键建房并准备六人", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "部分玩家准备失败" })).toBeVisible();
  expect(await local.service.list()).toHaveLength(1);
  expect(
    Object.values((await local.service.list())[0].players).filter((p) => p.ready),
  ).toHaveLength(5);
});

test("initial role API outage recovers automatically without a reload or a stale error banner", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/api/roles", async (route) => {
    if (unavailable)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "模拟角色服务暂不可用" }),
      });
    await route.fallback();
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("模拟角色服务暂不可用");
  unavailable = false;
  await expect(page.getByRole("region", { name: "北极熊的手机" })).toContainText("已连接");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加入游戏", exact: true })).toBeEnabled();
});

test("quick start from one phone preserves manual game, loads artwork and resumes without duplicating rooms", async ({
  page,
}, testInfo) => {
  const bear = page.getByRole("region", { name: "北极熊的手机" });
  await expect(bear.locator(".voyage-art")).toBeVisible();
  expect(
    await bear.locator(".voyage-art").evaluate((img) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("illustrated-role.png"), fullPage: true });
  await bear.getByRole("button", { name: "新建一局", exact: true }).click();
  const [manual] = await local.service.list();
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  await expect(page.getByRole("status").filter({ hasText: "六人在线" })).toBeVisible();
  expect(
    await page
      .locator(".oracle-art")
      .evaluateAll((images) => images.every((img) => img.complete && img.naturalWidth > 0)),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const rooms = await local.service.list();
  const quick = rooms.find((room) => room.id !== manual.id);
  expect(quick.status).toBe("playing");
  expect(quick.judgments).toHaveLength(0);
  expect(await local.service.get(manual.id)).toEqual(manual);
  await page.getByRole("button", { name: "切回单人手机", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("quick-game-phone.png"), fullPage: true });
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  expect(await local.service.list()).toHaveLength(2);
  expect(
    (await local.service.get(quick.id)).events.filter((event) => event.type === "start"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "返回手动游戏", exact: true }).click();
  await expect(bear.getByRole("button", { name: `回到 ${manual.id}`, exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  expect(await local.service.list()).toHaveLength(2);
});

test("quick ready failure retries the existing lobby and actually starts the game", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/rooms/*/actions", async (route) => {
    const data = route.request().postDataJSON();
    if (fail && data?.type === "ready" && data.roleId === "H03") {
      fail = false;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "模拟准备失败" }),
      });
    }
    await route.fallback();
  });
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "部分测试玩家准备失败" })).toBeVisible();
  const [partial] = await local.service.list();
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  expect(await local.service.list()).toHaveLength(1);
  expect((await local.service.get(partial.id)).status).toBe("playing");
});

test("quick new game after finish restores all six controllers to the new room", async ({
  page,
}) => {
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  const [first] = await local.service.list();
  await page
    .getByRole("region", { name: "耳廓沙狐的手机" })
    .getByRole("button", { name: "结束本局" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("heading", { name: "这一程，已被记住。" })).toHaveCount(6);
  await page.getByRole("button", { name: "一键测试开局", exact: true }).click();
  await expect(page.getByRole("heading", { name: "共同的世界", exact: true })).toHaveCount(6);
  const rooms = await local.service.list();
  expect(rooms).toHaveLength(2);
  const next = rooms.find((room) => room.id !== first.id);
  await expect(page.locator(".game-heading .eyebrow").filter({ hasText: next.id })).toHaveCount(6);
  expect((await local.service.get(first.id)).status).toBe("finished");
});
