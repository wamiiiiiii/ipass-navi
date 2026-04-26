/**
 * store.js
 * localStorageのCRUD操作を担うデータ層モジュール
 * すべての永続化データはこのモジュール経由で読み書きする
 *
 * 【設計方針】
 * - キーには必ず 'ipass_' プレフィックスを付ける
 * - 読み込み時はデフォルト値を返す（null を外部に漏らさない）
 * - 書き込みはイミュータブルパターンで行う（元データを変更せず新しいオブジェクトで保存）
 * - JSONシリアライズ/デシリアライズを一元管理する
 */

// ===================================================
// ストアキーの定数定義
// ===================================================
const KEYS = {
  PROGRESS:       'ipass_progress',
  QUIZ_RESULTS:   'ipass_quiz_results',
  WEAK_QUESTIONS: 'ipass_weak_questions',
  SETTINGS:       'ipass_settings',
  READING_TIME:   'ipass_reading_time',  // 教科書閲覧時間の記録
  SRS:            'ipass_srs',           // 間隔反復学習の問題ごとのステート
};

// ===================================================
// デフォルト値の定義
// ===================================================

/**
 * 学習進捗のデフォルト値を生成する（関数化してタイムスタンプ固定を防ぐ）
 * @returns {Object} デフォルトの学習進捗データ
 */
function createDefaultProgress() {
  return {
    schema_version: 1,
    last_updated: new Date().toISOString(),
    pages_read: [],
    chapters_completed: [],
    bookmarked_pages: [],
    bookmarked_questions: [],
  };
}

/** 演習結果のデフォルト値 */
const DEFAULT_QUIZ_RESULTS = {
  schema_version: 1,
  sessions: [],
};

/** 苦手問題統計のデフォルト値 */
const DEFAULT_WEAK_QUESTIONS = {
  schema_version: 1,
  question_stats: {},
};

/**
 * 設定のデフォルト値を生成する（関数化してタイムスタンプ固定を防ぐ）
 * @returns {Object} デフォルトの設定データ
 */
function createDefaultSettings() {
  return {
    schema_version: 1,
    theme: 'light',
    font_size: 'medium',
    study_start_date: new Date().toISOString().slice(0, 10),
    // 受験予定日（YYYY-MM-DD形式 / 未設定なら null）。ホームのカウントダウンと日次ノルマで使う
    exam_date: null,
    notification_enabled: false,
    // 正解時の効果音（デフォルトOFF。学習中の集中を妨げないため明示的に有効化が必要）
    sound_enabled: false,
  };
}

/** 教科書閲覧時間のデフォルト値 */
const DEFAULT_READING_TIME = {
  schema_version: 1,
  daily_seconds: {},  // キー: 'YYYY-MM-DD'、値: 秒数
  page_seconds: {},   // キー: page_id、値: 合計閲覧秒数
};

/** SRS（間隔反復）データのデフォルト値 */
const DEFAULT_SRS = {
  schema_version: 1,
  // states: 問題ID → SRSステート（utils/srs.js の createInitialState() の形）
  states: {},
};

// ===================================================
// 基本CRUD操作
// ===================================================

/**
 * localStorageからデータを読み込む
 * @param {string} key - ストアキー
 * @param {Object} defaultValue - データが存在しない場合のデフォルト値
 * @returns {Object} 保存されているデータ、なければデフォルト値
 */
function read(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return defaultValue;
    }
    return JSON.parse(raw);
  } catch (error) {
    // JSONパース失敗（データ破損など）の場合はデフォルト値を返す
    console.warn(`[Store] キー "${key}" の読み込みに失敗しました。デフォルト値を使用します。`, error);
    return defaultValue;
  }
}

/**
 * localStorageにデータを書き込む
 * @param {string} key - ストアキー
 * @param {Object} data - 保存するデータ
 * @returns {boolean} 保存に成功した場合はtrue
 */
function write(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    // localStorage容量超過などのエラー
    console.error(`[Store] キー "${key}" への書き込みに失敗しました。`, error);
    return false;
  }
}

// ===================================================
// 学習進捗 (ipass_progress) の操作
// ===================================================

/**
 * 学習進捗データを取得する
 * @returns {Object} 進捗データ
 */
export function getProgress() {
  return read(KEYS.PROGRESS, createDefaultProgress());
}

