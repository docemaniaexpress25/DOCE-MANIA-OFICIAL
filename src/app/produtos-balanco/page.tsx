"use client";

/**
 * BLOCO 193 — PORTAL DE PRODUTOS (admin): o balanço do estoque fiscal.
 *   ENTRADAS COM NOTA  = XML de fornecedor (Portal de Entradas) já
 *                        confirmada no estoque (entrada_estoque_em).
 *   SAÍDAS COM NOTA    = vendas do app com NF (sales+sale_items) + XML
 *                        de nota de venda emitida FORA do app (terceiros)
 *                        — sobe aqui pelo botão "XML de SAÍDA".
 *   BALANÇO por produto + ALERTAS de produto que sai com nota e não tem
 *   entrada nenhuma (ou sai mais do que entrou).
 *
 * Auth: mesma sessão dos portais (PIN admin → /api/notas-admin AUTH).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

const fmt = (n: number): string => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (n: number): string => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataFmt = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

type BalancoLinha = {
  produtoId: string; nome: string; custoCad: number;
  entradaQtd: number; entradaCusto: number; entradaPendQtd: number;
  saidaQtd: number; saidaCusto: number; saidaVenda: number;
  saldoQtd: number; alerta: boolean;
};
type SemVinculo = { x_prod: string; c_ean: string; quantidade: number; valor_unitario: number; numero: string; emit: string; data: string | null };
type DadosApi = {
  ok: boolean; temDirecao: boolean;
  resumo: { totalEntradas: number; totalSaidas: number; saldoQtd: number; custoEntradas: number; custoSaidas: number; vendaSaidas: number; alertas: number; notasSaida: number; notasEntrada: number; notasSaidaXml: number };
  balanco: BalancoLinha[];
  semVinculoEntrada: SemVinculo[];
  semVinculoSaida: SemVinculo[];
};

export default function ProdutosBalancoPortal() {
  const [token, setToken] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  const [dados, setDados] = useState<DadosApi | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroLoad, setErroLoad] = useState('');
  const [aba, setAba] = useState<'BALANCO' | 'ENTRADAS' | 'SAIDAS'>('BALANCO');

  const [xmlMsg, setXmlMsg] = useState('');
  const [xmlBusy, setXmlBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) setToken(t);
      setNome(localStorage.getItem(NOME_KEY) || '');
    } catch { /* storage bloqueado */ }
  }, []);

  const headers = useCallback((t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }), []);

  const carregar = useCallback(async (t: string) => {
    setCarregando(true);
    setErroLoad('');
    try {
      const res = await fetch('/api/produtos-balanco', { headers: headers(t), cache: 'no-store' });
      if (res.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        setToken(null);
        setErroLoad('Sessão expirada. Entre com o PIN.');
        return;
      }
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErroLoad(String(d?.erro || `Erro ${res.status}`)); return; }
      setDados(d as DadosApi);
    } catch {
      setErroLoad('Sem conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, [headers]);

  useEffect(() => {
    if (token) void carregar(token);
  }, [token, carregar]);

  const entrarComPin = async () => {
    if (pinBusy) return;
    const p = pin.replace(/\D/g, '');
    if (p.length < 4) { setPinErro('Digite o PIN (4-8 dígitos).'); return; }
    setPinBusy(true);
    setPinErro('');
    try {
      const res = await fetch('/api/notas-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'AUTH', pin: p }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setPinErro(String(d?.erro || 'PIN incorreto. Tente novamente.')); setPin(''); return; }
      try {
        localStorage.setItem(TOKEN_KEY, d.token);
        localStorage.setItem(NOME_KEY, d.nome || '');
      } catch { /* ignore */ }
      setToken(d.token);
      setNome(d.nome || '');
      setPin('');
    } catch {
      setPinErro('Sem conexão com o servidor.');
    } finally {
      setPinBusy(false);
    }
  };

  const subirXmlSaida = async (files: FileList | null) => {
    if (!token || !files || files.length === 0) return;
    setXmlBusy(true);
    setXmlMsg('');
    try {
      const arquivos: { nome: string; conteudo: string }[] = [];
      for (const f of Array.from(files).slice(0, 30)) {
        arquivos.push({ nome: f.name, conteudo: await f.text() });
      }
      const res = await fetch('/api/xml-importacao', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ arquivos, direcao: 'SAIDA' }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setXmlMsg(String(d?.erro || `Erro ${res.status}`));
        return;
      }
      const r = d.resumo;
      setXmlMsg(`Importadas ${r.importadas}/${r.recebidos} notas de SAÍDA (${r.itens} itens, ${r.duplicadas} duplicadas)${r.erros?.length ? ` · ${r.erros.length} com erro` : ''}.`);
      void carregar(token);
    } catch {
      setXmlMsg('Falha lendo/subindo os XMLs.');
    } finally {
      setXmlBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ---------------- GATE (PIN) ----------------
  if (!token) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-[2rem] p-8 shadow-2xl">
          <div className="flex flex-col items-center gap-2 mb-6">
            <div className="w-16 h-16 rounded-3xl bg-amber-600 text-white flex items-center justify-center text-2xl shadow-lg"><i className="fa-solid fa-boxes-stacked"></i></div>
            <h1 className="text-lg font-black text-gray-800 tracking-tight">Portal de Produtos</h1>
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Balanço · entrada x saída com nota</p>
          </div>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => { if (e.key === 'Enter') void entrarComPin(); }}
            placeholder="PIN do administrador"
            inputMode="numeric"
            className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl font-black text-center text-xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-amber-100"
          />
          {pinErro && <p className="text-[10px] font-black text-rose-600 mt-2 text-center">{pinErro}</p>}
          <button onClick={() => void entrarComPin()} disabled={pinBusy} className="w-full mt-4 bg-amber-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest disabled:opacity-50">
            {pinBusy ? 'Verificando...' : 'Entrar'}
          </button>
          <p className="text-[9px] font-bold text-gray-400 mt-4 text-center leading-snug">Mesmo PIN do Portal Fiscal. Somente o administrador acessa.</p>
        </div>
      </main>
    );
  }

  const r = dados?.resumo;
  const dark = 'bg-slate-900/80 border border-slate-800';

  // ---------------- DASHBOARD ----------------
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 pb-16" style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}>
      {/* header */}
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0"><i className="fa-solid fa-boxes-stacked text-sm"></i></div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Portal de Produtos <span className="text-amber-300">· Balanço</span></h1>
            {nome && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{nome}</p>}
          </div>
        </div>
        <button onClick={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } setToken(null); setDados(null); }} className="text-slate-400 hover:text-slate-200 text-xs font-black uppercase px-3 py-2 rounded-xl border border-slate-700">Sair</button>
      </div>

      <div className="p-3 space-y-3 max-w-3xl mx-auto">
        {carregando && <span className="text-[10px] font-black text-amber-400 uppercase animate-pulse">Carregando...</span>}
        {erroLoad && <div className="rounded-2xl bg-rose-950/60 border border-rose-900 text-rose-200 text-[10px] font-bold px-4 py-3">{erroLoad}</div>}

        {/* resumo */}
        <section className={`rounded-3xl p-4 ${dark}`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3"><i className="fa-solid fa-scale-balanced mr-1.5 text-amber-400"></i>Balanço geral — com nota</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Entradas (XML fornecedor)</p>
              <p className="text-lg font-black text-emerald-400">{r ? `${qtd(r.totalEntradas)} un` : '—'}</p>
              {r && <p className="text-[8px] font-bold text-slate-500 mt-0.5">{fmt(r.custoEntradas)} em custo · {r.notasEntrada} notas</p>}
            </div>
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Saídas com nota</p>
              <p className="text-lg font-black text-rose-400">{r ? `${qtd(r.totalSaidas)} un` : '—'}</p>
              {r && <p className="text-[8px] font-bold text-slate-500 mt-0.5">{fmt(r.vendaSaidas)} em venda · {r.notasSaida} NF do app{r.notasSaidaXml > 0 ? ` + ${r.notasSaidaXml} XML 3º` : ''}</p>}
            </div>
            <div className="rounded-2xl bg-slate-800/60 p-3">
              <p className="text-[8px] font-black uppercase text-slate-500">Saldo (entrada − saída)</p>
              <p className={`text-lg font-black ${(r?.saldoQtd ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r ? `${qtd(r.saldoQtd)} un` : '—'}</p>
            </div>
            <div className={`rounded-2xl p-3 border ${(r?.alertas ?? 0) > 0 ? 'bg-rose-950/60 border-rose-900' : 'bg-slate-800/60 border-transparent'}`}>
              <p className="text-[8px] font-black uppercase text-slate-500">Alertas</p>
              <p className={`text-lg font-black ${(r?.alertas ?? 0) > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-300'}`}>{r ? r.alertas : '—'}</p>
              {r && <p className="text-[8px] font-bold text-slate-500 mt-0.5">produtos que saíram sem entrada</p>}
            </div>
          </div>
        </section>

        {/* upload XML de saída (terceiros) */}
        <section className={`rounded-3xl p-4 ${dark} space-y-2`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400"><i className="fa-solid fa-file-export mr-1.5 text-amber-400"></i>XML de SAÍDA de terceiros (nota emitida fora do app)</p>
          <p className="text-[8px] font-bold text-slate-500 leading-snug">Sobe o XML da nota de venda emitida fora do app — os itens contam como SAÍDA no balanço (vinculados por EAN/código no Portal de Entradas). Não mexe no estoque.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.zip,text/xml,application/xml,application/zip"
            multiple
            onChange={(e) => void subirXmlSaida(e.target.files)}
            className="hidden"
            aria-label="Selecionar XMLs de saída"
          />
          <button onClick={() => fileRef.current?.click()} disabled={xmlBusy} className="w-full bg-amber-600 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest active:scale-95 disabled:opacity-40">
            {xmlBusy ? 'Subindo...' : 'Selecionar XMLs de saída'}
          </button>
          {xmlMsg && <p className="rounded-xl bg-slate-800/60 border border-slate-700 text-slate-300 text-[9px] font-bold px-3 py-2">{xmlMsg}</p>}
        </section>

        {/* abas */}
        <div className="flex items-center gap-1.5">
          {([['BALANCO', 'Balanço'], ['ENTRADAS', 'Entradas'], ['SAIDAS', 'Saídas']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setAba(id)} className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-all ${aba === id ? 'bg-amber-600 text-white border-amber-500' : `${dark} text-slate-400`}`}>{label}</button>
          ))}
        </div>

        {/* BALANÇO por produto */}
        {aba === 'BALANCO' && (
          <section className={`rounded-3xl p-4 ${dark}`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-list-check mr-1.5 text-amber-400"></i>Balanço por produto (entradas confirmadas − saídas)</p>
            <div className="space-y-1.5 max-h-[32rem] overflow-y-auto">
              {(dados?.balanco || []).map((b) => (
                <div key={b.produtoId} className={`rounded-xl px-3 py-2 ${b.alerta ? 'bg-rose-950/50 border border-rose-900' : 'bg-slate-800/50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black text-slate-200 uppercase truncate">{b.alerta && <i className="fa-solid fa-triangle-exclamation text-rose-400 mr-1"></i>}{b.nome}</p>
                    <p className={`text-[10px] font-black shrink-0 ${b.saldoQtd < 0 ? 'text-rose-400' : 'text-slate-200'}`}>{qtd(b.saldoQtd)} un</p>
                  </div>
                  <p className="text-[8px] font-bold text-slate-500 mt-0.5">
                    Entrou {qtd(b.entradaQtd)}{b.entradaPendQtd > 0 ? ` (+${qtd(b.entradaPendQtd)} pendente)` : ''} · Saiu {qtd(b.saidaQtd)} · custo ent {fmt(b.entradaCusto)} / saiu {fmt(b.saidaCusto)} · venda {fmt(b.saidaVenda)}
                  </p>
                  {b.alerta && <p className="text-[8px] font-black text-rose-300 mt-0.5">{b.entradaQtd === 0 ? 'SAÍDA SEM ENTRADA NENHUMA — conferir nota de compra' : 'SAIU MAIS DO QUE ENTROU — conferir estoque/notas'}</p>}
                </div>
              ))}
              {(dados?.balanco || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-6">Sem movimentação com nota ainda.</p>}
            </div>
          </section>
        )}

        {/* ENTRADAS sem vínculo */}
        {aba === 'ENTRADAS' && (
          <section className={`rounded-3xl p-4 ${dark}`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-file-import mr-1.5 text-emerald-400"></i>Itens de XML de entrada SEM produto vinculado ({(dados?.semVinculoEntrada || []).length})</p>
            <p className="text-[8px] font-bold text-slate-500 mb-2">Vincule no Portal de Entradas para entrarem no balanço.</p>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {(dados?.semVinculoEntrada || []).map((s, k) => (
                <div key={k} className="rounded-xl bg-slate-800/50 px-3 py-2">
                  <p className="text-[10px] font-black text-slate-200 uppercase truncate">{s.x_prod}</p>
                  <p className="text-[8px] font-bold text-slate-500">NF {s.numero} · {s.emit} · {dataFmt(s.data)} · {qtd(s.quantidade)} × {fmt(s.valor_unitario)}{s.c_ean ? ` · EAN ${s.c_ean}` : ''}</p>
                </div>
              ))}
              {(dados?.semVinculoEntrada || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-6">Tudo vinculado — nenhuma pendência.</p>}
            </div>
          </section>
        )}

        {/* SAÍDAS sem vínculo */}
        {aba === 'SAIDAS' && (
          <section className={`rounded-3xl p-4 ${dark}`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-file-export mr-1.5 text-rose-400"></i>Itens de XML de SAÍDA sem produto vinculado ({(dados?.semVinculoSaida || []).length})</p>
            <p className="text-[8px] font-bold text-slate-500 mb-2">Sem vínculo não entra na conta por produto — vincule pelo EAN/código no Portal de Entradas.</p>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {(dados?.semVinculoSaida || []).map((s, k) => (
                <div key={k} className="rounded-xl bg-slate-800/50 px-3 py-2">
                  <p className="text-[10px] font-black text-slate-200 uppercase truncate">{s.x_prod}</p>
                  <p className="text-[8px] font-bold text-slate-500">NF {s.numero} · {s.emit} · {dataFmt(s.data)} · {qtd(s.quantidade)} × {fmt(s.valor_unitario)}{s.c_ean ? ` · EAN ${s.c_ean}` : ''}</p>
                </div>
              ))}
              {(dados?.semVinculoSaida || []).length === 0 && !carregando && <p className="text-[10px] font-bold text-slate-500 text-center py-6">Nada pendente de vínculo na saída.</p>}
            </div>
          </section>
        )}

        <p className="text-[8px] font-bold text-slate-600 text-center leading-snug px-2">Portal de Produtos · balanço entrada x saída · sql/bloco193_xml_direcao.sql · Doce Mania</p>
      </div>
    </main>
  );
}
