"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, Product, MelhoriasFlags, MELHORIAS_DEFAULT } from '@/lib/types';
import { authHeaders } from '@/services/userService';
import { sounds } from '@/utils/sound';
import Cupom from '@/components/doce/Cupom';
import TrocasBox from '@/components/doce/TrocasBox';
// BLOCO 113: secretario edita o pedido (itens + forma de pagamento) antes da entrega
import EditorPedido from '@/components/doce/EditorPedido';

/**
 * BLOCO 13 — TELA DO SECRETÁRIO DA BASE FÍSICA.
 *
 * O secretário vê cada pedido de pré-venda assim que o vendedor registra:
 *  - imprime o cupom 100% IDÊNTICO ao do vendedor (mesmo gerador compartilhado)
 *  - separa o pedido na prateleira e aperta SEPARADO -> card fica CINZA
 *  - 🔔 ALARME SONORO quando entra pedido novo (tocar até reconhecer)
 *
 * BLOCO 113 (pedido do dono): ganhou o botão EDITAR PEDIDO — ajusta itens
 * (qtd/preço/adicionar/remover) e a FORMA DE PAGAMENTO (à vista/a prazo,
 * instrumento, vencimento, pago na visita) enquanto a entrega não foi
 * finalizada. Mesmo EditorPedido da fila do admin; o servidor aceita
 * SECRETARIO na ação EDITAR_PEDIDO.
 *
 * BLOCO 114 (pedido do dono): o secretário também CARREGA e DESCARREGA a
 * entrega — botão "Carregar no veículo" no card com o mesmo sheet do admin
 * (Entregador 1 PRINCIPAL + vendedores em chips) e "Remover do veículo".
 * A ação é a mesma CHECK_CARGA da fila, agora liberada p/ SECRETARIO na API.
 *
 * O secretário NÃO vende, NÃO entrega e NÃO mexe no cadastro de produtos
 * (a aba Estoque segue limitada à quantidade — BLOCO 19).
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
  // BLOCO 113: detalhe real da venda — o cupom usa para o PAGO NA VISITA (PIX)
  // em vez do texto sintético "cobrar PAGO_VISITA na entrega".
  detalhePagamento?: string | null;
  trocas: string | null;
  trocasValor?: number | null;
  prioridade: number;
  separado: boolean;
  vendedorNome: string;
  dataVencimento: string | null;
  // BLOCO 114: check de carga (mesmo dado da fila do admin — enrichFila)
  carregadoEm?: string | null;
  entregadorId?: string | null;
  entregadorNome?: string | null;
  cliente: { id: string; nome: string; endereco: string; bairro: string; telefone: string; cnpj?: string | null; email?: string | null };
  itens: { nome: string; produtoId: string; quantidade: number; precoVenda: number }[];
}

interface ApiResp {
  hoje: string;
  fila: FilaItem[];
  // BLOCO 114: entregadores ativos (Entregador 1 PRINCIPAL + vendedores)
  entregadores?: { id: string; nome: string; perfil?: string }[];
  resumo?: { naFila: number; valorFila: number; separados: number; entreguesHoje: number; valorEntregueHoje: number };
  migracaoPendente?: boolean;
  error?: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PGTO_META: Record<string, { label: string; icon: string; chip: string }> = {
  DINHEIRO: { label: 'Dinheiro', icon: 'fa-solid fa-money-bill-wave', chip: 'bg-emerald-50 text-emerald-700' },
  PIX: { label: 'Pix', icon: 'fa-brands fa-pix', chip: 'bg-teal-50 text-teal-700' },
  BOLETO: { label: 'Boleto', icon: 'fa-solid fa-barcode', chip: 'bg-amber-50 text-amber-700' },
  // BLOCO 113: formas que o editor de pedido pode gravar (mesma fila do admin)
  PAGO_VISITA: { label: 'Já pago na visita', icon: 'fa-solid fa-circle-check', chip: 'bg-emerald-100 text-emerald-800' },
  CHEQUE: { label: 'Cheque', icon: 'fa-solid fa-money-check', chip: 'bg-slate-50 text-slate-700' },
};
const pgtoMeta = (m: string) => PGTO_META[m] || PGTO_META.DINHEIRO;

const SecretarioView: React.FC<{ user: User; showToast: (m: string, t?: 'success' | 'error') => void; melhorias?: MelhoriasFlags }> = ({ showToast, melhorias: melhoriasProp }) => {
  // BLOCO 14: interruptores do admin
  const melhorias = melhoriasProp || MELHORIAS_DEFAULT;
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [cupom, setCupom] = useState<FilaItem | null>(null);
  const [alarmando, setAlarmando] = useState(false);
  // BLOCO 14: ajustar trocas no card (ex.: substituiu por outro do mesmo valor)
  const [editTrocas, setEditTrocas] = useState<{ p: FilaItem; texto: string; valor: string } | null>(null);
  // BLOCO 113: editar o pedido inteiro (itens + forma de pagamento)
  const [editPedido, setEditPedido] = useState<FilaItem | null>(null);
  // BLOCO 114: sheet de carga — escolhe o ENTREGADOR e carrega no veículo
  const [sheetCarga, setSheetCarga] = useState<FilaItem | null>(null);
  const [cargaEntId, setCargaEntId] = useState('');
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
    // EGRESS: 30s → 120s + pula quando o app esta em background
    const t = setInterval(() => { if (typeof document !== 'undefined' && !document.hidden) load(true); }, 120_000);
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

  // ===== BLOCO 114 (pedido do dono): CARREGAR/DESCARREGAR a entrega —
  // mesma CHECK_CARGA da fila do admin; a API aceita SECRETARIO.
  function abrirSheetCarga(p: FilaItem) {
    setCargaEntId(p.entregadorId || '');
    setSheetCarga(p);
  }

  async function confirmarCarga() {
    const p = sheetCarga;
    if (!p) return;
    const ents = data?.entregadores || [];
    if (ents.length > 0 && !cargaEntId) {
      showToast('Selecione quem CARREGOU esta entrega antes de carregar.', 'error');
      return;
    }
    const entNome = ents.find(e => e.id === cargaEntId)?.nome || p.entregadorNome || null;
    const ok = await acao(
      { acao: 'CHECK_CARGA', saleId: p.saleId, carregado: true, entregadorId: cargaEntId || undefined },
      cargaEntId ? `Carregado — entregador: ${entNome}!` : 'Pedido CARREGADO no veículo!'
    );
    if (ok) setSheetCarga(null);
  }

  async function descarregar() {
    const p = sheetCarga;
    if (!p) return;
    const ok = await acao({ acao: 'CHECK_CARGA', saleId: p.saleId, carregado: false }, 'Check de carga removido!');
    if (ok) setSheetCarga(null);
  }
  const saleOf = (p: FilaItem): any => ({
    id: p.saleId,
    data: new Date(p.dataVenda),
    valorTotal: p.valorTotal,
    valorPago: p.valorPago,
    metodoPagamento: 'A_PRAZO',
    // BLOCO 113: detalhe REAL do banco (mantém "PAGO NA VISITA pelo vendedor
    // (PIX)" e "| COM NOTA: ..." no cupom). Sem detalhe, sintetiza como antes.
    detalhePagamento: p.detalhePagamento || `PRE-VENDA — cobrar ${p.formaPgto} na entrega (${p.condicao === 'APRAZO' ? 'A PRAZO' : 'A VISTA'})`,
    statusPagamento: p.statusPagamento,
    itens: p.itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, precoVenda: i.precoVenda })),
    dataVencimento: p.dataVencimento ? new Date(p.dataVencimento) : undefined,
    trocas: p.trocas || undefined,
    trocasValor: (p as any).trocasValor ?? undefined,
    tipoVenda: 'PRE_VENDA',
    entregaStatus: p.entregaStatus,
  });
  const clientOf = (p: FilaItem): any => ({
    id: p.cliente.id,
    nomeFantasia: p.cliente.nome,
    telefone: p.cliente.telefone || '',
    endereco: p.cliente.endereco || '',
    bairro: p.cliente.bairro || '',
    // BLOCO 46: e-mail do cliente — rodape do cupom (envio do XML)
    email: p.cliente.email || '',
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
              {p.trocas && (
                <TrocasBox trocas={p.trocas} valor={(p as any).trocasValor} className="mt-1" />
              )}
              {melhorias.trocaSeparacao && (
                <button onClick={() => setEditTrocas({ p, texto: p.trocas || '', valor: (p as any).trocasValor ? String((p as any).trocasValor) : '' })} disabled={!!busy}
                  className="text-[8px] font-black text-orange-500 uppercase mt-1 active:scale-95 transition-transform">
                  <i className="fa-solid fa-pencil mr-1"></i>{p.trocas ? 'Editar trocas' : 'Anotar troca'}
                </button>
              )}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[13px] font-black text-gray-800">{fmt(p.valorTotal)}</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase ${pg.chip}`}><i className={`${pg.icon} mr-1`}></i>{pg.label}</span>
                {/* BLOCO 113: editar itens e forma de pagamento antes da entrega */}
                <button onClick={() => setEditPedido(p)} disabled={!!busy}
                  title="Editar itens e forma de pagamento do pedido"
                  className="text-[9px] font-black uppercase px-2 py-1 rounded-lg bg-violet-50 text-violet-600 border border-violet-100 active:scale-95 transition-transform disabled:opacity-60">
                  <i className="fa-solid fa-pen-to-square mr-1"></i>Editar pedido
                </button>
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

          {/* ===== BLOCO 114: CARREGAR/DESCARREGAR a entrega (mesmo fluxo do admin) ===== */}
          <button onClick={() => abrirSheetCarga(p)} disabled={!!busy}
            className={`w-full mt-2 py-3.5 rounded-2xl text-[10px] font-black uppercase active:scale-[0.98] transition-transform border flex items-center justify-center gap-1.5 disabled:opacity-60 ${p.carregadoEm ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            <i className="fa-solid fa-truck-fast mr-1"></i>
            {p.carregadoEm
              ? <>No veículo{p.entregadorNome ? ` — ${p.entregadorNome}` : ''} · tocar p/ trocar/descarregar</>
              : 'Carregar no veículo'}
          </button>
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

      {/* ===== AJUSTAR TROCAS (BLOCO 14) ===== */}
      {editTrocas && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setEditTrocas(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-right-left text-orange-500 mr-1"></i>Trocas do pedido</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 capitalize">{editTrocas.p.cliente.nome}</p>
            <p className="text-[9px] text-gray-400 font-bold text-center mt-0.5">Anote aqui — 1 item por linha, sai no cupom. Se a troca não voltar pelo mesmo produto, anote o VALOR em PREÇO DE CUSTO.</p>
            <textarea
              value={editTrocas.texto}
              onChange={e => setEditTrocas({ ...editTrocas, texto: e.target.value })}
              rows={3} maxLength={500}
              placeholder={'1 Lays sour cream 62g\n2 Toddynho 200ml'}
              className="w-full mt-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-100 resize-none leading-relaxed"
            />
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[8px] font-black text-gray-400 uppercase shrink-0">Valor (custo)</span>
              <input
                type="text" inputMode="decimal"
                value={editTrocas.valor}
                onChange={e => setEditTrocas({ ...editTrocas, valor: e.target.value })}
                placeholder="R$ 0,00"
                className="flex-1 bg-gray-50 border border-gray-100 rounded-xl text-sm font-black text-orange-600 px-3 py-2.5 text-right outline-none focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <button
              onClick={async () => { const t = editTrocas; setEditTrocas(null); const tv = parseFloat(t.valor.replace(',', '.')) || 0; await acao({ acao: 'EDITAR_TROCAS', saleId: t.p.saleId, trocas: t.texto, trocasValor: tv > 0 ? tv : undefined }, 'Trocas atualizadas! Imprima o cupom corrigido.'); }}
              disabled={!!busy}
              className="w-full mt-3 py-4 bg-orange-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              <i className="fa-solid fa-check mr-1"></i>Salvar trocas
            </button>
            <button onClick={() => setEditTrocas(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== BLOCO 114: SHEET DE CARGA — mesmo fluxo do admin: escolhe QUEM
          é o ENTREGADOR da venda (Entregador 1 PRINCIPAL + vendedores) e
          confirma; já carregado: troca o entregador ou REMOVE do veículo. ===== */}
      {sheetCarga && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetCarga(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto overscroll-contain" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">
              <i className="fa-solid fa-truck-fast text-emerald-600 mr-1"></i>
              {sheetCarga.carregadoEm ? 'Trocar entregador da carga' : 'Carregar no veículo'}
            </h3>
            <p className="text-[11px] font-bold text-gray-600 capitalize text-center mt-1">{sheetCarga.cliente.nome} · {fmt(sheetCarga.valorTotal)}</p>
            <p className="text-[9px] font-black text-gray-400 uppercase text-center mt-3 leading-snug">Quem CARREGOU esta entrega? <span className="text-gray-300">(entregador da venda)</span></p>
            {(data?.entregadores || []).length > 0 ? (
              <div className="mt-2 space-y-2">
                {/* Entregador 1 (login fixo da base) é a opção PRINCIPAL —
                    botão gigante no topo; vendedores em chips menores. */}
                {(data?.entregadores || []).filter(e => e.perfil === 'ENTREGADOR_FIXO').map(e => (
                  <button key={e.id} onClick={() => setCargaEntId(e.id)}
                    className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-wide border-2 transition-colors flex items-center justify-center gap-2 ${cargaEntId === e.id ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                    <i className="fa-solid fa-motorcycle text-sm"></i>{e.nome}
                    <span className={`text-[8px] px-1.5 py-0.5 rounded-md font-black ${cargaEntId === e.id ? 'bg-white/20' : 'bg-white'}`}>PRINCIPAL</span>
                  </button>
                ))}
                {(data?.entregadores || []).filter(e => e.perfil !== 'ENTREGADOR_FIXO').length > 0 && (
                  <p className="text-[8px] font-black text-gray-300 uppercase tracking-widest pt-1">Ou um vendedor leva:</p>
                )}
                <div className="flex gap-1.5 flex-wrap">
                  {(data?.entregadores || []).filter(e => e.perfil !== 'ENTREGADOR_FIXO').map(e => (
                    <button key={e.id} onClick={() => setCargaEntId(e.id)}
                      className={`px-3 py-2.5 rounded-xl text-[10px] font-black uppercase border-2 transition-colors ${cargaEntId === e.id ? 'bg-emerald-600 border-emerald-600 text-white shadow' : 'bg-white border-gray-200 text-gray-500'}`}>
                      <i className="fa-solid fa-user mr-1"></i>{e.nome}
                      <span className="ml-1 text-[8px] font-black opacity-60">VENDEDOR</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2">
                <p className="text-[9px] font-black text-amber-700 uppercase"><i className="fa-solid fa-triangle-exclamation mr-1"></i>Nenhum vendedor ativo</p>
                <p className="text-[9px] font-semibold text-amber-600 mt-0.5 leading-snug">O entregador é escolhido entre os VENDEDORES — peça ao admin para ativar um no menu Usuários. Pode carregar sem entregador (modo antigo).</p>
              </div>
            )}
            {cargaEntId && (
              <p className="text-[9px] font-black text-emerald-600 uppercase text-center mt-2">
                <i className="fa-solid fa-circle-check mr-1"></i>Entregador: {(data?.entregadores || []).find(e => e.id === cargaEntId)?.nome || 'Entregador'} — essa entrega alimenta o caixa DELE
              </p>
            )}
            <button onClick={confirmarCarga} disabled={!!busy}
              className={`w-full mt-4 py-4 rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50 ${cargaEntId || (data?.entregadores || []).length === 0 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
              <i className="fa-solid fa-truck-fast mr-1"></i>{sheetCarga.carregadoEm ? 'Salvar entregador' : 'Confirmar carga no veículo'}
            </button>
            {sheetCarga.carregadoEm && (
              <button onClick={descarregar} disabled={!!busy}
                className="w-full mt-2 py-3.5 rounded-2xl bg-rose-50 text-rose-600 text-[10px] font-black uppercase active:scale-95 disabled:opacity-60">
                <i className="fa-solid fa-truck-ramp-box mr-1"></i>Remover do veículo
              </button>
            )}
            <button onClick={() => setSheetCarga(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== BLOCO 113: EDITAR PEDIDO (itens + forma de pagamento) ===== */}
      {editPedido && (
        <EditorPedido
          pedido={{
            saleId: editPedido.saleId,
            numero: editPedido.numero,
            cliente: { nome: editPedido.cliente.nome },
            valorTotal: editPedido.valorTotal,
            formaPgto: editPedido.formaPgto,
            condicao: editPedido.condicao,
            itens: editPedido.itens,
          }}
          onClose={() => setEditPedido(null)}
          onSalvo={(msg) => { setEditPedido(null); showToast(msg, 'success'); load(true); }}
          showToast={showToast}
        />
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
