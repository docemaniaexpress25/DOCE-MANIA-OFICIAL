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
// BLOCO 82: no iPhone a Apple bloqueia Web Bluetooth em TODO navegador (Safari/Chrome/Firefox iOS).
// O caminho que funciona é abrir o sistema no app Bluefy (App Store, grátis) — instruções aqui.
import { isIOSDevice, TEXTO_IMPRESSAO_IOS } from '@/lib/iosPrint';

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
  // BLOCO 82: painel de instruções do iPhone (abre/fecha ao tocar)
  const [showIosHelp, setShowIosHelp] = useState(false);

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

  // BLOCO 82: iPhone não tem navigator.bluetooth (Apple bloqueia) — o botão de buscar
  // nunca funcionaria; em vez disso vira "Como imprimir" e abre o passo a passo do Bluefy.
  const iosSemBluetooth = !bluetoothPrinter.isAvailable() && isIOSDevice();

  // Garante que a impressora ativa apareça na lista mesmo se getDevices
  // nao estiver disponivel neste navegador.
  const options = [...known];
  if (activeId && !known.some(p => p.id === activeId)) {
    options.unshift({ id: activeId, name: activeName || 'Impressora atual' });
  }

  return (
    <div className={`flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 ${iosSemBluetooth ? 'flex-wrap' : ''}`}>
      <i className={`fa-brands ${iosSemBluetooth ? 'fa-apple' : 'fa-bluetooth-b'} text-xs ${iosSemBluetooth ? 'text-gray-400' : s.icon}`} aria-hidden="true"></i>

      {iosSemBluetooth ? (
        <span className="flex-1 min-w-0 truncate text-[10px] font-bold text-gray-500">
          iPhone: use o app Bluefy para imprimir
        </span>
      ) : options.length > 1 ? (
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

      {iosSemBluetooth ? (
        <button
          onClick={() => setShowIosHelp(v => !v)}
          aria-expanded={showIosHelp}
          className="flex-shrink-0 text-[9px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform bg-amber-500 text-white"
        >
          {showIosHelp ? 'Fechar' : 'Como imprimir'}
        </button>
      ) : (
        <button
          onClick={handleOpenChooser}
          disabled={busy}
          className={`flex-shrink-0 text-[9px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform disabled:opacity-50 ${s.btn}`}
        >
          {busy ? <i className="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> : (known.length > 0 ? 'Trocar' : 'Buscar')}
        </button>
      )}

      {iosSemBluetooth && showIosHelp && (
        <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 mt-1">
          <p className="text-[9px] font-black text-amber-700 uppercase tracking-wide mb-2">Passo a passo (2 min, grátis)</p>
          <ol className="text-[10px] font-bold text-gray-700 space-y-1.5 list-decimal list-inside leading-snug">
            <li>Na App Store, instale o app <span className="text-amber-700">“Bluefy - Web BLE Browser”</span></li>
            <li>Abra o Bluefy e entre no site do sistema: <span className="font-mono text-[9px] break-all bg-white border border-gray-200 rounded px-1 py-0.5">{typeof window !== 'undefined' ? window.location.origin : ''}</span></li>
            <li>Faça login normalmente</li>
            <li>Toque em Imprimir — o seletor de Bluetooth abre no Bluefy</li>
            <li>Aceite a permissão de Bluetooth do iPhone</li>
          </ol>
          <p className="text-[9px] font-bold text-gray-400 mt-2 leading-snug">A Apple bloqueia Bluetooth em todos os navegadores do iPhone (Safari, Chrome, Firefox) — não é falha do sistema. O cupom sai na mesma impressora de sempre.</p>
        </div>
      )}
    </div>
  );
};

export default PrinterSelector;
