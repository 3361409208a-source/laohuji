import type { SymbolId } from './types';

// ────────────────────────────────────────────────────────────────────────────
// 虚拟卷轴条带 (Virtual Reel Strips)
//
// 真实赌场原理:
//   每个卷轴有 N 个"虚拟停止位"，RNG 从 [0, N) 随机选一个停止位。
//   停止位越多的图符，出现概率越高 → 这决定了 RTP。
//
//   卷轴3（中间）的高价值图符略多 → 增加命中率，营造"差一点就赢了"的感觉。
//   WILD 仅出现在卷轴 2、3、4 → 经典"散野不在边柱"设计。
//   SCATTER 均匀分布于所有卷轴 → 保证有效触发几率。
//
// 目标 RTP ≈ 96%  (通过赔付表乘以各组合概率计算)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 构建卷轴条带辅助函数。
 * counts: 每种图符在该卷轴上出现的次数
 * 总停止位数 = sum(counts)
 */
function buildStrip(counts: Partial<Record<SymbolId, number>>): SymbolId[] {
  const order: SymbolId[] = [
    'WILD', 'SEVEN', 'DIAMOND', 'BELL', 'STAR',
    'CHERRY', 'LEMON', 'ORANGE', 'GRAPE', 'SCATTER',
  ];
  const strip: SymbolId[] = [];
  for (const sym of order) {
    const n = counts[sym] ?? 0;
    for (let i = 0; i < n; i++) strip.push(sym);
  }
  return strip;
}

// ─── 卷轴1 (左) —— 64 停止位 ───────────────────────────────────────────────
// 特点：没有 WILD，高价值少，低价值多 → 配合 WILD 在中间提升趣味
const STRIP_R1: SymbolId[] = buildStrip({
  WILD:    0,
  SEVEN:   1,
  DIAMOND: 2,
  BELL:    3,
  STAR:    4,
  CHERRY:  6,
  LEMON:   8,
  ORANGE:  10,
  GRAPE:   27,
  SCATTER: 3,
}); // total = 0+1+2+3+4+6+8+10+27+3 = 64

// ─── 卷轴2 ────────────────────────────────────────────────────────────────
const STRIP_R2: SymbolId[] = buildStrip({
  WILD:    0,
  SEVEN:   1,
  DIAMOND: 2,
  BELL:    3,
  STAR:    5,
  CHERRY:  6,
  LEMON:   8,
  ORANGE:  10,
  GRAPE:   26,
  SCATTER: 3,
}); // total = 0+1+2+3+5+6+8+10+26+3 = 64

// ─── 卷轴3 (中央，"甜柱") ──────────────────────────────────────────────────
// WILD 较多，高价值图符略多 → 制造大赢概率，营造兴奋感
const STRIP_R3: SymbolId[] = buildStrip({
  WILD:    3,
  SEVEN:   2,
  DIAMOND: 3,
  BELL:    4,
  STAR:    5,
  CHERRY:  6,
  LEMON:   7,
  ORANGE:  9,
  GRAPE:   22,
  SCATTER: 3,
}); // total = 3+2+3+4+5+6+7+9+22+3 = 64

// ─── 卷轴4 ────────────────────────────────────────────────────────────────
const STRIP_R4: SymbolId[] = buildStrip({
  WILD:    2,
  SEVEN:   1,
  DIAMOND: 2,
  BELL:    3,
  STAR:    5,
  CHERRY:  6,
  LEMON:   8,
  ORANGE:  10,
  GRAPE:   24,
  SCATTER: 3,
}); // total = 2+1+2+3+5+6+8+10+24+3 = 64

// ─── 卷轴5 (右) ───────────────────────────────────────────────────────────
// 对称于卷轴1，略有 WILD
const STRIP_R5: SymbolId[] = buildStrip({
  WILD:    2,
  SEVEN:   1,
  DIAMOND: 2,
  BELL:    3,
  STAR:    4,
  CHERRY:  6,
  LEMON:   8,
  ORANGE:  10,
  GRAPE:   25,
  SCATTER: 3,
}); // total = 2+1+2+3+4+6+8+10+25+3 = 64

/** 所有卷轴条带，索引0-4对应卷轴1-5 */
export const REEL_STRIPS: SymbolId[][] = [
  STRIP_R1,
  STRIP_R2,
  STRIP_R3,
  STRIP_R4,
  STRIP_R5,
];

/** 返回每个卷轴上各图符的实际停止位数（用于概率验证） */
export function getStripStats(reelIndex: number): Record<SymbolId, number> {
  const strip = REEL_STRIPS[reelIndex];
  const stats: Partial<Record<SymbolId, number>> = {};
  for (const sym of strip) {
    stats[sym] = (stats[sym] ?? 0) + 1;
  }
  return stats as Record<SymbolId, number>;
}
