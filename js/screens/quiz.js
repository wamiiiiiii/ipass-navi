/**
 * quiz.js
 * 問題演習モードの描画ロジックとスコア計算
 * モード選択 → 問題 → 解説 → 結果サマリーの4フェーズ
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
  /** 選択中のモード・分野をローカル状態として管理 */
  let selectedMode     = query.mode     || 'standard';
  let selectedCategory = query.category || 'all';

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
    { id: 'standard', icon: '📝', name: '4択（本番形式）', desc: '本番と同じ形式で演習' },
    { id: 'flashcard', icon: '🃏', name: '一問一答',       desc: '手軽に確認したいとき' },
    { id: 'weak',      icon: '🎯', name: '苦手問題のみ',   desc: '誤答率50%以上を集中' },
    { id: 'shuffle',   icon: '🔀', name: 'シャッフル',    desc: 'ランダム順で出題' },
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
      // 選択済みカードのスタイルを更新（DOM操作のみ・ステートはローカル変数で管理）
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

  // 演習開始ボタン
  const startBtn = createElement('button', {
    classes: ['quiz-start-btn'],
    text: '✏️ 演習を開始する',
  });

  startBtn.addEventListener('click', async () => {
    renderInto(container, [createLoadingSpinner()]);
    await startSession(container, selectedMode, selectedCategory);
  });

  screen.appendChild(startBtn);

  renderInto(container, [screen]);
}

// ===================================================
// セッション管理
// ===================================================

/**
 * 演習セッションを開始する
 * @param {HTMLElement} container - 描画先のコンテナ
 * @param {string} mode - 演習モード
 * @param {string} category - 分野フィルター
 */
async function startSession(container, mode, category) {
  try {
    const questionsData = await loadQuestions();
    let questions = filterQuestionsByCategory(questionsData, category);

    if (mode === 'weak') {
      const weakData = getWeakQuestions();
      const weakIds = getWeakQuestionIds(weakData);
      questions = filterWeakQuestions(questionsData, weakIds);
    }

    if (questions.length === 0) {
      renderInto(container, [createEmptyState('🎯', 'この条件に一致する問題がありません')]);
      return;
    }

    // シャッフルモードまたはデフォルトでシャッフル
    const shuffled = shuffleQuestions(questions);

    // セッション状態を新しいオブジェクトとして初期化（イミュータブル）
    _session = {
      isActive:   true,
      phase:      'question',
      mode,
      category,
      questions:  shuffled,
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
 * 苦手問題セッションを開始する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
async function startWeakSession(container) {
  await startSession(container, 'weak', 'all');
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

  // 選択肢リスト
  const choicesList = createElement('div', { classes: ['choices-list'] });
  const questionStartTime = Date.now(); // 回答時間計測用

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
        question_id:   current.question_id,
        answered:      choice.id,
        correct:       isCorrect,
        time_spent_sec: timeSpent,
      };

      _session = {
        ..._session,
        phase:       'explanation',
        results:     [..._session.results, newResult],
        lastResult:  { isCorrect, answeredId: choice.id },
      };

      // 苦手問題統計に記録
      recordQuestionAnswer(current.question_id, isCorrect);

      // 解説フェーズへ
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
      navigate(`textbook/strategy?page=${current.related_page_id}`);
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

  // localStorageに保存
  saveQuizSession(sessionRecord);

  // セッション状態を結果フェーズに更新
  _session = {
    ..._session,
    isActive: false,
    phase:    'result',
    score:    { scorePct, totalCorrect, total, byCategoryTotals },
  };

  renderResultScreen(container);
}

/**
 * 結果サマリー画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ
 */
function renderResultScreen(container) {
  const { score } = _session;
  const { scorePct, totalCorrect, total, byCategoryTotals } = score;

  const screen = createElement('div', { classes: ['quiz-result-screen'] });

  // スコア大表示カード
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

  // 分野別スコア
  if (Object.keys(byCategoryTotals).length > 0) {
    const catSection = createElement('div', {
      classes: ['card', 'result-category-scores'],
    });

    catSection.appendChild(createElement('div', {
      classes: ['card-title'],
      text: '分野別スコア',
    }));

    const categoryNames = {
      strategy:   'ストラテジ系',
      management: 'マネジメント系',
      technology: 'テクノロジ系',
    };

    Object.entries(byCategoryTotals).forEach(([cat, catScore]) => {
      const pct = Math.round((catScore.correct / catScore.total) * 100);
      const item = createElement('div', { classes: ['result-category-item'] });

      item.appendChild(createElement('span', {
        classes: ['result-category-name'],
        text: categoryNames[cat] || cat,
      }));

      item.appendChild(createElement('span', {
        classes: ['result-category-score'],
        text: `${catScore.correct}/${catScore.total}問 (${pct}%)`,
      }));

      catSection.appendChild(item);
    });

    screen.appendChild(catSection);
  }

  // アクションボタン
  const actions = createElement('div', { classes: ['result-actions'] });

  // 再挑戦ボタン
  const retryBtn = createElement('button', {
    classes: ['result-retry-btn'],
    text: '🔄 もう一度挑戦する',
  });
  retryBtn.addEventListener('click', () => {
    navigate('quiz');
  });
  actions.appendChild(retryBtn);

  // ホームへボタン
  const homeBtn = createElement('button', {
    classes: ['result-home-btn'],
    text: 'ホームへ戻る',
  });
  homeBtn.addEventListener('click', () => {
    _session = null; // セッションをクリア
    navigate('home');
  });
  actions.appendChild(homeBtn);

  screen.appendChild(actions);

  renderInto(container, [screen]);
}
