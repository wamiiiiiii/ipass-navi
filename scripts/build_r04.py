#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
令和4年度 実過去問の最終JSON組み立てスクリプト
- parsed_r04.json（parse_kakomon.py出力）を読み込み
- 図表が必要な14問に question_image を付与
- テキスト組合せの5問（画像化不要）は選択肢を正しいテキストに置換
- 解説（expl_r04_batch*.json）をマージ
- questions_past_r04_real.json として出力
"""
import json
from pathlib import Path

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
GEN = DATA / "_gen"

# 図版切り出し済み14問（question_image を付与）
FIGURE_MAP = {
    "P-R04-011": "img/past_r04/q011.png",
    "P-R04-015": "img/past_r04/q015.png",
    "P-R04-028": "img/past_r04/q028.png",
    "P-R04-032": "img/past_r04/q032.png",
    "P-R04-043": "img/past_r04/q043.png",
    "P-R04-050": "img/past_r04/q050.png",
    "P-R04-059": "img/past_r04/q059.png",
    "P-R04-065": "img/past_r04/q065.png",
    "P-R04-078": "img/past_r04/q078.png",
    "P-R04-079": "img/past_r04/q079.png",
    "P-R04-090": "img/past_r04/q090.png",
    "P-R04-096": "img/past_r04/q096.png",
    "P-R04-097": "img/past_r04/q097.png",
    "P-R04-098": "img/past_r04/q098.png",
}

# テキスト組合せ5問（画像化せずテキスト選択肢に変換）
TEXT_CHOICES = {
    "P-R04-051": [
        {"id": "a", "text": "a:経営者　b:システム監査人"},
        {"id": "b", "text": "a:顧客　b:サービスの供給者"},
        {"id": "c", "text": "a:システム開発の発注者　b:システム開発の受託者"},
        {"id": "d", "text": "a:データの分析者　b:データの提供者"},
    ],
    "P-R04-057": [
        {"id": "a", "text": "a:演繹推論　b:成立しないことがある"},
        {"id": "b", "text": "a:演繹推論　b:常に成立する"},
        {"id": "c", "text": "a:帰納推論　b:成立しないことがある"},
        {"id": "d", "text": "a:帰納推論　b:常に成立する"},
    ],
    "P-R04-060": [
        {"id": "a", "text": "a:A社の公開鍵　b:A社の公開鍵"},
        {"id": "b", "text": "a:A社の公開鍵　b:B社の秘密鍵"},
        {"id": "c", "text": "a:B社の公開鍵　b:A社の公開鍵"},
        {"id": "d", "text": "a:B社の公開鍵　b:B社の秘密鍵"},
    ],
    "P-R04-072": [
        {"id": "a", "text": "①可用性　②完全性　③機密性"},
        {"id": "b", "text": "①可用性　②機密性　③完全性"},
        {"id": "c", "text": "①完全性　②可用性　③機密性"},
        {"id": "d", "text": "①完全性　②機密性　③可用性"},
    ],
    "P-R04-088": [
        {"id": "a", "text": "a:CSV　b:JSON"},
        {"id": "b", "text": "a:CSV　b:XML"},
        {"id": "c", "text": "a:RSS　b:JSON"},
        {"id": "d", "text": "a:RSS　b:XML"},
    ],
}


def main():
    parsed = json.loads((GEN / "parsed_r04.json").read_text(encoding="utf-8"))
    questions = parsed["questions"]

    # 解説バッチをマージ
    explanations = {}
    for i in (1, 2, 3, 4):
        f = GEN / f"expl_r04_batch{i}.json"
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
            q["explanation"] = f"{expl}（出典：令和4年度 ITパスポート試験 公開問題 問{qno}）"
        else:
            missing_expl.append(qid)

    out = {
        "version": "1.0",
        "updated_at": "2026-07-05",
        "source_note": "令和4年度 ITパスポート試験 公開問題（IPA）。テキストは過去問道場掲載の転記を基に抽出し、IPA公式PDFと突合。",
        "questions": questions,
    }
    out_path = DATA / "questions_past_r04_real.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"出力完了: {out_path}（{len(questions)}問）")
    if missing_expl:
        print(f"解説未執筆: {len(missing_expl)}問")
        print(missing_expl)


if __name__ == "__main__":
    main()
