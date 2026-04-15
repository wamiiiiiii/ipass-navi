/**
 * render.js
 * DOM生成ヘルパー関数を提供するユーティリティモジュール
 * HTMLにコンテンツを直書きせず、JavaScriptでDOMを動的に構築するための道具箱
 *
 * 【イミュータブル原則】
 * このモジュールは常に新しいDOM要素を返す。
 * 既存の要素を直接変更する関数は提供しない。
 */

/**
 * HTML要素を生成する汎用関数
 * @param {string} tag - 生成するHTML要素のタグ名（例: 'div', 'button', 'span'）
 * @param {Object} options - 要素のオプション
 * @param {string[]} [options.classes] - 追加するCSSクラスの配列
 * @param {Object} [options.attrs] - 設定する属性のオブジェクト（例: { id: 'foo', type: 'button' }）
 * @param {string} [options.text] - テキストコンテンツ
 * @param {string} [options.html] - HTMLコンテンツ（XSSに注意して使うこと）
 * @param {Node[]} [options.children] - 子ノードの配列
 * @returns {HTMLElement} 生成されたHTML要素
 */
export function createElement(tag, options = {}) {
  const { classes = [], attrs = {}, text, html, children = [] } = options;

  // 要素を新規生成
  const el = document.createElement(tag);

  // CSSクラスを追加（空文字列をフィルタしてDOMExceptionを防ぐ）
  const validClasses = classes.filter((c) => c && c.trim() !== '');
  if (validClasses.length > 0) {
    el.classList.add(...validClasses);
  }

  // 属性を設定
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      el.setAttribute(key, value);
    }
  });

  // HTMLコンテンツが指定された場合はtextを無視してHTMLを優先する
  // （両方指定された場合、textContentの後にinnerHTMLで上書きされる不整合を防ぐ）
  if (html !== undefined) {
    el.innerHTML = html;
  } else if (text !== undefined) {
    // テキストコンテンツを設定（XSSを防ぐためtextContentを使用）
    el.textContent = text;
  }

  // 子要素を追加
  children.forEach((child) => {
    if (child) {
      el.appendChild(child);
    }
  });

  return el;
}

/**
 * コンテナ要素をクリアしてから新しい子要素を追加する
 * 既存のDOMを丸ごと差し替えるときに使う
 * @param {HTMLElement} container - クリアする対象のコンテナ
 * @param {Node[]} children - 新たに追加する子ノードの配列
 */
export function renderInto(container, children) {
  // コンテナの中身をすべて削除
  container.innerHTML = '';

  // DocumentFragmentを使ってまとめて追加（レンダリング回数を最小化）
  const fragment = document.createDocumentFragment();
  children.forEach((child) => {
    if (child) {
      fragment.appendChild(child);
    }
  });

  container.appendChild(fragment);
}

/**
 * カードコンポーネントを生成する
 * @param {Node[]} children - カード内に配置する要素の配列
 * @param {string[]} [extraClasses] - 追加のCSSクラス
 * @returns {HTMLElement} カード要素
 */
export function createCard(children, extraClasses = []) {
  return createElement('div', {
    classes: ['card', ...extraClasses],
    children,
  });
}

/**
 * プログレスバーを生成する
 * @param {number} pct - 進捗率（0〜100の数値）
 * @param {string[]} [extraClasses] - バーのfillに追加するクラス
 * @returns {HTMLElement} プログレスバー要素
 */
export function createProgressBar(pct, extraClasses = []) {
  // 0〜100の範囲に収める（イミュータブルな計算）
  const clampedPct = Math.min(100, Math.max(0, pct));

  const fill = createElement('div', {
    classes: ['progress-bar-fill', ...extraClasses],
    attrs: { style: `width: ${clampedPct}%` },
  });

  return createElement('div', {
    classes: ['progress-bar'],
    children: [fill],
  });
}

/**
 * 出題頻度バッジを生成する
 * @param {string} frequency - 頻度（'high' | 'medium' | 'low'）
 * @returns {HTMLElement} バッジ要素
 */
