import type { SymbolId, SpinResult, LineWin, ScatterWin, GameConfig } from './types';
import { REEL_STRIPS } from './reelStrips';
import { LINE_PAYS, SCATTER_PAYS, FREE_SPIN_MULTIPLIER } from './paytable';
import { PAYLINES } from './paylines';

// ────────────────────────────────────────────────────────────────────────────
// 核心赌场算法引擎 (Slot Engine)
//
// 真实赌场算法要点:
//
//  1. 密码学级 RNG (crypto.getRandomValues) —— 不可预测
//  2. 虚拟卷轴映射 (Virtual Reel Mapping):
//     每次旋转从 [0, stripLength) 均匀随机选一个停止位，
//     该停止位对应卷轴条带中的一个图符。图符在条带中出现次数
//     越多 → 被选中概率越高。这是赌场调节 RTP 的核心手段。
//  3. 可见窗口: 停止位对应中行，停止位±1 对应顶行/底行
//  4. 支付线从左向右评估，WILD 可替代任意普通图符
//  5. SCATTER 出现在任意位置均计入，≥3个触发免费旋转
//  6. 免费旋转期间胜利额外乘以 FREE_SPIN_MULTIPLIER
// ────────────────────────────────────────────────────────────────────────────

const REELS = 5;
const ROWS  = 3;

