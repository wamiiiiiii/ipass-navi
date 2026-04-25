"""
○✗モード用 flashcard_text 一括生成スクリプト

各問題の question_text を ○✗ モードで自然な文に整形して
flashcard_text として追加する。○✗モードに不向きな問題は
flashcard_skip: true でマークする。

【整形方針】
- 「〜として最も適切なものはどれか」→ 「〜として、以下は正しい？」
- 「〜の説明として正しいものはどれか」→ 「〜の説明として、以下は正しい？」
- 「〜に関する記述として正しいものはどれか」→ 「〜に関する記述として、以下は正しい？」

【スキップ対象】
- 否定系（誤っている / 適切でない / 含まれない / 該当しない 等）
- 数値選択型（何時間 / いくつか / 何個 / 何ビット 等）
- 番号参照型（ア〜エ / a〜d / ①〜④ 等）

【イミュータブル原則】
新しいオブジェクトを返す。元の問題データは変更しない。

【使い方】
# サンプル20件を表示してdry-run
python3 scripts/generate_flashcard_text.py --dry-run

# 全ファイルを実際に書き換え（バックアップ作成）
python3 scripts/generate_flashcard_text.py --apply
"""

import argparse
import json
import re
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA_DIR = BASE / "data"
QUESTION_FILES = sorted(DATA_DIR.glob("questions*.json"))

# ============================================================
# スキップ判定（○✗モードで意味が崩れる問題）
# ============================================================

SKIP_PATTERNS = [
    # 否定形（不正解=正しい記述になるため○✗が逆転する）
    (r"誤って(いる|いるもの)", "否定形：誤り選択型"),
    (r"適切で(ない|ないもの)", "否定形：適切でない選択型"),
    (r"正しくないもの", "否定形：正しくない選択型"),
    (r"含まれない", "否定形：含まれない選択型"),
    (r"該当しない", "否定形：該当しない選択型"),
    (r"あてはまらない", "否定形：あてはまらない選択型"),
    (r"不適切な", "否定形：不適切型"),
    # 数値選択型（数値の選択肢を○✗で答えるのは不自然）
    (r"何ビット", "数値選択型"),
    (r"何バイト", "数値選択型"),
    (r"何時間", "数値選択型"),
    (r"何分", "数値選択型"),
    (r"何個", "数値選択型"),
    (r"何種類", "数値選択型"),
    (r"いくつか[。？]?$", "数値選択型"),
    # 番号参照型（ア〜エの組合せを問う形式）
    (r"ア〜[エオカキク]", "番号参照型"),
    (r"a〜[bcde]", "番号参照型"),
    (r"①〜[②③④⑤⑥]", "番号参照型"),
    (r"の組合せ", "組合せ選択型"),
    (r"の組み合わせ", "組合せ選択型"),
    # 計算・算出型（数値や式を求める問題は○✗で答えにくい）
    (r"を求めよ", "計算・算出型"),
    (r"を求めなさい", "計算・算出型"),
    (r"を計算せよ", "計算・算出型"),
    (r"を計算しなさい", "計算・算出型"),
]


def should_skip(question_text: str) -> tuple[bool, str]:
    """○✗モードで使うべきでない問題かを判定する。
    返り値: (スキップすべきか, 理由)
    """
    for pattern, reason in SKIP_PATTERNS:
        if re.search(pattern, question_text):
            return True, reason
    return False, ""


# ============================================================
# 整形ルール（上から順に1つだけ適用される）
# ============================================================

