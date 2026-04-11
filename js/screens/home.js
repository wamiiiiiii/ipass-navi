/**
 * home.js
 * ホーム画面（ダッシュボード）の描画ロジック
 * 学習進捗・分野別統計・クイックアクセスを表示する
 */

import { getProgress, getQuizResults, getSettings, getTodayReadingSeconds, getReadingTime } from '../store.js';
import { loadChapters } from '../dataLoader.js';
import { navigate } from '../router.js';
import {
  createElement,
  renderInto,
  createProgressBar,
  createEmptyState,
  createLoadingSpinner,
} from '../utils/render.js';
import {
  calcOverallProgress,
  calcSectionProgress,
  calcTotalAccuracy,
  calcStudyDays,
  calcElapsedDays,
  formatStudyTime,
  calcTodayStudySeconds,
  getRecentSessions,
} from '../utils/progress.js';

/**
 * ホーム画面を描画する
 * @param {HTMLElement} container - 描画先のコンテナ要素
 */
export async function renderHome(container) {
  // ローディング表示
  renderInto(container, [createLoadingSpinner()]);

  try {
    // データを並行して読み込む
    const [chaptersData] = await Promise.all([
      loadChapters(),
    ]);

    // localStorageからデータを取得
    const progress   = getProgress();
    const results    = getQuizResults();
    const settings   = getSettings();

    // 各種統計を計算（純粋関数で計算・副作用なし）
    const overallPct = calcOverallProgress(progress.pages_read, chaptersData);
    const readingTime = getReadingTime();
    const studyDays  = calcStudyDays(readingTime, results);
    const elapsedDays = calcElapsedDays(settings.study_start_date);
    const accuracy   = calcTotalAccuracy(results);
    const todaySecs  = calcTodayStudySeconds(results) + getTodayReadingSeconds();
    const recentSessions = getRecentSessions(results, 3);

    // 分野別進捗を計算
    const sectionProgresses = chaptersData.sections.map((section) => ({
      ...section,
      progressPct: calcSectionProgress(section.section_id, progress.pages_read, chaptersData),
    }));

    // ホーム画面のDOMを構築
    // progress を第2引数で渡し、オンボーディング表示の判定に使う
    const screenEl = buildHomeScreen({
      overallPct,
      studyDays,
      accuracy,
      todaySecs,
      sectionProgresses,
      recentSessions,
    }, progress);

    renderInto(container, [screenEl]);

  } catch (error) {
    // エラー時はエラー表示を描画
    console.error('[Home] 描画に失敗しました:', error);
    renderInto(container, [
      createEmptyState('⚠️', 'データの読み込みに失敗しました。ページを更新してください。'),
    ]);
  }
}

/**
 * ホーム画面全体のDOM要素を構築する
 * @param {Object} data - 表示するデータ
 * @param {Object} progress - 進捗データ（オンボーディング判定に使用）
 * @returns {HTMLElement} ホーム画面の要素
 */
function buildHomeScreen({ overallPct, studyDays, accuracy, todaySecs, sectionProgresses, recentSessions }, progress) {
  const screen = createElement('div', { classes: ['home-screen'] });

  // ウェルカムバナー
  screen.appendChild(buildWelcomeBanner(overallPct));

  // 初回オンボーディングカードの表示判定
  // pages_read が空（まだ1ページも読んでいない）場合にのみ表示する
  // 一度でも教科書を読み始めたら自動的に非表示になる
  const isFirstVisit = progress.pages_read.length === 0;
  if (isFirstVisit) {
    screen.appendChild(buildOnboardingCard());
  }

  // スタッツグリッド（学習日数・経過日数・正答率・今日の学習時間・学習率）
  screen.appendChild(buildStatsGrid(studyDays, elapsedDays, accuracy, todaySecs));

  // クイックアクションボタン
  screen.appendChild(buildQuickActions());

  // 分野別進捗
  screen.appendChild(buildSectionProgress(sectionProgresses));

  // 最近の演習履歴
  if (recentSessions.length > 0) {
    screen.appendChild(buildRecentHistory(recentSessions));
  }

  return screen;
}

/**
 * 初回オンボーディングカードを構築する
 * アプリの使い方を3ステップで案内し、最初の行動を促す
 * @returns {HTMLElement} オンボーディングカード要素
 */
