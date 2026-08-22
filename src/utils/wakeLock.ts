/**
 * wakeLock.ts - Mantém a tela do Android acordada
 * Usado no PDV para que a tela não apague durante a venda.
 */

let wakeLock: WakeLockSentinel | null = null;

export const wakeLockManager = {
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  },

  async acquire(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      if (wakeLock && !wakeLock.released) return true;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return true;
    } catch {
      return false;
    }
  },

  async release(): Promise<void> {
    if (wakeLock && !wakeLock.released) {
      await wakeLock.release();
      wakeLock = null;
    }
  },

  isActive(): boolean {
    return !!wakeLock && !wakeLock.released;
  },
};
