/**
 * diagram.js
 * 図解データを受け取ってDOM要素を生成するレンダリングエンジン
 *
 * 【対応する図解タイプ】
 * - matrix2x2 : 2x2マトリクス図（SWOT分析・PPM・リスク分析用）
 * - layer      : 階層積み上げ図（TCP/IP・SaaS/PaaS/IaaS・EA用）
 * - flow       : 横フロー図（開発プロセス・RFI/RFP・監査手順用）
 * - cycle      : 循環図（アジャイル・PDCA・DevOps用）
 * - timeline   : 時間軸図（MTBF/MTTR・ガントチャート用）
 * - compare    : 比較テーブル（知的財産権・記憶装置比較用）
 * - tree       : 木構造図（WBS・ディレクトリ・組織形態用）
 * - network    : ネットワーク構成図（LAN/WAN・DMZ構成用）
 *
 * 【イミュータブル原則】
 * このモジュールは常に新しいDOM要素を返す。
 * 受け取ったデータオブジェクトは変更しない。
 */

import { createElement } from './render.js';

// ============================================================
// メイン：ディスパッチ関数
// ============================================================

/**
 * 図解データを受け取って対応するDOM要素を生成して返す
 * @param {Object} diagramData - 図解の定義データ（typeプロパティで種別を判定）
 * @returns {HTMLElement|null} 生成されたDOM要素。未知のタイプならnullを返す
 */
export function renderDiagram(diagramData) {
  // 入力バリデーション：typeが存在しない場合は何も返さない
  if (!diagramData || typeof diagramData.type !== 'string') {
    console.warn('[diagram.js] 無効な図解データです。typeプロパティが必要です:', diagramData);
    return null;
  }

  // typeに応じた描画関数にディスパッチする
  switch (diagramData.type) {
    case 'matrix2x2':
      return renderMatrix2x2(diagramData);
    case 'layer':
      return renderLayerDiagram(diagramData);
    case 'flow':
      return renderFlowDiagram(diagramData);
    case 'cycle':
      return renderCycleDiagram(diagramData);
    case 'timeline':
      return renderTimelineDiagram(diagramData);
    case 'compare':
      return renderCompareTable(diagramData);
    case 'tree':
      return renderTreeDiagram(diagramData);
    case 'network':
      return renderNetworkDiagram(diagramData);
    default:
      // 未知のタイプはコンソールに警告を出してnullを返す
      console.warn(`[diagram.js] 未対応の図解タイプです: "${diagramData.type}"`);
      return null;
  }
}

// ============================================================
// 共通ヘルパー
// ============================================================

/**
 * 図解カードのラッパーを作成する
 * すべての図解はこのカードにラップして返す
 * @param {string} title - 図解のタイトル
 * @param {HTMLElement} body - 図解本体のDOM要素
 * @returns {HTMLElement} diagram-cardのwrapper要素
 */
function createDiagramCard(title, body) {
  // タイトル要素（空のタイトルは表示しない）
  const children = [];

  if (title && title.trim() !== '') {
    children.push(
      createElement('div', {
        classes: ['diagram-title'],
        text: title,
      })
    );
  }

  children.push(body);

  return createElement('div', {
    classes: ['diagram-card'],
    children,
  });
}

/**
 * 色名をCSSクラス名に変換する
 * 空文字やundefinedが渡されたときのフォールバックを提供する
 * @param {string} color - 色名（'blue' | 'red' | 'green' | 'orange' | 'purple'）
 * @returns {string} CSSクラス名（例: 'diagram-color-blue'）または空文字
 */
function colorClass(color) {
  // 許可された色名のリスト（未知の色名は使わない）
  const allowed = ['blue', 'red', 'green', 'orange', 'purple', 'yellow', 'gray'];
  if (allowed.includes(color)) {
    return `diagram-color-${color}`;
  }
  return '';
}

// ============================================================
// 1-1. renderMatrix2x2 : 2x2マトリクス図
// ============================================================

/**
 * 2x2マトリクス図を生成する（SWOT分析・PPM・リスク分析用）
 *
 * 【レイアウト】
 *   軸ラベル(Y) │ セル[0] │ セル[1]
 *   ─────────────────────────────
 *   軸ラベル(Y) │ セル[2] │ セル[3]
 *               軸ラベル(X) 軸ラベル(X)
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {Object} data.axes - 軸ラベル { x: [string, string], y: [string, string] }
 * @param {Object[]} data.cells - セルの配列（4要素）
 * @returns {HTMLElement} diagram-card要素
 */
