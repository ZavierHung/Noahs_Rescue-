import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { bandFor, resolveDisasters, DISASTERS, DISASTER_VERSION, refreshWorldDisasters } from '../src/catalog.js';

test('four threshold bands and stable band are resolved correctly', () => {
  assert.equal(bandFor(1), 'criticalLow');
  assert.equal(bandFor(2), 'criticalLow');
  assert.equal(bandFor(6), 'low');
  assert.equal(bandFor(7), 'stable');
  assert.equal(bandFor(13), 'stable');
  assert.equal(bandFor(14), 'high');
  assert.equal(bandFor(18), 'criticalHigh');
  assert.equal(bandFor(19), 'criticalHigh');
});

test('disaster remains stable within one band and clears outside it', () => {
  const first = resolveDisasters({ economy: 14, environment: 10, society: 10 }, [], () => 0);
  const sameBand = resolveDisasters({ economy: 17, environment: 10, society: 10 }, first, () => 0.99);
  const cleared = resolveDisasters({ economy: 13, environment: 10, society: 10 }, sameBand, () => 0);
  assert.equal(first.length, 1);
  assert.equal(sameBand[0].id, first[0].id);
  assert.equal(sameBand[0].triggerValue, 17);
  assert.deepEqual(cleared, []);
});

test('new environment tier uses the new card, never a removed legacy card', () => {
  const result = resolveDisasters({ economy: 10, environment: 18, society: 10 }, [], () => 0.99);
  assert.equal(result[0].id, 'eco-conflict');
  assert.equal(result[0].band, 'criticalHigh');
});

test('all 19 scores in all three dimensions resolve the 12 document cards', () => {
  const expected = {
    economy: ['deflation', 'depression', 'develop-first', 'wealth-gap'],
    environment: ['steady-imbalance', 'eco-collapse', 'resource-protection', 'eco-conflict'],
    society: ['class-lock', 'social-disorder', 'welfare-pressure', 'mutual-aid'],
  };
  const seen = new Set();
  for (const [dimension, cards] of Object.entries(expected)) {
    for (let score = 1; score <= 19; score++) {
      const result = resolveDisasters({ economy: 10, environment: 10, society: 10, [dimension]: score });
      if (score >= 7 && score <= 13) { assert.deepEqual(result, []); continue; }
      const card = result[0];
      assert.equal(result.length, 1);
      assert.equal(card.id, cards[score <= 2 ? 0 : score <= 6 ? 1 : score <= 17 ? 2 : 3]);
      assert.equal(card.triggerValue, score);
      assert.equal(card.catalogVersion, DISASTER_VERSION);
      assert.equal(card.image.file, `${card.id}.jpg`);
      seen.add(card.id);
    }
  }
  assert.equal(seen.size, 12);
  assert.equal(resolveDisasters({ economy: 2, environment: 6, society: 19 }).length, 3);
});

test('same-band legacy effects and removed identities are refreshed without mutating input', () => {
  const old = { attributes: { economy: 14, environment: 14, society: 18 }, activeDisasters: [
    { id: 'develop-first', dimension: 'economy', band: 'high', effect: '开采成功率降低 50%' },
    { id: 'low-carbon-pain', dimension: 'environment', band: 'high' },
    { id: 'collective-delay', dimension: 'society', band: 'criticalHigh' },
  ] };
  const before = structuredClone(old);
  const fresh = refreshWorldDisasters(old);
  assert.deepEqual(old, before);
  assert.deepEqual(fresh.activeDisasters.map((d) => d.id), ['develop-first', 'resource-protection', 'mutual-aid']);
  assert.doesNotMatch(fresh.activeDisasters[0].effect, /50%/);
  assert.deepEqual(refreshWorldDisasters(fresh), fresh);
  fresh.activeDisasters[0].image.file = 'mutated';
  assert.equal(refreshWorldDisasters(old).activeDisasters[0].image.file, 'develop-first.jpg');
});

test('effects preserve document details, not the superseded mechanics', () => {
  const all = Object.values(DISASTERS).flatMap((bands) => Object.values(bands).flat());
  const byId = Object.fromEntries(all.map((card) => [card.id, card]));
  assert.equal(byId['wealth-gap'].name, '财富悬殊');
  assert.match(byId['wealth-gap'].effect, /1 个晶矿资源/);
  assert.match(byId['welfare-pressure'].effect, /1 份保障物资/);
  assert.equal(byId['depression'].effect, '收回所有经济增益卡牌（科技）。');
  assert.equal(byId['eco-collapse'].effect, '被采集过的自然地块不可再次产出资源。');
  assert.match(byId['resource-protection'].effect, /成功保护资源时，生态值 \+1/);
  assert.match(byId['resource-protection'].effect, /过度保护导致开发受限时，经济值 -1/);
  assert.match(byId['deflation'].effect, /手牌上限 -1.*一张科技牌/);
  assert.match(byId['eco-conflict'].effect, /相邻（不限阵营）.*消耗 1 资源.*行动失效/);
  assert.match(byId['social-disorder'].effect, /禁止远程合作和远程交易.*相邻（不限阵营）/);
  assert.match(byId['mutual-aid'].effect, /每回合资源最多.*最少.*1 资源/);
  assert.match(byId['class-lock'].effect, /向下取整.*50%.*额外获得 1.*50%.*少获得 1/);
  assert.match(byId['steady-imbalance'].effect, /类型可以自选.*立即且每轮/);
  assert.doesNotMatch(JSON.stringify(all), /低碳转型阵痛|集体决策低效|资源保护区扩大|开采成功率|自然资源产出 -1/);
});

test('12 source card assets retain native proportions and stay within 3 MB', async () => {
  const art = JSON.parse(await readFile(new URL('../data/disaster-art.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(art.assets).length, 12);
  let total = 0;
  for (const [id, asset] of Object.entries(art.assets)) {
    const web = await readFile(new URL(`../../app/public/images/disasters/${asset.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(web).digest('hex'), asset.sha256);
    assert.equal(web.subarray(0, 2).toString('hex'), 'ffd8');
    assert.ok(Math.abs(asset.width / asset.height - asset.originalWidth / asset.originalHeight) < 0.001, id);
    assert.ok(Math.abs(asset.width / asset.height - 5 / 7) < 0.003, id);
    assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(web.length, asset.bytes);
    total += web.length;
  }
  assert.ok(total < 3 * 1024 * 1024);
});
