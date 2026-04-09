import { GameState } from './GameState';
import { SoundEngine } from './SoundEngine';
import { SYMBOLS, LINE_PAYS, SCATTER_PAYS, FREE_SPIN_MULTIPLIER } from './paytable';
import { PAYLINES } from './paylines';
import { REEL_STRIPS } from './reelStrips';
import type { SymbolId, SpinResult, LineWin } from './types';

// ──────────────────────────────────────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────────────────────────────────────
const REELS       = 5;
const CELL_HEIGHT = 100;   // px, 与 CSS 一致
const SPIN_ROWS   = 28;    // 减少 DOM 数量以提升流畅度，原为 48
const DECEL_ROWS  = 6;     // 原为 10
const REEL_BASE_DURATION = 1600; // 稍缩短基础时长
const REEL_STAGGER       = 240;  // 稍加快卷轴停止间隔

// ──────────────────────────────────────────────────────────────────────────────
// 状态
// ──────────────────────────────────────────────────────────────────────────────
const state = new GameState();
const sound = new SoundEngine();
let isSpinning  = false;
let autoSpin    = false;
let speedIdx    = 0;
const SPEED_MULTS = [1.0, 0.5, 0.25, 0.125];
const SPEED_LABELS = ['⚡ 1x', '⚡ 2x', '⚡ 4x', '⚡ 8x'];
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let winLineRaf: number | null = null;   // requestAnimationFrame handle for animated win lines

// 当前屏幕上显示的网格 grid[reel][row]
let currentGrid: SymbolId[][] = Array.from({ length: REELS }, (_, r) => {
  const strip = REEL_STRIPS[r]!;
  const stop  = Math.floor(Math.random() * strip.length);
  const len   = strip.length;
  return [
    strip[(stop - 1 + len) % len]!,
    strip[stop]!,
    strip[(stop + 1) % len]!,
  ];
});

// ──────────────────────────────────────────────────────────────────────────────
// DOM helpers
// ──────────────────────────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ──────────────────────────────────────────────────────────────────────────────
// 卷轴渲染
// ──────────────────────────────────────────────────────────────────────────────
function cellHTML(sym: SymbolId): string {
  const def = SYMBOLS[sym];
  return `<div class="reel-cell sym-${sym.toLowerCase()}" data-sym="${sym}">
    <span class="sym-emoji">${def.emoji}</span>
    <span class="sym-name">${def.name}</span>
  </div>`;
}

/** 初始化所有卷轴（静止状态） */
function renderStatic(): void {
  for (let r = 0; r < REELS; r++) {
    const inner = $(`reel-inner-${r}`);
    inner.style.transition = 'none';
    inner.style.transform  = 'translateY(0)';
    inner.innerHTML = currentGrid[r]!.map(cellHTML).join('');
  }
}

/**
 * 卷轴旋转动画
 * 条带布局: [prev_top, prev_mid, prev_bot, rand×SPIN_ROWS, final_top, final_mid, final_bot]
 * 动画: translateY(0) → translateY(-(SPIN_ROWS+3)×CELL_HEIGHT)
 * 完成后还原为 3 格静止状态
 */
