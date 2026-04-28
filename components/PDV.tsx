import React, { useState, useEffect, useMemo } from 'react';
import { Product, Client, Carga, Sale, SaleItem, PaymentMethod } from '../types';
import Cupom from './Cupom';

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
  const [cart, setCart] = useState<{ [key: string]: { quantidade: number, precoVenda: string } }>({});
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

  const clientDebt = useMemo(() => {
    const pendingSales = sales.filter(s => s.clientId === client.id && s.statusPagamento === 'PENDENTE');
    return pendingSales.reduce((acc, s) => acc + (s.valorTotal - s.valorPago), 0);
  }, [sales, client.id]);

  useEffect(() => {
    const savedCart = localStorage.getItem(`pdv_cart_${vendedorId}_${client.id}`);
    if (savedCart) {
      try { setCart(JSON.parse(savedCart)); } catch (e) { console.error("Erro ao carregar carrinho", e); }
    }
  }, [client.id, vendedorId]);

  useEffect(() => {
    if (Object.keys(cart).length > 0) {
      localStorage.setItem(`pdv_cart_${vendedorId}_${client.id}`, JSON.stringify(cart));
    } else {
      localStorage.removeItem(`pdv_cart_${vendedorId}_${client.id}`);
    }
  }, [cart, client.id, vendedorId]);

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

  const marginViolationInfo = useMemo(() => {
    if (!margemMinimaAtiva) return null;
    for (const [pId, item] of Object.entries(cart)) {
        const cartItem = item as { quantidade: number, precoVenda: string };
        const product = products.find(p => p.id === pId);
        if (!product) continue;
        const currentPrice = parseFloat(cartItem.precoVenda) || 0;
        const minPriceAllowed = Number(((product.precoCusto ?? 0) / (1 - margemMinima / 100)).toFixed(2));
        if (currentPrice < minPriceAllowed) return { productName: product.nome, minPrice: minPriceAllowed.toFixed(2), currentPrice: currentPrice.toFixed(2) };
    }
    return null;
  }, [cart, products, margemMinima, margemMinimaAtiva]);

  const hasMarginViolation = !!marginViolationInfo;

  const handleSelectMetodo = (m: PaymentMethod) => {
    setMetodo(m);
    if (m === 'A_PRAZO') setShowPrazoOverlay(true);
    else { setDetalheMetodo(m === 'DINHEIRO' ? 'Dinheiro' : 'Pix'); setSelectedPixSlot(null); }
  };

  const handleConfirmFinalize = async () => {
    const itens: SaleItem[] = Object.entries(cart).map(([pId, item]) => {
      const cartItem = item as { quantidade: number, precoVenda: string };
      return {
        produtoId: pId, 
        quantidade: cartItem.quantidade, 
        precoVenda: parseFloat(cartItem.precoVenda) || 0
      };
    });

    const descontoInfo = isTrocaActive && parseFloat(valorTroca) > 0 ? ` (Troca: R$ ${parseFloat(valorTroca).toFixed(2)})` : '';
    const finalDetalhe = (metodo === 'PIX' ? (selectedPixSlot === 1 ? pix1Name : pix2Name) : detalheMetodo) + descontoInfo;
    
    const salePayload: any = { vendedorId, clientId: client.id, valorTotal: total, metodoPagamento: metodo, detalhePagamento: finalDetalhe, itens };
    if (metodo === 'A_PRAZO') { salePayload.statusPagamento = 'PENDENTE'; salePayload.dataVencimento = new Date(prazoData); }
    else { salePayload.statusPagamento = 'PAGO'; }
    
    const newSale = await processSale(salePayload);
    if (newSale) { 
      localStorage.removeItem(`pdv_cart_${vendedorId}_${client.id}`); 
      onFinish(newSale); 
    }
  };

  const previewSale: Sale = {
    id: 'preview',
    vendedorId,
    clientId: client.id,
    data: new Date(),
    valorTotal: total,
    valorPago: 0,
    metodoPagamento: metodo,
    statusPagamento: 'PENDENTE',
    itens: Object.entries(cart).map(([pId, item]) => ({
      produtoId: pId,
      quantidade: (item as any).quantidade,
      precoVenda: parseFloat((item as any).precoVenda) || 0
    }))
  };

  if (view === 'RECEIPT_PREVIEW') {
    return (
      <div className="fixed inset-0 bg-gray-900 z-[100] flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Cupom 
            sale={previewSale} 
            client={client} 
            products={products} 
            onBack={() => setView('CART')} // Volta para o carrinho
            onClose={() => setView('PAYMENT')} // Avança para o pagamento
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
        <button onClick={() => { setCart({}); setValorTroca(''); setIsTrocaActive(false); }} className="w-9 h-9 bg-rose-50 text-rose-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-trash-can text-sm"></i></button>
      </header>

      {clientDebt > 0 && (
        <button 
          onClick={() => { onCancel(); onNavigateToCredit(); }}
          className="w-full bg-rose-600 text-white p-3 flex items-center justify-center gap-3 shadow-md active:scale-[0.99] transition-all"
        >
          <i className="fa-solid fa-triangle-exclamation text-sm"></i>
          <span className="text-[10px] font-black uppercase tracking-widest">
            CLIENTE COM DÍVIDA PENDENTE: R$ {clientDebt.toFixed(2)} - CLIQUE PARA RECEBER
          </span>
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 pb-44">
        {orderedProductsInCarga.map(p => { 
          const itemNoCart = cart[p.id];
          const cargaOriginal = minhaCarga.find(c => c.produtoId === p.id)?.quantidade || 0;
          const cargaDisponivel = cargaOriginal - (itemNoCart?.quantidade ?? 0); 
          if (cargaOriginal <= 0 && (itemNoCart?.quantidade ?? 0) === 0) return null;

          const currentPrice = parseFloat(itemNoCart?.precoVenda || (p.precoVenda ?? 0).toString()) || 0; 
          const minPriceAllowed = Number(((p.precoCusto ?? 0) / (1 - margemMinima / 100)).toFixed(2));
          const isInvalidPrice = margemMinimaAtiva && currentPrice < minPriceAllowed;

          return (
            <div key={p.id} className={`bg-white p-2.5 rounded-2xl border transition-all flex items-center gap-3 ${isInvalidPrice ? 'border-rose-500 bg-rose-50' : itemNoCart?.quantidade ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100 shadow-sm'}`}>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h3> 
                <div className="flex items-center gap-2 mt-1">
                   <div className="flex items-center gap-1.5 bg-white border border-gray-100 px-2 py-0.5 rounded-lg shadow-inner">
                      <span className="text-[9px] font-black text-gray-300">R$</span>
                      <input type="text" value={itemNoCart?.precoVenda ?? (p.precoVenda ?? 0).toFixed(2)} onChange={(e) => handlePriceChange(p.id, e.target.value)} className={`w-14 bg-transparent border-none p-0 text-[11px] font-black outline-none ${isInvalidPrice ? 'text-rose-600' : 'text-emerald-600'}`} />
                   </div>
                   <span className={`text-[9px] font-bold uppercase ${cargaDisponivel > 0 ? 'text-blue-500' : 'text-rose-500'}`}>{cargaDisponivel} UN</span>
                </div>
              </div>
              <div className="flex items-center bg-white rounded-xl p-0.5 border border-gray-100 shadow-sm">
                <button onClick={() => updateCart(p.id, -1, (p.precoVenda ?? 0))} className="w-8 h-8 text-gray-400 active:scale-90 flex items-center justify-center hover:text-rose-500"><i className="fa-solid fa-minus text-[10px]"></i></button> 
                <span className={`font-black text-xs min-w-[22px] text-center ${itemNoCart?.quantidade ? 'text-blue-600' : 'text-gray-300'}`}>{(itemNoCart?.quantidade ?? 0)}</span> 
                <button onClick={() => updateCart(p.id, 1, (p.precoVenda ?? 0))} className="w-8 h-8 text-blue-600 active:scale-90 flex items-center justify-center hover:bg-blue-50 rounded-lg"><i className="fa-solid fa-plus text-[10px]"></i></button> 
              </div>
            </div>
          );
        })}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 space-y-3 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] max-w-lg mx-auto z-[70]">
        {hasMarginViolation && marginViolationInfo && (
          <div className="bg-rose-600 text-white p-2 rounded-xl flex items-center justify-center gap-2 animate-pulse mb-1">
            <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>
            <span className="text-[9px] font-black uppercase">Bloqueio: Preço mínimo R$ {marginViolationInfo.minPrice}</span>
          </div>
        )}
        
        <div className="flex items-center justify-between px-1 mb-1 bg-gray-50/50 p-2 rounded-xl border border-gray-100/50">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => { setIsTrocaActive(!isTrocaActive); if(isTrocaActive) setValorTroca(''); }}
              className={`w-8 h-4 rounded-full relative transition-colors ${isTrocaActive ? 'bg-orange-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isTrocaActive ? 'left-4.5' : 'left-0.5'}`}></div>
            </button>
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">Troca / Vencidos</span>
          </div>
          {isTrocaActive && (
            <div className="flex items-center gap-1.5 bg-white border border-orange-100 px-2 py-1 rounded-lg shadow-inner animate-in fade-in slide-in-from-right-2 duration-200">
              <span className="text-[10px] font-black text-orange-400">R$</span>
              <input 
                type="number" 
                inputMode="decimal"
                value={valorTroca} 
                onChange={(e) => setValorTroca(e.target.value)} 
                placeholder="0.00"
                className="w-16 bg-transparent border-none p-0 text-[11px] font-black outline-none text-orange-600 text-right"
              />
            </div>
          )}
        </div>

        <div className="flex justify-between items-end px-1">
            <div className="flex flex-col">
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total Pedido</span>
              <span className={`text-xl font-black leading-none ${isTrocaActive && parseFloat(valorTroca) > 0 ? 'text-orange-600' : 'text-gray-800'}`}>R$ {total.toFixed(2)}</span>
            </div>
        </div>

        <button 
          onClick={() => setView('RECEIPT_PREVIEW')} 
          disabled={total === 0 || hasMarginViolation} 
          className={`w-full py-4 rounded-2xl font-black shadow-lg uppercase tracking-widest text-xs transition-all active:scale-95 flex items-center justify-center gap-3 ${total > 0 && !hasMarginViolation ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
        >
          <i className="fa-solid fa-file-invoice"></i> GERAR CUPOM
        </button>
      </footer>

      {view === 'PAYMENT' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-end justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom duration-300 shadow-2xl">
              <h3 className="font-black text-gray-800 text-lg mb-4 text-center uppercase">Pagamento</h3>
              
              <div className="flex gap-1.5 mb-6 justify-center">
                {(['DINHEIRO', 'PIX', 'A_PRAZO'] as PaymentMethod[]).map(m => (
                  <button key={m} onClick={() => handleSelectMetodo(m)} className={`px-3 py-2 rounded-xl text-[8px] font-black uppercase transition-all border-2 ${metodo === m ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                    {m === 'A_PRAZO' ? 'PRAZO' : m}
                  </button>
                ))}
              </div>

              {metodo === 'DINHEIRO' && (
                <div className="space-y-4 mb-6">
                  <div className="bg-gray-50 p-4 rounded-2xl text-center"><p className="text-[9px] font-black text-gray-400 uppercase mb-1">Total</p><p className="text-2xl font-black text-gray-800">R$ {total.toFixed(2)}</p></div>
                  <input type="number" value={valorRecebido} onChange={e => setValorRecebido(e.target.value)} placeholder="VALOR RECEBIDO" className={`w-full p-4 font-black rounded-2xl text-center text-xl outline-none border-2 transition-colors ${parseFloat(valorRecebido) < total ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'}`} />
                  {parseFloat(valorRecebido) > total && <div className="bg-blue-50 p-3 rounded-xl flex justify-between items-center"><p className="text-[10px] font-black text-blue-600 uppercase">Troco</p><p className="text-lg font-black text-blue-700">R$ {(parseFloat(valorRecebido) - total).toFixed(2)}</p></div>}
                </div>
              )}
              {metodo === 'PIX' && (
                <div className="space-y-4 mb-6">
                  <p className="text-[10px] font-black text-gray-400 uppercase text-center">Selecione a conta</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setSelectedPixSlot(1)} className={`p-4 rounded-2xl border-2 transition-all text-center ${selectedPixSlot === 1 ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400'}`}><span className="text-[9px] font-black uppercase leading-tight">{pix1Name}</span></button>
                    <button onClick={() => setSelectedPixSlot(2)} className={`p-4 rounded-2xl border-2 transition-all text-center ${selectedPixSlot === 2 ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400'}`}><span className="text-[9px] font-black uppercase leading-tight">{pix2Name}</span></button>
                  </div>
                  {selectedPixSlot && <button onClick={() => setShowPixOverlay(selectedPixSlot)} className="w-full bg-blue-100 text-blue-600 py-3 rounded-xl font-black text-[10px] uppercase">Ver QR Code</button>}
                </div>
              )}
              {metodo === 'A_PRAZO' && <div className="bg-indigo-50 p-4 rounded-2xl mb-6 text-center"><p className="text-[9px] font-black text-indigo-400 uppercase mb-1">Vencimento</p><p className="text-lg font-black text-indigo-700">{prazoData ? new Date(prazoData).toLocaleDateString() : 'N/D'}</p></div>}
              
              <button onClick={handleConfirmFinalize} disabled={(metodo === 'DINHEIRO' && (parseFloat(valorRecebido) || 0) < total) || (metodo === 'PIX' && !selectedPixSlot)} className={`w-full py-4 rounded-2xl font-black shadow-xl uppercase text-xs transition-all ${((metodo === 'DINHEIRO' && (parseFloat(valorRecebido) || 0) >= total) || (metodo === 'PIX' && selectedPixSlot) || metodo === 'A_PRAZO') ? 'bg-emerald-600 text-white active:scale-95' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}>FINALIZAR VENDA</button>
              <button onClick={() => setView('RECEIPT_PREVIEW')} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase mt-2">Voltar ao Cupom</button>
           </div>
        </div>
      )}

      {showPrazoOverlay && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-end justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-lg mb-6 text-center uppercase">Venda a Prazo</h3>
              <div className="space-y-4 mb-8">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Forma</label>
                <div className="grid grid-cols-2 gap-2">{['Cheque', 'Boleto', 'Pix a prazo', 'Dinheiro'].map(det => (<button key={det} onClick={() => setDetalheMetodo(det)} className={`py-3 rounded-xl text-[9px] font-black uppercase border ${detalheMetodo === det ? 'bg-indigo-800 text-white border-indigo-800 shadow-md' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>{det}</button>))}</div>
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1 mt-4 block">Vencimento</label>
                <div className="grid grid-cols-4 gap-2">{[7, 14, 21, 30].map(d => (<button key={d} onClick={() => { const dt = new Date(); dt.setDate(dt.getDate() + d); setPrazoData(dt.toISOString().split('T')[0]); }} className={`py-3 rounded-xl text-[9px] font-black border ${prazoData === new Date(new Date().setDate(new Date().getDate() + d)).toISOString().split('T')[0] ? 'bg-indigo-800 text-white' : 'bg-gray-50 text-gray-600'}`}>{d}D</button>))}</div>
                <input type="date" min={todayStr} value={prazoData} onChange={e => setPrazoData(e.target.value)} className="w-full p-4 bg-indigo-50 text-indigo-800 font-black border-none rounded-2xl outline-none mt-2" />
              </div>
              <button onClick={() => { if(!prazoData) return alert("Defina o vencimento."); setShowPrazoOverlay(false); }} className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs">Salvar Condição</button>
           </div>
        </div>
      )}

      {showPixOverlay && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[130] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-[2.5rem] p-8 text-center animate-in zoom-in-95">
            <h3 className="font-black text-gray-800 text-sm mb-6 uppercase tracking-widest">{showPixOverlay === 1 ? pix1Name : pix2Name}</h3>
            <div className="w-48 h-48 mx-auto bg-gray-50 p-2 rounded-2xl border-2 border-dashed border-gray-200 mb-6 flex items-center justify-center overflow-hidden">
               {showPixOverlay === 1 ? (pix1Code ? <img src={pix1Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-4xl"></i>) : (pix2Code ? <img src={pix2Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-4xl"></i>)}
            </div>
            <p className="text-[10px] font-black text-rose-600 uppercase mb-6 animate-pulse">
              Confirme o PIX antes de finalizar a venda
            </p>
            <button onClick={() => setShowPixOverlay(null)} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl uppercase text-[10px]">Fechar QR Code</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PDV;