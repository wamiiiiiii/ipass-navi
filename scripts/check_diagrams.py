"""
図解データ整合性チェッカー

data/diagrams.json の各図解について、
js/utils/diagram.js のレンダラ仕様と一致しているかを検査する。

検出する不整合：
- 未対応の type
- type別の必須フィールド欠落
- セル数・軸数など型固有の論理エラー
- timeline の annotations.from/to がセグメントインデックスの範囲外
- matrix2x2 のセル数が4以外
- cycle のステップ数が4を超過（5以降は描画されないため警告）
- network の firewalls.between インデックスがゾーン範囲外
- 数値フィールドの型ミスマッチ
- color の許可リスト外
"""

import json
from pathlib import Path

# 入力データ
BASE = Path(__file__).resolve().parent.parent
DIAGRAMS_FILE = BASE / "data" / "diagrams.json"

# レンダラに合わせた許可された色
ALLOWED_COLORS = {"blue", "red", "green", "orange", "purple", "yellow", "gray"}

# 重大度
CRITICAL = "CRITICAL"  # 表示が完全に崩れる
HIGH = "HIGH"          # 一部表示が崩れる
MEDIUM = "MEDIUM"      # 軽微な見た目の問題
LOW = "LOW"            # 警告レベル


def add(issues: list, diagram_id: str, severity: str, message: str) -> None:
    """検出した問題を記録する（イミュータブル：既存リストに追加するだけ）"""
    issues.append({"id": diagram_id, "severity": severity, "message": message})


def check_common(did: str, d: dict, issues: list) -> None:
    """type 共通のチェック（title）"""
    if not isinstance(d.get("title", ""), str):
        add(issues, did, MEDIUM, "title が文字列ではない")


def check_color(did: str, color, field: str, issues: list) -> None:
    """color が許可リストに入っているかチェック"""
    if color is None or color == "":
        return
    if color not in ALLOWED_COLORS:
        add(issues, did, LOW, f"{field}: 未対応の色 '{color}'（無視されて装飾なしで表示）")


def check_matrix2x2(did: str, d: dict, issues: list) -> None:
    axes = d.get("axes", {})
    if not isinstance(axes, dict):
        add(issues, did, CRITICAL, "axes がオブジェクトではない")
        return
    x = axes.get("x", [])
    y = axes.get("y", [])
    if not (isinstance(x, list) and len(x) == 2):
        add(issues, did, HIGH, f"axes.x は2要素配列であるべき（現在: {len(x) if isinstance(x, list) else type(x).__name__}）")
    if not (isinstance(y, list) and len(y) == 2):
        add(issues, did, HIGH, f"axes.y は2要素配列であるべき（現在: {len(y) if isinstance(y, list) else type(y).__name__}）")
    cells = d.get("cells", [])
    if not (isinstance(cells, list) and len(cells) == 4):
        add(issues, did, CRITICAL, f"cells は4要素配列であるべき（現在: {len(cells) if isinstance(cells, list) else type(cells).__name__}）")
    for i, cell in enumerate(cells if isinstance(cells, list) else []):
        if not isinstance(cell, dict):
            add(issues, did, HIGH, f"cells[{i}] がオブジェクトではない")
            continue
        check_color(did, cell.get("color"), f"cells[{i}].color", issues)
        items = cell.get("items", [])
        if not isinstance(items, list):
            add(issues, did, MEDIUM, f"cells[{i}].items は配列であるべき")


def check_layer(did: str, d: dict, issues: list) -> None:
    direction = d.get("direction", "bottom-up")
    if direction not in ("bottom-up", "top-down"):
        add(issues, did, LOW, f"direction は 'bottom-up' か 'top-down' であるべき（現在: '{direction}'）")
    layers = d.get("layers", [])
    if not isinstance(layers, list) or len(layers) == 0:
        add(issues, did, CRITICAL, "layers が空")
        return
    for i, layer in enumerate(layers):
        if not isinstance(layer, dict):
            add(issues, did, HIGH, f"layers[{i}] がオブジェクトではない")
            continue
        if "label" not in layer:
            add(issues, did, MEDIUM, f"layers[{i}].label がない")
        check_color(did, layer.get("color"), f"layers[{i}].color", issues)


