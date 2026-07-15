import React, { useState, useEffect, useMemo } from 'react';
import { Product, Client, Carga, Sale, SaleItem, PaymentMethod, Category } from '../types';
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
  categories: Category[];
}

type PDVView = 'CART' | 'RECEIPT_PREVIEW' | 'PAYMENT';

const PDV: React.FC<PDVProps> = ({ client, products, minhaCarga, vendedorId, onCancel, onFinish, processSale, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, sales, onNavigateToCredit, categories }) => {
  const [view, setView] = useState<PDVView>('CART');
  const cartKey = `pdv_cart_${vendedorId}_${client.id}`;
  
  const [activeCategoryId, setActiveCategoryId] = useState<string>(() => {
    return categories.length > 0 ? categories[0].id : '';
  });
  
  const [cart, setCart] = useState<{ [key: string]: { quantidade: number, precoVenda: string } }>(() => 
    loadLocalState(cartKey, {})
  );

  const [metodo, setMetodo] = useState<PaymentMethod>('DINHEIRO');
  const [detalheMetodo, setDetalheMetodo] = useState<string>('Dinheiro');
  const [prazoData, setPrazoData] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [selectedPixSlot, setSelectedPixSlot] = useState<1 | 2>(1);
  const [isTrocaActive, setIsTrocaActive] = useState(false);
  const [valorTroca, setValorTroca] = useState('');

  useEffect(() => {
    if (activeCategoryId === '' && categories.length > 0) {
      setActiveCategoryId(categories[0].id);
    }
  }, [categories, activeCategoryId]);

  useEffect(() => {
    saveLocalState(cartKey, cart);
  }, [cart, cartKey]);

  // Função para abreviar nomes de categoria conforme solicitado
  const formatCategoryName = (name: string) => {
    const n = name.toUpperCase();
    if (n.includes('ELMA')) return 'ELMA';
    if (n.includes('SALTY')) return 'SALTY';
    if (n.includes('DOCE')) return 'DOCES';
    if (n.includes('BEBIDA')) return 'BEBIDAS';
    return n.substring(0, 5);
  };

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

  const getMinPrice = (product: Product) => {
    if (!margemMinimaAtiva) return 0;
    const cost = product.precoCusto || 0;
    const margin = margemMinima || 0;
    if (margin >= 100) return cost;
    return cost / (1 - margin / 100);
  };

  const hasMarginViolation = useMemo(() => {
    if (!margemMinimaAtiva) return false;
    return Object.entries(cart).some(([pId, item]) => {
      const cartItem = item as { quantidade: number, precoVenda: string };
      if (cartItem.quantidade <= 0) return false;
      const p = products.find(prod => prod.id === pId);
      if (!p) return false;
      const price = parseFloat(cartItem.precoVenda) || 0;
      const minPrice = getMinPrice(p);
      return price < minPrice;
    });
  }, [cart, products, margemMinimaAtiva, margemMinima]);

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

  const subtotal = useMemo(() => {
    return Object.entries(cart).reduce((acc, [_, item]) => {
      const cartItem = item as { quantidade: number, precoVenda: string };
      const price = parseFloat(cartItem.precoVenda) || 0;
      return acc + ((cartItem.quantidade ?? 0) * price); 
    }, 0);
  }, [cart]);

  const total = useMemo(() => {
    const vt = parseFloat(valorTroca) || 0;
    return Math.max(0, subtotal - (isTrocaActive ? vt : 0));
  }, [subtotal, isTrocaActive, valorTroca]);

  const troco = useMemo(() => {
    const rec = parseFloat(valorRecebido) || 0;
    return Math.max(0, rec - total);
  }, [valorRecebido, total]);

  const setPrazoDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setPrazoData(d.toISOString().split('T')[0]);
  };

  const handleConfirmFinalize = async () => {
    if (total <= 0 && getOrderedItems().length === 0) return;
    if (hasMarginViolation) return;

    const itens = getOrderedItems();
    const vt = parseFloat(valorTroca) || 0;
    const descontoInfo = isTrocaActive && vt > 0 ? ` (Troca: R$ ${vt.toFixed(2)})` : '';
    const finalDetalhe = (metodo === 'PIX' ? (selectedPixSlot === 1 ? pix1Name : pix2Name) : detalheMetodo) + descontoInfo;
    
    const salePayload: any = { 
      vendedorId, 
      clientId: client.id, 
      valorTotal: total, 
      valorPago: metodo === 'A_PRAZO' ? 0 : total,
      metodoPagamento: metodo, 
      detalhePagamento: finalDetalhe, 
      itens,
      data: new Date() 
    };

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

  const productIdsInCarga = useMemo(() => new Set(minhaCarga.map(c => c.produtoId)), [minhaCarga]);
  
  const filteredProducts = useMemo(() => {
    const productsInCarga = products.filter(p => productIdsInCarga.has(p.id));
    if (!activeCategoryId) return productsInCarga;
    return productsInCarga.filter(p => p.categoryId === activeCategoryId);
  }, [products, productIdsInCarga, activeCategoryId]);

  if (view === 'RECEIPT_PREVIEW') {
    return (
      <div className="fixed inset-0 bg-gray-900 z-[100] flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Cupom 
            sale={{ 
              id: 'preview', 
              vendedorId, 
              clientId: client.id, 
              data: new Date(), 
              valorTotal: total, 
              valorPago: 0, 
              metodoPagamento: metodo, 
              statusPagamento: metodo === 'A_PRAZO' ? 'PENDENTE' : 'PAGO', 
              itens: getOrderedItems() 
            }} 
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
      <header className="bg-white border-b border-gray-100 p-3 flex flex-col shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <button onClick={onCancel} className="w-9 h-9 bg-gray-50 text-gray-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>
          <div className="text-center px-4 truncate">
            <p className="text-[9px] text-gray-400 uppercase font-black tracking-tighter">Atendimento</p>
            <h2 className="font-black text-xs text-gray-800 uppercase truncate">{client.nomeFantasia}</h2> 
          </div>
          <button onClick={() => setCart({})} className="w-9 h-9 bg-rose-50 text-rose-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-trash-can text-sm"></i></button>
        </div>

        <div className="grid grid-cols-4 gap-1 px-0.5">
          {categories.map(cat => (
            <button 
              key={cat.id}
              onClick={() => setActiveCategoryId(cat.id)}
              className={`py-2 px-1 rounded-lg text-[8px] font-black uppercase transition-all truncate border ${activeCategoryId === cat.id ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-gray-50 text-gray-400 border-gray-100'}`}
            >
              {formatCategoryName(cat.name)}
            </button>
          ))}
        </div>
      </header>

      {clientDebt > 0 && (
        <button onClick={() => { onCancel(); onNavigateToCredit(); }} className="w-full bg-rose-600 text-white p-3 flex items-center justify-center gap-3 shadow-md">
          <i className="fa-solid fa-triangle-exclamation text-sm"></i>
          <span className="text-[10px] font-black uppercase tracking-widest">DÍVIDA PENDENTE: R$ {clientDebt.toFixed(2)}</span>
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 pb-44">
        {filteredProducts.map(p => { 
          const item = cart[p.id];
          const cargaOriginal = minhaCarga.find(c => c.produtoId === p.id)?.quantidade || 0;
          const minPrice = getMinPrice(p);
          const itemPrice = item ? parseFloat(item.precoVenda) || 0 : p.precoVenda;
          const isBelowMin = margemMinimaAtiva && item && item.quantidade > 0 && itemPrice < minPrice;

          return (
            <div key={p.id} className={`bg-white p-2.5 rounded-2xl border flex flex-col gap-1 ${item?.quantidade ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'}`}>
              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h3> 
                  <div className="flex items-center gap-2 mt-1">
                     <div className={`flex items-center gap-1.5 bg-white border px-2 py-0.5 rounded-lg ${isBelowMin ? 'border-rose-500 bg-rose-50' : 'border-gray-100'}`}>
                        <span className={`text-[9px] font-black ${isBelowMin ? 'text-rose-500' : 'text-gray-300'}`}>R$</span>
                        <input 
                          type="text" 
                          value={item?.precoVenda ?? (p.precoVenda ?? 0).toFixed(2)} 
                          onChange={(e) => handlePriceChange(p.id, e.target.value)} 
                          className={`w-14 bg-transparent border-none p-0 text-[11px] font-black outline-none ${isBelowMin ? 'text-rose-600' : 'text-emerald-600'}`} 
                        />
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
              {isBelowMin && (
                <p className="text-[8px] text-rose-600 font-black uppercase mt-1 animate-pulse">
                  <i className="fa-solid fa-circle-exclamation mr-1"></i> Mínimo permitido: R$ {minPrice.toFixed(2)}
                </p>
              )}
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4">
            <i className="fa-solid fa-box-open text-5xl"></i>
            <p className="font-black uppercase tracking-widest text-[10px]">Nenhum produto desta categoria na sua carga.</p>
          </div>
        )}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 space-y-3 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] max-w-lg mx-auto z-[70]">
        {hasMarginViolation && (
          <div className="bg-rose-600 text-white p-3 rounded-xl text-center font-black text-[9px] uppercase tracking-widest animate-pulse flex items-center justify-center gap-2">
            <i className="fa-solid fa-circle-exclamation text-sm"></i>
            Venda Bloqueada: Preço abaixo da margem mínima!
          </div>
        )}
        <div className="flex items-center justify-between px-1 mb-1 bg-gray-50/50 p-2 rounded-xl">
          <div className="flex items-center gap-2">
            <button onClick={() => setIsTrocaActive(!isTrocaActive)} className={`w-10 h-6 rounded-full relative transition-colors ${isTrocaActive ? 'bg-orange-500' : 'bg-gray-300'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isTrocaActive ? 'left-5' : 'left-1'}`}></div>
            </button>
            <span className="text-[9px] font-black text-gray-400 uppercase">Troca/Desc.</span>
          </div>
          {isTrocaActive && <input type="number" value={valorTroca} onChange={e => setValorTroca(e.target.value)} placeholder="R$ 0.00" className="w-24 bg-white border border-orange-100 rounded-lg text-[11px] font-black text-orange-600 p-2 text-right outline-none" />}
        </div>
        <div className="flex justify-between items-end px-1">
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase mb-0.5">Total Líquido</p>
            <p className="text-xl font-black text-gray-800">R$ {total.toFixed(2)}</p>
          </div>
          <button 
            onClick={() => setView('RECEIPT_PREVIEW')} 
            disabled={(total <= 0 && getOrderedItems().length === 0) || hasMarginViolation} 
            className={`px-6 py-4 rounded-2xl font-black uppercase text-xs ${(total > 0 || getOrderedItems().length > 0) && !hasMarginViolation ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-200 text-gray-400'}`}
          >
            Gerar Cupom
          </button>
        </div>
      </footer>

      {view === 'PAYMENT' && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-end justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom max-h-[95vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-lg mb-4 text-center uppercase tracking-tight">Finalizar Pagamento</h3>
              
              <div className="bg-gray-50 p-4 rounded-2xl mb-6 text-center border border-gray-100">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Valor Total Devido</p>
                <p className="text-3xl font-black text-blue-600">R$ {total.toFixed(2)}</p>
              </div>

              <div className="flex gap-1.5 mb-6 justify-center">
                {(['DINHEIRO', 'PIX', 'A_PRAZO'] as const).map(m => (
                  <button key={m} onClick={() => setMetodo(m)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${metodo === m ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-50 text-gray-400'}`}>{m === 'A_PRAZO' ? 'PRAZO' : m}</button>
                ))}
              </div>

              {metodo === 'DINHEIRO' && (
                <div className="mb-6 space-y-4 animate-in fade-in duration-300">
                   <div className="space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor Recebido R$</label>
                      <input 
                        type="number" 
                        value={valorRecebido} 
                        onChange={e => setValorRecebido(e.target.value)} 
                        placeholder="0.00" 
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black text-center outline-none" 
                        autoFocus
                      />
                   </div>
                   {parseFloat(valorRecebido) > total && (
                     <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center animate-in zoom-in-95">
                        <p className="text-[10px] font-black text-emerald-600 uppercase mb-1">Troco a Devolver</p>
                        <p className="text-2xl font-black text-emerald-700">R$ {troco.toFixed(2)}</p>
                     </div>
                   )}
                </div>
              )}

              {metodo === 'A_PRAZO' && (
                <div className="mb-6 space-y-4 animate-in fade-in duration-300">
                   <div className="grid grid-cols-4 gap-2">
                     {[7, 14, 21, 30].map(days => (
                       <button key={days} onClick={() => setPrazoDays(days)} className="py-3 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">{days}D</button>
                     ))}
                   </div>
                   <div className="space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Data de Vencimento</label>
                      <input type="date" value={prazoData} onChange={e => setPrazoData(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                   </div>
                </div>
              )}

              {metodo === 'PIX' && (
                <div className="mb-6 space-y-4 animate-in fade-in duration-300">
                   <p className="text-[9px] font-black text-gray-400 uppercase text-center">Selecione o Banco para Receber</p>
                   <div className="grid grid-cols-2 gap-2">
                     <button onClick={() => setSelectedPixSlot(1)} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${selectedPixSlot === 1 ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400'}`}>{pix1Name}</button>
                     <button onClick={() => setSelectedPixSlot(2)} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${selectedPixSlot === 2 ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400'}`}>{pix2Name}</button>
                   </div>
                   
                   <div className="bg-gray-50 p-4 rounded-2xl flex flex-col items-center border border-gray-100">
                     <p className="text-[8px] font-black text-gray-400 uppercase mb-3">QR CODE PARA PAGAMENTO</p>
                     <div className="w-32 h-32 bg-white rounded-xl flex items-center justify-center border border-gray-200 overflow-hidden shadow-inner">
                        {selectedPixSlot === 1 ? (
                          pix1Code ? <img src={pix1Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-3xl"></i>
                        ) : (
                          pix2Code ? <img src={pix2Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-3xl"></i>
                        )}
                     </div>
                   </div>
                </div>
              )}

              <button 
                onClick={handleConfirmFinalize} 
                disabled={hasMarginViolation}
                className={`w-full bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all mb-2 tracking-widest ${hasMarginViolation ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Concluir Venda
              </button>
              <button onClick={() => setView('RECEIPT_PREVIEW')} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Voltar ao Cupom</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default PDV;