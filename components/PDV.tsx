import React, { useState, useEffect, useMemo } from 'react';
import { Product, Client, Carga, Sale, SaleItem, PaymentMethod } from '../types';
import Cupom from './Cupom';
import { loadLocalState, saveLocalState } from '../utils/persistence';

interface PDVProps {
  client: Client;
  products: Product[];
  minhaCarga: Carga[];
  vendedorId: string;
  onCancel: () => void;
  onFinish: (sale: Sale) => void;
  processSale: (data: any) => Promise<Sale | null>;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
  sales: Sale[];
  onNavigateToCredit: () => void;
}

type PDVView = 'CART' | 'RECEIPT_PREVIEW' | 'PAYMENT';

const PDV: React.FC<PDVProps> = ({ client, products, minhaCarga, vendedorId, onCancel, onFinish, processSale, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, sales, onNavigateToCredit }) => {
  const [view, setView] = useState<PDVView>('CART');
  const cartKey = `pdv_cart_${vendedorId}_${client.id}`;
  
  const [cart, setCart] = useState<{ [key: string]: { quantidade: number, precoVenda: string } }>(() => 
    loadLocalState(cartKey, {})
  );

  const [metodo, setMetodo] = useState<PaymentMethod>('DINHEIRO');
  const [detalheMetodo, setDetalheMetodo] = useState<string>('Dinheiro');
  const [showPrazoOverlay, setShowPrazoOverlay] = useState(false);
  const [showPixOverlay, setShowPixOverlay] = useState<1 | 2 | null>(null);
  const [prazoData, setPrazoData] = useState<string>('');
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [selectedPixSlot, setSelectedPixSlot] = useState<1 | 2 | null>(null);
  const [isTrocaActive, setIsTrocaActive] = useState(false);
  const [valorTroca, setValorTroca] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  
  const productIdsInCarga = useMemo(() => new Set(minhaCarga.map(c => c.produtoId)), [minhaCarga]);
  const orderedProductsInCarga = useMemo(() => products.filter(p => productIdsInCarga.has(p.id)), [products, productIdsInCarga]);

  useEffect(() => {
    saveLocalState(cartKey, cart);
  }, [cart, cartKey]);

  const getOrderedItems = (): SaleItem[] => {
    return products
      .filter(p => cart[p.id] && cart[p.id].quantidade > 0)
      .map(p => ({
        produtoId: p.id,
        quantidade: cart[p.id].quantidade,
        precoVenda: parseFloat(cart[p.id].precoVenda) || 0
      }));
  };

  const clientDebt = useMemo(() => {
    const pendingSales = sales.filter(s => s.clientId === client.id && s.statusPagamento === 'PENDENTE');
    return pendingSales.reduce((acc, s) => acc + (s.valorTotal - s.valorPago), 0);
  }, [sales, client.id]);

  const updateCart = (pId: string, delta: number, basePrice: number) => {
    setCart(prev => {
      const current = prev[pId] || { quantidade: 0, precoVenda: basePrice.toString() };
      const cargaOriginal = minhaCarga.find(c => c.produtoId === pId)?.quantidade || 0;
      const novaQtd = Math.max(0, Math.min(cargaOriginal, (current.quantidade ?? 0) + delta)); 
      if (novaQtd === 0 && delta < 0) {
        const { [pId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [pId]: { ...current, quantidade: novaQtd } };
    });
  };

  const handlePriceChange = (pId: string, value: string) => {
    const sanitized = value.replace(',', '.');
    setCart(prev => {
      if (!prev[pId]) return prev;
      return { ...prev, [pId]: { ...prev[pId], precoVenda: sanitized } };
    });
  };

  const subtotal = Object.entries(cart).reduce((acc, [_, item]) => {
    const cartItem = item as { quantidade: number, precoVenda: string };
    const price = parseFloat(cartItem.precoVenda) || 0;
    return acc + ((cartItem.quantidade ?? 0) * price); 
  }, 0);

  const total = Math.max(0, subtotal - (isTrocaActive ? parseFloat(valorTroca) || 0 : 0));

  const handleConfirmFinalize = async () => {
    const itens = getOrderedItems();
    const descontoInfo = isTrocaActive && parseFloat(valorTroca) > 0 ? ` (Troca: R$ ${parseFloat(valorTroca).toFixed(2)})` : '';
    const finalDetalhe = (metodo === 'PIX' ? (selectedPixSlot === 1 ? pix1Name : pix2Name) : detalheMetodo) + descontoInfo;
    
    const salePayload: any = { vendedorId, clientId: client.id, valorTotal: total, metodoPagamento: metodo, detalhePagamento: finalDetalhe, itens };
    if (metodo === 'A_PRAZO') { 
      salePayload.statusPagamento = 'PENDENTE'; 
      salePayload.dataVencimento = new Date(prazoData); 
    } else { 
      salePayload.statusPagamento = 'PAGO'; 
    }
    
    const newSale = await processSale(salePayload);
    if (newSale) { 
      localStorage.removeItem(cartKey); 
      onFinish(newSale); 
    }
  };

  if (view === 'RECEIPT_PREVIEW') {
    return (
      <div className="fixed inset-0 bg-gray-900 z-[100] flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Cupom 
            sale={{ id: 'preview', vendedorId, clientId: client.id, data: new Date(), valorTotal: total, valorPago: 0, metodoPagamento: metodo, statusPagamento: 'PENDENTE', itens: getOrderedItems() }} 
            client={client} 
            products={products} 
            onBack={() => setView('CART')} 
            onClose={() => setView('PAYMENT')} 
            allowDelete={false}
            closeLabel="IR PARA PAGAMENTO"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-50 z-[60] flex flex-col">
      <header className="bg-white border-b border-gray-100 p-3 flex justify-between items-center shadow-sm">
        <button onClick={onCancel} className="w-9 h-9 bg-gray-50 text-gray-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>
        <div className="text-center px-4 truncate">
          <p className="text-[9px] text-gray-400 uppercase font-black tracking-tighter">Atendimento</p>
          <h2 className="font-black text-xs text-gray-800 uppercase truncate">{client.nomeFantasia}</h2> 
        </div>
        <button onClick={() => setCart({})} className="w-9 h-9 bg-rose-50 text-rose-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-trash-can text-sm"></i></button>
      </header>

      {clientDebt > 0 && (
        <button onClick={() => { onCancel(); onNavigateToCredit(); }} className="w-full bg-rose-600 text-white p-3 flex items-center justify-center gap-3 shadow-md">
          <i className="fa-solid fa-triangle-exclamation text-sm"></i>
          <span className="text-[10px] font-black uppercase tracking-widest">DÍVIDA PENDENTE: R$ {clientDebt.toFixed(2)}</span>
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 pb-44">
        {orderedProductsInCarga.map(p => { 
          const item = cart[p.id];
          const cargaOriginal = minhaCarga.find(c => c.produtoId === p.id)?.quantidade || 0;
          return (
            <div key={p.id} className={`bg-white p-2.5 rounded-2xl border flex items-center gap-3 ${item?.quantidade ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'}`}>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h3> 
                <div className="flex items-center gap-2 mt-1">
                   <div className="flex items-center gap-1.5 bg-white border border-gray-100 px-2 py-0.5 rounded-lg">
                      <span className="text-[9px] font-black text-gray-300">R$</span>
                      <input type="text" value={item?.precoVenda ?? (p.precoVenda ?? 0).toFixed(2)} onChange={(e) => handlePriceChange(p.id, e.target.value)} className="w-14 bg-transparent border-none p-0 text-[11px] font-black outline-none text-emerald-600" />
                   </div>
                   <span className="text-[9px] font-bold uppercase text-blue-500">{cargaOriginal - (item?.quantidade ?? 0)} UN</span>
                </div>
              </div>
              <div className="flex items-center bg-white rounded-xl p-0.5 border border-gray-100 shadow-sm">
                <button onClick={() => updateCart(p.id, -1, p.precoVenda)} className="w-8 h-8 text-gray-400 active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus text-[10px]"></i></button> 
                <span className="font-black text-xs min-w-[22px] text-center">{item?.quantidade ?? 0}</span> 
                <button onClick={() => updateCart(p.id, 1, p.precoVenda)} className="w-8 h-8 text-blue-600 active:scale-90 flex items-center justify-center"><i className="fa-solid fa-plus text-[10px]"></i></button> 
              </div>
            </div>
          );
        })}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 space-y-3 shadow-lg max-w-lg mx-auto z-[70]">
        <div className="flex items-center justify-between px-1 mb-1 bg-gray-50/50 p-2 rounded-xl">
          <button onClick={() => setIsTrocaActive(!isTrocaActive)} className={`w-8 h-4 rounded-full relative transition-colors ${isTrocaActive ? 'bg-orange-500' : 'bg-gray-300'}`}>
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isTrocaActive ? 'left-4.5' : 'left-0.5'}`}></div>
          </button>
          {isTrocaActive && <input type="number" value={valorTroca} onChange={e => setValorTroca(e.target.value)} placeholder="VALOR TROCA" className="w-20 bg-white border border-orange-100 rounded-lg text-[11px] font-black text-orange-600 p-1 text-right" />}
        </div>
        <div className="flex justify-between items-end px-1">
          <p className="text-xl font-black text-gray-800">R$ {total.toFixed(2)}</p>
          <button onClick={() => setView('RECEIPT_PREVIEW')} disabled={total === 0} className={`px-6 py-4 rounded-2xl font-black uppercase text-xs ${total > 0 ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-200 text-gray-400'}`}>Gerar Cupom</button>
        </div>
      </footer>

      {view === 'PAYMENT' && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-end justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom">
              <h3 className="font-black text-gray-800 text-lg mb-4 text-center uppercase">Pagamento</h3>
              <div className="flex gap-1.5 mb-6 justify-center">
                {['DINHEIRO', 'PIX', 'A_PRAZO'].map(m => (
                  <button key={m} onClick={() => setMetodo(m as PaymentMethod)} className={`px-3 py-2 rounded-xl text-[8px] font-black uppercase ${metodo === m ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-400'}`}>{m}</button>
                ))}
              </div>
              <button onClick={handleConfirmFinalize} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase text-xs shadow-xl">Finalizar Venda</button>
              <button onClick={() => setView('RECEIPT_PREVIEW')} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase mt-2">Voltar</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default PDV;