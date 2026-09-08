"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * ADMIN — visao das rotas de entrega de hoje (pre-venda).
 * Somente leitura: progresso por rota + paradas com status em tempo quasi-real.
 */

interface Parada {
  saleId: string; seq: number | null; entregaStatus: string;
  valorTotal: number; valorPago: number; statusPagamento: string; motivo: string | null;
  formaPgto?: string; temFoto?: boolean;
  cliente: { id: string; nome: string; endereco: string; bairro: string; telefone: string; lat: number | null; lng: number | null };
  itens: { nome: string; quantidade: number; precoVenda?: number }[];
  eventos: { status: string; motivo: string | null; criado_em: string }[];
}
interface RotaBloco {
  rota: { id: string; data: string; status: string; totalParadas: number; criadaEm: string; iniciadaEm: string | null; concluidaEm: string | null; vendedorId: string; vendedorNome: string };
  paradas: Parada[];
}
interface ApiResp { hoje: string; rotas: RotaBloco[]; pendentes?: { count: number; valor: number }; migracaoPendente?: boolean; error?: string; }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const ST: Record<string, { chip: string; label: string }> = {
  PENDENTE: { chip: 'bg-amber-100 text-amber-700', label: 'Na fila' },
  EM_ROTA: { chip: 'bg-blue-100 text-blue-700', label: 'Em rota' },
  ENTREGUE: { chip: 'bg-emerald-100 text-emerald-700', label: 'Entregue' },
  FALHOU: { chip: 'bg-rose-100 text-rose-700', label: 'Falhou' },
};

const PGTO: Record<string, { label: string; icon: string; chip: string }> = {
  DINHEIRO: { label: 'Dinheiro', icon: 'fa-solid fa-money-bill-wave', chip: 'bg-emerald-50 text-emerald-700' },
  PIX: { label: 'Pix', icon: 'fa-brands fa-pix', chip: 'bg-teal-50 text-teal-700' },
  BOLETO: { label: 'Boleto', icon: 'fa-solid fa-barcode', chip: 'bg-amber-50 text-amber-700' },
};

