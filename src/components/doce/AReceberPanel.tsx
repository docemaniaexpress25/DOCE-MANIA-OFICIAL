"use client";
import React, { useMemo } from 'react';

/**
 * CONTAS A RECEBER — versão refeita, agrupada POR CLIENTE (mais intuitivo que por venda).
 * NÃO faz fetch: o pai já tem sales/clients e passa por props (linhas crudas snake_case
 * do Supabase; camelCase do Sale também é aceito como fallback defensivo).
 *
 * Regra (lib/contaAReceber.ts): A RECEBER = saldo > 0.01 && (entrega_status === 'ENTREGUE' || tipo_venda === 'PRONTA').
 */

interface Props {
  sales: any[];
  clients: any[];
  onRegistrarPagamento?: (sale: any) => void;
  onGerarBoleto?: (sale: any) => void;
  onAbrirCupom?: (sale: any) => void;
}

const EPS = 0.01;

const fmt = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const METODO_COR: Record<string, string> = {
  PIX: 'bg-teal-50 text-teal-600 border-teal-100',
  DINHEIRO: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  CARTAO: 'bg-slate-50 text-slate-600 border-slate-200',
  DEBITO: 'bg-slate-50 text-slate-600 border-slate-200',
  CREDITO: 'bg-slate-50 text-slate-600 border-slate-200',
  A_PRAZO: 'bg-amber-50 text-amber-600 border-amber-100',
  BOLETO: 'bg-slate-50 text-slate-600 border-slate-200',
  CUPOM: 'bg-amber-50 text-amber-600 border-amber-100',
};

const NOTA_COR: Record<string, string> = {
  AUTORIZADA: 'text-emerald-500',
  EMITINDO: 'text-amber-500',
  REJEITADA: 'text-rose-500',
};

interface VendaAberta {
  raw: any;
  id: string;
  clienteId: string;
  valorTotal: number;
  saldo: number;
  metodo: string;
  nota: string;
  entrega: string;
  tipoVenda: string;
  dataVendaTs: number;
  venc: Date | null;
  diasAtraso: number;
  vencida: boolean;
}

interface GrupoCliente {
  clienteId: string;
  nome: string;
  vendas: VendaAberta[];
  totalAberto: number;
  menorVencTs: number | null;
}

