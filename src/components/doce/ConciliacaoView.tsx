'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 219 — TELA "BAIXA AUTOMATICA" (aba CONCILIACAO do admin).
 *
 * Pedido do dono: "me diga onde e como esta acontecendo a baixa automatica das
 * contas a receber, boletos e Pix... crie uma tela onde o admin pode ver isso
 * mais facilmente. Com qual frequencia esta fazendo o sync para atualizar isso".
 *
 * Resposta em tela (tudo real, do banco, via GET /api/conciliacao):
 *   - COMO FUNCIONA: as 5 vias de baixa (webhook Inter em tempo real, cron
 *     diario 07:00 como rede de seguranca, trigger SQL do caixa em tempo real,
 *     comprovante Pix do portal com revisao manual, baixa manual) com a
 *     FREQUENCIA de cada uma;
 *   - STATUS DA AUTOMACAO: Inter configurado? CRON_SECRET presente na Vercel?
 *     schema ok? prova de vida: ultimo evento de cada origem (INTER vs CRON);
 *   - FILAS AGORA: boletos unicos e parcelas abertos (R$), linhas BOLETO
 *     pendentes no caixa, comprovantes Pix aguardando revisao;
 *   - BAIXAS 30 DIAS POR ORIGEM: qtde e R$ baixados por WEBHOOK_INTER,
 *     CRON_INTER, MANUAL, PIX_PORTAL;
 *   - ULTIMOS EVENTOS: log do webhook/cron (webhook_logs) com resultado e hora;
 *   - SINCRONIZAR AGORA: dispara /api/boletos-sync e /api/notas-sync na mao
 *     (mesma coisa que o cron faz, na hora que o admin quiser).
 */

interface Snapshot {
  ok: boolean;
  agora: string;
  crons: {
    boletosSync: { schedule: string; rotulo: string; limite: string };
    notasSync: { schedule: string; rotulo: string; limite: string };
  };
  config: { interConfigurado: boolean; cronSecretPresente: boolean; schemaBoletosOk: boolean; parcelasOk: boolean };
  filas: {
    boletosUnicos: Array<{ status: string; qtde: number; total: number }>;
    parcelas: Array<{ status: string; qtde: number; total: number }>;
    caixaBoletosPendentes: { qtde: number; total: number };
    comprovantesPendentes: { qtde: number; total: number; maisAntiga: string | null };
  };
  baixas30d: Array<{ origem: string; qtde: number; total: number }>;
  origem7d: Array<{ origem: string; qtde: number; ultima: string | null }>;
  log: Array<{ criado_em: string; origem: string; resultado: string; processado: boolean; codigo: string | null; sale_id: string | null }>;
}

interface ConciliacaoViewProps {
  showToast?: (message: string, type?: 'success' | 'error') => void;
  /** BLOCO 221: atalho para a nova aba LOG_BAIXAS (tela limpa de baixas). */
  onAbrirLogBaixas?: () => void;
}

const brl = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "há 3 min", "há 2 h", "há 5 d" — para prova de vida do webhook/cron. */
const relativo = (iso: string | null): string => {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'agora';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
};

const horaSp = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch { return '—'; }
};

