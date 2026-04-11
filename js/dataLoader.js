/**
 * dataLoader.js
 * JSONファイルの読み込みとメモリキャッシュを担うモジュール
 * chapters.json / questions.json / glossary.json の取得を一元管理する
 *
 * 【設計方針】
 * - 同一URLのJSONはメモリにキャッシュして2回目以降は再取得しない
 * - Service Workerのキャッシュと二重になるが、メモリキャッシュは高速なため併用する
 * - シラバスバージョンをfetch時に確認し、更新があればlocalStorageを更新する
 */

// メモリキャッシュ（モジュールスコープの変数）
// キー: URL文字列、値: Promiseまたはデータオブジェクト
const _cache = new Map();

/**
 * JSONファイルを取得する（メモリキャッシュ付き）
 * @param {string} path - 取得するJSONの相対パス（例: './data/chapters.json'）
 * @returns {Promise<Object>} パースされたJSONデータ
 * @throws {Error} ファイル取得やパースに失敗した場合
 */
async function fetchJson(path) {
  // キャッシュに存在する場合はキャッシュから返す
  if (_cache.has(path)) {
    return _cache.get(path);
  }

  // Service Workerのキャッシュと干渉しないよう、クエリパラメータは付けない
  // キャッシュの更新はSWのバージョン管理（CACHE_NAME）で行う
  const url = path;

  try {
    const response = await fetch(url);

    // HTTPエラーのチェック
    if (!response.ok) {
      throw new Error(
        `JSONファイルの取得に失敗しました。\n` +
        `ファイル: ${path}\n` +
        `HTTPステータス: ${response.status}\n` +
        `対処法: ファイルが存在するか、サーバーが起動しているか確認してください。`
      );
    }

    const data = await response.json();

    // メモリにキャッシュして次回以降はfetchしない
    _cache.set(path, data);

    return data;
  } catch (error) {
    // fetchエラー（ネットワークエラー・オフラインなど）
    if (error.name === 'TypeError') {
      throw new Error(
        `ネットワーク接続エラーが発生しました。\n` +
        `ファイル: ${path}\n` +
        `原因: オフライン状態またはサーバーが応答していません。\n` +
        `対処法: インターネット接続を確認してください。Service Workerが有効な場合はキャッシュから読み込まれます。`
      );
    }
    throw error;
  }
}

/**
 * 教科書コンテンツデータを取得する
 * @returns {Promise<Object>} chapters.jsonのデータ
 */
export async function loadChapters() {
  return fetchJson('./data/chapters.json');
}

/**
 * 問題データを取得する
 * @returns {Promise<Object>} questions.jsonのデータ
 */
export async function loadQuestions() {
  return fetchJson('./data/questions.json');
}

/**
 * 用語辞書データを取得する
 * @returns {Promise<Object>} glossary.jsonのデータ
 */
export async function loadGlossary() {
  return fetchJson('./data/glossary.json');
}

/**
 * 図解データを取得する
 * diagrams.json に page_id をキーとした図解定義が格納されている
 * @returns {Promise<Object>} diagrams.jsonのデータ
 */
export async function loadDiagrams() {
  return fetchJson('./data/diagrams.json');
}

/**
 * すべてのデータを並行して事前読み込みする
 * アプリ起動時に呼び出してキャッシュを温める
 * @returns {Promise<{chapters: Object, questions: Object, glossary: Object, diagrams: Object}>}
 */
export async function preloadAllData() {
  try {
    // Promise.allで並行読み込み（直列より高速）
    const [chapters, questions, glossary, diagrams] = await Promise.all([
      loadChapters(),
      loadQuestions(),
      loadGlossary(),
      loadDiagrams(),
    ]);

    return { chapters, questions, glossary, diagrams };
  } catch (error) {
    console.error('[DataLoader] データの事前読み込みに失敗しました:', error.message);
    // 失敗しても個別の読み込みは続けられるようにnullを返す（例外は投げない）
    return { chapters: null, questions: null, glossary: null, diagrams: null };
  }
}

/**
 * 章IDで問題を絞り込む
 * @param {Object} questionsData - questions.jsonのデータ
 * @param {string} chapterId - 絞り込む章ID（例: 'S-01'）
 * @returns {Object[]} 絞り込んだ問題の配列
 */
export function filterQuestionsByChapter(questionsData, chapterId) {
  if (!questionsData || !questionsData.questions) {
    return [];
  }

  // filterで新しい配列を返す（元データを変更しない・イミュータブル）
  return questionsData.questions.filter(
    (q) => q.chapter_id === chapterId
  );
}