/**
 * 節を既読としてマークする
 * @param {string} pageId - 既読にする節ID（例: 'S-01-01'）
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function markPageAsRead(pageId) {
  const current = getProgress();

  // 既読済みの場合は何もしない
  if (current.pages_read.includes(pageId)) {
    return true;
  }

  // イミュータブルに新しいオブジェクトを作成して保存
  const updated = {
    ...current,
    last_updated: new Date().toISOString(),
    pages_read: [...current.pages_read, pageId],
  };

  return write(KEYS.PROGRESS, updated);
}

/**
 * ページブックマークを追加する
 * @param {string} pageId - ブックマークする節ID
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function addBookmarkPage(pageId) {
  const current = getProgress();

  if (current.bookmarked_pages.includes(pageId)) {
    return true;
  }

  const updated = {
    ...current,
    last_updated: new Date().toISOString(),
    bookmarked_pages: [...current.bookmarked_pages, pageId],
  };

  return write(KEYS.PROGRESS, updated);
}

/**
 * ページブックマークを削除する
 * @param {string} pageId - ブックマーク解除する節ID
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function removeBookmarkPage(pageId) {
  const current = getProgress();

  const updated = {
    ...current,
    last_updated: new Date().toISOString(),
    // filterで除外した新しい配列を作成（イミュータブル）
    bookmarked_pages: current.bookmarked_pages.filter((id) => id !== pageId),
  };

  return write(KEYS.PROGRESS, updated);
}

/**
 * 問題ブックマークを追加する
 * @param {string} questionId - ブックマークする問題ID
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function addBookmarkQuestion(questionId) {
  const current = getProgress();

  if (current.bookmarked_questions.includes(questionId)) {
    return true;
  }

  const updated = {
    ...current,
    last_updated: new Date().toISOString(),
    bookmarked_questions: [...current.bookmarked_questions, questionId],
  };

  return write(KEYS.PROGRESS, updated);
}

/**
 * 問題ブックマークを削除する
 * @param {string} questionId - ブックマーク解除する問題ID
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function removeBookmarkQuestion(questionId) {
  const current = getProgress();

  const updated = {
    ...current,
    last_updated: new Date().toISOString(),
    bookmarked_questions: current.bookmarked_questions.filter((id) => id !== questionId),
  };

  return write(KEYS.PROGRESS, updated);
}

/**
 * 章を完了済みとしてマークする
 * @param {string} chapterId - 完了する章ID
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function markChapterCompleted(chapterId) {
  const current = getProgress();

  if (current.chapters_completed.includes(chapterId)) {
    return true;
  }

  const updated = {
    ...current,
    last_updated: new Date().toISOString(),
    chapters_completed: [...current.chapters_completed, chapterId],
  };

  return write(KEYS.PROGRESS, updated);
}

// ===================================================
// 演習結果 (ipass_quiz_results) の操作
// ===================================================

/**
 * 演習結果データを取得する
 * @returns {Object} 演習結果データ
 */
export function getQuizResults() {
  return read(KEYS.QUIZ_RESULTS, DEFAULT_QUIZ_RESULTS);
}

/**
 * 演習セッションを記録する
 * @param {Object} session - 記録するセッションオブジェクト
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function saveQuizSession(session) {
  const current = getQuizResults();

  // 新しいセッションを配列の先頭に追加（最新順）
  const updated = {
    ...current,
    sessions: [session, ...current.sessions],
  };

  return write(KEYS.QUIZ_RESULTS, updated);
}

// ===================================================
// 苦手問題統計 (ipass_weak_questions) の操作
// ===================================================

/**
 * 苦手問題統計データを取得する
 * @returns {Object} 苦手問題統計データ
 */
export function getWeakQuestions() {
  return read(KEYS.WEAK_QUESTIONS, DEFAULT_WEAK_QUESTIONS);
}

/**
 * 問題の回答結果を苦手統計に記録する
 * @param {string} questionId - 問題ID
 * @param {boolean} isCorrect - 正解したかどうか
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function recordQuestionAnswer(questionId, isCorrect) {
  const current = getWeakQuestions();
  const existing = current.question_stats[questionId] || { attempts: 0, correct: 0, wrong_rate: 0 };

  // 新しい統計を計算（既存のオブジェクトは変更しない）
  const newAttempts = existing.attempts + 1;
  const newCorrect  = existing.correct + (isCorrect ? 1 : 0);
  const newWrongRate = Math.round(((newAttempts - newCorrect) / newAttempts) * 100) / 100;

  const updatedStats = {
    ...current.question_stats,
    [questionId]: {
      attempts:   newAttempts,
      correct:    newCorrect,
      wrong_rate: newWrongRate,
    },
  };

  const updated = {
    ...current,
    question_stats: updatedStats,
  };

  return write(KEYS.WEAK_QUESTIONS, updated);
}

// ===================================================
// SRS（間隔反復学習） (ipass_srs) の操作
// ===================================================

/**
 * SRSデータ全体を取得する
 * @returns {Object} SRSデータ（states マップを含む）
 */
