// quiz-flow.spec.js
// 問題演習のメインフロー（4択 / ○✗）が動作することを担保する
// シャッフル削除・ポップアップ式モード選択の統合的な動作確認も含む

import { test, expect } from '@playwright/test';

test.describe('問題演習フロー', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#nav-quiz').click();
  });

  test('シャッフルモードが削除されている', async ({ page }) => {
    // 監査時に削除した「シャッフル」モードが復活していないことを担保する
    await expect(page.getByText('シャッフル')).toHaveCount(0);
    // 過去のラベル「ランダム順で出題」も存在しないこと
    await expect(page.getByText('ランダム順で出題')).toHaveCount(0);
  });

  test('4択モードカードをタップするとポップアップが開く', async ({ page }) => {
    await page.getByText('4択（本番形式）').click();
    // モーダルが表示される
    const modal = page.locator('.quiz-mode-modal');
    await expect(modal).toBeVisible();
    // 分野チップと問題数チップが表示される
    await expect(modal.getByText('分野絞り込み')).toBeVisible();
    await expect(modal.getByText('問題数')).toBeVisible();
    // 開始ボタンが表示される
    await expect(modal.getByRole('button', { name: /演習を開始/ })).toBeVisible();
  });

  test('モーダルの✕ボタンで閉じられる', async ({ page }) => {
    await page.getByText('4択（本番形式）').click();
    const modal = page.locator('.quiz-mode-modal');
    await expect(modal).toBeVisible();
    // 閉じるボタン（✕）をクリック
    await modal.locator('.quiz-mode-modal-close').click();
    await expect(modal).toHaveCount(0);
  });

  test('オーバーレイ部分をクリックするとモーダルが閉じる', async ({ page }) => {
    await page.getByText('4択（本番形式）').click();
    const overlay = page.locator('.quiz-mode-modal-overlay');
    await expect(overlay).toBeVisible();
    // モーダル外（オーバーレイ）の上端をクリック
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toHaveCount(0);
  });

  test('Escキーでモーダルが閉じる', async ({ page }) => {
    await page.getByText('4択（本番形式）').click();
    await expect(page.locator('.quiz-mode-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.quiz-mode-modal')).toHaveCount(0);
  });

  test('模擬試験モードは確認テキストのみ表示しチップは出ない', async ({ page }) => {
    // モードカード経由で確実にクリックする（同じテキストが他に出ても干渉しない）
    const card = page.locator('.quiz-mode-card[data-mode="exam"]');
    await card.scrollIntoViewIfNeeded();
    await card.click({ force: true });
    const modal = page.locator('.quiz-mode-modal');
    await expect(modal).toBeVisible();
    // 模擬試験は分野チップ・問題数チップを出さない
    await expect(modal.getByText('分野絞り込み')).toHaveCount(0);
    await expect(modal.getByText('問題数')).toHaveCount(0);
    // 確認テキストは表示される
    await expect(modal.locator('.quiz-mode-modal-info')).toBeVisible();
  });

  test('4択モードで10問演習を開始→1問解答→解説が表示される', async ({ page }) => {
    // 4択モードカードをタップしてモーダルを開く
    await page.getByText('4択（本番形式）').click();
    const modal = page.locator('.quiz-mode-modal');
    // 開始ボタンをクリック
    await modal.getByRole('button', { name: /演習を開始/ }).click();

    // 問題画面に遷移するのを待つ（問題文 or 選択肢が表示される）
    await expect(page.locator('.quiz-question-screen')).toBeVisible({ timeout: 10_000 });

    // 1つ目の選択肢をタップ（4択ボタン）
    const firstChoice = page.locator('.choice-btn').first();
    await firstChoice.click();

    // 「確定」ボタンが現れる（CBT準拠の選択→確定式）
    const confirmBtn = page.getByRole('button', { name: /確定|決定|次へ/ });
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // 解説カード or 正解/不正解ラベルが表示される
    await expect(page.locator('.explanation-card, .marubatsu-feedback-label')).toBeVisible({ timeout: 5_000 });
  });

  test('過去問モードカードは直接年度選択画面に飛ぶ（モーダルを開かない）', async ({ page }) => {
    const card = page.locator('.quiz-mode-card[data-mode="past"]');
    await card.scrollIntoViewIfNeeded();
    await card.click({ force: true });
    // モーダルは出ない
    await expect(page.locator('.quiz-mode-modal')).toHaveCount(0);
    // 年度カードが表示される（令和X年度）
    await expect(page.getByText(/令和.*年度/).first()).toBeVisible({ timeout: 5_000 });
  });
});
