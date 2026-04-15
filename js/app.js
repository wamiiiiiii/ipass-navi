/**
 * app.js
 * アプリの初期化・Service Worker登録・ルーティング制御
 * このファイルがアプリのエントリポイント（最初に実行される）
 */

import { initRouter, registerRoute, navigate, goBack } from './router.js';
import { preloadAllData } from './dataLoader.js';
import { getSettings } from './store.js';
import { applyTheme, applyFontSize } from './screens/settings.js';

// 各画面モジュールを読み込む
import { renderHome }     from './screens/home.js';
import { renderTextbook } from './screens/textbook.js';
import { renderQuiz, cleanupQuiz } from './screens/quiz.js';
import { renderGlossary } from './screens/glossary.js';
import { renderSettings } from './screens/settings.js';

/**
 * アプリの初期化関数
 * DOMが読み込まれた後に実行する
 */
async function initApp() {
  console.info('[App] iPass ナビ を起動しています...');

  // メインコンテンツのコンテナ要素を取得
  const mainContent = document.getElementById('main-content');

  if (!mainContent) {
    console.error('[App] #main-content 要素が見つかりません。index.htmlを確認してください。');
    return;
  }

  // 1. 保存された設定を読み込んで適用する
  const settings = getSettings();
  applyTheme(settings.theme);
  applyFontSize(settings.font_size);

  // 2. ルーターを初期化する（各ルートを登録）
  setupRoutes(mainContent);

  // 3. ルーターを起動する（デフォルトはhome）
  initRouter('home');

  // 4. Service Worker を登録する（バックグラウンドで実行）
  registerServiceWorker();

  // 5. データを事前読み込みする（バックグラウンドでキャッシュを温める）
  // awaitしないことで初期表示をブロックしない
  preloadAllData().then(() => {
    console.info('[App] データの事前読み込みが完了しました');
  });

  // 6. ボトムナビゲーションのイベントを設定する
  setupBottomNavigation();

  // 6b. ヘッダーの戻るボタンにイベントを設定する
  // 教科書内では階層ベースで戻る（節→章一覧→分野一覧→教科書トップ）
  const backBtn = document.getElementById('header-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const hash = window.location.hash.slice(1);
      if (hash.includes('?page=')) {
        // 節コンテンツ → 章一覧に戻る（クエリパラメータを除去）
        const basePath = hash.split('?')[0];
        navigate(basePath);
      } else if (hash.startsWith('textbook/')) {
        // 章一覧 → 分野一覧に戻る
        navigate('textbook');
      } else {
        goBack();
      }
    });
  }

  // 7. システムのカラースキーム変更を監視する
  watchSystemColorScheme(settings.theme);

  console.info('[App] 起動完了');
}

/**
 * ルーターに各画面を登録する
 * @param {HTMLElement} mainContent - コンテンツを描画するコンテナ
 */
function setupRoutes(mainContent) {
  // ホーム画面
  registerRoute('home', (params, query) => {
    cleanupQuiz(); // quiz以外への遷移時にセッション・タイマーをクリアする
    updateHeader('iPass ナビ', false);
    renderHome(mainContent);
  });

  // 教科書モード
  registerRoute('textbook', (params, query) => {
    cleanupQuiz(); // quiz以外への遷移時にセッション・タイマーをクリアする
    const title = params.id ? '教科書' : '教科書モード';
    const showBack = !!(params.id);
    updateHeader(title, showBack);
    renderTextbook(mainContent, params, query);
  });

  // 問題演習モード
  registerRoute('quiz', (params, query) => {
    updateHeader('問題演習', false);
    renderQuiz(mainContent, params, query);
  });

  // 用語辞書
  registerRoute('glossary', (params, query) => {
    cleanupQuiz(); // quiz以外への遷移時にセッション・タイマーをクリアする
    updateHeader('用語辞書', false);
    renderGlossary(mainContent, params, query);
  });

  // 設定画面
  registerRoute('settings', (params, query) => {
    cleanupQuiz(); // quiz以外への遷移時にセッション・タイマーをクリアする
    updateHeader('設定', false);
    renderSettings(mainContent);
  });
}

/**
 * ヘッダーを更新する
 * @param {string} title - ヘッダータイトル
 * @param {boolean} showBack - 戻るボタンを表示するか
 */
function updateHeader(title, showBack) {
  const titleEl = document.getElementById('header-title');
  const backBtn = document.getElementById('header-back-btn');

  if (titleEl) {
    titleEl.textContent = title;
  }

  if (backBtn) {
    backBtn.style.display = showBack ? 'flex' : 'none';
  }
}

/**
 * ボトムナビゲーションのクリックイベントを設定する
 */
function setupBottomNavigation() {
  // 各タブのクリックでルーターを通じて画面を切り替える
  const navMap = {
    'nav-home':      'home',
    'nav-textbook':  'textbook',
    'nav-quiz':      'quiz',
    'nav-glossary':  'glossary',
    'nav-settings':  'settings',
  };

  Object.entries(navMap).forEach(([elementId, route]) => {
    const el = document.getElementById(elementId);
    if (el) {
      el.addEventListener('click', () => navigate(route));
    }
  });
}

/**
 * Service Worker を登録する
 * オフライン対応・キャッシュの管理を担う
 */
async function registerServiceWorker() {
  // Service Worker のサポート確認
  if (!('serviceWorker' in navigator)) {
    console.warn('[App] このブラウザはService Workerをサポートしていません（オフライン機能が無効）');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', {
      scope: './', // このフォルダ配下のリソースをSWが管理する
    });

    console.info('[App] Service Worker を登録しました:', registration.scope);

    // Service Worker の更新を監視
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 新しいService Workerがインストールされた
            console.info('[App] 新しいバージョンが利用可能です');
          }
        });
      }
    });

  } catch (error) {
    console.error('[App] Service Worker の登録に失敗しました:', error.message);
  }
}

/**
 * システムのカラースキーム（ダーク/ライト）変更を監視する
 * テーマ設定が「system」の場合に自動で追従する
 * @param {string} currentTheme - 現在のテーマ設定
 */
function watchSystemColorScheme(currentTheme) {
  if (currentTheme !== 'system') return;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  mediaQuery.addEventListener('change', (e) => {
    // テーマ設定が「system」のままの場合のみ追従
    const latestSettings = getSettings();
    if (latestSettings.theme === 'system') {
      applyTheme('system');
    }
  });
}

// ===================================================
// DOM読み込み完了後にアプリを初期化
// ===================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOMが既に読み込まれている場合は即座に実行
  initApp();
}
