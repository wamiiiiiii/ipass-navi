/**
 * textbook.js
 * 教科書モードの描画ロジック
 * 分野一覧 → 章一覧 → 節コンテンツの3階層ナビゲーション
 */

import { getProgress, markPageAsRead, markChapterCompleted, recordReadingTime } from '../store.js';
import { loadChapters, loadGlossary, loadDiagrams, findTermByName } from '../dataLoader.js';
import { navigate, goBack } from '../router.js';
import { renderDiagram } from '../utils/diagram.js';
import {
  createElement,
  renderInto,
  createBreadcrumb,
  createLoadingSpinner,
  createEmptyState,
  createHighlightedText,
  createProgressBar,
  showToast,
  createFocusTrap,
} from '../utils/render.js';
import { calcChapterProgress } from '../utils/progress.js';

/** 現在表示中の節の開始時刻（閲覧時間計測用） */
let _pageStartTime = null;

/** 現在表示している節ID */
let _currentPageId = null;

/**
 * 教科書モードを描画する
 * @param {HTMLElement} container - 描画先のコンテナ要素
 * @param {Object} params - URLパラメータ（id: sectionId, subId: chapterId）
 * @param {Object} query - URLクエリパラメータ（page: pageId）
 */
export async function renderTextbook(container, params = {}, query = {}) {
  // 前の節の閲覧時間を記録する（画面遷移時に実行）
  saveCurrentPageReadingTime();

  // ページ遷移時にスクロール位置をトップに戻す
  window.scrollTo(0, 0);

  renderInto(container, [createLoadingSpinner()]);

  try {
    const chaptersData = await loadChapters();
    const progress = getProgress();

    if (!params.id) {
      // 分野一覧画面を表示
      renderSectionList(container, chaptersData, progress);
    } else if (!params.subId && !query.page) {
      // 章一覧画面を表示
      const section = chaptersData.sections.find((s) => s.section_id === params.id);
      if (!section) {
        renderInto(container, [createEmptyState('📖', '分野が見つかりません')]);
        return;
      }
      renderChapterList(container, section, progress);
    } else if (query.page) {
      // 節コンテンツ画面を表示
      // 用語辞書と図解データを並行読み込みして効率化する
      const [glossaryData, diagramsData] = await Promise.all([
        loadGlossary(),
        loadDiagrams(),
      ]);
      renderPageContent(container, chaptersData, progress, query.page, glossaryData, diagramsData);
    } else {
      // chapterIdのみ指定 → 章の最初の節を表示
      navigate(`textbook/${params.id}?page=${params.id}-01`, false);
    }

  } catch (error) {
    console.error('[Textbook] 描画に失敗しました:', error);
    renderInto(container, [
      createEmptyState('⚠️', 'データの読み込みに失敗しました。ページを更新してください。'),
    ]);
  }
}

/**
 * 分野一覧画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} chaptersData - chapters.jsonのデータ
 * @param {Object} progress - 進捗データ
 */
