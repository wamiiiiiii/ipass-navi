# E2E Tests (Playwright)

iPass ナビ の主要フローを Playwright で自動テストします。Mobile Chrome (Pixel 7) と Mobile Safari (iPhone 14) の2デバイスで実行します。

## セットアップ（初回のみ）

```bash
# プロジェクトルート（products/tools/ipass_pwa/）で実行
npm install
npx playwright install chromium webkit
```

## テスト実行

```bash
# ヘッドレスで全テスト実行
npm run test:e2e

# UI モード（インタラクティブ・ブラウザ可視）
npm run test:e2e:ui

# ブラウザを開いた状態で実行
npm run test:e2e:headed

# 特定のスペックだけ
npx playwright test e2e/smoke.spec.js
```

`webServer` 設定で Python の `http.server` がポート 4173 で自動起動します。Python3 が必要です。

## テスト構成

| ファイル | カバー範囲 |
|---|---|
| `smoke.spec.js` | 5タブのナビゲーションが壊れていないことの担保 |
| `quiz-flow.spec.js` | モード選択ポップアップ・4択演習・解説表示・過去問遷移 |
| `settings.spec.js` | テーマ切替・試験日設定・設定レイアウトクラス |

## レポート

失敗時は `playwright-report/index.html` に HTML レポート、`test-results/` に動画・スクリーンショット・トレースが残ります。

## 既知の制限

- `webServer` は Python の `http.server` を使用。Node.js のみの環境では `npx http-server -p 4173` などに差し替えてください
- ブラウザバイナリは `npx playwright install` でダウンロード（数百MB）
