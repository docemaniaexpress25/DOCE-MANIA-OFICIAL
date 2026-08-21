"use client";
"use client";

import React, { useState } from 'react';
import { Sale, Client, Product } from '@/types';
import { printerService } from '@/services/printerService';

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
  const [printWidth, setPrintWidth] = useState<'56MM' | '80MM'>('56MM');

  const generateText = (width: '56MM' | '80MM') => {
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

  const handlePrint = async () => {
    if (!showToast) return;
    const rawText = generateText(printWidth);
    showToast(`Imprimindo...`);

    try {
      const success = await printerService.printNative(rawText);
      if (success) showToast("Impresso!", 'success');
    } catch (error) {
      showToast("Erro de impressão.", 'error');
    }
  };

  const handleCopy = () => {
    const rawText = generateText(printWidth);
    navigator.clipboard.writeText(rawText);
    if (showToast) showToast("Copiado!", 'success');
  };

  const handleDelete = () => {
    if (onDeleteSale && window.confirm("ATENÇÃO: Deseja EXCLUIR esta venda permanentemente? O estoque será devolvido ao vendedor.")) {
      onDeleteSale(sale.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[150] flex flex-col items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-300 relative rounded-t-3xl overflow-hidden">
        
        <button 
          onClick={onBack || onClose} 
          className="absolute top-4 right-4 w-10 h-10 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center active:scale-90 transition-transform z-20 shadow-md"
        >
          <i className="fa-solid fa-arrow-left"></i>
        </button>

        <div className="p-6 bg-white overflow-hidden mt-4">
          <div className="font-mono text-[11px] leading-tight text-black bg-white whitespace-pre select-none border-l-2 border-gray-100 pl-4">
            {generateText(printWidth)}
          </div>
        </div>

        <div className="bg-gray-100 p-5 flex flex-col gap-3 border-t border-gray-200">
          <div className="flex bg-gray-200 p-1 rounded-2xl mb-1">
            <button onClick={() => setPrintWidth('56MM')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>56mm</button>
            <button onClick={() => setPrintWidth('80MM')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}>80mm</button>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handlePrint} className="bg-blue-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg">
              <i className="fa-solid fa-print"></i> Imprimir
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