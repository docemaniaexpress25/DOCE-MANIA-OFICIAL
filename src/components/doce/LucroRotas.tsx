"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 79 — LUCRO POR ROTA (visao do admin)
 *
 * A conta do dono, ao vivo: Faturamento - Custo dos produtos vendidos = Lucro Bruto,
 * rota por rota, conforme as vendas acontecem (recalculado no servidor a cada
 * abertura/atualizacao — nao e numero congelado). Comissao e despesas o dono
 * desconta por fora — aqui e o BRUTO, com a conta aberta por vendedor.
 * Fonte: /api/admin/lucro-rotas (service role, mes no fuso de Sao Paulo).
 */

interface VendedorLucro { id: string; nome: string; role: string; nVendas: number; faturamento: number; custo: number; lucro: number; }
interface FatiaPagamento { n: number; faturamento: number; custo: number; lucro: number; }
interface RotaLucro {
  rota: string; rotulo: string; nVendas: number; faturamento: number; custo: number;
  lucro: number; margem: number; pago: FatiaPagamento; pendente: FatiaPagamento; vendedores: VendedorLucro[];
}
interface LucroData {
  ok: boolean; mes: string; geradoEm: string;
  rotas: RotaLucro[];
  totais: { nVendas: number; faturamento: number; custo: number; lucro: number; margem: number };
  avisos: { produtosSemCusto: number; detalhe: string; custoCongelado?: boolean };
}

