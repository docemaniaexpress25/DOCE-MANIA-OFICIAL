/**
 * offlineSync.ts - Offline-first com fila de sincronizacao
 * Detecta online/offline, mostra status, e enfileira operacoes pendentes.
 */

type QueuedOp = {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
};

const QUEUE_KEY = 'offline_queue';

function getQueue(): QueuedOp[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedOp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export const offlineSync = {
  isOnline(): boolean {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  },

  getPendingCount(): number {
    return getQueue().length;
  },

  /** Adiciona operacao na fila offline */
  enqueue(type: string, payload: any): void {
    const queue = getQueue();
    queue.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      payload,
      timestamp: Date.now(),
    });
    saveQueue(queue);
  },

  /** Remove operacao da fila */
  dequeue(id: string): void {
    const queue = getQueue().filter(op => op.id !== id);
    saveQueue(queue);
  },

  /** Limpa toda a fila */
  clearQueue(): void {
    saveQueue([]);
  },

  /** Listener para mudancas de conexao */
  onConnectionChange(callback: (online: boolean) => void): () => void {
    const handler = () => callback(navigator.onLine);
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    return () => {
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
    };
  },
};
