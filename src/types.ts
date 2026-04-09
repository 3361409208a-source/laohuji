// ────────────────────────────────────────────
// 老虎机核心类型定义
// ────────────────────────────────────────────

export type SymbolId =
  | 'WILD'
  | 'SEVEN'
  | 'DIAMOND'
  | 'BELL'
  | 'STAR'
  | 'CHERRY'
  | 'LEMON'
  | 'ORANGE'
  | 'GRAPE'
  | 'SCATTER';

export interface SymbolDef {
  id: SymbolId;
  emoji: string;
  name: string;
  color: string;       // CSS color for glow effect
  isWild?: boolean;
  isScatter?: boolean;
}

/** 支付线定义：每个卷轴对应的可见行索引 (0=顶行, 1=中行, 2=底行) */
export interface PaylineDef {
  id: number;
  rows: [number, number, number, number, number];
  color: string;
}

/** 某条支付线的赢钱结果 */
export interface LineWin {
  paylineId: number;
  symbolId: SymbolId;
  matchCount: number;     // 3, 4, or 5
  multiplier: number;     // payout multiplier × betPerLine
  win: number;            // actual win amount = multiplier × betPerLine
  positions: Array<{ reel: number; row: number }>;
}

/** 散野(SCATTER)结果 */
export interface ScatterWin {
  count: number;
  win: number;            // multiplier × totalBet
  freeSpins: number;
  positions: Array<{ reel: number; row: number }>;
}

/** 一次旋转的完整结果 */
export interface SpinResult {
  grid: SymbolId[][];     // grid[reel][row], shape: 5×3
  stops: number[];        // 每个卷轴的虚拟停止位
  lineWins: LineWin[];
  scatterWin: ScatterWin | null;
  totalWin: number;
  isFreeSpin: boolean;
}

/** 游戏配置 */
export interface GameConfig {
  betPerLine: number;
  lines: number;
}

/** RNG 统计（用于调试/验证 RTP） */
export interface SessionStats {
  totalSpins: number;
  totalWagered: number;
  totalWon: number;
  rtp: number;
}
