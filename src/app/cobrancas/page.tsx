"use client";

/**
 * BLOCO 205 — PORTAL DE COBRANCAS (admin): boletos ATRASADOS do Banco Inter.
 *
 * A lista vem da API DO INTER (colecao /cobranca/v3/cobrancas via
 * /api/cobrancas) — cruzada com o cadastro para nome e telefone do cliente.
 * Cada boleto tem o botao COBRAR que monta a MENSAGEM PERSONALIZADA de
 * cobrança (placeholders {nome} {valor} {vencimento} {dias}) e envia por
 * WhatsApp (wa.me) ou copia. A mensagem é editável AQUI e também no Hub de
 * Configurações (mesma chave erp_config.cobrancaMensagem).
 *
 * Auth: MESMA sessão dos portais — POST /api/notas-admin {acao:'AUTH'}
 * (PIN do admin, token em dm_notas_admin_token). Cache do servidor: 60s.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PortalPinGate from '@/components/doce/PortalPinGate';

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

type BoletoAtrasado = {
  codigo: string;
  seuNumero: string;
  situacao: string;
  vencimento: string;
  vencimentoFmt: string;
  valor: number;
  diasAtraso: number;
  cliente: string;
  telefone: string;
  saleId: string | null;
  parcela: number | null;
};

type DadosApi = {
  ok: boolean;
  erro?: string;
  interConfigurado: boolean;
  mensagem: string;
  mensagemPadrao: string;
  atrasados: BoletoAtrasado[];
  totalAtrasado: number;
  consultadoEm?: string;
};

const PLACEHOLDERS = ['{nome}', '{valor}', '{vencimento}', '{dias}'];

const fmt = (n: number): string => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Monta a mensagem do boleto substituindo os placeholders. */
function montarMensagem(tpl: string, b: BoletoAtrasado): string {
  return String(tpl || '')
    .replaceAll('{nome}', b.cliente)
    .replaceAll('{valor}', fmt(b.valor))
    .replaceAll('{vencimento}', b.vencimentoFmt)
    .replaceAll('{dias}', String(b.diasAtraso));
}

