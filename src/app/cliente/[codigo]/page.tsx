"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eyjhqjrczzpfthsddlpg.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5amhxanJjenpwZnRoc2RkbHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MjczNTYsImV4cCI6MjA4NTAwMzM1Nn0.seIcDpp3VMz44Zuziahln1NTI4Hrqv879Hzzp-pUrl0';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Gera um código curto a partir do UUID do cliente
// Ex: ce81c87b-b0bb-44f1-bb4a-3a32808ec09e -> FRUT4A7K
function generateCode(clientId: string, nome: string): string {
  // Pega as primeiras 4 letras do nome (sem espaços) em maiúsculo
  const prefix = (nome || 'XXXX').replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
  // Pega partes do UUID e converte para base36 curto
  const clean = clientId.replace(/-/g, '');
  const hex1 = parseInt(clean.substring(0, 8), 16).toString(36).toUpperCase().substring(0, 2);
  const hex2 = parseInt(clean.substring(8, 16), 16).toString(36).toUpperCase().substring(0, 2);
  return (prefix + hex1 + hex2).padEnd(8, 'X');
}

// Verifica se um código corresponde a um cliente (busca todos e compara)
async function findClientByCode(code: string): Promise<{ id: string; nome_fantasia: string; endereco: string; bairro: string } | null> {
  const { data: allClients } = await supabase
    .from('clients')
    .select('id, nome_fantasia, endereco, bairro');

  if (!allClients) return null;

  for (const c of allClients) {
    if (generateCode(c.id, c.nome_fantasia) === code.toUpperCase()) {
      return c;
    }
  }
  return null;
}

interface SaleData {
  id: string;
  valor_total: number;
  valor_pago: number;
  metodo_pagamento: string;
  status_pagamento: string;
  data_venda: string;
  data_vencimento: string | null;
  sale_items: { produto_id: string; quantidade: number; preco_venda: number }[];
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
  const [client, setClient] = useState<{ id: string; nome_fantasia: string; endereco: string; bairro: string } | null>(null);
  const [sales, setSales] = useState<SaleData[]>([]);
  const [products, setProducts] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState<'compras' | 'pendentes'>('compras');

  useEffect(() => {
    if (!codigo) return;
    loadData();
  }, [codigo]);

  async function loadData() {
    setLoading(true);
    setError('');

    try {
      // 1. Encontra o cliente pelo código gerado
      const clientData = await findClientByCode(codigo);

      if (!clientData) {
        setError('Link inválido ou cliente não encontrado.');
        setLoading(false);
        return;
      }

      setClient(clientData);

      // 2. Busca produtos para mapear nomes
      const { data: prodData } = await supabase
        .from('products')
        .select('id, nome');

      if (prodData) {
        const pNameMap = new Map<string, string>();
        prodData.forEach((p: { id: string; nome: string }) => {
          pNameMap.set(p.id, p.nome);
        });
        setProducts(pNameMap);
      }

      // 3. Busca vendas do cliente (últimas 30)
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, data_vencimento, sale_items(*)')
        .eq('client_id', clientData.id)
        .order('data_venda', { ascending: false })
        .limit(30);

      if (salesData) setSales(salesData as SaleData[]);
    } catch {
      setError('Erro ao carregar dados.');
    }

    setLoading(false);
  }

