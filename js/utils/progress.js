/**
 * progress.js
 * 学習進捗に関する計算ユーティリティ
 * localStorageのデータを元に各種指標を算出する
 *
 * 【イミュータブル原則】
 * このモジュールの関数はすべて純粋関数（副作用なし）。
 * 入力を変更せず、常に新しい計算結果を返す。
 */

/**
 * 全節に対する既読率（全体進捗）を計算する
 * @param {string[]} pagesRead - 既読済みの節IDの配列
 * @param {Object} chaptersData - chapters.jsonから読み込んだデータ
 * @returns {number} 既読率（0〜100のパーセンテージ）
 */
export function calcOverallProgress(pagesRead, chaptersData) {
  // 全節IDを収集する
  const allPageIds = getAllPageIds(chaptersData);

  if (allPageIds.length === 0) {
    return 0;
  }

  // 既読数を数える（Setで高速化・配列を変更しない）
  const allPageIdSet = new Set(allPageIds);
  const readCount = pagesRead.filter((id) => allPageIdSet.has(id)).length;

  // パーセンテージに変換（整数%に統一）
  return Math.round((readCount / allPageIds.length) * 100);
}

/**
 * 指定した分野の進捗率を計算する
 * @param {string} sectionId - 分野ID（'strategy' | 'management' | 'technology'）
 * @param {string[]} pagesRead - 既読済みの節IDの配列
 * @param {Object} chaptersData - chapters.jsonから読み込んだデータ
 * @returns {number} 既読率（0〜100のパーセンテージ）
 */
export function calcSectionProgress(sectionId, pagesRead, chaptersData) {
  // 対象分野のデータを取得（元のデータは変更しない）
  const section = chaptersData.sections.find((s) => s.section_id === sectionId);

  if (!section) {
    return 0;
  }

  // 対象分野の全節IDを収集
  const sectionPageIds = getSectionPageIds(section);

  if (sectionPageIds.length === 0) {
    return 0;
  }

  // Setで高速化（O(n)に改善）
  const sectionPageIdSet = new Set(sectionPageIds);
  const readCount = pagesRead.filter((id) => sectionPageIdSet.has(id)).length;

  // 整数%に統一
  return Math.round((readCount / sectionPageIds.length) * 100);
}

/**
 * 指定した章の進捗率を計算する
 * @param {string} chapterId - 章ID（例: 'S-01'）
 * @param {string[]} pagesRead - 既読済みの節IDの配列
 * @param {Object} chaptersData - chapters.jsonから読み込んだデータ
 * @returns {number} 既読率（0〜100のパーセンテージ）
 */
export function calcChapterProgress(chapterId, pagesRead, chaptersData) {
  // 章を検索
  const chapter = findChapter(chapterId, chaptersData);

  if (!chapter || !chapter.pages || chapter.pages.length === 0) {
    return 0;
  }

  const chapterPageIds = chapter.pages.map((p) => p.page_id);
  // Setで高速化（O(n)に改善）
  const chapterPageIdSet = new Set(chapterPageIds);
  const readCount = pagesRead.filter((id) => chapterPageIdSet.has(id)).length;

  // 整数%に統一
  return Math.round((readCount / chapterPageIds.length) * 100);
}

/**
 * 全演習セッションの累計正答率を計算する
 * @param {Object} quizResults - ipass_quiz_resultsのlocalStorageデータ
 * @returns {number} 正答率（0〜100のパーセンテージ）
 */
export function calcTotalAccuracy(quizResults) {
  if (!quizResults || !quizResults.sessions || quizResults.sessions.length === 0) {
    return 0;
  }

  // 全セッションの合計正解数・合計問題数を集計
  const totals = quizResults.sessions.reduce(
    (acc, session) => {
      // 元のaccを変更せず、新しいオブジェクトを返す（イミュータブル）
      return {
        correct: acc.correct + (session.score?.correct ?? 0),
        total:   acc.total   + (session.score?.total   ?? 0),
      };
    },
    { correct: 0, total: 0 } // 初期値
  );

  if (totals.total === 0) {
    return 0;
  }

  // 整数%に統一
  return Math.round((totals.correct / totals.total) * 100);
}

