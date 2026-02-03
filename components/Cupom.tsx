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
  const [printWidth, setPrintWidth] = useState<'56MM' | '80MM'>('56MM'); // Novo estado para largura
  
  // Comparação robusta de datas (mesmo dia, mês e ano no tempo local)
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
    // Define a largura total da linha: 32 para 56mm, 48 para 80mm (padrão seguro)
    const totalWidth = width === '80MM' ? 48 : 32; 
    
    // Funções auxiliares
    const pad = (str: string, len: number) => str.padEnd(len).substring(0, len);
    const padL = (str: string, len: number) => str.padStart(len).substring(0, len);
    
    let t = '-'.repeat(totalWidth) + '\n';
    t += center('CUPOM NAO FISCAL', totalWidth) + '\n';
    t += '-'.repeat(totalWidth) + '\n\n';
    
    const clientName = (client.nomeFantasia || 'CLIENTE NAO IDENTIFICADO').toUpperCase().substring(0, totalWidth - 1);
    t += `CLIENTE: ${clientName}\n\n`; 

    // --- CABEÇALHO DA TABELA DE ITENS ---
    t += '-'.repeat(totalWidth) + '\n';
    
    // Definição das larguras das colunas
    const qtyLen = 4; // Ex: ' 1X'
    const finalValLen = width === '80MM' ? 13 : 9; // Ex: ' R$ 10.99'
    const finalNameLen = totalWidth - qtyLen - finalValLen; // Largura restante para a descrição

    t += pad('DESCRICAO', finalNameLen) + padL('QTD', qtyLen) + padL('VALOR', finalValLen) + '\n';
    t += '-'.repeat(totalWidth) + '\n';
    
    // --- LISTA DE ITENS ---
    sale.itens.forEach(i => {
      const p = products.find(prod => prod.id === i.produtoId);
      const nomeProduto = (p?.nome ?? 'PRODUTO DESCONHECIDO').toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Ç/g, 'C');
      
      const maxLineLength = finalNameLen;
      let remainingName = nomeProduto;

      while (remainingName.length > 0) {
        const line = remainingName.substring(0, maxLineLength);
        remainingName = remainingName.substring(maxLineLength);

        if (remainingName.length === 0) {
          // Última linha do item: inclui QTD e VALOR
          const qty = padL(`${(i.quantidade ?? 0)}X`, qtyLen);
          const subtotal = ((i.quantidade ?? 0) * (i.precoVenda ?? 0)).toFixed(2);
          const val = padL(subtotal, finalValLen);
          
          t += `${pad(line, finalNameLen)}${qty}${val}\n`;
        } else {
          // Linhas de continuação: apenas o nome, preenchido até a largura total
          t += `${pad(line, totalWidth)}\n`;
        }
      }
    });
    
    // --- TOTAL ---
    t += '-'.repeat(totalWidth) + '\n';
    const totalLabel = "TOTAL:";
    const totalVal = `R$ ${(sale.valorTotal ?? 0).toFixed(2)}`;
    // Alinha o total à direita
    t += `${pad(totalLabel, totalWidth - totalVal.length)}${totalVal}\n\n`;
    
    // --- FORMA DE PAGAMENTO ---
    const paymentMethod = (sale.metodoPagamento ?? 'N/D').toUpperCase().replace('_', '/');
    t += `FORMA DE PAGAMENTO: ${paymentMethod}\n\n`; 
    
    // --- FOOTER ---
    t += '-'.repeat(totalWidth) + '\n';
    t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
    t += center('ESCANEIE O QR CODE', totalWidth) + '\n';
    t += center('E PAGUE COM PIX', totalWidth) + '\n';
    t += '-'.repeat(totalWidth);
    return t;
  };

  const handleCopyText = () => {
    // Usa a largura padrão para copiar
    navigator.clipboard.writeText(generateText('56MM')); 
    if (showToast) showToast("Texto para 56mm copiado!");
  };

  const handlePrint = async () => {
    if (!showToast) return;
    
    // 1. Gerar o texto formatado (que será a base para os comandos ESC/POS)
    const rawText = generateText(printWidth);
    
    showToast(`Tentando conectar à impressora ${printWidth}...`);

    try {
        // 2. Chamar o serviço de impressão
        const success = await printerService.printSale(sale, client, products, printWidth === '56MM' ? 56 : 80, rawText);
        
        if (success) {
            showToast("Impressão enviada com sucesso!", 'success');
        }
    } catch (error) {
        // 3. Tratar falha (exibir erro e sugerir cópia)
        const errorMessage = error instanceof Error ? error.message : "Erro desconhecido na conexão.";
        showToast(`Erro de Impressão: ${errorMessage}. Tente copiar o texto.`, 'error');
    }
  };

  const handleDelete = () => {
    if (!isSaleToday) return;
    onDeleteSale?.(sale.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[13px] leading-[1.3] text-black bg-white uppercase whitespace-pre select-none">
            {generateText(printWidth)}
          </div>
          <div className="flex justify-between mt-4 text-gray-200 select-none overflow-hidden h-2">
            {Array.from({ length: 40 }).map((_, i) => (
              <span key={i} className="text-[20px] leading-none transform rotate-45">▲</span>
            ))}
          </div>
        </div>

        <div className="bg-gray-100 p-4 flex flex-col gap-2 border-t border-gray-200">
          
          {/* Seletor de Largura */}
          <div className="flex bg-gray-200 p-1 rounded-xl">
            <button 
              onClick={() => setPrintWidth('56MM')} 
              className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
            >
              56MM
            </button>
            <button 
              onClick={() => setPrintWidth('80MM')} 
              className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
            >
              80MM
            </button>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={handlePrint}
              className="flex-1 bg-blue-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-[10px] tracking-widest uppercase"
            >
              <i className="fa-solid fa-print"></i>
              IMPRIMIR CUPOM
            </button>
            
            <button 
              onClick={handleCopyText}
              className="w-14 bg-gray-200 text-gray-600 font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-[10px] tracking-widest uppercase"
            >
              <i className="fa-solid fa-copy"></i>
            </button>

            {allowDelete && onDeleteSale && (
              <button
                onClick={() => isSaleToday && setShowConfirmDelete(true)}
                disabled={!isSaleToday}
                className={`w-14 font-black py-4 rounded-xl flex items-center justify-center transition-all text-lg ${
                  isSaleToday 
                    ? 'bg-rose-600 text-white active:scale-95 shadow-md' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none opacity-40'
                }`}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            )}
          </div>
          <button 
            onClick={onClose}
            className="w-full bg-slate-800 text-white font-black py-3 rounded-xl active:scale-95 transition-all text-[10px] tracking-[0.2em] uppercase"
          >
            VOLTAR
          </button>
        </div>
      </div>

      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-gray-800 text-lg mb-4">Excluir Venda?</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium uppercase leading-relaxed">Esta ação é irreversível e estornará o estoque do vendedor.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleDelete} className="w-full bg-rose-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Excluir</button>
              <button onClick={() => setShowConfirmDelete(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cupom;