/** Rotulo amigavel da origem da baixa. */
const rotuloOrigem = (o: string): { nome: string; cor: string } => {
  switch (o) {
    case 'WEBHOOK_INTER': return { nome: 'Webhook Inter (tempo real)', cor: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'CRON_INTER': return { nome: 'Cron diário 07:00 (sync)', cor: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
    case 'PIX_PORTAL': return { nome: 'Comprovante Pix (portal)', cor: 'bg-violet-50 text-violet-700 border-violet-200' };
    case 'MANUAL': return { nome: 'Manual (admin/PDV)', cor: 'bg-amber-50 text-amber-700 border-amber-200' };
    default: return { nome: o, cor: 'bg-slate-50 text-slate-600 border-slate-200' };
  }
};

const rotuloStatusBoleto = (s: string): string => {
  switch (s) {
    case 'EM_PROCESSAMENTO': return 'Gerando no Inter';
    case 'A_RECEBER': return 'A receber';
    case 'ATRASADO': return 'Atrasado';
    case 'FALHA_EMISSAO': return 'Falha na emissão';
    default: return s;
  }
};

const ConciliacaoView: React.FC<ConciliacaoViewProps> = ({ showToast, onAbrirLogBaixas }) => {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [syncBoletos, setSyncBoletos] = useState(false);
  const [syncNotas, setSyncNotas] = useState(false);

  // BLOCO 219 (fix loop): showToast do AdminDashboard NAO tem identidade
  // estavel — se o carregar dependesse direto dele, qualquer toast (ex. erro
  // de rede) re-renderizava o pai, mudava carregar e re-disparava o effect:
  // "Maximum update depth exceeded". O ref quebra o ciclo (effect roda 1x).
  const toastRef = useRef(showToast);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/conciliacao', { headers: { ...authHeaders() }, cache: 'no-store' });
      // Servidor sem credenciais devolve erro NAO-JSON (pagina de erro do Next)
      // — nao estourar "Unexpected end of JSON" por cima do erro real.
      let data: Record<string, unknown> | null = null;
      try { data = await res.json(); } catch { throw new Error(`Erro ${res.status} no servidor`); }
      if (!res.ok || !data?.ok) throw new Error(String(data?.erro || `HTTP ${res.status}`));
      setSnap(data as unknown as Snapshot);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Falha de conexão';
      setErro(msg);
      toastRef.current?.(msg, 'error');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /** Dispara o mesmo trabalho do cron, na hora. */
  const sincronizarBoletos = async () => {
    setSyncBoletos(true);
    try {
      const res = await fetch('/api/boletos-sync', { headers: { ...authHeaders() } });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.erro || 'Falha no sync');
      const motivo = data.motivo ? ` (${data.motivo})` : '';
      showToast?.(`Boletos: ${data.processadas ?? 0} consultado(s), ${data.baixadas ?? 0} baixado(s)${motivo}`);
      await carregar(true);
    } catch (e: unknown) {
      showToast?.(e instanceof Error ? e.message : 'Falha ao sincronizar boletos.', 'error');
    } finally {
      setSyncBoletos(false);
    }
  };

  const sincronizarNotas = async () => {
    setSyncNotas(true);
    try {
      const res = await fetch('/api/notas-sync', { headers: { ...authHeaders() } });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.erro || 'Falha no sync');
      showToast?.('Notas sincronizadas com a Focus.');
    } catch (e: unknown) {
      showToast?.(e instanceof Error ? e.message : 'Falha ao sincronizar notas.', 'error');
    } finally {
      setSyncNotas(false);
    }
  };

  const totalFilaBoletos = (snap?.filas.boletosUnicos || []).reduce((a, f) => a + f.total, 0);
  const totalFilaParcelas = (snap?.filas.parcelas || []).reduce((a, f) => a + f.total, 0);
  const inter7d = snap?.origem7d.find(o => o.origem === 'INTER');
  const cron7d = snap?.origem7d.find(o => o.origem === 'CRON');

  const chipConfig = (ok: boolean, nome: string, detalhe: string) => (
    <div className={`flex-1 min-w-[140px] rounded-2xl border p-3 ${ok ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
      <p className={`text-[9px] font-black uppercase ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>{ok ? 'OK' : 'ATENÇÃO'}</p>
      <p className="text-[11px] font-black text-gray-700 leading-tight mt-0.5">{nome}</p>
      <p className="text-[9px] font-bold text-gray-400 leading-snug mt-0.5">{detalhe}</p>
    </div>
  );

  return (
    <div className="space-y-4 pb-24">
      {/* ---------- CABEÇALHO ---------- */}
      <header className="px-1 flex justify-between items-center gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center shrink-0"><i className="fa-solid fa-arrows-rotate text-sm"></i></span>
          <div>
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Baixa Automática</h2>
            <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Contas a receber · Boletos · Pix</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* BLOCO 221: atalho para o LOG DE BAIXAS (tela limpa, por dia) */}
          {onAbrirLogBaixas && (
            <button
              onClick={onAbrirLogBaixas}
              className="bg-teal-600 text-white px-3 py-2.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
              title="Abrir o Log de Baixas"
            >
              <i className="fa-solid fa-clipboard-list"></i>Log
            </button>
          )}
          <button
            onClick={() => void carregar()}
            className="bg-white p-2.5 rounded-xl shadow-sm border border-gray-100 text-gray-500 active:scale-95 transition-all"
            title="Atualizar agora"
          >
            <i className={`fa-solid fa-rotate ${carregando ? 'fa-spin' : ''}`}></i>
          </button>
        </div>
      </header>

      {carregando && !snap && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-3xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {erro && !snap && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-[11px] font-bold text-rose-600">
          <i className="fa-solid fa-triangle-exclamation mr-1"></i>{erro} — toque no botão de atualizar para tentar de novo.
        </div>
      )}

      {snap && (
        <>
          {/* ---------- 1. COMO FUNCIONA + FREQUÊNCIA ---------- */}
          <section className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4 space-y-2">
            <h3 className="text-[11px] font-black text-gray-800 uppercase flex items-center gap-2"><i className="fa-solid fa-circle-info text-cyan-500"></i>Como a baixa acontece (5 vias)</h3>
            {[
              { ic: 'fa-bolt', nome: 'Webhook do Inter', via: 'TEMPO REAL — instantâneo', desc: 'O Inter avisa que o boleto/pix caiu, o app re-consulta o Inter e baixa sozinho na hora. Vai para Contas a Receber, Caixa e histórico da venda.', cor: 'bg-emerald-50 text-emerald-600' },
              { ic: 'fa-clock', nome: `Cron + auto-sync — ${snap.crons.boletosSync.rotulo}`, via: 'VÁRIAS VEZES POR DIA · 07:00 + de hora em hora', desc: 'Rede de segurança: se o aviso do Inter se perder, todo dia às 07:00 o app reconsulta os boletos abertos e baixa o que já pagou. E o AUTO-SYNC repete a rodada a cada 60 min enquanto o sistema é usado.', cor: 'bg-cyan-50 text-cyan-600' },
              { ic: 'fa-database', nome: 'Trigger do caixa (SQL)', via: 'TEMPO REAL — dentro do banco', desc: 'Venda à vista PAGO (dinheiro/pix) entra no caixa na hora. Venda vira PAGO por qualquer via: a linha do boleto no caixa "zera" sozinha.', cor: 'bg-teal-50 text-teal-600' },
              { ic: 'fa-mobile-alt', nome: 'Comprovante Pix do portal', via: 'MANUAL — revisão do admin', desc: 'Cliente manda o comprovante pelo portal; entra na fila "Comprovantes Pix" e a baixa acontece quando você confirma.', cor: 'bg-violet-50 text-violet-600' },
              { ic: 'fa-hand', nome: 'Baixa manual', via: 'MANUAL — admin/PDV', desc: 'Boleto pago fora do app (emitido direto no Internet Banking) não tem venda vinculada: baixa manual no Contas a Receber.', cor: 'bg-amber-50 text-amber-600' },
            ].map(v => (
              <div key={v.nome} className={`rounded-2xl ${v.cor.split(' ')[0]} p-3 flex gap-2.5`}>
                <span className={`w-8 h-8 rounded-xl bg-white flex items-center justify-center shrink-0 ${v.cor.split(' ')[1]}`}><i className={`fa-solid ${v.ic} text-xs`}></i></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-black text-gray-800">{v.nome}</p>
                  <p className="text-[9px] font-black uppercase tracking-wide text-gray-500 mt-0.5">{v.via}</p>
                  <p className="text-[9px] font-semibold text-gray-500 leading-snug mt-0.5">{v.desc}</p>
                </div>
              </div>
            ))}
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-[9px] font-bold text-slate-500 leading-snug">
              <i className="fa-solid fa-calendar-days mr-1 text-slate-400"></i>
              Frequência: boletos <b>{snap.crons.boletosSync.schedule}</b> = {snap.crons.boletosSync.rotulo} + <b>AUTO-SYNC a cada 60 min</b> enquanto o sistema é usado · notas fiscais <b>{snap.crons.notasSync.schedule}</b> = {snap.crons.notasSync.rotulo}.
            </div>
          </section>

          {/* ---------- 2. STATUS DA AUTOMAÇÃO ---------- */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-black text-gray-800 uppercase px-1 flex items-center gap-2"><i className="fa-solid fa-heart-pulse text-rose-500"></i>Status da automação</h3>
            <div className="flex flex-wrap gap-2">
              {chipConfig(snap.config.interConfigurado, 'Credenciais do Inter', snap.config.interConfigurado ? 'Webhook + sync ativos' : 'Configure INTER_CLIENT_ID/SECRET + certificado')}
              {chipConfig(snap.config.cronSecretPresente, 'CRON_SECRET na Vercel', snap.config.cronSecretPresente ? 'Cron diário autorizado' : 'Cron diário não vai autenticar')}
              {chipConfig(snap.config.schemaBoletosOk && snap.config.parcelasOk, 'Schema do banco', snap.config.schemaBoletosOk && snap.config.parcelasOk ? 'Boletos + parcelas prontos' : 'Rode os SQLs pendentes')}
            </div>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] font-black uppercase text-gray-400">Último evento do Inter (tempo real)</p>
                <p className="text-[13px] font-black text-gray-700 mt-0.5">{relativo(inter7d?.ultima || null)}</p>
                <p className="text-[9px] font-bold text-gray-400">{inter7d?.qtde || 0} evento(s) em 7 dias</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase text-gray-400">Último evento do Cron (07:00)</p>
                <p className="text-[13px] font-black text-gray-700 mt-0.5">{relativo(cron7d?.ultima || null)}</p>
                <p className="text-[9px] font-bold text-gray-400">{cron7d?.qtde || 0} evento(s) em 7 dias</p>
              </div>
            </div>
          </section>

          {/* ---------- 3. FILAS AGORA ---------- */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-black text-gray-800 uppercase px-1 flex items-center gap-2"><i className="fa-solid fa-list-check text-amber-500"></i>Filas agora (aguardando baixa)</h3>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4 space-y-3">
              <div>
                <p className="text-[10px] font-black text-gray-600 uppercase">Boletos de venda {totalFilaBoletos > 0 && <span className="text-amber-600">· {brl(totalFilaBoletos)} em aberto</span>}</p>
                {(snap.filas.boletosUnicos.length === 0) ? (
                  <p className="text-[10px] font-bold text-emerald-600 mt-1"><i className="fa-solid fa-circle-check mr-1"></i>Nenhum boleto aguardando — tudo em dia.</p>
                ) : snap.filas.boletosUnicos.map(f => (
                  <div key={f.status} className="flex justify-between items-center mt-1.5">
                    <span className="text-[10px] font-bold text-gray-500">{rotuloStatusBoleto(f.status)}</span>
                    <span className="text-[10px] font-black text-gray-700">{f.qtde} · {brl(f.total)}</span>
                  </div>
                ))}
              </div>
              {snap.filas.parcelas.length > 0 && (
                <div className="border-t border-gray-100 pt-2.5">
                  <p className="text-[10px] font-black text-gray-600 uppercase">Parcelas (boleto duplo R5) {totalFilaParcelas > 0 && <span className="text-amber-600">· {brl(totalFilaParcelas)}</span>}</p>
                  {snap.filas.parcelas.map(f => (
                    <div key={f.status} className="flex justify-between items-center mt-1.5">
                      <span className="text-[10px] font-bold text-gray-500">{rotuloStatusBoleto(f.status)}</span>
                      <span className="text-[10px] font-black text-gray-700">{f.qtde} · {brl(f.total)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-gray-100 pt-2.5 flex justify-between items-center">
                <p className="text-[10px] font-bold text-gray-500">Linhas BOLETO pendentes no caixa <span className="text-gray-300">(baixam sozinhas quando pagarem)</span></p>
                <span className="text-[10px] font-black text-gray-700">{snap.filas.caixaBoletosPendentes.qtde} · {brl(snap.filas.caixaBoletosPendentes.total)}</span>
              </div>
              <div className="border-t border-gray-100 pt-2.5 flex justify-between items-center">
                <p className="text-[10px] font-bold text-gray-500">Comprovantes Pix aguardando revisão {snap.filas.comprovantesPendentes.maisAntiga && <span className="text-rose-500">(mais antigo {relativo(snap.filas.comprovantesPendentes.maisAntiga)})</span>}</p>
                <span className="text-[10px] font-black text-gray-700">{snap.filas.comprovantesPendentes.qtde} · {brl(snap.filas.comprovantesPendentes.total)}</span>
              </div>
            </div>
            {/* Ações */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => void sincronizarBoletos()}
                disabled={syncBoletos}
                className="bg-cyan-600 text-white rounded-2xl py-3.5 px-4 text-[11px] font-black uppercase shadow-sm active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2 min-h-[44px]"
              >
                <i className={`fa-solid fa-arrows-rotate ${syncBoletos ? 'fa-spin' : ''}`}></i>{syncBoletos ? 'Sincronizando...' : 'Sincronizar boletos agora'}
              </button>
              <button
                onClick={() => void sincronizarNotas()}
                disabled={syncNotas}
                className="bg-white text-gray-600 border border-gray-200 rounded-2xl py-3.5 px-4 text-[11px] font-black uppercase shadow-sm active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2 min-h-[44px]"
              >
                <i className={`fa-solid fa-file-invoice ${syncNotas ? 'fa-spin' : ''}`}></i>{syncNotas ? 'Sincronizando...' : 'Sincronizar notas (Focus)'}
              </button>
            </div>
          </section>

          {/* ---------- 4. BAIXAS 30D POR ORIGEM ---------- */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-black text-gray-800 uppercase px-1 flex items-center gap-2"><i className="fa-solid fa-check-double text-emerald-500"></i>Baixas dos últimos 30 dias por origem</h3>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
              {snap.baixas30d.length === 0 ? (
                <p className="text-[10px] font-bold text-gray-400">Nenhuma baixa com origem marcada nos últimos 30 dias (o marcador existe desde o bloco 172).</p>
              ) : snap.baixas30d.map(b => {
                const r = rotuloOrigem(b.origem);
                return (
                  <div key={b.origem} className="flex items-center justify-between gap-2 py-2 border-b border-gray-50 last:border-0">
                    <div className="min-w-0">
                      <span className={`inline-block px-2 py-0.5 rounded-lg border text-[9px] font-black ${r.cor}`}>{r.nome}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] font-black text-gray-800">{b.qtde}</span>
                      <span className="text-[10px] font-bold text-gray-400"> · {brl(b.total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------- 5. ÚLTIMOS EVENTOS ---------- */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-black text-gray-800 uppercase px-1 flex items-center gap-2"><i className="fa-solid fa-scroll text-slate-500"></i>Últimos eventos do webhook e do cron</h3>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {snap.log.length === 0 ? (
                <p className="p-4 text-[10px] font-bold text-gray-400">Nenhum evento registrado ainda (o log existe desde o SQL 167).</p>
              ) : snap.log.map((ev, i) => (
                <div key={i} className="p-3 flex gap-2.5 items-start">
                  <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${ev.origem === 'CRON' ? 'bg-cyan-50 text-cyan-600' : ev.origem === 'FOCUS' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                    <i className={`fa-solid ${ev.origem === 'CRON' ? 'fa-clock' : ev.origem === 'FOCUS' ? 'fa-file-invoice' : 'fa-bolt'} text-[10px]`}></i>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] font-black uppercase text-gray-400">{ev.origem === 'CRON' ? 'CRON 07:00' : ev.origem}</span>
                      <span className="text-[9px] font-bold text-gray-300">{horaSp(ev.criado_em)}</span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md ${ev.processado ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{ev.processado ? 'OK' : 'NÃO PROC.'}</span>
                    </div>
                    <p className="text-[10px] font-semibold text-gray-600 leading-snug mt-0.5 break-words">{ev.resultado}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default ConciliacaoView;
