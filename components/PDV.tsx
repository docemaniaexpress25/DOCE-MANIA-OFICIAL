import React, { useState, useEffect, useMemo } from 'react';
import { Product, Client, Carga, Sale, SaleItem, PaymentMethod } from '../types';

interface PDVProps {
  client: Client;
  products: Product[];
  minhaCarga: Carga[];
  vendedorId: string;
  onCancel: () => void;
  onFinish: (sale: Sale) => void;
  // Fix: processSale should return Promise<Sale | null>
  processSale: (data: any) => Promise<Sale | null>;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
}

const PDV: React.FC<PDVProps> = ({ client, products, minhaCarga, vendedorId, onCancel, onFinish, processSale, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code }) => {
  const [cart, setCart] = useState<{ [key: string]: { quantidade: number, precoVenda: string } }>({});
  const [metodo, setMetodo] = useState<PaymentMethod>('DINHEIRO');
  const [detalheMetodo, setDetalheMetodo] = useState<string>('Dinheiro');
  const [showPrazoOverlay, setShowPrazoOverlay] = useState(false);
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [showPixOverlay, setShowPixOverlay] = useState<1 | 2 | null>(null); // Novo estado para o modal Pix
  const [prazoData, setPrazoData] = useState<string>('');
  
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [selectedPixSlot, setSelectedPixSlot] = useState<1 | 2 | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Mapeia os IDs dos produtos que o vendedor tem na carga
  const productIdsInCarga = useMemo(() => new Set(minhaCarga.map(c => c.produtoId)), [minhaCarga]);

  useEffect(() => {
    const savedCart = localStorage.getItem(`pdv_cart_${vendedorId}_${client.id}`);
    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch (e) {
        console.error("Erro ao carregar carrinho persistido", e);
      }
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
      if (novaQtd === 0) {
        const { [pId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [pId]: { ...current, quantidade: novaQtd } };
    });
  };

  const clearCart = () => {
    setCart({});
    localStorage.removeItem(`pdv_cart_${vendedorId}_${client.id}`);
  };

  const handlePriceChange = (pId: string, value: string) => {
    const sanitized = value.replace(',', '.');
    setCart(prev => {
      if (!prev[pId]) return prev;
      return { ...prev, [pId]: { ...prev[pId], precoVenda: sanitized } };
    });
  };

  const total = Object.entries(cart).reduce((acc, [_, item]) => {
    const cartItem = item as { quantidade: number, precoVenda: string };
    const price = parseFloat(cartItem.precoVenda) || 0;
    return acc + ((cartItem.quantidade ?? 0) * price); 
  }, 0);

  const valorRecebidoNum = parseFloat(valorRecebido) || 0;
  const troco = Math.max(0, valorRecebidoNum - total);

  const hasMarginViolation = useMemo(() => {
    if (!margemMinimaAtiva) return false;
    return Object.entries(cart).some(([pId, item]) => {
        const product = products.find(p => p.id === pId);
        if (!product) return false;
        const currentPrice = parseFloat((item as any).precoVenda) || 0;
        
        const minPriceAllowed = Number(((product.precoCusto ?? 0) / (1 - margemMinima / 100)).toFixed(2));
        return currentPrice < minPriceAllowed;
    });
  }, [cart, products, margemMinima, margemMinimaAtiva]);

  const canFinalize = useMemo(() => {
    if (total <= 0 || hasMarginViolation) return false;
    if (metodo === 'DINHEIRO') return valorRecebidoNum > 0 && valorRecebidoNum >= total;
    if (metodo === 'PIX') return selectedPixSlot !== null;
    if (metodo === 'A_PRAZO') return prazoData !== '';
    return true;
  }, [total, metodo, valorRecebidoNum, prazoData, hasMarginViolation, selectedPixSlot]);

  const handleSelectMetodo = (m: PaymentMethod) => {
    setMetodo(m);
    if (m === 'A_PRAZO') {
      setShowPrazoOverlay(true);
    } else {
      setDetalheMetodo(m === 'DINHEIRO' ? 'Dinheiro' : 'Pix');
      setSelectedPixSlot(null);
    }
  };

  const setPrazoPreset = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setPrazoData(d.toISOString().split('T')[0]);
  };

  const handleOpenFinalize = () => {
    if (total === 0) return alert("Carrinho vazio!");
    if (hasMarginViolation) return alert(`Erro: Preço abaixo da margem mínima permitida (${margemMinima}%).`);
    setShowFinalizeOverlay(true);
  };

  // Fix: handleConfirmFinalize must be async to wait for processSale
  const handleConfirmFinalize = async () => {
    const itens: SaleItem[] = Object.entries(cart).map(([pId, item]) => {
      const cartItem = item as { quantidade: number, precoVenda: string };
      return { produtoId: pId, quantidade: (cartItem.quantidade ?? 0), precoVenda: parseFloat(cartItem.precoVenda) || 0 }; 
    });

    const finalDetalhe = metodo === 'PIX' 
      ? (selectedPixSlot === 1 ? pix1Name : pix2Name) 
      : detalheMetodo;

    const salePayload: any = {
      vendedorId, clientId: client.id, valorTotal: total, metodoPagamento: metodo, detalhePagamento: finalDetalhe, itens
    };

    if (metodo === 'A_PRAZO') {
      salePayload.statusPagamento = 'PENDENTE';
      salePayload.dataVencimento = new Date(prazoData);
    } else {
       salePayload.statusPagamento = 'PAGO';
    }

    const newSale = await processSale(salePayload);
    if (newSale) {
      localStorage.removeItem(`pdv_cart_${vendedorId}_${client.id}`);
      onFinish(newSale);
    }
  };

  return (
    <div className="fixed inset-0 bg-white z-[60] flex flex-col">
      <header className="bg-gray-800 text-white p-4 flex justify-between items-center">
        <button onClick={onCancel} className="p-2"><i className="fa-solid fa-arrow-left"></i></button>
        <div className="text-center">
          <p className="text-[10px] text-gray-400 uppercase font-bold">Atendendo</p>
          <h2 className="font-bold text-sm tracking-tight">{client.nomeFantasia ?? 'Cliente Desconhecido'}</h2> 
        </div>
        <button onClick={clearCart} className="p-2 text-rose-400" title="Zerar Pedido"><i className="fa-solid fa-trash-can"></i></button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {products
          .filter(p => productIdsInCarga.has(p.id)) // Filtra apenas produtos na carga (removido o filtro 'ativo')
          .map(p => { 
          const itemNoCart = cart[p.id];
          const cargaOriginal = minhaCarga.find(c => c.produtoId === p.id)?.quantidade || 0;
          const cargaDisponivel = cargaOriginal - (itemNoCart?.quantidade ?? 0); 
          
          // Se o produto está na carga, mas a quantidade é 0 (após vendas), ele ainda deve aparecer se estiver no carrinho,
          // mas se não estiver no carrinho e a carga for 0, ele não deve aparecer.
          // Mantemos esta verificação para garantir que itens com estoque zero e fora do carrinho não sejam exibidos.
          if (cargaOriginal <= 0 && (itemNoCart?.quantidade ?? 0) === 0) return null;

          const currentPrice = parseFloat(itemNoCart?.precoVenda || (p.precoVenda ?? 0).toString()) || 0; 
          
          const minPriceAllowed = Number(((p.precoCusto ?? 0) / (1 - margemMinima / 100)).toFixed(2));
          const isInvalidPrice = margemMinimaAtiva && currentPrice < minPriceAllowed;

          return (
            <div key={p.id} className={`bg-white p-4 rounded-3xl border transition-colors shadow-sm flex items-center justify-between ${isInvalidPrice ? 'border-rose-500 bg-rose-50' : 'border-gray-100'}`}>
              <div className="flex-1">
                <h3 className="font-bold text-gray-800 text-sm tracking-tight">{p.nome ?? 'Produto Desconhecido'}</h3> 
                <p className={`text-[10px] font-semibold uppercase mt-1 ${cargaDisponivel > 0 ? 'text-blue-600' : 'text-rose-600'}`}>Disp: {cargaDisponivel} UN</p>
                <div className="mt-2 flex items-center gap-2">
                   <span className="text-xs font-black text-gray-400">R$</span>
                   <input 
                      type="text" 
                      value={itemNoCart?.precoVenda ?? (p.precoVenda ?? 0).toFixed(2).toString()} 
                      onChange={(e) => handlePriceChange(p.id, e.target.value)} 
                      className={`w-24 border-none p-2 rounded-xl text-sm font-black outline-none ${isInvalidPrice ? 'bg-white text-rose-600' : 'bg-gray-50 text-green-600'}`} />
                </div>
              </div>
              <div className="flex items-center gap-4 bg-gray-50 p-2 rounded-2xl">
                <button onClick={() => updateCart(p.id, -1, (p.precoVenda ?? 0))} className="w-10 h-10 bg-white border border-gray-200 text-gray-500 rounded-xl active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus"></i></button> 
                <span className="font-black text-lg min-w-[24px] text-center">{(itemNoCart?.quantidade ?? 0)}</span> 
                <button onClick={() => updateCart(p.id, 1, (p.precoVenda ?? 0))} className="w-10 h-10 bg-blue-600 text-white rounded-xl active:scale-90 shadow-lg flex items-center justify-center"><i className="fa-solid fa-plus"></i></button> 
              </div>
            </div>
          );
        })}
      </div>

      <footer className="bg-white border-t p-6 space-y-4 pb-12 shadow-2xl">
        <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-black text-gray-400 uppercase">Total da Venda</span>
            <span className="text-2xl font-black text-gray-800">R$ {total.toFixed(2)}</span>
        </div>
        {hasMarginViolation && <div className="bg-rose-100 p-3 rounded-xl flex items-center gap-2 text-rose-700 animate-pulse"><i className="fa-solid fa-circle-exclamation"></i><span className="text-[10px] font-black uppercase">Venda Bloqueada: Margem Mínima ({margemMinima}%)</span></div>}
        <div className="flex gap-2">{(['DINHEIRO', 'PIX', 'A_PRAZO'] as PaymentMethod[]).map(m => (<button key={m} onClick={() => handleSelectMetodo(m)} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase transition-all border-2 ${metodo === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>{m.replace('_', ' ')}</button>))}</div>
        <button onClick={handleOpenFinalize} disabled={total === 0 || hasMarginViolation} className={`w-full py-5 rounded-3xl font-black shadow-xl uppercase tracking-widest text-sm transition-all active:scale-95 ${total > 0 && !hasMarginViolation ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-300'}`}>Confirmar Venda</button>
      </footer>

      {showFinalizeOverlay && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-end justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom duration-300 shadow-2xl overflow-y-auto max-h-[90vh]">
              <h3 className="font-black text-gray-800 text-lg mb-4 text-center uppercase tracking-tight">Pagamento</h3>
              
              {metodo === 'DINHEIRO' && (
                <div className="space-y-4 mb-6">
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Total a Pagar</p>
                    <p className="text-2xl font-black text-gray-800">R$ {total.toFixed(2)}</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Valor Recebido</label>
                    <input type="number" min="0" value={valorRecebido} onChange={e => { const val = e.target.value; if (val === '' || parseFloat(val) >= 0) setValorRecebido(val); }} placeholder="0,00" className={`w-full p-4 font-black border-none rounded-2xl outline-none text-xl ${valorRecebidoNum < total ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`} />
                  </div>
                  {troco > 0 && <div className="bg-green-50 p-4 rounded-2xl flex justify-between items-center"><p className="text-[10px] font-black text-green-600 uppercase">Troco</p><p className="text-xl font-black text-green-700">R$ {troco.toFixed(2)}</p></div>}
                </div>
              )}

              {metodo === 'PIX' && (
                <div className="space-y-6 mb-6 text-center">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Escolha a conta Pix</p>
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => setSelectedPixSlot(1)} className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${selectedPixSlot === 1 ? 'border-blue-600 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                       <span className="text-[9px] font-black uppercase text-gray-600">{pix1Name ?? 'Pix 1'}</span> 
                       <div className="w-full aspect-square bg-white rounded-lg flex items-center justify-center overflow-hidden">
                          {pix1Code ? <i className="fa-solid fa-qrcode text-blue-600 text-3xl"></i> : <i className="fa-solid fa-qrcode text-gray-200"></i>}
                       </div>
                    </button>
                    <button onClick={() => setSelectedPixSlot(2)} className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${selectedPixSlot === 2 ? 'border-blue-600 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
                       <span className="text-[9px] font-black uppercase text-gray-600">{pix2Name ?? 'Pix 2'}</span> 
                       <div className="w-full aspect-square bg-white rounded-lg flex items-center justify-center overflow-hidden">
                          {pix2Code ? <i className="fa-solid fa-qrcode text-blue-600 text-3xl"></i> : <i className="fa-solid fa-qrcode text-gray-200"></i>}
                       </div>
                    </button>
                  </div>
                  {selectedPixSlot && (
                    <button 
                      onClick={() => setShowPixOverlay(selectedPixSlot)} 
                      className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all text-xs uppercase tracking-widest mt-4"
                    >
                      Visualizar QR Code
                    </button>
                  )}
                </div>
              )}

              {metodo === 'A_PRAZO' && (
                <div className="space-y-4 mb-6">
                   <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                      <p className="text-[10px] font-black text-indigo-400 uppercase mb-1">Vencimento Selecionado</p>
                      <p className="text-lg font-black text-indigo-700">{prazoData ? new Date(prazoData).toLocaleDateString() : 'N/D'}</p>
                   </div>
                </div>
              )}

              <button onClick={handleConfirmFinalize} disabled={!canFinalize} className={`w-full font-black py-5 rounded-3xl shadow-xl transition-all uppercase text-xs ${canFinalize ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'}`}>Finalizar Agora</button>
              <button onClick={() => setShowFinalizeOverlay(false)} className="w-full py-4 text-gray-400 font-semibold text-[10px] uppercase mt-2 text-center">Voltar</button>
           </div>
        </div>
      )}

      {showPrazoOverlay && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-lg mb-6 text-center uppercase tracking-tight">Condições a Prazo</h3>
              <div className="space-y-4 mb-6">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Forma de Pagamento</label>
                <div className="grid grid-cols-2 gap-2">{['Cheque', 'Boleto', 'Pix a prazo', 'Dinheiro a prazo'].map(det => (<button key={det} onClick={() => setDetalheMetodo(det)} className={`py-3 rounded-xl text-[10px] font-black uppercase border ${detalheMetodo === det ? 'bg-indigo-800 text-white border-indigo-800' : 'bg-white text-gray-400 border-gray-100'}`}>{det}</button>))}</div>
              </div>
              <div className="space-y-4 mb-6">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Condição de Prazo</label>
                <div className="grid grid-cols-2 gap-3">{[7, 14, 21, 30].map(d => (<button key={d} onClick={() => setPrazoPreset(d)} className={`border p-4 rounded-2xl font-black text-xs ${prazoData === new Date(new Date().setDate(new Date().getDate() + d)).toISOString().split('T')[0] ? 'bg-indigo-800 text-white' : 'bg-gray-50 text-gray-600'}`}>{d} Dias</button>))}</div>
              </div>
              <div className="space-y-2 mb-8"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Data Personalizada</label><input type="date" min={todayStr} value={prazoData} onChange={e => setPrazoData(e.target.value)} className="w-full p-4 bg-blue-50 text-blue-600 font-black border-none rounded-2xl outline-none" /></div>
              <button onClick={() => { if(!prazoData) return alert("Selecione uma data."); setShowPrazoOverlay(false); }} className="w-full bg-blue-600 text-white font-black py-5 rounded-3xl shadow-xl uppercase text-xs">Salvar Condição</button>
           </div>
        </div>
      )}

      {showPixOverlay && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 text-center shadow-2xl animate-in zoom-in-95 duration-300">
            <h3 className="font-black text-gray-800 text-lg mb-4 uppercase tracking-tight">
              PIX - {showPixOverlay === 1 ? pix1Name : pix2Name}
            </h3>
            <div className="bg-gray-50 p-4 rounded-2xl mb-6">
              <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Valor a Pagar</p>
              <p className="text-2xl font-black text-gray-800">R$ {total.toFixed(2)}</p>
            </div>
            
            <div className="w-48 h-48 mx-auto bg-white p-2 rounded-xl shadow-inner mb-6 border">
              <img 
                src={showPixOverlay === 1 ? (pix1Code ?? '') : (pix2Code ?? '')} 
                alt="QR Code Pix"
                className="w-full h-full object-contain" 
              /> 
            </div>

            <button 
              onClick={() => setShowPixOverlay(null)} 
              className="w-full bg-blue-600 text-white font-black py-5 rounded-3xl shadow-xl uppercase text-xs active:scale-95"
            >
              FECHAR QR CODE
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PDV;