import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const cards = JSON.parse(
  await readFile(
    new URL("../data/expedition/cards.json", import.meta.url),
    "utf8",
  ),
);
const characters = JSON.parse(
  await readFile(
    new URL("../data/expedition/characters.json", import.meta.url),
    "utf8",
  ),
);

// Transcribed from the DOCX card faces, not the separate print-production folder.
// Keep these expected rules independent of the catalog so accidental drift fails.
const expectedTechnology = [
  [
    "space-ring",
    "空间戒指",
    "手牌上限变为 8；同类手牌上限科技不可叠加。",
    { economy: 2 },
  ],
  [
    "skateboard-shoes",
    "滑板鞋",
    "每回合第一次使用【移动】时，移动距离 +1 格。",
    { environment: 2 },
  ],
  [
    "famed-blade",
    "名刀",
    "被洪水缩圈波及时，立即额外移动 2 格。",
    { economy: 1, society: -1 },
  ],
  [
    "mining-drone",
    "采矿无人机",
    "每回合第一次【采集】时，额外获得 1 个该类资源。",
    { economy: 2, environment: -2 },
  ],
  [
    "reserve-crate",
    "储备仓",
    "缩圈后的资源扣除阶段，少支付 1 个资源。",
    { environment: -1 },
  ],
  [
    "alchemy-furnace",
    "炼金炉",
    "将任意 2 个资源转化为任意 3 个同类资源；本回合不能使用【邀约】。",
    { environment: 1, economy: -1 },
  ],
  [
    "aid-beacon",
    "互助信标",
    "周围一圈范围内有任意玩家时，每回合可与其中 1 名玩家交换各 1 个资源；本回合不能对该玩家选择【斗争】。",
    { society: 2, economy: 2, environment: -2 },
  ],
  [
    "shared-supply-pod",
    "共享补给舱",
    "从资源池公开抽取玩家人数 +1 个资源，从你开始顺时针每名玩家选择 1 个资源获得，剩余资源弃置。",
    { society: 2, economy: 1, environment: -2 },
  ],
  [
    "ecological-repeller",
    "生态驱赶器",
    "所有不在方舟范围内的玩家选择一项：弃置 1 个资源，或向远离方舟方向移动 1 格。",
    { environment: 1, society: -1 },
  ],
  [
    "black-tide-alarm",
    "黑潮警报器",
    "所有位于水域、河流或洪水边缘相邻地块的玩家弃置 1 个资源；若没有资源，则弃置 1 张手牌。",
    { environment: 1, economy: -1 },
  ],
  [
    "rapid-prototyper",
    "快速原型机",
    "立即抽 2 张行动卡，选择 1 张加入手牌，另一张置于牌堆底部。",
    { economy: 1, environment: -1 },
  ],
  [
    "ruins-blueprint",
    "废墟蓝图",
    "从弃牌区选择 1 张行动卡加入手牌；不能选择已经弃置的限次科技牌。",
    { economy: 1, environment: -1 },
  ],
  [
    "recycling-claw",
    "回收机械爪",
    "选择相邻 1 名玩家，获得其 1 个随机资源；若对方没有资源，则你抽 1 张行动卡。",
    { economy: 2, society: -2 },
  ],
];

// A dependency-free SOF reader is sufficient for JPEG image geometry. It does
// not decode pixels or execute image tools, so this also runs on CI/Linux.
function jpegDimensions(bytes) {
  assert.ok(bytes.length >= 4, "JPEG is truncated");
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "JPEG SOI signature");
  assert.equal(
    bytes.readUInt16BE(bytes.length - 2),
    0xffd9,
    "JPEG EOI signature",
  );
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff, "JPEG marker prefix");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    assert.ok(offset + 2 <= bytes.length, "JPEG segment length is present");
    const length = bytes.readUInt16BE(offset);
    assert.ok(
      length >= 2 && offset + length <= bytes.length,
      "JPEG segment is complete",
    );
    if (sofMarkers.has(marker)) {
      assert.ok(length >= 8, "JPEG frame header is complete");
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      assert.ok(width > 0 && height > 0, "JPEG dimensions are positive");
      return { width, height };
    }
    offset += length;
  }
  assert.fail("JPEG is missing its SOF dimensions");
}

