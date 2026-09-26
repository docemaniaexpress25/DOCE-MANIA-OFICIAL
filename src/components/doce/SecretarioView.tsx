"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, Product } from '@/lib/types';
import { authHeaders } from '@/services/userService';
import { sounds } from '@/utils/sound';
import Cupom from '@/components/doce/Cupom';

/**
 * BLOCO 13 — TELA DO SECRETÁRIO DA BASE FÍSICA.
 *
 * O secretário vê cada pedido de pré-venda assim que o vendedor registra:
 *  - imprime o cupom 100% IDÊNTICO ao do vendedor (mesmo gerador compartilhado)
 *  - separa o pedido na prateleira e aperta SEPARADO -> card fica CINZA
 *  - 🔔 ALARME SONORO quando entra pedido novo (tocar até reconhecer)
 *
 * O secretário NÃO vende, NÃO entrega e NÃO mexe em valores.
 */

interface FilaItem {
  saleId: string;
  numero: string;
  dataVenda: string;
  entregaStatus: string;
  valorTotal: number;
  valorPago: number;
  statusPagamento: string;
  formaPgto: string;
  condicao: string;
  trocas: string | null;
  prioridade: number;
  separado: boolean;
  vendedorNome: string;
  dataVencimento: string | null;
  cliente: { id: string; nome: string; endereco: string; bairro: string; telefone: string };
  itens: { nome: string; produtoId: string; quantidade: number; precoVenda: number }[];
}