/**
 * 分野別の正答率を計算する
 * @param {string} category - 分野ID（'strategy' | 'management' | 'technology'）
 * @param {Object} quizResults - ipass_quiz_resultsのlocalStorageデータ
 * @returns {number} 正答率（0〜100のパーセンテージ）
 */
export function calcCategoryAccuracy(category, quizResults) {
  if (!quizResults || !quizResults.sessions || quizResults.sessions.length === 0) {
    return 0;
  }

  // 対象分野の累計を集計
  const totals = quizResults.sessions.reduce(
    (acc, session) => {
      const catScore = session.score?.by_category?.[category];
      if (!catScore) return acc;

      return {
        correct: acc.correct + catScore.correct,
        total:   acc.total   + catScore.total,
      };
    },
    { correct: 0, total: 0 }
  );

  if (totals.total === 0) {
    return 0;
  }

  // 整数%に統一
  return Math.round((totals.correct / totals.total) * 100);
}

/**
 * 苦手な問題のIDリストを取得する
 * 誤答率が指定閾値以上の問題を「苦手問題」とみなす
 * @param {Object} weakData - ipass_weak_questionsのlocalStorageデータ
 * @param {number} [threshold] - 苦手判定の誤答率閾値（デフォルト0.5 = 50%）
 * @returns {string[]} 苦手問題のIDの配列
 */
export function getWeakQuestionIds(weakData, threshold = 0.5) {
  if (!weakData || !weakData.question_stats) {
    return [];
  }

  // 閾値以上の誤答率の問題IDを抽出（元のデータは変更しない）
  return Object.entries(weakData.question_stats)
    .filter(([, stats]) => stats.wrong_rate >= threshold)
    .map(([id]) => id);
}

/**
 * 学習継続日数を計算する
 * @param {string} studyStartDate - 学習開始日（ISO 8601形式：'2026-04-01'）
 * @param {string} [today] - 今日の日付（テスト用・省略時は現在日時を使用）
 * @returns {number} 継続日数（1以上）
 */
/**
 * 実際に学習した日数を計算する
 * 教科書閲覧または演習を行った日だけをカウントする
 * @param {Object} readingTimeData - ipass_reading_timeのデータ（daily_secondsを参照）
 * @param {Object} quizResults - ipass_quiz_resultsのデータ（sessionsを参照）
 * @returns {number} 実際に学習した日数（最低1日）
 */
export function calcStudyDays(readingTimeData, quizResults) {
  const activeDays = new Set();

  // 教科書閲覧があった日を追加
  if (readingTimeData && readingTimeData.daily_seconds) {
    Object.keys(readingTimeData.daily_seconds).forEach((date) => {
      if (readingTimeData.daily_seconds[date] > 0) {
        activeDays.add(date);
      }
    });
  }

  // 演習セッションがあった日を追加
  if (quizResults && quizResults.sessions) {
    quizResults.sessions.forEach((session) => {
      if (session.started_at) {
        const date = session.started_at.slice(0, 10);
        activeDays.add(date);
      }
    });
  }

  // 実際に学習活動があった日だけカウントする
  // （アプリを開いただけではカウントしない）
  return Math.max(1, activeDays.size);
}

/**
 * 開始日からの経過日数を計算する
 * @param {string} studyStartDate - 開始日（YYYY-MM-DD形式）
 * @returns {number} 経過日数（最低1日）
 */
export function calcElapsedDays(studyStartDate) {
  if (!studyStartDate) {
    return 1;
  }

  const start = new Date(studyStartDate);
  const now = new Date();
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((nowMidnight - startMidnight) / (1000 * 60 * 60 * 24));

  return Math.max(1, diffDays + 1);
}

/**
 * 今日の演習セッション時間（秒）を合計する
 * @param {Object} quizResults - ipass_quiz_resultsのlocalStorageデータ
 * @param {string} [today] - 今日の日付（YYYY-MM-DD形式・省略時は現在日時）
 * @returns {number} 今日の合計演習時間（秒）
 */
