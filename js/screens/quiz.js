/**
 * quiz.js
 * 問題演習モードの描画ロジックとスコア計算
 * モード選択 → 問題 → 解説 → 結果サマリーの4フェーズ
 *
 * 【模擬試験モード（exam）の追加仕様】
 * - ストラテジ35問・マネジメント20問・テクノロジ45問の計100問をランダム出題
 * - 120分のカウントダウンタイマーを画面上部に表示
 * - 解説は問題ごとに表示せず、全問終了後の結果画面でまとめて表示
 * - 合否判定：総合60%以上かつ各分野30%以上を合格とする
 */

import { getWeakQuestions, saveQuizSession, recordQuestionAnswer, getSRSState, saveSRSState, getSRS } from '../store.js';
import { applyAnswer as srsApplyAnswer, getDueQuestionIds as srsGetDueIds } from '../utils/srs.js';
import {
  loadQuestions,
  filterQuestionsByChapter,
  filterQuestionsByPage,
  filterQuestionsByCategory,
  filterWeakQuestions,
  shuffleQuestions,
} from '../dataLoader.js';
import { navigate } from '../router.js';
import {
  createElement,
  renderInto,
  createLoadingSpinner,
  createEmptyState,
  createCategoryBadge,
  createDifficultyStars,
  showToast,
} from '../utils/render.js';
import { getWeakQuestionIds, calcPastYearStats, getPastWrongQuestionIds } from '../utils/progress.js';
import { getQuizResults } from '../store.js';
import { celebrateCorrect } from '../utils/celebration.js';

/** 現在の演習セッションの状態（イミュータブルに管理） */
let _session = null;

/**
 * 演習セッションをクリーンアップする（外部からの呼び出し用）
 * ブラウザバック等でquiz以外の画面に遷移する際に呼び出し、
 * セッション状態とタイマーを確実に停止・クリアする
 */
export function cleanupQuiz() {
  if (_session) {
    // 模擬試験タイマーが動いている場合は停止する
    if (_session.timerId) {
      clearInterval(_session.timerId);
    }
    _session = null;
  }
}

// ===================================================
// 模擬試験モードの定数
// ===================================================

/** 模擬試験の分野別出題数定義 */
const EXAM_QUESTION_COUNTS = {
  strategy:   35, // ストラテジ系
  management: 20, // マネジメント系
  technology: 45, // テクノロジ系
};

/** 模擬試験の制限時間（秒）：120分 = 7200秒 */
const EXAM_TIME_LIMIT_SEC = 120 * 60;

/** タイマー警告開始の残り秒数：残り10分 */
const EXAM_TIMER_WARNING_SEC = 10 * 60;

/** 合格に必要な総合正答率（60%） */
const EXAM_PASS_RATE_TOTAL = 0.6;

/** 合格に必要な各分野の正答率（30%・足切りライン） */
const EXAM_PASS_RATE_CATEGORY = 0.3;

/** 分野名の日本語マッピング */
const CATEGORY_NAMES = {
  strategy:   'ストラテジ系',
  management: 'マネジメント系',
  technology: 'テクノロジ系',
};

/**
 * 問題演習モードを描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} params - URLパラメータ
 * @param {Object} query - URLクエリパラメータ
 *   query.mode: 'all' | 'weak' | 'chapter'
 *   query.chapter: 章ID（modeがchapterの場合）
 *   query.category: 分野ID
 */
export async function renderQuiz(container, params = {}, query = {}) {
  // セッション中かどうかを確認
  if (_session && _session.isActive) {
    // 演習中であればフェーズに応じて描画
    if (_session.phase === 'question') {
      renderQuestionScreen(container);
    } else if (_session.phase === 'explanation') {
      renderExplanationScreen(container);
    } else if (_session.phase === 'result') {
      renderResultScreen(container);
    }
    return;
  }

  // URLパラメータに mode=weak が指定されている場合は直接開始
  if (query.mode === 'weak') {
    renderInto(container, [createLoadingSpinner()]);
    await startWeakSession(container);
    return;
  }

  // URLパラメータに chapter が指定されている場合はその章の問題を開始
  if (query.chapter) {
    renderInto(container, [createLoadingSpinner()]);
    await startChapterSession(container, query.chapter, query.category || 'all');
    return;
  }

  // URLパラメータに page が指定されている場合は節（細分化された項目）単位で問題を開始
  if (query.page) {
    renderInto(container, [createLoadingSpinner()]);
    await startPageSession(container, query.page);
    return;
  }

  // デフォルト：モード選択画面を表示
  renderModeSelect(container, query);
}

// ===================================================
// モード選択画面
// ===================================================

/**
 * モード選択画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} query - URLクエリパラメータ（事前選択状態の設定）
 */
function renderModeSelect(container, query) {
  const screen = createElement('div', { classes: ['quiz-mode-screen'] });

  screen.appendChild(createElement('h1', { classes: ['quiz-mode-title'], text: '問題演習' }));
  screen.appendChild(createElement('p', {
    classes: ['quiz-mode-subtitle'],
    text: 'モードをタップして開始してください',
  }));

  // モード選択カード
  const modeSection = createElement('div');
  modeSection.appendChild(createElement('div', {
    classes: ['quiz-filter-label'],
    text: '演習モード',
  }));

  const modes = [
    { id: 'standard',  icon: '📝', name: '4択（本番形式）', desc: '選択肢から正解を選ぶ' },
    { id: 'flashcard', icon: '⭕', name: '○✗モード',       desc: '正しいか間違いか即判定' },
    // 間隔反復学習：今日復習期日が来た問題だけを出題する。Anki方式
    { id: 'review',    icon: '🔁', name: '今日の復習',     desc: '間隔反復で記憶を定着' },
    { id: 'weak',      icon: '🎯', name: '苦手問題のみ',   desc: '誤答率50%以上を集中' },
    // 模擬試験モード：本番と同じ100問・120分形式
    { id: 'exam',      icon: '🏆', name: '模擬試験',       desc: '本番形式 100問・120分' },
    // 過去問演習モード：年度別の公開問題を選択して演習する
    { id: 'past',      icon: '📚', name: '過去問演習',     desc: '年度別の公開問題' },
  ];

  const modeGrid = createElement('div', { classes: ['quiz-mode-grid'] });

  modes.forEach((mode) => {
    const card = createElement('div', {
      classes: ['quiz-mode-card'],
      attrs: { 'data-mode': mode.id, 'role': 'button', 'tabindex': '0' },
    });

    card.appendChild(createElement('span', { classes: ['quiz-mode-icon'], text: mode.icon }));
    card.appendChild(createElement('span', { classes: ['quiz-mode-name'], text: mode.name }));
    card.appendChild(createElement('span', { classes: ['quiz-mode-desc'], text: mode.desc }));

    // モードカードをタップ：過去問は直接年度選択へ、それ以外は設定ポップアップを開く
    card.addEventListener('click', () => {
      if (mode.id === 'past') {
        renderInto(container, [createLoadingSpinner()]);
        renderPastYearSelect(container);
        return;
      }
      openModeSettingsModal({
        container,
        mode,
        initialCategory: query.category || 'all',
        initialCount: 10,
      });
    });

    modeGrid.appendChild(card);
  });

  modeSection.appendChild(modeGrid);
  screen.appendChild(modeSection);

  renderInto(container, [screen]);

  // URLでmodeが指定されていてweak/review以外の場合は、初期表示でポップアップを開く
  // （weak/reviewは renderQuiz 側で自動セッション開始するためここには来ない）
  if (query.mode) {
    const targetMode = modes.find((m) => m.id === query.mode);
    if (targetMode && targetMode.id !== 'past') {
      openModeSettingsModal({
        container,
        mode: targetMode,
        initialCategory: query.category || 'all',
        initialCount: 10,
      });
    }
  }
}

/**
 * モード設定ポップアップを開く
 * モード選択後、分野・問題数を選んで演習を開始するためのモーダル
 *
 * 模擬試験モードは100問固定・全分野なのでチップは出さず確認のみ表示する
 *
 * @param {Object} args
 * @param {HTMLElement} args.container - メインコンテナ（演習開始時に上書きされる）
 * @param {Object} args.mode - 選択されたモード { id, icon, name, desc }
 * @param {string} args.initialCategory - 初期選択分野
 * @param {number} args.initialCount - 初期選択問題数
 */
