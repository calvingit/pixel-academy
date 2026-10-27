#!/bin/bash
# M9 拼音冒险 · 发音音频生成脚本（docs/m9-audio-prep.md 方案 A，2026-10-27 用户决策）。
# 链路：say（macOS 婷婷 zh_CN）→ AIFF → afconvert（16-bit / 22050 Hz / 单声道 WAV）
#       → web/audio/pinyin/<文件名>.wav（随构建入库 + SW 预缓存，断网可播）。
#
# ===== 发音映射表（音频文件名 → TTS 输入文本；本表即发音口径的可审计记录）=====
# 口径依据：声母用呼读音、韵母按整体读音直读，为通用拼音教学惯例的整理；
# 未经教师核验，发音正确性属真人试听缺口（审核记录 docs/content-review-pinyin.md）。
# 近似处理（如实标注）：
# - ü    → yu  ：TTS 无 ü 的单音直读，用整体读音 yu 近似；
# - üe   → yue ：同上，用整体读音近似；
# - ün   → yun ：同上；
# - ui   → uei ：实际读音为 u→ei 滑音，用全拼形式 uei 保证滑动过程完整；
# - iu   → iou ：实际读音为 i→ou 滑音，用全拼形式 iou 保证滑动过程完整；
# - un   → uen ：实际读音为 u→en 滑音，用全拼形式 uen 保证滑动过程完整。
# 文件名约定：字母本身，ü/üe/ün 无 ASCII 文件名，按拼音输入惯例用 v/ve/vn，
# 避免非 ASCII URL 与 SW 缓存匹配的边缘问题（内容侧映射见 src/content/pinyin-exercises.ts）。
#
# 用法：scripts/gen-pinyin-audio.sh（可重复执行，覆盖再生成；需 macOS + say/afconvert）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/web/audio/pinyin"
VOICE="Tingting"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 条目格式：类别|字母|文件名（不含扩展名）|TTS 输入文本
ENTRIES=(
  # ---- 声母 23（呼读音）----
  "initial|b|b|bo"
  "initial|p|p|po"
  "initial|m|m|mo"
  "initial|f|f|fo"
  "initial|d|d|de"
  "initial|t|t|te"
  "initial|n|n|ne"
  "initial|l|l|le"
  "initial|g|g|ge"
  "initial|k|k|ke"
  "initial|h|h|he"
  "initial|j|j|ji"
  "initial|q|q|qi"
  "initial|x|x|xi"
  "initial|zh|zh|zhi"
  "initial|ch|ch|chi"
  "initial|sh|sh|shi"
  "initial|r|r|ri"
  "initial|z|z|zi"
  "initial|c|c|ci"
  "initial|s|s|si"
  "initial|y|y|yi"
  "initial|w|w|wu"
  # ---- 单韵母 6（直读；ü 用 yu 近似）----
  "final|a|a|a"
  "final|o|o|o"
  "final|e|e|e"
  "final|i|i|i"
  "final|u|u|u"
  "final|ü|v|yu"
  # ---- 复韵母 9（整体读音直读；ui/iu 用全拼形式保证滑音；üe 用 yue 近似）----
  "final|ai|ai|ai"
  "final|ei|ei|ei"
  "final|ui|ui|uei"
  "final|ao|ao|ao"
  "final|ou|ou|ou"
  "final|iu|iu|iou"
  "final|ie|ie|ie"
  "final|üe|ve|yue"
  "final|er|er|er"
  # ---- 鼻韵母 9（整体读音直读；un 用全拼形式 uen 保证滑音；ün 用 yun 近似）----
  "final|an|an|an"
  "final|en|en|en"
  "final|in|in|in"
  "final|un|un|uen"
  "final|ün|vn|yun"
  "final|ang|ang|ang"
  "final|eng|eng|eng"
  "final|ing|ing|ing"
  "final|ong|ong|ong"
)

mkdir -p "$OUT_DIR"

fail=0
printf '%-4s %-6s %-8s %-10s %-9s %s\n' '字母' '文件' '时长(s)' '体积(B)' '下限0.15s' '结果'
for entry in "${ENTRIES[@]}"; do
  IFS='|' read -r category letter file text <<< "$entry"
  aiff="$TMP_DIR/$file.aiff"
  wav="$OUT_DIR/$file.wav"

  say -v "$VOICE" "$text" -o "$aiff"
  afconvert -f WAVE -d LEI16@22050 -c 1 "$aiff" "$wav"

  # 逐条校验：文件存在非空、时长 > 0.15s、体积在合理区间（单音节 16bit/22.05kHz 单声道）。
  if [ ! -s "$wav" ]; then
    printf '%-4s %-6s %-8s %-10s %-9s %s\n' "$letter" "$file.wav" '-' '-' '-' '失败：文件缺失或为空'
    fail=1
    continue
  fi
  duration="$(afinfo "$wav" | awk -F': ' '/estimated duration/ {print $2; exit}')"
  size="$(stat -f%z "$wav")"
  ok="$(awk -v d="$duration" -v s="$size" 'BEGIN { print (d > 0.15 && s >= 1000 && s <= 200000) ? "通过" : "失败：超界" }')"
  printf '%-4s %-6s %-8s %-10s %-9s %s\n' "$letter" "$file.wav" "$duration" "$size" '-' "$ok"
  [ "$ok" = "通过" ] || fail=1
done

# 清单核对：应生成 47 条，输出目录内不得缺漏或多出 WAV。
expected="$(printf '%s\n' "${ENTRIES[@]}" | wc -l | tr -d ' ')"
actual="$(find "$OUT_DIR" -maxdepth 1 -name '*.wav' | wc -l | tr -d ' ')"
echo "----"
echo "映射表条目：${expected}；输出目录 WAV：${actual}"
if [ "$expected" != "47" ] || [ "$actual" != "$expected" ]; then
  echo "清单核对失败：条目数或产物数与 47 不一致"
  fail=1
fi
for entry in "${ENTRIES[@]}"; do
  IFS='|' read -r _category _letter file _text <<< "$entry"
  if [ ! -s "$OUT_DIR/$file.wav" ]; then
    echo "清单核对失败：缺少 $file.wav"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "结果：存在失败条目，请核对上方清单"
  exit 1
fi
echo "结果：47 条发音音频全部生成并通过校验（${OUT_DIR}）"
