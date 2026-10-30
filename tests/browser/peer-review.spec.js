import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { createGame, command } from "../../server/src/expedition/engine.js";
import { CHARACTERS } from "../../server/src/expedition/catalog.js";

test("learning council: ratings and comments, read-only inspection, refresh, deceased review, reflection and layered final outcome", async ({
  page,
}, info) => {
  const local = await testApi();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/api/expeditions**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: local.base + url.pathname });
      await route.fulfill({
        response,
        headers: { ...response.headers(), "access-control-allow-origin": "*" },
      });
    });
    // Deterministic terminal UI fixture. Real engine settlement produces two
    // survivors and one deceased player; it is not a performance simulation.
    let game = createGame(
      {
        learningMode: true,
        players: CHARACTERS.slice(0, 3).map((character, index) => ({
          characterId: character.id,
          flagId: `P${index + 1}`,
          name: `互评测试玩家${index + 1}`,
        })),
      },
      { id: "EXP-PEERUI", seed: 11 },
    );
    game.round = 8;
    game.turn = 2;
    game.phase = "donate";
    game.floodLevel = 3;
    game.evacuationStarted = true;
    game.players[0].position = "0,0";
    game.players[1].position = "1,0";
    game.players[2].position = "5,0";
    game.ark.wood = game.rules.arkUnitsPerSeat;
    game = command(game, {
      type: "skip",
      actor: "P3",
      revision: game.revision,
    });
    expect(game.status).toBe("awaiting_judgment");
    expect(game.players.map((player) => player.survival.alive)).toEqual([
      true,
      true,
      false,
    ]);
    await local.store.write("expeditions.json", {
      schemaVersion: 1,
      games: [game],
    });
    await page.goto("/");
    await page.evaluate(
      (id) => localStorage.setItem("noah-expedition-id", id),
      game.id,
    );
    await page.reload();
    const panel = page.getByRole("region", { name: "登船审议" });
    const peer = page.getByRole("region", { name: "玩家互评" });
    const outcome = page.getByRole("region", { name: "多层航程成果" });
    await expect(panel).toContainText("幸存 2 / 3 人");
    await expect(peer).toContainText("轮到 P1 互评");
    await expect(peer).toContainText("未存活的玩家也有表达权");
    await expect(
      panel.getByRole("button", { name: "请上帝审判这段航程" }),
    ).toBeDisabled();
    await expect(peer.getByLabel("P1 合作评分")).toHaveCount(0);
    await peer.getByRole("button", { name: "提交我的互评" }).click();
    await expect(peer.getByRole("alert")).toContainText("至少评价一位");
    await peer.getByLabel("P2 合作评分").selectOption("4");
    await peer
      .getByLabel("P2 互评评论")
      .fill("程序化界面测试：请结合真实行为核对我的观察，评分不是船票。");
    const p2Event = game.events.find(
      (event) => event.type === "survival" && event.actor === "P2",
    );
    await peer.getByLabel("P2 互评事件").fill(String(p2Event.seq));
    await page
      .getByRole("button", { name: "查看 P2 玩家详情", exact: true })
      .click();
    await expect(peer.getByLabel("P2 合作评分")).toHaveCount(0);
    await expect(
      peer.getByRole("button", { name: "提交我的互评" }),
    ).toHaveCount(0);
    expect((await local.service.get(game.id)).revision).toBe(game.revision);
    await peer.getByRole("button", { name: "返回当前互评玩家" }).click();
    await expect(peer.getByLabel("P2 合作评分")).toHaveValue("4");
    await peer.getByRole("button", { name: "提交我的互评" }).click();
    await expect(peer).toContainText("轮到 P2 互评");
    await expect(
      page.getByRole("region", { name: "操作撤回与重做" }),
    ).toContainText("同伴互评已提交");
    await page.reload();
    await expect(peer).toContainText("轮到 P2 互评");
    const savedAfterReload = await local.service.get(game.id);
    expect(
      savedAfterReload.peerReviewSummary.submissions[0].entries[0],
    ).toMatchObject({ targetId: "P2", rating: 4, evidence: [p2Event.seq] });
    await peer.getByRole("button", { name: "未观察到，跳过互评" }).click();
    await expect(peer).toContainText("轮到 P3 互评");
    await peer
      .getByLabel("P1 互评评论")
      .fill("程序化界面测试：我虽然未存活，仍可表达观察；不应为我复活或扩容。");
    await peer.getByRole("button", { name: "提交我的互评" }).click();
    await expect(peer).toContainText("全员互评已完成");
    await peer
      .getByText("查看互评记录（意见，不是事实认定）", { exact: true })
      .click();
    await expect(peer).toContainText("P2 · 明确跳过");
    await expect(peer).toContainText("未评分");
    await peer.screenshot({ path: info.outputPath("peer-review-records.png") });
    await panel.getByRole("button", { name: "请上帝审判这段航程" }).click();
    await expect(
      page.getByRole("complementary", { name: "一分钟反思" }),
    ).toContainText("如果重来");
    await expect(
      page.getByRole("complementary", { name: "一分钟反思" }),
    ).toContainText("并非模型已经理解");
    await expect(outcome).toContainText("共同守护");
    await expect(outcome).toContainText("公共保障");
    await expect(outcome).toContainText("环境成本约束");
    await panel
      .getByLabel("玩家登船陈述")
      .fill(
        "程序化测试反思：我会比较保留种子自救与共同捐赠的代价，请查真实记录。",
      );
    await panel.getByRole("button", { name: "提交发言并听取回应" }).click();
    await expect(panel).toContainText("幸存者发言 · 剩余 1 人");
    await panel.getByRole("button", { name: "该玩家放弃发言" }).click();
    await panel
      .getByRole("button", { name: "完成交互，请上帝敲定最终名单" })
      .click();
    await expect(panel).toContainText("最终名单");
    await outcome.getByText("每位伙伴留下了什么？", { exact: true }).click();
    await expect(outcome).toContainText("未获席位不代表没有价值");
    await page.reload();
    const saved = await local.service.get(game.id);
    expect(saved.status).toBe("finished");
    expect(saved.judgment.context.peerReviews.submissions).toHaveLength(3);
    expect(
      saved.judgment.context.peerReviews.submissions.find(
        (entry) => entry.reviewerId === "P3",
      ).waived,
    ).toBe(false);
    expect(saved.judgment.context.peerReviews.trust).toBe(
      "unverified_player_opinions",
    );
    expect(saved.judgment.conversations.map((entry) => entry.playerId)).toEqual(
      ["P1", "P2"],
    );
    expect(
      saved.judgment.verdict.decisions.filter((entry) => entry.board),
    ).toHaveLength(1);
    expect(
      saved.judgment.verdict.decisions.find((entry) => entry.playerId === "P3")
        .board,
    ).toBe(false);
    expect(saved.ark).toEqual(game.ark);
    expect(saved.learningOutcome.boarding.final).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await outcome.getByText("出生条件如何影响机会？", { exact: true }).click();
    const opportunity = outcome.getByRole("table");
    await expect(opportunity).toContainText("不是玩家能力评分");
    await expect(opportunity.getByRole("row")).toHaveCount(4);
    await expect(
      opportunity.getByRole("row", { name: "P1 / P1 11 3" }),
    ).toBeVisible();
    await expect(
      opportunity.getByRole("row", { name: "P2 / P2 12 0" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await outcome.screenshot({
      path: info.outputPath("learning-outcome-phone.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await local.close();
  }
});