export function calcTodayStudySeconds(quizResults, today = null) {
  if (!quizResults || !quizResults.sessions) {
    return 0;
  }

  const todayStr = today || new Date().toISOString().slice(0, 10);

  return quizResults.sessions
    .filter((session) => session.started_at?.startsWith(todayStr))
    .reduce((total, session) => {
      // セッション内の全問題の所要時間を合計
      const sessionTime = (session.results || []).reduce(
        (sum, result) => sum + (result.time_spent_sec || 0),
        0
      );
      return total + sessionTime;
    }, 0);
}

/**
 * 秒数を分単位の文字列に変換する
 * @param {number} seconds - 変換する秒数
 * @returns {string} 表示用の時間文字列
 */
export function formatStudyTime(seconds) {
  if (seconds < 60) {
    return '1分未満';
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;

  if (hours > 0) {
    return remainingMin > 0 ? `${hours}時間${remainingMin}分` : `${hours}時間`;
  }

  return `${minutes}分`;
}

/**
 * 直近N日間の正答率を計算する
 * @param {Object} quizResults - ipass_quiz_resultsのデータ
 * @param {number} days - 直近何日分を対象にするか
 * @returns {number} 正答率（0〜100）。セッションがなければ-1
 */
export function calcRecentAccuracy(quizResults, days = 3) {
  if (!quizResults || !quizResults.sessions || quizResults.sessions.length === 0) {
    return -1;
  }

  // N日前の日付を計算
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // 直近N日間のセッションを抽出
  const recentSessions = quizResults.sessions.filter(
    (s) => s.started_at && s.started_at.slice(0, 10) >= cutoffStr
  );

  if (recentSessions.length === 0) {
    return -1;
  }

  // 正答数と全問題数を集計
  let total = 0;
  let correct = 0;
  recentSessions.forEach((s) => {
    if (s.score) {
      total += s.score.total || 0;
      correct += s.score.correct || 0;
    }
  });

  return total > 0 ? Math.round((correct / total) * 100) : -1;
}

/**
 * 合格可能性を判定する
 * 直近の演習結果から合格ラインとの距離を判定
 * @param {Object} quizResults - ipass_quiz_resultsのデータ
 * @returns {{ level: string, label: string, color: string }} 判定結果
 */
export function calcPassPrediction(quizResults) {
  if (!quizResults || !quizResults.sessions || quizResults.sessions.length < 3) {
    return { level: 'unknown', label: 'データ不足', color: 'gray', description: '3回以上演習すると判定が表示されます' };
  }

  // 直近10セッションの正答率を計算
  const recent = [...quizResults.sessions]
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, 10);

  let total = 0;
  let correct = 0;
  const categoryScores = {};

  recent.forEach((s) => {
    if (s.score) {
      total += s.score.total || 0;
      correct += s.score.correct || 0;

      // 分野別集計
      if (s.score.by_category) {
        Object.entries(s.score.by_category).forEach(([cat, catScore]) => {
          if (!categoryScores[cat]) {
            categoryScores[cat] = { total: 0, correct: 0 };
          }
          categoryScores[cat].total += catScore.total || 0;
          categoryScores[cat].correct += catScore.correct || 0;
        });
      }
    }
  });

  if (total === 0) {
    return { level: 'unknown', label: 'データ不足', color: 'gray', description: '3回以上演習すると判定が表示されます' };
  }

  const overallRate = (correct / total) * 100;
  const rateText = `正答率${Math.round(overallRate)}%`;

  // 分野別足切りチェック（各分野30%以上必要）
  let hasWeakCategory = false;
  Object.values(categoryScores).forEach((cs) => {
    if (cs.total > 0 && (cs.correct / cs.total) < 0.3) {
      hasWeakCategory = true;
    }
  });

  // 判定（直近10回の演習結果がベース）
  if (overallRate >= 75 && !hasWeakCategory) {
    return { level: 'high', label: '合格圏内', color: 'green', description: `直近${recent.length}回 ${rateText}・全分野30%超` };
  } else if (overallRate >= 60 && !hasWeakCategory) {
    return { level: 'borderline', label: 'あと一歩', color: 'orange', description: `直近${recent.length}回 ${rateText}（75%で合格圏）` };
  } else if (overallRate >= 45) {
    const weakNote = hasWeakCategory ? '・苦手分野あり' : '';
    return { level: 'effort', label: 'もう少し頑張ろう', color: 'yellow', description: `直近${recent.length}回 ${rateText}${weakNote}` };
  } else {
    return { level: 'low', label: '基礎固めから', color: 'red', description: `直近${recent.length}回 ${rateText}（60%が合格ライン）` };
  }
}

