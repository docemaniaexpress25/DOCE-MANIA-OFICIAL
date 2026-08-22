/**
 * sound.ts - Efeitos sonoros nativos via Web Audio API
 * Som de caixa registradora ao finalizar venda, sem arquivos externos.
 */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Toca um tom com envelope ADSR simplificado */
function playTone(freq: number, start: number, duration: number, gain: number = 0.3, type: OscillatorType = 'sine') {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);

  osc.connect(g);
  g.connect(ctx.destination);

  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.01);
}

export const sounds = {
  isSupported(): boolean {
    return typeof window !== 'undefined' && !!(window.AudioContext || (window as any).webkitAudioContext);
  },

  /**
   * Som de caixa registradora (ka-ching!)
   * Dois tons ascendentes: "ding" agudo + "ching" metálico
   */
  kaChing(): void {
    if (!this.isSupported()) return;
    // Ding (agudo, brilhante)
    playTone(1200, 0, 0.15, 0.25, 'sine');
    // Ching (metálico, mais alto)
    playTone(1800, 0.12, 0.2, 0.2, 'triangle');
    // Harmônico shimmer
    playTone(2400, 0.15, 0.25, 0.08, 'sine');
  },

  /** Som de erro curto */
  error(): void {
    if (!this.isSupported()) return;
    playTone(250, 0, 0.15, 0.2, 'square');
    playTone(200, 0.1, 0.15, 0.15, 'square');
  },

  /** Som de notificação */
  notification(): void {
    if (!this.isSupported()) return;
    playTone(800, 0, 0.1, 0.2, 'sine');
    playTone(1000, 0.08, 0.12, 0.2, 'sine');
  },
};