function renderMatrix2x2(data) {
  const { title = '', axes = {}, cells = [] } = data;

  // マトリクス全体のラッパー
  const wrapper = createElement('div', { classes: ['diagram-matrix-wrapper'] });

  // ── Y軸ラベル列 + グリッド部分を横並びで配置する ──
  const innerRow = createElement('div', { classes: ['diagram-matrix-inner'] });

  // Y軸ラベル列（上下2つ）
  const yAxisCol = createElement('div', { classes: ['diagram-matrix-y-axis'] });
  const yLabels = axes.y || ['', ''];

  yLabels.forEach((label) => {
    yAxisCol.appendChild(
      createElement('div', {
        classes: ['diagram-matrix-y-label'],
        text: label,
      })
    );
  });

  innerRow.appendChild(yAxisCol);

  // グリッド部分（CSS Grid 2x2）
  const gridArea = createElement('div', { classes: ['diagram-matrix-grid-area'] });

  // X軸ラベル（グリッドの上に表示する）
  const xAxisRow = createElement('div', { classes: ['diagram-matrix-x-axis'] });
  const xLabels = axes.x || ['', ''];

  xLabels.forEach((label) => {
    xAxisRow.appendChild(
      createElement('div', {
        classes: ['diagram-matrix-x-label'],
        text: label,
      })
    );
  });

  gridArea.appendChild(xAxisRow);

  // 2x2 グリッド本体
  const grid = createElement('div', { classes: ['diagram-matrix-grid'] });

  cells.forEach((cell) => {
    const cellEl = createElement('div', {
      // colorClass() が空文字を返す場合はfilterでクラス追加しない（classList.addバグ対策）
      classes: ['diagram-matrix-cell', colorClass(cell.color)].filter(Boolean),
    });

    // セルラベル（例: "S (強み)"）
    cellEl.appendChild(
      createElement('div', {
        classes: ['diagram-cell-label'],
        text: cell.label || '',
      })
    );

    // セルのアイテムリスト
    const itemsEl = createElement('div', { classes: ['diagram-cell-items'] });
    (cell.items || []).forEach((item) => {
      itemsEl.appendChild(
        createElement('div', {
          classes: ['diagram-cell-item'],
          text: item,
        })
      );
    });
    cellEl.appendChild(itemsEl);

    grid.appendChild(cellEl);
  });

  gridArea.appendChild(grid);
  innerRow.appendChild(gridArea);
  wrapper.appendChild(innerRow);

  return createDiagramCard(title, wrapper);
}

// ============================================================
// 1-2. renderLayerDiagram : 階層積み上げ図
// ============================================================

/**
 * 階層積み上げ図を生成する（TCP/IP・SaaS/PaaS/IaaS・EA用）
 *
 * direction = 'bottom-up' のとき、データの先頭要素が最上段になる
 * （表示上は「アプリ→ネットワーク」の順で上から下に並ぶ）
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {string} [data.direction] - 'bottom-up'（デフォルト）または 'top-down'
 * @param {Object[]} data.layers - 層の配列
 * @returns {HTMLElement} diagram-card要素
 */
function renderLayerDiagram(data) {
  const { title = '', direction = 'bottom-up', layers = [] } = data;

  const stack = createElement('div', { classes: ['diagram-layer-stack'] });

  // bottom-up の場合：データ順（先頭=最上段）のまま積み上げる
  // top-down の場合：逆順にする
  const orderedLayers = direction === 'bottom-up' ? [...layers] : [...layers].reverse();

  orderedLayers.forEach((layer) => {
    const layerEl = createElement('div', {
      classes: ['diagram-layer-item', colorClass(layer.color)].filter(Boolean),
    });

    // 層ラベル
    layerEl.appendChild(
      createElement('div', {
        classes: ['diagram-layer-label'],
        text: layer.label || '',
      })
    );

    // 層の内容（プロトコル名など）
    const itemsEl = createElement('div', { classes: ['diagram-layer-items'] });
    (layer.items || []).forEach((item) => {
      itemsEl.appendChild(
        createElement('span', {
          classes: ['diagram-layer-item-text'],
          text: item,
        })
      );
    });
    layerEl.appendChild(itemsEl);

    stack.appendChild(layerEl);
  });

  return createDiagramCard(title, stack);
}