function animateReel(
  reelIdx: number,
  finalSymbols: SymbolId[],
  delay: number,
  duration: number,
): Promise<void> {
  return new Promise((resolve) => {
    const inner = $(`reel-inner-${reelIdx}`);
    const strip = REEL_STRIPS[reelIdx]!;

    // 阶段一：高速线性旋转的随机行  阶段二：减速额外行
    const randSymbols: SymbolId[] = Array.from(
      { length: SPIN_ROWS + DECEL_ROWS },
      () => strip[Math.floor(Math.random() * strip.length)]!
    );
    const allSyms: SymbolId[] = [
      ...currentGrid[reelIdx]!,
      ...randSymbols,
      ...finalSymbols,
    ];

    const dur1 = duration * 0.72;   // 延迟高速阶段到 72%
    const dur2 = duration * 0.28;   // 压缩减速阶段时长，使其更尖锐
    const endY1 = -(SPIN_ROWS + 3) * CELL_HEIGHT;
    const endY2 = -(SPIN_ROWS + DECEL_ROWS + 3) * CELL_HEIGHT;

    setTimeout(() => {
      // ① 初始化条带
      inner.style.transition = 'none';
      inner.style.transform  = 'translateY(0)';
      inner.innerHTML        = allSyms.map(cellHTML).join('');
      inner.classList.add('is-spinning');
      void inner.offsetHeight;

      // ② 阶段一：匀速高速旋转
      inner.style.transition = `transform ${dur1}ms linear`;
      inner.style.transform  = `translate3d(0, ${endY1}px, 0)`;

      // ③ 阶段二：减速停止
      setTimeout(() => {
        inner.classList.remove('is-spinning');
        inner.classList.add('is-stopping');
        // 使用更具张力的停止曲线
        inner.style.transition = `transform ${dur2}ms cubic-bezier(0.1, 0.9, 0.2, 1.05)`;
        inner.style.transform  = `translate3d(0, ${endY2}px, 0)`;

        // ④ 还原为3格静止 + 落地猛烈反弹
        setTimeout(() => {
          inner.classList.remove('is-stopping');
          inner.style.transition = 'none';
          inner.style.transform  = 'translate3d(0, 0, 0)';
          inner.innerHTML        = finalSymbols.map(cellHTML).join('');
          
          void inner.offsetHeight; 
          
          inner.classList.add('reel-land');
          setTimeout(() => inner.classList.remove('reel-land'), 420);
          sound.playReelStop(reelIdx);
          resolve();
        }, dur2); // 去掉多余的 30ms 延迟，让反弹瞬间发生
      }, dur1);
    }, delay);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 画布 — 胜利线绘制
// ──────────────────────────────────────────────────────────────────────────────
/** 动态「蚂蚁行军」胜利线动画 */
function drawWinLines(wins: LineWin[]): void {
  if (winLineRaf !== null) cancelAnimationFrame(winLineRaf);

  const canvas  = $<HTMLCanvasElement>('win-lines-canvas');
  const window_ = $('reels-window');
  
  // 使用 offsetWidth/Height 而不是 getBoundingClientRect
  // 因为 transform: scale 会影响 getBoundingClientRect 的结果
  const width  = window_.offsetWidth;
  const height = window_.offsetHeight;
  
  canvas.width  = width;
  canvas.height = height;

  if (wins.length === 0) return;

  const ctx   = canvas.getContext('2d')!;
  const cellW = width / REELS;
  const cellH = CELL_HEIGHT;
  let   dashOffset = 0;

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dashOffset -= 1.5;

    for (const win of wins) {
      const payline = PAYLINES.find(p => p.id === win.paylineId)!;
      const color   = payline.color;

      // 胜利连线
      ctx.save();
      ctx.setLineDash([12, 6]);
      ctx.lineDashOffset = dashOffset;
      ctx.strokeStyle    = color;
      ctx.lineWidth      = 3.5;
      ctx.shadowColor    = color;
      ctx.shadowBlur     = 14;
      ctx.beginPath();
      for (let r = 0; r < win.matchCount; r++) {
        const x = r * cellW + cellW / 2;
        const y = payline.rows[r]! * cellH + cellH / 2;
        if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 命中格子圆圈
      ctx.setLineDash([]);
      ctx.lineWidth  = 2;
      ctx.shadowBlur = 10;
      for (let r = 0; r < win.matchCount; r++) {
        const x = r * cellW + cellW / 2;
        const y = payline.rows[r]! * cellH + cellH / 2;
        const pulse = 34 + Math.sin(Date.now() / 200 + r) * 4;
        ctx.beginPath();
        ctx.arc(x, y, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.restore();
    }

    winLineRaf = requestAnimationFrame(frame);
  }

  frame();
}

function clearWinLines(): void {
  if (winLineRaf !== null) { cancelAnimationFrame(winLineRaf); winLineRaf = null; }
  const canvas = $<HTMLCanvasElement>('win-lines-canvas');
  const ctx    = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ──────────────────────────────────────────────────────────────────────────────
// UI 更新
// ──────────────────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function updateHUD(): void {
  $('balance').textContent        = fmt(state.balance);
  $('total-won').textContent      = fmt(state.stats.totalWon);
  $('total-bet-display').textContent = fmt(state.stats.totalWagered);
  $('bet-per-line').textContent   = fmt(state.betPerLine);
  $('lines-count').textContent    = String(state.lines);
  $('total-bet').textContent      = fmt(state.totalBet);

  // 余额颜色警告
  const balEl = $('balance');
  balEl.classList.toggle('balance-low', state.balance < state.totalBet * 5);

  // 免费旋转横幅
  const fsBanner = $('free-spins-banner');
  if (state.isFreeSpin) {
    $('free-spins-count').textContent = String(state.freeSpinsRemaining);
    fsBanner.classList.add('visible');
  } else {
    fsBanner.classList.remove('visible');
  }
}

function triggerLightning(): void {
  const flash = $('lightning-flash');
  const machine = $('machine');
  flash.classList.remove('active');
  void flash.offsetWidth;
  flash.classList.add('active');
  
  // 仅让机器部分产生震动，避免全屏扭曲
  machine.classList.remove('machine-shake');
  void machine.offsetWidth;
  machine.classList.add('machine-shake');
}

function showWinBanner(amount: number, isBig: boolean): void {
  const banner  = $('win-banner');
  const winText = $('win-text');
  const winAmt  = $('win-amount');

  if (isBig) {
    winText.textContent = '🎊 大奖！JACKPOT！';
    banner.classList.add('jackpot');
    triggerLightning(); 
  } else {
    winText.textContent = '🎉 恭喜获奖！';
    banner.classList.remove('jackpot');
  }
  winAmt.textContent = `+¥${fmt(amount)}`;
  winAmt.classList.remove('pop');
  void winAmt.offsetWidth;
  winAmt.classList.add('pop');
  banner.classList.remove('visible');
  void banner.offsetWidth;
  banner.classList.add('visible');

  // 大奖展示时间稍长
  const displayTime = isBig ? 6000 : 4000;
  setTimeout(() => banner.classList.remove('visible', 'jackpot'), displayTime);
}

/** 播放大奖 CG 视频，并等待播放结束 */
async function playBigWinVideo(): Promise<void> {
  return new Promise((resolve) => {
    const overlay = $('video-overlay');
    const video   = $('win-video') as HTMLVideoElement;
    const skipBtn = overlay.querySelector('.video-skip');
    
    // 安全检查，如果 45 秒还没播完或意外卡住，强行关闭（适配更长的 CG 视频）
    const safetyTimeout = setTimeout(() => finish(), 45000);

    const finish = () => {
      clearTimeout(safetyTimeout);
      video.pause();
      overlay.classList.remove('visible');
      video.onended = null;
      video.onerror = null;
      if (skipBtn) skipBtn.removeEventListener('click', finish);
      resolve();
    };

    overlay.classList.add('visible');
    video.currentTime = 0;
    
    video.onerror = (e) => {
      console.error('视频加载/播放错误:', e);
      finish();
    };

    video.play().catch(err => {
      console.warn('视频播放被拦截或失败:', err);
      finish(); 
    });

    video.onended = finish;
    if (skipBtn) skipBtn.addEventListener('click', finish);
  });
}

// ── 余额滚动计数器 ──────────────────────────────────────────────────────────
function animateBalance(from: number, to: number): void {
  const el    = $('balance');
  const start = performance.now();
  const dur   = Math.min(800, Math.abs(to - from) * 3);
  el.classList.add('counting');
  function tick(now: number) {
    const t   = Math.min((now - start) / dur, 1);
    const val = from + (to - from) * (1 - Math.pow(1 - t, 3));
    el.textContent = fmt(val);
    if (t < 1) requestAnimationFrame(tick);
    else { el.textContent = fmt(to); el.classList.remove('counting'); }
  }
  requestAnimationFrame(tick);
}

// ── 彩带粒子 ───────────────────────────────────────────────────────────────
function spawnConfetti(count = 90): void {
  const existing = document.getElementById('confetti-canvas');
  if (existing) existing.remove();

  const canvas = document.createElement('canvas');
  canvas.id    = 'confetti-canvas';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx    = canvas.getContext('2d')!;
  const colors = ['#ffd700','#ff4757','#2ed573','#70a1ff','#ff6b81','#eccc68','#a29bfe','#ff4af3'];
  type P = { x:number; y:number; vx:number; vy:number; w:number; h:number; rot:number; rspd:number; color:string; alpha:number };
  const particles: P[] = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 120,
    vx: (Math.random() - 0.5) * 7,
    vy: Math.random() * 3 + 2,
    w: Math.random() * 12 + 4,
    h: Math.random() * 7 + 3,
    rot:  Math.random() * Math.PI * 2,
    rspd: (Math.random() - 0.5) * 0.18,
    color: colors[Math.floor(Math.random() * colors.length)]!,
    alpha: 1,
  }));

  let frame = 0;
  const maxFrames = 160;
  let coinTick = 0;

  function step() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.1;
      p.rot += p.rspd;
      if (frame > maxFrames * 0.55) p.alpha -= 0.018;
      if (p.alpha <= 0) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle   = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    // 硬币声跟随彩带
    coinTick++;
    if (coinTick % 12 === 0 && frame < 80) sound.playCoin();
    frame++;
    if (frame < maxFrames) requestAnimationFrame(step);
    else canvas.remove();
  }
  step();
}

// ── 大奖屏幕闪光 ──────────────────────────────────────────────────────────
function triggerJackpotFlash(): void {
  document.body.classList.remove('jackpot-anim');
  void document.body.offsetWidth;
  document.body.classList.add('jackpot-anim');
  setTimeout(() => document.body.classList.remove('jackpot-anim'), 1800);
}

function showWinInfo(result: SpinResult): void {
  const el = $('win-info');
  const content = $('win-info-content');

  if (result.totalWin === 0) {
    el.classList.remove('visible');
    content.innerHTML = '';
    return;
  }

  const parts: string[] = [];

  for (const w of result.lineWins) {
    const sym   = SYMBOLS[w.symbolId];
    const pline = PAYLINES.find(p => p.id === w.paylineId)!;
    parts.push(
      `<span class="win-detail" style="color:${pline.color}">` +
      `${sym.emoji} ${w.matchCount}连 × ¥${fmt(w.win)}` +
      `</span>`,
    );
  }

  if (result.scatterWin) {
    const sw = result.scatterWin;
    parts.push(
      `<span class="win-detail scatter-win">` +
      `💫 散野 ×${sw.count} = ¥${fmt(sw.win)}` +
      (sw.freeSpins > 0 ? ` + ${sw.freeSpins}次免费旋转！` : '') +
      `</span>`,
    );
  }

  content.innerHTML = parts.join('');
  el.classList.add('visible');
}

// ──────────────────────────────────────────────────────────────────────────────
// 主旋转流程
// ──────────────────────────────────────────────────────────────────────────────
async function doSpin(): Promise<void> {
  if (isSpinning) return;

  if (!state.isFreeSpin && state.balance < state.totalBet) {
    alert('💸 余额不足！请充值后继续。');
    stopAuto();
    return;
  }

  isSpinning = true;
  const spinBtn  = $('btn-spin');
  const frame_el = $('reels-frame');
  spinBtn.classList.add('spinning');
  spinBtn.textContent = '⏹ 停止';
  frame_el.classList.add('reel-spinning');

  clearWinLines();
  showWinInfo({ grid: [], stops: [], lineWins: [], scatterWin: null, totalWin: 0, isFreeSpin: false });

  // 旋转开始音
  sound.startSpinSound();

  // 执行算法旋转（立即计算，动画在后）
  const balBefore = state.balance;
  const result    = state.doSpin()!;

  // 卷轴动画（逐个停止）
  const speedMul = SPEED_MULTS[speedIdx]!;
  const animPromises: Promise<void>[] = [];
  for (let r = 0; r < REELS; r++) {
    const delay    = r * REEL_STAGGER * speedMul;
    const duration = (REEL_BASE_DURATION + r * REEL_STAGGER) * speedMul;
    animPromises.push(animateReel(r, result.grid[r]!, delay, duration));
  }
  await Promise.all(animPromises);

  // 停止旋转音
  sound.stopSpinSound();
  frame_el.classList.remove('reel-spinning');

  // 更新当前网格
  currentGrid = result.grid.map(col => [...col]);

  // 展示结果
  isSpinning = false;
  spinBtn.classList.remove('spinning');
  spinBtn.innerHTML = '<span class="spin-icon">▶</span><span>旋转</span>';

  if (result.totalWin > 0) {
    const ratio = result.totalWin / state.totalBet;
    const isBig = ratio >= 25;

    // 按赢钱大小播放对应音效
    if (isBig) {
      sound.playBigWin();
      triggerJackpotFlash();
      spawnConfetti(120);
      
      // 等待视频播放
      await playBigWinVideo();
    } else if (ratio >= 8) {
      sound.playMediumWin();
      spawnConfetti(50);
    } else {
      sound.playSmallWin();
    }

    // 散野触发免费旋转音
    if (result.scatterWin?.freeSpins) sound.playFreeSpinTrigger();

    showWinBanner(result.totalWin, isBig);
    showWinInfo(result);
    drawWinLines(result.lineWins);
    flashWinCells(result);
  }

  // 余额滚动动画
  animateBalance(balBefore, state.balance);
  $('total-won').textContent       = fmt(state.stats.totalWon);
  $('total-bet-display').textContent = fmt(state.stats.totalWagered);
  $('bet-per-line').textContent    = fmt(state.betPerLine);
  $('lines-count').textContent     = String(state.lines);
  $('total-bet').textContent       = fmt(state.totalBet);
  $('balance').classList.toggle('balance-low', state.balance < state.totalBet * 5);
  const fsBanner = $('free-spins-banner');
  if (state.isFreeSpin) { $('free-spins-count').textContent = String(state.freeSpinsRemaining); fsBanner.classList.add('visible'); }
  else fsBanner.classList.remove('visible');

  // 若有免费旋转则自动继续
  if (state.isFreeSpin) {
    setTimeout(doSpin, 1200 * SPEED_MULTS[speedIdx]!);
    return;
  }

  // 自动旋转
  if (autoSpin) {
    autoTimer = setTimeout(doSpin, 800 * SPEED_MULTS[speedIdx]!);
  }
}

function flashWinCells(result: SpinResult): void {
  const positions = new Set<string>();

  for (const w of result.lineWins) {
    const payline = PAYLINES.find(p => p.id === w.paylineId)!;
    for (let r = 0; r < w.matchCount; r++) {
      positions.add(`${r}-${payline.rows[r]}`);
    }
  }
  if (result.scatterWin) {
    for (const pos of result.scatterWin.positions) {
      positions.add(`${pos.reel}-${pos.row}`);
    }
  }

  for (const key of positions) {
    const [reel, row] = key.split('-').map(Number);
    const inner = $(`reel-inner-${reel}`);
    const cell  = inner.children[row!] as HTMLElement | undefined;
    if (cell) {
      cell.classList.add('win-flash');
      setTimeout(() => cell.classList.remove('win-flash'), 1800);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 自动旋转
// ──────────────────────────────────────────────────────────────────────────────
function stopAuto(): void {
  autoSpin = false;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  $('btn-auto').textContent = '自动';
  $('btn-auto').classList.remove('active');
}

// ──────────────────────────────────────────────────────────────────────────────
// 赔付表弹窗
// ──────────────────────────────────────────────────────────────────────────────
function buildPaytableHTML(): string {
  const rows: string[] = [];

  rows.push('<h3 style="text-align:center;color:#ffd700;margin-bottom:16px">支付线赔付 (倍数 × 每线投注)</h3>');
  rows.push('<table class="pay-table">');
  rows.push('<tr><th>图符</th><th>名称</th><th>3连</th><th>4连</th><th>5连</th></tr>');

  for (const [symId, pays] of Object.entries(LINE_PAYS) as [SymbolId, Record<3|4|5,number>][]) {
    const def = SYMBOLS[symId];
    rows.push(
      `<tr>
        <td class="sym-cell">${def.emoji}</td>
        <td>${def.name}</td>
        <td>${pays[3]}×</td>
        <td>${pays[4]}×</td>
        <td><strong>${pays[5]}×</strong></td>
      </tr>`,
    );
  }
  rows.push('</table>');

  rows.push('<h3 style="text-align:center;color:#2ed573;margin:20px 0 12px">散野 💫 赔付 (倍数 × 总投注)</h3>');
  rows.push('<table class="pay-table">');
  rows.push('<tr><th>数量</th><th>赔付</th><th>免费旋转</th></tr>');
  for (const [cnt, pay] of Object.entries(SCATTER_PAYS)) {
    rows.push(`<tr><td>${cnt}个</td><td>${pay.multiplier}×</td><td>${pay.freeSpins}次</td></tr>`);
  }
  rows.push('</table>');

  rows.push(`
    <div class="pay-notes">
      <p>🃏 <strong>百搭 (WILD)</strong> 可替代所有普通图符</p>
      <p>💫 <strong>散野 (SCATTER)</strong> 任意位置出现均有效</p>
      <p>🎁 免费旋转期间所有赢钱 <strong>×${FREE_SPIN_MULTIPLIER} 乘数</strong></p>
      <p>📊 理论 RTP ≈ <strong>96%</strong>（百万次模拟验证）</p>
    </div>
  `);

  return rows.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────────
// 支付线侧边指示
// ──────────────────────────────────────────────────────────────────────────────
function renderPaylineIndicators(): void {
  const leftEl  = $('paylines-left');
  const rightEl = $('paylines-right');

  const half = Math.ceil(PAYLINES.length / 2);
  const leftLines  = PAYLINES.slice(0, half);
  const rightLines = PAYLINES.slice(half);

  leftEl.innerHTML  = leftLines.map(p =>
    `<div class="pl-indicator" style="color:${p.color}">${p.id}</div>`
  ).join('');
  rightEl.innerHTML = rightLines.map(p =>
    `<div class="pl-indicator" style="color:${p.color}">${p.id}</div>`
  ).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// 事件绑定
// ──────────────────────────────────────────────────────────────────────────────
function bindEvents(): void {
  $('btn-spin').addEventListener('click', () => {
    sound.playClick();
    if (isSpinning) return;
    stopAuto();
    doSpin();
  });

  $('btn-auto').addEventListener('click', () => {
    if (autoSpin) {
      stopAuto();
    } else {
      autoSpin = true;
      $('btn-auto').textContent = '停止自动';
      $('btn-auto').classList.add('active');
      if (!isSpinning) doSpin();
    }
  });

  $('bet-up').addEventListener('click',    () => { sound.playClick(); state.increaseBet();   updateHUD(); });
  $('bet-down').addEventListener('click',  () => { sound.playClick(); state.decreaseBet();   updateHUD(); });
  $('lines-up').addEventListener('click',  () => { sound.playClick(); state.increaseLines(); updateHUD(); });
  $('lines-down').addEventListener('click',() => { sound.playClick(); state.decreaseLines(); updateHUD(); });

  $('btn-max-bet').addEventListener('click', () => { sound.playClick(); state.setMaxBet(); updateHUD(); });

  $('btn-add-credits').addEventListener('click', () => {
    sound.playClick();
    state.addCredits(1000);
    animateBalance(state.balance - 1000, state.balance);
  });

  // 加速按钮
  const btnTurbo = $('btn-turbo');
  btnTurbo.textContent = SPEED_LABELS[speedIdx]!;
  btnTurbo.addEventListener('click', () => {
    sound.playClick();
    speedIdx = (speedIdx + 1) % SPEED_MULTS.length;
    btnTurbo.classList.toggle('active', speedIdx > 0);
    btnTurbo.textContent = SPEED_LABELS[speedIdx]!;
  });

  // 静音按钮
  $('btn-mute').addEventListener('click', () => {
    const muted = sound.toggleMute();
    $('btn-mute').textContent = muted ? '🔇' : '🔊';
    $('btn-mute').classList.toggle('muted', muted);
  });

  // 赔付表弹窗
  $('btn-paytable').addEventListener('click', () => {
    sound.playClick();
    $('paytable-content').innerHTML = buildPaytableHTML();
    $('modal-overlay').classList.add('visible');
  });
  $('modal-close').addEventListener('click',   () => $('modal-overlay').classList.remove('visible'));
  $('modal-overlay').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'modal-overlay')
      $('modal-overlay').classList.remove('visible');
  });

  // 空格/Enter 快捷键旋转
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return; // 防止按钮重复触发
      e.preventDefault();
      if (!isSpinning) { sound.playClick(); doSpin(); }
    }
  });

  window.addEventListener('resize', handleResize);
}

