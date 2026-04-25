"""
過去問JSON化のための雛形スクリプト

使い方：
1. data/raw_pdfs/ に IPA公式の過去問PDFを配置する
   推奨ファイル名:
     - R02_autumn.pdf  (R02 秋期 後半50問用)
     - R04_spring.pdf  (R04 春期 後半50問用)
     - R01_autumn.pdf  (R01 秋期 100問)
     - H31_spring.pdf  (H31 春期 100問)
     - H30_autumn.pdf  (H30 秋期 100問)

2. このスクリプトを実行すると、PDFの存在チェックと
   JSON出力先ファイルの初期化（空テンプレート作成）を行う。

3. 実際の問題JSON化は Claude Code セッション内で
   PDFを読み込んでから対話的に行う（このスクリプトは下準備のみ）。

【イミュータブル原則】
- 既存のJSONファイルを上書きしない（バックアップを作る）
- 新規作成時のみテンプレートを書き込む
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
PDF_DIR = BASE / "data" / "raw_pdfs"
DATA_DIR = BASE / "data"

# 各PDFが対応する出力ファイル・source識別子・年度ラベル
TARGETS = [
    {
        "pdf": "R02_autumn.pdf",
        "json": "questions_past_r02a_b.json",
        "source": "past_R02_autumn",
        "label": "令和2年度 秋期",
        "id_prefix": "P-R02A",
        "id_range": (51, 100),  # 既存 questions_past2.json に R02A_001-050 があるので残り
    },
    {
        "pdf": "R04_spring.pdf",
        "json": "questions_past_r04s_b.json",
        "source": "past_R04_spring",
        "label": "令和4年度 公開問題",
        "id_prefix": "P-R04S",
        "id_range": (1, 50),  # 既存 questions_past2.json に R04S_051-100 があるので前半
    },
    {
        "pdf": "R01_autumn.pdf",
        "json": "questions_past_r01a.json",
        "source": "past_R01_autumn",
        "label": "令和元年度 秋期",
        "id_prefix": "P-R01A",
        "id_range": (1, 100),
    },
    {
        "pdf": "H31_spring.pdf",
        "json": "questions_past_h31s.json",
        "source": "past_H31_spring",
        "label": "平成31年度 春期",
        "id_prefix": "P-H31S",
        "id_range": (1, 100),
    },
    {
        "pdf": "H30_autumn.pdf",
        "json": "questions_past_h30a.json",
        "source": "past_H30_autumn",
        "label": "平成30年度 秋期",
        "id_prefix": "P-H30A",
        "id_range": (1, 100),
    },
]


def check_pdfs() -> list[dict]:
    """配置済みのPDFと未配置のPDFを区別して返す"""
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    placed = []
    missing = []
    for t in TARGETS:
        pdf_path = PDF_DIR / t["pdf"]
        if pdf_path.exists() and pdf_path.stat().st_size > 0:
            placed.append({**t, "pdf_path": pdf_path})
        else:
            missing.append({**t, "pdf_path": pdf_path})
    return placed, missing


def init_output_template(target: dict) -> Path:
    """出力先JSONを空テンプレートで初期化する（既存があれば上書きしない）"""
    out = DATA_DIR / target["json"]
    if out.exists():
        return out  # 既存ファイルは触らない
    template = {
        "schema_version": 1,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "source": target["source"],
        "source_label": target["label"],
        "questions": [],  # ここに問題を追加していく
    }
    out.write_text(json.dumps(template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def main() -> None:
    placed, missing = check_pdfs()

    print("=" * 60)
    print("過去問PDF配置状況")
    print("=" * 60)
    print(f"配置済み: {len(placed)} / {len(placed) + len(missing)}")
    print()

    if placed:
        print("[配置済み] 以下のPDFは Claude Code セッションで読み込み可能：")
        for t in placed:
            print(f"  ✓ {t['pdf']:<25} → {t['json']:<35}  ({t['label']})")
        print()

    if missing:
        print("[未配置] 以下のPDFをIPA公式からダウンロードして配置してください：")
        print("  ダウンロード先: https://www3.jitec.ipa.go.jp/JitesCbt/html/openinfo/questions.html")
        print(f"  配置場所: {PDF_DIR.resolve()}")
        print()
        for t in missing:
            print(f"  ✗ {t['pdf']:<25}  ({t['label']})")
        print()

    # 出力JSONテンプレートの初期化（配置済みPDFのみ）
    if placed:
        print("--- 出力JSONテンプレートの初期化 ---")
        for t in placed:
            out = init_output_template(t)
            existing_count = 0
            try:
                data = json.loads(out.read_text(encoding="utf-8"))
                existing_count = len(data.get("questions", []))
            except Exception:
                pass
            status = "新規作成" if existing_count == 0 else f"既存（{existing_count}問）"
            print(f"  {out.name}: {status}")
        print()

    print("【次のステップ】")
    print("配置済みPDFがあれば、Claude Code セッションで以下を依頼してください：")
    print("  「raw_pdfs/<ファイル名> を読み込んで、問題を <出力JSON> に追記して」")


if __name__ == "__main__":
    main()
