"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface SaleItem {
  produto_id: string;
  quantidade: number;
  preco_venda: number;
}

interface Sale {
  id: string;
  valor_total: number;
  valor_pago: number;
  metodo_pagamento: string;
  status_pagamento: string;
  data_venda: string;
  data_vencimento: string | null;
  sale_items: SaleItem[];
}

interface ApiResponse {
  client: { id: string; nome_fantasia: string; endereco: string; bairro: string };
  sales: Sale[];
  products: Record<string, string>;
  error?: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getPaymentLabel(method: string): string {
  switch (method) {
    case 'DINHEIRO': return 'Dinheiro';
    case 'PIX': return 'PIX';
    case 'A_PRAZO': return 'A Prazo';
    default: return method;
  }
}

export default function ClienteDashboard() {
  const params = useParams();
  const codigo = params.codigo as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [client, setClient] = useState<ApiResponse['client'] | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'todas' | 'pendentes'>('todas');

  useEffect(() => {
    if (!codigo) return;
    fetch(`/api/cliente/${codigo}`)
      .then(res => res.json())
      .then((data: ApiResponse) => {
        if (data.error) { setError(data.error); return; }
        setClient(data.client);
        setSales(data.sales || []);
        setProducts(data.products || {});
      })
      .catch(() => setError('Erro ao carregar dados.'))
      .finally(() => setLoading(false));
  }, [codigo]);

  const totalComprado = sales.reduce((a, s) => a + Number(s.valor_total || 0), 0);
  const totalPago = sales.reduce((a, s) => a + Number(s.valor_pago || 0), 0);
  const saldoDevedor = totalComprado - totalPago;
  const vendasPendentes = sales.filter(s => s.status_pagamento === 'PENDENTE');
  const saldoPendente = vendasPendentes.reduce((a, s) => a + (Number(s.valor_total || 0) - Number(s.valor_pago || 0)), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-6">
        <div className="text-center bg-white rounded-2xl p-8 shadow-sm border border-gray-100 max-w-sm">
          <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fa-solid fa-link-slash text-rose-400 text-xl"></i>
          </div>
          <p className="text-sm font-bold text-gray-700">Link invalido</p>
          <p className="text-xs text-gray-400 mt-1">Este link nao esta associado a nenhum cliente.</p>
        </div>
      </div>
    );
  }

  const listSales = tab === 'pendentes' ? vendasPendentes : sales;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white px-5 pt-14 pb-10">
        <div className="max-w-md mx-auto">
          <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest mb-3">Extrato do Cliente</p>
          <h1 className="text-2xl font-black uppercase tracking-tight leading-tight">{client.nome_fantasia}</h1>
          {client.endereco && (
            <p className="text-[11px] text-blue-200/80 mt-2 font-medium">
              <i className="fa-solid fa-location-dot mr-1 text-[9px]"></i>
              {client.endereco}{client.bairro ? ` - ${client.bairro}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="max-w-md mx-auto px-4 -mt-7">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Comprado</p>
            <p className="text-base font-black text-blue-600 mt-0.5">{formatCurrency(totalComprado)}</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Pago</p>
            <p className="text-base font-black text-emerald-600 mt-0.5">{formatCurrency(totalPago)}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Devedor</p>
            <p className={`text-base font-black mt-0.5 ${saldoDevedor > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{formatCurrency(saldoDevedor)}</p>
          </div>
        </div>
      </div>

      {/* Pendente */}
      <div className="max-w-md mx-auto px-4 mt-4">
        {vendasPendentes.length > 0 && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl px-4 py-3 border border-amber-100 flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
              <i className="fa-solid fa-clock text-amber-500 text-sm"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-amber-700 uppercase">Pendente</p>
              <p className="text-sm font-black text-amber-800">{formatCurrency(saldoPendente)}</p>
            </div>
            <span className="text-[9px] font-bold text-amber-500 bg-amber-100 px-2 py-1 rounded-lg">{vendasPendentes.length}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="max-w-md mx-auto px-4 mt-4">
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-100">
          <button
            onClick={() => setTab('todas')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tab === 'todas' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400'}`}
          >
            Todas ({sales.length})
          </button>
          <button
            onClick={() => setTab('pendentes')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${tab === 'pendentes' ? 'bg-rose-500 text-white shadow-sm' : 'text-gray-400'}`}
          >
            Pendentes ({vendasPendentes.length})
          </button>
        </div>
      </div>

      {/* Cupons */}
      <div className="max-w-md mx-auto px-4 mt-4 pb-10 space-y-3">
        {listSales.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
            <i className="fa-solid fa-receipt text-gray-200 text-4xl mb-3 block"></i>
            <p className="text-xs text-gray-400 font-semibold">Nenhuma compra encontrada</p>
          </div>
        ) : (
          listSales.map((sale) => {
            const isPending = sale.status_pagamento === 'PENDENTE';
            const restante = Number(sale.valor_total || 0) - Number(sale.valor_pago || 0);
            const items = sale.sale_items || [];

            return (
              <div key={sale.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Topo */}
                <div className={`px-4 py-3 flex items-center justify-between ${isPending ? 'bg-rose-50' : 'bg-emerald-50'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isPending ? 'bg-rose-400' : 'bg-emerald-400'}`}></div>
                    <span className={`text-[10px] font-black uppercase ${isPending ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {isPending ? 'Nao pago' : 'Pago'}
                    </span>
                    <span className="text-gray-300">|</span>
                    <span className="text-[10px] font-semibold text-gray-500">{getPaymentLabel(sale.metodo_pagamento)}</span>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400">{formatDate(sale.data_venda)}</span>
                </div>

                {/* Itens estilo cupom */}
                <div className="px-4 py-3">
                  <div className="border-l-2 border-dashed border-gray-200 pl-3 space-y-1.5">
                    {items.map((item, idx) => (
                      <div key={idx} className="flex items-baseline justify-between text-[11px]">
                        <span className="text-gray-700 font-medium capitalize">{products[item.produto_id] || 'Produto'}</span>
                        <span className="text-gray-400 font-bold tabular-nums ml-3 shrink-0">{item.quantidade} un</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Separador */}
                <div className="border-t border-dashed border-gray-200 mx-4"></div>

                {/* Total */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Total</span>
                    {isPending && restante > 0 && (
                      <p className="text-[9px] font-bold text-rose-400">Falta {formatCurrency(restante)}</p>
                    )}
                  </div>
                  <span className="text-lg font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                </div>

                {/* Vencimento */}
                {isPending && sale.data_vencimento && (
                  <div className="bg-amber-50 px-4 py-2 border-t border-amber-100">
                    <p className="text-[9px] font-bold text-amber-600 text-center uppercase">
                      <i className="fa-solid fa-calendar-day mr-1"></i>Vence em {formatDate(sale.data_vencimento)}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="text-center pb-6">
        <p className="text-[9px] text-gray-300 font-semibold tracking-widest uppercase">Doce Mania Distribuidora</p>
      </div>
    </div>
  );
}