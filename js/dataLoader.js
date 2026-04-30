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
  // キャッシュに存在する場合はキャッシュから返す（Promiseもキャッシュされる）
  if (_cache.has(path)) {
    return _cache.get(path);
  }

  // Promiseそのものをキャッシュすることで同時リクエストの重複を防止する
  const promise = (async () => {
    try {
      const response = await fetch(path);

      // HTTPエラーのチェック
      if (!response.ok) {
        throw new Error(
          `JSONファイルの取得に失敗しました。\n` +
          `ファイル: ${path}\n` +
          `HTTPステータス: ${response.status}\n` +
          `対処法: ファイルが存在するか、サーバーが起動しているか確認してください。`
        );
      }

      return await response.json();
    } catch (error) {
      // fetchエラー時はキャッシュからPromiseを除去してリトライ可能にする
      _cache.delete(path);

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
  })();

  // Promiseをキャッシュに保存する（解決前でも同一パスの重複リクエストを防ぐ）
  _cache.set(path, promise);

  return promise;
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
 *
 * 内部的には複数の questions*.json ファイルを並行 fetch して統合して返す。
 * - questions.json         : オリジナル問題（メイン）
 * - questions_extra1.json  : オリジナル問題（追加 1）
 * - questions_extra2.json  : オリジナル問題（追加 2）
 * - questions_extra3.json  : 節5問体制（Phase C・節summary_points厳守生成 379問）
 * - questions_past2.json   : 過去問（R02秋・R03春・R04春）
 * - questions_past_r05.json: 過去問（R05春）
 * - questions_past_r06.json: 過去問（R06春）
 *
 * 統合結果は { questions: [...] } 形式で返す（呼び出し側のシグネチャ互換）。
 * 取得済みの統合結果は内部キーでキャッシュし、再取得を防ぐ。
 *
 * @returns {Promise<{questions: Array<Object>, version?: string}>} 統合された問題データ
 */
export async function loadQuestions() {
  // 統合結果用の独立キャッシュキー
  const MERGED_KEY = '__merged_questions__';
  if (_cache.has(MERGED_KEY)) {
    return _cache.get(MERGED_KEY);
  }

  const sources = [
    './data/questions.json',
    './data/questions_extra1.json',
    './data/questions_extra2.json',
    './data/questions_extra3.json',
    './data/questions_past2.json',
    './data/questions_past_r02a.json',
    './data/questions_past_r04s.json',
    './data/questions_past_r05.json',
    './data/questions_past_r06.json',
  ];

  // Promise を先にキャッシュして並行アクセス時の重複fetchを抑止する
  const promise = (async () => {
    // 全ファイルを並行fetch（fetchJsonが内部でキャッシュも担う）
    const settled = await Promise.allSettled(sources.map((p) => fetchJson(p)));

    // 各ファイルから問題配列を取り出して結合する（イミュータブル：新しい配列を作る）
    const merged = [];
    settled.forEach((res, i) => {
      if (res.status !== 'fulfilled') {
        // 1つ失敗しても他は使う。ログだけ残す
        console.warn(`[DataLoader] ${sources[i]} の取得に失敗:`, res.reason?.message);
        return;
      }
      const raw = res.value;
      const arr = Array.isArray(raw) ? raw : (raw.questions || []);
      merged.push(...arr);
    });

    // question_id 重複を排除する（後勝ち：先頭優先で重複は捨てる）
    const seen = new Set();
    const unique = [];
    for (const q of merged) {
      const id = q && q.question_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(q);
    }

    return { questions: unique };
  })();

  _cache.set(MERGED_KEY, promise);
  return promise;
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
 * 節（page_id）で問題を絞り込む
 * 教科書の節単位で「この節の問題を解く」ボタンから演習を開始するために使う
 * @param {Object} questionsData - questions.jsonのデータ
 * @param {string} pageId - 節ID（例: 'T-05-01'）
 * @returns {Object[]} 絞り込んだ問題の配列（イミュータブル）
 */
export function filterQuestionsByPage(questionsData, pageId) {
  if (!questionsData || !questionsData.questions) {
    return [];
  }
  return questionsData.questions.filter(
    (q) => q.related_page_id === pageId
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
 * 問題をシャッフルする（Fisher-Yatesアルゴリズム＋同節分散）
 *
 * 同じ related_page_id の問題が連続しないように後段でリオーダする。
 * これにより「同じような問題が続けて出る」体感を抑える。
 *
 * @param {Object[]} questions - シャッフルする問題の配列
 * @returns {Object[]} シャッフルされた新しい配列（元配列は変更しない）
 */
export function shuffleQuestions(questions) {
  // 1段目: Fisher-Yates でランダム化（イミュータブル）
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 2段目: 同じ related_page_id の問題が連続しないように後段リオーダ
  // 短い配列（5問未満）は元のまま返す（並べ替えても効果が薄い）
  if (shuffled.length < 5) {
    return shuffled;
  }
  return spreadByPage(shuffled);
}

/**
 * 同じ related_page_id が連続しないように並び替える
 *
 * 戦略: 各 page_id ごとにキューを作り、ラウンドロビン的に取り出す。
 * ただし完全なラウンドロビンだと「教科書順」になってしまうので、
 * 各キューから取り出す順序自体もシャッフルしておく。
 *
 * @param {Object[]} questions - 既にシャッフル済みの問題配列
 * @returns {Object[]} 同節連続を抑制した配列
 */
function spreadByPage(questions) {
  // page_id ごとにキューを作る（既にシャッフル済みなのでキュー内はランダム順）
  const queues = new Map();
  for (const q of questions) {
    const pid = q.related_page_id || '__no_page__';
    if (!queues.has(pid)) queues.set(pid, []);
    queues.get(pid).push(q);
  }

  const result = [];
  let prevPage = null;
  while (result.length < questions.length) {
    // 残ってる page_id の候補（直前と異なるものを優先）
    const available = [...queues.entries()].filter(([_, q]) => q.length > 0);
    if (available.length === 0) break;
    // 直前以外を優先、無ければ直前と同じでもOK
    const candidates = available.filter(([pid]) => pid !== prevPage);
    const pool = candidates.length > 0 ? candidates : available;
    // pool 内からランダム選択
    const [pid, queue] = pool[Math.floor(Math.random() * pool.length)];
    result.push(queue.shift());
    prevPage = pid;
  }
  return result;
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

  // 各行に含まれる文字を明示的に列挙する（Unicode範囲比較では濁音・半濁音が漏れるため）
  const kanaRowChars = {
    'あ': 'あいうえお',
    'か': 'かきくけこがぎぐげご',
    'さ': 'さしすせそざじずぜぞ',
    'た': 'たちつてとだぢづでど',
    'な': 'なにぬねの',
    'は': 'はひふへほばびぶべぼぱぴぷぺぽ',
    'ま': 'まみむめも',
    'や': 'やゆよ',
    'ら': 'らりるれろ',
    'わ': 'わをん',
  };

  const chars = kanaRowChars[kanaRow];
  if (!chars) {
    return [...glossaryData.terms];
  }

  return glossaryData.terms.filter((term) => {
    const firstChar = term.reading.charAt(0);
    return chars.includes(firstChar);
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