function renderSectionList(container, chaptersData, progress) {
  const screen = createElement('div', { classes: ['textbook-screen'] });

  screen.appendChild(createElement('p', {
    classes: ['textbook-intro'],
    text: '学習したい分野を選んでください',
  }));

  // 分野アイコンの定義
  const sectionIcons = {
    strategy:   '💼',
    management: '📋',
    technology: '💻',
  };

  chaptersData.sections.forEach((section) => {
    // この分野の全節に対する既読率を計算
    const progressPct = calcSectionProgress(section, progress.pages_read);

    const card = createElement('div', {
      classes: ['section-card', section.section_id],
    });

    // カードヘッダー（グラデーション背景）
    const header = createElement('div', { classes: ['section-card-header'] });

    header.appendChild(createElement('span', {
      classes: ['section-card-icon'],
      text: sectionIcons[section.section_id] || '📚',
    }));

    const info = createElement('div', { classes: ['section-card-info'] });
    info.appendChild(createElement('div', {
      classes: ['section-card-name'],
      text: section.section_name,
    }));
    info.appendChild(createElement('div', {
      classes: ['section-card-ratio'],
      text: `出題比率：約${section.exam_ratio}%`,
    }));

    header.appendChild(info);
    card.appendChild(header);

    // 進捗フッター
    const footer = createElement('div', { classes: ['section-card-footer'] });
    footer.appendChild(createElement('span', {
      classes: ['section-card-progress-text'],
      text: `${progressPct}%`,
    }));

    const barWrapper = createElement('div', { classes: ['section-card-progress-bar'] });
    const fill = createElement('div', {
      classes: ['section-card-progress-fill'],
      attrs: { style: `width: ${progressPct}%` },
    });
    barWrapper.appendChild(fill);
    footer.appendChild(barWrapper);
    card.appendChild(footer);

    // クリックで章一覧へ
    card.addEventListener('click', () => navigate(`textbook/${section.section_id}`));

    screen.appendChild(card);
  });

  renderInto(container, [screen]);
}

/**
 * 分野の進捗率を計算する（ローカルヘルパー）
 * @param {Object} section - 分野オブジェクト
 * @param {string[]} pagesRead - 既読済みの節IDの配列
 * @returns {number} 進捗率（0〜100）
 */
function calcSectionProgress(section, pagesRead) {
  const allIds = [];
  (section.categories || []).forEach((cat) => {
    (cat.chapters || []).forEach((ch) => {
      (ch.pages || []).forEach((p) => allIds.push(p.page_id));
    });
  });

  if (allIds.length === 0) return 0;
  const readCount = pagesRead.filter((id) => allIds.includes(id)).length;
  return Math.round((readCount / allIds.length) * 100);
}

/**
 * 章一覧画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} section - 選択した分野オブジェクト
 * @param {Object} progress - 進捗データ
 */
function renderChapterList(container, section, progress) {
  const screen = createElement('div', { classes: ['textbook-screen'] });

  // パンくずリスト
  screen.appendChild(createBreadcrumb([
    { label: '教科書', onClick: () => navigate('textbook') },
    { label: section.section_name },
  ]));

  // カテゴリーごとに章を表示
  (section.categories || []).forEach((category) => {
    screen.appendChild(createElement('p', {
      classes: ['textbook-intro'],
      text: category.category_name,
    }));

    const list = createElement('div', { classes: ['chapter-list'] });

    (category.chapters || []).forEach((chapter) => {
      const pct = calcChapterProgress(chapter.chapter_id, progress.pages_read, { sections: [section] });
      const isCompleted = progress.chapters_completed.includes(chapter.chapter_id);
      const firstPageId = chapter.pages?.[0]?.page_id;

      if (!firstPageId) return;

      const item = createElement('div', { classes: ['chapter-item'] });

      // 章IDバッジ
      item.appendChild(createElement('div', {
        classes: ['chapter-id-badge'],
        text: chapter.chapter_id,
      }));

      // 章タイトルと説明
      const info = createElement('div', { classes: ['chapter-info'] });
      info.appendChild(createElement('div', { classes: ['chapter-title'], text: chapter.chapter_title }));
      info.appendChild(createElement('div', { classes: ['chapter-desc'], text: chapter.description }));
      item.appendChild(info);

      // 進捗表示
      const progressEl = createElement('div', { classes: ['chapter-progress'] });
      if (isCompleted) {
        progressEl.appendChild(createElement('span', { classes: ['chapter-completed-icon'], text: '✓' }));
      } else {
        progressEl.appendChild(createElement('span', { classes: ['chapter-progress-pct'], text: `${pct}%` }));
      }
      item.appendChild(progressEl);

      // クリックで最初の節へ遷移
      item.addEventListener('click', () => {
        navigate(`textbook/${section.section_id}?page=${firstPageId}`);
      });

      list.appendChild(item);
    });

    screen.appendChild(list);
  });

  renderInto(container, [screen]);
}

