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

  const center = (str: string, len: number) => {
    const spaces = Math.max(0, Math.floor((len - str.length) / 2));
    return ' '.repeat(spaces) + str;
  };

  const generateText = (width: '56MM' | '80MM') => {
    const totalWidth = width === '80MM' ? 48 : 32; 
    const pad = (str: string, len: number) => str.padEnd(len).substring(0, len);
    const padL = (str: string, len: number) => str.padStart(len).substring(0, len);
    const CRLF = '\r\n'; // Retorno de carro + nova linha para impressoras térmicas
    
    let t = '-'.repeat(totalWidth) + CRLF;
    t += center('CUPOM NAO FISCAL', totalWidth) + CRLF;
    t += '-'.repeat(totalWidth) + CRLF + CRLF;
    
    const clientName = (client.nomeFantasia || 'CLIENTE').toUpperCase().substring(0, totalWidth);
    t += `CLIENTE: ${clientName}` + CRLF + CRLF; 

    t += '-'.repeat(totalWidth) + CRLF;
    
    // Distribuição de colunas para 58mm (32 chars)
    const qtyLen = 5; // Ex: " 1X  "
    const valLen = width === '80MM' ? 15 : 10; // Ex: " R$ 10.00"
    const nameLen = totalWidth - qtyLen - valLen; 

    t += pad('DESCRICAO', nameLen) + padL('QTD', qtyLen) + padL('VALOR', valLen) + CRLF;
    t += '-'.repeat(totalWidth) + CRLF;
    
    sale.itens.forEach(i => {
      const p = products.find(prod => prod.id === i.produtoId);
      const nomeProduto = (p?.nome ?? 'PRODUTO').toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/Ç/g, 'C')
        .substring(0, nameLen); // Truncamento rígido por linha
      
      const qtyStr = padL(`${(i.quantidade ?? 0)}X`, qtyLen);
      const subtotal = ((i.quantidade ?? 0) * (i.precoVenda ?? 0)).toFixed(2);
      const valStr = padL(`R$ ${subtotal}`, valLen);
      
      t += `${pad(nomeProduto, nameLen)}${qtyStr}${valStr}` + CRLF;
    });
    
    t += '-'.repeat(totalWidth) + CRLF;
    const totalVal = `R$ ${(sale.valorTotal ?? 0).toFixed(2)}`;
    t += pad('TOTAL:', totalWidth - totalVal.length) + totalVal + CRLF + CRLF;
    
    t += `FORMA: ${(sale.metodoPagamento ?? '').replace('_', '/')}` + CRLF;
    if (sale.detalhePagamento) {
        t += `DET: ${sale.detalhePagamento.toUpperCase()}` + CRLF;
    }
    
    t += CRLF + '-'.repeat(totalWidth) + CRLF;
    t += center(new Date(sale.data).toLocaleDateString() + ' ' + new Date(sale.data).toLocaleTimeString(), totalWidth) + CRLF;
    t += center('--- FIM DO CUPOM ---', totalWidth) + CRLF + CRLF;
    
    return t;
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(generateText('56MM')); 
    if (showToast) showToast("Copiado!");
  };

  const handlePrint = async () => {
    if (!showToast) return;
    const rawText = generateText(printWidth);
    showToast(`Iniciando impressão...`);
    try {
        const success = await printerService.printSale(sale, client, products, printWidth === '56MM' ? 56 : 80, rawText);
        if (success) showToast("Impresso!", 'success');
    } catch (error) {
        showToast("Erro na impressora.", 'error');
    }
  };

  const handleDelete = () => {
    if (!isSaleToday) return;
    onDeleteSale?.(sale.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[12px] leading-[1.2] text-black bg-white uppercase whitespace-pre">
            {generateText(printWidth)}
          </div>
        </div>

        <div className="bg-gray-100 p-4 flex flex-col gap-2 border-t border-gray-200">
          <div className="flex bg-gray-200 p-1 rounded-xl">
            <button onClick={() => setPrintWidth('56MM')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>56MM</button>
            <button onClick={() => setPrintWidth('80MM')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>80MM</button>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="flex-1 bg-blue-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase"><i className="fa-solid fa-print"></i> IMPRIMIR</button>
            {allowDelete && onDeleteSale && (
              <button onClick={() => isSaleToday && setShowConfirmDelete(true)} disabled={!isSaleToday} className={`w-14 font-black py-4 rounded-xl flex items-center justify-center ${isSaleToday ? 'bg-rose-600 text-white active:scale-95' : 'bg-gray-200 text-gray-400 opacity-40'}`}><i className="fa-solid fa-trash-can"></i></button>
            )}
          </div>
          <button onClick={onClose} className="w-full bg-slate-800 text-white font-black py-3 rounded-xl active:scale-95 text-[10px] uppercase">VOLTAR</button>
        </div>
      </div>

      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-gray-800 text-lg mb-4">Excluir Venda?</h3>
            <div className="flex flex-col gap-2">
              <button onClick={handleDelete} className="w-full bg-rose-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs">Sim, Excluir</button>
              <button onClick={() => setShowConfirmDelete(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cupom;