import React, { useState } from 'react';
import { Sale, Client, Product } from '../types';

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
  
  const padRight = (str: string, length: number) => str.substring(0, length).padEnd(length);
  const padLeft = (str: string, length: number) => str.substring(0, length).padStart(length);

  const generateText = () => {
    let t = `********************************\n`;
    t += `        CUPOM NAO FISCAL        \n`;
    t += `********************************\n\n`;
    
    // Nome do cliente limitado para não quebrar a linha
    const clientName = (client.nomeFantasia || 'Nao identificado').substring(0, 24);
    t += `Cliente: ${padRight(clientName, 24)}\n\n`;
    
    t += `--------------------------------\n`;
    t += `DESCRICAO          QTD     VALOR\n`;
    t += `--------------------------------\n`;
    
    sale.itens.forEach(i => {
      const p = products.find(prod => prod.id === i.produtoId);
      // Coluna Nome: 19 caracteres
      const name = padRight((p?.nome ?? 'PRODUTO').toUpperCase(), 19);
      // Coluna Qtd: 4 caracteres (Garante dois espaços à esquerda se a qtd for 1x, ex: "  1x")
      const qty = padLeft(`${(i.quantidade ?? 0)}x`, 4);
      // Coluna Valor: 9 caracteres
      const subtotal = ((i.quantidade ?? 0) * (i.precoVenda ?? 0)).toFixed(2);
      const val = padLeft(subtotal, 9);
      
      t += `${name}${qty}${val}\n`;
    });
    
    t += `--------------------------------\n`;
    const totalLabel = "TOTAL:";
    const totalVal = `R$ ${(sale.valorTotal ?? 0).toFixed(2)}`;
    // TOTAL: (6) + 17 espaços + VALOR (9) = 32
    t += `${padRight(totalLabel, 15)}${padLeft(totalVal, 17)}\n\n`;
    
    const paymentMethod = (sale.metodoPagamento ?? 'N/D').replace('_', '/');
    t += `Forma de Pagamento: ${paymentMethod}\n\n`;
    
    t += `--------------------------------\n`;
    t += `   OBRIGADO PELA PREFERENCIA!   \n`;
    t += `       ESCANEIE O QR CODE       \n`;
    t += `        E PAGUE COM PIX         \n`;
    t += `********************************`;
    return t;
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(generateText());
    if (showToast) showToast("Texto para 56mm copiado!");
  };

  const handleDelete = () => {
    onDeleteSale?.(sale.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[13px] leading-[1.3] text-black bg-white uppercase whitespace-pre select-none">
            {generateText()}
          </div>
          <div className="flex justify-between mt-4 text-gray-200 select-none overflow-hidden h-2">
            {Array.from({ length: 40 }).map((_, i) => (
              <span key={i} className="text-[20px] leading-none transform rotate-45">▲</span>
            ))}
          </div>
        </div>

        <div className="bg-gray-100 p-4 flex flex-col gap-2 border-t border-gray-200">
          <div className="flex gap-2">
            <button 
              onClick={handleCopyText}
              className="flex-1 bg-blue-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-[10px] tracking-widest uppercase"
            >
              <i className="fa-solid fa-copy"></i>
              COPIAR TEXTO
            </button>
            {allowDelete && onDeleteSale && (
              <button
                onClick={() => setShowConfirmDelete(true)}
                className="w-14 bg-rose-600 text-white font-black py-4 rounded-xl flex items-center justify-center active:scale-95 transition-all text-lg"
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