/**
 * srs.js
 * 間隔反復学習（Spaced Repetition System）のコアロジック
 *
 * 【方式】
 * Anki方式のシンプル化版。問題の習熟度を6段階のstageで管理し、
 * 正解するたびに復習間隔を伸ばし、不正解でリセットする。
 *
 * stage  間隔（次回まで）
 * 0      未回答
 * 1      1日後
 * 2      3日後
 * 3      7日後
 * 4      21日後
 * 5      60日後（マスター）
 *
 * 不正解 → stage = 1 にリセット（1日後に再復習）
 *
 * 【イミュータブル原則】
 * このモジュールはすべて純粋関数で構成されている。
 * 既存のstateオブジェクトは変更せず、必ず新しいオブジェクトを返す。
 */

// ステージごとの復習間隔（日）
// インデックス = stage、値 = 次回復習までの日数
// stage 0 は初回回答前なので未使用（NaN）
const REVIEW_INTERVAL_DAYS = [NaN, 1, 3, 7, 21, 60];

// マスター扱いの最大ステージ
export const SRS_MAX_STAGE = 5;

/**
 * 新規問題用の初期SRSステートを返す（純粋関数）
 * @returns {Object} 初期ステート
 */
export function createInitialState() {
  return {
    stage: 0,
    next_review_at: null,
    last_reviewed_at: null,
    consecutive_correct: 0,
    total_attempts: 0,
    total_correct: 0,
  };
}

/**
 * 指定日数後のISO文字列を返す（純粋関数）
 * @param {Date} baseDate - 基準日
 * @param {number} days - 加算する日数
 * @returns {string} ISO 8601 形式の文字列
 */
function addDaysISO(baseDate, days) {
  const next = new Date(baseDate.getTime());
  next.setDate(next.getDate() + days);
  // 復習対象は「日付単位」で扱いたいので、時刻を 00:00 にそろえる
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

/**
 * 回答結果を反映した新しいSRSステートを返す（純粋関数・イミュータブル）
 *
 * @param {Object} prevState - 直前のステート（createInitialState の戻り値の形）
 * @param {boolean} isCorrect - 今回の回答が正解だったか
 * @param {Date} [now] - 現在日時（テスト用に注入可能）
 * @returns {Object} 更新後のステート（新しいオブジェクト）
 */
export function applyAnswer(prevState, isCorrect, now = new Date()) {
  const state = prevState || createInitialState();

  if (isCorrect) {
    // 正解：ステージを1つ進める（最大値で頭打ち）
    const nextStage = Math.min(state.stage + 1, SRS_MAX_STAGE);
    const intervalDays = REVIEW_INTERVAL_DAYS[nextStage];
    return {
      stage: nextStage,
      next_review_at: addDaysISO(now, intervalDays),
      last_reviewed_at: now.toISOString(),
      consecutive_correct: state.consecutive_correct + 1,
      total_attempts: state.total_attempts + 1,
      total_correct: state.total_correct + 1,
    };
  }

  // 不正解：ステージ1にリセットして翌日復習
  return {
    stage: 1,
    next_review_at: addDaysISO(now, REVIEW_INTERVAL_DAYS[1]),
    last_reviewed_at: now.toISOString(),
    consecutive_correct: 0,
    total_attempts: state.total_attempts + 1,
    total_correct: state.total_correct,
  };
}

/**
 * 今日復習すべき問題のIDリストを返す（純粋関数）
 *
 * @param {Object} srsStates - 問題ID → SRSステートのマップ
 * @param {Date} [now] - 現在日時（テスト用に注入可能）
 * @returns {string[]} 復習対象の問題IDの配列
 */
export function getDueQuestionIds(srsStates, now = new Date()) {
  if (!srsStates || typeof srsStates !== 'object') return [];

  const nowMs = now.getTime();
  const dueIds = [];

  for (const [qid, state] of Object.entries(srsStates)) {
    if (!state || !state.next_review_at) continue;
    const dueMs = new Date(state.next_review_at).getTime();
    if (Number.isFinite(dueMs) && dueMs <= nowMs) {
      dueIds.push(qid);
    }
  }
  return dueIds;
}

/**
 * SRSステートのサマリー指標を集計する（純粋関数）
 * ホーム画面の表示やデバッグに使う
 *
 * @param {Object} srsStates - 問題ID → SRSステートのマップ
 * @param {Date} [now] - 現在日時
 * @returns {Object} サマリー
 */
export function summarize(srsStates, now = new Date()) {
  const states = srsStates || {};
  const ids = Object.keys(states);
  const dueCount = getDueQuestionIds(states, now).length;
  const masteredCount = ids.filter((id) => (states[id] || {}).stage === SRS_MAX_STAGE).length;
  const learningCount = ids.length - masteredCount;
  return {
    total_tracked: ids.length,
    due_count: dueCount,
    mastered_count: masteredCount,
    learning_count: learningCount,
  };
}
