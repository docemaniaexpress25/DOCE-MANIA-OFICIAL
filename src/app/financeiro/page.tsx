"use client";

/**
 * BLOCO 191 — PORTAL FINANCEIRO (admin): o balanço geral da empresa.
 * Entradas (faturamento por método), saídas (despesas dos vendedores,
 * comissões pagas, custos lançados), logs (repasses + fechamentos de
 * caixa) e o saldo do período. Custo é lançado aqui.
 *
 * Auth: MESMA sessão dos portais — POST /api/notas-admin {acao:'AUTH'}
 * (PIN do admin, token em dm_notas_admin_token). Dados: /api/financeiro.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import PortalPinGate from '@/components/doce/PortalPinGate';

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

type Periodo = 'HOJE' | '7D' | '30D' | 'TUDO';

const PERIODOS: { id: Periodo; label: string; icon: string }[] = [
  { id: 'HOJE', label: 'Hoje', icon: 'fa-calendar-day' },
  { id: '7D', label: '7 dias', icon: 'fa-calendar-week' },
  { id: '30D', label: '30 dias', icon: 'fa-calendar' },
  { id: 'TUDO', label: 'Tudo', icon: 'fa-infinity' },
];
// BLOCO 213: ícone das abas do portal (nenhuma aba só com texto)
const ABA_ICON: Record<string, string> = { BALANCO: 'fa-receipt', CUSTOS: 'fa-tags', LOGS: 'fa-clipboard-list' };

const CATEGORIAS = ['MERCADORIA', 'FRETE', 'ALUGUEL', 'ENERGIA', 'AGUA', 'INTERNET', 'SALARIOS', 'IMPOSTOS', 'MANUTENCAO', 'OUTROS'];

const fmt = (n: number): string => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataFmt = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

type ResumoApi = {
  ok: boolean;
  periodo: Periodo;
  temCustos: boolean;
  resumo: {
    faturado: number; recebido: number; aReceber: number;
    recebidoDinheiro: number; recebidoPix: number; recebidoBoleto: number;
    totalDespesas: number; totalComissoes: number; totalCustos: number;
    saidasTotal: number; saldo: number; qtdeVendas: number;
  };
  ultimasVendas: { id: string; data: string; cliente: string; vendedor: string; valor: number; recebido: number; metodo: string; prazo: boolean; naFila: boolean; nota: string | null }[];
  despesas: { id: string; descricao: string; valor: number; data: string; vendedor: string }[];
  repasses: { id: string; valor: number; data: string; vendedor: string; obs: string; aceitado: boolean }[];
  custos: { id: string; descricao: string; categoria: string; valor: number; data: string }[];
  caixa: { id: string; data: string; nome: string; dinheiro: number; pix: number; deposito: number; total: number; qtde: number }[];
};

export default function FinanceiroPortal() {
  const [token, setToken] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  // BLOCO 206: tela de login ÚNICA dos portais (teclado numérico + shake)
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chacoalha = () => {
    setPinShake(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setPinShake(false), 520);
  };
  const digitar = (d: string) => {
    setPinErro('');
    const proximo = (pin + d).slice(0, 8);
    setPin(proximo);
    if (proximo.length === 6) void entrarComPin(proximo); // auto-entra no 6º dígito
  };
  const apagar = () => { setPinErro(''); setPin((p) => p.slice(0, -1)); };

  const [periodo, setPeriodo] = useState<Periodo>('30D');
  const [dados, setDados] = useState<ResumoApi | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroLoad, setErroLoad] = useState('');

  const [custoDesc, setCustoDesc] = useState('');
  const [custoCat, setCustoCat] = useState('MERCADORIA');
  const [custoVal, setCustoVal] = useState('');
  const [custoBusy, setCustoBusy] = useState(false);
  const [aba, setAba] = useState<'BALANCO' | 'CUSTOS' | 'LOGS'>('BALANCO');

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) setToken(t);
      setNome(localStorage.getItem(NOME_KEY) || '');
    } catch { /* storage bloqueado */ }
  }, []);

  const headers = useCallback((t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }), []);

  const carregarResumo = useCallback(async (t: string, p: Periodo) => {
    setCarregando(true);
    setErroLoad('');
    try {
      const res = await fetch('/api/financeiro', {
        method: 'POST',
        headers: headers(t),
        body: JSON.stringify({ acao: 'RESUMO', periodo: p }),
      });
      if (res.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        setToken(null);
        setErroLoad('Sessão expirada. Entre com o PIN.');
        return;
      }
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErroLoad(String(d?.erro || `Erro ${res.status}`));
        return;
      }
      setDados(d as ResumoApi);
    } catch {
      setErroLoad('Sem conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, [headers]);

  useEffect(() => {
    if (token) void carregarResumo(token, periodo);
  }, [token, periodo, carregarResumo]);

  const entrarComPin = async (pinFinal?: string) => {
    if (pinBusy) return;
    const p = (pinFinal ?? pin).replace(/\D/g, '');
    if (p.length < 4) { setPinErro('Digite o PIN (4-8 dígitos).'); chacoalha(); return; }
    setPinBusy(true);
    setPinErro('');
    try {
      const res = await fetch('/api/notas-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'AUTH', pin: p }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setPinErro(String(d?.erro || 'PIN incorreto. Tente novamente.'));
        chacoalha();
        setPin('');
        return;
      }
      try {
        localStorage.setItem(TOKEN_KEY, d.token);
        localStorage.setItem(NOME_KEY, d.nome || '');
      } catch { /* storage bloqueado */ }
      setToken(d.token);
      setNome(d.nome || '');
      setPin('');
    } catch {
      setPinErro('Sem conexão com o servidor.');
      chacoalha();
    } finally {
      setPinBusy(false);
    }
  };

  const lancarCusto = async () => {
    if (!token || custoBusy) return;
    const val = parseFloat(custoVal.replace(',', '.'));
    if (!custoDesc.trim()) { setErroLoad('Informe a descrição do custo.'); return; }
    if (!(val > 0)) { setErroLoad('Informe um valor maior que zero.'); return; }
    setCustoBusy(true);
    setErroLoad('');
    try {
      const res = await fetch('/api/financeiro', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'ADD_CUSTO', descricao: custoDesc.trim(), categoria: custoCat, valor: val }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErroLoad(String(d?.erro || `Erro ${res.status}`));
        return;
      }
      setCustoDesc('');
      setCustoVal('');
      void carregarResumo(token, periodo);
    } catch {
      setErroLoad('Sem conexão ao lançar o custo.');
    } finally {
      setCustoBusy(false);
    }
  };

  const removerCusto = async (id: string) => {
    if (!token) return;
    try {
      await fetch('/api/financeiro', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'DEL_CUSTO', id }),
      });
      void carregarResumo(token, periodo);
    } catch { /* silencioso */ }
  };

  // ---------------- GATE (PIN) — BLOCO 206: tela ÚNICA dos portais ----------------
  if (!token) {
    return (
      <PortalPinGate
        titulo="Portal Financeiro"
        subtitulo="Balanço geral · custos · logs"
        icone="fa-file-invoice-dollar"
        accent="bg-emerald-600"
        pin={pin}
        pinErro={pinErro}
        pinBusy={pinBusy}
        pinShake={pinShake}
        onDigito={digitar}
        onApagar={apagar}
        onEntrar={() => void entrarComPin()}
      />
    );
  }

  const r = dados?.resumo;
  const dark = 'bg-slate-900/80 border border-slate-800';

  // ---------------- DASHBOARD ----------------
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 pb-16 flex flex-col" style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}>
      {/* header */}
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0"><i className="fa-solid fa-file-invoice-dollar text-sm"></i></div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Portal Financeiro <span className="text-emerald-300">· Balanço</span></h1>
            {nome && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{nome}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* BLOCO 205 (otimização dos portais): botão ATUALIZAR explícito no header */}
          <button onClick={() => token && void carregarResumo(token, periodo)} disabled={carregando} className="text-slate-300 hover:text-white text-[10px] font-black uppercase px-3 py-2 rounded-xl border border-slate-700 disabled:opacity-50" title="Recarregar o balanço">
            <i className={`fa-solid ${carregando ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1`}></i>Atualizar
          </button>
          <button onClick={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } setToken(null); setDados(null); }} className="text-slate-400 hover:text-slate-200 text-xs font-black uppercase px-3 py-2 rounded-xl border border-slate-700 flex items-center gap-1.5"><i className="fa-solid fa-arrow-right-from-bracket"></i>Sair</button>
        </div>
      </div>

      <div className="p-3 space-y-3 max-w-3xl mx-auto w-full flex-1">
        {/* período */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {PERIODOS.map((p) => (
            <button key={p.id} onClick={() => setPeriodo(p.id)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide whitespace-nowrap border transition-all flex items-center gap-1.5 ${periodo === p.id ? 'bg-emerald-600 text-white border-emerald-500' : `${dark} text-slate-400`}`}><i className={`fa-solid ${p.icon} text-[9px] ${periodo === p.id ? 'opacity-90' : 'opacity-50'}`}></i>{p.label}</button>
          ))}
          {carregando && <span className="text-[10px] font-black text-emerald-400 uppercase ml-1 animate-pulse">Carregando...</span>}
        </div>

        {erroLoad && (
          <div className="rounded-2xl bg-rose-950/60 border border-rose-900 text-rose-200 text-[10px] font-bold px-4 py-3">{erroLoad}</div>
        )}

        {/* resumo do balanço */}
        <section className={`rounded-3xl p-4 ${dark}`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3"><i className="fa-solid fa-scale-balanced mr-1.5 text-emerald-400"></i>Balanço geral — {PERIODOS.find(p => p.id === periodo)?.label}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Recebido (dinheiro em conta)</p>
              <p className="text-lg font-black text-emerald-400">{r ? fmt(r.recebido) : '—'}</p>
              {r && <p className="text-[8px] font-bold text-slate-500 mt-0.5">Dinheiro {fmt(r.recebidoDinheiro)} · Pix {fmt(r.recebidoPix)} · Boleto {fmt(r.recebidoBoleto)}</p>}
            </div>
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Saídas do período</p>
              <p className="text-lg font-black text-rose-400">{r ? fmt(r.saidasTotal) : '—'}</p>
              {r && <p className="text-[8px] font-bold text-slate-500 mt-0.5">Despesas {fmt(r.totalDespesas)} · Comissões {fmt(r.totalComissoes)} · Custos {fmt(r.totalCustos)}</p>}
            </div>
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Saldo (recebido − saídas)</p>
              <p className={`text-lg font-black ${(r?.saldo ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r ? fmt(r.saldo) : '—'}</p>
            </div>
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Faturado / A receber</p>
              <p className="text-base font-black text-slate-200">{r ? fmt(r.faturado) : '—'}</p>
              {r && <p className="text-[8px] font-bold text-amber-400 mt-0.5">A receber: {fmt(r.aReceber)} · {r.qtdeVendas} vendas</p>}
            </div>
          </div>
        </section>

        {/* abas */}
        <div className="flex items-center gap-1.5">
          {([['BALANCO', 'Vendas'], ['CUSTOS', 'Custos'], ['LOGS', 'Logs']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setAba(id)} className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-all flex items-center justify-center gap-1.5 ${aba === id ? 'bg-emerald-600 text-white border-emerald-500' : `${dark} text-slate-400`}`}><i className={`fa-solid ${ABA_ICON[id]} text-[9px] ${aba === id ? 'opacity-90' : 'opacity-50'}`}></i>{label}</button>
          ))}
        </div>

        {/* ABA BALANCO: últimas vendas */}
        {aba === 'BALANCO' && (
          <section className={`rounded-3xl p-4 ${dark}`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-receipt mr-1.5 text-emerald-400"></i>Vendas do período (últimas 40)</p>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {(dados?.ultimasVendas || []).map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-slate-200 uppercase truncate">{v.cliente}{v.nota ? <span className="text-emerald-400 font-black"> · NF {v.nota}</span> : ''}</p>
                    <p className="text-[8px] font-bold text-slate-500">{dataFmt(v.data)} · {v.vendedor}{v.prazo ? ' · A PRAZO' : ''}{v.naFila ? ' · NA FILA' : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-black text-slate-200">{fmt(v.valor)}</p>
                    {v.prazo && <p className="text-[8px] font-bold text-emerald-400">recebido {fmt(v.recebido)}</p>}
                  </div>
                </div>
              ))}
              {(dados?.ultimasVendas || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-6">Nenhuma venda no período.</p>}
            </div>
          </section>
        )}

        {/* ABA CUSTOS: lançar + lista */}
        {aba === 'CUSTOS' && (
          <>
            <section className={`rounded-3xl p-4 ${dark} space-y-2`}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400"><i className="fa-solid fa-circle-plus mr-1.5 text-emerald-400"></i>Lançar custo da empresa</p>
              {!dados?.temCustos && (
                <p className="rounded-xl bg-amber-950/60 border border-amber-900 text-amber-200 text-[9px] font-bold px-3 py-2">SQL pendente: rode sql/bloco191_financeiro.sql no Supabase para lançar custos.</p>
              )}
              <input value={custoDesc} onChange={(e) => setCustoDesc(e.target.value)} placeholder="Descrição (ex: compra de mercadoria, frete...)" className="w-full p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-[11px] font-bold text-slate-100 outline-none focus:ring-2 focus:ring-emerald-900" />
              <div className="grid grid-cols-2 gap-2">
                <select value={custoCat} onChange={(e) => setCustoCat(e.target.value)} className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-[10px] font-bold text-slate-100 outline-none">
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={custoVal} onChange={(e) => setCustoVal(e.target.value)} placeholder="Valor (R$)" inputMode="decimal" className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-[11px] font-black text-slate-100 outline-none" />
              </div>
              <button onClick={() => void lancarCusto()} disabled={custoBusy || !dados?.temCustos} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest active:scale-95 disabled:opacity-40">
                {custoBusy ? 'Lançando...' : 'Lançar custo (entra como SAÍDA)'}
              </button>
            </section>
            <section className={`rounded-3xl p-4 ${dark}`}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-list mr-1.5 text-emerald-400"></i>Custos lançados ({(dados?.custos || []).length})</p>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {(dados?.custos || []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-slate-200 uppercase truncate">{c.descricao}</p>
                      <p className="text-[8px] font-bold text-slate-500">{dataFmt(c.data)} · {c.categoria}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-[10px] font-black text-rose-400">{fmt(c.valor)}</p>
                      <button onClick={() => void removerCusto(c.id)} className="w-7 h-7 rounded-lg bg-rose-950/60 border border-rose-900 text-rose-300 flex items-center justify-center" aria-label={`Remover ${c.descricao}`}><i className="fa-solid fa-trash text-[9px]"></i></button>
                    </div>
                  </div>
                ))}
                {(dados?.custos || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-6">Nenhum custo lançado no período.</p>}
              </div>
            </section>
            <section className={`rounded-3xl p-4 ${dark}`}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-person-walking-luggage mr-1.5 text-rose-400"></i>Despesas dos vendedores ({fmt(r?.totalDespesas ?? 0)})</p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(dados?.despesas || []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/50 px-3 py-2">
                    <div className="min-w-0"><p className="text-[10px] font-black text-slate-200 uppercase truncate">{d.descricao}</p><p className="text-[8px] font-bold text-slate-500">{dataFmt(d.data)} · {d.vendedor}</p></div>
                    <p className="text-[10px] font-black text-rose-400 shrink-0">{fmt(d.valor)}</p>
                  </div>
                ))}
                {(dados?.despesas || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-4">Sem despesas no período.</p>}
              </div>
            </section>
          </>
        )}

        {/* ABA LOGS: repasses + caixa */}
        {aba === 'LOGS' && (
          <>
            <section className={`rounded-3xl p-4 ${dark}`}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-coins mr-1.5 text-amber-400"></i>Comissões pagas — repasses ({fmt(r?.totalComissoes ?? 0)})</p>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {(dados?.repasses || []).map((r2) => (
                  <div key={r2.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-slate-200 uppercase truncate">{r2.vendedor} {!r2.aceitado && <span className="text-amber-400 font-black">· recibo pendente</span>}</p>
                      <p className="text-[8px] font-bold text-slate-500">{dataFmt(r2.data)}{r2.obs ? ` · ${r2.obs}` : ''}</p>
                    </div>
                    <p className="text-[10px] font-black text-amber-400 shrink-0">{fmt(r2.valor)}</p>
                  </div>
                ))}
                {(dados?.repasses || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-4">Nenhum repasse no período.</p>}
              </div>
            </section>
            <section className={`rounded-3xl p-4 ${dark}`}>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-cash-register mr-1.5 text-emerald-400"></i>Fechamentos de caixa (últimos)</p>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {(dados?.caixa || []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-800/50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-slate-200 uppercase truncate">{c.nome || 'Caixa'}</p>
                      <p className="text-[8px] font-bold text-slate-500">{dataFmt(c.data)} · Dinheiro {fmt(c.dinheiro)} · Pix {fmt(c.pix)}{c.deposito > 0 ? ` · Dep ${fmt(c.deposito)}` : ''}</p>
                    </div>
                    <p className="text-[10px] font-black text-emerald-400 shrink-0">{fmt(c.total)}</p>
                  </div>
                ))}
                {(dados?.caixa || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-4">Nenhum fechamento ainda.</p>}
              </div>
            </section>
          </>
        )}

        {/* BLOCO 205 (otimização dos portais): footer colado no fim da página */}
        <p className="text-[8px] font-bold text-slate-600 text-center leading-snug px-2 mt-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>Portal Financeiro · custos em sql/bloco191_financeiro.sql · Doce Mania</p>
      </div>
    </main>
  );
}