export function getSRS() {
  return read(KEYS.SRS, DEFAULT_SRS);
}

/**
 * 特定の問題のSRSステートを取得する
 * @param {string} questionId - 問題ID
 * @returns {Object|null} ステート。未登録なら null
 */
export function getSRSState(questionId) {
  const data = getSRS();
  return data.states[questionId] || null;
}

/**
 * 1問分のSRSステートを保存する（イミュータブル）
 * @param {string} questionId - 問題ID
 * @param {Object} newState - 保存するステート
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function saveSRSState(questionId, newState) {
  const current = getSRS();
  const updated = {
    ...current,
    states: {
      ...current.states,
      [questionId]: newState,
    },
  };
  return write(KEYS.SRS, updated);
}

// ===================================================
// 設定 (ipass_settings) の操作
// ===================================================

/**
 * 設定データを取得する
 * @returns {Object} 設定データ
 */
export function getSettings() {
  return read(KEYS.SETTINGS, createDefaultSettings());
}

/**
 * 設定を更新する（部分更新対応）
 * @param {Object} partialSettings - 更新する設定のキーと値
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function updateSettings(partialSettings) {
  const current = getSettings();

  // スプレッド演算子でイミュータブルに新しいオブジェクトを作成
  const updated = {
    ...current,
    ...partialSettings,
  };

  return write(KEYS.SETTINGS, updated);
}

// ===================================================
// 教科書閲覧時間 (ipass_reading_time) の操作
// ===================================================

/**
 * 教科書閲覧時間データを取得する
 * @returns {Object} 閲覧時間データ
 */
export function getReadingTime() {
  return read(KEYS.READING_TIME, DEFAULT_READING_TIME);
}

/**
 * 教科書節の閲覧時間を記録する
 * @param {string} pageId - 閲覧した節ID
 * @param {number} seconds - 閲覧時間（秒）
 * @returns {boolean} 保存に成功した場合はtrue
 */
export function recordReadingTime(pageId, seconds) {
  const current = getReadingTime();
  const today = new Date().toISOString().slice(0, 10);

  // 今日の合計閲覧時間を更新
  const newDailySeconds = {
    ...current.daily_seconds,
    [today]: (current.daily_seconds[today] || 0) + seconds,
  };

  // ページごとの累計閲覧時間を更新
  const newPageSeconds = {
    ...current.page_seconds,
    [pageId]: (current.page_seconds[pageId] || 0) + seconds,
  };

  const updated = {
    ...current,
    daily_seconds: newDailySeconds,
    page_seconds: newPageSeconds,
  };

  return write(KEYS.READING_TIME, updated);
}

/**
 * 今日の合計閲覧時間（秒）を取得する
 * @returns {number} 今日の閲覧時間（秒）
 */
export function getTodayReadingSeconds() {
  const data = getReadingTime();
  const today = new Date().toISOString().slice(0, 10);
  return data.daily_seconds[today] || 0;
}

// ===================================================
// データリセット操作
// ===================================================

/**
 * すべての学習データをリセットする（設定は保持）
 * @returns {boolean} 成功した場合はtrue
 */
export function resetAllData() {
  try {
    // 現在の設定を保持する
    const currentSettings = getSettings();

    // 学習データキーをすべて削除
    localStorage.removeItem(KEYS.PROGRESS);
    localStorage.removeItem(KEYS.QUIZ_RESULTS);
    localStorage.removeItem(KEYS.WEAK_QUESTIONS);
    localStorage.removeItem(KEYS.READING_TIME);
    localStorage.removeItem(KEYS.SRS);

    // 設定の学習開始日だけをリセット（他の設定は保持）
    write(KEYS.SETTINGS, {
      ...currentSettings,
      study_start_date: new Date().toISOString().slice(0, 10),
    });

    console.info('[Store] 学習データをリセットしました。');
    return true;
  } catch (error) {
    console.error('[Store] データリセットに失敗しました。', error);
    return false;
  }
}

/**
 * 全データをリセットする（設定も含む・完全初期化）
 * @returns {boolean} 成功した場合はtrue
 */
export function resetAllDataIncludingSettings() {
  try {
    Object.values(KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
    console.info('[Store] すべてのデータをリセットしました。');
    return true;
  } catch (error) {
    console.error('[Store] 全データリセットに失敗しました。', error);
    return false;
  }
}
