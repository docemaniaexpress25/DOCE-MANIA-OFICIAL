"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface SaleItem { produto_id: string; quantidade: number; preco_venda: number; }
interface Sale {
  id: string; valor_total: number; valor_pago: number; metodo_pagamento: string;
  status_pagamento: string; data_venda: string; data_vencimento: string | null;
  sale_items: SaleItem[];
}
interface Sugestao { produto_id: string; nome: string; popularidade: number; clientesQueCompram: number; preco: number; }
interface Stats {
  totalComprado: number; totalPago: number; clienteDesde: string;
  frequenciaDias: number; totalCompras: number;
  produtoFavorito: string; produtoFavoritoQtd: number;
}
interface ApiResponse {
  client: { id: string; nome_fantasia: string; endereco: string; bairro: string };
  sales: Sale[]; products: Record<string, string>; stats: Stats; sugestoes: Sugestao[];
  error?: string;
}

function formatDate(d: string) { return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function formatCurrency(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function getPaymentLabel(m: string) { return { DINHEIRO: 'Dinheiro', PIX: 'PIX', A_PRAZO: 'A Prazo' }[m] || m; }

export default function ClienteDashboard() {
  const params = useParams();
  const codigo = params.codigo as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [tab, setTab] = useState<'todas' | 'pendentes'>('todas');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!codigo) return;
    fetch(`/api/cliente/${codigo}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { if (d.error) { setError(d.error); return; } setData(d); })
      .catch(() => setError('Erro ao carregar.'))
      .finally(() => setLoading(false));
  }, [codigo]);

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (loading) return (<div className="min-h-screen bg-gray-100 flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div></div>);

  if (error || !data) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-6">
      <div className="text-center bg-white rounded-2xl p-8 shadow-sm border border-gray-100 max-w-sm">
        <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4"><i className="fa-solid fa-link-slash text-rose-400 text-xl"></i></div>
        <p className="text-sm font-bold text-gray-700">Link invalido</p>
        <p className="text-xs text-gray-400 mt-1">Este link nao esta associado a nenhum cliente.</p>
      </div>
    </div>
  );

  const { client, sales, products, stats, sugestoes } = data;
  const saldoDevedor = stats.totalComprado - stats.totalPago;
  const vendasPendentes = sales.filter(s => s.status_pagamento === 'PENDENTE');
  const saldoPendente = vendasPendentes.reduce((a, s) => a + (Number(s.valor_total) - Number(s.valor_pago)), 0);
  const listSales = tab === 'pendentes' ? vendasPendentes : sales;
  const firstName = (client.nome_fantasia || '').split(' ')[0];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header personalizado */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white px-5 pt-14 pb-24 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>
        <div className="max-w-md mx-auto relative z-10">
          <p className="text-[10px] font-bold text-blue-200/70 uppercase tracking-[0.2em] mb-3">Extrato do Cliente</p>
          <h1 className="text-2xl font-black uppercase tracking-tight leading-tight">{client.nome_fantasia}</h1>
          {client.endereco && (
            <p className="text-[11px] text-blue-200/60 mt-2 font-medium">
              <i className="fa-solid fa-location-dot mr-1 text-[9px]"></i>{client.endereco}{client.bairro ? ` - ${client.bairro}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* KPIs flutuante */}
      <div className="max-w-md mx-auto px-4 -mt-16 relative z-20">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-5 grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Comprado</p>
            <p className="text-[15px] font-black text-blue-600 mt-0.5">{formatCurrency(stats.totalComprado)}</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Pago</p>
            <p className="text-[15px] font-black text-emerald-600 mt-0.5">{formatCurrency(stats.totalPago)}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Devedor</p>
            <p className={`text-[15px] font-black mt-0.5 ${saldoDevedor > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{formatCurrency(saldoDevedor)}</p>
          </div>
        </div>
      </div>

      {/* Perfil personalizado */}
      <div className="max-w-md mx-auto px-4 mt-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-3">
            <i className="fa-solid fa-fingerprint mr-1 text-blue-400"></i>Seu Perfil
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-calendar-check text-blue-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Cliente desde</p>
                <p className="text-[11px] font-black text-gray-700 capitalize">{stats.clienteDesde}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-repeat text-indigo-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Frequencia</p>
                <p className="text-[11px] font-black text-gray-700">{stats.frequenciaDias > 0 ? `A cada ${stats.frequenciaDias} dias` : `${stats.totalCompras} compra(s)`}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-star text-emerald-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Favorito</p>
                <p className="text-[11px] font-black text-gray-700 truncate max-w-[120px]">{stats.produtoFavorito}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center shrink-0">
                <i className="fa-solid fa-bag-shopping text-purple-500 text-[10px]"></i>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400">Total pedidos</p>
                <p className="text-[11px] font-black text-gray-700">{stats.totalCompras} compra(s)</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pendente */}
      {vendasPendentes.length > 0 && (
        <div className="max-w-md mx-auto px-4 mt-4">
          <div className="bg-gradient-to-r from-rose-50 to-orange-50 rounded-2xl px-4 py-3 border border-rose-100 flex items-center gap-3">
            <div className="w-9 h-9 bg-rose-100 rounded-xl flex items-center justify-center shrink-0">
              <i className="fa-solid fa-triangle-exclamation text-rose-500 text-sm"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-rose-600 uppercase">Voce tem pendencias</p>
              <p className="text-sm font-black text-rose-800">{formatCurrency(saldoPendente)}</p>
            </div>
            <span className="text-[9px] font-bold text-rose-500 bg-rose-100 px-2.5 py-1 rounded-lg">{vendasPendentes.length}</span>
          </div>
        </div>
      )}

      {/* Sugestoes - produtos que outros compram */}
      {sugestoes && sugestoes.length > 0 && (
        <div className="max-w-md mx-auto px-4 mt-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
                <i className="fa-solid fa-lightbulb text-amber-500 text-xs"></i>
              </div>
              <div>
                <p className="text-[10px] font-black text-gray-700">Sugestoes para {firstName}</p>
                <p className="text-[9px] text-gray-400 font-semibold">Produtos que a maioria dos clientes compra</p>
              </div>
            </div>
            <div className="space-y-2">
              {sugestoes.slice(0, 4).map((s, i) => (
                <div key={i} className="flex items-center gap-3 bg-amber-50/50 rounded-xl px-3 py-2.5 border border-amber-100/50">
                  <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-cart-plus text-amber-600 text-[9px]"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-gray-700 truncate capitalize">{s.nome}</p>
                    <p className="text-[9px] text-amber-600 font-semibold">{s.popularidade}% dos clientes compram</p>
                  </div>
                  {s.preco > 0 && <span className="text-[10px] font-black text-gray-500">{formatCurrency(s.preco)}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs + Lista */}
      <div className="max-w-md mx-auto px-4 mt-5">
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-100 mb-4">
          <button onClick={() => setTab('todas')} className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tab === 'todas' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400'}`}>
            Todas ({sales.length})
          </button>
          <button onClick={() => setTab('pendentes')} className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tab === 'pendentes' ? 'bg-rose-500 text-white shadow-sm' : 'text-gray-400'}`}>
            Pendentes ({vendasPendentes.length})
          </button>
        </div>

        <div className="space-y-2 pb-10">
          {listSales.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
              <i className="fa-solid fa-receipt text-gray-200 text-4xl mb-3 block"></i>
              <p className="text-xs text-gray-400 font-semibold">Nenhuma compra encontrada</p>
            </div>
          ) : listSales.map(sale => {
            const isPending = sale.status_pagamento === 'PENDENTE';
            const restante = Number(sale.valor_total) - Number(sale.valor_pago);
            const isOpen = expanded.has(sale.id);

            return (
              <div key={sale.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                {/* Linha resumida - SEMPRE VISIVEL */}
                <button onClick={() => toggle(sale.id)} className="w-full px-4 py-3.5 flex items-center justify-between text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPending ? 'bg-rose-400' : 'bg-emerald-400'}`}></div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase ${isPending ? 'text-rose-600' : 'text-emerald-600'}`}>{isPending ? 'Devendo' : 'Pago'}</span>
                        <span className="text-[10px] text-gray-400 font-semibold">{formatDate(sale.data_venda)}</span>
                      </div>
                      <p className="text-[9px] text-gray-400 font-medium mt-0.5">{getPaymentLabel(sale.metodo_pagamento)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-sm font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                    <i className={`fa-solid fa-chevron-down text-[9px] text-gray-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
                  </div>
                </button>

                {/* Detalhes - CUPOM EXPANDIDO */}
                {isOpen && (
                  <div>
                    <div className="border-t border-gray-100 mx-4"></div>
                    <div className="px-4 py-3">
                      <div className="border-l-2 border-dashed border-gray-200 pl-3 space-y-1.5">
                        {(sale.sale_items || []).map((item, idx) => (
                          <div key={idx} className="flex items-baseline justify-between text-[11px]">
                            <span className="text-gray-700 font-medium capitalize">{products[item.produto_id] || 'Produto'}</span>
                            <span className="text-gray-400 font-bold tabular-nums ml-3 shrink-0">{item.quantidade} un</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-dashed border-gray-200 mx-4"></div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Total</span>
                      <span className="text-base font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                    </div>
                    {isPending && restante > 0 && (
                      <div className="bg-rose-50 px-4 py-2 border-t border-rose-100 flex items-center justify-between">
                        <span className="text-[9px] font-bold text-rose-500">Falta pagar</span>
                        <span className="text-[11px] font-black text-rose-600">{formatCurrency(restante)}</span>
                      </div>
                    )}
                    {isPending && sale.data_vencimento && (
                      <div className="bg-amber-50 px-4 py-2 border-t border-amber-100">
                        <p className="text-[9px] font-bold text-amber-600 text-center uppercase">
                          <i className="fa-solid fa-calendar-day mr-1"></i>Vence em {formatDate(sale.data_vencimento)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center pb-6">
        <p className="text-[9px] text-gray-300 font-semibold tracking-widest uppercase">Doce Mania Distribuidora</p>
      </div>
    </div>
  );
}