export function createFrequencyBadge(frequency) {
  // 頻度ごとの表示テキストとCSSクラスを定義（新しいオブジェクトとして定義）
  const frequencyMap = {
    high:   { label: '頻出', cssClass: 'badge-freq-high' },
    medium: { label: '標準', cssClass: 'badge-freq-medium' },
    low:    { label: '低頻度', cssClass: 'badge-freq-low' },
  };

  const config = frequencyMap[frequency] || frequencyMap['low'];

  return createElement('span', {
    classes: ['badge', config.cssClass],
    text: config.label,
  });
}

/**
 * 分野バッジを生成する
 * @param {string} category - 分野（'strategy' | 'management' | 'technology'）
 * @returns {HTMLElement} 分野バッジ要素
 */
export function createCategoryBadge(category) {
  const categoryMap = {
    strategy:   { label: 'ストラテジ', cssClass: 'badge-strategy' },
    management: { label: 'マネジメント', cssClass: 'badge-management' },
    technology: { label: 'テクノロジ', cssClass: 'badge-technology' },
  };

  const config = categoryMap[category] || { label: category, cssClass: '' };

  return createElement('span', {
    classes: ['badge', config.cssClass],
    text: config.label,
  });
}

/**
 * 難易度を星アイコンで表示する
 * @param {number} difficulty - 難易度（1〜3）
 * @returns {HTMLElement} 星表示要素
 */
export function createDifficultyStars(difficulty) {
  const maxStars = 3;
  const stars = [];

  for (let i = 1; i <= maxStars; i++) {
    stars.push(
      createElement('span', {
        classes: ['difficulty-star', i <= difficulty ? '' : 'is-empty'],
        text: '★',
      })
    );
  }

  return createElement('div', {
    classes: ['difficulty-stars'],
    children: stars,
  });
}

/**
 * パンくずリストを生成する
 * @param {Array<{label: string, onClick?: Function}>} items - パンくずのアイテム配列
 * @returns {HTMLElement} パンくずリスト要素
 */
export function createBreadcrumb(items) {
  const children = [];

  items.forEach((item, index) => {
    // パンくずのアイテム要素を生成
    const isLast = index === items.length - 1;
    const el = createElement('span', {
      classes: ['breadcrumb-item'],
      text: item.label,
    });

    // 最後のアイテム以外はクリック可能にする
    if (!isLast && item.onClick) {
      el.addEventListener('click', item.onClick);
    }

    children.push(el);

    // 最後のアイテム以外はセパレーターを追加
    if (!isLast) {
      children.push(
        createElement('span', {
          classes: ['breadcrumb-separator'],
          text: '›',
        })
      );
    }
  });

  return createElement('nav', {
    classes: ['breadcrumb'],
    children,
  });
}

/**
 * ローディングスピナーを生成する
 * @returns {HTMLElement} ローディング要素
 */
export function createLoadingSpinner() {
  return createElement('div', {
    classes: ['loading-spinner'],
    children: [
      createElement('div', { classes: ['spinner'] }),
    ],
  });
}

/**
 * 空状態プレースホルダーを生成する
 * @param {string} icon - 表示するアイコン（絵文字）
 * @param {string} text - 表示するメッセージ
 * @returns {HTMLElement} 空状態要素
 */
export function createEmptyState(icon, text) {
  return createElement('div', {
    classes: ['empty-state'],
    children: [
      createElement('div', { classes: ['empty-state-icon'], text: icon }),
      createElement('p', { classes: ['empty-state-text'], text }),
    ],
  });
}

/**
 * キーワードをハイライト表示したテキストノードを生成する
 * 用語辞書に登録されたキーワードを自動的に青字太字にする
 * @param {string} text - ハイライト対象のテキスト
 * @param {string[]} keywords - ハイライトするキーワードの配列
 * @param {Function} onKeywordClick - キーワードクリック時のコールバック（keyword: string）
 * @returns {DocumentFragment} ハイライト済みのDOMフラグメント
 */
