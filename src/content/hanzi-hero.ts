// 汉字勇者（hanzi-hero）首批静态内容：全部为通用原创任务，未宣称与特定教材版次对齐。
// 审核记录：docs/content-review-hanzi-hero.md（zcode-agent 代理审核，时间见各题 review 字段）。
// 候选字集合（17 字）：天地人金木水火土口耳目手足日月山川，另引入结果字木人休看作干扰/部件。
// 题量：识别 17（逐字一题）+ 图文配对 8 + 偏旁组字 3 = 28。
import type { Exercise } from '../learning/models.js';

const REVIEW = { status: 'approved' as const, reviewer: 'zcode-agent（代理审核）', reviewedAt: '2026-10-27T09:35:00Z' };

const choose = (id: string, target: string, distract: readonly string[], mode: 'shape' | 'meaning' = 'shape'): Exercise => ({
  id,
  subject: 'chinese',
  mappingIds: mode === 'shape' ? ['MAP-001'] : ['MAP-002'],
  gameIds: ['hanzi-hero'],
  task: mode === 'shape'
    ? { kind: 'hanzi-choose', mode, target, options: [target, ...distract] }
    : { kind: 'hanzi-choose', mode, target, image: `img/hanzi-hero/${PICTOGRAM[target] ?? target}.svg`, options: [target, ...distract] },
  review: REVIEW,
});

// 图文配对配图（原创 SVG，随构建交付）；与目标字一一对应。
const PICTOGRAM: Record<string, string> = {
  木: 'tree', 山: 'mountain', 日: 'sun', 月: 'moon', 水: 'river', 火: 'fire', 口: 'mouth', 耳: 'ear',
};

const partImages = { ming: 'img/hanzi-hero/ming.svg', xiu: 'img/hanzi-hero/xiu.svg', kan: 'img/hanzi-hero/kan.svg' } as const;

const parts = (id: string, result: string, parts: readonly [string, string], distract: readonly string[], image: string): Exercise => ({
  id,
  subject: 'chinese',
  mappingIds: ['MAP-002'],
  gameIds: ['hanzi-hero'],
  task: { kind: 'hanzi-parts', result, parts, image, options: [...parts, ...distract] },
  review: REVIEW,
});

export const hanziHeroExercises: readonly Exercise[] = [
  // ===== 汉字识别（17 题，MAP-001，候选集合逐字一题）=====
  choose('HZ-001', '天', ['地', '人', '山']),
  choose('HZ-002', '地', ['天', '土', '川']),
  choose('HZ-003', '人', ['手', '口', '足']),
  choose('HZ-004', '金', ['木', '水', '火']),
  choose('HZ-005', '木', ['水', '火', '土']),
  choose('HZ-006', '水', ['火', '川', '金']),
  choose('HZ-007', '火', ['水', '木', '日']),
  choose('HZ-008', '土', ['地', '金', '山']),
  choose('HZ-009', '口', ['日', '目', '耳']),
  choose('HZ-010', '耳', ['目', '口', '手']),
  choose('HZ-011', '目', ['日', '口', '月']),
  choose('HZ-012', '手', ['足', '耳', '人']),
  choose('HZ-013', '足', ['手', '口', '耳']),
  choose('HZ-014', '山', ['川', '火', '土']),
  choose('HZ-015', '日', ['月', '目', '口']),
  choose('HZ-016', '月', ['日', '耳', '水']),
  choose('HZ-017', '川', ['山', '水', '地']),
  // ===== 图文配对（5 题，MAP-002；仅意象直观的字配图）=====
  choose('HZ-018', '木', ['水', '金', '火'], 'meaning'),
  choose('HZ-019', '山', ['口', '耳', '手'], 'meaning'),
  choose('HZ-020', '日', ['月', '火', '土'], 'meaning'),
  choose('HZ-021', '月', ['日', '水', '金'], 'meaning'),
  choose('HZ-022', '水', ['火', '山', '口'], 'meaning'),
  choose('HZ-023', '火', ['水', '木', '耳'], 'meaning'),
  choose('HZ-024', '口', ['日', '目', '月'], 'meaning'),
  choose('HZ-025', '耳', ['目', '口', '手'], 'meaning'),
  // ===== 偏旁组字（3 题，MAP-002；部件互不相同，选项含 3 个干扰部件）=====
  parts('HZ-026', '明', ['日', '月'], ['口', '木', '手'], partImages.ming),
  parts('HZ-027', '休', ['人', '木'], ['口', '日', '水'], partImages.xiu),
  parts('HZ-028', '看', ['手', '目'], ['口', '月', '火'], partImages.kan),
];