// ============================================================
// 1-3. renderFlowDiagram : 横フロー図
// ============================================================

/**
 * 横フロー図を生成する（開発プロセス・RFI/RFP・監査手順用）
 * 各ステップを「→」矢印で接続して横並びにする
 * スマホでは自動的に折り返す
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {Object[]} data.steps - ステップの配列
 * @returns {HTMLElement} diagram-card要素
 */
function renderFlowDiagram(data) {
  const { title = '', steps = [] } = data;

  const flow = createElement('div', { classes: ['diagram-flow'] });

  steps.forEach((step, index) => {
    // ステップボックス
    const stepEl = createElement('div', { classes: ['diagram-flow-step'] });

    // アイコン（絵文字）
    if (step.icon) {
      stepEl.appendChild(
        createElement('div', {
          classes: ['diagram-flow-icon'],
          text: step.icon,
        })
      );
    }

    // ステップラベル
    stepEl.appendChild(
      createElement('div', {
        classes: ['diagram-flow-label'],
        text: step.label || '',
      })
    );

    flow.appendChild(stepEl);

    // 最後のステップ以外は矢印を追加
    if (index < steps.length - 1) {
      flow.appendChild(
        createElement('div', {
          classes: ['diagram-flow-arrow'],
          text: '→',
        })
      );
    }
  });

  return createDiagramCard(title, flow);
}

// ============================================================
// 1-4. renderCycleDiagram : 循環図
// ============================================================

/**
 * 循環図を生成する（アジャイル・PDCA・DevOps用）
 * 中央にラベル、周囲に4つのステップを配置する
 * CSS Gridの「grid-template-areas」で実現する
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {string} data.center - 中央に表示するラベル
 * @param {Object[]} data.steps - ステップの配列（最大4つ）
 * @returns {HTMLElement} diagram-card要素
 */
function renderCycleDiagram(data) {
  const { title = '', center = '', steps = [] } = data;

  const cycle = createElement('div', { classes: ['diagram-cycle'] });

  // グリッドエリア名の定義（上・右・下・左・中央）
  const areaNames = ['top', 'right', 'bottom', 'left'];

  // 最大4ステップを各エリアに配置する
  steps.slice(0, 4).forEach((step, index) => {
    const areaName = areaNames[index];
    const stepEl = createElement('div', {
      classes: ['diagram-cycle-step', `diagram-cycle-${areaName}`],
    });

    if (step.icon) {
      stepEl.appendChild(
        createElement('div', {
          classes: ['diagram-cycle-icon'],
          text: step.icon,
        })
      );
    }

    stepEl.appendChild(
      createElement('div', {
        classes: ['diagram-cycle-label'],
        text: step.label || '',
      })
    );

    cycle.appendChild(stepEl);
  });

  // 中央エリア（中心ラベル）
  const centerEl = createElement('div', { classes: ['diagram-cycle-center'] });
  centerEl.appendChild(
    createElement('div', {
      classes: ['diagram-cycle-center-label'],
      text: center,
    })
  );
  cycle.appendChild(centerEl);

  return createDiagramCard(title, cycle);
}

// ============================================================
// 1-5. renderTimelineDiagram : 時間軸図
// ============================================================

/**
 * 時間軸図を生成する（MTBF/MTTR・ガントチャート用）
 * セグメントの duration に比例した幅で帯を描画する
 * アノテーション（注釈矢印）で区間の意味を説明する
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {Object[]} data.segments - 時間セグメントの配列 { label, duration, color }
 * @param {Object[]} [data.annotations] - 注釈の配列 { label, from, to, position }
 * @returns {HTMLElement} diagram-card要素
 */
