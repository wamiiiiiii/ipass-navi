/**
 * glossary.js
 * 用語辞書画面の描画ロジック
 * 検索・50音インデックス・分野フィルターの3つの絞り込み手段
 */

import { loadGlossary, searchTerms, filterTermsByKanaRow } from '../dataLoader.js';
import { navigate } from '../router.js';
import {
  createElement,
  renderInto,
  createLoadingSpinner,
  createEmptyState,
  createFrequencyBadge,
  createCategoryBadge,
} from '../utils/render.js';

/** 現在の検索・フィルター状態 */
let _currentFilter = {
  query:    '',
  kanaRow:  'all',
  category: 'all',
};

/** 用語辞書データのキャッシュ（画面内でのみ使用） */
let _glossaryData = null;

/**
 * 用語辞書画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} params - URLパラメータ
 * @param {Object} query - URLクエリパラメータ
 */
export async function renderGlossary(container, params = {}, query = {}) {
  renderInto(container, [createLoadingSpinner()]);

  try {
    // データを読み込む（2回目以降はdataLoaderのキャッシュから返る）
    _glossaryData = await loadGlossary();

    // フィルター状態を初期化（URLパラメータを反映）
    _currentFilter = {
      query:    query.q || '',
      kanaRow:  query.kana || 'all',
      category: query.category || 'all',
    };

    renderGlossaryScreen(container);

  } catch (error) {
    console.error('[Glossary] 描画に失敗しました:', error);
    renderInto(container, [
      createEmptyState('⚠️', 'データの読み込みに失敗しました。ページを更新してください。'),
    ]);
  }
}

/**
 * 用語辞書画面全体を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function renderGlossaryScreen(container) {
  const screen = createElement('div', { classes: ['glossary-screen'] });

  // 検索バー
  screen.appendChild(buildSearchBar(container));

  // フィルタータブバー
  screen.appendChild(buildFilterBar(container));

  // 用語リスト
  screen.appendChild(buildTermList());

  renderInto(container, [screen]);
}

/**
 * 検索バーを構築する
 * @param {HTMLElement} container - 親コンテナ（再描画のため参照）
 * @returns {HTMLElement} 検索バー要素
 */
function buildSearchBar(container) {
  const bar = createElement('div', { classes: ['glossary-search-bar'] });

  const wrapper = createElement('div', { classes: ['glossary-search-input-wrapper'] });

  // 検索アイコン
  wrapper.appendChild(createElement('span', {
    classes: ['glossary-search-icon'],
    text: '🔍',
  }));

  // テキスト入力
  const input = createElement('input', {
    classes: ['glossary-search-input'],
    attrs: {
      type: 'text',
      placeholder: '用語を検索...',
      value: _currentFilter.query,
    },
  });

  // インクリメンタルサーチ（入力のたびにリストを更新）
  let searchTimer = null;
  input.addEventListener('input', (e) => {
    const query = e.target.value;

    // デバウンス処理（200ms以内の連続入力をまとめる）
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _currentFilter = { ..._currentFilter, query };
      updateTermList(container);
      updateClearBtnVisibility(clearBtn, query);
    }, 200);
  });

  wrapper.appendChild(input);

  // クリアボタン
  const clearBtn = createElement('button', {
    classes: ['glossary-search-clear', _currentFilter.query ? 'is-visible' : ''],
    text: '✕',
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    _currentFilter = { ..._currentFilter, query: '' };
    clearBtn.classList.remove('is-visible');
    updateTermList(container);
    input.focus();
  });

  wrapper.appendChild(clearBtn);
  bar.appendChild(wrapper);

  return bar;
}

/**
 * フィルタータブバーを構築する
 * @param {HTMLElement} container - 親コンテナ（再描画のため参照）
 * @returns {HTMLElement} フィルタータブバー要素
 */
