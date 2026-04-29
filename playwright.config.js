// Playwright 設定ファイル
// 静的PWAをローカルサーバーで配信し、Mobile Chrome / Mobile Safari でE2Eテストを実行する

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // テストファイルの配置場所
  testDir: './e2e',
  // 並列実行（CI/local 両対応）
  fullyParallel: true,
  // CIで .only が残っている場合は失敗させる
  forbidOnly: !!process.env.CI,
  // CI のみリトライを有効化
  retries: process.env.CI ? 2 : 0,
  // CI ではワーカーを1にして安定性を優先（ローカルは自動）
  workers: process.env.CI ? 1 : undefined,
  // テスト結果の出力形式
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    // ローカルサーバーのベースURL（webServerと同じポート）
    baseURL: 'http://localhost:4173',
    // 失敗時にトレースを保存（再現に便利）
    trace: 'on-first-retry',
    // 失敗時のスクリーンショット
    screenshot: 'only-on-failure',
    // 動画は失敗時のみ
    video: 'retain-on-failure',
  },

  // モバイルファーストPWAなので、まずモバイル端末2種で確認する
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],

  // テスト前に自動で静的サーバーを起動する
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