const AdminEntregas: React.FC = () => {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch('/api/pre-venda?all=1', { headers: authHeaders() });
      const d: ApiResp = await res.json();
      if (mounted.current && res.ok) setData(d);
    } catch { /* silencioso */ }
    finally { if (mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // defer: evita setState sincrono dentro do effect (lint)
    const t0 = setTimeout(() => load(), 0);
    const t = setInterval(() => load(true), 60_000);
    return () => { mounted.current = false; clearTimeout(t0); clearInterval(t); };
  }, [load]);

  if (loading && !data) {
    return <div className="py-14 flex justify-center"><div className="w-9 h-9 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" /></div>;
  }
  if (!data) return null;

  const totalEntregues = (data.rotas || []).reduce((a, r) => a + r.paradas.filter(p => p.entregaStatus === 'ENTREGUE').length, 0);
  const totalParadas = (data.rotas || []).reduce((a, r) => a + r.paradas.length, 0);
  const valorTotal = (data.rotas || []).reduce((a, r) => a + r.paradas.reduce((x, p) => x + p.valorTotal, 0), 0);

  return (
    <div className="space-y-4">
      <header className="px-1 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-800 tracking-tight leading-none">Entregas de Hoje</h2>
          <p className="text-[10px] font-black uppercase text-gray-400 mt-1">Rotas de pre-venda geradas pelos vendedores</p>
        </div>
        <button onClick={() => load()} className="w-9 h-9 rounded-xl bg-white border border-gray-100 text-gray-400 flex items-center justify-center active:scale-90 shadow-sm">
          <i className={`fa-solid fa-rotate text-xs ${loading ? 'animate-spin' : ''}`}></i>
        </button>
      </header>

      {data.migracaoPendente && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <i className="fa-solid fa-database text-amber-500"></i>
          <p className="text-[10px] font-black text-amber-700 uppercase leading-snug">
            Migracao pendente: rode o Bloco 5 (SQL da pre-venda) no Supabase para ativar as entregas.
          </p>
        </div>
      )}

      {/* Resumo geral */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[8px] font-black uppercase text-gray-400">Rotas</p>
          <p className="text-lg font-black text-gray-800">{(data.rotas || []).length}</p>
        </div>
        <div className="border-x border-gray-100">
          <p className="text-[8px] font-black uppercase text-gray-400">Entregues</p>
          <p className="text-lg font-black text-emerald-600">{totalEntregues}/{totalParadas}</p>
        </div>
        <div>
          <p className="text-[8px] font-black uppercase text-gray-400">Valor</p>
          <p className="text-lg font-black text-blue-600">{fmt(valorTotal)}</p>
        </div>
      </div>

      {data.pendentes && data.pendentes.count > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
          <p className="text-[10px] font-black text-amber-700 uppercase">
            <i className="fa-solid fa-hourglass-half mr-1"></i>{data.pendentes.count} pedido(s) de pre-venda ainda nao incluidos em rota — {fmt(data.pendentes.valor)}
          </p>
        </div>
      )}

      {/* Rotas */}
      {(data.rotas || []).length === 0 && (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
          <i className="fa-solid fa-route text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs text-gray-400 font-semibold">Nenhuma rota gerada hoje.</p>
        </div>
      )}

      {(data.rotas || []).map(bloco => {
        const r = bloco.rota;
        const entregues = bloco.paradas.filter(p => p.entregaStatus === 'ENTREGUE').length;
        const falhadas = bloco.paradas.filter(p => p.entregaStatus === 'FALHOU').length;
        const prog = bloco.paradas.length > 0 ? Math.round((entregues / bloco.paradas.length) * 100) : 0;
        const expandida = aberta === r.id;
        return (
          <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button onClick={() => setAberta(expandida ? null : r.id)} className="w-full p-4 text-left">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-black text-gray-800 truncate">{r.vendedorNome || 'Vendedor'}</p>
                  <p className="text-[9px] text-gray-400 font-semibold mt-0.5">
                    {r.status === 'CONCLUIDA' ? 'Concluida' : r.status === 'EM_ROTA' ? `Em rota desde ${r.iniciadaEm ? hora(r.iniciadaEm) : '--'}` : 'Rota gerada (aguardando inicio)'}
                    {' · '}{bloco.paradas.length} paradas
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[11px] font-black text-emerald-600">{entregues}/{bloco.paradas.length}</p>
                  {falhadas > 0 && <p className="text-[9px] font-black text-rose-500">{falhadas} falha(s)</p>}
                </div>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all" style={{ width: `${prog}%` }}></div>
              </div>
            </button>

            {expandida && (
              <div className="border-t border-gray-100">
                {[...bloco.paradas].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map(p => {
                  const st = ST[p.entregaStatus] || ST.PENDENTE;
                  const pg = PGTO[p.formaPgto || 'DINHEIRO'] || PGTO.DINHEIRO;
                  return (
                    <div key={p.saleId} className="px-4 py-3 border-b border-gray-50 last:border-b-0 flex items-start gap-3">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black ${p.entregaStatus === 'ENTREGUE' ? 'bg-emerald-500 text-white' : p.entregaStatus === 'FALHOU' ? 'bg-rose-500 text-white' : 'bg-gray-800 text-white'}`}>
                        {p.seq ?? '·'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-black text-gray-700 truncate capitalize">{p.cliente.nome}</p>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md shrink-0 ${st.chip}`}>{st.label}</span>
                        </div>
                        <p className="text-[9px] text-gray-400 font-semibold truncate">{p.cliente.endereco || 'Sem endereco'}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}</p>
                        <p className="text-[9px] text-gray-500 font-bold truncate">{p.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ')}</p>
                        {p.motivo && p.entregaStatus === 'FALHOU' && <p className="text-[9px] text-rose-500 font-bold mt-0.5">Motivo: {p.motivo}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] font-black text-gray-800">{fmt(p.valorTotal)}</p>
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md inline-block mt-0.5 ${pg.chip}`}>
                          <i className={`${pg.icon} mr-0.5`}></i>{pg.label}
                        </span>
                        {p.entregaStatus === 'ENTREGUE' && <p className="text-[8px] font-bold text-gray-400">{p.statusPagamento === 'PAGO' ? 'pago' : 'a receber'}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AdminEntregas;