/**
 * 節コンテンツ画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} chaptersData - 全コンテンツデータ
 * @param {Object} progress - 進捗データ
 * @param {string} pageId - 表示する節のID（例: 'S-01-01'）
 * @param {Object} glossaryData - 用語辞書データ
 * @param {Object} [diagramsData] - 図解データ（diagrams.json の内容。省略可）
 */
function renderPageContent(container, chaptersData, progress, pageId, glossaryData, diagramsData) {
  // 節データを検索
  const { page, chapter, section } = findPageData(pageId, chaptersData);

  if (!page) {
    renderInto(container, [createEmptyState('📖', '節が見つかりません')]);
    return;
  }

  // 閲覧時間の計測を開始
  startPageTimer(pageId);

  // 既読マークを付ける
  markPageAsRead(pageId);

  // 章内の節リストを取得（ナビゲーション用）
  const pages = chapter.pages || [];
  const currentIndex = pages.findIndex((p) => p.page_id === pageId);

  const screen = createElement('div', { classes: ['page-content-screen'] });

  // パンくずリスト
  screen.appendChild(createBreadcrumb([
    { label: '教科書', onClick: () => navigate('textbook') },
    { label: section.section_name, onClick: () => navigate(`textbook/${section.section_id}`) },
    { label: chapter.chapter_title },
  ]));

  // 節の進捗ドット
  screen.appendChild(buildPageProgressDots(pages, pageId, progress.pages_read, chapter.chapter_id, section.section_id));

  // 節タイトル
  screen.appendChild(createElement('h1', { classes: ['page-title'], text: page.title }));

  // コンテンツカード
  const contentCard = createElement('div', { classes: ['content-card'] });
  const bodyEl = createElement('div', { classes: ['content-body'] });

  // キーワードをハイライト表示
  const highlighted = createHighlightedText(
    page.body,
    page.keywords || [],
    (keyword) => showGlossaryPopup(keyword, glossaryData, container)
  );
  bodyEl.appendChild(highlighted);
  contentCard.appendChild(bodyEl);
  screen.appendChild(contentCard);

  // 図解レンダリング：この節に対応する図解データがあれば本文の下に表示する
  // diagramsData.diagrams は { [page_id]: diagramData } の形式で格納されている
  if (diagramsData && diagramsData.diagrams) {
    const diagramData = diagramsData.diagrams[pageId];
    if (diagramData) {
      // 対応する図解が定義されている場合のみDOMを生成して挿入する
      const diagramEl = renderDiagram(diagramData);
      if (diagramEl) {
        screen.appendChild(diagramEl);
      }
    }
  }

  // 節のポイントまとめ（summary_pointsがある場合）
  if (page.summary_points && page.summary_points.length > 0) {
    screen.appendChild(buildSummaryCard('このページのポイント', page.summary_points));
  }

  // 最後の節なら章全体のまとめと問題へのボタンを表示
  const isLastPage = currentIndex === pages.length - 1;
  if (isLastPage) {
    if (chapter.chapter_summary && chapter.chapter_summary.length > 0) {
      screen.appendChild(buildSummaryCard(`${chapter.chapter_title} のまとめ`, chapter.chapter_summary));
    }

    // 章を完了済みとしてマーク
    markChapterCompleted(chapter.chapter_id);

    // この章の問題を解くボタン
    const quizBtn = createElement('button', {
      classes: ['chapter-quiz-btn'],
      text: `✏️ この章の問題を解く`,
    });
    quizBtn.addEventListener('click', () => {
      navigate(`quiz?chapter=${chapter.chapter_id}`);
    });
    screen.appendChild(quizBtn);
  }

  // 前後のナビゲーションボタン
  screen.appendChild(buildPageNavigation(pages, currentIndex, section.section_id));

  renderInto(container, [screen]);
}

