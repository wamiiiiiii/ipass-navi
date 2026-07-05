#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
令和3年度 実過去問の最終JSON組み立てスクリプト
- parsed_r03.json（parse_kakomon.py出力）を読み込み
- 図表が必要な5問に question_image を付与
- テキスト組合せの4問（画像化不要）は選択肢を正しいテキストに置換
- 解説（expl_r03_batch*.json）をマージ
- questions_past_r03_real.json として出力
"""
import json
from pathlib import Path

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
GEN = DATA / "_gen"

# 図版切り出し済み5問（question_image を付与）
FIGURE_MAP = {
    "P-R03-028": "img/past_r03/q028.png",
    "P-R03-050": "img/past_r03/q050.png",
    "P-R03-070": "img/past_r03/q070.png",
    "P-R03-074": "img/past_r03/q074.png",
    "P-R03-095": "img/past_r03/q095.png",
}

# テキスト組合せ4問（画像化せずテキスト選択肢に変換）
TEXT_CHOICES = {
    "P-R03-038": [
        {"id": "a", "text": "a:監査計画　b:結合テスト，システムテスト，運用テスト"},
        {"id": "b", "text": "a:監査計画　b:予備調査，本調査，評価・結論"},
        {"id": "c", "text": "a:法令　b:結合テスト，システムテスト，運用テスト"},
        {"id": "d", "text": "a:法令　b:予備調査，本調査，評価・結論"},
    ],
    "P-R03-067": [
        {"id": "a", "text": "a:可用性　b:信頼性"},
        {"id": "b", "text": "a:可用性　b:保守性"},
        {"id": "c", "text": "a:保全性　b:信頼性"},
        {"id": "d", "text": "a:保全性　b:保守性"},
    ],
    "P-R03-069": [
        {"id": "a", "text": "a:他人受入率　b:本人拒否率"},
        {"id": "b", "text": "a:他人受入率　b:未対応率"},
        {"id": "c", "text": "a:本人拒否率　b:他人受入率"},
        {"id": "d", "text": "a:未対応率　b:本人拒否率"},
    ],
    "P-R03-089": [
        {"id": "a", "text": "a:アナログ　b:ディジタル　c:アナログ"},
        {"id": "b", "text": "a:アナログ　b:ディジタル　c:ディジタル"},
        {"id": "c", "text": "a:ディジタル　b:アナログ　c:アナログ"},
        {"id": "d", "text": "a:ディジタル　b:アナログ　c:ディジタル"},
    ],
}


def main():
    parsed = json.loads((GEN / "parsed_r03.json").read_text(encoding="utf-8"))
    questions = parsed["questions"]

    explanations = {}
    for i in (1, 2, 3, 4):
        f = GEN / f"expl_r03_batch{i}.json"
        if f.exists():
            explanations.update(json.loads(f.read_text(encoding="utf-8")))

    missing_expl = []
    for q in questions:
        qid = q["question_id"]
        if qid in FIGURE_MAP:
            q["question_image"] = FIGURE_MAP[qid]
        if qid in TEXT_CHOICES:
            q["choices"] = TEXT_CHOICES[qid]
        q["is_real_past"] = True
        if qid in explanations:
            expl = explanations[qid]
            qno = int(qid.split("-")[-1])
            q["explanation"] = f"{expl}（出典：令和3年度 ITパスポート試験 公開問題 問{qno}）"
        else:
            missing_expl.append(qid)

    out = {
        "version": "1.0",
        "updated_at": "2026-07-05",
        "source_note": "令和3年度 ITパスポート試験 公開問題（IPA）。テキストは過去問道場掲載の転記を基に抽出し、IPA公式PDFと突合。",
        "questions": questions,
    }
    out_path = DATA / "questions_past_r03_real.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"出力完了: {out_path}（{len(questions)}問）")
    if missing_expl:
        print(f"解説未執筆: {len(missing_expl)}問")
        print(missing_expl)


if __name__ == "__main__":
    main()