function buildFilterBar(container) {
  const filterBar = createElement('div', { classes: ['glossary-filter-bar'] });

  // 50音タブ
  const kanaScroll = createElement('div', { classes: ['kana-tab-scroll'] });

  const kanaRows = [
    { id: 'all', label: 'すべて' },
    { id: 'あ',  label: 'あ行' },
    { id: 'か',  label: 'か行' },
    { id: 'さ',  label: 'さ行' },
    { id: 'た',  label: 'た行' },
    { id: 'な',  label: 'な行' },
    { id: 'は',  label: 'は行' },
    { id: 'ま',  label: 'ま行' },
    { id: 'や',  label: 'や行' },
    { id: 'ら',  label: 'ら行' },
    { id: 'わ',  label: 'わ行' },
  ];

  kanaRows.forEach((row) => {
    const tab = createElement('button', {
      classes: ['kana-tab', _currentFilter.kanaRow === row.id ? 'is-active' : ''],
      text: row.label,
    });

    tab.addEventListener('click', () => {
      kanaScroll.querySelectorAll('.kana-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      _currentFilter = { ..._currentFilter, kanaRow: row.id };
      updateTermList(container);
    });

    kanaScroll.appendChild(tab);
  });

  filterBar.appendChild(kanaScroll);

  // 分野フィルターチップ
  const chips = createElement('div', { classes: ['glossary-category-chips'] });

  const categories = [
    { id: 'all',        label: 'すべての分野' },
    { id: 'strategy',   label: 'ストラテジ' },
    { id: 'management', label: 'マネジメント' },
    { id: 'technology', label: 'テクノロジ' },
  ];

  categories.forEach((cat) => {
    const chip = createElement('button', {
      classes: ['category-chip', _currentFilter.category === cat.id ? 'is-active' : ''],
      text: cat.label,
    });

    chip.addEventListener('click', () => {
      chips.querySelectorAll('.category-chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      _currentFilter = { ..._currentFilter, category: cat.id };
      updateTermList(container);
    });

    chips.appendChild(chip);
  });

  filterBar.appendChild(chips);

  return filterBar;
}

/**
 * 用語リストを構築する
 * @returns {HTMLElement} 用語リスト要素
 */
function buildTermList() {
  const container = createElement('div', {
    classes: ['glossary-list'],
    attrs: { id: 'glossary-term-list' },
  });

  // フィルタリングして表示
  const terms = getFilteredTerms();
  appendTermsToList(container, terms);

  return container;
}

/**
 * 用語リストを更新する（フィルター変更時に呼ばれる）
 * @param {HTMLElement} screenContainer - 画面のコンテナ
 */
function updateTermList(screenContainer) {
  const list = screenContainer.querySelector('#glossary-term-list');
  if (!list) return;

  const terms = getFilteredTerms();
  appendTermsToList(list, terms);
}

/**
 * 現在のフィルター条件に基づいて用語を絞り込む
 * @returns {Object[]} 絞り込んだ用語の配列
 */
function getFilteredTerms() {
  if (!_glossaryData) return [];

  let terms;

  if (_currentFilter.query) {
    // 検索クエリがある場合はフリーワード検索
    terms = searchTerms(_glossaryData, _currentFilter.query);
  } else {
    // 検索クエリがない場合は50音フィルター
    terms = filterTermsByKanaRow(_glossaryData, _currentFilter.kanaRow);
  }

  // 分野フィルター（'all'以外の場合はさらに絞り込む）
  if (_currentFilter.category !== 'all') {
    terms = terms.filter((t) => t.category === _currentFilter.category);
  }

  return terms;
}

/**
 * 用語リストに用語カードを追加する
 * @param {HTMLElement} listEl - リスト要素
 * @param {Object[]} terms - 表示する用語の配列
 */
function appendTermsToList(listEl, terms) {
  // リストをクリアして再描画
  listEl.innerHTML = '';

  if (terms.length === 0) {
    listEl.appendChild(
      createEmptyState('🔍', '該当する用語が見つかりませんでした')
    );
    return;
  }

  // 50音順でグループ化（検索中はグループなし）
  if (_currentFilter.query) {
    // 検索中はグループなしでフラットに表示
    terms.forEach((term) => {
      listEl.appendChild(buildTermCard(term));
    });
    return;
  }

  // 読み仮名の最初の文字でグループ化
  const groups = groupTermsByKana(terms);

  groups.forEach(({ header, terms: groupTerms }) => {
    if (header) {
      listEl.appendChild(createElement('div', {
        classes: ['kana-group-header'],
        text: header,
      }));
    }

    groupTerms.forEach((term) => {
      listEl.appendChild(buildTermCard(term));
    });
  });
}

/**
 * 用語カードを構築する
 * @param {Object} term - 用語オブジェクト
 * @returns {HTMLElement} 用語カード要素
 */
function buildTermCard(term) {
  const card = createElement('div', { classes: ['glossary-term-card'] });

  // 用語名エリア
  const nameArea = createElement('div', { classes: ['term-name-area'] });
  nameArea.appendChild(createElement('div', { classes: ['term-name'], text: term.term }));
  nameArea.appendChild(createElement('div', { classes: ['term-reading'], text: term.reading }));

  // 定義文プレビュー（2行で切り捨て）
  const defPreview = createElement('div', {
    classes: ['term-def-preview'],
    text: term.definition,
  });
  nameArea.appendChild(defPreview);

  card.appendChild(nameArea);

  // 右側バッジ
  const badges = createElement('div', { classes: ['term-badges'] });
  badges.appendChild(createFrequencyBadge(term.exam_frequency));
  badges.appendChild(createCategoryBadge(term.category));
  card.appendChild(badges);

  // クリックで詳細を表示
  card.addEventListener('click', () => {
    showTermDetail(term);
  });

  return card;
}

/**
 * 用語詳細パネルを表示する
 * @param {Object} term - 表示する用語オブジェクト
 */
function showTermDetail(term) {
  // 既存のパネルを削除
  const existing = document.getElementById('glossary-detail-panel');
  if (existing) {
    existing.classList.remove('is-open');
    setTimeout(() => {
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }, 250);
    return;
  }

  const panel = createElement('div', {
    classes: ['glossary-detail-panel'],
    attrs: { id: 'glossary-detail-panel' },
  });

  // ドロワーハンドル
  panel.appendChild(createElement('div', { classes: ['detail-panel-handle'] }));

  const content = createElement('div', { classes: ['detail-panel-content'] });

  // 用語タイトル
  content.appendChild(createElement('h2', { classes: ['detail-term-name'], text: term.term }));
  content.appendChild(createElement('p', { classes: ['detail-term-reading'], text: term.reading }));

  // バッジ行
  const badges = createElement('div', { attrs: { style: 'display:flex;gap:8px;margin-bottom:16px;' } });
  badges.appendChild(createFrequencyBadge(term.exam_frequency));
  badges.appendChild(createCategoryBadge(term.category));
  content.appendChild(badges);

  // 定義文
  content.appendChild(createElement('p', { classes: ['detail-definition'], text: term.definition }));

  // 関連用語
  if (term.related_terms && term.related_terms.length > 0) {
    const relatedSection = createElement('div', { classes: ['detail-related-terms'] });
    relatedSection.appendChild(createElement('div', {
      classes: ['detail-section-title'],
      text: '関連用語',
    }));

    const chips = createElement('div', { classes: ['related-term-chips'] });
    term.related_terms.forEach((relTerm) => {
      const chip = createElement('span', { classes: ['related-term-chip'], text: relTerm });
      chip.addEventListener('click', () => {
        // 関連用語を検索
        _currentFilter = { ..._currentFilter, query: relTerm };
        panel.classList.remove('is-open');
        setTimeout(() => {
          if (panel.parentNode) panel.parentNode.removeChild(panel);
        }, 250);

        // 検索入力を更新
        const searchInput = document.querySelector('.glossary-search-input');
        if (searchInput) {
          searchInput.value = relTerm;
        }

        const listContainer = document.getElementById('glossary-term-list');
        if (listContainer) {
          appendTermsToList(listContainer, getFilteredTerms());
        }
      });
      chips.appendChild(chip);
    });
    relatedSection.appendChild(chips);
    content.appendChild(relatedSection);
  }

  // 関連問題リンク
  if (term.related_question_ids && term.related_question_ids.length > 0) {
    const questionsSection = createElement('div', { classes: ['detail-related-questions'] });
    questionsSection.appendChild(createElement('div', {
      classes: ['detail-section-title'],
      text: '関連する問題',
    }));

    term.related_question_ids.forEach((qId) => {
      const item = createElement('div', { classes: ['related-question-item'] });
      item.appendChild(createElement('span', { classes: ['related-question-icon'], text: '✏️' }));
      item.appendChild(createElement('span', { classes: ['related-question-id'], text: qId }));

      item.addEventListener('click', () => {
        panel.classList.remove('is-open');
        setTimeout(() => {
          if (panel.parentNode) panel.parentNode.removeChild(panel);
        }, 250);
        navigate('quiz');
      });

      questionsSection.appendChild(item);
    });

    content.appendChild(questionsSection);
  }

  panel.appendChild(content);
  document.body.appendChild(panel);

  // アニメーションのためにrequestAnimationFrame後に開く
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
    });
  });

  // パネル外クリックで閉じる
  const handleOutsideClick = (e) => {
    if (!panel.contains(e.target)) {
      panel.classList.remove('is-open');
      setTimeout(() => {
        if (panel.parentNode) panel.parentNode.removeChild(panel);
      }, 250);
      document.removeEventListener('click', handleOutsideClick);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 100);
}

