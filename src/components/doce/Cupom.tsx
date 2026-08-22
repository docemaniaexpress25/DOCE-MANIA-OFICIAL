"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Sale, Client, Product } from '@/lib/types';
import { bluetoothPrinter, PrintJob } from '@/services/bluetoothPrinterService';

type PrinterWidth = '56MM' | '80MM';

interface CupomProps {
  sale: Sale;
  client: Client;
  products: Product[];
  onClose: () => void;
  onBack?: () => void;
  onDeleteSale?: (saleId: string) => void;
  allowDelete?: boolean;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  closeLabel?: string; 
}

const Cupom: React.FC<CupomProps> = ({ sale, client, products, onClose, onBack, onDeleteSale, allowDelete, showToast, closeLabel }) => {
  const [printWidth, setPrintWidth] = useState<PrinterWidth>('56MM');
  const [printJob, setPrintJob] = useState<PrintJob>({ status: 'idle' });
  const [isBluetoothAvailable] = useState(() => bluetoothPrinter.isAvailable());

  // Subscribe to print job status
  useEffect(() => {
    bluetoothPrinter.onStatus(setPrintJob);
    return () => bluetoothPrinter.onStatus(null);
  }, []);

  // Check connection on mount
  useEffect(() => {
    if (isBluetoothAvailable) {
      bluetoothPrinter.reconnect();
    }
  }, [isBluetoothAvailable]);

  const generateText = (width: PrinterWidth): string => {
    const totalWidth = width === '80MM' ? 48 : 32; 
    
    const padR = (str: string, len: number) => str.substring(0, len).padEnd(len);
    const padL = (str: string, len: number) => str.substring(0, len).padStart(len);
    const center = (str: string, len: number) => {
      const s = str.substring(0, len);
      const spaces = Math.max(0, Math.floor((len - s.length) / 2));
      return ' '.repeat(spaces) + s;
    };

    let t = '';
    
    t += '*'.repeat(totalWidth) + '\n';
    t += center('CUPOM NAO FISCAL', totalWidth) + '\n';
    t += '*'.repeat(totalWidth) + '\n';
    
    const clientName = client.nomeFantasia || 'Consumidor';
    t += `Cliente: ${clientName}\n`;
    t += `Data: ${new Date(sale.data).toLocaleDateString()} ${new Date(sale.data).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}\n`;
    t += '-'.repeat(totalWidth) + '\n';

    const qtyW = 4;
    const valW = width === '80MM' ? 13 : 8;
    const descW = totalWidth - qtyW - valW;

    t += padR('DESCRICAO', descW) + padL('QTD', qtyW) + padL('VALOR', valW) + '\n';
    t += '-'.repeat(totalWidth) + '\n';

    (sale.itens || []).forEach(item => {
      const p = products.find(prod => prod.id === item.produtoId);
      const productName = (p?.nome ?? 'Produto');
      
      const qtyStr = `${item.quantidade}x`;
      const valStr = `${(item.quantidade * item.precoVenda).toFixed(2)}`;

      t += padR(productName.substring(0, descW), descW) + padL(qtyStr, qtyW) + padL(valStr, valW) + '\n';

      let remaining = productName.substring(descW);
      while (remaining.length > 0) {
        t += padR(remaining.substring(0, totalWidth), totalWidth) + '\n';
        remaining = remaining.substring(totalWidth);
      }
    });

    t += '-'.repeat(totalWidth) + '\n';
    
    const totalLabel = 'TOTAL GERAL:';
    const totalVal = `R$ ${(sale.valorTotal || 0).toFixed(2)}`;
    t += padR(totalLabel, totalWidth - totalVal.length) + totalVal + '\n';
    
    t += `Metodo: ${sale.metodoPagamento}\n`;
    
    if (sale.detalhePagamento) {
      t += `Info: ${sale.detalhePagamento}\n`;
    }
    
    if (sale.statusPagamento === 'PENDENTE' && sale.dataVencimento) {
      t += `Vencimento: ${new Date(sale.dataVencimento).toLocaleDateString()}\n`;
    }

    t += '-'.repeat(totalWidth) + '\n';
    t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
    t += '*'.repeat(totalWidth) + '\n';
    t += '\n\n\n\n\n';

    return t;
  };

  const handlePrint = useCallback(async () => {
    if (!showToast) return;

    // --- NATIVE CONFIRMATION ---
    const widthLabel = printWidth === '80MM' ? '80mm (Largo)' : '56mm (Estreito)';
    const confirmed = window.confirm(
      `Deseja imprimir este cupom?\n\nModelo: ${widthLabel}\nItens: ${(sale.itens || []).length}\nTotal: R$ ${(sale.valorTotal || 0).toFixed(2)}\n\nToque em OK para continuar.`
    );
    if (!confirmed) return;

    const rawText = generateText(printWidth);

    try {
      // bluetoothPrinter.print() handles the full flow:
      // 1. Checks Bluetooth availability
      // 2. If no printer connected, asks to scan (native picker)
      // 3. Connects, confirms, and prints
      showToast('Preparando impressao...');
      const success = await bluetoothPrinter.print(rawText, printWidth);

      if (success) {
        window.alert('Cupom impresso com sucesso!');
        showToast('Impresso com sucesso!', 'success');
      }
    } catch (error: any) {
      const msg = error?.message || 'Erro desconhecido';
      
      if (msg === 'BLUETOOTH_NAO_SUPORTADO') {
        window.alert(
          'Bluetooth nao suportado.\n\n' +
          'Para impressao nativa via Bluetooth, abra o app no Chrome do Android.\n' +
          'Certifique-se de que o Bluetooth esta ativado nas configuracoes.'
        );
      } else if (msg.includes('SERVICO_NAO_ENCONTRADO') || msg.includes('CARACTERISTICA')) {
        window.alert(
          'Impressora conectada, mas o servico de impressao nao foi encontrado.\n\n' +
          'Certifique-se de que a impressora esta ligada e pareada.\n' +
          'Tente desconectar e reconectar.'
        );
        bluetoothPrinter.forgetPrinter();
      } else {
        window.alert(`Falha na impressao: ${msg}`);
      }
      showToast('Erro na impressao.', 'error');
    }
  }, [printWidth, sale, showToast, generateText]);

  const handleCopy = () => {
    const rawText = generateText(printWidth);
    navigator.clipboard.writeText(rawText);
    if (showToast) showToast("Copiado!", 'success');
  };

  const handleDelete = () => {
    // NATIVE confirmation dialog
    if (onDeleteSale && window.confirm(
      "ATENCAO: Deseja EXCLUIR esta venda permanentemente?\n\nO estoque sera devolvido ao vendedor. Esta acao nao pode ser desfeita."
    )) {
      onDeleteSale(sale.id);
      onClose();
    }
  };

  const isConnected = bluetoothPrinter.isConnected();
  const printerName = bluetoothPrinter.getConnectedPrinterName();

  // Status badge color & text
  const getStatusBadge = () => {
    switch (printJob.status) {
      case 'scanning':
        return { color: 'bg-amber-100 text-amber-700', icon: 'fa-magnifying-glass', text: 'Buscando impressora...' };
      case 'connecting':
        return { color: 'bg-amber-100 text-amber-700', icon: 'fa-link', text: `Conectando a ${printJob.printerName || 'impressora'}...` };
      case 'connected':
        return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-link', text: `${printJob.printerName || 'Impressora'} conectada` };
      case 'printing':
        return { color: 'bg-blue-100 text-blue-700', icon: 'fa-print', text: `Imprimindo... ${printJob.progress || 0}%` };
      case 'done':
        return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-check', text: 'Impresso!' };
      case 'error':
        return { color: 'bg-red-100 text-red-700', icon: 'fa-triangle-exclamation', text: printJob.error || 'Erro' };
      default:
        if (isConnected) {
          return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-bluetooth-b', text: printerName || 'Conectado' };
        }
        return { color: 'bg-gray-100 text-gray-500', icon: 'fa-bluetooth-b', text: isBluetoothAvailable ? 'Nenhuma impressora conectada' : 'Bluetooth indisponivel' };
    }
  };

  const badge = getStatusBadge();
  const isPrinting = printJob.status === 'printing' || printJob.status === 'scanning' || printJob.status === 'connecting';

  return (
    <div className="fixed inset-0 bg-black/90 z-[150] flex flex-col items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-300 relative rounded-t-3xl overflow-hidden">
        
        <button 
          onClick={onBack || onClose} 
          className="absolute top-4 right-4 w-10 h-10 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center active:scale-90 transition-transform z-20 shadow-md"
        >
          <i className="fa-solid fa-arrow-left"></i>
        </button>

        {/* Bluetooth Status Bar */}
        <div className={`mx-4 mt-4 px-3 py-2 rounded-xl flex items-center gap-2 text-[10px] font-bold ${badge.color}`}>
          <i className={`fa-solid ${badge.icon}`}></i>
          <span className="flex-1 truncate">{badge.text}</span>
          {isConnected && printJob.status === 'idle' && (
            <button 
              onClick={() => {
                window.confirm(`Desconectar a impressora "${printerName}"?`) && bluetoothPrinter.forgetPrinter();
              }}
              className="text-[9px] opacity-70 underline"
            >
              Desconectar
            </button>
          )}
        </div>

        {/* Print progress bar */}
        {printJob.status === 'printing' && (
          <div className="mx-4 mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${printJob.progress || 0}%` }}
            />
          </div>
        )}

        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[11px] leading-tight text-black bg-white whitespace-pre select-none border-l-2 border-gray-100 pl-4">
            {generateText(printWidth)}
          </div>
        </div>

        <div className="bg-gray-100 p-5 flex flex-col gap-3 border-t border-gray-200">
          {/* Paper width selector */}
          <div className="flex bg-gray-200 p-1 rounded-2xl mb-1">
            <button 
              onClick={() => setPrintWidth('56MM')} 
              className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
            >
              <i className="fa-solid fa-receipt mr-1"></i>56mm
            </button>
            <button 
              onClick={() => setPrintWidth('80MM')} 
              className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}
            >
              <i className="fa-solid fa-receipt mr-1"></i>80mm
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={handlePrint} 
              disabled={isPrinting}
              className={`font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg transition-all ${
                isPrinting 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-600 text-white'
              }`}
            >
              <i className={`fa-solid ${isPrinting ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> 
              {isPrinting ? 'Imprimindo...' : 'Imprimir'}
            </button>
            <button onClick={handleCopy} className="bg-emerald-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg">
              <i className="fa-solid fa-copy"></i> Copiar
            </button>
          </div>

          {allowDelete && onDeleteSale && (
            <button onClick={handleDelete} className="w-full bg-white text-rose-600 border border-rose-100 font-black py-4 rounded-2xl active:scale-95 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-rose-50 transition-colors">
              <i className="fa-solid fa-trash-can"></i> Estornar / Excluir Venda
            </button>
          )}
          
          <button onClick={onClose} className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl active:scale-95 text-[10px] uppercase tracking-widest shadow-xl">
            {closeLabel || "FECHAR"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Cupom;
