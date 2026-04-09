import type { SymbolDef, SymbolId } from './types';

// ────────────────────────────────────────────────────────────────────────────
// 赔付表 (Paytable)
//
// 乘数含义: win = multiplier × betPerLine
// WILD 可替代所有普通图符（但不能替代 SCATTER）
// ────────────────────────────────────────────────────────────────────────────

/** 图符定义 */
export const SYMBOLS: Record<SymbolId, SymbolDef> = {
  WILD:    { id: 'WILD',    emoji: '<img class="sym-img" src="/wild.png">',       name: '皇冠(百搭)', color: '#ff6b6b', isWild: true },
  SEVEN:   { id: 'SEVEN',   emoji: '<img class="sym-img" src="/seven.png">',      name: '幸运7',    color: '#ff4757' },
  DIAMOND: { id: 'DIAMOND', emoji: '<img class="sym-img" src="/diamond.png">',    name: '真钻',      color: '#70a1ff' },
  BELL:    { id: 'BELL',    emoji: '<img class="sym-img" src="/bell.png">',       name: '狂热机',    color: '#ffd700' },
  STAR:    { id: 'STAR',    emoji: '<img class="sym-img" src="/star.png">',       name: '金冠杯',    color: '#ffd700' },
  CHERRY:  { id: 'CHERRY',  emoji: '<img class="sym-img" src="/dice.png">',       name: '高倍骰子',  color: '#ff6b81' },
  LEMON:   { id: 'LEMON',   emoji: '<img class="sym-img" src="/chips.png">',      name: '皇家筹码',  color: '#eccc68' },
  ORANGE:  { id: 'ORANGE',  emoji: '<img class="sym-img" src="/ring.png">',       name: '钻戒',      color: '#ffa502' },
  GRAPE:   { id: 'GRAPE',   emoji: '<img class="sym-img" src="/champagne.png">',  name: '金箔香槟',  color: '#a29bfe' },
  SCATTER: { id: 'SCATTER', emoji: '<img class="sym-img" src="/scatter.png">',    name: '星辉(散野)', color: '#2ed573', isScatter: true },
};

/**
 * 支付线赔付乘数表
 * KEY: 图符ID → VALUE: { [连续数量]: 乘数 }
 *
 * 设计原则（真实赌场）:
 *   - 高价值图符出现概率低，赔付高
 *   - 低价值图符出现概率高，赔付低
 *   - 4连/5连赔付比3连有指数级跳跃
 */
export const LINE_PAYS: Partial<Record<SymbolId, Record<3 | 4 | 5, number>>> = {
  WILD:    { 3: 50,   4: 500,  5: 5000 },
  SEVEN:   { 3: 30,   4: 200,  5: 1000 },
  DIAMOND: { 3: 20,   4: 100,  5: 500  },
  BELL:    { 3: 15,   4: 50,   5: 200  },
  STAR:    { 3: 10,   4: 25,   5: 100  },
  CHERRY:  { 3: 8,    4: 15,   5: 50   },
  LEMON:   { 3: 5,    4: 10,   5: 30   },
  ORANGE:  { 3: 4,    4: 8,    5: 20   },
  GRAPE:   { 3: 2,    4: 5,    5: 10   },
};

/**
 * SCATTER 赔付 (基于总投注额倍数) + 免费旋转次数
 * 任意位置出现即计算
 */
export const SCATTER_PAYS: Record<number, { multiplier: number; freeSpins: number }> = {
  3: { multiplier: 3,   freeSpins: 10 },
  4: { multiplier: 10,  freeSpins: 15 },
  5: { multiplier: 50,  freeSpins: 25 },
};

/** 免费旋转期间的额外乘数 */
export const FREE_SPIN_MULTIPLIER = 3;

/** 投注额档位 (单线) */
export const BET_LEVELS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** 支付线数档位 */
export const LINE_LEVELS = [1, 5, 10, 15, 20];