def check_flow(did: str, d: dict, issues: list) -> None:
    steps = d.get("steps", [])
    if not isinstance(steps, list) or len(steps) == 0:
        add(issues, did, CRITICAL, "steps が空")
        return
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            add(issues, did, HIGH, f"steps[{i}] がオブジェクトではない")
            continue
        if "label" not in step:
            add(issues, did, MEDIUM, f"steps[{i}].label がない")


def check_cycle(did: str, d: dict, issues: list) -> None:
    if "center" not in d:
        add(issues, did, MEDIUM, "center がない（中央ラベルが空）")
    steps = d.get("steps", [])
    if not isinstance(steps, list):
        add(issues, did, CRITICAL, "steps が配列ではない")
        return
    if len(steps) == 0:
        add(issues, did, CRITICAL, "steps が空")
        return
    if len(steps) > 4:
        add(issues, did, HIGH, f"steps が {len(steps)} 件あるが、5件目以降は表示されない（最大4件）")
    if len(steps) < 4:
        # 4未満だと grid-template-areas で空が出る可能性
        add(issues, did, LOW, f"steps が {len(steps)} 件しかない（cycleは4ステップを想定）")


def check_timeline(did: str, d: dict, issues: list) -> None:
    """timeline は M-03-03 で問題が出たので最重要チェック"""
    segments = d.get("segments", [])
    if not isinstance(segments, list) or len(segments) == 0:
        add(issues, did, CRITICAL, "segments が空")
        return
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict):
            add(issues, did, HIGH, f"segments[{i}] がオブジェクトではない")
            continue
        dur = seg.get("duration")
        if not isinstance(dur, (int, float)) or dur <= 0:
            add(issues, did, HIGH, f"segments[{i}].duration が数値でない・または0以下（{dur!r}）")
        check_color(did, seg.get("color"), f"segments[{i}].color", issues)

    # アノテーションのインデックス範囲チェック（M-03-03で起きたバグ）
    annotations = d.get("annotations", [])
    if not isinstance(annotations, list):
        add(issues, did, MEDIUM, "annotations が配列ではない")
        return

    seg_count = len(segments)
    for i, ann in enumerate(annotations):
        if not isinstance(ann, dict):
            add(issues, did, HIGH, f"annotations[{i}] がオブジェクトではない")
            continue
        f = ann.get("from", 0)
        t = ann.get("to", 0)
        # from/to はセグメントのインデックス（slice(from, to)で使われるので 0..seg_count）
        if not isinstance(f, int) or not isinstance(t, int):
            add(issues, did, HIGH, f"annotations[{i}].from/to が整数ではない（from={f!r}, to={t!r}）")
            continue
        if f < 0 or f > seg_count:
            add(issues, did, CRITICAL, f"annotations[{i}].from={f} がセグメント範囲外（0〜{seg_count}）")
        if t < 0 or t > seg_count:
            add(issues, did, CRITICAL, f"annotations[{i}].to={t} がセグメント範囲外（0〜{seg_count}）")
        if f >= t:
            add(issues, did, HIGH, f"annotations[{i}]: from={f} >= to={t}（範囲が空・逆転）")
        pos = ann.get("position", "")
        if pos not in ("above", "below"):
            add(issues, did, MEDIUM, f"annotations[{i}].position は 'above' か 'below' であるべき（現在: '{pos}'）")


def check_compare(did: str, d: dict, issues: list) -> None:
    headers = d.get("headers", [])
    if not isinstance(headers, list) or len(headers) == 0:
        add(issues, did, CRITICAL, "headers が空")
        return
    rows = d.get("rows", [])
    if not isinstance(rows, list) or len(rows) == 0:
        add(issues, did, CRITICAL, "rows が空")
        return
    n_cols = len(headers)
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            add(issues, did, HIGH, f"rows[{i}] がオブジェクトではない")
            continue
        cells = row.get("cells", [])
        if not isinstance(cells, list):
            add(issues, did, HIGH, f"rows[{i}].cells が配列ではない")
            continue
        # 列数不一致は表のずれの典型例（ここが今回の重要検出ポイント）
        if len(cells) != n_cols:
            add(issues, did, HIGH, f"rows[{i}].cells の数 {len(cells)} がヘッダー列数 {n_cols} と一致しない")


