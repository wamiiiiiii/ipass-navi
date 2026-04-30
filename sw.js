/**
 * sw.js
 * Service Worker - オフラインキャッシュ管理
 *
 * キャッシュ戦略：
 * - UIリソース（HTML・CSS・JS）: Stale-While-Revalidate（キャッシュを返しつつバックグラウンドで更新）
 * - JSONデータファイル: Cache First（キャッシュ優先・オフライン対応）
 * - その他: Network First（ネットワーク優先）
 */

// キャッシュの名前（バージョンを上げると古いキャッシュを削除できる）
// 【重要・運用ルール】リリース時はこの値と index.html の <meta name="app-version"> を必ず一緒に更新する。
// 設定画面のバージョン表示が app-version から動的に読まれるため、ユーザーが現在どの版を見ているかを
// 判別できるようになる。SW のキャッシュバンプを忘れると古いデータが配信され続けるので注意。
//
// v17 (app-version 1.1.0): 問題データ95件修正（P-R06S-084ほか）・Phase 1コピー敬語化・
//   ポップアップ式モード選択・CRITICAL/HIGH UI修正・E2E導入・CSP追加。Service Worker のバージョン
//   不更新でデータ修正がユーザー端末に届いていなかった不具合を解消する。
// v18 (app-version 1.1.1): 分野チップを2段組（上段「すべて」単独・下段3分野均等）に変更。
// v19 (app-version 1.1.2): 教科書「この章の問題を解く」に問題数表示・孤立データS-08(3問)→S-02統合・
//   chapter-quiz-btn のハードコード色をテーマトークン化・0問章のボタン無効化。
// v20 (app-version 1.2.0): 教科書の節（細分化された項目）単位での問題演習を追加。
//   各節画面に「この節の問題を解く（X問）」ボタン・filterQuestionsByPage / startPageSession 追加。
// v21 (app-version 1.2.1): MEDIUM級UI調整。本文サイズ16px化（iOS推奨最低達成）・
//   celebration 100vh→100dvh（iOS Safariアドレスバー高さ問題回避）・
//   reset.css scroll-behavior:smooth 削除（SPA遷移後 scrollTo(0,0) との競合解消）。
// v22 (app-version 1.2.2): R06/past2/past_r04s の選択肢シャッフル（生成時のb偏り解消）。
//   home.js の dead code（buildExamCountdown / buildStreakBadge）と関連CSSを削除。
// v23 (app-version 1.3.0): 章演習はランダム20問・節演習はランダム5問に上限化。
//   章は30〜75問のばらつきがあり、1セッションの負担を一定にするため。
// v24 (app-version 1.4.0): 教科書 phantom 節 74節を追加（旧 100→174節）。
//   問題77件の orphan related_page_id をすべて実在節に紐付け、節クイズが
//   全章で機能するようにした。chapter_id 1件（P-R03S-089: T-10→T-11）も修正。
// v25 (app-version 1.5.0): Phase C「節5問体制」完成。
//   既存934問の related_page_id を Sonnet 並列で再マッピング（539問変更・節と内容のズレ81%を解消）。
//   章不整合 3件修正（Q-M-064, P-R04S-079, P-R06S-009）。
//   不足節117節に対し節 summary_points 厳守プロンプトで379問追加生成（questions_extra3.json）。
//   全節が5問以上になり、教科書のポイントに沿った演習が全節で可能に。総問題数 934→1313。
const CACHE_NAME = 'ipass-navi-v25';
const DATA_CACHE_NAME = 'ipass-navi-data-v25';

// アプリシェル（UIリソース）：初回インストール時にキャッシュするファイルリスト
const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/reset.css',
  './css/variables.css',
  './css/layout.css',
  './css/home.css',
  './css/textbook.css',
  './css/quiz.css',
  './css/glossary.css',
  './css/settings.css',
  './css/diagram.css',
  './css/celebration.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/dataLoader.js',
  './js/screens/home.js',
  './js/screens/textbook.js',
  './js/screens/quiz.js',
  './js/screens/glossary.js',
  './js/screens/settings.js',
  './js/utils/render.js',
  './js/utils/progress.js',
  './js/utils/diagram.js',
  './js/utils/srs.js',
  './js/utils/celebration.js',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// JSONデータファイル：Cache First で管理するファイル
// loadQuestions() が並行fetchで統合するため、すべての questions*.json を含める
const DATA_FILES = [
  './data/chapters.json',
  './data/questions.json',
  './data/questions_extra1.json',
  './data/questions_extra2.json',
  './data/questions_past2.json',
  './data/questions_past_r02a.json',
  './data/questions_past_r04s.json',
  './data/questions_past_r05.json',
  './data/questions_past_r06.json',
  './data/glossary.json',
  './data/diagrams.json',
];

