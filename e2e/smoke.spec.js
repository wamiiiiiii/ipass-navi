// smoke.spec.js
// アプリの基本起動・ナビゲーションが壊れていないことを確認するスモークテスト
// すべての画面に1回ずつ遷移できること、主要DOM要素が存在することを担保する

import { test, expect } from '@playwright/test';

test.describe('スモークテスト：アプリ起動とナビゲーション', () => {
  test.beforeEach(async ({ page }) => {
    // ベースURLにアクセス（playwright.config.js で http://localhost:4173 を設定済み）
    await page.goto('/');
    // localStorageをクリアして初回ユーザー状態にする
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('ホーム画面が起動して主要要素が表示される', async ({ page }) => {
    // ヘッダータイトル
    await expect(page.locator('#header-title')).toBeVisible();
    // ボトムナビ5タブが揃っている
    await expect(page.locator('#nav-home')).toBeVisible();
    await expect(page.locator('#nav-textbook')).toBeVisible();
    await expect(page.locator('#nav-quiz')).toBeVisible();
    await expect(page.locator('#nav-glossary')).toBeVisible();
    await expect(page.locator('#nav-settings')).toBeVisible();
    // 初回ユーザーはオンボーディングカードが見える
    await expect(page.getByText('はじめての方へ')).toBeVisible();
  });

  test('教科書タブに遷移して分野一覧が表示される', async ({ page }) => {
    await page.locator('#nav-textbook').click();
    // 教科書画面のイントロ
    await expect(page.getByText('学習したい分野を選んでください')).toBeVisible();
    // 3分野のカードが表示される（ストラテジ・マネジメント・テクノロジ）
    await expect(page.getByText('ストラテジ系')).toBeVisible();
    await expect(page.getByText('マネジメント系')).toBeVisible();
    await expect(page.getByText('テクノロジ系')).toBeVisible();
  });

  test('演習タブに遷移してモード選択が表示される', async ({ page }) => {
    await page.locator('#nav-quiz').click();
    // タイトルとサブタイトル
    await expect(page.getByRole('heading', { name: '問題演習' })).toBeVisible();
    // 6つのモードカードが表示される（standard / flashcard / review / weak / exam / past）
    await expect(page.getByText('4択（本番形式）')).toBeVisible();
    await expect(page.getByText('○✗モード')).toBeVisible();
    await expect(page.getByText('今日の復習')).toBeVisible();
    await expect(page.getByText('苦手問題のみ')).toBeVisible();
    await expect(page.getByText('模擬試験')).toBeVisible();
    await expect(page.getByText('過去問演習')).toBeVisible();
  });

  test('辞書タブに遷移して検索フォームが表示される', async ({ page }) => {
    await page.locator('#nav-glossary').click();
    // 検索ボックスが存在する
    await expect(page.getByPlaceholder(/検索|用語/)).toBeVisible();
  });

  test('設定タブに遷移して各セクションが表示される', async ({ page }) => {
    await page.locator('#nav-settings').click();
    // セクションヘッダー
    await expect(page.getByText('表示設定')).toBeVisible();
    await expect(page.getByText('学習設定')).toBeVisible();
    await expect(page.getByText('データ管理')).toBeVisible();
    await expect(page.getByText('アプリ情報')).toBeVisible();
  });
});