// Funcao PURA de modulo: o React Compiler exige que o useMemo dependa so de
// valores estaveis — chamar nomeCliente() (funcao recriada a cada render)
// dentro do memo quebrava a memoizacao ("Compilation Skipped: Existing
// memoization could not be preserved"). Toda a logica vive aqui fora.
function computarResumoAReceber(sales: any[], clientesMap: Map<string, any>) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const nomeCliente = (id: string) => {
    const c = clientesMap.get(String(id));
    return String(c?.nome_fantasia || c?.nome || c?.nomeFantasia || '').trim() || 'Cliente';
  };

    const abertas: VendaAberta[] = (sales || []).map((s: any): VendaAberta => {
      const valorTotal = Number(s?.valor_total ?? s?.valorTotal ?? 0) || 0;
      const valorPago = Number(s?.valor_pago ?? s?.valorPago ?? 0) || 0;
      const entrega = s?.entrega_status ?? s?.entregaStatus;
      const tipoV = s?.tipo_venda ?? s?.tipoVenda;
      const vencRaw = s?.data_vencimento ?? s?.dataVencimento;
      const vencDt = vencRaw ? new Date(vencRaw) : null;
      const venc = vencDt && !isNaN(vencDt.getTime()) ? vencDt : null;
      let diasAtraso = 0;
      if (venc) {
        const v0 = new Date(venc);
        v0.setHours(0, 0, 0, 0);
        diasAtraso = Math.floor((hoje.getTime() - v0.getTime()) / 86400000);
      }
      const dvRaw = s?.data_venda ?? s?.data;
      const dv = dvRaw ? new Date(dvRaw) : null;
      return {
        raw: s,
        id: String(s?.id ?? ''),
        clienteId: String(s?.client_id ?? s?.clientId ?? ''),
        valorTotal,
        saldo: valorTotal - valorPago,
        metodo: String(s?.metodo_pagamento ?? s?.metodoPagamento ?? ''),
        nota: String(s?.nota_status ?? s?.notaStatus ?? ''),
        entrega: String(s?.entrega_status ?? s?.entregaStatus ?? ''),
        tipoVenda: String(s?.tipo_venda ?? s?.tipoVenda ?? ''),
        dataVendaTs: dv && !isNaN(dv.getTime()) ? dv.getTime() : 0,
        venc,
        diasAtraso,
        vencida: diasAtraso > 0,
      };
    }).filter(v => v.saldo > EPS && (v.entrega === 'ENTREGUE' || v.tipoVenda === 'PRONTA'));

    // agrupa POR CLIENTE
    const map = new Map<string, GrupoCliente>();
    abertas.forEach(v => {
      let g = map.get(v.clienteId);
      if (!g) {
        g = { clienteId: v.clienteId, nome: nomeCliente(v.clienteId), vendas: [], totalAberto: 0, menorVencTs: null };
        map.set(v.clienteId, g);
      }
      g.vendas.push(v);
      g.totalAberto += v.saldo;
      if (v.venc) {
        const ts = v.venc.getTime();
        if (g.menorVencTs === null || ts < g.menorVencTs) g.menorVencTs = ts;
      }
    });

    const arr = [...map.values()];
    arr.forEach(g => {
      // dentro do cliente: mais antiga primeiro (vencimento, senão data da venda)
      g.vendas.sort((a, b) => {
        const ta = a.venc ? a.venc.getTime() : a.dataVendaTs;
        const tb = b.venc ? b.venc.getTime() : b.dataVendaTs;
        return ta - tb;
      });
    });
    // clientes com vencida mais antiga primeiro: vencidas têm timestamp menor que hoje,
    // então ordenar pelo menor vencimento já põe os inadimplentes no topo. Sem vencimento = por último.
    arr.sort((a, b) => (a.menorVencTs ?? Infinity) - (b.menorVencTs ?? Infinity));

    const vencidas = abertas.filter(v => v.vencida);
    return {
      grupos: arr,
      total: abertas.reduce((acc, v) => acc + v.saldo, 0),
      qtdVendas: abertas.length,
      vencidasTotal: vencidas.reduce((acc, v) => acc + v.saldo, 0),
      vencidasQtd: vencidas.length,
      aVencerTotal: abertas.filter(v => !v.vencida).reduce((acc, v) => acc + v.saldo, 0),
      aVencerQtd: abertas.filter(v => !v.vencida).length,
    };
}