export function createHighlightedText(text, keywords, onKeywordClick) {
  const fragment = document.createDocumentFragment();

  if (!keywords || keywords.length === 0) {
    // キーワードなしの場合はそのままテキストノードとして返す
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  // キーワードを長い順にソート（部分一致の誤検知を防ぐ）
  const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);

  // キーワードにマッチする正規表現を生成（特殊文字をエスケープ）
  const escapedKeywords = sortedKeywords.map((kw) =>
    kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const pattern = new RegExp(`(${escapedKeywords.join('|')})`, 'g');

  // テキストをキーワードで分割してDOMノードを生成
  const parts = text.split(pattern);

  parts.forEach((part) => {
    if (sortedKeywords.includes(part)) {
      // キーワード部分：ハイライトスパンを生成
      const span = createElement('span', {
        classes: ['keyword-highlight'],
        text: part,
      });
      span.addEventListener('click', () => {
        if (onKeywordClick) {
          onKeywordClick(part);
        }
      });
      fragment.appendChild(span);
    } else {
      // 通常テキスト：テキストノードとして追加
      fragment.appendChild(document.createTextNode(part));
    }
  });

  return fragment;
}

/**
 * フォーカストラップを設定する
 * モーダル・ポップアップ表示中に、Tab/Shift+Tab キーの移動を
 * モーダル内の要素だけに閉じ込めるアクセシビリティ対応。
 * Esc キーでモーダルを閉じる機能も追加する。
 *
 * @param {HTMLElement} modalEl - フォーカスを閉じ込めるモーダル要素
 * @param {Function} onClose - モーダルを閉じるコールバック関数（Escキー押下時に呼ばれる）
 * @returns {Function} トラップを解除するクリーンアップ関数（モーダル閉鎖時に必ず呼ぶこと）
 *
 * 使用例:
 *   const cleanup = createFocusTrap(dialogEl, () => dialogEl.remove());
 *   // モーダルを閉じるときに cleanup() を呼ぶ
 */
export function createFocusTrap(modalEl, onClose) {
  // フォーカス可能な要素を示するCSSセレクター
  const FOCUSABLE_SELECTORS = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  /**
   * モーダル内のフォーカス可能な要素一覧を毎回取得する
   * （DOM変化に対応するため都度取得する）
   * @returns {HTMLElement[]} フォーカス可能な要素の配列
   */
  const getFocusableElements = () =>
    Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
      (el) => !el.closest('[hidden]') && el.offsetParent !== null
    );

  /**
   * Tab/Shift+Tab のキー操作をインターセプトしてフォーカスをループさせる
   * @param {KeyboardEvent} e - キーボードイベント
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      // Esc キーでモーダルを閉じる
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) {
      // フォーカス可能な要素がない場合はタブ移動をブロックする
      e.preventDefault();
      return;
    }

    const firstEl = focusable[0];
    const lastEl  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: 先頭要素にいたら末尾にループする
      if (document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      }
    } else {
      // Tab: 末尾要素にいたら先頭にループする
      if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  };

  // イベントリスナーを登録する
  document.addEventListener('keydown', handleKeyDown);

  // モーダルを開いた直後、先頭のフォーカス可能要素にフォーカスを移動する
  const focusable = getFocusableElements();
  if (focusable.length > 0) {
    // 非同期で移動することで描画完了後にフォーカスが当たるようにする
    requestAnimationFrame(() => focusable[0].focus());
  }

  // クリーンアップ関数を返す（モーダルを閉じる際に必ず呼び出すこと）
  return function cleanup() {
    document.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * トースト通知を表示する
 * @param {string} message - 表示するメッセージ
 * @param {'info'|'success'|'error'} [type] - 通知の種類
 * @param {number} [duration] - 表示時間（ミリ秒）デフォルト2500ms
 */
export function showToast(message, type = 'info', duration = 2500) {
  // トーストコンテナを取得または生成
  let container = document.getElementById('toast-container');
  if (!container) {
    container = createElement('div', { attrs: { id: 'toast-container' } });
    document.body.appendChild(container);
  }

  // トースト要素を生成
  const toast = createElement('div', {
    classes: ['toast', type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''],
    text: message,
  });

  container.appendChild(toast);

  // 指定時間後に自動削除
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}