function openModeSettingsModal({ container, mode, initialCategory, initialCount }) {
  // モーダル内のローカル選択状態（イミュータブルにするため変数として保持）
  let selectedCategory = initialCategory;
  let selectedCount    = initialCount;

  // オーバーレイ：背景を半透明で覆う
  const overlay = createElement('div', { classes: ['quiz-mode-modal-overlay'] });

  // モーダル本体
  const modal = createElement('div', {
    classes: ['quiz-mode-modal'],
    attrs: { 'role': 'dialog', 'aria-modal': 'true', 'aria-label': `${mode.name}の設定` },
  });

  // 閉じる関数（オーバーレイから外す）
  const closeModal = () => overlay.remove();

  // 右上の✕ボタン
  const closeBtn = createElement('button', {
    classes: ['quiz-mode-modal-close'],
    text: '✕',
    attrs: { 'aria-label': '閉じる' },
  });
  closeBtn.addEventListener('click', closeModal);
  modal.appendChild(closeBtn);

  // ヘッダー（モード名・アイコン・説明）
  const header = createElement('div', { classes: ['quiz-mode-modal-header'] });
  header.appendChild(createElement('span', { classes: ['quiz-mode-modal-icon'], text: mode.icon }));
  const headerText = createElement('div', { classes: ['quiz-mode-modal-header-text'] });
  headerText.appendChild(createElement('h2', { classes: ['quiz-mode-modal-name'], text: mode.name }));
  headerText.appendChild(createElement('p', { classes: ['quiz-mode-modal-desc'], text: mode.desc }));
  header.appendChild(headerText);
  modal.appendChild(header);

  // 模擬試験モードはチップを出さず、確認情報のみ表示する
  if (mode.id === 'exam') {
    const info = createElement('div', { classes: ['quiz-mode-modal-info'] });
    info.appendChild(createElement('p', {
      classes: ['quiz-mode-modal-info-text'],
      text: '100問・120分・全分野（ストラテジ／マネジメント／テクノロジ）の本番形式で出題されます。',
    }));
    modal.appendChild(info);
  } else {
    // 分野チップセクション
    const categorySection = createElement('div', { classes: ['quiz-mode-modal-section'] });
    categorySection.appendChild(createElement('div', {
      classes: ['quiz-filter-label'],
      text: '分野絞り込み',
    }));

    // チップ生成のヘルパー：選択状態管理を共通化する
    const chipContainer = createElement('div', { classes: ['quiz-filter-chips'] });
    const buildChip = (cat, extraClass) => {
      const chip = createElement('div', {
        classes: ['filter-chip', extraClass, selectedCategory === cat.id ? 'is-selected' : ''],
        text: cat.label,
      });
      chip.addEventListener('click', () => {
        chipContainer.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('is-selected'));
        chip.classList.add('is-selected');
        selectedCategory = cat.id;
      });
      return chip;
    };

    // 上段：すべて（単独・横幅いっぱい）。「全分野を選んでいる」ことを視覚的に強調する
    const allRow = createElement('div', { classes: ['quiz-filter-row', 'quiz-filter-row--all'] });
    allRow.appendChild(buildChip({ id: 'all', label: 'すべて' }, 'filter-chip--full'));
    chipContainer.appendChild(allRow);

    // 下段：3分野を均等3カラムで並べる
    const subjectRow = createElement('div', { classes: ['quiz-filter-row', 'quiz-filter-row--subjects'] });
    const subjects = [
      { id: 'strategy',   label: 'ストラテジ' },
      { id: 'management', label: 'マネジメント' },
      { id: 'technology', label: 'テクノロジ' },
    ];
    subjects.forEach((cat) => subjectRow.appendChild(buildChip(cat, 'filter-chip--subject')));
    chipContainer.appendChild(subjectRow);

    categorySection.appendChild(chipContainer);
    modal.appendChild(categorySection);

    // 問題数チップセクション
    const countSection = createElement('div', { classes: ['quiz-mode-modal-section'] });
    countSection.appendChild(createElement('div', {
      classes: ['quiz-filter-label'],
      text: '問題数',
    }));

    const countContainer = createElement('div', { classes: ['quiz-count-chips'] });
    const countOptions = [
      { count: 10, label: '10問' },
      { count: 20, label: '20問' },
      { count: 30, label: '30問' },
      { count: 50, label: '50問' },
    ];

    countOptions.forEach((opt) => {
      const chip = createElement('div', {
        classes: ['count-chip', selectedCount === opt.count ? 'is-selected' : ''],
        text: opt.label,
      });
      chip.addEventListener('click', () => {
        countContainer.querySelectorAll('.count-chip').forEach((c) => c.classList.remove('is-selected'));
        chip.classList.add('is-selected');
        selectedCount = opt.count;
      });
      countContainer.appendChild(chip);
    });

    countSection.appendChild(countContainer);
    modal.appendChild(countSection);
  }

  // 開始ボタン
  const startBtn = createElement('button', {
    classes: ['quiz-modal-start-btn'],
    text: '✏️ 演習を開始する',
  });
  startBtn.addEventListener('click', async () => {
    closeModal();
    renderInto(container, [createLoadingSpinner()]);
    // 模擬試験は固定100問・全分野、それ以外は選択値を渡す
    const questionLimit = mode.id === 'exam' ? null : selectedCount;
    const category = mode.id === 'exam' ? 'all' : selectedCategory;
    await startSession(container, mode.id, category, questionLimit);
  });
  modal.appendChild(startBtn);

  // オーバーレイ部分（モーダル外）クリックで閉じる
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Escキーで閉じる（一度だけ反応するワンショットリスナー）
  const onEsc = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ===================================================
// 過去問モードの定数
// ===================================================

/**
 * 過去問の年度定義
 * source: questions.json の source フィールドと一致させる
 * label : 画面や解説バッジに表示する日本語名
 */
const PAST_YEAR_OPTIONS = [
  { source: 'past_R06_spring', label: '令和6年度 公開問題', count: 100 },
  { source: 'past_R05_spring', label: '令和5年度 公開問題', count: 100 },
  { source: 'past_R04_spring', label: '令和4年度 公開問題', count: 100 },
  { source: 'past_R03_spring', label: '令和3年度 公開問題', count: 100 },
  { source: 'past_R02_autumn', label: '令和2年度 秋期',     count: 100 },
  // 全年度シャッフル：source = 'all' として特別処理する
  { source: 'all',             label: '全年度シャッフル',   count: null },
];

// ===================================================
// 過去問年度選択画面
// ===================================================

/**
 * 過去問演習の年度選択画面を描画する
 * 年度ごとにカード表示し、タップすると該当年度の問題セッションを開始する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
async function renderPastYearSelect(container) {
  // 事前に全問題データを読み込み、各年度の実在数を確認する
  let questionsData;
  try {
    questionsData = await loadQuestions();
  } catch (error) {
    console.error('[Quiz] 過去問データの読み込みに失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
    return;
  }

  const screen = createElement('div', { classes: ['quiz-mode-screen'] });

  // 戻るボタン（モード選択に戻る）
  const backBtn = createElement('button', {
    classes: ['past-year-back-btn'],
    text: '← 戻る',
  });
  backBtn.addEventListener('click', () => {
    renderModeSelect(container, {});
  });
  screen.appendChild(backBtn);

  screen.appendChild(createElement('h1', {
    classes: ['quiz-mode-title'],
    text: '過去問演習',
  }));
  screen.appendChild(createElement('p', {
    classes: ['quiz-mode-subtitle'],
    text: '演習する年度を選んでください',
  }));

  // 過去問の年度別統計と「現在誤答中の問題ID」を取得する
  // 演習履歴がなければ stats は空、wrongIds も空で問題ない
  const quizResults = getQuizResults();
  const pastStats = calcPastYearStats(quizResults, questionsData.questions);
  const pastWrongIds = getPastWrongQuestionIds(quizResults);

  // 「間違えた過去問だけ復習」カード（誤答が1問以上ある場合のみ表示する）
  if (pastWrongIds.length > 0) {
    const reviewCard = createElement('div', {
      classes: ['past-year-card', 'is-wrong-review'],
    });
    reviewCard.appendChild(createElement('span', {
      classes: ['past-year-label'],
      text: '🎯 間違えた過去問を復習',
    }));
    reviewCard.appendChild(createElement('span', {
      classes: ['past-year-count'],
      text: `${pastWrongIds.length}問が誤答中`,
    }));
    reviewCard.appendChild(createElement('span', {
      classes: ['past-year-stats'],
      text: '正答するまで何度でも',
    }));
    reviewCard.addEventListener('click', async () => {
      renderInto(container, [createLoadingSpinner()]);
      await startPastWrongReviewSession(container, pastWrongIds, questionsData);
    });
    screen.appendChild(reviewCard);
  }

  // 年度カードの一覧
  const yearGrid = createElement('div', { classes: ['past-year-grid'] });

  PAST_YEAR_OPTIONS.forEach((option) => {
    // 全年度シャッフル以外は実在する問題数を確認する
    const actualCount = option.source === 'all'
      ? questionsData.questions.filter((q) => q.source && q.source.startsWith('past_')).length
      : questionsData.questions.filter((q) => q.source === option.source).length;

    // 問題が0件の場合は「データなし」として表示する（タップ不可）
    const isEmpty = actualCount === 0;

    const card = createElement('div', {
      classes: [
        'past-year-card',
        isEmpty ? 'is-empty' : '',
        // 全年度シャッフルは視覚的にアクセントカラーを付ける
        option.source === 'all' ? 'is-shuffle' : '',
      ],
    });

    // 年度ラベル
    card.appendChild(createElement('span', {
      classes: ['past-year-label'],
      text: option.label,
    }));

    // 問題数バッジ（実在数を表示する）
    const countText = isEmpty
      ? '過去問データがありません'
      : `${actualCount}問`;

    card.appendChild(createElement('span', {
      classes: ['past-year-count', isEmpty ? 'is-empty' : ''],
      text: countText,
    }));

    // 過去問の年度別統計を表示（演習履歴がある年度のみ）
    if (!isEmpty && option.source !== 'all' && pastStats[option.source]) {
      const s = pastStats[option.source];
      const statsLine = createElement('span', {
        classes: ['past-year-stats'],
        text: `演習 ${s.total}問 / 正答率 ${s.accuracy}%（誤答 ${s.wrong_ids.length}問）`,
      });
      card.appendChild(statsLine);
    }

    // 問題が存在する場合のみクリックで演習開始できる
    if (!isEmpty) {
      card.addEventListener('click', async () => {
        renderInto(container, [createLoadingSpinner()]);
        await startPastYearSession(container, option.source, option.label, questionsData);
      });
    }

    yearGrid.appendChild(card);
  });

  screen.appendChild(yearGrid);
  renderInto(container, [screen]);
}

/**
 * 過去問演習セッションを開始する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {string} source - 年度識別子（'past_R06_spring' 等、または 'all'）
 * @param {string} sourceLabel - 表示用ラベル（例：'令和6年度 公開問題'）
 * @param {Object} questionsData - questions.json のデータ（事前読み込み済み）
 */