const AReceberPanel: React.FC<Props> = ({ sales, clients, onRegistrarPagamento, onGerarBoleto, onAbrirCupom }) => {
  const clientesMap = useMemo(() => {
    const m = new Map<string, any>();
    (clients || []).forEach((c: any) => { if (c?.id) m.set(String(c.id), c); });
    return m;
  }, [clients]);

  const nomeCliente = (id: string) => {
    const c = clientesMap.get(String(id));
    return String(c?.nome_fantasia || c?.nome || c?.nomeFantasia || '').trim() || 'Cliente';
  };

  const resumo = useMemo(() => computarResumoAReceber(sales, clientesMap), [sales, clientesMap]);
  const { grupos, total, qtdVendas, vencidasTotal, vencidasQtd, aVencerTotal, aVencerQtd } = resumo;

  const chipMetodo = (metodo: string) => {
    const label = (metodo || '—').replace(/_/g, ' ');
    const cor = METODO_COR[metodo] || 'bg-gray-50 text-gray-500 border-gray-200';
    return <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border whitespace-nowrap ${cor}`}>{label}</span>;
  };

  return (
    <div className="space-y-4 pb-10">
      {/* ===== TÍTULO ===== */}
      <div className="px-2">
        <h2 className="text-2xl font-black text-gray-800 tracking-tight">Contas a Receber</h2>
        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mt-0.5">Vendas entregues com saldo em aberto — agrupado por cliente</p>
      </div>

      {/* ===== HERO ===== */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-3xl p-5 text-white shadow-lg mx-2">
        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-100">
          <i className="fa-solid fa-sack-dollar"></i>Total a receber
        </div>
        <p className="text-3xl font-black tracking-tight mt-1">{fmt(total)}</p>
        <p className="text-[10px] font-bold text-emerald-100 mt-0.5">{qtdVendas} venda(s) em aberto</p>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {vencidasQtd > 0 && (
            <span className="bg-rose-500/20 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide flex items-center gap-1.5">
              <i className="fa-solid fa-circle-exclamation"></i>Vencidas: {fmt(vencidasTotal)} ({vencidasQtd})
            </span>
          )}
          <span className="bg-white/15 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide flex items-center gap-1.5">
            <i className="fa-solid fa-calendar-check"></i>A vencer: {fmt(aVencerTotal)} ({aVencerQtd})
          </span>
        </div>
      </div>

      {/* ===== LISTA AGRUPADA POR CLIENTE ===== */}
      {grupos.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 border border-gray-100 shadow-sm mx-2 text-center">
          <i className="fa-solid fa-circle-check text-emerald-500 text-4xl mb-3 block"></i>
          <p className="text-sm font-black text-gray-800">Nada em aberto — tudo recebido!</p>
          <p className="text-[10px] font-bold text-gray-400 mt-1 leading-snug">
            Vendas entregues (ou pronta entrega) com saldo pendente aparecem aqui, agrupadas por cliente.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(g => (
            <div key={g.clienteId} className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm mx-2 space-y-3">
              {/* cabeçalho do cliente */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-user text-[11px]"></i>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-gray-800 text-[13px] uppercase truncate">{g.nome}</h3>
                    <p className="text-[8px] font-black text-gray-400 uppercase">{g.vendas.length} venda(s) em aberto</p>
                  </div>
                </div>
                <p className="text-lg font-black text-gray-800 flex-shrink-0 tracking-tight">{fmt(g.totalAberto)}</p>
              </div>

              {/* vendas em aberto do cliente */}
              <div className="space-y-2">
                {g.vendas.map(v => {
                  const notaCor = NOTA_COR[v.nota] || 'text-gray-300';
                  const notaTitulo = v.nota
                    ? `Nota ${v.nota}${v.raw?.nota_numero ? ` nº ${v.raw.nota_numero}` : ''}`
                    : 'Nota não emitida';
                  const vencOk = !!v.venc;
                  return (
                    <div key={v.id} className="bg-gray-50/60 border border-gray-100 rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black text-gray-500 uppercase flex items-center gap-1 min-w-0">
                          <i className="fa-solid fa-calendar text-gray-300"></i>
                          {v.dataVendaTs ? fmtData(new Date(v.dataVendaTs)) : '—'}
                        </span>
                        {chipMetodo(v.metodo)}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-gray-700 tracking-tight">{fmt(v.valorTotal)}</p>
                          <p className="text-[8px] font-black text-gray-400 uppercase">Saldo: <span className="text-rose-500">{fmt(v.saldo)}</span></p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {/* nota fiscal */}
                          <span className={`w-8 h-8 rounded-xl bg-white border border-gray-100 flex items-center justify-center ${notaCor}`} title={notaTitulo}>
                            <i className="fa-solid fa-file-invoice text-[11px]"></i>
                          </span>
                          {/* cupom */}
                          {onAbrirCupom && (
                            <button
                              onClick={() => onAbrirCupom(v.raw)}
                              title="Ver cupom"
                              className="w-8 h-8 rounded-xl bg-white border border-gray-100 text-gray-400 flex items-center justify-center active:scale-90 transition-transform"
                            >
                              <i className="fa-solid fa-receipt text-[11px]"></i>
                            </button>
                          )}
                          {/* boleto */}
                          {onGerarBoleto && (
                            <button
                              onClick={() => onGerarBoleto(v.raw)}
                              className="bg-slate-100 text-slate-600 border border-slate-200 h-8 px-3 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform flex items-center gap-1"
                            >
                              <i className="fa-solid fa-file-invoice-dollar text-[9px]"></i>Boleto
                            </button>
                          )}
                          {/* receber */}
                          {onRegistrarPagamento && (
                            <button
                              onClick={() => onRegistrarPagamento(v.raw)}
                              className="bg-emerald-600 text-white h-8 px-3 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform shadow-sm flex items-center gap-1"
                            >
                              <i className="fa-solid fa-hand-holding-dollar text-[9px]"></i>Receber
                            </button>
                          )}
                        </div>
                      </div>

                      {/* vencimento / atraso */}
                      {vencOk && (
                        <p className={`text-[8px] font-black uppercase flex items-center gap-1 ${v.vencida ? 'text-rose-500' : 'text-gray-400'}`}>
                          <i className="fa-regular fa-clock"></i>
                          {v.vencida
                            ? <>Venceu {fmtData(v.venc!)} — há {v.diasAtraso} {v.diasAtraso === 1 ? 'dia' : 'dias'}</>
                            : <>Vence {fmtData(v.venc!)}</>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AReceberPanel;