/**
 * 最近のセッション履歴（最大N件）を取得する
 * @param {Object} quizResults - ipass_quiz_resultsのlocalStorageデータ
 * @param {number} [limit] - 取得する件数（デフォルト5件）
 * @returns {Array} セッションの配列（新しい順）
 */
export function getRecentSessions(quizResults, limit = 5) {
  if (!quizResults || !quizResults.sessions || quizResults.sessions.length === 0) {
    return [];
  }

  // 元の配列を変更せずにスライス（イミュータブル）
  return [...quizResults.sessions]
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, limit);
}

// ===================================================
// プライベートヘルパー関数
// ===================================================

/**
 * chapters.jsonから全節IDを収集する（内部使用）
 * @param {Object} chaptersData - chapters.jsonのデータ
 * @returns {string[]} 全節IDの配列
 */
function getAllPageIds(chaptersData) {
  const ids = [];

  (chaptersData.sections || []).forEach((section) => {
    (section.categories || []).forEach((category) => {
      (category.chapters || []).forEach((chapter) => {
        (chapter.pages || []).forEach((page) => {
          ids.push(page.page_id);
        });
      });
    });
  });

  return ids;
}

/**
 * 指定分野の全節IDを収集する（内部使用）
 * @param {Object} section - 分野オブジェクト
 * @returns {string[]} 分野内の全節IDの配列
 */
function getSectionPageIds(section) {
  const ids = [];

  (section.categories || []).forEach((category) => {
    (category.chapters || []).forEach((chapter) => {
      (chapter.pages || []).forEach((page) => {
        ids.push(page.page_id);
      });
    });
  });

  return ids;
}

/**
 * 章IDで章データを検索する（内部使用）
 * @param {string} chapterId - 検索する章ID
 * @param {Object} chaptersData - chapters.jsonのデータ
 * @returns {Object|null} 見つかった章オブジェクト、見つからない場合はnull
 */
function findChapter(chapterId, chaptersData) {
  for (const section of (chaptersData.sections || [])) {
    for (const category of (section.categories || [])) {
      for (const chapter of (category.chapters || [])) {
        if (chapter.chapter_id === chapterId) {
          return chapter;
        }
      }
    }
  }
  return null;
}

// ===================================================
// モチベ機能用の計算関数（純粋関数）
// ===================================================

/**
 * 連続学習日数（current streak）を計算する
 *
 * 「連続」の判定：今日または前日から遡って、学習があった日が途切れずに続く日数。
 * - 今日も学習なし、かつ昨日も学習なし → 0
 * - 今日学習あり → 1。さらに昨日も学習あり → 2。…と遡る
 * - 今日は学習なし、昨日は学習あり → 1（streak が今日途切れたとは判定しない）
 *
 * @param {Object} readingTimeData - ipass_reading_time のデータ
 * @param {Object} quizResults - ipass_quiz_results のデータ
 * @param {Date} [now] - 現在日時（テスト用）
 * @returns {number} 連続学習日数
 */
