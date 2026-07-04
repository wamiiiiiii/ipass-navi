#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
問題文・選択肢から略語の正式名称・読み併記を削除するスクリプト

背景（2026-07-04 本番不合格の反省）:
  アプリでは「DX（デジタルトランスフォーメーション）」のように略語へ
  正式名称・読みを併記していたが、本番の試験では「DX」とだけ出題される。
  併記に頼って「読みから意味を逆算する」学習法が本番で通用しなかったため、
  全モードで併記を削除し、本番と同じ表記に統一する。

対象: AI生成問題ファイル（questions*.json のうち R08実過去問を除く）
      question_text / choices[].text / flashcard_text
除外: explanation（解説では正式名称の説明を残してよい）
      questions_past_r08.json（IPA原文ママを維持する）

使い方:
  python3 remove_abbr_annotations.py          # ドライラン（変更内容の表示のみ）
  python3 remove_abbr_annotations.py --apply  # 実際に書き換える
"""

import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent / "data"

# 対象ファイル（実過去問 r08 は原文ママなので含めない）
TARGET_FILES = [
    "questions.json",
    "questions_extra1.json",
    "questions_extra2.json",
    "questions_extra3.json",
    "questions_past2.json",
    "questions_past_r02a.json",
    "questions_past_r04s.json",
    "questions_past_r05.json",
    "questions_past_r06.json",
]

# 略語（英数字の連なり）の直後に続く全角括弧の併記を検出する
# 例: DX（デジタルトランスフォーメーション） / ROI（投資対効果） / SaaS（サース）
#    Society5.0（超スマート社会） / Wi-Fi（ワイファイ）
# ・括弧の中身は50文字まで（長い説明文を巻き込まない保険）
# ・半角括弧は数式 IF(A1+B1) などで使われるため対象にしない
ABBR_PATTERN = re.compile(
    r"([A-Za-z][A-Za-z0-9.+/\-]{0,14})（[^（）]{1,50}）"
)

# 削除してはいけない例外（括弧が「読み・正式名称の併記」ではなく実質的な情報のもの）
# ・クラスA（プライベートアドレス）: 併記を消すと問題の意味が変わる（クラスA全体の範囲≠プライベート範囲）
# ・上位A（約20%）: ABC分析の説明で割合が本質的な情報
# ・Android（全体）: 製品の範囲を示す注記で読み併記ではない
EXCLUDE_EXACT = {
    "A（プライベートアドレス）",
    "A（約20%）",
    "Android（全体）",
}


def clean_text(text: str, log: list, where: str) -> str:
    """テキストから略語併記を削除する（削除内容はlogに記録）"""
    def repl(m):
        # 例外リストに載っているものは削除しない（実質的な情報を含む括弧）
        if m.group(0) in EXCLUDE_EXACT:
            return m.group(0)
        log.append(f"    {where}: {m.group(0)} → {m.group(1)}")
        return m.group(1)
    return ABBR_PATTERN.sub(repl, text)


def main():
    apply_mode = "--apply" in sys.argv
    total = 0

    for fname in TARGET_FILES:
        path = BASE / fname
        data = json.loads(path.read_text(encoding="utf-8"))
        questions = data["questions"] if isinstance(data, dict) else data

        file_log = []
        for q in questions:
            qlog = []
            q["question_text"] = clean_text(q.get("question_text", ""), qlog, "問題文")
            if q.get("flashcard_text"):
                q["flashcard_text"] = clean_text(q["flashcard_text"], qlog, "○✗文")
            for c in q.get("choices", []):
                c["text"] = clean_text(c.get("text", ""), qlog, f"選択肢{c['id']}")
            if qlog:
                file_log.append(f"  {q['question_id']}")
                file_log.extend(qlog)

        n = sum(1 for line in file_log if line.startswith("    "))
        total += n
        print(f"{fname}: {n}箇所")
        for line in file_log:
            print(line)

        if apply_mode and n > 0:
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
            )

    mode = "適用済み" if apply_mode else "ドライラン（--apply で書き換え）"
    print(f"\n合計 {total}箇所 [{mode}]")


if __name__ == "__main__":
    main()
