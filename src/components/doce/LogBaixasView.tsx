'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 221 — TELA "LOG DE BAIXAS" (pedido do dono: "quero o log de baixas
 * facil de visualizar em tela limpa!").
 *
 * Tela LIMPA, focada SO nas baixas na ordem em que aconteceram:
 *   - 4 cartoes de resumo (hoje, 7 dias, fila aberta, ultimo sync);
 *   - filtros por origem (Webhook / Cron / Manual / Pix portal);
 *   - lista agrupada por dia: cliente, valor, origem e hora de cada baixa;
 *   - "Eventos tecnicos" (webhook/cron) dobravel no rodape;
 *   - Sincronizar agora (mesmo trabalho do cron, na hora) + auto-refresh 60 s;
 *   - abrir a tela ja dispara o AUTO-SYNC horario (GET /api/log-baixas).
 *
 * Fonte: GET /api/log-baixas (admin/secretario). Degrada com aviso quando o
 * SQL 221/172/167 ainda nao rodou.
 */

interface BaixaItem {
  id: string;
  cliente: string;
  valor: number;
  valorPago: number;
  metodo: string;
  origem: string;
  baixaEm: string;
  vencimento: string;
  detalhe: string;
}

interface EventoItem {
  criadoEm: string;
  origem: string;
  resultado: string;
  processado: boolean;
}

interface LogBaixasSnapshot {
  ok: boolean;
  resumo: {
    hojeQtde: number; hojeTotal: number;
    seteQtde: number; seteTotal: number;
    trintaQtde: number; trintaTotal: number;
    filaAbertaQtde: number; filaAbertaTotal: number;
    ultimoSync: { em: string; resultado: string } | null;
  };
  baixas: BaixaItem[];
  eventos: EventoItem[];
}

interface LogBaixasViewProps {
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

const brl = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const horaSp = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch { return '—'; }
};

/** "há 3 min", "há 2 h", "há 5 d" — prova de vida do sync. */
const relativo = (iso: string | null): string => {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'agora';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
};