/**
 * 節の進捗ドットを構築する
 * @param {Object[]} pages - 章内の全節の配列
 * @param {string} currentPageId - 現在表示している節ID
 * @param {string[]} pagesRead - 既読済みの節IDの配列
 * @param {string} chapterId - 章ID
 * @param {string} sectionId - 分野ID
 * @returns {HTMLElement} 進捗ドット要素
 */
function buildPageProgressDots(pages, currentPageId, pagesRead, chapterId, sectionId) {
  const bar = createElement('div', { classes: ['page-progress-bar'] });

  const dotsContainer = createElement('div', { classes: ['page-progress-dots'] });

  pages.forEach((p) => {
    const dot = createElement('div', { classes: ['page-progress-dot'] });

    if (p.page_id === currentPageId) {
      dot.classList.add('is-current');
    } else if (pagesRead.includes(p.page_id)) {
      dot.classList.add('is-read');
    }

    // ドットをクリックで節移動
    dot.addEventListener('click', () => {
      navigate(`textbook/${sectionId}?page=${p.page_id}`);
    });

    dotsContainer.appendChild(dot);
  });

  const countText = createElement('span', {
    classes: ['page-progress-text'],
    text: `${pages.findIndex((p) => p.page_id === currentPageId) + 1}/${pages.length}`,
  });

  bar.appendChild(dotsContainer);
  bar.appendChild(countText);

  return bar;
}

/**
 * ポイントまとめカードを構築する
 * @param {string} title - カードタイトル
 * @param {string[]} points - ポイントのテキスト配列
 * @returns {HTMLElement} まとめカード要素
 */
function buildSummaryCard(title, points) {
  const card = createElement('div', { classes: ['summary-card'] });

  card.appendChild(createElement('div', {
    classes: ['summary-card-title'],
    text: `📌 ${title}`,
  }));

  const list = createElement('div', { classes: ['summary-list'] });

  points.forEach((point) => {
    list.appendChild(createElement('div', {
      classes: ['summary-list-item'],
      text: point,
    }));
  });

  card.appendChild(list);
  return card;
}

/**
 * 節ナビゲーションボタンを構築する
 * @param {Object[]} pages - 章内の全節
 * @param {number} currentIndex - 現在の節インデックス
 * @param {string} sectionId - 分野ID
 * @returns {HTMLElement} ナビゲーションボタン要素
 */
function buildPageNavigation(pages, currentIndex, sectionId) {
  const nav = createElement('div', { classes: ['page-navigation'] });

  // 前のページボタン
  const prevBtn = createElement('button', {
    classes: ['page-nav-btn', 'page-nav-btn-prev'],
    text: '← 前のページ',
    attrs: { disabled: currentIndex === 0 ? 'true' : null },
  });

  if (currentIndex > 0) {
    prevBtn.addEventListener('click', () => {
      navigate(`textbook/${sectionId}?page=${pages[currentIndex - 1].page_id}`);
    });
  }

  nav.appendChild(prevBtn);

  // 次のページボタン
  const nextBtn = createElement('button', {
    classes: ['page-nav-btn', 'page-nav-btn-next'],
    text: currentIndex < pages.length - 1 ? '次のページ →' : '章の一覧へ',
    attrs: { disabled: null },
  });

  nextBtn.addEventListener('click', () => {
    if (currentIndex < pages.length - 1) {
      navigate(`textbook/${sectionId}?page=${pages[currentIndex + 1].page_id}`);
    } else {
      navigate(`textbook/${sectionId}`);
    }
  });

  nav.appendChild(nextBtn);

  return nav;
}

/**
 * 用語辞書ポップアップを表示する
 * フォーカストラップ・Escキー閉じ・aria属性を追加してアクセシビリティを向上させる
 * @param {string} keyword - 表示する用語名
 * @param {Object} glossaryData - 用語辞書データ
 * @param {HTMLElement} container - 表示先コンテナ
 */
