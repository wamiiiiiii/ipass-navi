// settings.spec.js
// 設定画面：テーマ切替・試験日設定の動作確認

import { test, expect } from '@playwright/test';

test.describe('設定画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#nav-settings').click();
  });

  test('テーマセレクタでダークテーマに切り替えるとhtmlに data-theme=dark が反映される', async ({ page }) => {
    // テーマオプションは <div class="theme-option"> で role がついていないため class でマッチさせる
    const darkOption = page.locator('.theme-option', { hasText: 'ダーク' });
    // ボトムナビが overlapping する場合があるので scrollIntoViewIfNeeded で確実にビューポート内へ
    await darkOption.scrollIntoViewIfNeeded();
    // Safari では稀にイベント伝播が完了しないので force click で確実にクリックを送る
    await darkOption.click({ force: true });

    // applyTheme が html 要素に data-theme を設定する
    await expect.poll(async () => {
      return page.evaluate(() => {
        return document.documentElement.getAttribute('data-theme')
          || document.body.getAttribute('data-theme');
      });
    }, { timeout: 3000 }).toBe('dark');
  });

  test('試験予定日を設定するとlocalStorageに保存される', async ({ page }) => {
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();
    // mobile-safari は input[type=date] のピッカーが独自実装で fill() が効かない場合がある。
    // value を直接代入し、change イベントを明示的に発火させる
    await page.evaluate(() => {
      const el = document.querySelector('input[type="date"]');
      if (!el) return;
      el.value = '2026-06-13';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // localStorage キーは ipass_settings（store.js の KEYS.SETTINGS）
    await expect.poll(async () => {
      return page.evaluate(() => {
        const settings = JSON.parse(localStorage.getItem('ipass_settings') || '{}');
        return settings.exam_date;
      });
    }, { timeout: 3000 }).toBe('2026-06-13');
  });

  test('settings画面のレイアウトクラスが正しく適用されている', async ({ page }) => {
    // HIGH対応で .settings-item--stack に切り出した縦積みクラスが付与されている
    const stackItems = page.locator('.settings-item--stack');
    expect(await stackItems.count()).toBeGreaterThan(0);
    // .settings-item-row も同様
    const rowItems = page.locator('.settings-item-row');
    expect(await rowItems.count()).toBeGreaterThan(0);
  });
});