interface ApiResp {
  hoje: string;
  fila: FilaItem[];
  resumo?: { naFila: number; valorFila: number; separados: number; entreguesHoje: number; valorEntregueHoje: number };
  migracaoPendente?: boolean;
  error?: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PGTO_META: Record<string, { label: string; icon: string; chip: string }> = {
  DINHEIRO: { label: 'Dinheiro', icon: 'fa-solid fa-money-bill-wave', chip: 'bg-emerald-50 text-emerald-700' },
  PIX: { label: 'Pix', icon: 'fa-brands fa-pix', chip: 'bg-teal-50 text-teal-700' },
  BOLETO: { label: 'Boleto', icon: 'fa-solid fa-barcode', chip: 'bg-amber-50 text-amber-700' },
};
const pgtoMeta = (m: string) => PGTO_META[m] || PGTO_META.DINHEIRO;

const SecretarioView: React.FC<{ user: User; showToast: (m: string, t?: 'success' | 'error') => void }> = ({ showToast }) => {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [cupom, setCupom] = useState<FilaItem | null>(null);
  const [alarmando, setAlarmando] = useState(false);
  // quantidade de pedidos ainda NAO separados — base do alarme
  const aSepararRef = useRef<number>(-1);
  const alarmTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch('/api/pre-venda?fila=1', { headers: authHeaders() });
      const d: ApiResp = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { if (!silencioso) showToast(d.error || 'Erro ao carregar os pedidos.', 'error'); }
      else {
        const aSeparar = (d.fila || []).filter(p => !p.separado).length;
        // Alarme: subiu o numero de pedidos nao separados (pedido novo chegou)
        if (aSepararRef.current >= 0 && aSeparar > aSepararRef.current) {
          setAlarmando(true);
          sounds.alarmeNovoPedido();
        }
        aSepararRef.current = aSeparar;
        setData(d);
      }
    } catch {
      if (mounted.current && !silencioso) showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    mounted.current = true;
    const t0 = setTimeout(() => load(), 0);
    const t = setInterval(() => load(true), 30_000);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; clearTimeout(t0); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  // Loop do alarme: repete a sirene a cada 4s enquanto o secretario nao reconhecer
  useEffect(() => {
    if (alarmando) {
      alarmTimer.current = setInterval(() => sounds.alarmeNovoPedido(), 4000);
      return () => { if (alarmTimer.current) clearInterval(alarmTimer.current); alarmTimer.current = null; };
    }
  }, [alarmando]);

  async function acao(body: any, okMsg: string) {
    setBusy(body.saleId || body.acao);
    try {
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        showToast(d.error || 'Nao foi possivel concluir.', 'error');
        return false;
      }
      showToast(okMsg, 'success');
      sounds.separado();
      await load(true);
      return true;
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const productsOf = (p: FilaItem): Product[] => p.itens.map(i => ({ id: i.produtoId, nome: i.nome, precoCusto: 0, precoVenda: i.precoVenda, precoMinimo: 0, comissaoPercentual: 0, estoquePrincipal: 0, ativo: true }));
  const saleOf = (p: FilaItem): any => ({
    id: p.saleId,
    data: new Date(p.dataVenda),
    valorTotal: p.valorTotal,
    valorPago: p.valorPago,
    metodoPagamento: 'A_PRAZO',
    detalhePagamento: `PRE-VENDA — cobrar ${p.formaPgto} na entrega (${p.condicao === 'APRAZO' ? 'A PRAZO' : 'A VISTA'})`,
    statusPagamento: p.statusPagamento,
    itens: p.itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, precoVenda: i.precoVenda })),
    dataVencimento: p.dataVencimento ? new Date(p.dataVencimento) : undefined,
    trocas: p.trocas || undefined,
    tipoVenda: 'PRE_VENDA',
    entregaStatus: p.entregaStatus,
  });
  const clientOf = (p: FilaItem): any => ({
    id: p.cliente.id,
    nomeFantasia: p.cliente.nome,
    telefone: p.cliente.telefone || '',
    endereco: p.cliente.endereco || '',
    bairro: p.cliente.bairro || '',
  });

  if (loading && !data) {
    return <div className="py-14 flex justify-center"><div className="w-9 h-9 border-4 border-slate-100 border-t-slate-600 rounded-full animate-spin" /></div>;
  }
  if (!data) return null;

  if (data.migracaoPendente) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
        <i className="fa-solid fa-database text-amber-500"></i>
        <p className="text-[10px] font-black text-amber-700 uppercase leading-snug">
          Pre-venda em preparacao: aguarde o admin rodar o SQL do sistema.
        </p>
      </div>
    );
  }

  const fila = data.fila || [];
  const aSeparar = fila.filter(p => !p.separado);
  const separados = fila.filter(p => p.separado);
  const resumo = data.resumo;

  const Card = ({ p, cinza }: { p: FilaItem; cinza: boolean }) => {
    const pg = pgtoMeta(p.formaPgto);
    return (
      <div className={`rounded-2xl shadow-sm border overflow-hidden ${cinza ? 'bg-gray-200 border-gray-300 opacity-75' : p.prioridade === 1 ? 'bg-white border-rose-300 ring-2 ring-rose-100' : p.prioridade === 2 ? 'bg-white border-amber-300' : 'bg-white border-gray-100'}`}>
        <div className="p-4">
          <div className="flex items-start gap-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-[11px] ${cinza ? 'bg-gray-400 text-white' : p.prioridade === 1 ? 'bg-rose-600 text-white' : p.prioridade === 2 ? 'bg-amber-500 text-white' : 'bg-gray-800 text-white'}`}>
              {cinza ? <i className="fa-solid fa-check"></i> : p.prioridade === 1 ? 'P1' : p.prioridade === 2 ? 'P2' : <i className="fa-solid fa-boxes-stacked"></i>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[13px] font-black text-gray-800 truncate capitalize">{p.cliente.nome}</p>
                <span className="text-[8px] font-bold text-gray-300 uppercase">{p.numero}</span>
              </div>
              <p className="text-[9px] text-gray-400 font-semibold mt-0.5 truncate">
                <i className="fa-solid fa-location-dot mr-1"></i>{p.cliente.endereco || 'Sem endereco'}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}
              </p>
              <p className="text-[10px] text-gray-600 font-bold mt-1 leading-snug">
                {p.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ')}
              </p>
              {p.trocas && (
                <p className="text-[9px] font-black text-orange-600 mt-1 bg-orange-50 rounded-lg px-2 py-1 leading-snug">
                  <i className="fa-solid fa-right-left mr-1"></i>Trocas: {p.trocas}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[13px] font-black text-gray-800">{fmt(p.valorTotal)}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase ${pg.chip}`}><i className={`${pg.icon} mr-1`}></i>{pg.label}</span>
                {p.vendedorNome && <span className="text-[8px] font-bold text-gray-400 uppercase">venda: {p.vendedorNome}</span>}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
            <button onClick={() => setCupom(p)}
              className="flex-1 py-4 rounded-2xl bg-amber-50 text-amber-700 text-[10px] font-black uppercase active:scale-95 transition-transform border border-amber-100">
              <i className="fa-solid fa-print mr-1"></i>Ver / Imprimir cupom
            </button>
            {cinza ? (
              <button onClick={() => acao({ acao: 'DESFAZER_SEPARADO', saleId: p.saleId }, 'Separação desfeita.')} disabled={!!busy}
                className="flex-1 py-4 rounded-2xl bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60">
                <i className="fa-solid fa-rotate-left mr-1"></i>Desfazer
              </button>
            ) : (
              <button onClick={() => acao({ acao: 'SEPARAR', saleId: p.saleId }, 'Pedido separado!')} disabled={!!busy}
                className="flex-[1.3] py-4 rounded-2xl bg-slate-800 text-white text-[10px] font-black uppercase active:scale-95 transition-transform shadow-md disabled:opacity-60">
                <i className="fa-solid fa-boxes-packing mr-1"></i>Separado
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ===== ALARME: NOVO PEDIDO ===== */}
      {alarmando && (
        <div className="fixed top-24 left-4 right-4 z-[250] max-w-lg mx-auto">
          <div className="bg-rose-600 text-white rounded-2xl shadow-2xl p-4 animate-in slide-in-from-top duration-300 ring-4 ring-rose-300">
            <div className="flex items-center gap-3">
              <i className="fa-solid fa-bell fa-shake text-2xl"></i>
              <div className="flex-1">
                <p className="text-[11px] font-black uppercase">Novo pedido para separar!</p>
                <p className="text-[9px] font-bold text-rose-100 uppercase">Veja no topo da fila abaixo</p>
              </div>
              <button onClick={() => setAlarmando(false)} className="bg-white text-rose-600 font-black text-[9px] uppercase px-3 py-2 rounded-xl active:scale-95">
                OK, vi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== RESUMO ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-100 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-boxes-packing text-slate-600 text-xs"></i>
            </div>
            <div>
              <p className="text-[10px] font-black text-gray-700 uppercase leading-none">Separação de pedidos</p>
              <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">Base física — pré-venda</p>
            </div>
          </div>
          <button onClick={() => load()} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center active:scale-90">
            <i className={`fa-solid fa-rotate text-[11px] ${busy ? 'animate-spin' : ''}`}></i>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-rose-50 rounded-xl p-2"><p className="text-[7px] font-black text-rose-400 uppercase">A separar</p><p className="text-[15px] font-black text-rose-600">{aSeparar.length}</p></div>
          <div className="bg-gray-100 rounded-xl p-2"><p className="text-[7px] font-black text-gray-400 uppercase">Separados</p><p className="text-[15px] font-black text-gray-600">{separados.length}</p></div>
          <div className="bg-emerald-50 rounded-xl p-2"><p className="text-[7px] font-black text-emerald-500 uppercase">Entregues hj</p><p className="text-[15px] font-black text-emerald-700">{resumo?.entreguesHoje ?? 0}</p></div>
        </div>
        <p className="text-[9px] font-bold text-gray-500 mt-2 text-center">
          Fila: {fmt(resumo?.valorFila ?? 0)} · Imprima o cupom, separe e aperte <span className="font-black">SEPARADO</span>
        </p>
      </div>

      {/* ===== A SEPARAR ===== */}
      {aSeparar.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-rose-600 uppercase px-1"><i className="fa-solid fa-triangle-exclamation mr-1"></i>A separar agora (P1 primeiro)</p>
          {aSeparar.map(p => <Card key={p.saleId} p={p} cinza={false} />)}
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <i className="fa-solid fa-box-open text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs font-black text-gray-700">Nada para separar agora</p>
          <p className="text-[10px] text-gray-400 font-semibold mt-1">O alarme toca quando o vendedor registrar um pedido novo.</p>
        </div>
      )}

      {/* ===== SEPARADOS (cinza, aguardando entrega) ===== */}
      {separados.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-gray-500 uppercase px-1"><i className="fa-solid fa-check mr-1"></i>Separados — aguardando o entregador</p>
          {separados.map(p => <Card key={p.saleId} p={p} cinza />)}
        </div>
      )}

      {/* ===== CUPOM IDENTICO ===== */}
      {cupom && (
        <Cupom
          sale={saleOf(cupom)}
          client={clientOf(cupom)}
          products={productsOf(cupom)}
          onClose={() => setCupom(null)}
          closeLabel="FECHAR"
          showToast={showToast}
        />
      )}
    </div>
  );
};

export default SecretarioView;