/**
 * 用語を読み仮名の最初の文字でグループ化する
 * @param {Object[]} terms - 用語の配列
 * @returns {Array<{header: string, terms: Object[]}>} グループの配列
 */
function groupTermsByKana(terms) {
  const kanaRowMap = {
    'あいうえお':               'あ行',
    'かきくけこがぎぐげご':      'か行',
    'さしすせそざじずぜぞ':      'さ行',
    'たちつてとだぢづでど':      'た行',
    'なにぬねの':               'な行',
    'はひふへほばびぶべぼぱぴぷぺぽ': 'は行',
    'まみむめも':               'ま行',
    'やゆよ':                   'や行',
    'らりるれろ':               'ら行',
    'わをん':                   'わ行',
  };

  /** 文字が属する行ラベルを返す */
  const getKanaRow = (char) => {
    for (const [chars, label] of Object.entries(kanaRowMap)) {
      if (chars.includes(char)) return label;
    }
    return 'その他';
  };

  const groupMap = new Map();

  terms.forEach((term) => {
    const firstChar = term.reading.charAt(0);
    const rowLabel = getKanaRow(firstChar);

    if (!groupMap.has(rowLabel)) {
      groupMap.set(rowLabel, []);
    }

    groupMap.get(rowLabel).push(term);
  });

  return Array.from(groupMap.entries()).map(([header, terms]) => ({ header, terms }));
}

/**
 * 検索クリアボタンの表示・非表示を切り替える（内部使用）
 * @param {HTMLElement} clearBtn - クリアボタン要素
 * @param {string} query - 現在の検索クエリ
 */
function updateClearBtnVisibility(clearBtn, query) {
  if (query) {
    clearBtn.classList.add('is-visible');
  } else {
    clearBtn.classList.remove('is-visible');
  }
}