/**
 * 「間違えた過去問だけ復習」セッションを開始する
 * 過去問演習で現時点で誤答状態の問題のみを集めてシャッフル出題する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {string[]} wrongIds - 復習対象の question_id 配列
 * @param {Object} questionsData - 全問題データ（事前読み込み済み）
 */
async function startPastWrongReviewSession(container, wrongIds, questionsData) {
  try {
    // 該当する問題を抽出する（イミュータブル：元配列は変更しない）
    const idSet = new Set(wrongIds);
    const filtered = questionsData.questions.filter((q) => idSet.has(q.question_id));

    if (filtered.length === 0) {
      renderInto(container, [createEmptyState('🎯', '誤答中の過去問はありません')]);
      return;
    }

    const shuffled = shuffleQuestions(filtered);

    _session = {
      isActive:        true,
      phase:           'question',
      mode:            'past',     // 既存の過去問モードと同じ扱い（解説バッジ等も流用）
      category:        'all',
      questions:       shuffled,
      currentIdx:      0,
      results:         [],
      startedAt:       new Date().toISOString(),
      container,
      pastSource:      'wrong_review',
      pastSourceLabel: '間違えた過去問の復習',
    };

    renderQuestionScreen(container);
  } catch (error) {
    console.error('[Quiz] 過去問復習セッション開始に失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
  }
}

async function startPastYearSession(container, source, sourceLabel, questionsData) {
  try {
    // 年度で問題をフィルタリングする（イミュータブル：元の配列は変更しない）
    const filtered = source === 'all'
      // 全年度シャッフル：source が 'past_' で始まる問題をすべて対象にする
      ? questionsData.questions.filter((q) => q.source && q.source.startsWith('past_'))
      // 特定年度：source フィールドが完全一致するものだけを抽出する
      : questionsData.questions.filter((q) => q.source === source);

    if (filtered.length === 0) {
      renderInto(container, [createEmptyState('📚', '過去問データがありません')]);
      return;
    }

    // 問題をシャッフルして新しい配列を作成する（イミュータブル）
    const shuffled = shuffleQuestions(filtered);

    // セッション状態を初期化する（イミュータブルに新規オブジェクトを作成）
    _session = {
      isActive:        true,
      phase:           'question',
      mode:            'past',     // 過去問モードを示す識別子
      category:        'all',
      questions:       shuffled,
      currentIdx:      0,
      results:         [],
      startedAt:       new Date().toISOString(),
      container,
      // 過去問モード専用プロパティ
      pastSource:      source,      // 年度識別子（フィルタリングに使用）
      pastSourceLabel: sourceLabel, // 表示用ラベル（解説バッジに使用）
    };

    renderQuestionScreen(container);

  } catch (error) {
    console.error('[Quiz] 過去問セッション開始に失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
  }
}

// ===================================================
// セッション管理
// ===================================================

/**
 * 演習セッションを開始する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {string} mode - 演習モード
 * @param {string} category - 分野フィルター
 * @param {number|null} questionLimit - 出題する問題数（nullの場合は制限なし）
 */
async function startSession(container, mode, category, questionLimit = null) {
  try {
    const questionsData = await loadQuestions();
    let questions = filterQuestionsByCategory(questionsData, category);

    if (mode === 'weak') {
      const weakData = getWeakQuestions();
      const weakIds = getWeakQuestionIds(weakData);
      questions = filterWeakQuestions(questionsData, weakIds);
      // 苦手問題は分野フィルターも適用する
      if (category !== 'all') {
        questions = questions.filter((q) => q.category === category);
      }
    }

    // SRS復習モード：今日が復習期日になっている問題だけを出題する
    if (mode === 'review') {
      const srsData = getSRS();
      const dueIds = srsGetDueIds(srsData.states);
      // 全問題プールから due ID に該当するものを抽出
      const allQuestions = Array.isArray(questionsData)
        ? questionsData
        : (questionsData.questions || []);
      const dueIdSet = new Set(dueIds);
      questions = allQuestions.filter((q) => dueIdSet.has(q.question_id));
      if (category !== 'all') {
        questions = questions.filter((q) => q.category === category);
      }
    }

    // 模擬試験モードは専用の問題選出ロジックを使用する
    if (mode === 'exam') {
      await startExamSession(container, questionsData);
      return;
    }

    // ○✗モードでは、4択前提の問題文（否定形・計算問題等）は除外する
    // flashcard_skip: true の問題は flashcard_text を持たないため、出題プールから外す
    if (mode === 'flashcard') {
      questions = questions.filter((q) => q.flashcard_skip !== true);
    }

    if (questions.length === 0) {
      renderInto(container, [createEmptyState('🎯', 'この条件に一致する問題がありません')]);
      return;
    }

    // シャッフルして指定問題数に絞る（イミュータブル）
    const shuffled = shuffleQuestions(questions);
    const limited = questionLimit
      ? shuffled.slice(0, Math.min(questionLimit, shuffled.length))
      : shuffled;

    // セッション状態を新しいオブジェクトとして初期化（イミュータブル）
    _session = {
      isActive:   true,
      phase:      'question',
      mode,
      category,
      questions:  limited,
      currentIdx: 0,
      results:    [],
      startedAt:  new Date().toISOString(),
      container,
    };

    renderQuestionScreen(container);

  } catch (error) {
    console.error('[Quiz] セッション開始に失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
  }
}

/**
 * 模擬試験セッションを開始する
 * 分野別に規定数の問題をランダム選出して100問セットを構成する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {Object} questionsData - questions.jsonのデータ
 */
async function startExamSession(container, questionsData) {
  try {
    // 分野別に問題をシャッフルして規定数を選出する（イミュータブル）
    const selectedQuestions = Object.entries(EXAM_QUESTION_COUNTS).flatMap(
      ([category, count]) => {
        // 該当分野の問題をすべて取得してシャッフル
        const categoryQuestions = filterQuestionsByCategory(questionsData, category);
        const shuffled = shuffleQuestions(categoryQuestions);

        // 問題数が不足している場合は何問あるかを記録する
        if (shuffled.length < count) {
          return shuffled; // 不足分はそのまま（後でチェック）
        }

        // 規定数だけ取り出す（sliceで新しい配列を返す・イミュータブル）
        return shuffled.slice(0, count);
      }
    );

    // 各分野の問題数が揃っているか確認する
    const totalRequired = Object.values(EXAM_QUESTION_COUNTS).reduce((sum, n) => sum + n, 0);
    if (selectedQuestions.length < totalRequired) {
      // 問題数が不足している場合は開始を拒否してエラーメッセージを表示する
      const shortage = totalRequired - selectedQuestions.length;
      renderInto(container, [
        createEmptyState(
          '📋',
          `問題数が不足しています。あと ${shortage} 問追加してください。\n` +
          `（必要：ストラテジ35問・マネジメント20問・テクノロジ45問）`
        ),
      ]);
      return;
    }

    // 全100問を分野が混在するようにシャッフルする
    const shuffledAll = shuffleQuestions(selectedQuestions);

    // セッション状態を先に初期化する（タイマーより先に設定してレースコンディションを防ぐ）
    _session = {
      isActive:       true,
      phase:          'question',
      mode:           'exam',
      category:       'all',
      questions:      shuffledAll,
      currentIdx:     0,
      results:        [],
      startedAt:      new Date().toISOString(),
      container,
      // 模擬試験専用プロパティ
      timerId:        null,                   // startExamTimer後に設定する
      remainingSec:   EXAM_TIME_LIMIT_SEC,    // 残り秒数（1秒ごとに更新）
      // CBT本番再現：問題ごとの「あとで見直す」フラグ。Set<question_id> 相当だがJSON化のため配列で保持
      reviewMarks:    [],
    };

    // セッション初期化後にタイマーを開始する（_sessionを参照するため順序が重要）
    _session = { ..._session, timerId: startExamTimer(container) };

    renderQuestionScreen(container);

  } catch (error) {
    console.error('[Quiz] 模擬試験セッション開始に失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
  }
}

/**
 * 模擬試験のカウントダウンタイマーを開始する
 * 残り時間が0になったら自動で試験を終了する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @returns {number} setIntervalのタイマーID（停止時に使用）
 */
function startExamTimer(container) {
  // 1秒ごとに実行するインターバル処理
  const timerId = setInterval(() => {
    // セッションが存在しない、または模擬試験でない場合は安全に停止する
    if (!_session || _session.mode !== 'exam' || !_session.timerId) {
      clearInterval(timerId);
      return;
    }

    // 現在のセッションを安全に参照する
    const currentSession = _session;

    // 残り秒数を1秒減らす（イミュータブルに更新）
    const newRemaining = currentSession.remainingSec - 1;
    _session = { ...currentSession, remainingSec: newRemaining };

    // タイマー表示を更新する
    updateTimerDisplay(newRemaining);

    // 残り時間が0になったら時間切れとして自動終了する
    if (newRemaining <= 0) {
      clearInterval(timerId);
      showToast('時間切れです。試験を終了します。', 'info');
      finishSession(container);
    }
  }, 1000);

  return timerId;
}

/**
 * 画面上のタイマー表示要素を更新する
 * @param {number} remainingSec - 残り秒数
 */
function updateTimerDisplay(remainingSec) {
  const timerEl = document.querySelector('.exam-timer-value');
  if (!timerEl) return;

  // 秒数を「MM:SS」形式に変換する
  const formattedTime = formatSeconds(remainingSec);
  timerEl.textContent = formattedTime;

  // 残り10分を切ったら警告色（赤）に変更する
  const timerBar = document.querySelector('.exam-timer-bar');
  if (timerBar) {
    if (remainingSec <= EXAM_TIMER_WARNING_SEC) {
      timerBar.classList.add('is-warning');
    } else {
      timerBar.classList.remove('is-warning');
    }
  }
}

/**
 * 秒数を「MM:SS」形式の文字列に変換する
 * @param {number} totalSeconds - 変換する秒数
 * @returns {string} 「MM:SS」形式の文字列（例: '119:59'）
 */
function formatSeconds(totalSeconds) {
  // 負の値は0として扱う
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  // 秒数が1桁の場合は「0」でパディングする
  const paddedSeconds = String(seconds).padStart(2, '0');
  return `${minutes}:${paddedSeconds}`;
}

/**
 * 苦手問題セッションを開始する（ホーム画面のクイックアクセスから呼ばれる）
 * @param {HTMLElement} container - 描画先のコンテナ
 */
async function startWeakSession(container) {
  // クイックアクセスからはデフォルト10問で開始する
  await startSession(container, 'weak', 'all', 10);
}

/**
 * 章別セッションを開始する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {string} chapterId - 章ID
 * @param {string} category - 分野ID
 */
/** 章単位演習でランダム抽出する目標問題数 */
const CHAPTER_QUIZ_LIMIT = 20;

async function startChapterSession(container, chapterId, category) {
  try {
    const questionsData = await loadQuestions();
    const questions = filterQuestionsByChapter(questionsData, chapterId);

    if (questions.length === 0) {
      showToast('この章にはまだ問題がありません', 'info');
      navigate('quiz');
      return;
    }

    // シャッフル後、上限まで切り出す。章には30〜75問のばらつきがあるが
    // 1セッションを固定（20問前後）にして負担を一定にする。次回セッションで違う問題が出る
    const shuffled = shuffleQuestions(questions);
    const sessionQuestions = shuffled.slice(0, Math.min(CHAPTER_QUIZ_LIMIT, shuffled.length));

    _session = {
      isActive:   true,
      phase:      'question',
      mode:       'standard',
      category,
      questions:  sessionQuestions,
      currentIdx: 0,
      results:    [],
      startedAt:  new Date().toISOString(),
      chapterId,
      container,
    };

    renderQuestionScreen(container);

  } catch (error) {
    console.error('[Quiz] 章別セッション開始に失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
  }
}

/**
 * 節（page_id）別セッションを開始する
 * 教科書の各節（細分化された項目）から「この節の問題を解く」を押した時に呼ばれる。
 * 問題の related_page_id でフィルタする
 *
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {string} pageId - 節ID（例: 'T-05-01'）
 */
/** 節単位演習でランダム抽出する目標問題数 */
const PAGE_QUIZ_LIMIT = 5;

async function startPageSession(container, pageId) {
  try {
    const questionsData = await loadQuestions();
    const questions = filterQuestionsByPage(questionsData, pageId);

    if (questions.length === 0) {
      showToast('この節にはまだ問題がありません', 'info');
      // 教科書の節画面に戻す（演習モード選択へ流すよりUX上自然）
      navigate(`textbook?page=${pageId}`);
      return;
    }

    // 節は問題数が少なめ（多くの節は5問前後）。シャッフル後、上限まで切り出す。
    // 5問未満なら持っている分だけ。次回セッションで違う問題が出るのでリプレイ価値あり
    const shuffled = shuffleQuestions(questions);
    const sessionQuestions = shuffled.slice(0, Math.min(PAGE_QUIZ_LIMIT, shuffled.length));

    _session = {
      isActive:   true,
      phase:      'question',
      mode:       'standard',
      // 節は分野が一意に決まるが、UI互換のため category は all 扱いにする
      category:   'all',
      questions:  sessionQuestions,
      currentIdx: 0,
      results:    [],
      startedAt:  new Date().toISOString(),
      pageId,
      container,
    };

    renderQuestionScreen(container);

  } catch (error) {
    console.error('[Quiz] 節別セッション開始に失敗しました:', error);
    renderInto(container, [createEmptyState('⚠️', 'データの読み込みに失敗しました')]);
  }
}

// ===================================================
// 問題画面
// ===================================================

/**
 * 問題画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function renderQuestionScreen(container) {
  if (!_session || !_session.isActive) return;

  // 画面遷移時に前画面のフォーカス状態を解除する
  // タッチデバイスで :hover や :focus が新しいDOMに視覚的に転写されるのを防ぐ
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  const current = _session.questions[_session.currentIdx];
  const totalCount = _session.questions.length;
  const currentNum = _session.currentIdx + 1;
  const progressPct = Math.round((currentNum / totalCount) * 100);

  // 4択モード用：現在問題の過去回答から「未確定の選択」を復元する
  // CBT再現モードで前の問題に戻ったとき、最初に選んだ選択肢を見えるようにする
  // results 配列から同 question_id の結果を探し、その answered を初期選択として採用する
  const pastResult = (_session.results || []).find(
    (r) => r.question_id === current.question_id,
  );
  _session = {
    ..._session,
    // 過去回答があればその選択肢、なければ未選択（null）でスタート
    pendingSelection: pastResult ? pastResult.answered : null,
  };

  const screen = createElement('div', { classes: ['quiz-question-screen'] });

  // 模擬試験モードの場合はタイマーバーを画面最上部に表示する
  if (_session.mode === 'exam') {
    const timerBar = createElement('div', {
      classes: [
        'exam-timer-bar',
        // 開始時点で残り10分未満の場合（残り問題数が多い等の異常状態）は警告色を付ける
        _session.remainingSec <= EXAM_TIMER_WARNING_SEC ? 'is-warning' : '',
      ],
    });

    // 時計アイコン
    timerBar.appendChild(createElement('span', {
      classes: ['exam-timer-icon'],
      text: '⏱',
    }));

    // ラベル
    timerBar.appendChild(createElement('span', {
      classes: ['exam-timer-label'],
      text: '残り時間',
    }));

    // 残り時間の数値（updateTimerDisplayで1秒ごとに更新される）
    timerBar.appendChild(createElement('span', {
      classes: ['exam-timer-value'],
      text: formatSeconds(_session.remainingSec),
    }));

    screen.appendChild(timerBar);
  }

  // 進捗バーヘッダー
  const progressHeader = createElement('div', { classes: ['quiz-progress-header'] });
  progressHeader.appendChild(createElement('span', {
    classes: ['quiz-progress-text'],
    text: `${currentNum} / ${totalCount}`,
  }));

  const bar = createElement('div', { classes: ['quiz-progress-bar'] });
  bar.appendChild(createElement('div', {
    classes: ['quiz-progress-fill'],
    attrs: { style: `width: ${progressPct}%` },
  }));
  progressHeader.appendChild(bar);

  // 中断ボタン（進捗バーの右端に配置）
  const quitBtn = createElement('button', {
    classes: ['quiz-quit-btn'],
    text: '中断',
    attrs: { 'aria-label': '演習を中断する' },
  });
  quitBtn.addEventListener('click', () => {
    // _session.container を使う（クロージャの container が古くなる場合がある）
    const target = _session ? _session.container : container;
    // 回答済みの問題があれば結果画面を表示する
    if (_session && _session.results && _session.results.length > 0) {
      finishSession(target);
    } else {
      // 1問も回答していなければモード選択に戻る
      if (_session && _session.timerId) {
        clearInterval(_session.timerId);
      }
      _session = null;
      navigate('quiz');
    }
  });
  progressHeader.appendChild(quitBtn);

  screen.appendChild(progressHeader);

  // 問題カード
  const questionCard = createElement('div', { classes: ['question-card'] });

  // メタ情報（分野・難易度）
  const meta = createElement('div', { classes: ['question-meta'] });
  meta.appendChild(createCategoryBadge(current.category));
  meta.appendChild(createDifficultyStars(current.difficulty));
  questionCard.appendChild(meta);

  // 問題文（○✗モードでは flashcard_text を優先表示する。4択前提の文言を自然な文に整形済み）
  const isFlashcard = _session.mode === 'flashcard';
  const displayQuestionText = (isFlashcard && current.flashcard_text)
    ? current.flashcard_text
    : current.question_text;
  questionCard.appendChild(createElement('p', {
    classes: ['question-text'],
    text: displayQuestionText,
  }));

  // CBT本番再現：模擬試験モード時は問題カードに「⚑ 見直し」フラグボタンを追加する
  if (_session.mode === 'exam') {
    const isMarked = (_session.reviewMarks || []).includes(current.question_id);
    const reviewBtn = createElement('button', {
      classes: ['cbt-review-btn', isMarked ? 'is-marked' : ''],
      text: isMarked ? '⚑ 見直しに登録済み' : '⚑ あとで見直す',
      attrs: { 'aria-pressed': String(isMarked) },
    });
    reviewBtn.addEventListener('click', () => {
      const qid = current.question_id;
      const marks = _session.reviewMarks || [];
      // トグル：登録済なら外す、未登録なら追加する（イミュータブルに新しい配列を作成）
      const newMarks = marks.includes(qid)
        ? marks.filter((id) => id !== qid)
        : [...marks, qid];
      _session = { ..._session, reviewMarks: newMarks };
      // ボタン表示を即時更新
      const newMarked = newMarks.includes(qid);
      reviewBtn.classList.toggle('is-marked', newMarked);
      reviewBtn.textContent = newMarked ? '⚑ 見直しに登録済み' : '⚑ あとで見直す';
      reviewBtn.setAttribute('aria-pressed', String(newMarked));
      // 問題ジャンプパネルがあれば該当ボタンの色も更新する
      const panelBtn = screen.querySelector(`.cbt-jump-btn[data-qid="${qid}"]`);
      if (panelBtn) panelBtn.classList.toggle('is-marked', newMarked);
    });
    questionCard.appendChild(reviewBtn);
  }

  screen.appendChild(questionCard);

  const questionStartTime = Date.now(); // 回答時間計測用

  // ○✗モード：問題文＋提示された選択肢が正解かどうかを○✗で判定する
  if (isFlashcard) {
    // 正解の選択肢と不正解の選択肢を取得する
    const correctChoice = current.choices.find((c) => c.id === current.correct_answer);
    const wrongChoices = current.choices.filter((c) => c.id !== current.correct_answer);

    // 50%の確率で正解を提示、50%の確率で不正解を提示する
    const showCorrect = Math.random() < 0.5;
    const presentedChoice = showCorrect
      ? correctChoice
      : wrongChoices[Math.floor(Math.random() * wrongChoices.length)];
    const correctAnswerIsMaruBatsu = showCorrect; // ○が正解か✗が正解か

    // 提示する選択肢をカードで目立たせて表示する
    const presentCard = createElement('div', { classes: ['marubatsu-present-card'] });
    presentCard.appendChild(createElement('div', {
      classes: ['marubatsu-present-label'],
      text: 'この答えは正しい？',
    }));
    presentCard.appendChild(createElement('div', {
      classes: ['marubatsu-present-text'],
      text: presentedChoice.text,
    }));
    screen.appendChild(presentCard);

    // ○✗ 判定ボタン
    const judgeRow = createElement('div', { classes: ['marubatsu-judge-row'] });

    const batsuBtn = createElement('button', {
      classes: ['marubatsu-btn', 'marubatsu-btn-batsu'],
      text: '✗',
    });

    const maruBtn = createElement('button', {
      classes: ['marubatsu-btn', 'marubatsu-btn-maru'],
      text: '○',
    });

    const handleMaruBatsu = (userAnsweredMaru) => {
      // ユーザーの判定が正しいかどうかを判定する
      const isCorrect = userAnsweredMaru === correctAnswerIsMaruBatsu;
      const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);

      // ボタンを無効化して二重タップを防止する
      maruBtn.disabled = true;
      batsuBtn.disabled = true;

      // 正誤フィードバックを表示する
      const feedbackCard = createElement('div', {
        classes: ['flashcard-answer-card', isCorrect ? 'marubatsu-correct' : 'marubatsu-wrong'],
      });

      feedbackCard.appendChild(createElement('div', {
        classes: ['marubatsu-feedback-label'],
        text: isCorrect ? '⭕ 正解です！' : '❌ 不正解です…',
      }));

      // 正しい答えを表示する
      feedbackCard.appendChild(createElement('div', {
        classes: ['marubatsu-correct-answer'],
        text: `正解：${correctChoice.text}`,
      }));

      // 解説文
      if (current.explanation) {
        feedbackCard.appendChild(createElement('p', {
          classes: ['flashcard-explanation'],
          text: current.explanation,
        }));
      }
      screen.appendChild(feedbackCard);

      // 正解時の演出（紙吹雪・バウンス・効果音・ハプティクス）
      // appendChild後に呼ぶことで feedbackCard がDOMに乗った状態でアニメが動く
      if (isCorrect) {
        celebrateCorrect(feedbackCard);
      }

      // セッション結果を記録する
      const newResult = {
        question_id:    current.question_id,
        answered:       isCorrect ? current.correct_answer : null,
        correct:        isCorrect,
        time_spent_sec: timeSpent,
        questionData:   null,
      };

      _session = {
        ..._session,
        results: [..._session.results, newResult],
      };

      recordQuestionAnswer(current.question_id, isCorrect);
      // SRS（間隔反復）の状態も同時に更新する。次回復習日が自動算出される
      const prevSrs = getSRSState(current.question_id);
      const nextSrs = srsApplyAnswer(prevSrs, isCorrect);
      saveSRSState(current.question_id, nextSrs);

      // 次の問題へ進むボタン＋中断ボタン
      const isLastQuestion = _session.currentIdx >= _session.questions.length - 1;

      const actionRow = createElement('div', { classes: ['marubatsu-action-row'] });

      const nextBtn = createElement('button', {
        classes: ['next-question-btn'],
        text: isLastQuestion ? '📊 結果を見る' : '次の問題へ →',
      });

      nextBtn.addEventListener('click', () => {
        if (isLastQuestion) {
          finishSession(_session.container);
        } else {
          _session = {
            ..._session,
            phase:      'question',
            currentIdx: _session.currentIdx + 1,
          };
          renderQuestionScreen(_session.container);
        }
      });
      actionRow.appendChild(nextBtn);

      // 中断ボタン（最終問題以外で表示）
      if (!isLastQuestion) {
        const quitBtnInline = createElement('button', {
          classes: ['quiz-quit-inline-btn'],
          text: '中断して結果を見る',
        });
        quitBtnInline.addEventListener('click', () => {
          finishSession(_session.container);
        });
        actionRow.appendChild(quitBtnInline);
      }

      screen.appendChild(actionRow);
    };

    batsuBtn.addEventListener('click', () => handleMaruBatsu(false));
    maruBtn.addEventListener('click', () => handleMaruBatsu(true));

    judgeRow.appendChild(batsuBtn);
    judgeRow.appendChild(maruBtn);
    screen.appendChild(judgeRow);

    renderInto(container, [screen]);
    return;
  }

  // 4択モード（standard / shuffle / weak / past / review / exam）
  // 選択→確定の2ステップ式。タップで選択（変更可能）、確定ボタンで判定処理に進む
  const choicesList = createElement('div', { classes: ['choices-list'] });

  // 確定ボタンは先に作成して、選択肢クリック時に有効化する参照を保持しておく
  const confirmBtn = createElement('button', {
    classes: ['confirm-answer-btn'],
    text: '確定する',
    attrs: { 'aria-label': '選択した回答を確定する' },
  });
  // 何も選択されていない初期状態は無効
  confirmBtn.disabled = !_session.pendingSelection;

  current.choices.forEach((choice) => {
    const isInitiallySelected = _session.pendingSelection === choice.id;
    const btn = createElement('button', {
      classes: ['choice-btn', isInitiallySelected ? 'is-selected' : ''],
    });

    // 選択肢ID（a, b, c, d）
    btn.appendChild(createElement('span', { classes: ['choice-id'], text: choice.id }));

    // 選択肢テキスト
    btn.appendChild(createElement('span', { classes: ['choice-text'], text: choice.text }));

    btn.addEventListener('click', () => {
      // 選択を更新する。disable しない＝確定前なら何度でも変更できる
      _session = { ..._session, pendingSelection: choice.id };

      // 全ボタンから is-selected を外し、選択中のボタンだけに付与する
      choicesList.querySelectorAll('.choice-btn').forEach((b) => {
        b.classList.remove('is-selected');
      });
      btn.classList.add('is-selected');

      // 確定ボタンを有効化する
      confirmBtn.disabled = false;
    });

    choicesList.appendChild(btn);
  });

  screen.appendChild(choicesList);

  // 確定ボタンを画面に追加する
  // クリック時に判定処理（既存の results 更新・SRS・解説画面遷移）を実行する
  confirmBtn.addEventListener('click', () => {
    if (!_session.pendingSelection) return;
    const choiceId = _session.pendingSelection;

    // 二重クリック防止
    confirmBtn.disabled = true;

    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const isCorrect = choiceId === current.correct_answer;

    const newResult = {
      question_id:    current.question_id,
      answered:       choiceId,
      correct:        isCorrect,
      time_spent_sec: timeSpent,
      // 模擬試験モードの結果画面で解説を表示するために問題データを保持する
      questionData:   _session.mode === 'exam' ? current : null,
    };

    // CBT再現モードで戻ってきて再確定した場合は既存の結果を上書き、新規なら配列末尾に追加する
    const existingIdx = (_session.results || []).findIndex(
      (r) => r.question_id === current.question_id,
    );
    const isFirstAnswer = existingIdx < 0;
    const newResults = isFirstAnswer
      ? [...(_session.results || []), newResult]
      : _session.results.map((r, i) => (i === existingIdx ? newResult : r));

    _session = {
      ..._session,
      phase:       'explanation',
      results:     newResults,
      pendingSelection: null,  // 確定後はリセットする
      // celebrated: 正解演出を既に発火したかのフラグ。解説画面の再描画時の二重発火を防ぐ
      lastResult:  { isCorrect, answeredId: choiceId, celebrated: false },
    };

    // 苦手問題統計とSRSは「初回確定時のみ」記録する
    // CBTで戻って再確定した場合に統計が二重カウントされるのを防ぐ
    if (isFirstAnswer) {
      recordQuestionAnswer(current.question_id, isCorrect);
      const prevSrs = getSRSState(current.question_id);
      const nextSrs = srsApplyAnswer(prevSrs, isCorrect);
      saveSRSState(current.question_id, nextSrs);
    }

    // 模擬試験モードでは解説画面をスキップして次の問題へ直接進む
    if (_session.mode === 'exam') {
      const isLastQuestion = _session.currentIdx >= _session.questions.length - 1;
      if (isLastQuestion) {
        // 全問解答完了：finishSession内でタイマー停止される
        finishSession(container);
      } else {
        // 次の問題へ（解説なし）
        _session = {
          ..._session,
          phase:      'question',
          currentIdx: _session.currentIdx + 1,
        };
        renderQuestionScreen(container);
      }
      return;
    }

    // 通常モード：解説フェーズへ
    renderExplanationScreen(container);
  });

  screen.appendChild(confirmBtn);

  // CBT本番再現：模擬試験モード時は画面末尾に問題ジャンプパネルを表示する
  // パネルから任意の問題に飛べる。状態は色で示す（未回答=灰 / 回答済=青 / 見直し=黄 / 現在=濃青）
  if (_session.mode === 'exam') {
    screen.appendChild(buildJumpPanel(container));
  }

  renderInto(container, [screen]);
}

/**
 * 問題ジャンプパネルを構築する（CBT本番再現用）
 * 全問題を番号ボタンとして並べ、現在地・回答済・見直し対象を色で示す
 * @param {HTMLElement} container - 描画先のコンテナ
 * @returns {HTMLElement} パネル要素
 */
function buildJumpPanel(container) {
  const wrapper = createElement('details', { classes: ['cbt-jump-panel'] });
  const summary = createElement('summary', {
    classes: ['cbt-jump-summary'],
    text: '🗂 全問ジャンプ',
  });
  wrapper.appendChild(summary);

  const grid = createElement('div', { classes: ['cbt-jump-grid'] });

  // 回答済みの question_id を集める（即時参照のためSetに変換）
  const answeredIds = new Set((_session.results || []).map((r) => r.question_id));
  const reviewMarks = new Set(_session.reviewMarks || []);
  const currentIdx = _session.currentIdx;

  _session.questions.forEach((q, idx) => {
    const isAnswered = answeredIds.has(q.question_id);
    const isMarked = reviewMarks.has(q.question_id);
    const isCurrent = idx === currentIdx;

    const btn = createElement('button', {
      classes: [
        'cbt-jump-btn',
        isCurrent ? 'is-current' : '',
        isAnswered ? 'is-answered' : '',
        isMarked ? 'is-marked' : '',
      ].filter(Boolean),
      text: String(idx + 1),
      attrs: { 'data-qid': q.question_id, 'aria-label': `問${idx + 1}へ移動` },
    });
    btn.addEventListener('click', () => {
      // ジャンプ先に移動して問題画面を再描画
      _session = { ..._session, phase: 'question', currentIdx: idx };
      renderQuestionScreen(container);
    });
    grid.appendChild(btn);
  });

  wrapper.appendChild(grid);
  return wrapper;
}

// ===================================================
// 解説画面
// ===================================================

/**
 * 解説画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function renderExplanationScreen(container) {
  if (!_session || !_session.isActive) return;

  const current   = _session.questions[_session.currentIdx];
  const lastResult = _session.lastResult;
  const { isCorrect, answeredId } = lastResult;
  const totalCount = _session.questions.length;
  const isLastQuestion = _session.currentIdx >= totalCount - 1;

  const screen = createElement('div', { classes: ['quiz-question-screen'] });

  // 進捗バー＋中断ボタン（問題画面と同じUIで一貫性を持たせる）
  const currentNum = _session.currentIdx + 1;
  const progressPct = Math.round((currentNum / totalCount) * 100);

  const progressHeader = createElement('div', { classes: ['quiz-progress-header'] });
  progressHeader.appendChild(createElement('span', {
    classes: ['quiz-progress-text'],
    text: `${currentNum} / ${totalCount}`,
  }));

  const bar = createElement('div', { classes: ['quiz-progress-bar'] });
  bar.appendChild(createElement('div', {
    classes: ['quiz-progress-fill'],
    attrs: { style: `width: ${progressPct}%` },
  }));
  progressHeader.appendChild(bar);

  // 中断ボタン
  const quitBtn = createElement('button', {
    classes: ['quiz-quit-btn'],
    text: '中断',
    attrs: { 'aria-label': '演習を中断する' },
  });
  quitBtn.addEventListener('click', () => {
    const target = _session ? _session.container : container;
    if (_session && _session.results && _session.results.length > 0) {
      finishSession(target);
    } else {
      if (_session && _session.timerId) {
        clearInterval(_session.timerId);
      }
      _session = null;
      navigate('quiz');
    }
  });
  progressHeader.appendChild(quitBtn);
  screen.appendChild(progressHeader);

  // 問題文（再表示）
  const questionCard = createElement('div', { classes: ['question-card'] });
  questionCard.appendChild(createElement('p', {
    classes: ['question-text'],
    text: current.question_text,
  }));
  screen.appendChild(questionCard);

  // 選択肢（正解・不正解を表示）
  const choicesList = createElement('div', { classes: ['choices-list'] });

  current.choices.forEach((choice) => {
    const isThisCorrect = choice.id === current.correct_answer;
    const isThisAnswered = choice.id === answeredId;
    const isThisWrong = isThisAnswered && !isThisCorrect;

    // aria-label を設定して、スクリーンリーダーが正誤を読み上げられるようにする
    // 色覚多様性のユーザーにも正誤が伝わるようにテキストラベルを付与する
    let ariaLabel = choice.text;
    if (isThisCorrect && isThisAnswered) {
      ariaLabel = `正解（あなたの選択）: ${choice.text}`;
    } else if (isThisCorrect) {
      ariaLabel = `正解: ${choice.text}`;
    } else if (isThisWrong) {
      ariaLabel = `不正解（あなたの選択）: ${choice.text}`;
    }

    const btn = createElement('button', {
      classes: [
        'choice-btn',
        isThisCorrect  ? 'is-correct'  : '',
        isThisWrong ? 'is-wrong' : '',
      ],
      attrs: {
        disabled: 'true',
        'aria-label': ariaLabel,
      },
    });

    btn.appendChild(createElement('span', { classes: ['choice-id'], text: choice.id }));
    btn.appendChild(createElement('span', { classes: ['choice-text'], text: choice.text }));

    // 正解・不正解のテキストラベルを視覚的に追加する（色だけに依存しない設計）
    if (isThisCorrect) {
      btn.appendChild(createElement('span', {
        classes: ['choice-result-label', 'choice-result-correct'],
        // aria-hidden でスクリーンリーダーの二重読み上げを防ぐ（aria-label で既に伝えている）
        attrs: { 'aria-hidden': 'true' },
        text: '✓ 正解',
      }));
    } else if (isThisWrong) {
      btn.appendChild(createElement('span', {
        classes: ['choice-result-label', 'choice-result-wrong'],
        attrs: { 'aria-hidden': 'true' },
        text: '✗ 不正解',
      }));
    }

    choicesList.appendChild(btn);
  });

  screen.appendChild(choicesList);

  // 解説カード
  const explanationCard = createElement('div', {
    classes: ['explanation-card', isCorrect ? 'is-correct' : 'is-wrong'],
  });

  const resultEl = createElement('div', {
    classes: ['explanation-result', isCorrect ? 'is-correct' : 'is-wrong'],
    text: isCorrect ? '✓ 正解です！' : '✗ 不正解です',
  });
  explanationCard.appendChild(resultEl);

  // 正解時の演出（紙吹雪・バウンス・効果音・ハプティクス）
  // 解説画面が同じ問題で再描画される場合の二重発火を lastResult.celebrated で防ぐ
  if (isCorrect && lastResult && !lastResult.celebrated) {
    // explanationCardはこの後 screen に append されるが、celebrateCorrect 内の
    // bounce は classList 操作なので appendChild より先に呼んでも問題ない
    celebrateCorrect(explanationCard);
    // フラグを立てて、戻るボタン等で再描画された場合の再発火を防ぐ
    _session = {
      ..._session,
      lastResult: { ...lastResult, celebrated: true },
    };
  }

  // 過去問モードの場合：出典バッジ（年度ラベル）を解説カードに表示する
  // current.source_label（問題データに含まれる場合）または セッションの pastSourceLabel を使用する
  if (_session && _session.mode === 'past') {
    const sourceLabel = current.source_label || _session.pastSourceLabel || null;
    if (sourceLabel) {
      explanationCard.appendChild(createElement('span', {
        classes: ['past-source-badge'],
        text: `出典：${sourceLabel}`,
      }));
    }
  }

  explanationCard.appendChild(createElement('p', {
    classes: ['explanation-text'],
    text: current.explanation,
  }));

  screen.appendChild(explanationCard);

  // 教科書で復習ボタン（関連節がある場合）
  if (current.related_page_id) {
    const reviewBtn = createElement('button', {
      classes: ['review-textbook-btn'],
      text: '📖 教科書で復習する',
    });
    reviewBtn.addEventListener('click', () => {
      // 現在のセッションはアクティブのまま（再開できるように）
      // related_page_idのプレフィックスから分野を判定する
      // S-xx → strategy, M-xx → management, T-xx → technology
      const sectionMap = { S: 'strategy', M: 'management', T: 'technology' };
      const prefix = current.related_page_id.split('-')[0];
      const sectionId = sectionMap[prefix] || 'strategy';
      navigate(`textbook/${sectionId}?page=${current.related_page_id}`);
    });
    screen.appendChild(reviewBtn);
  }

  // 次の問題または結果へのボタン
  const nextBtn = createElement('button', {
    classes: ['next-question-btn'],
    text: isLastQuestion ? '📊 結果を見る' : '次の問題へ →',
  });

  nextBtn.addEventListener('click', () => {
    if (isLastQuestion) {
      // セッション終了 → 結果画面へ
      finishSession(container);
    } else {
      // 次の問題へ
      _session = {
        ..._session,
        phase:      'question',
        currentIdx: _session.currentIdx + 1,
      };
      renderQuestionScreen(container);
    }
  });

  screen.appendChild(nextBtn);

  renderInto(container, [screen]);
}

// ===================================================
// 結果サマリー画面
// ===================================================

/**
 * セッションを終了して結果を記録・表示する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function finishSession(container) {
  if (!_session || !_session.isActive) return;

  // 模擬試験モードのタイマーが残っていれば確実に停止する
  if (_session.timerId) {
    clearInterval(_session.timerId);
    _session = { ..._session, timerId: null };
  }

  // スコアを計算
  const totalCorrect = _session.results.filter((r) => r.correct).length;
  const total = _session.results.length;
  const scorePct = total > 0 ? Math.round((totalCorrect / total) * 100) : 0;

  // 分野別スコアを集計
  const byCategoryTotals = {};
  _session.results.forEach((result) => {
    const q = _session.questions.find((q) => q.question_id === result.question_id);
    if (!q) return;

    const cat = q.category;
    if (!byCategoryTotals[cat]) {
      byCategoryTotals[cat] = { total: 0, correct: 0 };
    }

    byCategoryTotals[cat] = {
      total:   byCategoryTotals[cat].total + 1,
      correct: byCategoryTotals[cat].correct + (result.correct ? 1 : 0),
    };
  });

  // セッションデータを構築（イミュータブル）
  const sessionId = `sess_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15)}`;
  const sessionRecord = {
    session_id:      sessionId,
    started_at:      _session.startedAt,
    mode:            _session.mode,
    category_filter: _session.category,
    results:         _session.results,
    score: {
      total:       total,
      correct:     totalCorrect,
      by_category: byCategoryTotals,
    },
  };

  // localStorageに保存（模擬試験は保存しない仕様：ブラウザを閉じるとセッションは失われる）
  // ただし演習記録として統計に残すため saveQuizSession は呼び出す
  saveQuizSession(sessionRecord);

  // 模擬試験モードの合否判定を計算する
  let examJudgment = null;
  if (_session.mode === 'exam') {
    examJudgment = calcExamJudgment(totalCorrect, total, byCategoryTotals);
  }

  // セッション状態を結果フェーズに更新（イミュータブル）
  _session = {
    ..._session,
    isActive:      false,
    phase:         'result',
    score:         { scorePct, totalCorrect, total, byCategoryTotals },
    examJudgment,  // 模擬試験モードのみ設定される（通常モードはnull）
  };

  renderResultScreen(container);
}

/**
 * 模擬試験の合否判定を計算する
 * 合格条件：総合60%以上、かつ各分野30%以上
 * @param {number} totalCorrect - 総合正解数
 * @param {number} total - 総問題数
 * @param {Object} byCategoryTotals - 分野別スコアオブジェクト
 * @returns {Object} 合否判定結果
 */
function calcExamJudgment(totalCorrect, total, byCategoryTotals) {
  // 総合正答率を計算する
  const totalRate = total > 0 ? totalCorrect / total : 0;
  const isPassTotal = totalRate >= EXAM_PASS_RATE_TOTAL;

  // 分野別足切り判定を計算する（各分野30%以上が必要）
  const categoryJudgments = Object.entries(byCategoryTotals).map(([cat, catScore]) => {
    const catRate = catScore.total > 0 ? catScore.correct / catScore.total : 0;
    const isPassCategory = catRate >= EXAM_PASS_RATE_CATEGORY;
    return {
      category:  cat,
      name:      CATEGORY_NAMES[cat] || cat,
      correct:   catScore.correct,
      total:     catScore.total,
      rate:      catRate,
      isPassed:  isPassCategory,
    };
  });

  // 全分野の足切りをパスしているか確認する
  const isPassAllCategories = categoryJudgments.every((j) => j.isPassed);

  // 最終合否：総合かつ全分野の両方を満たす必要がある
  const isPassed = isPassTotal && isPassAllCategories;

  return {
    isPassed,
    isPassTotal,
    isPassAllCategories,
    totalRate,
    categoryJudgments,
  };
}

/**
 * 結果サマリー画面を描画する
 * 模擬試験モードの場合は合否判定・分野別足切り・間違え一覧も表示する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function renderResultScreen(container) {
  const { score, mode, examJudgment } = _session;
  const { scorePct, totalCorrect, total, byCategoryTotals } = score;
  const isExamMode = mode === 'exam';

  const screen = createElement('div', { classes: ['quiz-result-screen'] });

  // ===== 模擬試験モード：合否判定を大きく表示する =====
  if (isExamMode && examJudgment) {
    const judgmentBanner = createElement('div', {
      classes: [
        'exam-judgment-banner',
        examJudgment.isPassed ? 'is-pass' : 'is-fail',
      ],
    });

    // 合格／不合格のテキスト（大きく表示）
    judgmentBanner.appendChild(createElement('div', {
      classes: ['exam-judgment-label'],
      text: examJudgment.isPassed ? '合格' : '不合格',
    }));

    // 合否のコメント
    judgmentBanner.appendChild(createElement('div', {
      classes: ['exam-judgment-comment'],
      text: examJudgment.isPassed
        ? '合格ラインを超えました！本番もこの調子で臨みましょう🎉'
        : '惜しい！苦手分野を復習してもう一度挑戦しましょう🔥',
    }));

    screen.appendChild(judgmentBanner);
  }

  // ===== スコア大表示カード =====
  const scoreCard = createElement('div', { classes: ['result-score-card'] });

  scoreCard.appendChild(createElement('div', {
    classes: ['result-score-number'],
    text: `${scorePct}%`,
  }));

  scoreCard.appendChild(createElement('div', {
    classes: ['result-score-label'],
    text: '正答率',
  }));

  scoreCard.appendChild(createElement('div', {
    classes: ['result-correct-count'],
    text: `${totalCorrect} / ${total} 問正解`,
  }));

  screen.appendChild(scoreCard);

  // ===== 分野別スコア =====
  if (Object.keys(byCategoryTotals).length > 0) {
    const catSection = createElement('div', {
      classes: ['card', 'result-category-scores'],
    });

    catSection.appendChild(createElement('div', {
      classes: ['card-title'],
      text: isExamMode ? '分野別スコア（足切り判定）' : '分野別スコア',
    }));

    // 模擬試験モードでは足切り判定をcategoryJudgmentsから取得する
    const judgmentMap = isExamMode && examJudgment
      ? Object.fromEntries(examJudgment.categoryJudgments.map((j) => [j.category, j]))
      : {};

    Object.entries(byCategoryTotals).forEach(([cat, catScore]) => {
      const pct = Math.round((catScore.correct / catScore.total) * 100);
      const judgment = judgmentMap[cat];

      const item = createElement('div', {
        classes: [
          'result-category-item',
          // 模擬試験モードで足切りの場合は視覚的に強調する
          isExamMode && judgment && !judgment.isPassed ? 'is-failed-category' : '',
        ],
      });

      item.appendChild(createElement('span', {
        classes: ['result-category-name'],
        text: CATEGORY_NAMES[cat] || cat,
      }));

      // 模擬試験モードでは足切りOK/NGのバッジを表示する
      if (isExamMode && judgment) {
        item.appendChild(createElement('span', {
          classes: [
            'result-category-cutoff-badge',
            judgment.isPassed ? 'is-pass' : 'is-fail',
          ],
          text: judgment.isPassed ? '足切りOK' : '足切りNG',
        }));
      }

      item.appendChild(createElement('span', {
        classes: ['result-category-score'],
        text: `${catScore.correct}/${catScore.total}問 (${pct}%)`,
      }));

      catSection.appendChild(item);
    });

    screen.appendChild(catSection);
  }

  // ===== 模擬試験モード：間違えた問題の一覧を表示する =====
  if (isExamMode) {
    const wrongResults = _session.results.filter((r) => !r.correct);

    if (wrongResults.length > 0) {
      const wrongSection = createElement('div', {
        classes: ['card', 'exam-wrong-list'],
      });

      // セクションヘッダー（折りたたみ可能なデザイン）
      const wrongHeader = createElement('button', {
        classes: ['exam-wrong-list-header'],
        attrs: { 'aria-expanded': 'false' },
      });

      wrongHeader.appendChild(createElement('span', {
        classes: ['card-title'],
        text: `間違えた問題 (${wrongResults.length}問)`,
      }));

      // 展開・折りたたみの矢印アイコン
      const toggleIcon = createElement('span', {
        classes: ['exam-wrong-toggle-icon'],
        text: '▼',
      });
      wrongHeader.appendChild(toggleIcon);

      const wrongBody = createElement('div', {
        classes: ['exam-wrong-list-body'],
        attrs: { 'aria-hidden': 'true' },
      });
      // 初期状態は折りたたみ（styleで非表示）
      wrongBody.style.display = 'none';

      // 折りたたみのトグル処理
      wrongHeader.addEventListener('click', () => {
        const isExpanded = wrongHeader.getAttribute('aria-expanded') === 'true';
        const newExpanded = !isExpanded;

        wrongHeader.setAttribute('aria-expanded', String(newExpanded));
        wrongBody.setAttribute('aria-hidden', String(!newExpanded));
        wrongBody.style.display = newExpanded ? 'block' : 'none';
        toggleIcon.textContent = newExpanded ? '▲' : '▼';
      });

      // 間違えた問題を1問ずつ描画する
      wrongResults.forEach((result, idx) => {
        // resultDataには問題データが保持されている（questionDataプロパティ）
        const questionData = result.questionData;
        if (!questionData) return;

        const item = createElement('div', { classes: ['exam-wrong-item'] });

        // 問題番号
        item.appendChild(createElement('div', {
          classes: ['exam-wrong-item-number'],
          text: `問${idx + 1}`,
        }));

        // 問題文
        item.appendChild(createElement('p', {
          classes: ['exam-wrong-item-question'],
          text: questionData.question_text,
        }));

        // 選択した回答と正解を表示する
        const answerRow = createElement('div', { classes: ['exam-wrong-item-answers'] });

        // 自分の回答（nullの場合は○✗モードで不正解だったことを示す）
        const myAnswer = result.answered
          ? questionData.choices.find((c) => c.id === result.answered)
          : null;
        const myAnswerText = result.answered === null
          ? '不正解（○✗モード）'
          : `${result.answered}. ${myAnswer ? myAnswer.text : '不明'}`;
        answerRow.appendChild(createElement('div', {
          classes: ['exam-wrong-your-answer'],
          text: `あなたの回答：${myAnswerText}`,
        }));

        // 正解
        const correctAnswer = questionData.choices.find((c) => c.id === questionData.correct_answer);
        answerRow.appendChild(createElement('div', {
          classes: ['exam-wrong-correct-answer'],
          text: `正解：${questionData.correct_answer}. ${correctAnswer ? correctAnswer.text : '不明'}`,
        }));

        item.appendChild(answerRow);

        // 解説
        item.appendChild(createElement('p', {
          classes: ['exam-wrong-item-explanation'],
          text: questionData.explanation,
        }));

        wrongBody.appendChild(item);
      });

      wrongSection.appendChild(wrongHeader);
      wrongSection.appendChild(wrongBody);
      screen.appendChild(wrongSection);
    } else {
      // 全問正解の場合は祝福メッセージを表示する
      const perfectMsg = createElement('div', {
        classes: ['card', 'exam-perfect-message'],
      });
      perfectMsg.appendChild(createElement('div', {
        text: '全問正解🎉 素晴らしいです！⭐',
        classes: ['exam-perfect-text'],
      }));
      screen.appendChild(perfectMsg);
    }
  }

  // ===== アクションボタン =====
  const actions = createElement('div', { classes: ['result-actions'] });

  // 再挑戦ボタン（模擬試験は「もう一度受験する」に変える）
  const retryBtn = createElement('button', {
    classes: ['result-retry-btn'],
    text: isExamMode ? '🏆 もう一度受験する' : '🔄 もう一度挑戦する',
  });
  retryBtn.addEventListener('click', () => {
    // タイマーが残っている場合は停止する（念のため）
    if (_session && _session.timerId) {
      clearInterval(_session.timerId);
    }
    _session = null; // セッションをクリアしてから画面遷移
    navigate('quiz');
  });
  actions.appendChild(retryBtn);

  // ホームへボタン
  const homeBtn = createElement('button', {
    classes: ['result-home-btn'],
    text: 'ホームへ戻る',
  });
  homeBtn.addEventListener('click', () => {
    // タイマーが残っている場合は停止する（念のため）
    if (_session && _session.timerId) {
      clearInterval(_session.timerId);
    }
    _session = null; // セッションをクリア
    navigate('home');
  });
  actions.appendChild(homeBtn);

  screen.appendChild(actions);

  renderInto(container, [screen]);
}