function buildOnboardingCard() {
  const card = createElement('div', { classes: ['onboarding-card'] });

  // カードヘッダー（アイコン＋タイトル）
  const header = createElement('div', { classes: ['onboarding-header'] });
  header.appendChild(createElement('span', { classes: ['onboarding-icon'], text: '🌟' }));

  const titleGroup = createElement('div', { classes: ['onboarding-title-group'] });
  titleGroup.appendChild(createElement('div', { classes: ['onboarding-title'], text: 'はじめての方へ' }));
  titleGroup.appendChild(createElement('div', {
    classes: ['onboarding-subtitle'],
    text: 'まずはここから始めましょう！',
  }));
  header.appendChild(titleGroup);
  card.appendChild(header);

  // 3ステップの説明リスト
  const steps = createElement('div', { classes: ['onboarding-steps'] });

  // ステップ定義（新しい配列として定義・イミュータブルなデータ）
  const stepDefinitions = [
    { num: '1', text: '教科書を読んで基礎を理解する' },
    { num: '2', text: '各章の問題を解いて理解を深める' },
    { num: '3', text: '苦手問題を繰り返して合格力を上げる' },
  ];

  stepDefinitions.forEach(({ num, text }) => {
    const step = createElement('div', { classes: ['onboarding-step'] });
    step.appendChild(createElement('span', { classes: ['onboarding-step-num'], text: num }));
    step.appendChild(createElement('span', { classes: ['onboarding-step-text'], text }));
    steps.appendChild(step);
  });

  card.appendChild(steps);

  // アクションボタングループ
  const actions = createElement('div', { classes: ['onboarding-actions'] });

  // 「教科書から始める」ボタン → ストラテジ系 S-01 の最初の節へ遷移
  const primaryBtn = createElement('button', {
    classes: ['onboarding-btn-primary'],
    text: '📖 教科書から始める（おすすめ）',
  });
  primaryBtn.addEventListener('click', () => {
    // ストラテジ系の最初の節 S-01-01 へ直接遷移する
    navigate('textbook/strategy?page=S-01-01');
  });
  actions.appendChild(primaryBtn);

  // 「問題から始める」ボタン → 演習モード選択画面へ遷移
  const secondaryBtn = createElement('button', {
    classes: ['onboarding-btn-secondary'],
    text: '✏️ まず問題を解いてみる',
  });
  secondaryBtn.addEventListener('click', () => {
    navigate('quiz');
  });
  actions.appendChild(secondaryBtn);

  card.appendChild(actions);
  return card;
}

/**
 * ウェルカムバナーを構築する
 * @param {number} overallPct - 全体進捗率
 * @returns {HTMLElement} ウェルカムバナー要素
 */
function buildWelcomeBanner(overallPct) {
  const banner = createElement('div', { classes: ['home-welcome'] });

  // アプリタイトル
  banner.appendChild(createElement('h1', {
    classes: ['home-app-title'],
    text: 'iPass ナビ',
  }));

  banner.appendChild(createElement('p', {
    classes: ['home-welcome-sub'],
    text: 'ITパスポート試験対策アプリ',
  }));

  // 全体進捗サマリー
  const summary = createElement('div', { classes: ['home-progress-summary'] });

  summary.appendChild(createElement('div', {
    classes: ['home-progress-number'],
    text: `${overallPct}%`,
  }));

  summary.appendChild(createElement('div', {
    classes: ['home-progress-label'],
    text: '教科書の進捗率',
  }));

  // 白色の進捗バー
  const bar = createElement('div', { classes: ['home-progress-bar'] });
  const fill = createElement('div', {
    classes: ['home-progress-bar-fill'],
    attrs: { style: `width: ${overallPct}%` },
  });
  bar.appendChild(fill);
  summary.appendChild(bar);

  banner.appendChild(summary);

  return banner;
}

/**
 * スタッツグリッドを構築する
 * @param {number} studyDays - 学習継続日数
 * @param {number} accuracy - 累計正答率
 * @param {number} todaySecs - 今日の学習時間（秒）
 * @returns {HTMLElement} スタッツグリッド要素
 */
function buildStatsGrid(studyDays, elapsedDays, accuracy, todaySecs) {
  const grid = createElement('div', { classes: ['home-stats-grid'] });

  // 学習日数カード（実際に学習した日 / 経過日数）
  grid.appendChild(buildStatCard(`${studyDays}日`, `学習日数（${elapsedDays}日中）`));

  // 正答率カード
  const accuracyText = accuracy > 0 ? `${accuracy}%` : '---';
  grid.appendChild(buildStatCard(accuracyText, '累計正答率'));

  // 今日の学習時間カード
  const timeText = todaySecs > 0 ? formatStudyTime(todaySecs) : '---';
  grid.appendChild(buildStatCard(timeText, '今日の学習時間'));

  // 学習率カード（何日中何日やったか）
  const studyRate = elapsedDays > 0 ? Math.round((studyDays / elapsedDays) * 100) : 0;
  grid.appendChild(buildStatCard(`${studyRate}%`, '学習率'));

  return grid;
}

/**
 * スタッツカード1枚を構築する
 * @param {string} value - 表示する値
 * @param {string} label - ラベルテキスト
 * @returns {HTMLElement} スタッツカード要素
 */