export function calcCurrentStreak(readingTimeData, quizResults, now = new Date()) {
  // 学習があった日付（YYYY-MM-DD）の Set を作る
  const studyDays = new Set();

  // 教科書閲覧があった日を加える
  const daily = (readingTimeData && readingTimeData.daily_seconds) || {};
  for (const [date, sec] of Object.entries(daily)) {
    if (sec > 0) studyDays.add(date);
  }

  // 演習をした日を加える（started_at の日付部分）
  const sessions = (quizResults && quizResults.sessions) || [];
  for (const s of sessions) {
    if (!s.started_at) continue;
    studyDays.add(String(s.started_at).slice(0, 10));
  }
  // 苦手問題の attempts は日付情報を持たないので集計対象外（streak目的では readingTime + sessions で十分）

  if (studyDays.size === 0) return 0;

  // 今日から1日ずつ遡る。連続が途切れた時点で終了
  let streak = 0;
  let cursor = new Date(now.getTime());
  cursor.setHours(0, 0, 0, 0);

  // 今日が学習日でなければ、昨日からカウントを始める（today miss を許容）
  const todayKey = cursor.toISOString().slice(0, 10);
  if (!studyDays.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  // 連続日数を遡って数える（最大365日でガード）
  for (let i = 0; i < 365; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if (studyDays.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * 連続学習日数からバッジ情報を返す（純粋関数）
 * @param {number} streakDays - 連続学習日数
 * @returns {Object} { tier, label, icon, nextThreshold }
 */
export function getStreakBadge(streakDays) {
  // ランクは下から上へ。streakDays がそのランクの閾値以上なら該当
  const tiers = [
    { tier: 0, threshold: 0,   label: 'スタート',  icon: '✨', nextThreshold: 3 },
    { tier: 1, threshold: 3,   label: '3日継続',   icon: '🔥', nextThreshold: 7 },
    { tier: 2, threshold: 7,   label: '1週間継続', icon: '🔥🔥', nextThreshold: 30 },
    { tier: 3, threshold: 30,  label: '1ヶ月継続', icon: '🏅', nextThreshold: 100 },
    { tier: 4, threshold: 100, label: '100日継続', icon: '👑', nextThreshold: null },
  ];
  // 該当する最大ランクを返す
  let result = tiers[0];
  for (const t of tiers) {
    if (streakDays >= t.threshold) result = t;
  }
  return result;
}

/**
 * 章ごとのマスター状況を計算する（純粋関数）
 * 「マスター」=その章の問題に対する正答率が80%以上、かつ最低3回以上回答している
 *
 * 章を判定するために問題ID → chapter_id の逆引きマップが必要。
 * 呼び出し側が questionsData（全問題のフラット配列）を渡す。
 *
 * @param {Object} quizResults - ipass_quiz_results のデータ
 * @param {Object} chaptersData - chapters.json のデータ
 * @param {Array<Object>} allQuestions - 全問題のフラット配列（chapter_idを引くため）
 * @returns {Object} chapterId → { mastered, accuracy, attempts } のマップ
 */
export function calcChapterMastery(quizResults, chaptersData, allQuestions = []) {
  // 問題ID → chapter_id のマップを作る（イミュータブル：新しいオブジェクトを返す）
  const questionToChapter = {};
  for (const q of allQuestions) {
    if (q && q.question_id && q.chapter_id) {
      questionToChapter[q.question_id] = q.chapter_id;
    }
  }

  // 章ID → { attempts, correct } を集計する
  const stats = {};
  const sessions = (quizResults && quizResults.sessions) || [];
  for (const session of sessions) {
    // セッション内の各回答（results 配列）を見る
    const results = session.results || [];
    for (const r of results) {
      const cid = questionToChapter[r.question_id];
      if (!cid) continue;
      if (!stats[cid]) stats[cid] = { attempts: 0, correct: 0 };
      stats[cid].attempts += 1;
      if (r.correct) stats[cid].correct += 1;
    }
  }

  // 章一覧を取得して mastery 判定
  const result = {};
  for (const section of (chaptersData?.sections || [])) {
    for (const category of (section.categories || [])) {
      for (const chapter of (category.chapters || [])) {
        const cid = chapter.chapter_id;
        const s = stats[cid] || { attempts: 0, correct: 0 };
        const accuracy = s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0;
        // 最低3回以上回答 + 正答率80%以上で「マスター」
        const mastered = s.attempts >= 3 && accuracy >= 80;
        result[cid] = {
          mastered,
          accuracy,
          attempts: s.attempts,
        };
      }
    }
  }
  return result;
}

/**
 * 過去問の年度別統計を計算する（純粋関数）
 *
 * 過去問モード（mode === 'past'）のセッション結果を source 別に集計し、
 * 各年度の正答率・正解数・間違えた問題IDを返す。
 *
 * @param {Object} quizResults - ipass_quiz_results のデータ
 * @param {Array<Object>} allQuestions - 全問題のフラット配列（source/chapter_idを引くため）
 * @returns {Object} source → { total, correct, accuracy, wrong_ids }
 */
export function calcPastYearStats(quizResults, allQuestions = []) {
  // 問題ID → 問題オブジェクトのマップを作る（純粋関数：新しいオブジェクトを返す）
  const qMap = {};
  for (const q of allQuestions) {
    if (q && q.question_id) qMap[q.question_id] = q;
  }

  // source別に「最新の正誤」を集計する
  // 同じ問題を複数回演習した場合は最新の結果を採用（ただしwrong_idsには「現在も誤答」の問題だけ含める）
  const stats = {};
  const seenQuestions = new Set();  // 同じ問題は最新の結果のみ採用

  // セッションは新しい順に並んでいる（saveQuizSession で先頭に追加されるため）
  const sessions = (quizResults && quizResults.sessions) || [];
  for (const session of sessions) {
    if (session.mode !== 'past') continue;
    for (const r of (session.results || [])) {
      const q = qMap[r.question_id];
      if (!q || !q.source || !q.source.startsWith('past_')) continue;
      // 同じ問題は新しい結果（先に出現した方）を優先する
      if (seenQuestions.has(r.question_id)) continue;
      seenQuestions.add(r.question_id);

      const src = q.source;
      if (!stats[src]) {
        stats[src] = { total: 0, correct: 0, accuracy: 0, wrong_ids: [] };
      }
      stats[src].total += 1;
      if (r.correct) {
        stats[src].correct += 1;
      } else {
        stats[src].wrong_ids.push(r.question_id);
      }
    }
  }

  // 正答率を計算（イミュータブル：新しいオブジェクトを返す）
  for (const src of Object.keys(stats)) {
    const s = stats[src];
    s.accuracy = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
  }
  return stats;
}

/**
 * 過去問で「現時点で誤答状態」の問題IDをすべて返す（純粋関数）
 *
 * 「間違えた過去問だけ復習」モードで使用する。
 * 同じ問題を複数回演習した場合は最新の結果を採用する。
 *
 * @param {Object} quizResults - ipass_quiz_results
 * @returns {string[]} 現時点で誤答状態の question_id 配列
 */
export function getPastWrongQuestionIds(quizResults) {
  const seen = new Set();
  const wrongIds = [];
  const sessions = (quizResults && quizResults.sessions) || [];
  // セッションは新しい順。最初に見つかった結果が最新の結果
  for (const session of sessions) {
    if (session.mode !== 'past') continue;
    for (const r of (session.results || [])) {
      if (seen.has(r.question_id)) continue;
      seen.add(r.question_id);
      if (!r.correct) wrongIds.push(r.question_id);
    }
  }
  return wrongIds;
}

/**
 * 今日の学習計画（具体的なタスクリスト）を生成する（純粋関数）
 *
 * 「合格に効く順」でその日にやるべきことを優先度つきで返す：
 *   1. SRS復習（今日が期日の問題） — 記憶定着の最優先
 *   2. 苦手問題の演習 — 弱点克服
 *   3. 未読の教科書を進める — 知識のカバレッジ
 *   4. 新規問題の演習（日次ノルマ分） — 試験日逆算で必要数
 *
 * @param {Object} input
 * @param {Object} input.srsSummary - srs.summarize の戻り値
 * @param {Object} input.weakData - ipass_weak_questions
 * @param {Object} input.progress - ipass_progress
 * @param {Object} input.chaptersData - chapters.json
 * @param {Object|null} input.examCountdown - calcExamCountdown の戻り値
 * @returns {Array<{type, title, detail, action_label, route, priority}>} タスク配列（優先度順）
 */
export function buildTodayPlan({ srsSummary, weakData, progress, chaptersData, examCountdown }) {
  const tasks = [];

  // 1. SRS復習：今日が期日の問題を最優先で潰す
  if (srsSummary && srsSummary.due_count > 0) {
    tasks.push({
      type: 'srs',
      title: '🔁 今日の復習',
      detail: `${srsSummary.due_count}問が復習期日です。記憶定着に最優先`,
      action_label: '復習を始める',
      route: 'quiz?mode=review',
      priority: 1,
    });
  }

  // 2. 苦手問題：直近で誤答率が高い問題を集中
  const weakIds = getWeakQuestionIds(weakData);
  if (weakIds.length >= 3) {
    tasks.push({
      type: 'weak',
      title: '🎯 苦手問題の集中演習',
      detail: `誤答率50%以上が${weakIds.length}問。10問ピックアップで克服します`,
      action_label: '苦手モードへ',
      route: 'quiz?mode=weak',
      priority: 2,
    });
  }

  // 3. 教科書未読：全節のうち未読割合が高ければ提案する
  const allPageIds = getAllPageIds(chaptersData);
  const readSet = new Set(progress?.pages_read || []);
  const unread = allPageIds.filter((id) => !readSet.has(id));
  if (unread.length > 0 && allPageIds.length > 0) {
    const unreadPct = Math.round((unread.length / allPageIds.length) * 100);
    if (unreadPct >= 20) {
      // 次に読むべき節（先頭の未読）を提案する
      const next = unread[0];
      tasks.push({
        type: 'textbook',
        title: '📖 教科書を進める',
        detail: `未読 ${unread.length}節（${unreadPct}%）。次は ${next} から始めます`,
        action_label: '教科書を開く',
        route: 'textbook',
        priority: 3,
      });
    }
  }

  // 4. 新規問題演習（試験日が設定されていれば日次ノルマを表示）
  if (examCountdown && examCountdown.daily_quota > 0) {
    tasks.push({
      type: 'quota',
      title: '⚡ 今日のノルマ',
      detail: `試験まで${examCountdown.days_left}日 / 1日あたり ${examCountdown.daily_quota}問が必要です`,
      action_label: '4択モードへ',
      route: 'quiz',
      priority: 4,
    });
  }

  // すべての候補がない場合のフォールバック：今日できる演習を案内する
  if (tasks.length === 0) {
    tasks.push({
      type: 'default',
      title: '✨ 今日も少しずつ前進',
      detail: '4択モードで5問だけでも解いてみましょう',
      action_label: '演習を始める',
      route: 'quiz',
      priority: 99,
    });
  }

  // 優先度の昇順で返す
  return tasks.sort((a, b) => a.priority - b.priority);
}

/**
 * 試験日までの残り日数と日次ノルマを計算する（純粋関数）
 *
 * 【日次ノルマの計算】
 * 残り問題数 ÷ 残り日数 を1日あたりの推奨問題数とする。
 * - 試験日が未設定 / 過去 / 当日 → null を返す（カウントダウン非表示）
 * - 残り問題数 = 全問題数 − 既に回答済みの問題数（ユニーク）
 *
 * @param {string|null} examDateStr - 試験日（YYYY-MM-DD）
 * @param {Object} quizResults - ipass_quiz_results のデータ
 * @param {number} totalQuestions - 全問題数
 * @param {Date} [now] - 現在日時
 * @returns {Object|null} { days_left, answered_count, remaining_questions, daily_quota }
 */
export function calcExamCountdown(examDateStr, quizResults, totalQuestions, now = new Date()) {
  if (!examDateStr) return null;

  const examDate = new Date(`${examDateStr}T00:00:00`);
  if (Number.isNaN(examDate.getTime())) return null;

  // 今日0時を基準にする（時刻による誤差を排除）
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.round((examDate.getTime() - today.getTime()) / msPerDay);

  if (daysLeft <= 0) return null;

  // 既に回答した問題のユニーク数
  const answered = new Set();
  const sessions = (quizResults && quizResults.sessions) || [];
  for (const s of sessions) {
    for (const r of (s.results || [])) {
      if (r.question_id) answered.add(r.question_id);
    }
  }

  const answeredCount = answered.size;
  const remaining = Math.max(totalQuestions - answeredCount, 0);
  const dailyQuota = remaining > 0 ? Math.ceil(remaining / daysLeft) : 0;

  return {
    days_left: daysLeft,
    answered_count: answeredCount,
    remaining_questions: remaining,
    daily_quota: dailyQuota,
  };
}
