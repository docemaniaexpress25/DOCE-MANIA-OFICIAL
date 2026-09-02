"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eyjhqjrczzpfthsddlpg.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5amhxanJjenpwZnRoc2RkbHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MjczNTYsImV4cCI6MjA4NTAwMzM1Nn0.seIcDpp3VMz44Zuziahln1NTI4Hrqv879Hzzp-pUrl0';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

function generateCode(clientId: string, nome: string): string {
  const prefix = (nome || 'XXXX').replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
  const clean = clientId.replace(/-/g, '');
  const hex1 = parseInt(clean.substring(0, 8), 16).toString(36).toUpperCase().substring(0, 2);
  const hex2 = parseInt(clean.substring(8, 16), 16).toString(36).toUpperCase().substring(0, 2);
  return (prefix + hex1 + hex2).padEnd(8, 'X');
}

async function findClientByCode(code: string) {
  const { data: allClients } = await supabase
    .from('clients')
    .select('id, nome_fantasia, endereco, bairro');
  if (!allClients) return null;
  for (const c of allClients) {
    if (generateCode(c.id, c.nome_fantasia) === code.toUpperCase()) return c;
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
  const [tab, setTab] = useState<'todas' | 'pendentes'>('todas');

  useEffect(() => {
    if (!codigo) return;
    loadData();
  }, [codigo]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const clientData = await findClientByCode(codigo);
      if (!clientData) { setError('Link invalido ou cliente nao encontrado.'); setLoading(false); return; }
      setClient(clientData);

      const { data: prodData } = await supabase.from('products').select('id, nome');
      if (prodData) {
        const m = new Map<string, string>();
        prodData.forEach((p: { id: string; nome: string }) => m.set(p.id, p.nome));
        setProducts(m);
      }

      const { data: salesData } = await supabase
        .from('sales')
        .select('id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, data_vencimento, sale_items(*)')
        .eq('client_id', clientData.id)
        .order('data_venda', { ascending: false })
        .limit(50);
      if (salesData) setSales(salesData as SaleData[]);
    } catch {
      setError('Erro ao carregar dados.');
    }
    setLoading(false);
  }

  const totalComprado = sales.reduce((a, s) => a + Number(s.valor_total || 0), 0);
  const totalPago = sales.reduce((a, s) => a + Number(s.valor_pago || 0), 0);
  const saldoDevedor = totalComprado - totalPago;
  const vendasPendentes = sales.filter(s => s.status_pagamento === 'PENDENTE');
  const saldoPendente = vendasPendentes.reduce((a, s) => a + (Number(s.valor_total || 0) - Number(s.valor_pago || 0)), 0);

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
          <p className="text-sm font-bold text-gray-700">Link invalido</p>
          <p className="text-xs text-gray-400 mt-1">Este link nao esta associado a nenhum cliente.</p>
        </div>
      </div>
    );
  }

  const listSales = tab === 'pendentes' ? vendasPendentes : sales;

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
              <p className="text-[10px] font-semibold text-blue-200">Extrato de compras</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-5 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-[9px] font-black uppercase text-gray-400">Comprado</p>
            <p className="text-sm font-black text-blue-600 mt-1">{formatCurrency(totalComprado)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-center">
            <p className="text-[9px] font-black uppercase text-gray-400">Pago</p>
            <p className="text-sm font-black text-emerald-600 mt-1">{formatCurrency(totalPago)}</p>
          </div>
          <div className={`rounded-2xl p-4 shadow-sm border text-center ${saldoDevedor > 0 ? 'bg-rose-50 border-rose-100' : 'bg-white border-gray-100'}`}>
            <p className="text-[9px] font-black uppercase text-gray-400">Devedor</p>
            <p className={`text-sm font-black mt-1 ${saldoDevedor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(saldoDevedor)}</p>
          </div>
        </div>

        {/* Pendentes */}
        {vendasPendentes.length > 0 && (
          <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase text-amber-600">Pendente</p>
                <p className="text-lg font-black text-amber-700">{formatCurrency(saldoPendente)}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-amber-500">{vendasPendentes.length} venda(s)</p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setTab('todas')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${tab === 'todas' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}
          >
            Todas ({sales.length})
          </button>
          <button
            onClick={() => setTab('pendentes')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${tab === 'pendentes' ? 'bg-white text-rose-600 shadow-sm' : 'text-gray-400'}`}
          >
            Pendentes ({vendasPendentes.length})
          </button>
        </div>

        {/* Lista de vendas simplificada */}
        <div className="space-y-2">
          {listSales.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
              <i className="fa-solid fa-receipt text-gray-200 text-3xl mb-3 block"></i>
              <p className="text-xs text-gray-400 font-semibold">Nenhuma compra encontrada</p>
            </div>
          ) : (
            listSales.map((sale) => {
              const isPending = sale.status_pagamento === 'PENDENTE';
              const restante = Number(sale.valor_total || 0) - Number(sale.valor_pago || 0);
              const itemsList = (sale.sale_items || []).map((item) => {
                const nome = products.get(item.produto_id) || 'Produto';
                return `${nome} (${item.quantidade}x)`;
              });

              return (
                <div key={sale.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  {/* Linha 1: data + status + valor */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${
                        isPending ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        {isPending ? 'Nao pago' : 'Pago'}
                      </span>
                      <span className="text-[10px] text-gray-400 font-semibold">{formatDate(sale.data_venda)}</span>
                    </div>
                    <span className="text-sm font-black text-gray-800">{formatCurrency(Number(sale.valor_total))}</span>
                  </div>

                  {/* Linha 2: forma pagamento + vencimento */}
                  <div className="flex items-center justify-between text-[9px] mb-2">
                    <span className="text-gray-400 font-semibold">
                      <i className="fa-solid fa-credit-card mr-1"></i>{getPaymentLabel(sale.metodo_pagamento)}
                    </span>
                    {isPending && restante > 0 && (
                      <span className="text-rose-500 font-black">Falta: {formatCurrency(restante)}</span>
                    )}
                    {isPending && sale.data_vencimento && (
                      <span className="text-amber-500 font-bold">Vence: {formatDate(sale.data_vencimento)}</span>
                    )}
                  </div>

                  {/* Linha 3: itens apenas nome e qtd */}
                  <div className="bg-gray-50 rounded-xl px-3 py-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase mb-1">Itens</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {itemsList.map((item, idx) => (
                        <span key={idx} className="text-[10px] text-gray-600 font-medium">{item}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="text-center mt-8 px-4">
        <p className="text-[9px] text-gray-300 font-semibold">DOCE MANIA DISTRIBUIDORA</p>
      </div>
    </div>
  );
}
