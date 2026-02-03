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
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [printWidth, setPrintWidth] = useState<'56MM' | '80MM'>('56MM');

  const saleDate = new Date(sale.data);
  const today = new Date();
  const isSaleToday = saleDate.getDate() === today.getDate() && 
                     saleDate.getMonth() === today.getMonth() && 
                     saleDate.getFullYear() === today.getFullYear();

  /**
   * Formata o texto para ESC/POS com largura fixa e colunas rígidas.
   */
  const generateText = (width: '56MM' | '80MM') => {
    const totalWidth = width === '80MM' ? 48 : 32; 
    
    // Utilitários de preenchimento
    const padR = (str: string, len: number) => str.substring(0, len).padEnd(len);
    const padL = (str: string, len: number) => str.substring(0, len).padStart(len);
    const center = (str: string, len: number) => {
      const s = str.substring(0, len);
      const spaces = Math.max(0, Math.floor((len - s.length) / 2));
      return ' '.repeat(spaces) + s;
    };

    let t = '';
    
    // Cabeçalho
    t += '-'.repeat(totalWidth) + '\n';
    t += center('CUPOM NAO FISCAL', totalWidth) + '\n';
    t += '-'.repeat(totalWidth) + '\n';
    
    const clientName = (client.nomeFantasia || 'CONSUMIDOR').toUpperCase();
    t += `CLIENTE: ${clientName.substring(0, totalWidth - 9)}\n`;
    t += '-'.repeat(totalWidth) + '\n';

    // Definição das colunas (Grade Rígida)
    // 56mm (32): DESC(20) | QTD(4) | VAL(8)
    // 80mm (48): DESC(31) | QTD(4) | VAL(13)
    const qtyW = 4;
    const valW = width === '80MM' ? 13 : 8;
    const descW = totalWidth - qtyW - valW;

    t += padR('DESCRICAO', descW) + padL('QTD', qtyW) + padL('VALOR', valW) + '\n';
    t += '-'.repeat(totalWidth) + '\n';

    // Lista de Produtos com Quebra Manual (Word Wrap)
    sale.itens.forEach(item => {
      const p = products.find(prod => prod.id === item.produtoId);
      const rawName = (p?.nome ?? 'PRODUTO').toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Ç/g, 'C');
      
      const qtyStr = `${item.quantidade}X`;
      const valStr = `R$ ${(item.quantidade * item.precoVenda).toFixed(2)}`;

      // Primeira linha (Descrição Parcial + QTD + VALOR)
      const firstLineDesc = rawName.substring(0, descW);
      t += padR(firstLineDesc, descW) + padL(qtyStr, qtyW) + padL(valStr, valW) + '\n';

      // Linhas subsequentes (Apenas Descrição)
      let remaining = rawName.substring(descW);
      while (remaining.length > 0) {
        t += padR(remaining.substring(0, descW), totalWidth) + '\n';
        remaining = remaining.substring(descW);
      }
    });

    // Totais
    t += '-'.repeat(totalWidth) + '\n';
    const totalVal = `R$ ${sale.valorTotal.toFixed(2)}`;
    t += padR('TOTAL:', totalWidth - totalVal.length) + totalVal + '\n';
    
    const pMethod = (sale.metodoPagamento || 'N/D').replace('_', ' ');
    t += `PAGAMENTO: ${pMethod}\n`;
    if (sale.detalhePagamento) {
      t += `DETALHE: ${sale.detalhePagamento.toUpperCase()}\n`;
    }
    
    t += '-'.repeat(totalWidth) + '\n';
    t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
    t += center('ESCANEIE O QR CODE', totalWidth) + '\n';
    t += center('E PAGUE COM PIX', totalWidth) + '\n';
    t += '-'.repeat(totalWidth) + '\n';
    
    // Avanço de papel (Crucial para MTP-1/3)
    t += '\n\n\n\n\n'; 

    return t;
  };

  const handlePrint = async () => {
    if (!showToast) return;
    const rawText = generateText(printWidth);
    showToast(`Iniciando impressão ${printWidth}...`);

    try {
      const success = await printerService.printSale(sale, client, products, printWidth === '56MM' ? 56 : 80, rawText);
      if (success) showToast("Impresso com sucesso!", 'success');
    } catch (error) {
      showToast("Falha na impressão Bluetooth.", 'error');
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
          <div className="flex gap-2">
            <button onClick={handlePrint} className="flex-1 bg-blue-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase">
              <i className="fa-solid fa-print"></i> IMPRIMIR
            </button>
            <button onClick={() => { navigator.clipboard.writeText(generateText(printWidth)); if(showToast) showToast("Copiado!"); }} className="w-14 bg-gray-200 text-gray-600 font-black py-4 rounded-xl flex items-center justify-center active:scale-95"><i className="fa-solid fa-copy"></i></button>
          </div>
          <button onClick={onClose} className="w-full bg-slate-800 text-white font-black py-3 rounded-xl active:scale-95 text-[10px] uppercase">VOLTAR</button>
        </div>
      </div>
    </div>
  );
};

export default Cupom;