test("expedition catalog has exactly ten unique source characters, without invented abilities", () => {
  assert.equal(characters.source.document, "资产合集.docx");
  assert.equal(characters.characters.length, 10);
  assert.equal(
    new Set(characters.characters.map((entry) => entry.id)).size,
    10,
  );
  assert.deepEqual(
    characters.characters.map((entry) => entry.name),
    [
      "格兰特斑马耳廓沙狐",
      "白翅雪雀",
      "扬子鳄",
      "金狮狷猴",
      "北极熊",
      "生物学家",
      "炼金师",
      "舰长",
      "流浪商人",
      "荒野猎人",
    ],
  );
  characters.characters.forEach((entry, index) => {
    assert.equal(entry.faction, index < 5 ? "animal" : "human");
    assert.equal(entry.factionLabel, index < 5 ? "动物阵营" : "人类阵营");
    assert.equal(entry.sourceImage, `image${index + 3}.png`);
    assert.equal(entry.text, `${entry.factionLabel} · ${entry.name} · 角色卡`);
    assert.equal(entry.skills, undefined);
    assert.equal(entry.attributes, undefined);
  });
});

test("expedition decks contain only the two actions and thirteen technologies shown in the DOCX", () => {
  assert.equal(cards.source.document, "资产合集.docx");
  assert.deepEqual(
    cards.actions.map((entry) => entry.id),
    ["invitation", "technology"],
  );
  assert.deepEqual(
    cards.technology.map((entry) => entry.id),
    expectedTechnology.map(([id]) => id),
  );
  const all = [...cards.actions, ...cards.technology];
  assert.equal(all.length, 15);
  assert.equal(new Set(all.map((entry) => entry.id)).size, 15);
  assert.equal(new Set(all.map((entry) => entry.name)).size, 15);
  all.forEach((entry) => assert.equal(entry.sourceCopies, 1));
  assert.deepEqual(cards.drawPolicy, {
    action: "equal_probability_with_replacement",
    technology: "equal_probability_with_replacement",
    duplicatesAllowed: true,
  });
  assert.doesNotMatch(
    cards.technology.map((entry) => entry.name).join("|"),
    /名刃|储存仓|侦察无人机|疾跑靴|小矿镐|资源打印机|海龟壳|铁公鸡/,
  );
});

test("invitation consent and immediate two-choose-one technology rules preserve the original text", () => {
  const [invitation, technology] = cards.actions;
  assert.equal(invitation.name, "邀约");
  assert.equal(
    invitation.effect,
    "尝试进行一次资源交换；若被拒绝，可再向其他玩家发出请求。",
  );
  assert.equal(invitation.condition, "对已建立联络的玩家使用。");
  assert.equal(invitation.restriction, "对方可自由选择回应或拒绝。");
  assert.deepEqual(invitation.semantics, {
    kind: "nearest_cooperative_grant",
    nearestCount: 2,
    requiresConsent: true,
    resourceEach: 1,
    independentResourceChoice: true,
    retryAfterRejection: true,
  });
  assert.ok(
    [...cards.actions, ...cards.technology].every(
      (c) =>
        typeof c.implementedEffect === "string" &&
        c.implementedEffect.length > 10,
    ),
  );
  assert.match(invitation.implementedEffect, /不是交换/);
  assert.equal(
    technology.effect,
    "随机抽取两张科技卡卡牌并选择一张获得对应收益",
  );
  assert.equal(technology.condition, "任意时刻可使用。");
  assert.equal(technology.restriction, "效果包含即时或持续增益。");
  assert.deepEqual(technology.semantics, {
    kind: "technology_choice",
    drawCount: 2,
    chooseCount: 1,
    activateSelected: true,
  });
  assert.deepEqual(invitation.status, {});
  assert.deepEqual(technology.status, {});
});

