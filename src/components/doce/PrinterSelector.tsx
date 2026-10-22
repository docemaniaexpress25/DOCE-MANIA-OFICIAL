"use client";

/**
 * PrinterSelector.tsx
 * Barra compacta de selecao de impressora Bluetooth.
 *
 * - 1 impressora pareada: mostra o nome e usa como PADRAO automaticamente.
 * - 2+ impressoras pareadas: mostra um dropdown para o vendedor escolher
 *   qual usar na hora (a escolhida vira o novo padrao).
 * - Botao "Trocar"/"Buscar": abre o seletor nativo do Chrome para parear
 *   outra impressora ou escolher entre as disponiveis.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { bluetoothPrinter, KnownPrinter } from '@/services/bluetoothPrinterService';

type Accent = 'blue' | 'indigo' | 'slate';

const ACCENT_STYLES: Record<Accent, { btn: string; select: string; icon: string }> = {
  blue: {
    btn: 'bg-blue-600 text-white',
    select: 'bg-blue-50 text-blue-800 border-blue-200',
    icon: 'text-blue-500',
  },
  indigo: {
    btn: 'bg-indigo-600 text-white',
    select: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    icon: 'text-indigo-500',
  },
  slate: {
    btn: 'bg-slate-700 text-white',
    select: 'bg-slate-100 text-slate-800 border-slate-300',
    icon: 'text-slate-500',
  },
};

interface PrinterSelectorProps {
  accent?: Accent;
}

const PrinterSelector: React.FC<PrinterSelectorProps> = ({ accent = 'blue' }) => {
  const [known, setKnown] = useState<KnownPrinter[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await bluetoothPrinter.listKnownPrinters();
      setKnown(list);
    } catch {
      setKnown([]);
    }
    setActiveId(bluetoothPrinter.getConnectedPrinterId());
    setActiveName(bluetoothPrinter.getConnectedPrinterName() || bluetoothPrinter.getSavedPrinterName());
  }, []);

  useEffect(() => {
    refresh();
    // Atualiza o rotulo sempre que o status da conexao mudar
    const unsubscribe = bluetoothPrinter.onStatus(() => { refresh(); });
    return unsubscribe;
  }, [refresh]);

  const handleSwitch = async (id: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await bluetoothPrinter.connectToPrinter(id);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleOpenChooser = async () => {
    setBusy(true);
    try {
      await bluetoothPrinter.scanAndConnect();
    } catch {
      // Fluxos de erro ja sao tratados pelos componentes de impressao
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const s = ACCENT_STYLES[accent];

  // Garante que a impressora ativa apareça na lista mesmo se getDevices
  // nao estiver disponivel neste navegador.
  const options = [...known];
  if (activeId && !known.some(p => p.id === activeId)) {
    options.unshift({ id: activeId, name: activeName || 'Impressora atual' });
  }

  return (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
      <i className={`fa-brands fa-bluetooth-b text-xs ${s.icon}`} aria-hidden="true"></i>

      {options.length > 1 ? (
        <select
          value={activeId ?? ''}
          onChange={(e) => handleSwitch(e.target.value)}
          disabled={busy}
          className={`flex-1 min-w-0 text-[10px] font-bold rounded-lg px-2 py-1.5 border disabled:opacity-50 ${s.select}`}
          aria-label="Escolher impressora"
        >
          {!activeId && <option value="">{options.length} impressoras pareadas</option>}
          {options.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}{p.id === activeId ? ' (padrao)' : ''}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1 min-w-0 truncate text-[10px] font-bold text-gray-600">
          {activeName || 'Nenhuma impressora salva'}
        </span>
      )}

      <button
        onClick={handleOpenChooser}
        disabled={busy}
        className={`flex-shrink-0 text-[9px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform disabled:opacity-50 ${s.btn}`}
      >
        {busy ? <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> : (known.length > 0 ? 'Trocar' : 'Buscar')}
      </button>
    </div>
  );
};

export default PrinterSelector;
