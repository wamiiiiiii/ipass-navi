#!/bin/bash
# ==============================================================
# ITパスポート過去問道場から問題ページHTMLを取得するスクリプト
# ・問題文・選択肢・正解の抽出元として利用（IPA著作物・出典明記で利用可）
# ・サイト独自の解説はアプリに転載しない（parse側で除外）
# ・サーバー負荷をかけないよう1.5秒間隔で取得する
# 使い方: ./fetch_kakomon.sh 08_haru 100
# ==============================================================
set -eu

NENDO="$1"        # 例: 08_haru（令和8年）
KOSU="$2"         # 問題数（通常100）
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

# 保存先: data/raw_html/<年度>/
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$BASE_DIR/data/raw_html/$NENDO"
mkdir -p "$OUT_DIR"

for i in $(seq 1 "$KOSU"); do
  OUT="$OUT_DIR/q$i.html"
  # 取得済みならスキップ（再実行しても二重取得しない）
  if [ -s "$OUT" ]; then
    continue
  fi
  curl -sS -A "$UA" "https://www.itpassportsiken.com/kakomon/$NENDO/q$i.html" -o "$OUT"
  echo "取得: $NENDO q$i"
  sleep 1.5
done

echo "完了: $OUT_DIR に $(ls "$OUT_DIR" | wc -l | tr -d ' ') ファイル"