function buildStatCard(value, label) {
  const card = createElement('div', { classes: ['stat-card'] });
  card.appendChild(createElement('div', { classes: ['stat-card-value'], text: value }));
  card.appendChild(createElement('div', { classes: ['stat-card-label'], text: label }));
  return card;
}

/**
 * クイックアクションボタングループを構築する
 * @returns {HTMLElement} クイックアクション要素
 */
function buildQuickActions() {
  const section = createElement('div', { classes: ['home-quick-actions'] });

  section.appendChild(createElement('h2', {
    classes: ['home-section-title'],
    text: 'クイックアクセス',
  }));

  const grid = createElement('div', { classes: ['quick-action-grid'] });

  // 教科書ボタン
  grid.appendChild(buildQuickActionBtn(
    '📖', '教科書を読む', '分野・章・節から学習',
    () => navigate('textbook')
  ));

  // 演習ボタン
  grid.appendChild(buildQuickActionBtn(
    '✏️', '問題を解く', '4択・一問一答',
    () => navigate('quiz')
  ));

  // 苦手問題ボタン
  grid.appendChild(buildQuickActionBtn(
    '🎯', '苦手問題', '誤答率50%以上の問題',
    () => navigate('quiz?mode=weak')
  ));

  // 辞書ボタン
  grid.appendChild(buildQuickActionBtn(
    '🔍', '用語辞書', '用語の定義を確認',
    () => navigate('glossary')
  ));

  section.appendChild(grid);
  return section;
}

/**
 * クイックアクションボタン1つを構築する
 * @param {string} icon - アイコン絵文字
 * @param {string} label - ラベルテキスト
 * @param {string} desc - 説明テキスト
 * @param {Function} onClick - クリック時のコールバック
 * @returns {HTMLElement} ボタン要素
 */
function buildQuickActionBtn(icon, label, desc, onClick) {
  const btn = createElement('button', { classes: ['quick-action-btn'] });

  btn.appendChild(createElement('span', { classes: ['quick-action-icon'], text: icon }));
  btn.appendChild(createElement('span', { classes: ['quick-action-label'], text: label }));
  btn.appendChild(createElement('span', { classes: ['quick-action-desc'], text: desc }));

  btn.addEventListener('click', onClick);

  return btn;
}

/**
 * 分野別進捗セクションを構築する
 * @param {Array} sectionProgresses - 分野別の進捗データ
 * @returns {HTMLElement} 分野別進捗要素
 */
function buildSectionProgress(sectionProgresses) {
  const section = createElement('div', { classes: ['home-section'] });

  section.appendChild(createElement('h2', {
    classes: ['home-section-title'],
    text: '分野別進捗',
  }));

  sectionProgresses.forEach((sec) => {
    const card = createElement('div', {
      classes: ['section-progress-card'],
    });

    // 分野名と進捗率の行
    const header = createElement('div', { classes: ['section-progress-header'] });

    header.appendChild(createElement('span', {
      classes: ['section-progress-name'],
      text: sec.section_name,
    }));

    header.appendChild(createElement('span', {
      classes: ['section-progress-pct'],
      text: `${sec.progressPct}%`,
    }));

    card.appendChild(header);

    // 出題比率テキスト
    card.appendChild(createElement('span', {
      classes: ['section-exam-ratio'],
      text: `出題比率：約${sec.exam_ratio}%`,
    }));

    // 進捗バー
    card.appendChild(createProgressBar(sec.progressPct));

    // 教科書モードに遷移するクリックイベント
    card.addEventListener('click', () => {
      navigate(`textbook/${sec.section_id}`);
    });

    section.appendChild(card);
  });

  return section;
}

/**
 * 最近の演習履歴セクションを構築する
 * @param {Array} sessions - 最近のセッション配列
 * @returns {HTMLElement} 履歴セクション要素
 */
function buildRecentHistory(sessions) {
  const section = createElement('div', { classes: ['home-section', 'home-recent'] });

  section.appendChild(createElement('h2', {
    classes: ['home-section-title'],
    text: '最近の演習',
  }));

  sessions.forEach((session) => {
    const pct = session.score
      ? Math.round((session.score.correct / session.score.total) * 100)
      : 0;

    const item = createElement('div', { classes: ['recent-session-item'] });

    // スコアバッジ
    item.appendChild(createElement('div', {
      classes: ['recent-session-score'],
      text: `${pct}%`,
    }));

    // セッション情報
    const info = createElement('div', { classes: ['recent-session-info'] });
    const date = new Date(session.started_at);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

    info.appendChild(createElement('div', {
      classes: ['recent-session-date'],
      text: dateStr,
    }));

    info.appendChild(createElement('div', {
      classes: ['recent-session-detail'],
      text: `${session.score?.correct ?? 0} / ${session.score?.total ?? 0} 問正解`,
    }));

    item.appendChild(info);
    section.appendChild(item);
  });

  return section;
}