// ===================================================
// インストールイベント：初回キャッシュの構築
// ===================================================
self.addEventListener('install', (event) => {
  console.info('[SW] インストール中...');

  event.waitUntil(
    (async () => {
      // アプリシェルを個別にキャッシュする（1ファイル失敗しても他は続行する）
      const appCache = await caches.open(CACHE_NAME);
      const appResults = await Promise.allSettled(
        APP_SHELL_FILES.map((file) => appCache.add(file))
      );
      const appFailed = appResults.filter((r) => r.status === 'rejected');
      if (appFailed.length > 0) {
        console.warn(`[SW] アプリシェルのキャッシュに${appFailed.length}件失敗しました:`, appFailed);
      } else {
        console.info('[SW] アプリシェルのキャッシュが完了しました');
      }

      // データファイルを個別にキャッシュする（1ファイル失敗しても他は続行する）
      const dataCache = await caches.open(DATA_CACHE_NAME);
      const dataResults = await Promise.allSettled(
        DATA_FILES.map((file) => dataCache.add(file))
      );
      const dataFailed = dataResults.filter((r) => r.status === 'rejected');
      if (dataFailed.length > 0) {
        console.warn(`[SW] データファイルのキャッシュに${dataFailed.length}件失敗しました（後でフェッチします）:`, dataFailed);
      } else {
        console.info('[SW] データファイルのキャッシュが完了しました');
      }

      // インストール直後に有効化する（activate待ちをスキップ）
      await self.skipWaiting();
    })()
  );
});

// ===================================================
// アクティベートイベント：古いキャッシュの削除
// ===================================================
self.addEventListener('activate', (event) => {
  console.info('[SW] アクティブ化中...');

  event.waitUntil(
    (async () => {
      // 現在のバージョン以外のキャッシュをすべて削除する
      const cacheNames = await caches.keys();
      const deletions = cacheNames
        .filter((name) => name !== CACHE_NAME && name !== DATA_CACHE_NAME)
        .map((name) => {
          console.info('[SW] 古いキャッシュを削除します:', name);
          return caches.delete(name);
        });

      await Promise.all(deletions);

      // すぐにページの制御を開始する
      await self.clients.claim();

      console.info('[SW] アクティブ化完了');
    })()
  );
});

// ===================================================
// フェッチイベント：リクエストの横取りとキャッシュ処理
// ===================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // GETリクエスト以外はService Workerが処理しない
  if (request.method !== 'GET') {
    return;
  }

  // 外部ドメインのリクエストはそのまま通す
  if (url.origin !== location.origin) {
    return;
  }

  // JSONデータファイルは「Cache First」戦略
  if (DATA_FILES.some((file) => url.pathname.endsWith(file.slice(1)))) {
    event.respondWith(cacheFirstStrategy(request, DATA_CACHE_NAME));
    return;
  }

  // UIリソースは「Stale-While-Revalidate」戦略
  event.respondWith(staleWhileRevalidateStrategy(request, CACHE_NAME));
});

// ===================================================
// キャッシュ戦略の実装
// ===================================================

/**
 * Cache First 戦略
 * キャッシュがあればキャッシュから返す。なければネットワークから取得してキャッシュする。
 * データファイル向け（JSONは頻繁に変わらないため）
 * @param {Request} request - フェッチリクエスト
 * @param {string} cacheName - 使用するキャッシュ名
 * @returns {Promise<Response>} レスポンス
 */
async function cacheFirstStrategy(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    // ignoreSearch: true でクエリパラメータを無視してキャッシュを検索する
    const cached = await cache.match(request, { ignoreSearch: true });

    if (cached) {
      // キャッシュヒット：キャッシュからレスポンスを返す
      return cached;
    }

    // キャッシュミス：ネットワークから取得してキャッシュに保存
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // レスポンスのクローンを作成してキャッシュに保存（ストリームは一度しか読めないため）
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;

  } catch (error) {
    // ネットワークエラー：オフラインフォールバック
    console.warn('[SW] ネットワークエラー（Cache First）:', request.url);
    return new Response(
      JSON.stringify({ error: 'オフラインのため、データを取得できませんでした' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Stale-While-Revalidate 戦略
 * キャッシュがあればすぐに返しつつ、バックグラウンドでキャッシュを更新する。
 * UIリソース向け（高速表示を優先しつつ最新版を取得）
 * @param {Request} request - フェッチリクエスト
 * @param {string} cacheName - 使用するキャッシュ名
 * @returns {Promise<Response>} レスポンス
 */
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  // ignoreSearch: true でクエリパラメータを無視してキャッシュを検索する
  const cached = await cache.match(request, { ignoreSearch: true });

  // バックグラウンドでキャッシュを更新するPromise（awaitしない）
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {
    // ネットワークエラーはログに残すだけ（バックグラウンドなのでユーザーに影響しない）
    // キャッシュミス時にawaitされる可能性があるためnullを返す（undefinedを防止）
    console.warn('[SW] バックグラウンド更新に失敗しました:', request.url);
    return null;
  });

  if (cached) {
    // キャッシュがあれば即座に返す（バックグラウンドで更新は続行）
    return cached;
  }

  // キャッシュがなければネットワークからの応答を待つ
  try {
    const response = await networkPromise;
    return response || new Response('', { status: 404 });
  } catch (error) {
    // オフラインかつキャッシュなし：エラーページを返す
    return new Response(
      `<!DOCTYPE html>
      <html lang="ja">
      <head><meta charset="UTF-8"><title>オフライン</title></head>
      <body>
        <h1>オフラインです</h1>
        <p>インターネット接続を確認してください。</p>
        <p>一度アプリを読み込んだ後はオフラインでも使用できます。</p>
      </body>
      </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}