const brl = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function mesCorrenteLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function rotuloMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
function shiftMes(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function LucroRotas() {
  const [mes, setMes] = useState<string>(mesCorrenteLocal());
  const [data, setData] = useState<LucroData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rotaAberta, setRotaAberta] = useState<string | null>(null);

  const carregar = useCallback(async (m: string) => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/lucro-rotas?mes=${m}`, { headers: authHeaders(), cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Erro ${res.status}`);
      setData(json);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao calcular. Tente novamente.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(mes); }, [mes, carregar]);
  // Ao vivo: refaz a conta a cada 60s enquanto a tela esta aberta
  useEffect(() => {
    const t = setInterval(() => { if (!loading) carregar(mes); }, 60_000);
    return () => clearInterval(t);
  }, [mes, loading, carregar]);

  const mesAtual = mesCorrenteLocal();
  const rotas = data?.rotas || [];
  const T = data?.totais;

  return (
    <div className="space-y-4 py-4">
      {/* Cabecalho */}
      <div className="px-2 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-gray-800 tracking-tight">Lucro por Rota</h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Bruto: vendas − custo dos produtos</p>
        </div>
        <button onClick={() => carregar(mes)} aria-label="Atualizar números" className="w-10 h-10 bg-white text-emerald-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90 flex-shrink-0">
          <i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i>
        </button>
      </div>

      {/* Navegacao de mes */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-2 flex items-center justify-between gap-2">
        <button onClick={() => setMes(shiftMes(mes, -1))} aria-label="Mês anterior" className="w-11 h-11 rounded-xl bg-gray-50 text-gray-600 flex items-center justify-center active:scale-90 border border-gray-100 flex-shrink-0"><i className="fa-solid fa-chevron-left"></i></button>
        <div className="text-center min-w-0">
          <div className="text-sm font-black text-gray-800 uppercase tracking-tight truncate">{rotuloMes(mes)}</div>
          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{mes === mesAtual ? 'Mês corrente — ao vivo' : 'Mês fechado'}</div>
        </div>
        <button onClick={() => setMes(shiftMes(mes, 1))} disabled={mes >= mesAtual} aria-label="Próximo mês" className="w-11 h-11 rounded-xl bg-gray-50 text-gray-600 flex items-center justify-center active:scale-90 border border-gray-100 flex-shrink-0 disabled:opacity-30 disabled:active:scale-100"><i className="fa-solid fa-chevron-right"></i></button>
      </div>
      {mes !== mesAtual && (
        <button onClick={() => setMes(mesAtual)} className="w-full py-2 rounded-xl bg-amber-50 text-amber-700 text-[11px] font-black uppercase tracking-wide border border-amber-100 active:scale-95">Voltar para o mês corrente</button>
      )}

      {/* Carregando / erro */}
      {loading && !data && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 flex flex-col items-center gap-3">
          <i className="fa-solid fa-spinner fa-spin text-2xl text-emerald-500"></i>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Fechando a conta...</span>
        </div>
      )}
      {erro && (
        <div className="bg-white rounded-3xl border border-rose-100 shadow-sm p-6 text-center space-y-3">
          <i className="fa-solid fa-circle-exclamation text-2xl text-rose-500"></i>
          <p className="text-xs font-semibold text-gray-600">{erro}</p>
          <button onClick={() => carregar(mes)} className="px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black uppercase active:scale-95">Tentar novamente</button>
        </div>
      )}

      {/* KPIs gerais */}
      {data && T && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
              <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Faturamento</p>
              <p className="text-lg font-black text-gray-800 tracking-tight mt-1">{brl(T.faturamento)}</p>
              <p className="text-[10px] font-bold text-gray-400 mt-0.5">{T.nVendas} vendas no mês</p>
            </div>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
              <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Custo dos produtos</p>
              <p className="text-lg font-black text-rose-500 tracking-tight mt-1">{brl(T.custo)}</p>
              <p className="text-[10px] font-bold text-gray-400 mt-0.5">preço médio × unidades vendidas</p>
            </div>
          </div>
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-3xl shadow-sm p-5 text-white">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-black uppercase text-emerald-100 tracking-wider">Lucro bruto do mês</p>
                <p className="text-2xl font-black tracking-tight mt-1">{brl(T.lucro)}</p>
                <p className="text-[10px] font-bold text-emerald-100 mt-1">Margem média: {String(T.margem).replace('.', ',')}%</p>
              </div>
              <i className="fa-solid fa-sack-dollar text-4xl text-emerald-400/60"></i>
            </div>
          </div>
          {(T.nVendas === 0) && (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-4 text-center">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Nenhuma venda neste mês ainda</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 px-1">
            <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full" title="Vendas com pagamento já recebido"><i className="fa-solid fa-circle-check mr-1 text-[8px]"></i>Recebido: {brl(rotas.reduce((s, r) => s + r.pago.faturamento, 0))}</span>
            <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full" title="Vendas a prazo / pagamento pendente"><i className="fa-solid fa-clock mr-1 text-[8px]"></i>A receber: {brl(rotas.reduce((s, r) => s + r.pendente.faturamento, 0))}</span>
          </div>
        </div>
      )}

      {/* Cartoes por rota */}
      {data && (
        <div className="space-y-3">
          {rotas.map((r) => {
            const aberta = rotaAberta === r.rota;
            return (
              <div key={r.rota} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                <button onClick={() => setRotaAberta(aberta ? null : r.rota)} aria-expanded={aberta} className="w-full p-4 flex items-center justify-between gap-3 text-left active:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-gray-800 uppercase tracking-tight truncate">{r.rotulo}</p>
                    <p className="text-[10px] font-bold text-gray-400 mt-0.5">{r.nVendas} vendas · margem {String(r.margem).replace('.', ',')}%</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Lucro bruto</p>
                    <p className="text-base font-black text-emerald-600 tracking-tight">{brl(r.lucro)}</p>
                  </div>
                  <i className={`fa-solid fa-chevron-down text-gray-300 text-xs transition-transform flex-shrink-0 ${aberta ? 'rotate-180' : ''}`}></i>
                </button>
                {aberta && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-50 rounded-2xl p-3">
                        <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Faturamento</p>
                        <p className="text-sm font-black text-gray-800 mt-0.5">{brl(r.faturamento)}</p>
                      </div>
                      <div className="bg-rose-50 rounded-2xl p-3">
                        <p className="text-[9px] font-black uppercase text-rose-400 tracking-wider">Custo produtos</p>
                        <p className="text-sm font-black text-rose-600 mt-0.5">{brl(r.custo)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-emerald-700"><i className="fa-solid fa-circle-check mr-1.5 text-[8px]"></i>Recebido ({r.pago.n})</span>
                        <span className="text-gray-700">{brl(r.pago.faturamento)} <span className="text-emerald-600">· lucro {brl(r.pago.lucro)}</span></span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span className="text-amber-700"><i className="fa-solid fa-clock mr-1.5 text-[8px]"></i>A receber ({r.pendente.n})</span>
                        <span className="text-gray-700">{brl(r.pendente.faturamento)} <span className="text-amber-600">· lucro {brl(r.pendente.lucro)}</span></span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-1.5">Por vendedor</p>
                      <div className="space-y-1.5">
                        {r.vendedores.map((v) => (
                          <div key={v.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-gray-700 truncate">
                                {v.nome}
                                {v.role === 'ADMIN' && <span className="ml-1.5 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-100 px-1 py-0.5 rounded align-middle">ADMIN</span>}
                              </p>
                              <p className="text-[9px] font-bold text-gray-400">{v.nVendas} vendas · custo {brl(v.custo)}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-[10px] font-bold text-gray-500">{brl(v.faturamento)}</p>
                              <p className={`text-[11px] font-black ${v.lucro > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{v.lucro > 0 ? `+${brl(v.lucro)}` : brl(0)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Nota de metodo */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-amber-700 tracking-wider mb-1"><i className="fa-solid fa-circle-info mr-1"></i>Como essa conta é feita</p>
            <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">{data.avisos?.detalhe}</p>
            {data.avisos?.custoCongelado && (
              <p className="text-[10px] font-black text-emerald-700 mt-2"><i className="fa-solid fa-lock mr-1"></i>Custo de cada venda congelado no momento da venda — mês fechado não muda mais.</p>
            )}
            {data.avisos?.produtosSemCusto > 0 && (
              <p className="text-[10px] font-black text-rose-600 mt-2"><i className="fa-solid fa-triangle-exclamation mr-1"></i>{data.avisos.produtosSemCusto} produto(s) vendido(s) sem custo cadastrado — lucro desses itens aparece cheio (cadastre o custo para corrigir).</p>
            )}
          </div>
          <p className="text-center text-[9px] font-bold text-gray-300 uppercase tracking-wider pb-2">Conta recalculada {data.geradoEm ? new Date(data.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''} · atualiza sozinha a cada minuto</p>
        </div>
      )}
    </div>
  );
}