function renderTimelineDiagram(data) {
  const { title = '', segments = [], annotations = [] } = data;

  // 合計の duration を計算してパーセント換算に使用する
  const totalDuration = segments.reduce((sum, seg) => sum + (seg.duration || 0), 0);

  const wrapper = createElement('div', { classes: ['diagram-timeline-wrapper'] });

  // アノテーション（上側）を先に描画する
  const aboveAnnotations = annotations.filter((a) => a.position === 'above');
  if (aboveAnnotations.length > 0) {
    wrapper.appendChild(renderAnnotationRow(aboveAnnotations, segments, totalDuration, 'above'));
  }

  // タイムラインバー本体
  const bar = createElement('div', { classes: ['diagram-timeline-bar'] });

  segments.forEach((seg) => {
    // 幅をパーセントで計算（最小1%で表示崩れを防ぐ）
    const widthPct = totalDuration > 0
      ? Math.max(1, Math.round((seg.duration / totalDuration) * 100))
      : 10;

    const segEl = createElement('div', {
      classes: ['diagram-timeline-seg', colorClass(seg.color)].filter(Boolean),
      attrs: { style: `width: ${widthPct}%` },
    });

    segEl.appendChild(
      createElement('div', {
        classes: ['diagram-timeline-seg-label'],
        text: seg.label || '',
      })
    );

    bar.appendChild(segEl);
  });

  wrapper.appendChild(bar);

  // アノテーション（下側）を描画する
  const belowAnnotations = annotations.filter((a) => a.position === 'below');
  if (belowAnnotations.length > 0) {
    wrapper.appendChild(renderAnnotationRow(belowAnnotations, segments, totalDuration, 'below'));
  }

  return createDiagramCard(title, wrapper);
}

/**
 * タイムラインのアノテーション行を生成する（内部ヘルパー）
 * @param {Object[]} annotations - アノテーションの配列
 * @param {Object[]} segments - セグメント配列（幅計算に使用）
 * @param {number} totalDuration - 合計duration
 * @param {'above'|'below'} position - 表示位置
 * @returns {HTMLElement} アノテーション行要素
 */
function renderAnnotationRow(annotations, segments, totalDuration, position) {
  const row = createElement('div', {
    classes: ['diagram-timeline-annotations', `diagram-annotations-${position}`],
  });

  annotations.forEach((ann) => {
    // from〜toのセグメントの幅の合計を計算する
    const fromIdx = ann.from || 0;
    const toIdx = ann.to || 0;
    const coveredSegments = segments.slice(fromIdx, toIdx);
    const coveredDuration = coveredSegments.reduce((sum, s) => sum + (s.duration || 0), 0);
    const widthPct = totalDuration > 0
      ? Math.max(1, Math.round((coveredDuration / totalDuration) * 100))
      : 10;

    // 開始位置のオフセットを計算する
    const offsetDuration = segments.slice(0, fromIdx).reduce((sum, s) => sum + (s.duration || 0), 0);
    const offsetPct = totalDuration > 0
      ? Math.round((offsetDuration / totalDuration) * 100)
      : 0;

    const annEl = createElement('div', {
      classes: ['diagram-timeline-ann'],
      attrs: { style: `width: ${widthPct}%; margin-left: ${offsetPct}%` },
    });

    annEl.appendChild(
      createElement('div', {
        classes: ['diagram-timeline-ann-label'],
        text: ann.label || '',
      })
    );

    annEl.appendChild(
      createElement('div', {
        classes: ['diagram-timeline-ann-arrow'],
        text: '←────────→',
      })
    );

    row.appendChild(annEl);
  });

  return row;
}

// ============================================================
// 1-6. renderCompareTable : 比較テーブル
// ============================================================

/**
 * 比較テーブルを生成する（知的財産権・記憶装置比較用）
 * スマホ対応の横スクロール可能なテーブル
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {string[]} data.headers - ヘッダー列の配列
 * @param {Object[]} data.rows - 行の配列 { cells: string[], highlight: boolean }
 * @returns {HTMLElement} diagram-card要素
 */
