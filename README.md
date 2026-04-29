# iPass ナビ — ITパスポート学習PWA

ITパスポート試験（IPA）の学習を支援するProgressive Web App。教科書・問題演習・用語辞書をオフラインで利用できる。

## 公開URL

[https://wamiiiiiii.github.io/ipass-navi/](https://wamiiiiiii.github.io/ipass-navi/)

スマートフォンでアクセスして「ホーム画面に追加」するとネイティブアプリ風に動作します。

## 主な機能

| カテゴリ | 内容 |
|---|---|
| **教科書** | シラバス Ver.6.5 準拠のテキスト。分野（ストラテジ／マネジメント／テクノロジ）から章・節までドリルダウン |
| **問題演習** | 4択（本番形式）・○✗モード・苦手問題・SRS復習・模擬試験（100問・120分）・過去問演習（年度別） |
| **用語辞書** | 50音・分野でフィルタ。関連用語・関連問題から相互リンク |
| **学習計画** | 試験日からの逆算でホーム画面に「今日のミッション」を自動生成 |
| **進捗管理** | 章マスター勲章・連続学習日数・分野別正答率・合格判定 |
| **オフライン対応** | Service Worker で全コンテンツをキャッシュ。電波がなくても学習可能 |

## 技術スタック

- 純粋な HTML / CSS / Vanilla JavaScript（フレームワークなし・ES Modules）
- Progressive Web App（manifest + Service Worker）
- localStorage によるクライアントサイドの進捗保持
- Playwright による E2E テスト（Mobile Chrome / Mobile Safari）
- ライト／ダーク／システム連動の3テーマ対応

## 学習の進め方

1. **教科書で基礎をインプット** — 分野→章→節の順に通し読み
2. **節ごとに「この節の問題を解く」で確認テスト**
3. **章末で「この章の問題を解く」で総合演習**
4. **苦手問題モード** で誤答率の高い問題を集中攻略
5. **SRS復習** で記憶の定着（Anki方式・1→3→7→21→60日）
6. **模擬試験** で本番形式の練習（合否判定・分野別足切り対応）

## ローカル起動

```bash
# 静的サーバーで配信
python3 -m http.server 4173
# → http://localhost:4173 を開く
```

## E2E テスト

```bash
npm install
npx playwright install chromium webkit
npm run test:e2e         # ヘッドレスで実行
npm run test:e2e:ui      # UIモード（インタラクティブ）
npm run test:e2e:headed  # ブラウザを開いて実行
```

カバー範囲：

| ファイル | 内容 |
|---|---|
| `e2e/smoke.spec.js` | 5タブのナビゲーション |
| `e2e/quiz-flow.spec.js` | モード選択ポップアップ・4択演習・過去問遷移 |
| `e2e/settings.spec.js` | テーマ切替・試験日設定・レイアウトクラス |

## 問題データの規模

| 区分 | 問題数 |
|---|---|
| シラバス基礎問題 | 約120問 |
| 補足問題（オリジナル） | 約400問 |
| IPA 公開過去問（R02秋・R03春・R04春・R05春・R06春） | 約400問 |
| **合計** | **約930問** |

正答位置の偏りを抑えるため、過去問の選択肢は意図的にシャッフルしています（生成時のテンプレ偏りを回避）。

## バージョン管理

リリース時は `index.html` の `<meta name="app-version">` と `sw.js` の `CACHE_NAME` を必ず一緒にバンプします。設定画面のバージョン表示は `app-version` から動的に読み込んでいるため、ユーザーが「今どの版を見ているか」をひと目で判別できます。

## ディレクトリ構成

```
ipass-navi/
├── index.html                  # エントリーポイント（CSP・PWA メタ・5タブナビ）
├── manifest.json               # PWA マニフェスト
├── sw.js                       # Service Worker
├── css/
│   ├── variables.css           # 色・余白・フォントの設計トークン
│   ├── layout.css              # ヘッダー・ボトムナビ・safe-area
│   ├── reset.css
│   ├── home.css / textbook.css / quiz.css / glossary.css / settings.css
│   ├── diagram.css             # 図解コンポーネント
│   └── celebration.css         # 正解時の演出（紙吹雪・バウンス）
├── js/
│   ├── app.js                  # 起動・ルーティング初期化
│   ├── router.js               # ハッシュベース SPA ルーター
│   ├── store.js                # localStorage 抽象化
│   ├── dataLoader.js           # JSON データの並列ロード
│   ├── screens/                # home / textbook / quiz / glossary / settings
│   └── utils/                  # render / progress / srs / diagram / celebration
├── data/
│   ├── chapters*.json          # 教科書コンテンツ
│   ├── questions*.json         # 問題プール（オリジナル + IPA公開過去問）
│   ├── glossary*.json          # 用語辞書
│   └── diagrams.json           # 図解定義
├── e2e/                        # Playwright テスト
└── icons/                      # PWA アイコン
```

## 関連プロジェクト

- [FE ナビ](https://github.com/wamiiiiiii/fe-navi) — 同じコードベースで構築する基本情報技術者試験版

## 注意事項

- 過去問は IPA（情報処理推進機構）が公開している試験問題を出典として明記の上で取り込んでいます
- 個人学習用途を主目的としており、無断での商用転載は不可です

## ライセンス

私的利用向け（販売準備中）。