  // Métricas calculadas
  const totalComprado = sales.reduce((acc, s) => acc + Number(s.valor_total || 0), 0);
  const totalPago = sales.reduce((acc, s) => acc + Number(s.valor_pago || 0), 0);
  const saldoDevedor = totalComprado - totalPago;
  const vendasPendentes = sales.filter(s => s.status_pagamento === 'PENDENTE');
  const saldoPendente = vendasPendentes.reduce((acc, s) => acc + (Number(s.valor_total || 0) - Number(s.valor_pago || 0)), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-gray-400 font-semibold">Carregando...</p>
        </div>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center bg-white rounded-2xl p-8 shadow-sm border border-gray-100 max-w-sm">
          <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fa-solid fa-link-slash text-rose-400 text-xl"></i>
          </div>
          <p className="text-sm font-bold text-gray-700">Link inválido</p>
          <p className="text-xs text-gray-400 mt-1">Este link não está associado a nenhum cliente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white px-5 pt-12 pb-8 rounded-b-[2rem]">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-store text-sm"></i>
            </div>
            <div>
              <h1 className="text-lg font-black uppercase tracking-tight">{client.nome_fantasia}</h1>
              <p className="text-[10px] font-semibold text-blue-200">Seu extrato de compras</p>
            </div>
          </div>
          {client.endereco && (
            <p className="text-[10px] text-blue-200 mt-2 ml-[52px]">
              <i className="fa-solid fa-location-dot mr-1"></i>
              {client.endereco}{client.bairro ? `, ${client.bairro}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-5 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-[9px] font-black uppercase text-gray-400">Total Comprado</p>
            <p className="text-sm font-black text-blue-600 mt-1">{formatCurrency(totalComprado)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-[9px] font-black uppercase text-gray-400">Total Pago</p>
            <p className="text-sm font-black text-emerald-600 mt-1">{formatCurrency(totalPago)}</p>
          </div>
          <div className={`rounded-2xl p-4 shadow-sm border text-center ${saldoDevedor > 0 ? 'bg-rose-50 border-rose-100' : 'bg-white border-gray-100'}`}>
            <p className="text-[9px] font-black uppercase text-gray-400">Saldo Devedor</p>
            <p className={`text-sm font-black mt-1 ${saldoDevedor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatCurrency(saldoDevedor)}
            </p>
          </div>
        </div>

        {/* Pendentes Card */}
        {vendasPendentes.length > 0 && (
          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase text-amber-600">Pendentes</p>
                <p className="text-lg font-black text-amber-700">{formatCurrency(saldoPendente)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-amber-500">{vendasPendentes.length} venda(s)</p>
                {vendasPendentes[0]?.data_vencimento && (
                  <p className="text-[9px] font-bold text-amber-500 mt-0.5">
                    Vence: {formatDate(vendasPendentes[0].data_vencimento)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setTab('compras')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${
              tab === 'compras' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'
            }`}
          >
            Todas Compras ({sales.length})
          </button>
          <button
            onClick={() => setTab('pendentes')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${
              tab === 'pendentes' ? 'bg-white text-rose-600 shadow-sm' : 'text-gray-400'
            }`}
          >
            Pendentes ({vendasPendentes.length})
          </button>
        </div>

        {/* Sale List */}
        <div className="space-y-2">
          {(tab === 'compras' ? sales : vendasPendentes).length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
              <i className="fa-solid fa-receipt text-gray-200 text-3xl mb-3"></i>
              <p className="text-xs text-gray-400 font-semibold">
                {tab === 'pendentes' ? 'Nenhuma compra pendente' : 'Nenhuma compra encontrada'}
              </p>
            </div>
          ) : (
            (tab === 'compras' ? sales : vendasPendentes).map((sale) => {
              const isPending = sale.status_pagamento === 'PENDENTE';
              const restante = Number(sale.valor_total || 0) - Number(sale.valor_pago || 0);
              return (
                <div key={sale.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${
                        isPending ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        {isPending ? 'Pendente' : 'Pago'}
                      </span>
                      <span className="text-[10px] text-gray-400 font-semibold">{formatDate(sale.data_venda)}</span>
                    </div>
                    <span className="text-sm font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                  </div>

                  {/* Items */}
                  <div className="bg-gray-50 rounded-xl p-3 mb-3">
                    {(sale.sale_items || []).map((item, idx) => {
                      const prodName = products.get(item.produto_id) || 'Produto';
                      return (
                        <div key={idx} className="flex justify-between items-center py-1">
                          <span className="text-[10px] text-gray-600 font-medium truncate flex-1">{prodName}</span>
                          <span className="text-[10px] text-gray-500 font-bold ml-2 whitespace-nowrap">
                            {item.quantidade}x {formatCurrency(Number(item.preco_venda))}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-gray-400 font-semibold">
                      <i className="fa-solid fa-credit-card mr-1"></i>{getPaymentLabel(sale.metodo_pagamento)}
                    </span>
                    {isPending && restante > 0 && (
                      <span className="text-rose-500 font-black">Falta: {formatCurrency(restante)}</span>
                    )}
                    {sale.data_vencimento && isPending && (
                      <span className="text-amber-500 font-bold">Vence: {formatDate(sale.data_vencimento)}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center mt-8 px-4">
        <p className="text-[9px] text-gray-300 font-semibold">DOCE MANIA DISTRIBUIDORA</p>
      </div>
    </div>
  );
}
