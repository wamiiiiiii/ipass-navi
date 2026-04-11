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
// v5: 図解レンダリングシステム追加（diagram.js / diagram.css / diagrams.json）
const CACHE_NAME = 'ipass-navi-v5';
const DATA_CACHE_NAME = 'ipass-navi-data-v5';

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
  './css/diagram.css',
];

// JSONデータファイル：Cache First で管理するファイル
const DATA_FILES = [
  './data/chapters.json',
  './data/questions.json',
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
      // アプリシェルをキャッシュする
      const appCache = await caches.open(CACHE_NAME);
      try {
        await appCache.addAll(APP_SHELL_FILES);
        console.info('[SW] アプリシェルのキャッシュが完了しました');
      } catch (error) {
        console.error('[SW] アプリシェルのキャッシュに失敗しました:', error);
      }

      // データファイルをキャッシュする
      const dataCache = await caches.open(DATA_CACHE_NAME);
      try {
        await dataCache.addAll(DATA_FILES);
        console.info('[SW] データファイルのキャッシュが完了しました');
      } catch (error) {
        console.warn('[SW] データファイルの一部キャッシュに失敗しました（後でフェッチします）:', error);
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
    console.warn('[SW] バックグラウンド更新に失敗しました:', request.url);
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
