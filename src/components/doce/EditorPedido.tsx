"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 31 — EDITOR DE PEDIDO (ADMIN, antes da entrega).
 *
 * O admin abre o pedido da fila (pre-venda PENDENTE/EM_ROTA/FALHOU) e edita:
 *   - ITENS: alterar quantidade, alterar preco, remover, adicionar produto
 *   - PAGAMENTO: a vista (DINHEIRO/PIX, com ou sem "ja pagou na visita")
 *                ou a prazo (BOLETO/CHEQUE/PIX na data, com vencimento)
 * O total e recalculado na hora. Salva via /api/pre-venda acao EDITAR_PEDIDO
 * (server recalcula o total e substitui os itens com rollback de seguranca).
 */

interface ItemLinha {
  produtoId: string;
  nome: string;
  quantidade: number;
  precoVenda: number;
}
interface ProdutoOpt {
  id: string;
  nome: string;
  precoVenda: number;
  precoMinimo: number;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FormasVista = [
  { id: 'DINHEIRO', label: 'Dinheiro', icon: 'fa-solid fa-money-bill-wave' },
  { id: 'PIX', label: 'Pix', icon: 'fa-brands fa-pix' },
];
const FormasPrazo = [
  { id: 'BOLETO', label: 'Boleto', icon: 'fa-solid fa-barcode' },
  { id: 'CHEQUE', label: 'Cheque', icon: 'fa-solid fa-money-check' },
  { id: 'PIX', label: 'Pix na data', icon: 'fa-brands fa-pix' },
];

const EditorPedido: React.FC<{
  pedido: {
    saleId: string;
    numero: string;
    cliente: { nome: string };
    valorTotal: number;
    formaPgto: string;
    condicao: string;
    itens: { nome: string; produtoId: string; quantidade: number; precoVenda: number }[];
  };
  onClose: () => void;
  onSalvo: (msg: string) => void;
  showToast: (m: string, t?: 'success' | 'error') => void;
}> = ({ pedido, onClose, onSalvo, showToast }) => {
  const [itens, setItens] = useState<ItemLinha[]>(pedido.itens.map(i => ({ ...i })));
  const [condicao, setCondicao] = useState<'AVISTA' | 'APRAZO'>(pedido.condicao === 'APRAZO' ? 'APRAZO' : 'AVISTA');
  // forma inicial: vem da fila (DINHEIRO/PIX/BOLETO/CHEQUE/PAGO_VISITA)
  const [forma, setForma] = useState<string>(['DINHEIRO', 'PIX', 'BOLETO', 'CHEQUE'].includes(pedido.formaPgto) ? pedido.formaPgto : 'DINHEIRO');
  const [pagoNaVisita, setPagoNaVisita] = useState<boolean>(pedido.formaPgto === 'PAGO_VISITA');
  const [vencimento, setVencimento] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [produtos, setProdutos] = useState<ProdutoOpt[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [busca, setBusca] = useState('');
  const [mostrarBusca, setMostrarBusca] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const total = useMemo(
    () => Math.round(itens.reduce((a, i) => a + i.quantidade * i.precoVenda, 0) * 100) / 100,
    [itens]
  );
  const diferenca = Math.round((total - pedido.valorTotal) * 100) / 100;

  // Produtos do catalogo: 1 request quando o modal abre (colunas explicitas)
  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregandoProdutos(true);
      try {
        const res = await fetch('/api/pre-venda?produtos=1', { headers: authHeaders() });
        const d = await res.json();
        if (vivo && res.ok && Array.isArray(d.produtos)) setProdutos(d.produtos);
      } catch { /* editor segue com os itens atuais */ }
      finally { if (vivo) setCarregandoProdutos(false); }
    })();
    return () => { vivo = false; };
  }, []);

  const setQtd = (idx: number, q: number) => {
    setItens(list => list.map((i, k) => (k === idx ? { ...i, quantidade: Math.max(1, Math.min(9999, Math.round(q || 1))) } : i)));
  };
  const setPreco = (idx: number, p: number) => {
    setItens(list => list.map((i, k) => (k === idx ? { ...i, precoVenda: Math.max(0, Math.min(999999, p || 0)) } : i)));
  };
  const remover = (idx: number) => setItens(list => list.filter((_, k) => k !== idx));
  const adicionar = (p: ProdutoOpt) => {
    setItens(list => {
      const idx = list.findIndex(i => i.produtoId === p.id);
      if (idx >= 0) return list.map((i, k) => (k === idx ? { ...i, quantidade: i.quantidade + 1 } : i));
      return [...list, { produtoId: p.id, nome: p.nome, quantidade: 1, precoVenda: p.precoVenda }];
    });
    setBusca('');
    setMostrarBusca(false);
  };

  const resultados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    if (!b) return produtos.slice(0, 12);
    return produtos.filter(p => p.nome.toLowerCase().includes(b)).slice(0, 12);
  }, [busca, produtos]);

  const formas = condicao === 'AVISTA' ? FormasVista : FormasPrazo;
  React.useEffect(() => {
    // trocou a condicao e a forma nao existe nela: volta pra padrao
    if (!formas.some(f => f.id === forma)) setForma(condicao === 'AVISTA' ? 'DINHEIRO' : 'BOLETO');
  }, [condicao]);

  async function salvar() {
    if (itens.length === 0) { showToast('Pedido precisa de pelo menos 1 item.', 'error'); return; }
    setSalvando(true);
    try {
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          acao: 'EDITAR_PEDIDO',
          saleId: pedido.saleId,
          itens: itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, precoVenda: i.precoVenda })),
          condicao,
          formaPagamento: forma,
          pagoNaVisita: condicao === 'AVISTA' ? pagoNaVisita : false,
          vencimento: condicao === 'APRAZO' ? vencimento : undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        showToast(d.error || 'Nao foi possivel salvar a edicao.', 'error');
        return;
      }
      onSalvo(`Pedido editado — novo total ${fmt(d.valorTotal ?? total)}`);
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[220] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-3xl max-h-[94vh] overflow-y-auto animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-5 pt-4 pb-3 border-b border-gray-100 z-10">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-3"></div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-gray-800 uppercase">Editar pedido</h3>
              <p className="text-[10px] font-bold text-gray-400 capitalize">{pedido.cliente.nome} · {pedido.numero}</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center active:scale-95">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* ===== ITENS ===== */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-black text-gray-400 uppercase">Itens do pedido</p>
              <button onClick={() => setMostrarBusca(v => !v)} className="text-[9px] font-black text-emerald-600 uppercase active:scale-95">
                <i className="fa-solid fa-plus mr-1"></i>Adicionar produto
              </button>
            </div>

            {mostrarBusca && (
              <div className="mb-3 bg-gray-50 rounded-2xl p-3 border border-gray-100">
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar produto..."
                  className="w-full p-3 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-100"
                />
                <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                  {carregandoProdutos && <p className="text-[10px] text-gray-400 font-bold text-center py-3">Carregando produtos...</p>}
                  {!carregandoProdutos && resultados.length === 0 && <p className="text-[10px] text-gray-400 font-bold text-center py-3">Nenhum produto encontrado</p>}
                  {resultados.map(p => (
                    <button key={p.id} onClick={() => adicionar(p)} className="w-full flex items-center justify-between px-3 py-2.5 bg-white rounded-xl border border-gray-100 active:scale-[0.98] transition-transform text-left">
                      <span className="text-[11px] font-black text-gray-700 truncate pr-2">{p.nome}</span>
                      <span className="text-[10px] font-black text-emerald-600 shrink-0">{fmt(p.precoVenda)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {itens.length === 0 && (
                <p className="text-[10px] font-black text-rose-500 bg-rose-50 rounded-xl px-3 py-3 text-center">Sem itens — adicione ao menos 1 produto</p>
              )}
              {itens.map((i, idx) => (
                <div key={`${i.produtoId}-${idx}`} className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black text-gray-700 flex-1 min-w-0 truncate">{i.nome}</p>
                    <button onClick={() => remover(idx)} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center shrink-0 active:scale-90">
                      <i className="fa-solid fa-trash-can text-[10px]"></i>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center bg-white rounded-xl border border-gray-100 overflow-hidden">
                      <button onClick={() => setQtd(idx, i.quantidade - 1)} className="w-9 h-9 text-gray-500 font-black active:bg-gray-50">−</button>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={i.quantidade}
                        onChange={e => setQtd(idx, parseFloat(e.target.value) || 1)}
                        className="w-12 text-center text-xs font-black outline-none bg-transparent"
                      />
                      <button onClick={() => setQtd(idx, i.quantidade + 1)} className="w-9 h-9 text-gray-500 font-black active:bg-gray-50">+</button>
                    </div>
                    <span className="text-gray-300">×</span>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400">R$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={i.precoVenda}
                        onChange={e => setPreco(idx, parseFloat(e.target.value) || 0)}
                        className="w-full pl-9 pr-2 py-2.5 bg-white border border-gray-100 rounded-xl text-xs font-black outline-none focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                    <span className="text-[11px] font-black text-gray-800 shrink-0 w-20 text-right">{fmt(i.quantidade * i.precoVenda)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== PAGAMENTO ===== */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Forma de pagamento</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCondicao('AVISTA')} className={`p-3.5 rounded-2xl border-2 text-left transition-all ${condicao === 'AVISTA' ? 'border-emerald-500 bg-emerald-50 shadow-md' : 'border-gray-100 bg-gray-50'}`}>
                <i className={`fa-solid fa-money-bill-wave text-base ${condicao === 'AVISTA' ? 'text-emerald-600' : 'text-gray-300'}`}></i>
                <p className={`text-[10px] font-black uppercase mt-1 ${condicao === 'AVISTA' ? 'text-emerald-700' : 'text-gray-400'}`}>À vista</p>
              </button>
              <button onClick={() => { setCondicao('APRAZO'); setPagoNaVisita(false); }} className={`p-3.5 rounded-2xl border-2 text-left transition-all ${condicao === 'APRAZO' ? 'border-amber-500 bg-amber-50 shadow-md' : 'border-gray-100 bg-gray-50'}`}>
                <i className={`fa-regular fa-calendar text-base ${condicao === 'APRAZO' ? 'text-amber-600' : 'text-gray-300'}`}></i>
                <p className={`text-[10px] font-black uppercase mt-1 ${condicao === 'APRAZO' ? 'text-amber-700' : 'text-gray-400'}`}>A prazo</p>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2">
              {formas.map(f => (
                <button key={f.id} onClick={() => setForma(f.id)} className={`py-3 rounded-2xl border-2 text-center transition-all ${forma === f.id ? 'border-gray-800 bg-gray-800 text-white shadow' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>
                  <i className={`${f.icon} text-sm`}></i>
                  <p className="text-[8px] font-black uppercase mt-1">{f.label}</p>
                </button>
              ))}
            </div>

            {condicao === 'AVISTA' ? (
              <button onClick={() => setPagoNaVisita(v => !v)} className={`w-full mt-2 p-3.5 rounded-2xl border-2 flex items-center gap-3 transition-all ${pagoNaVisita ? 'border-emerald-500 bg-emerald-50' : 'border-gray-100 bg-gray-50'}`}>
                <i className={`fa-solid ${pagoNaVisita ? 'fa-circle-check text-emerald-600' : 'fa-circle text-gray-200'} text-lg`}></i>
                <div className="text-left">
                  <p className={`text-[10px] font-black uppercase ${pagoNaVisita ? 'text-emerald-700' : 'text-gray-500'}`}>Cliente já pagou na visita</p>
                  <p className="text-[8px] font-semibold text-gray-400">{pagoNaVisita ? 'Pedido nasce PAGO — entregador só entrega' : 'Entregador recebe na entrega'}</p>
                </div>
              </button>
            ) : (
              <div className="mt-2">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Vencimento</label>
                {/* BLOCO 57 (regra do dono): aviso "Sem dinheiro na entrega" saiu —
                    o vendedor ja sabe que a prazo quem cobra e ele na visita. */}
                <input
                  type="date"
                  value={vencimento}
                  onChange={e => setVencimento(e.target.value)}
                  className="w-full mt-1 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black outline-none focus:ring-2 focus:ring-amber-100"
                />
              </div>
            )}
          </div>
        </div>

        {/* ===== RODAPE: total + salvar ===== */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black text-gray-400 uppercase">Novo total</span>
            <span className="text-lg font-black text-gray-900">{fmt(total)}</span>
          </div>
          {diferenca !== 0 && (
            <p className={`text-[9px] font-black uppercase mb-2 ${diferenca > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              <i className={`fa-solid ${diferenca > 0 ? 'fa-arrow-up' : 'fa-arrow-down'} mr-1`}></i>
              {diferenca > 0 ? 'Aumenta' : 'Diminui'} {fmt(Math.abs(diferenca))} vs original ({fmt(pedido.valorTotal)})
            </p>
          )}
          <button
            onClick={salvar}
            disabled={salvando || itens.length === 0}
            className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {salvando ? <i className="fa-solid fa-circle-notch fa-spin mr-1"></i> : <i className="fa-solid fa-floppy-disk mr-1"></i>}
            Salvar ediçao do pedido
          </button>
          <button onClick={onClose} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
        </div>
      </div>
    </div>
  );
};

export default EditorPedido;
