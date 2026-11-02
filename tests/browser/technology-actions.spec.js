import { test, expect } from "@playwright/test";
import { testApi } from "../helpers/expedition-api.mjs";
import { createGame, command } from "../../server/src/expedition/engine.js";
import {
  CARDS,
  CHARACTERS,
  RESOURCES,
} from "../../server/src/expedition/catalog.js";
import { TILES } from "../../server/src/expedition/map.js";

let local;
test.beforeEach(async ({ page }) => {
  local = await testApi();
  await page.route("**/api/expeditions**", async (route) => {
    const response = await route.fetch({
      url: local.base + new URL(route.request().url()).pathname,
    });
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

function fixture(id) {
  const g = createGame(
    {
      learningMode: true,
      players: CHARACTERS.slice(0, 3).map((c, i) => ({
        characterId: c.id,
        flagId: `P${i + 1}`,
      })),
    },
    { id: "EXP-TECHUI", seed: 11 },
  );
  g.players.forEach((p, i) => {
    p.position = `${i},0`;
    p.resources = { wood: 3, metal: 3, electricity: 3, seed: 3 };
    p.hand = [];
  });
  g.cardCounter = 100;
  if (id) {
    g.phase = "choice";
    g.pending = {
      kind: "technology",
      actor: "P1",
      choices: [id],
      resume: "cards",
      sourceCardUid: "test-offer",
    };
  }
  return g;
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
  await expect(page.locator(".action-panel")).toBeVisible();
}
const labels = {
  wood: "木头",
  metal: "金属",
  electricity: "电力",
  seed: "种子",
};

for (const card of CARDS.technology) {
  test(`technology ${card.id}: select and resolve actual effect through browser`, async ({
    page,
  }) => {
    const g = fixture(card.id);
    if (card.id === "ruins-blueprint")
      g.discard = [{ id: "invitation", uid: "recover-me" }];
    if (card.id === "ecological-repeller")
      g.players[2].position = TILES.find(
        (t) => t.zone === 1 && t.terrain !== "water",
      ).id;
    if (card.id === "black-tide-alarm")
      g.players[2].position = TILES.find(
        (t) => t.river && t.terrain !== "water",
      ).id;
    if (card.id === "mining-drone")
      g.players[0].position = TILES.find(
        (t) => t.resource === "wood" && t.zone === 1,
      ).id;
    await load(page, g);
    await page.getByRole("button", { name: card.name, exact: true }).click();
    if (card.id === "alchemy-furnace") {
      await expect(
        page.getByRole("button", {
          name: `获得 ${card.name} 的收益`,
          exact: true,
        }),
      ).toBeDisabled();
      await page.getByLabel("炼金消耗木头", { exact: true }).fill("2");
      await page.getByRole("button", { name: "产出电力", exact: true }).click();
    }
    if (card.id === "recycling-claw") {
      await expect(
        page.getByLabel("科技目标").locator('option[value="P3"]'),
      ).toHaveJSProperty("disabled", true);
      await page.getByLabel("科技目标").selectOption("P2");
    }
    await page
      .getByRole("button", { name: `获得 ${card.name} 的收益`, exact: true })
      .click();
    await expect
      .poll(async () =>
        (await local.service.get(g.id)).events.some(
          (e) => e.type === "technology" && e.cardId === card.id,
        ),
      )
      .toBe(true);
    let saved = await local.service.get(g.id);
    let responses = 0;
    while (saved.pending) {
      expect(++responses).toBeLessThan(5);
      const p = saved.players.find((p) => p.id === saved.activePlayerId);
      if (saved.pending.kind === "supply") {
        const r = RESOURCES.find((r) => saved.pending.pool[r]);
        await page
          .locator(".pending-choice")
          .getByRole("button", {
            name: `${labels[r]} ${saved.pending.pool[r]}`,
            exact: true,
          })
          .click();
      } else if (["repeller", "tide"].includes(saved.pending.kind)) {
        const r = RESOURCES.find((r) => p.resources[r]);
        await page
          .locator(".pending-choice")
          .getByRole("button", {
            name: `${labels[r]} ${p.resources[r]}`,
            exact: true,
          })
          .click();
      } else if (["recover", "prototype"].includes(saved.pending.kind)) {
        await page
          .locator(".pending-choice")
          .getByRole("button", { name: /^选择 / })
          .first()
          .click();
      } else throw Error(`Unexpected choice ${saved.pending.kind}`);
      await expect
        .poll(async () => (await local.service.get(g.id)).revision)
        .toBeGreaterThan(saved.revision);
      saved = await local.service.get(g.id);
    }
    expect(saved.phase).toBe("cards");
    expect(saved.activePlayerId).toBe("P1");
    if (
      [
        "space-ring",
        "skateboard-shoes",
        "mining-drone",
        "reserve-crate",
        "aid-beacon",
        "famed-blade",
      ].includes(card.id)
    ) {
      expect(saved.players[0].equipment).toContain(card.id);
      await expect(page.locator(".equipment-detail")).toContainText(card.name);
    }
    if (card.id === "alchemy-furnace")
      expect(saved.players[0].resources).toEqual({
        wood: 1,
        metal: 3,
        electricity: 6,
        seed: 3,
      });
    if (card.id === "shared-supply-pod")
      expect(
        saved.players.every(
          (p) => Object.values(p.resources).reduce((a, b) => a + b, 0) === 13,
        ),
      ).toBe(true);
    if (["ecological-repeller", "black-tide-alarm"].includes(card.id))
      expect(
        Object.values(saved.players[2].resources).reduce((a, b) => a + b, 0),
      ).toBe(11);
    if (["rapid-prototyper", "ruins-blueprint"].includes(card.id))
      expect(saved.players[0].hand).toHaveLength(1);
    if (card.id === "recycling-claw")
      expect(
        Object.values(saved.players[0].resources).reduce((a, b) => a + b, 0),
      ).toBe(13);
    if (card.id === "space-ring") expect(saved.players[0].handLimit).toBe(8);
    if (card.id === "skateboard-shoes") {
      await page.getByRole("button", { name: "完成出牌，进入移动" }).click();
      await expect
        .poll(async () => (await local.service.get(g.id)).phase)
        .toBe("move");
      const view = await local.service.get(g.id);
      const target = Object.keys(view.reachable).find(
        (id) => view.reachable[id].length === 3,
      );
      expect(target).toBeTruthy();
      await page
        .getByRole("button", { name: new RegExp(`^格子 ${target}，`) })
        .click();
      await page
        .getByRole("button", { name: `移动到 ${target}`, exact: true })
        .click();
      await expect
        .poll(async () => (await local.service.get(g.id)).players[0].position)
        .toBe(target);
    }
    if (card.id === "mining-drone") {
      await page.getByRole("button", { name: "完成出牌，进入移动" }).click();
      await page.getByRole("button", { name: "本回合不移动" }).click();
      await page
        .getByRole("button", {
          name: "无人机增产 · 资源 +1 / 环境 −1",
          exact: true,
        })
        .click();
      await expect
        .poll(
          async () => (await local.service.get(g.id)).players[0].resources.wood,
        )
        .toBe(5);
      expect((await local.service.get(g.id)).attributes.environment).toBe(9);
    }
    await expect(page.locator(".exp-error")).toHaveCount(0);
  });
}

test("beacon without an invitation: reject, retry, refresh, accept and enforce one use", async ({
  page,
}, info) => {
  const g = fixture();
  g.players[0].equipment = ["aid-beacon"];
  await load(page, g);
  const open = page.getByRole("button", {
    name: "使用互助信标交换",
    exact: true,
  });
  const panel = page.getByRole("region", { name: "互助信标交换流程" });
  async function propose() {
    await open.click();
    await expect(panel).toBeVisible();
    await page.getByLabel("互助信标交换对象").selectOption("P2");
    await panel.getByRole("button", { name: "给出木头", exact: true }).click();
    await panel.getByRole("button", { name: "换取金属", exact: true }).click();
    await panel
      .getByRole("button", { name: "发送交换请求", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "接受交换", exact: true }),
    ).toBeEnabled();
  }
  await propose();
  await panel.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(open).toBeEnabled();
  expect((await local.service.get(g.id)).players[0].resources.wood).toBe(3);
  await propose();
  await page.reload();
  await page
    .getByRole("button", { name: "查看 P3 玩家详情", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "接受交换", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "切换到受邀玩家回应", exact: true })
    .click();
  await panel.screenshot({ path: info.outputPath("beacon-consent.png") });
  await panel.getByRole("button", { name: "接受交换", exact: true }).click();
  await expect(open).toBeDisabled();
  await expect(page.locator(".equipment")).toContainText(
    "本回合已完成一次交换",
  );
  const saved = await local.service.get(g.id);
  expect(saved.players[0].resources.wood).toBe(2);
  expect(saved.players[0].resources.metal).toBe(4);
  expect(saved.players[1].resources.wood).toBe(4);
  expect(saved.players[1].resources.metal).toBe(2);
  expect(saved.players[0].hand).toHaveLength(0);
  expect(saved.activePlayerId).toBe("P1");
});

test("beacon explains out-of-range instead of looking like an inactive card", async ({
  page,
}) => {
  const g = fixture();
  g.players[0].equipment = ["aid-beacon"];
  g.players[1].position = "4,0";
  await load(page, g);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "使用互助信标交换" }),
  ).toBeDisabled();
  await expect(page.locator(".equipment")).toContainText("附近没有玩家");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("nested technology draws reset previous choice even when actor and phase stay unchanged", async ({
  page,
}) => {
  let g = fixture();
  g.players[0].hand = [
    { id: "technology", uid: "first" },
    { id: "technology", uid: "second" },
  ];
  g = command(g, {
    type: "play",
    cardUid: "first",
    actor: "P1",
    revision: g.revision,
  });
  await load(page, g);
  const first = CARDS.technology.find((c) => c.id === g.pending.choices[0]);
  await page
    .locator(".technology-choice .tech-options")
    .getByRole("button", { name: first.name, exact: true })
    .first()
    .click();
  await expect(
    page.locator(".technology-choice").getByRole("button", { name: /^获得 / }),
  ).toHaveCount(1);
  await page
    .locator(".hand-cards")
    .getByRole("button", { name: "使用", exact: true })
    .click();
  await expect(
    page.locator(".technology-choice").getByRole("button", { name: /^获得 / }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "放弃本次科技收益" }).click();
  await expect(
    page
      .locator(".technology-choice .tech-options")
      .getByRole("button", { name: first.name, exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(".technology-choice").getByRole("button", { name: /^获得 / }),
  ).toHaveCount(0);
});

test("blueprint full-hand recovery and exhausted old offers always have a safe way forward", async ({
  page,
}) => {
  const g = fixture();
  g.players[0].hand = Array.from({ length: 5 }, (_, i) => ({
    id: "invitation",
    uid: `H${i}`,
  }));
  g.discard = [{ id: "technology", uid: "recoverable" }];
  g.phase = "choice";
  g.pending = {
    kind: "recover",
    actor: "P1",
    choices: [...g.discard],
    resume: "cards",
  };
  await load(page, g);
  const choose = page.getByRole("button", {
    name: "选择 科技 · recoverable",
    exact: true,
  });
  await expect(choose).toBeDisabled();
  await expect(page.locator(".pending-choice")).toContainText("手牌已满");
  await page
    .locator(".hand-cards")
    .getByRole("button", { name: "弃置", exact: true })
    .first()
    .click();
  await expect(choose).toBeEnabled();
  await choose.click();
  await expect
    .poll(async () => (await local.service.get(g.id)).pending)
    .toBeNull();
  const saved = await local.service.get(g.id);
  expect(saved.players[0].hand).toHaveLength(5);
  expect(saved.players[0].hand.some((c) => c.uid === "recoverable")).toBe(true);
  const stale = fixture();
  stale.phase = "choice";
  stale.discard = [{ uid: "unrelated", id: "invitation" }];
  stale.pending = {
    kind: "recover",
    actor: "P1",
    choices: [{ uid: "missing", id: "technology" }],
    resume: "cards",
  };
  await load(page, stale);
  await page
    .getByRole("button", { name: "确认无可回收牌", exact: true })
    .click();
  await expect
    .poll(async () => (await local.service.get(stale.id)).pending)
    .toBeNull();
  expect((await local.service.get(stale.id)).players[0].hand).toHaveLength(0);
});

test("reserve crate reduces payment and blade triggers after all flood payments", async ({
  page,
}) => {
  let g = fixture();
  g.round = 3;
  g.turn = 2;
  g.phase = "donate";
  g.players[0].equipment = ["reserve-crate", "famed-blade"];
  g.players[0].position =
    g.players[0].spawn === "P1" ? TILES.find((t) => t.flag === "P1").id : "0,0";
  g = command(g, { type: "skip", actor: "P3", revision: g.revision });
  expect(g.pending.kind).toBe("flood");
  await load(page, g);
  const flood = page.getByRole("region", { name: "洪水扣除与缴纳明细" });
  await expect(flood).toContainText("储备仓生效");
  expect((await local.service.get(g.id)).pending.cost.optional).toBe(0);
  await flood
    .getByRole("button", { name: "确认本次扣除 / 无可扣资源", exact: true })
    .click();
  for (const actor of ["P2", "P3"]) {
    await expect
      .poll(async () => (await local.service.get(g.id)).activePlayerId)
      .toBe(actor);
    await flood
      .getByRole("button", { name: "选择扣除木头", exact: true })
      .click();
    await flood
      .getByRole("button", { name: "确认缴纳本次物资", exact: true })
      .click();
  }
  await expect(page.locator(".pending-choice")).toContainText("名刀触发");
  const before = await local.service.get(g.id);
  expect(before.players[0].resources.wood).toBe(3);
  const destination = Object.keys(before.reachable).find(
    (id) => id !== before.players[0].position,
  );
  await page
    .getByRole("button", { name: new RegExp(`^格子 ${destination}，`) })
    .click();
  await page.getByRole("button", { name: "确认名刀移动", exact: true }).click();
  await expect.poll(async () => (await local.service.get(g.id)).round).toBe(4);
  const after = await local.service.get(g.id);
  expect(after.players[0].equipment).not.toContain("famed-blade");
  expect(after.players[0].position).toBe(destination);
});

test("unaffordable alchemy and blocked claw can be inspected and declined without losing resources", async ({
  page,
}) => {
  const g = fixture("alchemy-furnace");
  g.pending.choices.push("recycling-claw");
  g.players[0].resources = { wood: 1, metal: 0, electricity: 0, seed: 0 };
  g.players[0].roundFlags.noConflictWith = ["P2"];
  await load(page, g);
  for (const name of ["炼金炉", "回收机械爪"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name: `获得 ${name} 的收益`, exact: true }),
    ).toBeDisabled();
  }
  await page
    .getByRole("button", { name: "放弃本次科技收益", exact: true })
    .click();
  await expect
    .poll(async () => (await local.service.get(g.id)).pending)
    .toBeNull();
  expect((await local.service.get(g.id)).players[0].resources).toEqual(
    g.players[0].resources,
  );
});