function renderCompareTable(data) {
  const { title = '', headers = [], rows = [] } = data;

  // スクロールラッパー（横スクロール対応）
  const scrollWrapper = createElement('div', { classes: ['diagram-compare-scroll'] });

  const table = createElement('table', { classes: ['diagram-compare-table'] });

  // ヘッダー行を生成する
  const thead = createElement('thead', {});
  const headerRow = createElement('tr', {});

  headers.forEach((header) => {
    headerRow.appendChild(
      createElement('th', {
        classes: ['diagram-compare-th'],
        text: header,
      })
    );
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // データ行を生成する
  const tbody = createElement('tbody', {});

  rows.forEach((row) => {
    const tr = createElement('tr', {
      classes: row.highlight ? ['diagram-compare-row-highlight'] : [],
    });

    (row.cells || []).forEach((cell) => {
      tr.appendChild(
        createElement('td', {
          classes: ['diagram-compare-td'],
          text: cell,
        })
      );
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  scrollWrapper.appendChild(table);

  return createDiagramCard(title, scrollWrapper);
}

// ============================================================
// 1-7. renderTreeDiagram : 木構造図
// ============================================================

/**
 * 木構造図を生成する（WBS・ディレクトリ・組織形態用）
 * CSS Flexboxで縦のツリー構造を再帰的に描画する
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {Object} data.root - ルートノード { label, children }
 * @returns {HTMLElement} diagram-card要素
 */
function renderTreeDiagram(data) {
  const { title = '', root = {} } = data;

  // ルートノードから再帰的にツリーを構築する
  const treeEl = renderTreeNode(root, 0);

  const wrapper = createElement('div', { classes: ['diagram-tree-wrapper'] });
  wrapper.appendChild(treeEl);

  return createDiagramCard(title, wrapper);
}

/**
 * ツリーの1ノードを再帰的にレンダリングする（内部ヘルパー）
 * @param {Object} node - ノードデータ { label, children }
 * @param {number} depth - 現在の深さ（0 = ルート）
 * @returns {HTMLElement} ノード要素
 */
function renderTreeNode(node, depth) {
  const nodeWrapper = createElement('div', { classes: ['diagram-tree-node-wrapper'] });

  // ノードラベルのボックス
  const nodeBox = createElement('div', {
    classes: ['diagram-tree-node', depth === 0 ? 'diagram-tree-node-root' : ''],
    text: node.label || '',
  });
  nodeWrapper.appendChild(nodeBox);

  // 子ノードがある場合は再帰的に追加する
  if (node.children && node.children.length > 0) {
    const childrenContainer = createElement('div', { classes: ['diagram-tree-children'] });

    node.children.forEach((child) => {
      childrenContainer.appendChild(renderTreeNode(child, depth + 1));
    });

    nodeWrapper.appendChild(childrenContainer);
  }

  return nodeWrapper;
}

// ============================================================
// 1-8. renderNetworkDiagram : ネットワーク構成図
// ============================================================

/**
 * ネットワーク構成図を生成する（LAN/WAN・DMZ構成用）
 * 3ゾーンを横に並べ、間にファイアウォールの壁を配置する
 *
 * @param {Object} data - 図解データ
 * @param {string} data.title - 図解タイトル
 * @param {Object[]} data.zones - ゾーンの配列 { label, color, nodes }
 * @param {Object[]} [data.firewalls] - FWの配列 { between: [number, number], label }
 * @returns {HTMLElement} diagram-card要素
 */
function renderNetworkDiagram(data) {
  const { title = '', zones = [], firewalls = [] } = data;

  const networkEl = createElement('div', { classes: ['diagram-network'] });

  zones.forEach((zone, index) => {
    // ゾーンボックス
    const zoneEl = createElement('div', {
      classes: ['diagram-network-zone', colorClass(zone.color)].filter(Boolean),
    });

    // ゾーン名ラベル
    zoneEl.appendChild(
      createElement('div', {
        classes: ['diagram-network-zone-label'],
        text: zone.label || '',
      })
    );

    // ゾーン内のノード（サーバ・クライアント）
    const nodesEl = createElement('div', { classes: ['diagram-network-nodes'] });
    (zone.nodes || []).forEach((nodeName) => {
      nodesEl.appendChild(
        createElement('div', {
          classes: ['diagram-network-node'],
          text: nodeName,
        })
      );
    });
    zoneEl.appendChild(nodesEl);

    networkEl.appendChild(zoneEl);

    // このゾーンと次のゾーンの間にFWが定義されていれば描画する
    const fw = firewalls.find((f) => {
      const [a, b] = f.between || [];
      return a === index && b === index + 1;
    });

    if (fw && index < zones.length - 1) {
      const fwEl = createElement('div', { classes: ['diagram-network-fw'] });
      fwEl.appendChild(
        createElement('div', {
          classes: ['diagram-network-fw-icon'],
          text: '🛡',
        })
      );
      fwEl.appendChild(
        createElement('div', {
          classes: ['diagram-network-fw-label'],
          text: fw.label || 'FW',
        })
      );
      networkEl.appendChild(fwEl);
    }
  });

  return createDiagramCard(title, networkEl);
}