export class SlotEngine {
  // ── 密码学级随机数生成器 ──────────────────────────────────────────────────
  // 使用 Web Crypto API，比 Math.random() 更不可预测
  private rng(): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    // 映射到 [0, 1) 均匀分布
    return buf[0] / 0x1_0000_0000;
  }

  /** 从 [0, max) 均匀选一个整数 */
  private randInt(max: number): number {
    return Math.floor(this.rng() * max);
  }

  // ── 虚拟卷轴停止位 ────────────────────────────────────────────────────────
  /** 为一个卷轴生成随机停止位 */
  private getStop(reelIdx: number): number {
    return this.randInt(REEL_STRIPS[reelIdx].length);
  }

  /**
   * 根据停止位获取可见网格图符
   * 中行 = stop 位置，顶行 = stop-1，底行 = stop+1（循环）
   */
  private buildGrid(stops: number[]): SymbolId[][] {
    const grid: SymbolId[][] = [];
    for (let r = 0; r < REELS; r++) {
      const strip = REEL_STRIPS[r];
      const len   = strip.length;
      const stop  = stops[r];
      const col: SymbolId[] = [
        strip[(stop - 1 + len) % len], // row 0: 顶行
        strip[stop],                    // row 1: 中行（停止位）
        strip[(stop + 1) % len],        // row 2: 底行
      ];
      grid.push(col);
    }
    return grid;
  }

  // ── 支付线评估 ────────────────────────────────────────────────────────────
  /**
   * 从左到右计算最长连续匹配（WILD 可替代普通图符）。
   * 规则:
   *   - 取第一个非 WILD 图符作为"目标图符"
   *   - 若全是 WILD，目标图符视为 WILD 本身
   *   - 从卷轴1开始，连续遇到目标图符或 WILD → 计入连线
   *   - 第一个"不匹配"时停止
   */
  private evaluateLine(
    lineSymbols: SymbolId[],
    paylineId: number,
    betPerLine: number,
    isFreeSpin: boolean,
  ): LineWin | null {
    // 找到第一个非 WILD 图符
    const target = lineSymbols.find(s => s !== 'WILD') ?? 'WILD';

    let count = 0;
    for (const sym of lineSymbols) {
      if (sym === target || sym === 'WILD') {
        count++;
      } else {
        break;
      }
    }

    if (count < 3) return null;

    const pays = LINE_PAYS[target];
    if (!pays) return null;

    const multiplier = pays[count as 3 | 4 | 5] ?? 0;
    if (multiplier === 0) return null;

    const freeMult = isFreeSpin ? FREE_SPIN_MULTIPLIER : 1;
    const win = multiplier * betPerLine * freeMult;

    // 记录命中格子位置（用于 UI 高亮）
    const paylineDef = PAYLINES.find(p => p.id === paylineId)!;
    const positions = Array.from({ length: count }, (_, i) => ({
      reel: i,
      row: paylineDef.rows[i],
    }));

    return { paylineId, symbolId: target, matchCount: count, multiplier, win, positions };
  }

  /** 计算所有支付线的中奖 */
  private calcLineWins(
    grid: SymbolId[][],
    config: GameConfig,
    isFreeSpin: boolean,
  ): LineWin[] {
    const wins: LineWin[] = [];
    const activelines = PAYLINES.slice(0, config.lines);

    for (const line of activelines) {
      const lineSymbols = line.rows.map((row, reel) => grid[reel][row]);
      const result = this.evaluateLine(lineSymbols, line.id, config.betPerLine, isFreeSpin);
      if (result) wins.push(result);
    }
    return wins;
  }

  // ── SCATTER 评估 ──────────────────────────────────────────────────────────
  /** 统计 SCATTER 在整个可见窗口出现次数（任意位置有效） */
  private calcScatterWin(
    grid: SymbolId[][],
    config: GameConfig,
    isFreeSpin: boolean,
  ): ScatterWin | null {
    const positions: Array<{ reel: number; row: number }> = [];
    for (let r = 0; r < REELS; r++) {
      for (let row = 0; row < ROWS; row++) {
        if (grid[r][row] === 'SCATTER') {
          positions.push({ reel: r, row });
        }
      }
    }

    const count = positions.length;
    if (count < 3) return null;

    const pay = SCATTER_PAYS[count] ?? SCATTER_PAYS[5]!;
    const totalBet = config.betPerLine * config.lines;
    const freeMult = isFreeSpin ? FREE_SPIN_MULTIPLIER : 1;
    const win = pay.multiplier * totalBet * freeMult;

    return { count, win, freeSpins: pay.freeSpins, positions };
  }

  // ── 主旋转入口 ────────────────────────────────────────────────────────────
  /**
   * 执行一次旋转并返回完整结果。
   * @param config  - 当前投注配置
   * @param isFreeSpin - 是否处于免费旋转模式
   */
  public spin(config: GameConfig, isFreeSpin = false): SpinResult {
    // 1. 为每个卷轴生成随机停止位
    const stops = Array.from({ length: REELS }, (_, i) => this.getStop(i));

    // 2. 构建可见网格
    const grid = this.buildGrid(stops);

    // 3. 计算支付线胜利
    const lineWins = this.calcLineWins(grid, config, isFreeSpin);

    // 4. 计算 SCATTER 胜利
    const scatterWin = this.calcScatterWin(grid, config, isFreeSpin);

    // 5. 汇总总胜利额
    const lineTotal    = lineWins.reduce((s, w) => s + w.win, 0);
    const scatterTotal = scatterWin?.win ?? 0;
    const totalWin     = lineTotal + scatterTotal;

    return { grid, stops, lineWins, scatterWin, totalWin, isFreeSpin };
  }

  // ── RTP 模拟（调试用）────────────────────────────────────────────────────
  /**
   * 跑 N 次模拟计算理论 RTP。
   * 在浏览器控制台调用: window.simulateRTP(1_000_000)
   */
  public simulateRTP(spins: number, config: GameConfig = { betPerLine: 1, lines: 20 }): number {
    const totalBet = config.betPerLine * config.lines * spins;
    let totalWon = 0;
    for (let i = 0; i < spins; i++) {
      totalWon += this.spin(config).totalWin;
    }
    const rtp = totalWon / totalBet;
    console.log(`[RTP Simulation] ${spins.toLocaleString()} 次旋转`);
    console.log(`  总投注: ${totalBet.toFixed(2)}`);
    console.log(`  总赢得: ${totalWon.toFixed(2)}`);
    console.log(`  RTP:   ${(rtp * 100).toFixed(2)}%`);
    return rtp;
  }
}
