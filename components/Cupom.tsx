"use client";

import React, { useState } from 'react';
import { Sale, Client, Product } from '../types';
import { printerService } from '../services/printerService';

interface CupomProps {
  sale: Sale;
  client: Client;
  products: Product[];
  onClose: () => void;
  onBack?: () => void; // Nova prop para ação de voltar
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
    t += '-'.repeat(totalWidth) + '\n';

    const qtyW = 4;
    const valW = width === '80MM' ? 13 : 8;
    const descW = totalWidth - qtyW - valW;

    t += padR('DESCRICAO', descW) + padL('QTD', qtyW) + padL('VALOR', valW) + '\n';
    t += '-'.repeat(totalWidth) + '\n';

    sale.itens.forEach(item => {
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
    
    const totalLabel = 'TOTAL:';
    const totalVal = `R$ ${sale.valorTotal.toFixed(2)}`;
    t += padR(totalLabel, totalWidth - totalVal.length) + totalVal + '\n';
    
    t += `Forma de Pagamento: ${sale.metodoPagamento}\n`;
    
    if (sale.detalhePagamento && sale.metodoPagamento !== 'DINHEIRO') {
      t += `Detalhe: ${sale.detalhePagamento}\n`;
    }
    
    t += '-'.repeat(totalWidth) + '\n';
    t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
    t += center('ESCANEIE O QR CODE', totalWidth) + '\n';
    t += center('E PAGUE COM PIX', totalWidth) + '\n';
    
    t += '*'.repeat(totalWidth) + '\n';
    t += '\n\n\n\n\n';

    return t;
  };

  const handlePrint = async () => {
    if (!showToast) return;
    const rawText = generateText(printWidth);
    showToast(`Enviando para impressora...`);

    try {
      const success = await printerService.printNative(rawText);
      if (success) showToast("Impresso com sucesso!", 'success');
    } catch (error) {
      showToast("Erro na conexão nativa Bluetooth.", 'error');
    }
  };

  const handleCopy = () => {
    const rawText = generateText(printWidth);
    navigator.clipboard.writeText(rawText);
    if (showToast) showToast("Texto copiado!", 'success');
  };

  const handleDelete = () => {
    if (onDeleteSale && window.confirm("Tem certeza que deseja excluir esta venda? Esta ação é irreversível e estornará o estoque do vendedor.")) {
      onDeleteSale(sale.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 relative">
        {/* Botão de Voltar que retorna à edição de produtos quando acionado do PDV */}
        <button 
          onClick={onBack || onClose} 
          className="absolute top-4 right-4 w-10 h-10 bg-gray-100 text-gray-500 rounded-2xl flex items-center justify-center active:scale-90 transition-transform z-10 shadow-sm"
        >
          <i className="fa-solid fa-arrow-left"></i>
        </button>

        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[12px] leading-tight text-black bg-white whitespace-pre select-none">
            {generateText(printWidth)}
          </div>
        </div>
        <div className="bg-gray-100 p-4 flex flex-col gap-2 border-t border-gray-200">
          <div className="flex bg-gray-200 p-1 rounded-xl mb-1">
            <button onClick={() => setPrintWidth('56MM')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>56MM</button>
            <button onClick={() => setPrintWidth('80MM')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}>80MM</button>
          </div>
          
          <div className="flex gap-2">
            <button onClick={handlePrint} className="flex-[2] bg-blue-600 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 text-[9px] uppercase tracking-tighter">
              <i className="fa-solid fa-print"></i> IMPRIMIR
            </button>
            <button onClick={handleCopy} className="flex-1 bg-emerald-600 text-white font-black py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 text-[9px] uppercase tracking-tighter">
              <i className="fa-solid fa-copy"></i> COPIAR
            </button>
          </div>

          {allowDelete && onDeleteSale && (
            <button onClick={handleDelete} className="w-full bg-rose-50 text-rose-600 border border-rose-100 font-black py-3 rounded-xl active:scale-95 text-[9px] uppercase flex items-center justify-center gap-2">
              <i className="fa-solid fa-trash-can"></i> Excluir Venda
            </button>
          )}
          
          <button onClick={onClose} className="w-full bg-slate-800 text-white font-black py-3 rounded-xl active:scale-95 text-[9px] uppercase">
            {closeLabel || "FECHAR"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Cupom;