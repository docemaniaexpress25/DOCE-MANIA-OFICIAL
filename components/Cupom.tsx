import React from 'react';
import { Sale, Client, Product } from '../types';

interface CupomProps {
  sale: Sale;
  client: Client;
  products: Product[];
  onClose: () => void;
  onDeleteSale?: (saleId: string) => void; // Nova prop para a ação de exclusão
  allowDelete?: boolean; // Nova prop para controlar a visibilidade do botão de exclusão
}

const Cupom: React.FC<CupomProps> = ({ sale, client, products, onClose, onDeleteSale, allowDelete }) => {
  const LINE_LENGTH = 32;

  const padRight = (str: string, length: number) => str.substring(0, length).padEnd(length);
  const padLeft = (str: string, length: number) => str.substring(0, length).padStart(length);

  const generateText = () => {
    let t = `********************************\n`;
    t += `        CUPOM NAO FISCAL        \n`;
    t += `********************************\n\n`;
    t += `Cliente: ${client.nomeFantasia || 'Nao identificado'}\n\n`; // Garante client.nomeFantasia é string
    t += `--------------------------------\n`;
    t += `DESCRICAO          QTD     VALOR\n`;
    t += `--------------------------------\n`;
    
    sale.itens.forEach(i => {
      const p = products.find(prod => prod.id === i.produtoId);
      const name = (p?.nome ?? '').substring(0, 18); // Garante p.nome é string
      const qty = `${(i.quantidade ?? 0)}x`.padStart(4); // Garante i.quantidade é número
      const val = ((i.quantidade ?? 0) * (i.precoVenda ?? 0)).toFixed(2).padStart(8); // Garante i.quantidade e i.precoVenda são números
      t += `${padRight(name, 18)}${qty}${val}\n`;
    });
    
    t += `--------------------------------\n`;
    t += `${padRight('TOTAL:', 15)}${padLeft(`R$ ${(sale.valorTotal ?? 0).toFixed(2)}`, 17)}\n\n`; // Garante sale.valorTotal é número
    t += `Forma de Pagamento: ${(sale.metodoPagamento ?? 'N/D').replace('_', '/')}\n\n`; // Garante sale.metodoPagamento é string
    t += `--------------------------------\n`;
    t += `   OBRIGADO PELA PREFERENCIA!   \n`;
    t += `        ESCANEIE O QR CODE       \n`;
    t += `          E PAGUE COM PIX        \n`;
    t += `********************************`;
    return t;
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(generateText());
    alert("Texto formatado para 56mm copiado!");
  };

  const handleDelete = () => {
    if (confirm("Tem certeza que deseja excluir esta venda? Esta ação é irreversível e estornará o estoque do vendedor.")) {
      onDeleteSale?.(sale.id);
      onClose(); // Fecha o cupom após a exclusão
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-[100] flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        {/* Receipt Paper Area */}
        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[13px] leading-[1.3] text-black bg-white uppercase whitespace-pre select-none">
            {generateText()}
          </div>
          {/* Visual Wave at bottom */}
          <div className="flex justify-between mt-4 text-gray-200 select-none overflow-hidden h-2">
            {Array.from({ length: 40 }).map((_, i) => (
              <span key={i} className="text-[20px] leading-none transform rotate-45">▲</span>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="bg-gray-100 p-4 grid grid-cols-1 gap-2 border-t border-gray-200">
          <button 
            onClick={handleCopyText}
            className="w-full bg-blue-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-xs tracking-widest uppercase"
          >
            <i className="fa-solid fa-copy"></i>
            COPIAR TEXTO FORMATADO
          </button>
          {allowDelete && onDeleteSale && (
            <button
              onClick={handleDelete}
              className="w-full bg-rose-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-xs tracking-widest uppercase mt-2"
            >
              <i className="fa-solid fa-trash-can"></i>
              EXCLUIR VENDA
            </button>
          )}
          <button 
            onClick={onClose}
            className="w-full bg-slate-800 text-white font-black py-3 rounded-xl active:scale-95 transition-all text-[10px] tracking-[0.2em] uppercase mt-2"
          >
            VOLTAR
          </button>
        </div>
      </div>
    </div>
  );
};

export default Cupom;