/**
 * 分野で問題を絞り込む
 * @param {Object} questionsData - questions.jsonのデータ
 * @param {string} category - 絞り込む分野（'strategy' | 'management' | 'technology' | 'all'）
 * @returns {Object[]} 絞り込んだ問題の配列
 */
export function filterQuestionsByCategory(questionsData, category) {
  if (!questionsData || !questionsData.questions) {
    return [];
  }

  if (category === 'all') {
    // 全分野：コピーを返す（元配列は変更しない）
    return [...questionsData.questions];
  }

  return questionsData.questions.filter((q) => q.category === category);
}

/**
 * 苦手問題IDリストで問題を絞り込む
 * @param {Object} questionsData - questions.jsonのデータ
 * @param {string[]} weakIds - 苦手問題IDの配列
 * @returns {Object[]} 苦手問題の配列
 */
export function filterWeakQuestions(questionsData, weakIds) {
  if (!questionsData || !questionsData.questions || weakIds.length === 0) {
    return [];
  }

  const weakIdSet = new Set(weakIds); // 検索をO(1)にするためSetを使用
  return questionsData.questions.filter((q) => weakIdSet.has(q.question_id));
}

/**
 * 問題をシャッフルする（Fisher-Yatesアルゴリズム）
 * @param {Object[]} questions - シャッフルする問題の配列
 * @returns {Object[]} シャッフルされた新しい配列（元配列は変更しない）
 */
export function shuffleQuestions(questions) {
  // スプレッドでコピーしてからシャッフル（イミュータブル）
  const shuffled = [...questions];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // 分割代入でスワップ
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * 用語をIDで検索する
 * @param {Object} glossaryData - glossary.jsonのデータ
 * @param {string} term - 検索する用語名
 * @returns {Object|null} 見つかった用語オブジェクト、なければnull
 */
export function findTermByName(glossaryData, term) {
  if (!glossaryData || !glossaryData.terms) {
    return null;
  }

  return glossaryData.terms.find((t) => t.term === term) || null;
}

/**
 * 用語をフリーワードで検索する（インクリメンタルサーチ用）
 * @param {Object} glossaryData - glossary.jsonのデータ
 * @param {string} query - 検索クエリ
 * @returns {Object[]} マッチした用語の配列
 */
export function searchTerms(glossaryData, query) {
  if (!glossaryData || !glossaryData.terms) {
    return [];
  }

  if (!query || query.trim() === '') {
    return [...glossaryData.terms];
  }

  const lowerQuery = query.toLowerCase().trim();

  return glossaryData.terms.filter((term) => {
    // 用語名・読み仮名・定義文のいずれかに部分一致するか確認
    return (
      term.term.toLowerCase().includes(lowerQuery) ||
      term.reading.includes(lowerQuery) ||
      term.definition.toLowerCase().includes(lowerQuery)
    );
  });
}

/**
 * 用語を50音の行で絞り込む
 * @param {Object} glossaryData - glossary.jsonのデータ
 * @param {string} kanaRow - 行（'あ' | 'か' | 'さ' | ... | 'わ'）
 * @returns {Object[]} 指定した行の用語の配列
 */
export function filterTermsByKanaRow(glossaryData, kanaRow) {
  if (!glossaryData || !glossaryData.terms) {
    return [];
  }

  if (kanaRow === 'all') {
    return [...glossaryData.terms];
  }

  // 各行の範囲を定義（Unicode順序で判定）
  const kanaRanges = {
    'あ': ['あ', 'お'],
    'か': ['か', 'こ'],
    'さ': ['さ', 'そ'],
    'た': ['た', 'と'],
    'な': ['な', 'の'],
    'は': ['は', 'ほ'],
    'ま': ['ま', 'も'],
    'や': ['や', 'よ'],
    'ら': ['ら', 'ろ'],
    'わ': ['わ', 'ん'],
  };

  const range = kanaRanges[kanaRow];
  if (!range) {
    return [...glossaryData.terms];
  }

  return glossaryData.terms.filter((term) => {
    const firstChar = term.reading.charAt(0);
    return firstChar >= range[0] && firstChar <= range[1];
  });
}

/**
 * メモリキャッシュをクリアする（テスト・デバッグ用）
 */
export function clearCache() {
  _cache.clear();
}

/**
 * アプリのバージョン文字列を取得する（キャッシュバスティング用）
 * @returns {string} バージョン文字列
 */
function getAppVersion() {
  // manifest.jsonのバージョンまたはビルド日時を返す
  // 今回はシンプルに日付ベースのバージョンを使用
  return '2026.04';
}