def check_tree(did: str, d: dict, issues: list) -> None:
    root = d.get("root")
    if not isinstance(root, dict):
        add(issues, did, CRITICAL, "root がオブジェクトではない")
        return
    # 再帰チェック
    def walk(node, path):
        if not isinstance(node, dict):
            add(issues, did, HIGH, f"{path}: ノードがオブジェクトではない")
            return
        if "label" not in node:
            add(issues, did, MEDIUM, f"{path}: label がない")
        children = node.get("children", [])
        if children is None:
            return
        if not isinstance(children, list):
            add(issues, did, HIGH, f"{path}.children が配列ではない")
            return
        for j, c in enumerate(children):
            walk(c, f"{path}.children[{j}]")
    walk(root, "root")


def check_network(did: str, d: dict, issues: list) -> None:
    zones = d.get("zones", [])
    if not isinstance(zones, list) or len(zones) == 0:
        add(issues, did, CRITICAL, "zones が空")
        return
    for i, z in enumerate(zones):
        if not isinstance(z, dict):
            add(issues, did, HIGH, f"zones[{i}] がオブジェクトではない")
            continue
        check_color(did, z.get("color"), f"zones[{i}].color", issues)

    firewalls = d.get("firewalls", [])
    if not isinstance(firewalls, list):
        add(issues, did, MEDIUM, "firewalls が配列ではない")
        return
    n = len(zones)
    for i, fw in enumerate(firewalls):
        if not isinstance(fw, dict):
            add(issues, did, HIGH, f"firewalls[{i}] がオブジェクトではない")
            continue
        between = fw.get("between", [])
        if not (isinstance(between, list) and len(between) == 2):
            add(issues, did, HIGH, f"firewalls[{i}].between は2要素配列であるべき")
            continue
        a, b = between
        if not (isinstance(a, int) and isinstance(b, int)):
            add(issues, did, HIGH, f"firewalls[{i}].between は整数2つであるべき")
            continue
        # レンダラは a == index かつ b == index + 1 のときだけFWを描画する
        if b != a + 1:
            add(issues, did, HIGH, f"firewalls[{i}].between=[{a},{b}] は連続したインデックスであるべき（描画されない）")
        if a < 0 or b >= n:
            add(issues, did, HIGH, f"firewalls[{i}].between=[{a},{b}] がゾーン範囲外（0〜{n - 1}）")


# type → チェック関数のマップ
CHECKERS = {
    "matrix2x2": check_matrix2x2,
    "layer": check_layer,
    "flow": check_flow,
    "cycle": check_cycle,
    "timeline": check_timeline,
    "compare": check_compare,
    "tree": check_tree,
    "network": check_network,
}


def main() -> int:
    """すべての図解をチェックして結果を出力する"""
    if not DIAGRAMS_FILE.exists():
        print(f"エラー：{DIAGRAMS_FILE} が見つかりません")
        return 1

    raw = json.loads(DIAGRAMS_FILE.read_text(encoding="utf-8"))
    diagrams = raw.get("diagrams", {})

    issues = []

    for did, d in diagrams.items():
        check_common(did, d, issues)
        t = d.get("type")
        if t not in CHECKERS:
            add(issues, did, CRITICAL, f"未対応の type: '{t}'（描画されない）")
            continue
        CHECKERS[t](did, d, issues)

    # 重大度別に集計
    severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    by_sev = {s: [i for i in issues if i["severity"] == s] for s in severities}

    print(f"=== 図解整合性チェック結果 ===")
    print(f"対象: {len(diagrams)} 図解")
    print(f"検出問題: {len(issues)} 件")
    for s in severities:
        print(f"  {s:8s}: {len(by_sev[s])} 件")
    print()

    for s in severities:
        items = by_sev[s]
        if not items:
            continue
        print(f"--- {s} ---")
        for it in items:
            print(f"  [{it['id']}] {it['message']}")
        print()

    # CRITICAL/HIGH があれば終了コード1
    return 1 if (by_sev["CRITICAL"] or by_sev["HIGH"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
