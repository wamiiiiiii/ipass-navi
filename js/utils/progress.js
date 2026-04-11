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

  // 既読数を数える（配列を変更しない）
  const readCount = pagesRead.filter((id) => allPageIds.includes(id)).length;

  // パーセンテージに変換（小数点以下1桁）
  return Math.round((readCount / allPageIds.length) * 1000) / 10;
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

  const readCount = pagesRead.filter((id) => sectionPageIds.includes(id)).length;

  return Math.round((readCount / sectionPageIds.length) * 1000) / 10;
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
  const readCount = pagesRead.filter((id) => chapterPageIds.includes(id)).length;

  return Math.round((readCount / chapterPageIds.length) * 1000) / 10;
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

  return Math.round((totals.correct / totals.total) * 1000) / 10;
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

  return Math.round((totals.correct / totals.total) * 1000) / 10;
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

  // 今日アプリを開いていれば1日としてカウント
  const today = new Date().toISOString().slice(0, 10);
  activeDays.add(today);

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
    return { level: 'unknown', label: 'データ不足', color: 'gray' };
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
    return { level: 'unknown', label: 'データ不足', color: 'gray' };
  }

  const overallRate = (correct / total) * 100;

  // 分野別足切りチェック（各分野30%以上必要）
  let hasWeakCategory = false;
  Object.values(categoryScores).forEach((cs) => {
    if (cs.total > 0 && (cs.correct / cs.total) < 0.3) {
      hasWeakCategory = true;
    }
  });

  // 判定
  if (overallRate >= 75 && !hasWeakCategory) {
    return { level: 'high', label: '合格圏内', color: 'green' };
  } else if (overallRate >= 60 && !hasWeakCategory) {
    return { level: 'borderline', label: 'あと一歩', color: 'orange' };
  } else if (overallRate >= 45) {
    return { level: 'effort', label: 'もう少し頑張ろう', color: 'yellow' };
  } else {
    return { level: 'low', label: '基礎固めから', color: 'red' };
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
