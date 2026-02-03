"use client";

import React, { useState } from 'react';
import { Sale, Client, Product } from '../types';
import { printerService } from '../services/printerService';

interface CupomProps {
  sale: Sale;
  client: Client;
  products: Product[];
  onClose: () => void;
  onDeleteSale?: (saleId: string) => void;
  allowDelete?: boolean;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

const Cupom: React.FC<CupomProps> = ({ sale, client, products, onClose, onDeleteSale, allowDelete, showToast }) => {
  const [printWidth, setPrintWidth] = useState<'56MM' | '80MM'>('56MM');

  /**
   * Formata o texto para ESC/POS com largura fixa rigorosa (32 colunas para 56mm).
   */
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
    
    // Cabeçalho ESC/POS
    t += '-'.repeat(totalWidth) + '\n';
    t += center('CUPOM NAO FISCAL', totalWidth) + '\n';
    t += '-'.repeat(totalWidth) + '\n';
    
    const clientName = (client.nomeFantasia || 'CONSUMIDOR').toUpperCase();
    t += `CLIENTE: ${clientName}\n`;
    t += '-'.repeat(totalWidth) + '\n';

    // Colunas Rígidas: DESC(20) | QTD(4) | VAL(8) = 32
    const qtyW = 4;
    const valW = width === '80MM' ? 13 : 8;
    const descW = totalWidth - qtyW - valW;

    t += padR('DESCRICAO', descW) + padL('QTD', qtyW) + padL('VALOR', valW) + '\n';
    t += '-'.repeat(totalWidth) + '\n';

    sale.itens.forEach(item => {
      const p = products.find(prod => prod.id === item.produtoId);
      const rawName = (p?.nome ?? 'PRODUTO').toUpperCase();
      
      const qtyStr = `${item.quantidade}X`;
      const valStr = `R$ ${(item.quantidade * item.precoVenda).toFixed(2)}`;

      // Primeira linha do item (alinhamento fixo)
      t += padR(rawName.substring(0, descW), descW) + padL(qtyStr, qtyW) + padL(valStr, valW) + '\n';

      // Quebra manual de descrição longa
      let remaining = rawName.substring(descW);
      while (remaining.length > 0) {
        t += padR(remaining.substring(0, totalWidth), totalWidth) + '\n';
        remaining = remaining.substring(totalWidth);
      }
    });

    t += '-'.repeat(totalWidth) + '\n';
    const totalVal = `R$ ${sale.valorTotal.toFixed(2)}`;
    t += padR('TOTAL:', totalWidth - totalVal.length) + totalVal + '\n';
    
    t += `FORMA DE PAGAMENTO: ${sale.metodoPagamento}\n`;
    
    // Mostra detalhe apenas se não for Dinheiro
    if (sale.detalhePagamento && sale.detalhePagamento.toUpperCase() !== 'DINHEIRO') {
      t += `DETALHE: ${sale.detalhePagamento.toUpperCase()}\n`;
    }
    
    t += '-'.repeat(totalWidth) + '\n';
    t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
    t += center('ESCANEIE O QR CODE', totalWidth) + '\n';
    t += center('E PAGUE COM PIX', totalWidth) + '\n';
    t += '-'.repeat(totalWidth) + '\n';

    // Avanço de papel para destaque
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[12px] leading-tight text-black bg-white uppercase whitespace-pre select-none">
            {generateText(printWidth)}
          </div>
        </div>
        <div className="bg-gray-100 p-4 flex flex-col gap-2 border-t border-gray-200">
          <div className="flex bg-gray-200 p-1 rounded-xl">
            <button onClick={() => setPrintWidth('56MM')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>56MM</button>
            <button onClick={() => setPrintWidth('80MM')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>80MM</button>
          </div>
          <button onClick={handlePrint} className="w-full bg-blue-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase">
            <i className="fa-solid fa-print"></i> IMPRIMIR CUPOM
          </button>
          <button onClick={onClose} className="w-full bg-slate-800 text-white font-black py-3 rounded-xl active:scale-95 text-[10px] uppercase">VOLTAR</button>
        </div>
      </div>
    </div>
  );
};

export default Cupom;