# (正規表現, 置換テンプレート, 説明)
# テンプレート内の \1 などはマッチグループを指す
TRANSFORM_RULES = [
    # 「〜に関する記述として(、)?(最も)?(適切|正しい|妥当)なものはどれか[。？]?」
    (
        r"^(.+?)に関する記述として[、,]?\s*(?:最も)?(?:適切|正しい|妥当)なもの(?:はどれか)?[。？]?$",
        r"\1に関する記述として、以下は正しい？",
        "に関する記述",
    ),
    # 「〜の説明として(、)?(最も)?(適切|正しい|妥当)なものはどれか[。？]?」
    (
        r"^(.+?)の説明として[、,]?\s*(?:最も)?(?:適切|正しい|妥当)なもの(?:はどれか)?[。？]?$",
        r"\1の説明として、以下は正しい？",
        "の説明",
    ),
    # 「〜の特徴として(、)?(最も)?(適切|近い|正しい)もの(はどれか)?[。？]?」
    (
        r"^(.+?)の特徴として[、,]?\s*(?:最も)?(?:適切|近い|正しい|妥当)(?:な)?もの(?:はどれか)?[。？]?$",
        r"\1の特徴として、以下は正しい？",
        "の特徴",
    ),
    # 「〜の目的として(、)?(最も)?(適切|正しい)なものはどれか[。？]?」
    (
        r"^(.+?)の目的として[、,]?\s*(?:最も)?(?:適切|正しい|妥当)なもの(?:はどれか)?[。？]?$",
        r"\1の目的として、以下は正しい？",
        "の目的",
    ),
    # 「〜の役割として(、)?(最も)?(適切|正しい)なものはどれか[。？]?」
    (
        r"^(.+?)の役割として[、,]?\s*(?:最も)?(?:適切|正しい|妥当)なもの(?:はどれか)?[。？]?$",
        r"\1の役割として、以下は正しい？",
        "の役割",
    ),
    # 「〜として(、)?(最も)?(適切|正しい|妥当|近い)なものはどれか[。？]?」（最も汎用）
    (
        r"^(.+?)として[、,]?\s*(?:最も)?(?:適切|正しい|妥当|近い)(?:な)?もの(?:はどれか)?[。？]?$",
        r"\1として、以下は正しい？",
        "〜として",
    ),
    # 「次のうち、〜どれか[。？]?」
    (
        r"^次のうち[、,]?\s*(.+?)(?:はどれか)?[。？]?$",
        r"\1。以下は正しい？",
        "次のうち",
    ),
    # 「以下のうち、〜どれか[。？]?」
    (
        r"^以下のうち[、,]?\s*(.+?)(?:はどれか)?[。？]?$",
        r"\1。以下は正しい？",
        "以下のうち",
    ),
    # シンプルな「〜はどれか[。？]?」
    (
        r"^(.+?)(?:は)?どれか[。？]?$",
        r"\1。以下は正しい？",
        "汎用：〜どれか",
    ),
]


def transform(question_text: str) -> tuple[str, str] | None:
    """問題文を○✗モード用に整形する。
    返り値: (整形後文, 適用ルール名) または None（整形不可＝スキップ対象）
    """
    txt = question_text.strip()
    for pattern, replacement, rule_name in TRANSFORM_RULES:
        new_txt, n = re.subn(pattern, replacement, txt)
        if n > 0:
            return new_txt, rule_name
    # どのルールにもマッチしない問題は整形不可として扱う（呼び出し側でスキップ）
    return None


# ============================================================
# メイン処理
# ============================================================

def process_question(q: dict) -> dict:
    """1問題に flashcard_text / flashcard_skip を付与した新しいオブジェクトを返す（イミュータブル）"""
    qt = q.get("question_text", "")
    skip, reason = should_skip(qt)
    new_q = dict(q)  # 浅いコピー
    if skip:
        new_q["flashcard_skip"] = True
        new_q["flashcard_skip_reason"] = reason
        new_q.pop("flashcard_text", None)
        return new_q

    # 整形を試みる。ルールにマッチしない問題はスキップ扱いにする（安全策）
    result = transform(qt)
    if result is None:
        new_q["flashcard_skip"] = True
        new_q["flashcard_skip_reason"] = "整形ルール非該当（計算/数値/特殊用語型）"
        new_q.pop("flashcard_text", None)
    else:
        new_text, rule = result
        new_q["flashcard_text"] = new_text
        new_q["flashcard_skip"] = False
        new_q["_flashcard_rule"] = rule
    return new_q


