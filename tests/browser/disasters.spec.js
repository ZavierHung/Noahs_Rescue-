import { test, expect } from '@playwright/test';
import { startLocalTestApi } from '../helpers/local-api.mjs';
import { resolveDisasters } from '../../server/src/catalog.js';

async function expectUndistorted(images) {
  for (const img of await images.all()) {
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    const ratios = await img.evaluate((el) => ({ natural: el.naturalWidth / el.naturalHeight, displayed: el.getBoundingClientRect().width / el.getBoundingClientRect().height, fit: getComputedStyle(el).objectFit }));
    expect(Math.abs(ratios.natural - ratios.displayed)).toBeLessThan(0.002);
    expect(ratios.fit).toBe('contain');
  }
}

test('phone score changes display all 12 document cards, open readable previews and clear at balance', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const local = await startLocalTestApi();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: local.base + url.pathname + url.search });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mobile');
    const phone = page.getByRole('region', { name: '北极熊的手机' });
    await expect(phone).toContainText('已连接');
    await page.getByRole('button', { name: '一键测试开局', exact: true }).click();
    await expect(page.getByRole('heading', { name: '共同的世界', exact: true })).toHaveCount(6);
    await page.getByRole('button', { name: '切回单人手机', exact: true }).click();
    let previous = 10;
    for (const value of [2, 6, 14, 18, 10]) {
      for (const label of ['经济', '环境', '社会']) {
        await phone.getByRole('button', { name: `调整世界${label}，当前${previous}`, exact: true }).click();
        const slider = phone.getByRole('slider');
        await slider.focus();
        await slider.press(value <= 10 ? 'Home' : 'End');
        for (let n = 0; n < (value <= 10 ? value - 1 : 19 - value); n++) await slider.press(value <= 10 ? 'ArrowRight' : 'ArrowLeft');
        await phone.getByRole('textbox', { name: '分数调整原因' }).fill(`新版文档卡验证：${label} ${value}`);
        await phone.getByRole('button', { name: '保存分数并留档' }).click();
        await expect(phone.getByRole('button', { name: `调整世界${label}，当前${value}`, exact: true })).toBeVisible();
      }
      const expected = resolveDisasters({ economy: value, environment: value, society: value });
      await expect(phone.locator('.disaster-card')).toHaveCount(expected.length);
      if (expected.length) {
        await expectUndistorted(phone.locator('.disaster-art'));
        for (const card of expected) {
          const tile = phone.locator(`[data-disaster-id="${card.id}"]`);
          await expect(tile).toContainText(card.effect);
          await tile.getByRole('button', { name: `查看${card.name}卡牌大图` }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toContainText(card.name);
          await expect(dialog).toHaveCSS('opacity', '1');
          await expectUndistorted(dialog.locator('.disaster-art-full'));
          if (card.id === 'resource-protection') await page.screenshot({ path: testInfo.outputPath('card-preview-phone.png'), animations: 'disabled' });
          await dialog.getByRole('button', { name: '关闭卡牌大图' }).click();
          await expect(dialog).toHaveCount(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (value === 14) await page.screenshot({ path: testInfo.outputPath('new-disaster-cards-phone.png'), fullPage: true, animations: 'disabled' });
      }
      previous = value;
    }
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await local.close();
  }
});

test('original dashboard uses the same new cards and preserves image proportions', async ({ page }, testInfo) => {
  const attributes = { economy: 18, environment: 14, society: 2 };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/api/health' ? { ok: true, rag: { model: 'local-test', documents: 8 }, llm: { provider: 'none', model: '', enabled: false } }
      : url.pathname === '/api/state' ? { round: 1, attributes, activeDisasters: resolveDisasters(attributes), updatedAt: null } : [];
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/');
  await expect(page.locator('.disaster-card')).toHaveCount(3);
  await expectUndistorted(page.locator('.disaster-art'));
  await expect(page.locator('.disaster-panel')).toContainText('财富悬殊');
  await expect(page.locator('.disaster-panel')).toContainText('资源保护');
  await page.getByRole('button', { name: '查看财富悬殊卡牌大图' }).click();
  await expectUndistorted(page.getByRole('dialog').locator('.disaster-art-full'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('new-disaster-cards-desktop.png'), fullPage: true, animations: 'disabled' });
});
