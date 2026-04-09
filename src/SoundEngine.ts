// ────────────────────────────────────────────────────────────────────────────
// 赌场音效引擎 — Web Audio API（纯程序化生成，无需外部音频文件）
// ────────────────────────────────────────────────────────────────────────────

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;

  // 旋转循环音效节点
  private spinSrc:  AudioBufferSourceNode | null = null;
  private spinGain: GainNode | null = null;

  muted = false;

  // ── 初始化（懒加载，需用户交互后才能创建 AudioContext）─────────────────
  private init(): AudioContext {
    if (!this.ctx) {
      this.ctx   = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // ── 基础音色工具 ─────────────────────────────────────────────────────────

  /** 噪音 burst（模拟机械音、硬币声） */
  private noise(
    duration: number,
    vol: number,
    at: number,
    lpFreq = 8000,
  ): void {
    if (this.muted) return;
    const ctx = this.init();
    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.ceil(sr * duration), sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src    = ctx.createBufferSource();
    src.buffer   = buf;
    const filter = ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.value = lpFreq;

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(at);
    src.stop(at + duration + 0.01);
  }

  /** 单音 oscillator */
  private tone(
    freq: number,
    dur: number,
    vol: number,
    at: number,
    type: OscillatorType = 'sine',
    attack = 0.008,
  ): void {
    if (this.muted) return;
    const ctx = this.init();
    const osc = ctx.createOscillator();
    osc.type  = type;
    osc.frequency.value = freq;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(g);
    g.connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // ── 旋转循环音 ───────────────────────────────────────────────────────────
  /** 开始循环的机械旋转声（更新为悦耳的复古琶音） */
  startSpinSound(): void {
    if (this.muted || this.spinSrc) return;
    const ctx = this.init();
    const t   = ctx.currentTime;

    const sr = ctx.sampleRate;
    const msPerNote = 0.045; // 45ms per note
    const numNotes = 4;
    const noteLen = Math.floor(sr * msPerNote);
    const len = noteLen * numNotes;
    const buf = ctx.createBuffer(1, len, sr);
    const L = buf.getChannelData(0);

    // C大调琶音: C5, E5, G5, C6
    const freqs = [523.25, 659.25, 784.00, 1046.50];

    for (let i = 0; i < len; i++) {
      const noteIdx = Math.floor(i / noteLen);
      const freq = freqs[noteIdx];
      
      // 合成波形：正弦波为主 + 少量方波增加复古电子感
      const phase = 2 * Math.PI * freq * (i / sr);
      const wave = Math.sin(phase) * 0.7 + Math.sign(Math.sin(phase)) * 0.15;
      
      const localI = i % noteLen;
      // 包络线：指数型衰减，形成拨弹和颗粒感
      let env = 1 - (localI / noteLen);
      env = Math.pow(env, 2); 
      
      L[i] = wave * env * 0.3;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // 低通滤波，避免音色太刺耳
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.1); // 平滑推入音量

    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();

    this.spinSrc  = src;
    this.spinGain = g;
  }

  /** 淡出并停止旋转声 */
  stopSpinSound(): void {
    if (!this.spinSrc || !this.spinGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    
    // 快速的切断，不拖泥带水
    this.spinGain.gain.setTargetAtTime(0, t, 0.05);
    this.spinSrc.stop(t + 0.15);

    this.spinSrc  = null;
    this.spinGain = null;
  }

  // ── 单次音效 ─────────────────────────────────────────────────────────────

  /** 按钮点击 */
  playClick(): void {
    if (this.muted) return;
    const ctx = this.init();
    const t   = ctx.currentTime;
    this.noise(0.04, 0.35, t, 2200);
    this.tone(900, 0.04, 0.12, t, 'square');
  }

  /** 单个卷轴停止（用户要求移除此音效，保持静音） */
  playReelStop(reelIdx: number): void {
    // 移除卷轴停止音效
  }

  /** 小赢（< 10× 总投注） */
  playSmallWin(): void {
    if (this.muted) return;
    const ctx   = this.init();
    const t     = ctx.currentTime;
    const notes = [523, 659, 784];
    notes.forEach((f, i) => {
      this.tone(f, 0.2, 0.4, t + i * 0.1, 'triangle');
      this.noise(0.04, 0.18, t + i * 0.1, 3000);
    });
  }

  /** 中等赢（10-99× 总投注） */
  playMediumWin(): void {
    if (this.muted) return;
    const ctx   = this.init();
    const t     = ctx.currentTime;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => {
      this.tone(f, 0.22, 0.45, t + i * 0.09, 'triangle');
      this.noise(0.05, 0.22, t + i * 0.09, 3000);
    });
    // 结尾和弦
    [523, 659, 784].forEach(f =>
      this.tone(f, 0.5, 0.18, t + notes.length * 0.09, 'sine'),
    );
  }

  /** 大奖（≥ 100× 或 5连）*/
  playBigWin(): void {
    if (this.muted) return;
    const ctx = this.init();
    const t   = ctx.currentTime;

    // 上行琶音
    const arp = [392, 523, 659, 784, 1047, 784, 1047, 1319, 1568, 2093];
    arp.forEach((f, i) => {
      this.tone(f, 0.22, 0.5,  t + i * 0.08, 'triangle', 0.004);
      this.tone(f / 2, 0.22, 0.3, t + i * 0.08, 'sawtooth', 0.004);
    });

    // 结尾大和弦
    [523, 659, 784, 1047].forEach(f =>
      this.tone(f, 1.0, 0.28, t + arp.length * 0.08, 'sine'),
    );

    // 硬币雨
    for (let i = 0; i < 14; i++) {
      const coinF = 2500 + Math.random() * 1500;
      this.noise(0.05, 0.28, t + i * 0.13, coinF);
    }
  }

  /** 散野触发免费旋转 */
  playFreeSpinTrigger(): void {
    if (this.muted) return;
    const ctx    = this.init();
    const t      = ctx.currentTime;
    const rising = [261, 329, 392, 523, 659, 784, 1047, 1319, 1568];
    rising.forEach((f, i) => {
      this.tone(f, 0.22, 0.4, t + i * 0.09, 'triangle');
    });
    // 闪烁高音
    for (let i = 0; i < 8; i++) {
      const f = 1200 + Math.random() * 900;
      this.tone(f, 0.1, 0.25, t + 0.6 + i * 0.12, 'sine', 0.002);
    }
  }

  /** 单枚硬币（彩带动画期间随机调用） */
  playCoin(): void {
    if (this.muted) return;
    const ctx = this.init();
    const t   = ctx.currentTime;
    this.noise(0.04, 0.18, t, 2800 + Math.random() * 1800);
  }
}