// ──────────────────────────────────────────────────────────────────────────────
// 响应式自适应缩放 (Scale to Fit)
// ──────────────────────────────────────────────────────────────────────────────
function handleResize(): void {
  const app = $('app');
  const baseWidth  = 920; 
  const baseHeight = 820;
  const winWidth   = window.innerWidth;
  const winHeight  = window.innerHeight;

  const scaleW = (winWidth / baseWidth) * 0.95;
  const scaleH = (winHeight / baseHeight) * 0.95;
  
  // 允许在大屏幕上适度放大 (最大 2 倍)
  let scale = Math.min(2.0, scaleW, scaleH);
  
  app.style.setProperty('--game-scale', scale.toString());
}

// ──────────────────────────────────────────────────────────────────────────────
// 初始化
// ──────────────────────────────────────────────────────────────────────────────
function init(): void {
  // 注入静音按钮到 header
  const headerStats = document.querySelector('.header-stats')!;
  const muteBtn = document.createElement('button');
  muteBtn.id          = 'btn-mute';
  muteBtn.className   = 'btn-mute';
  muteBtn.textContent = '🔊';
  muteBtn.title       = '静音/开声';
  headerStats.insertAdjacentElement('beforebegin', muteBtn);

  handleResize(); // 初始缩放
  renderStatic();
  renderPaylineIndicators();
  updateHUD();
  bindEvents();

  // 暴露 RTP 模拟工具到控制台
  (window as unknown as Record<string, unknown>).simulateRTP =
    (n: number) => state.simulateRTP(n);

  console.log('%c🎰 皇家老虎机 已启动', 'color:#ffd700;font-size:18px;font-weight:bold');
}

document.addEventListener('DOMContentLoaded', init);
