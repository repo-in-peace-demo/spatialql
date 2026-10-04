/**
 * Join sounds, synthesized with the Web Audio API (no audio files).
 *
 * Every sound is placed in 3D with an HRTF panner at the world position of
 * what made it (the seam, a row, the control). The audio context is the
 * one behind IWSDK's three.js AudioListener on the player's head, which
 * keeps the listener pose in sync every frame; without it, this module
 * creates its own context and moves the listener itself.
 *
 * Browsers only start audio after a user gesture: `unlock()` is called on
 * the Enter XR tap, at session start and on pinches, and never throws. Until
 * the context runs (or when muted), every play call is a no-op -- sound is
 * never the only feedback.
 *
 * One-shot sounds build a few nodes per event (never per frame). The
 * preview hum is the only continuous sound; per frame it only updates
 * existing AudioParams.
 */

import { Quaternion, Vector3, type World } from '@iwsdk/core';

/** Overall loudness. Subtle by design; a limiter keeps peaks soft. */
export const MASTER_VOLUME = 0.3;

export type SoundName =
  | 'snap'
  | 'lineTick'
  | 'resolve'
  | 'dropTap'
  | 'click'
  | 'slideIn'
  | 'slideOut'
  | 'release'
  | 'win'
  | 'hint';

/** Dev-only observer: name, scheduled delay (s), measured peak (dBFS, or null if not measurable). */
export type SoundHook = (name: SoundName, delaySeconds: number, peakDb: number | null) => void;

type Position = { x: number; y: number; z: number };

type Hum = {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  gain: GainNode;
  panner: PannerNode;
  level: number;
};

// Per-sound peak gains, balanced against the snap (measured output peaks
// with MASTER_VOLUME and the limiter: snap ~-7 dBFS; ticks ~10-14 dB and the
// resolve ~8-10 dB below it).
const SNAP_GAIN = 0.9;
const TICK_GAIN = 0.5;
/** Later (higher) ticks measure quieter; this extra gain at the last tick evens the fan-out. */
const TICK_RISE_GAIN = 0.35;
const RESOLVE_GAIN = 0.42;
/** Challenge win: a rising arpeggio at about the resolve's level. */
const WIN_GAIN = 0.4;
/** Hint: a soft chime, quieter than the win. */
const HINT_GAIN = 0.22;
const HUM_MAX_GAIN = 0.12;
const HUM_BASE_HZ = 160;
const HUM_RISE_HZ = 100;
const CLICK_DEBOUNCE_SECONDS = 0.1;

class JoinSounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: Hum | null = null;
  private world: World | null = null;
  private ownListener = false;
  private muted = false;
  private lastClick = -1;
  private hook: SoundHook | null = null;
  private analyser: AnalyserNode | null = null;
  private peakBuffer: ReturnType<typeof makeSampleBuffer> | null = null;
  private readonly _pos = new Vector3();
  private readonly _quat = new Quaternion();
  private readonly _fwd = new Vector3();
  private readonly _up = new Vector3();

  /** Builds the audio graph (suspended until `unlock`). Safe to call once at startup. */
  init(world: World, options: { muted?: boolean } = {}): void {
    this.world = world;
    this.muted = options.muted ?? false;
    try {
      const listener = findAudioListener(world);
      let destination: AudioNode;
      if (listener) {
        this.ctx = listener.context;
        destination = listener.getInput();
      } else {
        this.ctx = new AudioContext();
        destination = this.ctx.destination;
        this.ownListener = true;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 12;
      limiter.ratio.value = 4;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter);
      limiter.connect(destination);

      if (import.meta.env.DEV) {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.peakBuffer = makeSampleBuffer(this.analyser.fftSize);
        limiter.connect(this.analyser);
      }

      // Half a second of white noise, reused by every noisy sound.
      this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.hum = this.buildHum(ctx);
    } catch {
      this.ctx = null;
    }
  }

  /** Starts the audio context if it isn't running. Call from user gestures. Never throws. */
  unlock(): void {
    try {
      if (this.ctx && this.ctx.state !== 'running') {
        void this.ctx.resume().catch(() => {});
      }
    } catch {
      // Not allowed yet; a later gesture will try again.
    }
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Dev only: observe every sound event (with its measured peak level). */
  setHook(hook: SoundHook | null): void {
    this.hook = hook;
  }

  /** Per frame: moves our own listener to the head when we have no three.js listener. Allocation-free. */
  update(): void {
    if (!this.ownListener || !this.ctx || !this.world || !this.running) {
      return;
    }
    const head = this.world.player.head;
    head.updateWorldMatrix(true, false);
    this._pos.setFromMatrixPosition(head.matrixWorld);
    this._quat.setFromRotationMatrix(head.matrixWorld);
    this._fwd.set(0, 0, -1).applyQuaternion(this._quat);
    this._up.set(0, 1, 0).applyQuaternion(this._quat);
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = this._pos.x;
      l.positionY.value = this._pos.y;
      l.positionZ.value = this._pos.z;
      l.forwardX.value = this._fwd.x;
      l.forwardY.value = this._fwd.y;
      l.forwardZ.value = this._fwd.z;
      l.upX.value = this._up.x;
      l.upY.value = this._up.y;
      l.upZ.value = this._up.z;
    }
  }

  // --- Continuous: preview hum ----------------------------------------------

  /**
   * Per frame while a held slab approaches: `amount` 0..1 (0 = silent).
   * Only touches existing AudioParams, and only when the level changes.
   */
  setPreviewProximity(amount: number, at: Position): void {
    const hum = this.hum;
    if (!hum || !this.ctx || !this.running) {
      return;
    }
    const level = Math.max(0, Math.min(1, amount));
    if (Math.abs(level - hum.level) < 0.01 && level !== 0) {
      setPannerPosition(hum.panner, at);
      return;
    }
    if (level === 0 && hum.level === 0) {
      return;
    }
    hum.level = level;
    const now = this.ctx.currentTime;
    hum.gain.gain.setTargetAtTime(HUM_MAX_GAIN * level ** 1.5, now, 0.06);
    hum.oscA.frequency.setTargetAtTime(HUM_BASE_HZ + HUM_RISE_HZ * level, now, 0.08);
    hum.oscB.frequency.setTargetAtTime(HUM_BASE_HZ * 1.008 + HUM_RISE_HZ * level, now, 0.08);
    setPannerPosition(hum.panner, at);
  }

  // --- One-shots ----------------------------------------------------------------

  /** Dock: a low thunk with a short click. */
  playSnap(at: Position, delay = 0): void {
    this.oneShot('snap', at, delay, (ctx, out, t) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
      envelope(ctx, osc, out, t, SNAP_GAIN, 0.003, 0.14);
      this.noiseBurst(ctx, out, t, 'bandpass', 1800, 0.8, 0.25, 0.03);
    });
  }

  /** Separate: the snap reversed, softer and rising. */
  playRelease(at: Position, delay = 0): void {
    this.oneShot('release', at, delay, (ctx, out, t) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.12);
      envelope(ctx, osc, out, t, 0.5, 0.02, 0.18);
      this.noiseBurst(ctx, out, t + 0.04, 'lowpass', 900, 0.7, 0.12, 0.06);
    });
  }

  /** One match line drawing: a soft tick, rising across the sequence. */
  playLineTick(at: Position, index: number, count: number, delay = 0): void {
    this.oneShot('lineTick', at, delay, (ctx, out, t) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const along = count > 1 ? index / (count - 1) : 0;
      osc.frequency.value = 1600 + 800 * along;
      envelope(ctx, osc, out, t, TICK_GAIN * (1 + TICK_RISE_GAIN * along), 0.002, 0.03);
    });
  }

  /** Result fully assembled: two light notes, a fifth apart. */
  playResolve(at: Position, delay = 0): void {
    this.oneShot('resolve', at, delay, (ctx, out, t) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3000;
      filter.connect(out);
      for (const [freq, offset] of [
        [440, 0],
        [659.25, 0.09],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        envelope(ctx, osc, filter, t + offset, RESOLVE_GAIN, 0.005, 0.22);
      }
    });
  }

  /** Challenge solved: three rising notes (a major triad), brighter than the resolve. */
  playWin(at: Position, delay = 0): void {
    this.oneShot('win', at, delay, (ctx, out, t) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4000;
      filter.connect(out);
      for (const [freq, offset] of [
        [523.25, 0],
        [659.25, 0.1],
        [783.99, 0.2],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        envelope(ctx, osc, filter, t + offset, WIN_GAIN, 0.006, 0.35);
      }
    });
  }

  /** Hint shown: one soft, bell-like chime. */
  playHint(at: Position, delay = 0): void {
    this.oneShot('hint', at, delay, (ctx, out, t) => {
      for (const [freq, gain] of [
        [880, HINT_GAIN],
        [1760, HINT_GAIN * 0.3],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        envelope(ctx, osc, out, t, gain, 0.004, 0.4);
      }
    });
  }

  /** Unmatched rows land: a soft, low, muted tap. */
  playDropTap(at: Position, delay = 0): void {
    this.oneShot('dropTap', at, delay, (ctx, out, t) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      filter.connect(out);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.06);
      envelope(ctx, osc, filter, t, 0.5, 0.003, 0.09);
    });
  }

  /** Control press: a crisp UI click (debounced, so a poke + ray double-fire clicks once). */
  playClick(at: Position, delay = 0): void {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastClick < CLICK_DEBOUNCE_SECONDS) {
      return;
    }
    this.lastClick = now;
    this.oneShot('click', at, delay, (ctx, out, t) => {
      this.noiseBurst(ctx, out, t, 'highpass', 2500, 0.7, 0.35, 0.012);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2200;
      envelope(ctx, osc, out, t, 0.1, 0.001, 0.006);
    });
  }

  /** The LEFT-only row sliding in (rising) or out (falling). */
  playSlide(at: Position, direction: 'in' | 'out', delay = 0): void {
    this.oneShot(direction === 'in' ? 'slideIn' : 'slideOut', at, delay, (ctx, out, t) => {
      if (!this.noise) {
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 2;
      const [from, to] = direction === 'in' ? [600, 1800] : [1800, 600];
      filter.frequency.setValueAtTime(from, t);
      filter.frequency.exponentialRampToValueAtTime(to, t + 0.25);
      source.connect(filter);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.linearRampToValueAtTime(0, t + 0.25);
      filter.connect(gain);
      gain.connect(out);
      source.start(t);
      source.stop(t + 0.27);
    });
  }

  // --- Internals -----------------------------------------------------------------

  /** Runs `build` with a panner at `at` as its output, `delay` s from now. */
  private oneShot(
    name: SoundName,
    at: Position,
    delay: number,
    build: (ctx: AudioContext, out: AudioNode, t: number) => void,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.running || this.muted) {
      this.report(name, delay, null);
      return;
    }
    try {
      const panner = createPanner(ctx, at);
      panner.connect(this.master);
      build(ctx, panner, ctx.currentTime + Math.max(0, delay));
      // Drop the panner once everything routed through it has finished.
      setTimeout(() => panner.disconnect(), (delay + 1) * 1000);
      this.report(name, delay, 0);
    } catch {
      // A failed sound never breaks the interaction.
    }
  }

  /** Dev only: tells the hook, after the sound has played, how loud it came out. */
  private report(name: SoundName, delay: number, played: number | null): void {
    if (!import.meta.env.DEV || !this.hook) {
      return;
    }
    const hook = this.hook;
    if (played === null) {
      hook(name, delay, null);
      return;
    }
    setTimeout(() => hook(name, delay, this.measurePeakDb()), (delay + 0.04) * 1000);
  }

  /** Dev only: peak of the last ~40 ms of output, in dBFS. Works even if the browser is muted. */
  private measurePeakDb(): number | null {
    if (!this.analyser || !this.peakBuffer) {
      return null;
    }
    this.analyser.getFloatTimeDomainData(this.peakBuffer);
    let peak = 0;
    for (const sample of this.peakBuffer) {
      peak = Math.max(peak, Math.abs(sample));
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  private noiseBurst(
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    type: BiquadFilterType,
    frequency: number,
    q: number,
    peak: number,
    length: number,
  ): void {
    if (!this.noise) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    source.connect(filter);
    envelope(ctx, filter, out, t, peak, 0.001, length, source);
  }

  private buildHum(ctx: AudioContext): Hum {
    const panner = createPanner(ctx, { x: 0, y: 0, z: 0 });
    panner.connect(this.master!);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.connect(gain);
    gain.connect(panner);
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'sine';
    oscA.frequency.value = HUM_BASE_HZ;
    oscB.frequency.value = HUM_BASE_HZ * 1.008;
    oscA.connect(filter);
    oscB.connect(filter);
    oscA.start();
    oscB.start();
    return { oscA, oscB, gain, panner, level: 0 };
  }
}

/**
 * Routes `node` through a gain envelope into `out`: rises to `peak` over
 * `attack` s, then decays exponentially to silence by `length` s. Starts
 * and stops `source` (default: `node` itself, when it's a scheduled source).
 */
function envelope(
  ctx: AudioContext,
  node: AudioNode,
  out: AudioNode,
  t: number,
  peak: number,
  attack: number,
  length: number,
  source: AudioScheduledSourceNode | null = node instanceof AudioScheduledSourceNode ? node : null,
): void {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, t + length);
  node.connect(gain);
  gain.connect(out);
  if (source) {
    source.start(t);
    source.stop(t + length + 0.02);
  }
}

function createPanner(ctx: AudioContext, at: Position): PannerNode {
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 0.5;
  panner.rolloffFactor = 1;
  setPannerPosition(panner, at);
  return panner;
}

function setPannerPosition(panner: PannerNode, at: Position): void {
  if (panner.positionX) {
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
  } else {
    panner.setPosition(at.x, at.y, at.z);
  }
}

function makeSampleBuffer(length: number) {
  return new Float32Array(length);
}

type ThreeAudioListener ={ context: AudioContext; getInput(): AudioNode; type?: string };

/** IWSDK's three.js AudioListener, attached under the player's head. */
function findAudioListener(world: World): ThreeAudioListener | null {
  let found: ThreeAudioListener | null = null;
  world.player.head.traverse((object) => {
    const candidate = object as unknown as ThreeAudioListener;
    if (!found && candidate.type === 'AudioListener' && candidate.context) {
      found = candidate;
    }
  });
  return found;
}

/** The app's single sound player. */
export const sounds = new JoinSounds();