export default function CobrancasPortal() {
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

  const [dados, setDados] = useState<DadosApi | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroLoad, setErroLoad] = useState('');

  // mensagem (visualização por boleto)
  const [msgBoleto, setMsgBoleto] = useState<BoletoAtrasado | null>(null);
  const [copiado, setCopiado] = useState(false);

  // editor da mensagem personalizada (abre no portal — mesma chave das Configurações)
  const [editorAberto, setEditorAberto] = useState(false);
  const [msgInput, setMsgInput] = useState('');
  const [msgSalvando, setMsgSalvando] = useState(false);
  const [msgOk, setMsgOk] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) setToken(t);
      setNome(localStorage.getItem(NOME_KEY) || '');
    } catch { /* storage bloqueado */ }
  }, []);

  const headers = useCallback((t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }), []);

  const carregar = useCallback(async (t: string, forcar = false) => {
    setCarregando(true);
    setErroLoad('');
    try {
      const res = await fetch(`/api/cobrancas${forcar ? '?forcar=1' : ''}`, { headers: headers(t) });
      if (res.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        setToken(null);
        setErroLoad('Sessão expirada. Entre com o PIN.');
        return;
      }
      const d = await res.json().catch(() => null);
      if (!d) { setErroLoad(`Erro ${res.status}`); return; }
      if (!d.ok && d.erro) setErroLoad(String(d.erro));
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

  const abrirEditor = () => {
    setMsgInput(dados?.mensagem || '');
    setMsgOk('');
    setEditorAberto(true);
  };

  const salvarMensagem = async () => {
    if (!token || msgSalvando) return;
    const texto = msgInput.trim();
    if (!texto) { setMsgOk('A mensagem não pode ficar vazia.'); return; }
    setMsgSalvando(true);
    setMsgOk('');
    try {
      const res = await fetch('/api/cobrancas', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'MENSAGEM', texto }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setMsgOk(String(d?.erro || `Erro ${res.status}`));
        return;
      }
      setDados((prev) => (prev ? { ...prev, mensagem: String(d.mensagem || texto) } : prev));
      setMsgOk('Mensagem salva! Já vale para TODOS os boletos cobrados.');
      setTimeout(() => setEditorAberto(false), 900);
    } catch {
      setMsgOk('Sem conexão ao salvar a mensagem.');
    } finally {
      setMsgSalvando(false);
    }
  };

  /** Insere o placeholder na posição do cursor (chips do editor). */
  const inserirPlaceholder = (ph: string) => {
    const ta = taRef.current;
    if (!ta) { setMsgInput((v) => v + ph); return; }
    const ini = ta.selectionStart ?? msgInput.length;
    const fim = ta.selectionEnd ?? msgInput.length;
    const novo = msgInput.slice(0, ini) + ph + msgInput.slice(fim);
    setMsgInput(novo);
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ini + ph.length;
    }, 0);
  };

  const copiarMensagem = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // fallback (navegadores antigos)
      const ta = document.createElement('textarea');
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* segue */ }
      document.body.removeChild(ta);
    }
  };

  const abrirWhatsApp = (b: BoletoAtrasado, msg: string) => {
    if (!b.telefone) return;
    const url = `https://wa.me/${b.telefone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const atrasadosOrdenados = useMemo(() => {
    const a = [...(dados?.atrasados || [])];
    // mais antigos primeiro (quem deve há mais tempo aparece em cima)
    a.sort((x, y) => (x.vencimento < y.vencimento ? -1 : x.vencimento > y.vencimento ? 1 : 0));
    return a;
  }, [dados]);

  const r = dados;
  const dark = 'bg-slate-900/80 border border-slate-800';

  // ---------------- GATE (PIN) — BLOCO 206: tela ÚNICA dos portais ----------------
  if (!token) {
    return (
      <PortalPinGate
        titulo="Portal de Cobranças"
        subtitulo="Boletos atrasados · Inter"
        icone="fa-bell-dollar"
        accent="bg-rose-600"
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

  // ---------------- DASHBOARD ----------------
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-950 pb-16 flex flex-col" style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}>
      {/* header */}
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0"><i className="fa-solid fa-bell-dollar text-sm"></i></div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Portal de Cobranças <span className="text-rose-300">· Atrasados</span></h1>
            {nome && <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{nome}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => void carregar(token, true)} disabled={carregando} className="text-slate-300 hover:text-white text-[10px] font-black uppercase px-3 py-2 rounded-xl border border-slate-700 disabled:opacity-50" title="Buscar de novo no Inter (sem cache)">
            <i className={`fa-solid ${carregando ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1`}></i>Atualizar
          </button>
          <button onClick={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } setToken(null); setDados(null); }} className="text-slate-400 hover:text-slate-200 text-xs font-black uppercase px-3 py-2 rounded-xl border border-slate-700">Sair</button>
        </div>
      </div>

      <div className="p-3 space-y-3 max-w-3xl mx-auto w-full flex-1">
        {/* Inter não configurado */}
        {dados && !dados.interConfigurado && (
          <div className="rounded-2xl bg-amber-950/60 border border-amber-900 text-amber-200 text-[10px] font-bold px-4 py-3 leading-snug">
            <p className="font-black uppercase text-[11px] mb-1"><i className="fa-solid fa-triangle-exclamation mr-1.5"></i>API do Inter não configurada</p>
            Para buscar os boletos atrasados, cadastre na Vercel as variáveis <span className="font-mono">INTER_CLIENT_ID</span>, <span className="font-mono">INTER_CLIENT_SECRET</span>, <span className="font-mono">INTER_CERT</span> + <span className="font-mono">INTER_KEY</span> (ou <span className="font-mono">INTER_P12</span> + <span className="font-mono">INTER_P12_SENHA</span>). Depois clique em Atualizar.
          </div>
        )}

        {erroLoad && (
          <div className="rounded-2xl bg-rose-950/60 border border-rose-900 text-rose-200 text-[10px] font-bold px-4 py-3">{erroLoad}</div>
        )}

        {/* hero: total atrasado */}
        <section className={`rounded-3xl p-4 ${dark}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400"><i className="fa-solid fa-bell-dollar mr-1.5 text-rose-400"></i>Boletos atrasados (API do Inter)</p>
            {dados?.consultadoEm && (
              <span className="text-[8px] font-bold text-slate-500 whitespace-nowrap">consulta {new Date(dados.consultadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
          <p className="text-3xl font-black text-rose-400 tracking-tight mt-2">{r ? fmt(r.totalAtrasado) : '—'}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{r ? `${atrasadosOrdenados.length} boleto(s) vencido(s) — mais antigo no topo` : ''}</p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={abrirEditor} className="bg-slate-800 border border-slate-700 text-slate-200 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wide active:scale-95 transition-transform flex items-center gap-1.5">
              <i className="fa-solid fa-pen-to-square text-[9px] text-rose-400"></i>Mensagem de cobrança
            </button>
            <span className="text-[8px] font-bold text-slate-500 uppercase leading-snug">também edita em Configurações → Boleto</span>
          </div>
        </section>

        {/* lista de atrasados */}
        <section className={`rounded-3xl p-4 ${dark}`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2"><i className="fa-solid fa-list-check mr-1.5 text-rose-400"></i>Clientes com boleto vencido</p>
          {carregando && !(dados?.atrasados || []).length && (
            <p className="text-[11px] font-black text-slate-400 text-center py-8"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Consultando o Inter...</p>
          )}
          {!carregando && atrasadosOrdenados.length === 0 && (
            <div className="text-center py-8">
              <i className="fa-solid fa-circle-check text-emerald-500 text-3xl mb-2 block"></i>
              <p className="text-[11px] font-black text-slate-300 uppercase">Nenhum boleto atrasado — tudo em dia!</p>
              <p className="text-[9px] font-bold text-slate-500 mt-1">Boletos vencidos dos últimos 180 dias aparecem aqui.</p>
            </div>
          )}
          <div className="space-y-2">
            {atrasadosOrdenados.map((b) => (
              <div key={b.codigo} className="rounded-2xl bg-slate-800/50 border border-slate-800 px-3 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-black text-slate-100 uppercase truncate min-w-0">{b.cliente}</p>
                  <span className="text-[9px] font-black uppercase px-2 py-1 rounded-lg bg-rose-950/70 border border-rose-900 text-rose-300 whitespace-nowrap flex items-center gap-1"><i className="fa-solid fa-hourglass-half text-[8px]"></i>{b.diasAtraso}d atraso</span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[9px] font-bold text-slate-500 leading-snug">
                    Venceu {b.vencimentoFmt}{b.parcela ? ` · parcela ${b.parcela}` : ''} · <span className="text-slate-400">{b.seuNumero || b.codigo}</span>
                  </p>
                  <p className="text-base font-black text-slate-100">{fmt(b.valor)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setMsgBoleto(b); setCopiado(false); }} className="flex-1 bg-rose-600 text-white py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wide active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-comment-sms text-[10px]"></i>Cobrar
                  </button>
                  {b.telefone && (
                    <a
                      href={`https://wa.me/${b.telefone}?text=${encodeURIComponent(montarMensagem(dados?.mensagem || '', b))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-emerald-600 text-white w-11 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-transform"
                      title="Abrir WhatsApp com a mensagem"
                      aria-label={`Abrir WhatsApp para ${b.cliente}`}
                    >
                      <i className="fa-brands fa-whatsapp text-base"></i>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* footer fixo */}
        <p className="text-[8px] font-bold text-slate-600 text-center leading-snug px-2 mt-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          Portal de Cobranças · boletos atrasados via API do Inter · Doce Mania
        </p>
      </div>

      {/* ===== MODAL: cobrar um boleto (mensagem montada) ===== */}
      {msgBoleto && dados && (() => {
        const msg = montarMensagem(dados.mensagem, msgBoleto);
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-3" onClick={() => setMsgBoleto(null)}>
            <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-5 shadow-2xl space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase text-slate-400">Cobrança</p>
                  <p className="text-sm font-black text-slate-100 uppercase truncate">{msgBoleto.cliente}</p>
                </div>
                <button onClick={() => setMsgBoleto(null)} className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center" aria-label="Fechar"><i className="fa-solid fa-xmark"></i></button>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-400">
                <span>{fmt(msgBoleto.valor)} · venceu {msgBoleto.vencimentoFmt} · {msgBoleto.diasAtraso} dia(s) de atraso</span>
              </div>
              <div className="rounded-2xl bg-slate-800/80 border border-slate-700 p-3">
                <p className="text-[11px] font-bold text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{msg}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void copiarMensagem(msg)} className="bg-slate-800 border border-slate-600 text-slate-100 py-3 rounded-xl font-black text-[10px] uppercase tracking-wide active:scale-95">
                  {copiado ? <span className="text-emerald-400"><i className="fa-solid fa-check mr-1"></i>Copiado!</span> : <><i className="fa-solid fa-copy mr-1"></i>Copiar</>}
                </button>
                {msgBoleto.telefone ? (
                  <button onClick={() => abrirWhatsApp(msgBoleto, msg)} className="bg-emerald-600 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-wide active:scale-95">
                    <i className="fa-brands fa-whatsapp mr-1"></i>WhatsApp
                  </button>
                ) : (
                  <button disabled className="bg-slate-800 border border-slate-700 text-slate-500 py-3 rounded-xl font-black text-[10px] uppercase tracking-wide cursor-not-allowed" title="Cliente sem telefone no cadastro">Sem WhatsApp</button>
                )}
              </div>
              <p className="text-[8px] font-bold text-slate-500 text-center leading-snug">Mensagem com placeholders preenchidos por boleto. Editar o texto: botão “Mensagem de cobrança”.</p>
            </div>
          </div>
        );
      })()}

      {/* ===== MODAL: editor da mensagem personalizada ===== */}
      {editorAberto && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[210] flex items-end sm:items-center justify-center p-3" onClick={() => setEditorAberto(false)}>
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-5 shadow-2xl space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase text-slate-400">Mensagem personalizada de cobrança</p>
                <p className="text-sm font-black text-slate-100 uppercase">Texto enviado ao cliente</p>
              </div>
              <button onClick={() => setEditorAberto(false)} className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center" aria-label="Fechar"><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((ph) => (
                <button key={ph} onClick={() => inserirPlaceholder(ph)} className="text-[9px] font-black uppercase bg-slate-800 border border-slate-600 text-rose-300 px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform" title="Inserir no texto">{ph}</button>
              ))}
            </div>
            <textarea
              ref={taRef}
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value.slice(0, 600))}
              rows={5}
              placeholder="Escreva a mensagem de cobrança que o cliente vai receber..."
              className="w-full rounded-2xl bg-slate-800/80 border border-slate-700 p-3 text-[12px] font-bold text-slate-100 outline-none focus:ring-2 focus:ring-rose-900 resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-black text-slate-500">{msgInput.length}/600</span>
              <button onClick={() => setMsgInput(dados?.mensagemPadrao || '')} className="text-[9px] font-black uppercase text-slate-400 underline px-2 py-1.5">Voltar ao padrão</button>
            </div>
            {msgOk && <p className="text-[10px] font-black text-emerald-400 text-center">{msgOk}</p>}
            <button onClick={() => void salvarMensagem()} disabled={msgSalvando || msgInput.trim() === (dados?.mensagem || '')} className="w-full bg-rose-600 text-white font-black py-3.5 rounded-2xl uppercase text-[11px] tracking-widest active:scale-95 disabled:opacity-50">
              {msgSalvando ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Salvando...</> : <><i className="fa-solid fa-check mr-1.5"></i>Salvar mensagem</>}
            </button>
            <p className="text-[8px] font-bold text-slate-500 text-center leading-snug">A mesma mensagem é editável nas Configurações do app (Boleto). {msgInput.trim() === (dados?.mensagemPadrao || '') ? 'Você está com o texto padrão.' : ''}</p>
          </div>
        </div>
      )}
    </main>
  );
}
