"""
過去問PDF → OCR でテキスト抽出するスクリプト

【動作】
1. raw_pdfs/ の指定された問題冊子PDFをページごとに高解像度レンダリング
2. pytesseract で日本語OCR
3. 結果を `data/raw_pdfs/<basename>.ocr.txt` に保存
4. 解答例PDFは pdfplumber でテキスト抽出（OCR不要）

【設計方針】
- OCR は時間がかかるのでファイルキャッシュ。再実行時は既存txtがあればスキップ
- ページごとに区切ってテキスト保存（後処理で問題ごとにパースしやすく）
- イミュータブル：既存ファイルは --force なしでは上書きしない
"""

import argparse
import sys
from pathlib import Path

# 必要なライブラリ
try:
    import fitz  # PyMuPDF
    import pdfplumber
    import pytesseract
    from PIL import Image
    import io
except ImportError as e:
    print(f"必要なライブラリが未インストール: {e}")
    print("実行: python3 -m pip install pymupdf pdfplumber pytesseract Pillow --break-system-packages")
    sys.exit(1)

BASE = Path(__file__).resolve().parent.parent
PDF_DIR = BASE / "data" / "raw_pdfs"


def ocr_question_pdf(pdf_path: Path, force: bool = False, dpi: int = 300) -> Path:
    """問題冊子PDFをOCRしてテキストファイルとして出力する

    Returns:
        出力したテキストファイルのパス
    """
    out_path = pdf_path.with_suffix(".ocr.txt")
    if out_path.exists() and not force:
        print(f"  スキップ（既存）: {out_path.name}")
        return out_path

    print(f"  OCR開始: {pdf_path.name}")
    doc = fitz.open(str(pdf_path))
    n_pages = doc.page_count
    pages_text = []

    for i in range(n_pages):
        page = doc[i]
        # 高解像度でレンダリング（OCR精度のため）
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        img = Image.open(io.BytesIO(img_bytes))
        # psm 6 = 単一の均一なブロックとして扱う
        text = pytesseract.image_to_string(img, lang="jpn", config="--psm 6")
        pages_text.append(f"\n===== PAGE {i + 1} =====\n{text}")
        if (i + 1) % 5 == 0:
            print(f"    {i + 1}/{n_pages} ページ完了")

    doc.close()
    out_path.write_text("\n".join(pages_text), encoding="utf-8")
    print(f"  完了: {out_path.name} ({out_path.stat().st_size} bytes)")
    return out_path


def extract_answers_pdf(pdf_path: Path, force: bool = False) -> Path:
    """解答例PDFをpdfplumberで読んで正解一覧をテキスト出力する"""
    out_path = pdf_path.with_suffix(".ans.txt")
    if out_path.exists() and not force:
        print(f"  スキップ（既存）: {out_path.name}")
        return out_path

    print(f"  解答抽出: {pdf_path.name}")
    with pdfplumber.open(str(pdf_path)) as pdf:
        all_text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    out_path.write_text(all_text, encoding="utf-8")
    print(f"  完了: {out_path.name}")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", help="対象のPDFファイル名（指定なしで全件処理）")
    parser.add_argument("--force", action="store_true", help="既存テキストを上書きする")
    parser.add_argument("--dpi", type=int, default=300, help="OCR用レンダリングDPI")
    args = parser.parse_args()

    if not PDF_DIR.exists():
        print(f"エラー: {PDF_DIR} が見つからない")
        sys.exit(1)

    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    if args.target:
        pdfs = [p for p in pdfs if args.target in p.name]
        if not pdfs:
            print(f"エラー: '{args.target}' に一致するPDFが見つからない")
            sys.exit(1)

    print(f"処理対象: {len(pdfs)} ファイル")
    for p in pdfs:
        if "_ans" in p.stem:
            extract_answers_pdf(p, force=args.force)
        elif "_qs" in p.stem:
            ocr_question_pdf(p, force=args.force, dpi=args.dpi)


if __name__ == "__main__":
    main()