def collect_all() -> list[dict]:
    """すべてのquestions*.jsonから問題リストをファイル情報付きで収集する"""
    out = []
    for f in QUESTION_FILES:
        raw = json.loads(f.read_text(encoding="utf-8"))
        qs = raw.get("questions", []) if isinstance(raw, dict) else raw
        for q in qs:
            out.append({"file": f.name, "question": q})
    return out


def show_dry_run(samples_per_rule: int = 3) -> None:
    """整形結果をルール別にサンプル出力する"""
    items = collect_all()
    processed = [{"file": it["file"], "before": it["question"].get("question_text", ""),
                  "result": process_question(it["question"])} for it in items]

    total = len(processed)
    skipped = [p for p in processed if p["result"].get("flashcard_skip")]
    transformed = [p for p in processed if not p["result"].get("flashcard_skip")]

    print(f"=== flashcard_text 生成サマリー ===")
    print(f"全問題: {total}")
    print(f"  ○✗モード対応: {len(transformed)} 件 ({len(transformed) * 100 // total}%)")
    print(f"  ○✗モードからスキップ: {len(skipped)} 件 ({len(skipped) * 100 // total}%)")
    print()

    # スキップ理由の集計
    from collections import Counter
    skip_reasons = Counter(p["result"].get("flashcard_skip_reason", "?") for p in skipped)
    print("--- スキップ理由 ---")
    for r, n in skip_reasons.most_common():
        print(f"  {n:3d} 件 | {r}")
    print()

    # 整形ルールの集計
    rule_count = Counter(p["result"].get("_flashcard_rule", "?") for p in transformed)
    print("--- 整形ルール適用件数 ---")
    for r, n in rule_count.most_common():
        print(f"  {n:4d} 件 | {r}")
    print()

    # ルール別サンプル
    print(f"--- ルール別サンプル（各最大{samples_per_rule}件） ---")
    by_rule: dict[str, list] = {}
    for p in transformed:
        r = p["result"].get("_flashcard_rule", "?")
        by_rule.setdefault(r, []).append(p)
    for r, items in by_rule.items():
        print(f"\n[{r}]")
        for p in items[:samples_per_rule]:
            print(f"  ✏ before: {p['before']}")
            print(f"  ✓ after : {p['result']['flashcard_text']}")
            print()

    # スキップサンプル
    print(f"--- スキップ問題サンプル（最大8件） ---")
    for p in skipped[:8]:
        print(f"  [{p['result']['flashcard_skip_reason']}] {p['before'][:60]}")


def apply_changes() -> None:
    """実際にJSONファイルを書き換える（バックアップを作成する）"""
    for f in QUESTION_FILES:
        raw = json.loads(f.read_text(encoding="utf-8"))
        is_dict = isinstance(raw, dict)
        qs = raw.get("questions", []) if is_dict else raw

        new_qs = []
        for q in qs:
            new_q = process_question(q)
            # メタ情報は削除
            new_q.pop("_flashcard_rule", None)
            new_qs.append(new_q)

        # バックアップ作成
        backup = f.with_suffix(f.suffix + ".bak")
        shutil.copy2(f, backup)

        # 書き戻し
        if is_dict:
            new_raw = dict(raw)
            new_raw["questions"] = new_qs
        else:
            new_raw = new_qs
        f.write_text(json.dumps(new_raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"updated: {f.name}（バックアップ: {backup.name}）")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="JSONファイルを書き換える（バックアップ作成）")
    parser.add_argument("--samples", type=int, default=3, help="ルール別サンプル数")
    args = parser.parse_args()

    if args.apply:
        apply_changes()
        print()
        show_dry_run(samples_per_rule=2)
    else:
        show_dry_run(samples_per_rule=args.samples)


if __name__ == "__main__":
    main()
