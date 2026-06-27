import React, { useState, useMemo } from 'react';
import { Client, Sale, Product } from '../types';
import Cupom from './Cupom';

interface ClientHistoryProps {
  client: Client;
  sales: Sale[];
  products: Product[];
  onClose: () => void;
}

const ClientHistory: React.FC<ClientHistoryProps> = ({ client, sales, products, onClose }) => {
  const [selectedHistoricalSale, setSelectedHistoricalSale] = useState<Sale | null>(null);

  const clientSales = useMemo(() => {
    return sales
      .filter(s => s.clientId === client.id)
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  }, [sales, client.id]);

  const stats = useMemo(() => {
    // Pega os últimos 25 pedidos para calcular a média
    const last25 = clientSales.slice(0, 25);
    
    if (last25.length === 0) return { avg: 0, count: 0 };
    
    const total = last25.reduce((acc, curr) => acc + (curr.valorTotal || 0), 0);
    return {
      avg: total / last25.length,
      count: clientSales.length // Mantém o contador total de pedidos realizados
    };
  }, [clientSales]);

  const lastThreeSales = clientSales.slice(0, 3);

  if (selectedHistoricalSale) {
    return (
      <div className="fixed inset-0 z-[260]">
        <Cupom 
          sale={selectedHistoricalSale} 
          client={client} 
          products={products} 
          onClose={() => setSelectedHistoricalSale(null)} 
          allowDelete={false} 
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
          <div className="min-w-0 pr-4">
            <h3 className="font-black text-gray-800 text-sm uppercase truncate">{client.nomeFantasia}</h3>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Histórico de Compras</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white text-gray-400 rounded-2xl flex items-center justify-center shadow-sm active:scale-90"><i className="fa-solid fa-xmark"></i></button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-3xl border border-blue-100 text-center">
              <p className="text-[9px] font-black text-blue-400 uppercase mb-1">Média (Últ. 25)</p>
              <p className="text-lg font-black text-blue-700">R$ {stats.avg.toFixed(2)}</p>
            </div>
            <div className="bg-emerald-50 p-4 rounded-3xl border border-emerald-100 text-center">
              <p className="text-[9px] font-black text-emerald-400 uppercase mb-1">Total Pedidos</p>
              <p className="text-lg font-black text-emerald-700">{stats.count}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Últimos 3 Pedidos</h4>
            {lastThreeSales.map(sale => (
              <button 
                key={sale.id} 
                onClick={() => setSelectedHistoricalSale(sale)}
                className="w-full bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between active:scale-[0.98] transition-all hover:border-blue-200"
              >
                <div className="text-left">
                  <p className="text-[11px] font-black text-gray-800 uppercase">{new Date(sale.data).toLocaleDateString('pt-BR')}</p>
                  <p className="text-[9px] text-gray-400 font-bold uppercase">{sale.metodoPagamento}</p>
                </div>
                <div className="text-right flex items-center gap-3">
                  <p className="text-sm font-black text-gray-800">R$ {sale.valorTotal.toFixed(2)}</p>
                  <i className="fa-solid fa-file-invoice text-blue-500 opacity-30"></i>
                </div>
              </button>
            ))}
            {lastThreeSales.length === 0 && (
              <div className="py-10 text-center opacity-20 italic text-[10px] font-black uppercase tracking-widest">Nenhuma venda encontrada</div>
            )}
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-t border-gray-100">
          <button onClick={onClose} className="w-full py-4 text-gray-400 font-black uppercase text-[10px] tracking-widest">Fechar Histórico</button>
        </div>
      </div>
    </div>
  );
};

export default ClientHistory;