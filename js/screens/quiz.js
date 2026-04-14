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

import { getWeakQuestions, saveQuizSession, recordQuestionAnswer } from '../store.js';
import {
  loadQuestions,
  filterQuestionsByChapter,
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
import { getWeakQuestionIds } from '../utils/progress.js';

/** 現在の演習セッションの状態（イミュータブルに管理） */
let _session = null;

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
  /** 選択中のモード・分野・問題数をローカル状態として管理 */
  let selectedMode     = query.mode     || 'standard';
  let selectedCategory = query.category || 'all';
  let selectedCount    = 10; // デフォルト10問

  const screen = createElement('div', { classes: ['quiz-mode-screen'] });

  screen.appendChild(createElement('h1', { classes: ['quiz-mode-title'], text: '問題演習' }));
  screen.appendChild(createElement('p', {
    classes: ['quiz-mode-subtitle'],
    text: '演習モードと分野を選んでください',
  }));

  // モード選択カード
  const modeSection = createElement('div');
  modeSection.appendChild(createElement('div', {
    classes: ['quiz-filter-label'],
    text: '演習モード',
  }));

  const modes = [
    { id: 'standard', icon: '📝', name: '4択（本番形式）', desc: '選択肢から正解を選ぶ' },
    { id: 'flashcard', icon: '⭕', name: '○✗モード',       desc: '正しいか間違いか即判定' },
    { id: 'weak',      icon: '🎯', name: '苦手問題のみ',   desc: '誤答率50%以上を集中' },
    { id: 'shuffle',   icon: '🔀', name: 'シャッフル',    desc: 'ランダム順で出題' },
    // 模擬試験モード：本番と同じ100問・120分形式
    { id: 'exam',      icon: '🏆', name: '模擬試験',       desc: '本番形式 100問・120分' },
    // 過去問演習モード：年度別の公開問題を選択して演習する
    { id: 'past',      icon: '📚', name: '過去問演習',     desc: '年度別の公開問題' },
  ];

  const modeGrid = createElement('div', { classes: ['quiz-mode-grid'] });

  modes.forEach((mode) => {
    const card = createElement('div', {
      classes: ['quiz-mode-card', selectedMode === mode.id ? 'is-selected' : ''],
      attrs: { 'data-mode': mode.id },
    });

    card.appendChild(createElement('span', { classes: ['quiz-mode-icon'], text: mode.icon }));
    card.appendChild(createElement('span', { classes: ['quiz-mode-name'], text: mode.name }));
    card.appendChild(createElement('span', { classes: ['quiz-mode-desc'], text: mode.desc }));

    card.addEventListener('click', () => {
      modeGrid.querySelectorAll('.quiz-mode-card').forEach((c) => c.classList.remove('is-selected'));
      card.classList.add('is-selected');
      selectedMode = mode.id;
    });

    modeGrid.appendChild(card);
  });

  modeSection.appendChild(modeGrid);
  screen.appendChild(modeSection);

  // 分野フィルター
  const categorySection = createElement('div', { classes: ['quiz-filter-section'] });
  categorySection.appendChild(createElement('div', {
    classes: ['quiz-filter-label'],
    text: '分野絞り込み',
  }));

  const chipContainer = createElement('div', { classes: ['quiz-filter-chips'] });

  const categories = [
    { id: 'all',        label: 'すべて' },
    { id: 'strategy',   label: 'ストラテジ' },
    { id: 'management', label: 'マネジメント' },
    { id: 'technology', label: 'テクノロジ' },
  ];

  categories.forEach((cat) => {
    const chip = createElement('div', {
      classes: ['filter-chip', selectedCategory === cat.id ? 'is-selected' : ''],
      text: cat.label,
    });

    chip.addEventListener('click', () => {
      chipContainer.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('is-selected'));
      chip.classList.add('is-selected');
      selectedCategory = cat.id;
    });

    chipContainer.appendChild(chip);
  });

  categorySection.appendChild(chipContainer);
  screen.appendChild(categorySection);

  // 問題数セレクター（模擬試験・過去問以外のモードで表示）
  const countSection = createElement('div', { classes: ['quiz-filter-section'] });
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
  screen.appendChild(countSection);

  // 演習開始ボタン
  const startBtn = createElement('button', {
    classes: ['quiz-start-btn'],
    text: '✏️ 演習を開始する',
  });

  startBtn.addEventListener('click', async () => {
    // 過去問モードは年度選択画面を表示する（演習開始はしない）
    if (selectedMode === 'past') {
      renderInto(container, [createLoadingSpinner()]);
      await renderPastYearSelect(container);
      return;
    }
    renderInto(container, [createLoadingSpinner()]);
    // 模擬試験は固定100問、それ以外は選択した問題数を渡す
    const questionLimit = selectedMode === 'exam' ? null : selectedCount;
    await startSession(container, selectedMode, selectedCategory, questionLimit);
  });

  screen.appendChild(startBtn);

  renderInto(container, [screen]);
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

    // 模擬試験モードは専用の問題選出ロジックを使用する
    if (mode === 'exam') {
      await startExamSession(container, questionsData);
      return;
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

    // タイマーを開始する（1秒ごとにカウントダウン）
    const timerId = startExamTimer(container);

    // セッション状態を新しいオブジェクトとして初期化（イミュータブル）
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
      timerId,                                // clearIntervalで停止するためIDを保持
      remainingSec:   EXAM_TIME_LIMIT_SEC,    // 残り秒数（1秒ごとに更新）
    };

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
async function startChapterSession(container, chapterId, category) {
  try {
    const questionsData = await loadQuestions();
    const questions = filterQuestionsByChapter(questionsData, chapterId);

    if (questions.length === 0) {
      showToast('この章にはまだ問題がありません', 'info');
      navigate('quiz');
      return;
    }

    _session = {
      isActive:   true,
      phase:      'question',
      mode:       'standard',
      category,
      questions:  shuffleQuestions(questions),
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

// ===================================================
// 問題画面
// ===================================================

/**
 * 問題画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function renderQuestionScreen(container) {
  if (!_session || !_session.isActive) return;

  const current = _session.questions[_session.currentIdx];
  const totalCount = _session.questions.length;
  const currentNum = _session.currentIdx + 1;
  const progressPct = Math.round((currentNum / totalCount) * 100);

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

  // 問題文
  questionCard.appendChild(createElement('p', {
    classes: ['question-text'],
    text: current.question_text,
  }));

  screen.appendChild(questionCard);

  const questionStartTime = Date.now(); // 回答時間計測用
  const isFlashcard = _session.mode === 'flashcard';

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
        text: isCorrect ? '⭕ 正解！' : '❌ 不正解…',
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

      // セッション結果を記録する
      const newResult = {
        question_id:    current.question_id,
        answered:       isCorrect ? current.correct_answer : '__wrong__',
        correct:        isCorrect,
        time_spent_sec: timeSpent,
        questionData:   null,
      };

      _session = {
        ..._session,
        results: [..._session.results, newResult],
      };

      recordQuestionAnswer(current.question_id, isCorrect);

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

  // 4択モード（standard / shuffle / weak / past / exam）
  const choicesList = createElement('div', { classes: ['choices-list'] });

  current.choices.forEach((choice) => {
    const btn = createElement('button', { classes: ['choice-btn'] });

    // 選択肢ID（a, b, c, d）
    btn.appendChild(createElement('span', { classes: ['choice-id'], text: choice.id }));

    // 選択肢テキスト
    btn.appendChild(createElement('span', { classes: ['choice-text'], text: choice.text }));

    btn.addEventListener('click', () => {
      // 二重クリック防止：全ボタンを無効化
      choicesList.querySelectorAll('.choice-btn').forEach((b) => {
        b.disabled = true;
      });

      // 選択した回答を記録
      const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
      const isCorrect = choice.id === current.correct_answer;

      // セッション結果を更新（イミュータブルに新しい結果配列を作成）
      const newResult = {
        question_id:    current.question_id,
        answered:       choice.id,
        correct:        isCorrect,
        time_spent_sec: timeSpent,
        // 模擬試験モードの結果画面で解説を表示するために問題データを保持する
        questionData:   _session.mode === 'exam' ? current : null,
      };

      _session = {
        ..._session,
        phase:       'explanation',
        results:     [..._session.results, newResult],
        lastResult:  { isCorrect, answeredId: choice.id },
      };

      // 苦手問題統計に記録
      recordQuestionAnswer(current.question_id, isCorrect);

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

    choicesList.appendChild(btn);
  });

  screen.appendChild(choicesList);

  renderInto(container, [screen]);
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
    text: isCorrect ? '✓ 正解！' : '✗ 不正解',
  });
  explanationCard.appendChild(resultEl);

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
        ? '合格ラインを超えました！本番も自信を持って臨みましょう。'
        : '惜しい！苦手分野を復習してもう一度挑戦しましょう。',
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

        // 自分の回答
        const myAnswer = questionData.choices.find((c) => c.id === result.answered);
        answerRow.appendChild(createElement('div', {
          classes: ['exam-wrong-your-answer'],
          text: `あなたの回答：${result.answered}. ${myAnswer ? myAnswer.text : '不明'}`,
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
        text: '全問正解！素晴らしいです！',
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
