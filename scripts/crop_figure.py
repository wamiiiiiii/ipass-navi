#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IPA公式PDFのページ画像から図表を切り出すヘルパー

使い方:
  python3 crop_figure.py <ページ画像> <左%> <上%> <右%> <下%> <出力ファイル>
  例: python3 crop_figure.py data/raw_pdfs/ipa/pages_r08/p-03.png 25 21 74 32 img/past_r08/q003.png

座標はページに対する percent（0-100）で指定する。
（表示倍率に依存しないよう比率指定にしている）
切り出し後は白黒はっきりさせるため軽くコントラストを調整し、PNGで保存する。
"""

import sys
from pathlib import Path
from PIL import Image, ImageOps

def main():
    src, l, t, r, b, dst = sys.argv[1:7]
    l, t, r, b = float(l), float(t), float(r), float(b)

    img = Image.open(src)
    w, h = img.size
    # percent → ピクセルに変換して切り出す
    box = (int(w * l / 100), int(h * t / 100), int(w * r / 100), int(h * b / 100))
    cropped = img.crop(box)

    # グレースケール化＋自動コントラストで読みやすくする
    cropped = ImageOps.autocontrast(cropped.convert("L"), cutoff=1)

    out = Path(dst)
    out.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(out, optimize=True)
    print(f"保存: {out} ({cropped.size[0]}x{cropped.size[1]}px)")

if __name__ == "__main__":
    main()
