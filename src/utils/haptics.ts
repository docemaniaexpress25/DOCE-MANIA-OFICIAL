/**
 * haptics.ts - Feedback háptico nativo do Android
 * Usa a Vibration API para padrões de vibração em ações do app.
 */

export const haptics = {
  /** Disponivel? */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator;
  },

  /** Tap leve de botao (10ms) */
  tap(): void {
    if (!this.isSupported()) return;
    try { navigator.vibrate(10); } catch {}
  },

  /** Dupla vibracao - sucesso/venda concluida */
  success(): void {
    if (!this.isSupported()) return;
    try { navigator.vibrate([30, 50, 30]); } catch {}
  },

  /** Vibracao longa - erro */
  error(): void {
    if (!this.isSupported()) return;
    try { navigator.vibrate(200); } catch {}
  },

  /** Padrao de notificacao */
  notification(): void {
    if (!this.isSupported()) return;
    try { navigator.vibrate([50, 30, 50, 30, 80]); } catch {}
  },

  /** Vibracao de confirmacao/media */
  medium(): void {
    if (!this.isSupported()) return;
    try { navigator.vibrate(20); } catch {}
  },
};