test("all thirteen technology effect texts and status changes match the original card faces", () => {
  expectedTechnology.forEach(([id, name, effect, status], index) => {
    const entry = cards.technology[index];
    assert.equal(entry.id, id);
    assert.equal(entry.name, name);
    assert.equal(entry.effect, effect, id);
    assert.deepEqual(entry.status, status, id);
    assert.equal(entry.kind, "technology");
    assert.equal(entry.sourceImage, `image${index + 30}.png`);
    assert.ok(entry.semantics.kind);
  });
  const byId = Object.fromEntries(
    cards.technology.map((entry) => [entry.id, entry]),
  );
  assert.deepEqual(
    cards.technology
      .filter((entry) => entry.type === "常驻被动")
      .map((entry) => entry.id),
    [
      "space-ring",
      "skateboard-shoes",
      "mining-drone",
      "reserve-crate",
      "aid-beacon",
    ],
  );
  assert.equal(byId["space-ring"].semantics.stackable, false);
  assert.equal(byId["famed-blade"].semantics.trigger, "affected_by_flood");
  assert.equal(
    byId["alchemy-furnace"].semantics.blocksActionForRound,
    "invitation",
  );
  assert.equal(
    byId["aid-beacon"].semantics.blocksConflictWithTargetForRound,
    true,
  );
  assert.equal(byId["rapid-prototyper"].semantics.unselected, "deck_bottom");
  assert.equal(
    byId["ruins-blueprint"].semantics.excludeLimitedTechnology,
    true,
  );
});

test("all 27 source-derived JPEGs exist and retain the exact original dimensions and proportions", async () => {
  const entries = [
    ...cards.actions,
    ...cards.technology,
    ...Object.values(cards.backs),
    ...characters.characters,
  ];
  assert.equal(entries.length, 27);
  assert.equal(new Set(entries.map((entry) => entry.image)).size, 27);
  const unusualSizes = {
    "image6.png": [957, 1644],
    "image10.png": [959, 1641],
    "image12.png": [959, 1640],
    "image13.png": [744, 1039],
    "image15.png": [744, 1039],
    "image29.png": [744, 1039],
  };
  const tallerTechnology = new Set([33, 36, 37, 38, 39, 40, 41, 42]);
  for (const entry of entries) {
    assert.match(
      entry.image,
      /^\/images\/expedition\/(cards|characters)\/[a-z0-9-]+\.jpg$/,
    );
    const imageNumber = Number(
      entry.sourceImage.match(/^image(\d+)\.png$/)?.[1],
    );
    assert.ok(Number.isInteger(imageNumber), entry.image);
    const sourceDimensions =
      unusualSizes[entry.sourceImage] ??
      (imageNumber >= 3 && imageNumber <= 12
        ? [958, 1642]
        : [1061, tallerTechnology.has(imageNumber) ? 1483 : 1482]);
    assert.deepEqual(
      [entry.width, entry.height],
      sourceDimensions,
      `${entry.image}: source metadata drift`,
    );
    const bytes = await readFile(
      new URL(`../../app/public${entry.image}`, import.meta.url),
    );
    const actual = jpegDimensions(bytes);
    assert.deepEqual(
      actual,
      { width: entry.width, height: entry.height },
      entry.image,
    );
    assert.equal(
      actual.width / actual.height,
      sourceDimensions[0] / sourceDimensions[1],
      `${entry.image}: stretched`,
    );
  }
});

test("JPEG geometry checks reject invalid or truncated files instead of trusting metadata", () => {
  assert.throws(() => jpegDimensions(Buffer.from("not-an-image")), /JPEG SOI/);
  assert.throws(
    () => jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    /missing its SOF/,
  );
  assert.throws(
    () =>
      jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 12, 0xff, 0xd9])),
    /segment is complete/,
  );
});