/** Rotulo e cor da origem da baixa (mesmo padrao da Baixa Automatica). */
const rotuloOrigem = (o: string): { nome: string; curto: string; cor: string } => {
  switch (o) {
    case 'WEBHOOK_INTER': return { nome: 'Webhook Inter (tempo real)', curto: 'Webhook', cor: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'CRON_INTER': return { nome: 'Sync automático (cron/auto)', curto: 'Sync', cor: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
    case 'PIX_PORTAL': return { nome: 'Comprovante Pix (portal)', curto: 'Pix', cor: 'bg-violet-50 text-violet-700 border-violet-200' };
    case 'MANUAL': return { nome: 'Manual (admin/PDV)', curto: 'Manual', cor: 'bg-amber-50 text-amber-700 border-amber-200' };
    default: return { nome: o, curto: o, cor: 'bg-slate-50 text-slate-600 border-slate-200' };
  }
};

/** Agrupa por dia (America/Sao_Paulo): HOJE / ONTEM / dd/mm. */
function agruparPorDia(baixas: BaixaItem[]): Array<{ chave: string; itens: BaixaItem[] }> {
  const tz = 'America/Sao_Paulo';
  const diaIso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const hoje = diaIso(new Date());
  const ontem = diaIso(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const grupos = new Map<string, BaixaItem[]>();
  for (const b of baixas) {
    const iso = b.baixaEm ? diaIso(new Date(b.baixaEm)) : '?';
    const rotulo = iso === hoje ? 'HOJE' : iso === ontem ? 'ONTEM' : iso.slice(8, 10) + '/' + iso.slice(5, 7);
    const lista = grupos.get(rotulo) || [];
    lista.push(b);
    grupos.set(rotulo, lista);
  }
  return [...grupos.entries()].map(([chave, itens]) => ({ chave, itens }));
}

const LogBaixasView: React.FC<LogBaixasViewProps> = ({ showToast }) => {
  const [snap, setSnap] = useState<LogBaixasSnapshot | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [syncando, setSyncando] = useState(false);
  const [filtro, setFiltro] = useState<string>('TODAS');
  const [mostrarEventos, setMostrarEventos] = useState(false);

  // Fix loop (mesmo padrao do Bloco 219): toast em ref — o effect nao re-rodar.
  const toastRef = useRef(showToast);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/log-baixas', { headers: { ...authHeaders() }, cache: 'no-store' });
      let data: Record<string, unknown> | null = null;
      try { data = await res.json(); } catch { throw new Error(`Erro ${res.status} no servidor`); }
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || data?.erro || `HTTP ${res.status}`));
      setSnap(data as unknown as LogBaixasSnapshot);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha de conexão';
      if (!silencioso) { setErro(msg); toastRef.current?.(msg, 'error'); }
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  // Auto-refresh 60 s (silencioso — tela sempre fresca sem piscar).
  useEffect(() => {
    const iv = setInterval(() => { void carregar(true); }, 60000);
    return () => clearInterval(iv);
  }, [carregar]);

  const sincronizar = async () => {
    setSyncando(true);
    try {
      const res = await fetch('/api/boletos-sync', { headers: { ...authHeaders() } });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.erro || 'Falha no sync');
      const motivo = data.motivo ? ` (${data.motivo})` : '';
      showToast?.(`Sync feito: ${data.processadas ?? 0} consultado(s), ${data.baixadas ?? 0} baixado(s)${motivo}`);
      await carregar(true);
    } catch (e: unknown) {
      showToast?.(e instanceof Error ? e.message : 'Falha ao sincronizar.', 'error');
    } finally {
      setSyncando(false);
    }
  };

  const resumo = snap?.resumo;
  const baixasFiltradas = (snap?.baixas || []).filter(b => filtro === 'TODAS' || b.origem === filtro);
  const grupos = agruparPorDia(baixasFiltradas);
  const contagemOrigem = (o: string) => (snap?.baixas || []).filter(b => b.origem === o).length;

  const cardResumo = (rotulo: string, valor: string, sub: string, cor: string, icone: string) => (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${cor}`}><i className={`fa-solid ${icone} text-xs`}></i></span>
        <p className="text-[9px] font-black uppercase text-gray-400 leading-tight">{rotulo}</p>
      </div>
      <p className="text-lg font-black text-gray-800 mt-2 leading-none">{valor}</p>
      <p className="text-[9px] font-bold text-gray-400 mt-1">{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4 pb-24">
      {/* ---------- CABEÇALHO ---------- */}
      <header className="px-1 flex justify-between items-center gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0"><i className="fa-solid fa-clipboard-list text-sm"></i></span>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Log de Baixas</h2>
            <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Cada baixa automática, na hora que aconteceu</p>
          </div>
        </div>
        <button
          onClick={() => void carregar()}
          className="bg-white p-2.5 rounded-xl shadow-sm border border-gray-100 text-gray-500 active:scale-95 transition-all"
          title="Atualizar agora"
        >
          <i className={`fa-solid fa-rotate ${carregando ? 'fa-spin' : ''}`}></i>
        </button>
      </header>

      {carregando && !snap && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-3xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {erro && !snap && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-[11px] font-bold text-rose-600 leading-snug">
          <i className="fa-solid fa-triangle-exclamation mr-1"></i>{erro}
          <p className="text-[9px] font-bold text-rose-500 mt-1">Se o erro mencionar SQL, rode o <b>sql/bloco221_notificacoes.sql</b> no SQL Editor do Supabase e toque em atualizar.</p>
        </div>
      )}

      {snap && resumo && (
        <>
          {/* ---------- 1. RESUMO ---------- */}
          <div className="grid grid-cols-2 gap-3">
            {cardResumo('Baixas hoje', resumo.hojeQtde > 0 ? brl(resumo.hojeTotal) : 'R$ 0,00', `${resumo.hojeQtde} baixa(s) automática(s)`, 'bg-emerald-50 text-emerald-600', 'fa-circle-check')}
            {cardResumo('Últimos 7 dias', brl(resumo.seteTotal), `${resumo.seteQtde} baixa(s)`, 'bg-cyan-50 text-cyan-600', 'fa-calendar-week')}
            {cardResumo('Fila aguardando', resumo.filaAbertaQtde > 0 ? brl(resumo.filaAbertaTotal) : 'R$ 0,00', `${resumo.filaAbertaQtde} boleto(s) em aberto`, resumo.filaAbertaQtde > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600', 'fa-hourglass-half')}
            {cardResumo('Último sync', relativo(resumo.ultimoSync?.em || null), resumo.ultimoSync?.resultado?.slice(0, 42) || 'cron 07h + auto-sync 60 min', 'bg-teal-50 text-teal-600', 'fa-arrows-rotate')}
          </div>

          {/* ---------- 2. SINCRONIZAR AGORA ---------- */}
          <button
            onClick={() => void sincronizar()}
            disabled={syncando}
            className="w-full bg-teal-600 text-white rounded-2xl py-3.5 px-4 text-[11px] font-black uppercase shadow-sm active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2 min-h-[44px]"
          >
            <i className={`fa-solid fa-arrows-rotate ${syncando ? 'fa-spin' : ''}`}></i>
            {syncando ? 'Consultando o Inter...' : 'Sincronizar boletos agora'}
          </button>

          {/* ---------- 3. FILTROS POR ORIGEM ---------- */}
          <div className="flex gap-2 overflow-x-auto pb-1 px-0.5">
            {[{ k: 'TODAS', n: `Todas (${(snap.baixas || []).length})` },
              { k: 'WEBHOOK_INTER', n: `Webhook (${contagemOrigem('WEBHOOK_INTER')})` },
              { k: 'CRON_INTER', n: `Sync (${contagemOrigem('CRON_INTER')})` },
              { k: 'PIX_PORTAL', n: `Pix (${contagemOrigem('PIX_PORTAL')})` },
              { k: 'MANUAL', n: `Manual (${contagemOrigem('MANUAL')})` },
            ].map(f => (
              <button
                key={f.k}
                onClick={() => setFiltro(f.k)}
                className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap border transition-all ${filtro === f.k ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200'}`}
              >
                {f.n}
              </button>
            ))}
          </div>

          {/* ---------- 4. LISTA DE BAIXAS (agrupada por dia) ---------- */}
          <section className="space-y-2">
            {grupos.length === 0 ? (
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 text-center">
                <i className="fa-solid fa-inbox text-3xl text-gray-200 mb-3"></i>
                <p className="text-[11px] font-black text-gray-500 uppercase">Nenhuma baixa nesta origem</p>
                <p className="text-[9px] font-bold text-gray-400 mt-1 leading-snug">As baixas com origem marcada aparecem aqui automaticamente (o marcador existe desde o SQL 172).</p>
              </div>
            ) : grupos.map(g => (
              <div key={g.chave} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase text-gray-500 tracking-wider">{g.chave}</p>
                  <p className="text-[9px] font-black text-gray-400">{g.itens.length} baixa(s) · {brl(g.itens.reduce((a, b) => a + b.valor, 0))}</p>
                </div>
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto dm-scroll">
                  {g.itens.map(b => {
                    const o = rotuloOrigem(b.origem);
                    return (
                      <div key={b.id} className="px-4 py-3 flex items-center gap-3">
                        <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${o.cor}`}>
                          <i className={`fa-solid ${b.origem === 'WEBHOOK_INTER' ? 'fa-bolt' : b.origem === 'CRON_INTER' ? 'fa-clock' : b.origem === 'PIX_PORTAL' ? 'fa-mobile-alt' : 'fa-hand'} text-[11px]`}></i>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-black text-gray-800 leading-tight truncate">{b.cliente}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded-lg border text-[8px] font-black ${o.cor}`}>{o.curto}</span>
                            <span className="text-[9px] font-bold text-gray-400">{horaSp(b.baixaEm)}</span>
                            {b.metodo && <span className="text-[9px] font-bold text-gray-300 uppercase">{b.metodo.replace('_', ' ')}</span>}
                          </div>
                        </div>
                        <p className="text-[13px] font-black text-emerald-600 shrink-0">{brl(b.valor)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          {/* ---------- 5. EVENTOS TÉCNICOS (dobrável) ---------- */}
          <section className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <button onClick={() => setMostrarEventos(v => !v)} className="w-full px-4 py-3.5 flex items-center justify-between active:bg-gray-50 transition-colors">
              <span className="text-[10px] font-black uppercase text-gray-500 flex items-center gap-2">
                <i className="fa-solid fa-scroll text-slate-400"></i>Eventos técnicos do webhook/cron ({(snap.eventos || []).length})
              </span>
              <i className={`fa-solid fa-chevron-down text-gray-300 text-xs transition-transform ${mostrarEventos ? 'rotate-180' : ''}`}></i>
            </button>
            {mostrarEventos && (
              <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-96 overflow-y-auto dm-scroll">
                {(snap.eventos || []).length === 0 ? (
                  <p className="p-4 text-[10px] font-bold text-gray-400">Nenhum evento registrado ainda (o log existe desde o SQL 167).</p>
                ) : snap.eventos.map((ev, i) => (
                  <div key={i} className="px-4 py-2.5 flex gap-2.5 items-start">
                    <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${ev.origem === 'CRON' ? 'bg-cyan-50 text-cyan-600' : ev.origem === 'FOCUS' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                      <i className={`fa-solid ${ev.origem === 'CRON' ? 'fa-clock' : ev.origem === 'FOCUS' ? 'fa-file-invoice' : 'fa-bolt'} text-[10px]`}></i>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-black uppercase text-gray-400">{ev.origem === 'CRON' ? 'CRON/SYNC' : ev.origem}</span>
                        <span className="text-[9px] font-bold text-gray-300">{horaSp(ev.criadoEm)}</span>
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${ev.processado ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{ev.processado ? 'OK' : 'NÃO PROC.'}</span>
                      </div>
                      <p className="text-[10px] font-semibold text-gray-600 leading-snug mt-0.5 break-words">{ev.resultado}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ---------- RODAPÉ INFORMATIVO ---------- */}
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-[9px] font-bold text-slate-500 leading-snug">
            <i className="fa-solid fa-circle-info mr-1 text-slate-400"></i>
            Frequência atual: webhook do Inter em TEMPO REAL · cron da Vercel todo dia 07h (Brasília) · <b>AUTO-SYNC a cada 60 min</b> enquanto o sistema é usado · botão "Sincronizar agora" quando você quiser.
          </div>
        </>
      )}
    </div>
  );
};

export default LogBaixasView;
