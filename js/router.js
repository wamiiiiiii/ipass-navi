/**
 * router.js
 * ハッシュベースのSPAルーターモジュール
 * URLのハッシュ部分（#以降）を解析して対応する画面を表示する
 *
 * 【ルーティング設計】
 * #home              → ホーム（ダッシュボード）
 * #textbook          → 教科書モード（分野一覧）
 * #textbook/S-01     → S-01の章コンテンツ
 * #quiz              → 問題演習モード選択
 * #quiz/session      → 演習セッション（クエリパラメータでフィルタ）
 * #quiz/result       → 結果サマリー
 * #glossary          → 用語辞書
 * #settings          → 設定画面
 */

/** ルーターの状態（イミュータブルな参照として管理） */
let _currentRoute = null;

/** 登録されたルートとその描画関数のマップ */
const _routes = new Map();

/** ナビゲーション履歴スタック */
const _history = [];

/**
 * ルートを登録する
 * @param {string} pattern - ルートのパターン文字列（例: 'home', 'textbook', 'textbook/:chapterId'）
 * @param {Function} handler - ルートが一致したときに呼ばれる関数（params, query を受け取る）
 */
export function registerRoute(pattern, handler) {
  _routes.set(pattern, handler);
}

/**
 * ルーターを初期化する
 * hashchange イベントを監視して画面を切り替える
 * @param {string} [defaultRoute] - デフォルトのルート（ハッシュがない場合）
 */
export function initRouter(defaultRoute = 'home') {
  // hashchange イベントを監視（ブラウザの戻る・進む・URLの変更を検知）
  window.addEventListener('hashchange', () => {
    handleRoute(parseHash(window.location.hash));
  });

  // 初回ロード時の処理
  const initialHash = window.location.hash;
  if (!initialHash || initialHash === '#') {
    // ハッシュがなければデフォルトルートにリダイレクト
    navigate(defaultRoute, false);
  } else {
    handleRoute(parseHash(initialHash));
  }
}

/**
 * 指定したルートに遷移する
 * @param {string} route - 遷移先のルート文字列（例: 'home', 'textbook/S-01'）
 * @param {boolean} [addToHistory] - 履歴に追加するか（デフォルトtrue）
 * @param {Object} [state] - ルートに渡す追加の状態データ
 */
export function navigate(route, addToHistory = true, state = {}) {
  if (addToHistory) {
    _history.push({ route: _currentRoute, state });
  }

  // URLのハッシュを更新する（これがhashchangeイベントを発火する）
  window.location.hash = route;
}

/**
 * 前の画面に戻る
 * @returns {boolean} 戻れた場合はtrue、履歴がない場合はfalse
 */
export function goBack() {
  if (_history.length === 0) {
    return false;
  }

  const previous = _history.pop();
  if (previous && previous.route) {
    window.location.hash = previous.route;
    return true;
  }

  // 履歴がなければホームへ
  navigate('home', false);
  return true;
}

/**
 * 現在のルート情報を取得する
 * @returns {Object|null} 現在のルート情報
 */
export function getCurrentRoute() {
  return _currentRoute;
}

/**
 * ボトムナビのアクティブタブを更新する
 * @param {string} routeName - 現在のルート名
 */
function updateNavActiveState(routeName) {
  // ルート名からタブIDを判定
  const tabMap = {
    home:      'nav-home',
    textbook:  'nav-textbook',
    quiz:      'nav-quiz',
    glossary:  'nav-glossary',
    settings:  'nav-settings',
  };

  // ルートのプレフィックスでタブを判定（例: 'textbook/S-01' → 'textbook'）
  const rootName = routeName.split('/')[0];
  const activeTabId = tabMap[rootName];

  // すべてのタブからアクティブクラスとaria-selectedを除去
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.remove('is-active');
    tab.setAttribute('aria-selected', 'false');
  });

  // 対応するタブをアクティブにする
  if (activeTabId) {
    const activeTab = document.getElementById(activeTabId);
    if (activeTab) {
      activeTab.classList.add('is-active');
      activeTab.setAttribute('aria-selected', 'true');
    }
  }
}

/**
 * ハッシュ文字列をルート情報にパースする（内部使用）
 * @param {string} hash - URLのハッシュ文字列（例: '#textbook/S-01?mode=study'）
 * @returns {{name: string, params: Object, query: Object}} ルート情報
 */
function parseHash(hash) {
  // '#' を除去してパスとクエリに分割
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart] = raw.split('?');

  // パスを '/' で分割してパラメータを抽出
  const segments = pathPart ? pathPart.split('/') : ['home'];
  const name = segments[0] || 'home';
  const params = {};

  // 第2セグメント以降をパラメータとして扱う
  // 例: 'textbook/S-01' → params.chapterId = 'S-01'
  if (segments[1]) {
    params.id = segments[1];
  }

  if (segments[2]) {
    params.subId = segments[2];
  }

  // クエリパラメータをパース
  const query = {};
  if (queryPart) {
    queryPart.split('&').forEach((pair) => {
      const [key, value] = pair.split('=');
      if (key) {
        query[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    });
  }

  return { name, params, query };
}

/**
 * ルート情報に基づいて画面を切り替える（内部使用）
 * @param {{name: string, params: Object, query: Object}} routeInfo - パース済みのルート情報
 */
function handleRoute(routeInfo) {
  const { name, params, query } = routeInfo;

  // 現在のルートを更新（イミュータブルに新しいオブジェクトを作成）
  _currentRoute = { name, params, query, timestamp: Date.now() };

  // ボトムナビのアクティブ状態を更新
  updateNavActiveState(name);

  // 登録されたルートから一致するものを探す
  let handled = false;

  // 完全一致を先に確認
  if (_routes.has(name)) {
    _routes.get(name)(params, query);
    handled = true;
  }

  // 一致するルートがない場合はホームへ遷移
  if (!handled) {
    console.warn(`[Router] 不明なルート: "${name}" → ホームへリダイレクトします`);
    navigate('home', false);
  }
}