function showGlossaryPopup(keyword, glossaryData, container) {
  const term = findTermByName(glossaryData, keyword);

  if (!term) {
    showToast(`「${keyword}」の定義が見つかりませんでした`, 'info');
    return;
  }

  // 既存のポップアップを削除（前回のフォーカストラップも含めてクリーンアップ）
  const existing = document.getElementById('glossary-popup');
  if (existing) existing.remove();

  const existingOverlay = document.getElementById('glossary-popup-overlay');
  if (existingOverlay) existingOverlay.remove();

  /**
   * ポップアップを閉じる処理（オーバーレイ・ポップアップ・フォーカストラップを同時にクリーン）
   * フォーカストラップのクリーンアップ関数を参照するため、後で代入する
   */
  let cleanupFocusTrap = null;
  const closePopup = () => {
    // フォーカストラップのイベントリスナーを解除する
    if (cleanupFocusTrap) cleanupFocusTrap();
    overlay.remove();
    popup.remove();
  };

  // オーバーレイ
  const overlay = createElement('div', {
    classes: ['glossary-popup-overlay'],
    attrs: { id: 'glossary-popup-overlay' },
  });

  // ポップアップ本体
  // role="dialog" と aria-modal="true" でスクリーンリーダーにモーダルと認識させる
  const popup = createElement('div', {
    classes: ['glossary-popup'],
    attrs: {
      id: 'glossary-popup',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `用語の説明: ${term.term}`,
    },
  });

  // 用語名
  popup.appendChild(createElement('div', {
    classes: ['glossary-popup-term'],
    text: term.term,
  }));

  // 定義文
  popup.appendChild(createElement('div', {
    classes: ['glossary-popup-def'],
    text: term.definition,
  }));

  // 辞書詳細へのリンク（button 要素でキーボード操作可能にする）
  const link = createElement('button', {
    classes: ['glossary-popup-link'],
    text: '→ 用語辞書で詳細を見る',
  });
  link.addEventListener('click', () => {
    closePopup();
    navigate('glossary');
  });
  popup.appendChild(link);

  // 閉じるボタン
  const closeBtn = createElement('button', {
    classes: ['glossary-popup-close'],
    text: '✕',
    attrs: { 'aria-label': 'ポップアップを閉じる' },
  });
  closeBtn.addEventListener('click', closePopup);
  popup.appendChild(closeBtn);

  // オーバーレイクリックで閉じる
  overlay.addEventListener('click', closePopup);

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  // フォーカストラップを設定する（Escキー・Tab制御）
  // popup をフォーカスの境界として指定し、Esc で closePopup を呼ぶ
  cleanupFocusTrap = createFocusTrap(popup, closePopup);
}

/**
 * 節データをIDで検索する（内部使用）
 * @param {string} pageId - 検索する節ID
 * @param {Object} chaptersData - 全コンテンツデータ
 * @returns {{page: Object|null, chapter: Object|null, section: Object|null}}
 */
function findPageData(pageId, chaptersData) {
  for (const section of (chaptersData.sections || [])) {
    for (const category of (section.categories || [])) {
      for (const chapter of (category.chapters || [])) {
        for (const page of (chapter.pages || [])) {
          if (page.page_id === pageId) {
            return { page, chapter, section };
          }
        }
      }
    }
  }
  return { page: null, chapter: null, section: null };
}

/**
 * 節の閲覧時間計測を開始する（内部使用）
 * @param {string} pageId - 表示する節ID
 */
function startPageTimer(pageId) {
  _pageStartTime = Date.now();
  _currentPageId = pageId;
}

/**
 * 現在表示中の節の閲覧時間を記録する（内部使用）
 * 画面遷移前に呼び出す
 */
function saveCurrentPageReadingTime() {
  if (_pageStartTime && _currentPageId) {
    const seconds = Math.floor((Date.now() - _pageStartTime) / 1000);
    if (seconds > 0) {
      recordReadingTime(_currentPageId, seconds);
    }
    _pageStartTime = null;
    _currentPageId = null;
  }
}
