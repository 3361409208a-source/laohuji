import type { GameConfig, SessionStats, SpinResult } from './types';
import { SlotEngine } from './SlotEngine';
import { BET_LEVELS, LINE_LEVELS } from './paytable';

// ────────────────────────────────────────────────────────────────────────────
// 游戏状态管理器
// ────────────────────────────────────────────────────────────────────────────

export class GameState {
  private engine = new SlotEngine();

  // ── 余额 ──────────────────────────────────────────────────────────────────
  balance    = 1000;
  readonly   INITIAL_BALANCE = 1000;

  // ── 投注配置 ──────────────────────────────────────────────────────────────
  private betLevelIdx  = 1;    // BET_LEVELS 索引，默认 1.00
  private lineLevelIdx = 4;    // LINE_LEVELS 索引，默认 20 线

  get betPerLine(): number { return BET_LEVELS[this.betLevelIdx]!; }
  get lines():      number { return LINE_LEVELS[this.lineLevelIdx]!; }
  get totalBet():   number { return this.betPerLine * this.lines; }

  get config(): GameConfig {
    return { betPerLine: this.betPerLine, lines: this.lines };
  }

  // ── 免费旋转 ──────────────────────────────────────────────────────────────
  freeSpinsRemaining = 0;
  get isFreeSpin(): boolean { return this.freeSpinsRemaining > 0; }

  // ── 统计 ──────────────────────────────────────────────────────────────────
  stats: SessionStats = {
    totalSpins: 0,
    totalWagered: 0,
    totalWon: 0,
    rtp: 0,
  };

  // ── 投注调节 ──────────────────────────────────────────────────────────────
  increaseBet(): boolean {
    if (this.betLevelIdx < BET_LEVELS.length - 1) {
      this.betLevelIdx++;
      return true;
    }
    return false;
  }

  decreaseBet(): boolean {
    if (this.betLevelIdx > 0) {
      this.betLevelIdx--;
      return true;
    }
    return false;
  }

  increaseLines(): boolean {
    if (this.lineLevelIdx < LINE_LEVELS.length - 1) {
      this.lineLevelIdx++;
      return true;
    }
    return false;
  }

  decreaseLines(): boolean {
    if (this.lineLevelIdx > 0) {
      this.lineLevelIdx--;
      return true;
    }
    return false;
  }

  setMaxBet(): void {
    this.betLevelIdx  = BET_LEVELS.length - 1;
    this.lineLevelIdx = LINE_LEVELS.length - 1;
  }

  // ── 主旋转逻辑 ────────────────────────────────────────────────────────────
  /**
   * 执行一次旋转。
   * 返回 null 表示余额不足。
   */
  doSpin(): SpinResult | null {
    const freeSpin = this.isFreeSpin;

    // 免费旋转不扣余额
    if (!freeSpin) {
      if (this.balance < this.totalBet) return null;
      this.balance -= this.totalBet;
      this.stats.totalWagered += this.totalBet;
    }

    const result = this.engine.spin(this.config, freeSpin);

    // 结算赢得金额
    if (result.totalWin > 0) {
      this.balance += result.totalWin;
      this.stats.totalWon += result.totalWin;
    }

    // 处理免费旋转触发/消耗
    if (freeSpin) {
      this.freeSpinsRemaining--;
    }
    if (result.scatterWin && result.scatterWin.freeSpins > 0) {
      this.freeSpinsRemaining += result.scatterWin.freeSpins;
    }

    // 更新统计
    this.stats.totalSpins++;
    if (this.stats.totalWagered > 0) {
      this.stats.rtp = this.stats.totalWon / this.stats.totalWagered;
    }

    return result;
  }

  // ── 充值 ──────────────────────────────────────────────────────────────────
  addCredits(amount = 1000): void {
    this.balance += amount;
  }

  // ── 暴露 RTP 模拟给控制台 ─────────────────────────────────────────────────
  simulateRTP(spins: number): number {
    return this.engine.simulateRTP(spins, this.config);
  }
}
