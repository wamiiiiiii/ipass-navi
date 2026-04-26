"""
解説と正解選択肢の整合性チェックスクリプト

検出するパターン：
1. 解説に「選択肢{正解id}は～」「{正解idのカナ}は～」と書かれている
   → 「選択肢XはCRM、選択肢YはSCM」のように選択肢の対応説明があるとき、
     正解selectionが「これは別物」と説明されているのは矛盾
2. 数値換算問題で解説の数値と正解選択肢の数値が食い違う
3. 正解選択肢textの主要キーワードと解説の主題が乖離する場合（要目視）
"""

import json
import glob
import re
import os
from pathlib import Path

# プロジェクトルート（このスクリプトの親の親）
ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

# id ↔ アイウエの対応
ID_TO_KANA = {"a": "ア", "b": "イ", "c": "ウ", "d": "エ"}


def load_questions(json_path):
    """JSONを読み込み、問題リストを返す"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "questions" in data:
        return data["questions"]
    if isinstance(data, list):
        return data
    return []


def check_explanation_self_reference(q):
    """
    解説内で正解選択肢が「別概念の説明」として言及されている矛盾を検出する。
    例: 正解=a なのに 解説に「選択肢aはCRM、…」と書かれている
        （ITパスポート過去問形式では「アはCRM、イはSCM」のような表記がよく出る）
    """
    issues = []
    ans_id = q.get("correct_answer", "")
    expl = q.get("explanation", "")
    if not ans_id or not expl:
        return issues

    ans_kana = ID_TO_KANA.get(ans_id)

    # パターン1: 「選択肢{id}は」言及
    # 解説の中で「選択肢XはY、選択肢ZはW」のように複数の選択肢を別概念として説明している場合、
    # その中に正解idが含まれていたら矛盾
    pattern1 = re.findall(r"選択肢([abcd])は", expl)
    # 「選択肢a」「選択肢b」など複数列挙されているか確認
    if len(pattern1) >= 2 and ans_id in pattern1:
        issues.append(
            f"解説で『選択肢{ans_id}は～』と別概念扱いされている（正解と矛盾の疑い）"
        )

    # パターン2: 「アは」「イは」など過去問形式の言及
    # 「アはSCM。イはCRM。ウはERP。」のような列挙の中に正解カナがあれば矛盾
    if ans_kana:
        # 解説で複数のカナが言及されているか
        kanas_mentioned = re.findall(r"([アイウエ])は", expl)
        if len(kanas_mentioned) >= 2 and ans_kana in kanas_mentioned:
            issues.append(
                f"解説で『{ans_kana}は～』と別概念扱いされている（正解{ans_id}と矛盾の疑い）"
            )

    return issues


def check_numeric_consistency(q):
    """
    数値換算問題（〇GBは何MB等）で、
    解説に書かれた数値と正解選択肢の数値が食い違わないか検出する。
    """
    issues = []
    ans_id = q.get("correct_answer", "")
    expl = q.get("explanation", "")
    qtext = q.get("question_text", "")

    # 単位換算問題のキーワード
    if not re.search(r"(GB|MB|KB|TB|GiB|MiB|KiB|TiB|バイト|ビット)", qtext):
        return issues
    if "何" not in qtext and "は" not in qtext:
        return issues

    # 正解選択肢のtext
    ans_text = ""
    for c in q.get("choices", []):
        if c.get("id") == ans_id:
            ans_text = c.get("text", "")
            break

    # 解説と正解選択肢の両方に出現する数値（カンマ含む）を抽出
    def extract_numbers(s):
        # 1,024 / 1024 / 100 / 8等の数値抽出
        nums = re.findall(r"[\d,]+", s)
        return [int(n.replace(",", "")) for n in nums if n.replace(",", "").isdigit()]

    expl_nums = set(extract_numbers(expl))
    ans_nums = set(extract_numbers(ans_text))

    # 解説に明示された主要な数値（1024/1000等）が正解選択肢に無く、
    # 別の選択肢にあるなら、選択肢が間違っている可能性
    notable = {1024, 1000, 8, 100, 1073741824, 1000000000}
    expl_notable = expl_nums & notable
    if not expl_notable:
        return issues

    if not (expl_notable & ans_nums):
        # 解説に出る重要な数値が、正解選択肢には無い
        # → 他の選択肢にその数値があれば、その選択肢が真の正解の可能性
        for c in q.get("choices", []):
            if c.get("id") == ans_id:
                continue
            other_nums = set(extract_numbers(c.get("text", "")))
            if expl_notable & other_nums:
                issues.append(
                    f"数値換算：解説の重要数値{sorted(expl_notable & other_nums)}が"
                    f"選択肢{c.get('id')}に存在し、正解選択肢{ans_id}に無い"
                )
                break

    return issues


def main():
    json_files = sorted(DATA_DIR.glob("*.json"))
    # 問題集系のファイルだけ対象（chapters/glossary/diagrams等は除外）
    target_files = [
        f for f in json_files if f.name.startswith("questions") or "past" in f.name
    ]

    total_issues = 0
    print(f"=== 整合性チェック開始：{len(target_files)}ファイル ===\n")

    for f in target_files:
        questions = load_questions(f)
        file_issues = []
        for q in questions:
            qid = q.get("question_id") or q.get("id", "?")
            issues = []
            issues += check_explanation_self_reference(q)
            issues += check_numeric_consistency(q)
            if issues:
                file_issues.append((qid, q, issues))

        if file_issues:
            print(f"\n[{f.name}] : {len(file_issues)}件の疑い")
            for qid, q, issues in file_issues:
                print(f"  ▼ {qid}")
                print(f"    問題: {q.get('question_text','')[:80]}")
                print(f"    正解: {q.get('correct_answer')}")
                for c in q.get("choices", []):
                    mark = "★" if c.get("id") == q.get("correct_answer") else " "
                    print(f"    {mark} {c.get('id')}: {c.get('text','')[:70]}")
                print(f"    解説: {q.get('explanation','')[:200]}")
                for issue in issues:
                    print(f"    ⚠ {issue}")
                total_issues += 1

    print(f"\n=== チェック完了：合計{total_issues}件の疑い ===")


if __name__ == "__main__":
    main()
