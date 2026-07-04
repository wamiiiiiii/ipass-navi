#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
過去問道場のHTMLからITパスポート過去問データ（JSON）を生成するスクリプト

【重要な方針】
- 抽出するのは「問題文・選択肢・正解・分類」のみ。これらはIPA（試験主催者）の
  著作物であり、出典明記により利用が認められている
- サイト独自の「解説文」は著作権保護対象のため一切抽出・転載しない
  （解説はアプリ側で自前作成する。このスクリプトでは空欄にする）
- 図表を含む問題は has_figure フラグを付け、後でIPA公式PDFから切り出す

使い方:
  python3 parse_kakomon.py 08_haru R08 令和8年度
  → data/_gen/parsed_<年度>.json に中間データを出力
"""

import json
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

BASE = Path(__file__).parent.parent / "data"

# ---------------------------------------------------------------
# 過去問道場の中分類名 → アプリの章ID 対応表
# （IPAシラバスの中分類にほぼ準拠している）
# ---------------------------------------------------------------
CHUBUNRUI_TO_CHAPTER = {
    # ストラテジ系
    "企業活動": ("strategy", "S-01"),
    "法務": ("strategy", "S-02"),
    "経営戦略マネジメント": ("strategy", "S-03"),
    "技術戦略マネジメント": ("strategy", "S-04"),
    "ビジネスインダストリ": ("strategy", "S-05"),
    "システム戦略": ("strategy", "S-06"),
    "システム企画": ("strategy", "S-07"),
    # マネジメント系
    "システム開発技術": ("management", "M-01"),
    "ソフトウェア開発管理技術": ("management", "M-02"),
    "プロジェクトマネジメント": ("management", "M-03"),
    "サービスマネジメント": ("management", "M-04"),
    "システム監査": ("management", "M-05"),
    # テクノロジ系
    "基礎理論": ("technology", "T-01"),
    "アルゴリズムとプログラミング": ("technology", "T-02"),
    "コンピュータ構成要素": ("technology", "T-03"),
    "システム構成要素": ("technology", "T-04"),
    "ソフトウェア": ("technology", "T-05"),
    "ハードウェア": ("technology", "T-06"),
    # 新旧シラバスの呼称ゆれに両対応
    "ヒューマンインタフェース": ("technology", "T-07"),
    "情報デザイン": ("technology", "T-07"),
    "マルチメディア": ("technology", "T-08"),
    "情報メディア": ("technology", "T-08"),
    "データベース": ("technology", "T-09"),
    "ネットワーク": ("technology", "T-10"),
    "セキュリティ": ("technology", "T-11"),
}

# 正解の記号 → アプリの選択肢ID
KATAKANA_TO_ID = {"ア": "a", "イ": "b", "ウ": "c", "エ": "d"}


class TextExtractor(HTMLParser):
    """HTML断片からテキストを抽出する（表・画像・リストを検出しつつ整形）"""

    def __init__(self):
        super().__init__()
        self.parts = []          # テキストの断片
        self.has_table = False   # <table> を含むか
        self.has_image = False   # <img> を含むか
        self.list_type = []      # 入れ子対応の <ol type> スタック
        self.li_counters = []    # 各リストの項目番号
        self.in_table = 0        # table入れ子カウント

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.has_table = True
            self.in_table += 1
        elif tag == "img":
            self.has_image = True
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "p":
            self.parts.append("\n")
        elif tag == "ol":
            self.list_type.append(a.get("type", "1"))
            self.li_counters.append(0)
        elif tag == "ul":
            self.list_type.append("・")
            self.li_counters.append(0)
        elif tag == "li":
            if self.li_counters:
                self.li_counters[-1] += 1
                n = self.li_counters[-1]
                t = self.list_type[-1]
                if t == "a":
                    marker = chr(ord("a") + n - 1)  # a, b, c...
                elif t == "・":
                    marker = "・"
                else:
                    marker = str(n) + "."
                self.parts.append(f"\n{marker}　" if t != "・" else "\n・")
        elif tag in ("tr",):
            self.parts.append("\n")
        elif tag in ("td", "th"):
            self.parts.append(" | ")

    def handle_endtag(self, tag):
        if tag == "table":
            self.in_table -= 1
            self.parts.append("\n")
        elif tag in ("ol", "ul"):
            if self.list_type:
                self.list_type.pop()
                self.li_counters.pop()
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)

    def get_text(self):
        text = "".join(self.parts)
        # 連続する空白・改行を整理する（全角スペースは残す）
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r" ?\n ?", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def extract_block(html: str, start_marker: str, end_markers: list) -> str:
    """start_marker から最初に現れる end_marker までのHTML断片を返す"""
    i = html.find(start_marker)
    if i < 0:
        return ""
    j = len(html)
    for m in end_markers:
        k = html.find(m, i + len(start_marker))
        if 0 <= k < j:
            j = k
    return html[i + len(start_marker):j]


def html_to_text(fragment: str):
    """HTML断片 → (テキスト, 表あり, 画像あり)"""
    p = TextExtractor()
    p.feed(fragment)
    return p.get_text(), p.has_table, p.has_image


def parse_question_page(html: str, qno: int, source_prefix: str, source_label: str):
    """1問分のHTMLページから問題データを組み立てる"""

    # --- 問題文（<div id="mondai"> ～ 次のdivまで） ---
    mondai_html = extract_block(html, '<div id="mondai">', ['<div class="ansbg"'])
    question_text, q_table, q_img = html_to_text(mondai_html)

    # --- 選択肢（span id="select_a" 等。ア→a イ→b ウ→c エ→d の順） ---
    choices = []
    c_img = False
    missing = False
    for key, cid in [("select_a", "a"), ("select_i", "b"), ("select_u", "c"), ("select_e", "d")]:
        m = re.search(rf'<span id="{key}">(.*?)</span></li>', html, re.DOTALL)
        if not m:
            missing = True
            break
        text, _t, img = html_to_text(m.group(1))
        c_img = c_img or img
        choices.append({"id": cid, "text": text})

    # 選択肢が1枚の画像にまとまっているパターン（グラフ・図を選ぶ問題）
    # 例: <ul class="selectList "><li><img src="img/55.png">…ア イ ウ エ</li></ul>
    if missing:
        block = extract_block(html, '<ul class="selectList', ["</ul>"])
        if "<img" in block and block.count("selectBtn") >= 4:
            c_img = True
            choices = [
                {"id": "a", "text": "（図のアを参照）"},
                {"id": "b", "text": "（図のイを参照）"},
                {"id": "c", "text": "（図のウを参照）"},
                {"id": "d", "text": "（図のエを参照）"},
            ]
        else:
            return None, "選択肢が見つからない"

    # --- 正解（<span id="answerChar">ア</span>） ---
    m = re.search(r'<span id="answerChar">([アイウエ])</span>', html)
    if not m:
        return None, "正解が見つからない"
    correct = KATAKANA_TO_ID[m.group(1)]

    # --- 分類（ストラテジ系 » 法務 » 知的財産権） ---
    m = re.search(r"<h3>分類 :</h3>\s*<div>(.*?)</div>", html, re.DOTALL)
    category, chapter_id, shoubunrui = "", "", ""
    if m:
        bunrui_text, _, _ = html_to_text(m.group(1))
        parts = [p.strip() for p in re.split(r"»|&raquo;", bunrui_text) if p.strip()]
        if len(parts) >= 2:
            chu = parts[1]
            shoubunrui = parts[2] if len(parts) >= 3 else ""
            if chu in CHUBUNRUI_TO_CHAPTER:
                category, chapter_id = CHUBUNRUI_TO_CHAPTER[chu]
    if not chapter_id:
        return None, f"分類のマッピング失敗: {bunrui_text if m else '分類なし'}"

    q = {
        "question_id": f"P-{source_prefix}-{qno:03d}",
        "chapter_id": chapter_id,
        "category": category,
        "difficulty": 2,
        "source": f"past_{source_prefix}",
        "source_label": f"{source_label}（IPA公開問題）",
        "attribution": f"出典：{source_label} ITパスポート試験 公開問題 問{qno}",
        "question_text": question_text,
        "choices": choices,
        "correct_answer": correct,
        "explanation": "",  # 解説は自前で執筆する（サイトからは転載しない）
        "related_terms": [],
        "tags": [shoubunrui] if shoubunrui else [],
    }
    # 図表を含む問題はフラグを付け、後でIPA公式PDFから画像を切り出す
    if q_table or q_img or c_img:
        q["needs_figure"] = {
            "question_table": q_table,
            "question_image": q_img,
            "choice_image": c_img,
        }
    return q, None


def main():
    if len(sys.argv) != 4:
        print("使い方: python3 parse_kakomon.py <年度dir> <接頭辞> <年度ラベル>")
        print("例:     python3 parse_kakomon.py 08_haru R08 令和8年度")
        sys.exit(1)

    nendo_dir, prefix, label = sys.argv[1], sys.argv[2], sys.argv[3]
    src_dir = BASE / "raw_html" / nendo_dir
    out_dir = BASE / "_gen"
    out_dir.mkdir(exist_ok=True)

    questions, errors = [], []
    files = sorted(src_dir.glob("q*.html"), key=lambda p: int(p.stem[1:]))
    for f in files:
        qno = int(f.stem[1:])
        html = f.read_text(encoding="utf-8", errors="replace")
        q, err = parse_question_page(html, qno, prefix, label)
        if err:
            errors.append(f"問{qno}: {err}")
        else:
            questions.append(q)

    out = {
        "version": "1.0",
        "source_note": f"{label} ITパスポート試験 公開問題（IPA）。テキストは過去問道場掲載の転記を基に抽出し、IPA公式PDFと突合。",
        "questions": questions,
    }
    out_path = out_dir / f"parsed_{prefix.lower()}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    fig_count = sum(1 for q in questions if "needs_figure" in q)
    print(f"変換完了: {len(questions)}問 → {out_path}")
    print(f"図表フラグ付き: {fig_count}問")
    if errors:
        print("== エラー ==")
        for e in errors:
            print(" ", e)


if __name__ == "__main__":
    main()
