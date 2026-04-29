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
    // ダークボタンをクリック（buildThemeSelector の生成するボタン群を想定）
    const darkBtn = page.getByRole('button', { name: /ダーク|dark/i }).first();
    await darkBtn.click();
    // html要素 or body に data-theme=dark が設定される
    const themeAttr = await page.evaluate(() => {
      return document.documentElement.getAttribute('data-theme')
        || document.body.getAttribute('data-theme');
    });
    expect(themeAttr).toBe('dark');
  });

  test('試験予定日を設定するとlocalStorageに保存される', async ({ page }) => {
    // 試験日入力欄を探す（type=date）
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible();
    await dateInput.fill('2026-06-13');
    // 保存ボタンがあれば押す（自動保存の場合は不要）
    const saveBtn = page.getByRole('button', { name: /保存|更新/ });
    if (await saveBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await saveBtn.click();
    }
    // localStorage に exam_date が保存されている
    const examDate = await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      return settings.exam_date;
    });
    expect(examDate).toBe('2026-06-13');
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
