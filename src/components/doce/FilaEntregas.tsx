"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User, Product } from '@/lib/types';
import { authHeaders } from '@/services/userService';
import Cupom from '@/components/doce/Cupom';

/**
 * BLOCO 13 — FILA CONTINUA DE ENTREGA (estilo "fila viva").
 *
 * Nao existe mais "finalizar dia / gerar rota": todo pedido de pre-venda
 * entra na fila na hora que o vendedor registra. A ordem e:
 *   1. PRIORIDADE 1 (vermelho, sempre no topo)
 *   2. PRIORIDADE 2 (ambar)
 *   3. Demais — mais antigo primeiro (o card mostra "esperando Xd")
 *
 * Quem entrega: SOMENTE o ENTREGADOR (e o admin). O vendedor acompanha
 * (modo VENDEDOR: leitura) — regra do dono: vendedor nao entrega.
 *
 * Aceite do recebimento:
 *   DINHEIRO -> valor recebido + troco calculado (suporta parcial)
 *   PIX      -> confirmacao manual + foto do comprovante obrigatoria
 *   BOLETO   -> foto do boleto obrigatoria
 *   + alternativas: ja pagou / nao cobrou
 *
 * Ainda: lista imprimivel (ordem de entrega), fechamento de caixa do
 * entregador com confirmacao do admin, e pedido falhado nunca some
 * (fica vermelho ate ser reaberto ou excluido pelo admin).
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
  temFoto: boolean;
  dataVencimento: string | null;
  vendedorId: string;
  vendedorNome: string;
  cliente: { id: string; nome: string; endereco: string; bairro: string; telefone: string; lat: number | null; lng: number | null };
  itens: { nome: string; produtoId: string; quantidade: number; precoVenda: number }[];
}

interface ApiResp {
  hoje: string;
  fila: FilaItem[];
  falhados: FilaItem[];
  entreguesHoje: FilaItem[];
  resumo?: { naFila: number; valorFila: number; atrasados: number; separados: number; entreguesHoje: number; valorEntregueHoje: number; falhados: number };
  caixa?: { dinheiroHoje: number; pixHoje: number };
  meuFechamento?: { id: string; valor_dinheiro: number; valor_pix: number; qtd_entregas: number; confirmado: boolean; obs: string | null } | null;
  fechamentosHoje?: any[];
  migracaoPendente?: boolean;
  error?: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const PGTO_META: Record<string, { label: string; icon: string; chip: string }> = {
  DINHEIRO: { label: 'Dinheiro', icon: 'fa-solid fa-money-bill-wave', chip: 'bg-emerald-50 text-emerald-700' },
  PIX: { label: 'Pix', icon: 'fa-brands fa-pix', chip: 'bg-teal-50 text-teal-700' },
  BOLETO: { label: 'Boleto', icon: 'fa-solid fa-barcode', chip: 'bg-amber-50 text-amber-700' },
};
const pgtoMeta = (m: string) => PGTO_META[m] || PGTO_META.DINHEIRO;

const MOTIVOS_FALHA = ['Cliente ausente', 'Recusou o pedido', 'Endereco errado', 'Loja fechada', 'Outro motivo'];

/** Dias esperando na fila (fracionado em dias; 0 = hoje) */
function diasEsperando(dataVenda: string): number {
  return Math.floor((Date.now() - new Date(dataVenda).getTime()) / (24 * 3600 * 1000));
}

function idadeLabel(dataVenda: string): { txt: string; cls: string } {
  const d = diasEsperando(dataVenda);
  if (d <= 0) return { txt: 'hoje', cls: 'bg-gray-100 text-gray-500' };
  if (d === 1) return { txt: 'esperando 1 dia', cls: 'bg-amber-100 text-amber-700' };
  return { txt: `esperando ${d} dias`, cls: 'bg-rose-100 text-rose-700' };
}

function pegaGps(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    const t = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(t); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: 5500, maximumAge: 15000 }
    );
  });
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('img'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('reader'));
    reader.readAsDataURL(file);
  });
}

function mapaUrl(p: FilaItem): string {
  if (p.cliente.lat != null && p.cliente.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.cliente.lat},${p.cliente.lng}`;
  }
  const end = `${p.cliente.endereco || ''} ${p.cliente.bairro || ''}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end || p.cliente.nome)}`;
}

function zapUrl(p: FilaItem): string | null {
  const digits = (p.cliente.telefone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const msg = encodeURIComponent(`Ola! Aqui e da Doce Mania 🙂 Seu pedido ja esta a caminho!`);
  return `https://wa.me/${digits.length <= 11 ? '55' + digits : digits}?text=${msg}`;
}

export const FilaEntregas: React.FC<{ user: User; showToast: (m: string, t?: 'success' | 'error') => void; modo: 'ENTREGADOR' | 'ADMIN' | 'VENDEDOR' }> = ({ user, showToast, modo }) => {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetEntregue, setSheetEntregue] = useState<FilaItem | null>(null);
  const [sheetFalhou, setSheetFalhou] = useState<FilaItem | null>(null);
  const [motivoOutro, setMotivoOutro] = useState('');
  const [motivoSel, setMotivoSel] = useState<string>(MOTIVOS_FALHA[0]);
  const [valorRecebido, setValorRecebido] = useState('');
  const [valorPix, setValorPix] = useState('');
  const [fotoBoleto, setFotoBoleto] = useState<string | null>(null);
  const [fotoPix, setFotoPix] = useState<string | null>(null);
  const [cupom, setCupom] = useState<FilaItem | null>(null);
  const [verEntregues, setVerEntregues] = useState(false);
  const [sheetCaixa, setSheetCaixa] = useState(false);
  const [caixaDinheiro, setCaixaDinheiro] = useState('');
  const [caixaObs, setCaixaObs] = useState('');
  const [mostrarLista, setMostrarLista] = useState(false);
  const mounted = useRef(true);

  const podeEntregar = modo === 'ENTREGADOR' || modo === 'ADMIN';
  const podePrioridade = modo === 'ENTREGADOR' || modo === 'ADMIN';

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const url = modo === 'VENDEDOR' ? '/api/pre-venda?fila=1' : '/api/pre-venda?fila=1&caixa=1';
      const res = await fetch(url, { headers: authHeaders() });
      const d: ApiResp = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { if (!silencioso) showToast(d.error || 'Erro ao carregar a fila.', 'error'); }
      else setData(d);
    } catch {
      if (mounted.current && !silencioso) showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [showToast, modo]);

  useEffect(() => {
    mounted.current = true;
    const t0 = setTimeout(() => load(), 0);
    const t = setInterval(() => load(true), 45_000);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; clearTimeout(t0); clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  async function acao(body: any, okMsg: string) {
    setBusy(body.saleId || body.acao);
    try {
      const gps = await pegaGps();
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...body, lat: gps?.lat, lng: gps?.lng }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        showToast(d.error || 'Nao foi possivel concluir.', 'error');
        return false;
      }
      showToast(okMsg, 'success');
      await load(true);
      return true;
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmarEntrega(p: FilaItem, pagamento: string, extra: Record<string, any> = {}) {
    const ok = await acao({ acao: 'ENTREGUE', saleId: p.saleId, pagamento, ...extra },
      pagamento === 'BOLETO' ? 'Entrega confirmada — boleto com foto!' :
      pagamento === 'DINHEIRO' ? 'Entrega confirmada — dinheiro!' :
      pagamento === 'PIX' ? 'Entrega confirmada — Pix com comprovante!' :
      pagamento === 'JA_PAGO' ? 'Entrega confirmada — ja pago!' :
      'Entrega confirmada — a receber!');
    if (ok) {
      setSheetEntregue(null);
      setValorRecebido('');
      setValorPix('');
      setFotoBoleto(null);
      setFotoPix(null);
    }
  }

  async function setPrioridade(p: FilaItem, prioridade: number) {
    const novo = p.prioridade === prioridade ? 0 : prioridade;
    await acao({ acao: 'PRIORIDADE', saleId: p.saleId, prioridade: novo },
      novo === 1 ? 'Prioridade 1 definida — vai para o topo!' : novo === 2 ? 'Prioridade 2 definida.' : 'Prioridade normal.');
  }

  // products fake a partir dos itens (o Cupom so precisa de id->nome)
  const productsOf = (p: FilaItem): Product[] => p.itens.map(i => ({ id: i.produtoId, nome: i.nome, precoCusto: 0, precoVenda: i.precoVenda, precoMinimo: 0, comissaoPercentual: 0, estoquePrincipal: 0, ativo: true }));
  const saleOf = (p: FilaItem): any => ({
    id: p.saleId,
    data: new Date(p.dataVenda),
    valorTotal: p.valorTotal,
    valorPago: p.valorPago,
    metodoPagamento: p.formaPgto === 'PIX' ? 'A_PRAZO' : 'A_PRAZO',
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

  /** Lista imprimivel (ordem de entrega) — imprime via navegador */
  function imprimirLista() {
    if (!data) return;
    setMostrarLista(true);
    setTimeout(() => { window.print(); setMostrarLista(false); }, 150);
  }

  async function fecharCaixa() {
    const v = parseFloat(caixaDinheiro) || 0;
    if (v < 0) { showToast('Valor invalido.', 'error'); return; }
    const ok = await acao({ acao: 'FECHAR_CAIXA', valorDinheiro: v, valorPix: data?.caixa?.pixHoje || 0, qtdEntregas: data?.resumo?.entreguesHoje || 0, obs: caixaObs }, 'Caixa fechado! O admin confirma o recebimento.');
    if (ok) { setSheetCaixa(false); setCaixaDinheiro(''); setCaixaObs(''); }
  }

  if (loading && !data) {
    return <div className="py-14 flex justify-center"><div className="w-9 h-9 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" /></div>;
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
  const p1 = fila.filter(p => p.prioridade === 1);
  const p2 = fila.filter(p => p.prioridade === 2);
  const normais = fila.filter(p => p.prioridade === 0 || p.prioridade == null);
  const falhados = data.falhados || [];
  const entreguesHoje = data.entreguesHoje || [];
  const resumo = data.resumo;
  const caixaEst = data.caixa || { dinheiroHoje: 0, pixHoje: 0 };

  const sp = sheetEntregue;
  const spMetodo = sp ? (PGTO_META[sp.formaPgto] ? sp.formaPgto : 'DINHEIRO') : 'DINHEIRO';
  const restante = sp ? Math.max(0, sp.valorTotal - sp.valorPago) : 0;
  const rec = parseFloat(valorRecebido) || 0;
  const troco = sp && rec > restante ? rec - restante : 0;
  const falta = sp && rec > 0 && rec < restante ? restante - rec : 0;

  const Card = ({ p, acento }: { p: FilaItem; acento: 'p1' | 'p2' | 'normal' | 'falha' | 'ok' }) => {
    const pend = p.entregaStatus === 'PENDENTE' || p.entregaStatus === 'EM_ROTA';
    const idade = idadeLabel(p.dataVenda);
    const zap = zapUrl(p);
    const pg = pgtoMeta(p.formaPgto);
    const borda = acento === 'p1' ? 'border-rose-300 ring-2 ring-rose-100' : acento === 'p2' ? 'border-amber-300' : acento === 'falha' ? 'border-rose-200' : acento === 'ok' ? 'border-emerald-200' : 'border-gray-100';
    return (
      <div className={`rounded-2xl shadow-sm border overflow-hidden bg-white ${borda} ${p.separado && pend ? 'opacity-70 bg-gray-100' : ''} print:break-inside-avoid`}>
        <div className="p-4">
          <div className="flex items-start gap-2">
            {/* prioridade / seq badge */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-[11px] ${acento === 'p1' ? 'bg-rose-600 text-white animate-pulse' : acento === 'p2' ? 'bg-amber-500 text-white' : acento === 'falha' ? 'bg-rose-500 text-white' : acento === 'ok' ? 'bg-emerald-500 text-white' : 'bg-gray-800 text-white'}`}>
              {acento === 'p1' ? 'P1' : acento === 'p2' ? 'P2' : acento === 'falha' ? <i className="fa-solid fa-xmark"></i> : acento === 'ok' ? <i className="fa-solid fa-check"></i> : '#'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[13px] font-black text-gray-800 truncate capitalize">{p.cliente.nome}</p>
                {p.separado && pend && (
                  <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-gray-300 text-gray-600"><i className="fa-solid fa-boxes-stacked mr-0.5"></i>Separado</span>
                )}
                {pend && <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md shrink-0 ${idade.cls}`}><i className="fa-regular fa-clock mr-0.5"></i>{idade.txt}</span>}
                <span className="text-[8px] font-bold text-gray-300 uppercase shrink-0">{p.numero}</span>
              </div>
              <p className="text-[9px] text-gray-400 font-semibold mt-0.5 truncate">
                <i className="fa-solid fa-location-dot mr-1"></i>{p.cliente.endereco || 'Sem endereco'}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}
              </p>
              <p className="text-[9px] text-gray-500 font-bold mt-1 leading-snug">
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
                {p.condicao === 'APRAZO' && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 uppercase">A prazo</span>}
                {p.valorPago > 0 && p.valorPago < p.valorTotal && (
                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 uppercase">Falta {fmt(p.valorTotal - p.valorPago)}</span>
                )}
              </div>
            </div>
          </div>

          {/* acoes */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
            <a href={mapaUrl(p)} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-blue-50 text-blue-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
              <i className="fa-solid fa-diamond-turn-right mr-1"></i>Mapa
            </a>
            {zap && (
              <a href={zap} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-green-50 text-green-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
                <i className="fa-brands fa-whatsapp mr-1"></i>Zap
              </a>
            )}
            <button onClick={() => setCupom(p)} className="flex-1 min-w-[58px] py-2.5 rounded-xl bg-amber-50 text-amber-700 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
              <i className="fa-solid fa-receipt mr-1"></i>Cupom
            </button>
            {podePrioridade && pend && (
              <>
                <button onClick={() => setPrioridade(p, 1)} disabled={!!busy}
                  className={`flex-1 min-w-[58px] py-2.5 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60 ${p.prioridade === 1 ? 'bg-rose-600 text-white shadow' : 'bg-rose-50 text-rose-600'}`}>
                  P1
                </button>
                <button onClick={() => setPrioridade(p, 2)} disabled={!!busy}
                  className={`flex-1 min-w-[58px] py-2.5 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60 ${p.prioridade === 2 ? 'bg-amber-500 text-white shadow' : 'bg-amber-50 text-amber-600'}`}>
                  P2
                </button>
              </>
            )}
          </div>

          {/* entregador/admin: entrega e falha com botoes grandes */}
          {podeEntregar && pend && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { setValorRecebido(''); setValorPix(''); setFotoBoleto(null); setFotoPix(null); setSheetEntregue(p); }}
                disabled={!!busy}
                className="flex-[1.6] py-4 rounded-2xl bg-emerald-600 text-white text-[11px] font-black uppercase shadow-md active:scale-95 transition-transform disabled:opacity-60"
              >
                <i className="fa-solid fa-check mr-1"></i>Entregue
              </button>
              <button
                onClick={() => { setMotivoSel(MOTIVOS_FALHA[0]); setMotivoOutro(''); setSheetFalhou(p); }}
                disabled={!!busy}
                className="flex-1 py-4 rounded-2xl bg-rose-50 text-rose-600 text-[11px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60"
              >
                <i className="fa-solid fa-xmark mr-1"></i>Falhou
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ===== RESUMO DA FILA ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-layer-group text-emerald-500 text-xs"></i>
            </div>
            <div>
              <p className="text-[10px] font-black text-gray-700 uppercase leading-none">Fila de entregas</p>
              <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">
                {modo === 'VENDEDOR' ? 'Seus pedidos — o entregador entrega' : 'Continua — entra pedido, sai entregue'}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            {modo !== 'VENDEDOR' && (
              <button onClick={imprimirLista} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center active:scale-90" title="Imprimir lista de entregas">
                <i className="fa-solid fa-print text-[11px]"></i>
              </button>
            )}
            <button onClick={() => load()} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center active:scale-90">
              <i className={`fa-solid fa-rotate text-[11px] ${busy ? 'animate-spin' : ''}`}></i>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-center">
          <div className="bg-gray-50 rounded-xl p-2"><p className="text-[7px] font-black text-gray-400 uppercase">Na fila</p><p className="text-[13px] font-black text-gray-800">{resumo?.naFila ?? fila.length}</p></div>
          <div className="bg-amber-50 rounded-xl p-2"><p className="text-[7px] font-black text-amber-500 uppercase">Atrasados</p><p className="text-[13px] font-black text-amber-700">{resumo?.atrasados ?? 0}</p></div>
          <div className="bg-rose-50 rounded-xl p-2"><p className="text-[7px] font-black text-rose-400 uppercase">Falhas</p><p className="text-[13px] font-black text-rose-600">{falhados.length}</p></div>
          <div className="bg-emerald-50 rounded-xl p-2"><p className="text-[7px] font-black text-emerald-500 uppercase">Entregues</p><p className="text-[13px] font-black text-emerald-700">{resumo?.entreguesHoje ?? entreguesHoje.length}</p></div>
        </div>
        <div className="flex gap-2 mt-2 text-[9px] font-bold flex-wrap">
          <span className="text-gray-600"><i className="fa-solid fa-wallet mr-1"></i>Fila: {fmt(resumo?.valorFila ?? 0)}</span>
          <span className="text-emerald-600"><i className="fa-solid fa-circle-check mr-1"></i>Entregue hoje: {fmt(resumo?.valorEntregueHoje ?? 0)}</span>
        </div>

        {/* CAIXA DO DIA (entregador e admin) */}
        {modo !== 'VENDEDOR' && (
          <div className="mt-3 bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[8px] font-black text-slate-400 uppercase">Caixa de hoje (estimado)</p>
                <p className="text-[11px] font-black text-slate-700">
                  <i className="fa-solid fa-money-bill-wave text-emerald-500 mr-1"></i>{fmt(caixaEst.dinheiroHoje)}
                  <span className="mx-2 text-slate-300">·</span>
                  <i className="fa-brands fa-pix text-teal-500 mr-1"></i>{fmt(caixaEst.pixHoje)}
                </p>
              </div>
              {modo === 'ENTREGADOR' ? (
                <button onClick={() => { setCaixaDinheiro(caixaEst.dinheiroHoje ? String(caixaEst.dinheiroHoje.toFixed(2)) : ''); setSheetCaixa(true); }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-white text-[9px] font-black uppercase active:scale-95 shadow">
                  <i className="fa-solid fa-cash-register mr-1"></i>{data.meuFechamento ? 'Corrigir' : 'Fechar caixa'}
                </button>
              ) : (
                data.fechamentosHoje && data.fechamentosHoje.length > 0 && (
                  <div className="text-right">
                    {data.fechamentosHoje.map((f: any) => (
                      <div key={f.id} className="flex items-center gap-2 justify-end mb-1">
                        <span className="text-[9px] font-black text-slate-600">Dinheiro: {fmt(Number(f.valor_dinheiro))}</span>
                        {f.confirmado ? (
                          <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Confirmado</span>
                        ) : (
                          <button onClick={() => acao({ acao: 'CONFIRMAR_CAIXA', caixaId: f.id }, 'Recebimento do dinheiro confirmado!')}
                            className="text-[8px] font-black uppercase px-2 py-1 rounded bg-emerald-600 text-white active:scale-95">
                            Confirmar
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
            {modo === 'ENTREGADOR' && data.meuFechamento && (
              <p className="text-[8px] font-bold text-slate-400 uppercase mt-1.5">
                {data.meuFechamento.confirmado
                  ? <span className="text-emerald-600"><i className="fa-solid fa-circle-check mr-1"></i>Admin confirmou o recebimento</span>
                  : 'Aguardando o admin confirmar o dinheiro na base'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ===== P1 ===== */}
      {p1.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-rose-600 uppercase px-1 flex items-center gap-1.5">
            <i className="fa-solid fa-triangle-exclamation"></i>Prioridade 1 — entregar primeiro
          </p>
          {p1.map(p => <Card key={p.saleId} p={p} acento="p1" />)}
        </div>
      )}

      {/* ===== P2 ===== */}
      {p2.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black text-amber-600 uppercase px-1 flex items-center gap-1.5">
            <i className="fa-solid fa-bolt"></i>Prioridade 2
          </p>
          {p2.map(p => <Card key={p.saleId} p={p} acento="p2" />)}
        </div>
      )}

      {/* ===== FILA NORMAL (mais antigo primeiro) ===== */}
      {normais.length > 0 && (
        <div className="space-y-3">
          {fila.length > 0 && <p className="text-[10px] font-black text-gray-500 uppercase px-1">Fila — mais antigo primeiro</p>}
          {normais.map(p => <Card key={p.saleId} p={p} acento="normal" />)}
        </div>
      )}

      {fila.length === 0 && (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100 print:hidden">
          <i className="fa-solid fa-box-open text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs font-black text-gray-700">Fila vazia — tudo entregue!</p>
          <p className="text-[10px] text-gray-400 font-semibold mt-1">Novos pedidos aparecem aqui automaticamente.</p>
        </div>
      )}

      {/* ===== FALHADOS (nunca somem) ===== */}
      {falhados.length > 0 && (
        <div className="space-y-3 print:hidden">
          <p className="text-[10px] font-black text-rose-600 uppercase px-1 flex items-center gap-1.5">
            <i className="fa-solid fa-circle-exclamation"></i>Nao entregues — pendencia aberta
          </p>
          {falhados.map(p => (
            <div key={p.saleId}>
              <Card p={p} acento="falha" />
              <div className="flex gap-2 mt-1.5">
                <button onClick={() => acao({ acao: 'REABRIR', saleId: p.saleId }, 'Pedido voltou para a fila!')} disabled={!!busy}
                  className="flex-1 py-3 rounded-xl bg-gray-800 text-white text-[9px] font-black uppercase active:scale-95 disabled:opacity-60">
                  <i className="fa-solid fa-rotate-left mr-1"></i>Devolver para a fila
                </button>
                {modo === 'ADMIN' && (
                  <button onClick={() => { if (window.confirm(`Cancelar o pedido de ${p.cliente.nome}?\nO pedido sera excluido definitivamente.`)) acao({ acao: 'EXCLUIR_VENDA', saleId: p.saleId }, 'Pedido cancelado.'); }} disabled={!!busy}
                    className="flex-1 py-3 rounded-xl bg-white border border-rose-100 text-rose-500 text-[9px] font-black uppercase active:scale-95 disabled:opacity-60">
                    <i className="fa-solid fa-ban mr-1"></i>Cancelar pedido
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== ENTREGUES HOJE (resumo recolhivel) ===== */}
      {entreguesHoje.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden print:hidden">
          <button onClick={() => setVerEntregues(v => !v)} className="w-full p-4 flex items-center justify-between">
            <p className="text-[10px] font-black text-emerald-700 uppercase"><i className="fa-solid fa-circle-check mr-1.5"></i>Entregues hoje ({entreguesHoje.length})</p>
            <i className={`fa-solid ${verEntregues ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-300 text-xs`}></i>
          </button>
          {verEntregues && (
            <div className="px-4 pb-4 space-y-2">
              {entreguesHoje.map(p => (
                <div key={p.saleId} className="flex items-center justify-between bg-emerald-50/60 rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-gray-700 capitalize truncate">{p.cliente.nome}</p>
                    <p className="text-[8px] font-bold text-gray-400 uppercase">{p.vendedorNome ? `Vendedor: ${p.vendedorNome}` : ''}{p.formaPgto ? ` · ${pgtoMeta(p.formaPgto).label}` : ''}</p>
                  </div>
                  <span className="text-[10px] font-black text-emerald-700 shrink-0 ml-2">{fmt(p.valorTotal)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== SHEET: CONFIRMAR ENTREGA / RECEBIMENTO ===== */}
      {sp && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetEntregue(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Aceite da entrega</h3>
            <p className="text-[11px] font-bold text-gray-600 capitalize text-center mt-1">{sp.cliente.nome} · {sp.numero}</p>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-0.5">
              Cliente combinou pagar com <span className="text-gray-700 font-black uppercase">{pgtoMeta(spMetodo).label}</span>
              {sp.condicao === 'APRAZO' ? ' (a prazo)' : ' (à vista)'}
            </p>
            {sp.trocas && (
              <p className="text-[9px] font-black text-orange-600 text-center bg-orange-50 rounded-xl px-3 py-2 mt-2">
                <i className="fa-solid fa-right-left mr-1"></i>Trocas: {sp.trocas}
              </p>
            )}

            {/* --- DINHEIRO: valor recebido + troco --- */}
            {spMetodo === 'DINHEIRO' && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100">
                  <p className="text-[9px] font-black text-gray-400 uppercase">Valor a receber</p>
                  <p className="text-2xl font-black text-gray-800">{fmt(restante)}</p>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dinheiro recebido R$ (vazio = total)</label>
                  <input
                    type="number" inputMode="decimal"
                    value={valorRecebido}
                    onChange={e => setValorRecebido(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xl font-black text-center outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                {troco > 0 && (
                  <div className="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-100 text-center animate-in zoom-in-95">
                    <p className="text-[9px] font-black text-emerald-600 uppercase">Troco a devolver</p>
                    <p className="text-xl font-black text-emerald-700">{fmt(troco)}</p>
                  </div>
                )}
                {falta > 0 && (
                  <p className="text-[9px] font-black text-amber-600 text-center uppercase">Faltam {fmt(falta)} — registrar parcial?</p>
                )}
                <button
                  onClick={() => {
                    if (falta > 0) {
                      if (window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(rec)} de ${fmt(restante)}.\nO restante (${fmt(falta)}) continua em aberto no sistema.`)) {
                        confirmarEntrega(sp, 'DINHEIRO', { valorRecebido: rec });
                      }
                      return;
                    }
                    confirmarEntrega(sp, 'DINHEIRO', { valorRecebido: rec > 0 ? rec : undefined });
                  }}
                  disabled={!!busy}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-check mr-1"></i>
                  {falta > 0 ? `Registrar parcial — recebi ${fmt(rec)}` : `Confirmei que recebi ${fmt(restante)}`}
                </button>
              </div>
            )}

            {/* --- PIX: confirmacao manual + FOTO OBRIGATORIA --- */}
            {spMetodo === 'PIX' && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-teal-50 rounded-2xl p-4 text-center border border-teal-100">
                  <i className="fa-brands fa-pix text-teal-600 text-2xl"></i>
                  <p className="text-[9px] font-black text-teal-700 uppercase mt-1">Pagamento via Pix</p>
                  <p className="text-2xl font-black text-teal-800">{fmt(restante)}</p>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor recebido no Pix (vazio = total)</label>
                  <input
                    type="number" inputMode="decimal"
                    value={valorPix}
                    onChange={e => setValorPix(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xl font-black text-center outline-none focus:ring-2 focus:ring-teal-100"
                  />
                </div>
                <label className="block cursor-pointer">
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setFotoPix(await compressImage(f)); }
                      catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                    }}
                  />
                  <div className="py-3.5 rounded-2xl bg-teal-500 text-white text-[10px] font-black uppercase text-center shadow-md active:scale-95 transition-transform">
                    <i className="fa-solid fa-camera mr-1"></i>{fotoPix ? 'Trocar comprovante' : 'Foto do comprovante Pix (obrigatoria)'}
                  </div>
                </label>
                {fotoPix && (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                    <img src={fotoPix} alt="Comprovante Pix" className="w-full max-h-56 object-cover" />
                    <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Comprovante anexado</span>
                  </div>
                )}
                <button
                  onClick={() => {
                    const pv = parseFloat(valorPix) || 0;
                    if (pv > 0 && pv < restante) {
                      if (!window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(pv)} de ${fmt(restante)}.\nO restante (${fmt(restante - pv)}) continua em aberto.`)) return;
                    }
                    confirmarEntrega(sp, 'PIX', { foto: fotoPix, valorRecebido: pv > 0 ? pv : undefined });
                  }}
                  disabled={!!busy || !fotoPix}
                  className="w-full py-4 bg-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <i className="fa-solid fa-check mr-1"></i>Recebi — confirmo o Pix
                </button>
              </div>
            )}

            {/* --- BOLETO: foto obrigatoria --- */}
            {spMetodo === 'BOLETO' && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-amber-50 rounded-2xl p-4 text-center border border-amber-100">
                  <i className="fa-solid fa-barcode text-amber-600 text-2xl"></i>
                  <p className="text-[9px] font-black text-amber-700 uppercase mt-1">Foto do boleto entregue obrigatoria</p>
                  <p className="text-[9px] text-amber-600/80 font-semibold">O valor entra como pendente ate compensar</p>
                </div>
                <label className="block cursor-pointer">
                  <input
                    type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setFotoBoleto(await compressImage(f)); }
                      catch { showToast('Nao foi possivel processar a foto.', 'error'); }
                    }}
                  />
                  <div className="py-3.5 rounded-2xl bg-amber-500 text-white text-[10px] font-black uppercase text-center shadow-md active:scale-95 transition-transform">
                    <i className="fa-solid fa-camera mr-1"></i>{fotoBoleto ? 'Trocar foto' : 'Tirar foto do boleto'}
                  </div>
                </label>
                {fotoBoleto && (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-100 animate-in zoom-in-95">
                    <img src={fotoBoleto} alt="Foto do boleto entregue" className="w-full max-h-56 object-cover" />
                    <span className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-1 rounded-md">Foto anexada</span>
                  </div>
                )}
                <button
                  onClick={() => fotoBoleto && confirmarEntrega(sp, 'BOLETO', { foto: fotoBoleto })}
                  disabled={!!busy || !fotoBoleto}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <i className="fa-solid fa-check mr-1"></i>Confirmar entrega do boleto
                </button>
              </div>
            )}

            {/* --- alternativas --- */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-[8px] font-black text-gray-300 uppercase text-center mb-2">Pagou de outra forma?</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => confirmarEntrega(sp, 'JA_PAGO')}
                  className="py-3 rounded-xl bg-blue-50 text-blue-600 text-[9px] font-black uppercase active:scale-95 transition-transform">
                  <i className="fa-solid fa-circle-check mr-1"></i>Ja pagou
                </button>
                <button onClick={() => confirmarEntrega(sp, 'NAO_PAGO')}
                  className="py-3 rounded-xl bg-amber-50 text-amber-600 text-[9px] font-black uppercase active:scale-95 transition-transform">
                  <i className="fa-solid fa-hand-holding-dollar mr-1"></i>Nao cobrou
                </button>
              </div>
            </div>

            <button onClick={() => setSheetEntregue(null)} className="w-full mt-3 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest print:hidden">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: NAO ENTREGUE ===== */}
      {sheetFalhou && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetFalhou(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Nao entregue</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1 capitalize">{sheetFalhou.cliente.nome}</p>
            <p className="text-[9px] text-gray-400 font-bold text-center mt-0.5 uppercase">O pedido fica como pendencia ate ser resolvido</p>
            <div className="space-y-2 mt-5">
              {MOTIVOS_FALHA.map(m => (
                <button key={m} onClick={() => setMotivoSel(m)}
                  className={`w-full py-3.5 px-4 rounded-xl text-left text-[11px] font-bold transition-all ${motivoSel === m ? 'bg-rose-600 text-white shadow-md' : 'bg-gray-50 text-gray-600'}`}>
                  {m === 'Outro motivo' ? '• Outro motivo' : `• ${m}`}
                </button>
              ))}
              {motivoSel === 'Outro motivo' && (
                <input value={motivoOutro} onChange={e => setMotivoOutro(e.target.value)} placeholder="Descreva o motivo..."
                  className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-rose-100" />
              )}
            </div>
            <button
              onClick={() => {
                const p = sheetFalhou;
                const motivo = motivoSel === 'Outro motivo' ? (motivoOutro.trim() || 'Outro motivo') : motivoSel;
                setSheetFalhou(null);
                acao({ acao: 'FALHOU', saleId: p.saleId, motivo }, 'Registrado como nao entregue.');
              }}
              disabled={!!busy}
              className="w-full mt-4 py-4 bg-rose-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              Confirmar nao entrega
            </button>
            <button onClick={() => setSheetFalhou(null)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: FECHAR CAIXA ===== */}
      {sheetCaixa && modo === 'ENTREGADOR' && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetCaixa(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Fechamento de caixa</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1">Conte o dinheiro e informe o valor que vai entregar na base</p>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center mt-4">
              <p className="text-[9px] font-black text-emerald-500 uppercase">Dinheiro recebido hoje (estimado)</p>
              <p className="text-2xl font-black text-emerald-700">{fmt(caixaEst.dinheiroHoje)}</p>
              <p className="text-[9px] font-bold text-teal-600 uppercase mt-1">Pix: {fmt(caixaEst.pixHoje)} (nao vem em especie)</p>
            </div>
            <div className="mt-4">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dinheiro em especie R$</label>
              <input type="number" inputMode="decimal" value={caixaDinheiro} onChange={e => setCaixaDinheiro(e.target.value)} placeholder="0.00"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black text-center outline-none focus:ring-2 focus:ring-emerald-100" />
            </div>
            <div className="mt-3">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Observacao (opcional)</label>
              <input value={caixaObs} onChange={e => setCaixaObs(e.target.value)} placeholder="Ex.: faltou R$ 10 de troco"
                className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold outline-none" />
            </div>
            <button onClick={fecharCaixa} disabled={!!busy}
              className="w-full mt-4 py-4 bg-slate-800 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60">
              <i className="fa-solid fa-cash-register mr-1"></i>Fechar caixa do dia
            </button>
            <button onClick={() => setSheetCaixa(false)} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== MODAL: CUPOM IDENTICO ===== */}
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

      {/* ===== LISTA IMPRIMIVEL (ordem de entrega) ===== */}
      {mostrarLista && data && (
        <div className="fixed inset-0 bg-white z-[400] p-8 overflow-auto print:static print:overflow-visible">
          <style>{`@media print { body * { visibility: hidden; } .lista-print, .lista-print * { visibility: visible; } .lista-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
          <div className="lista-print max-w-xl mx-auto">
            <h1 className="text-lg font-black text-center uppercase">Doce Mania — Ordem de Entrega</h1>
            <p className="text-[10px] text-center text-gray-500 mb-4">{new Date().toLocaleDateString('pt-BR')} {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {fila.length} pedidos · {fmt(resumo?.valorFila ?? 0)}</p>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b-2 border-black">
                  <th className="text-left py-1 w-8">#</th>
                  <th className="text-left py-1">Cliente</th>
                  <th className="text-left py-1">Endereço</th>
                  <th className="text-right py-1 w-20">Valor</th>
                  <th className="text-center py-1 w-16">Pgto</th>
                </tr>
              </thead>
              <tbody>
                {[...p1, ...p2, ...normais].map((p, i) => (
                  <tr key={p.saleId} className="border-b border-gray-300">
                    <td className="py-1.5 font-black">{i + 1}</td>
                    <td className="py-1.5 font-bold">{p.prioridade === 1 ? 'P1 ' : p.prioridade === 2 ? 'P2 ' : ''}{p.cliente.nome}</td>
                    <td className="py-1.5 text-gray-600">{p.cliente.endereco}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}</td>
                    <td className="py-1.5 text-right font-bold">{fmt(p.valorTotal)}</td>
                    <td className="py-1.5 text-center uppercase text-[9px] font-black">{p.formaPgto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[9px] text-gray-400 text-center mt-4">Regra: P1 primeiro, depois P2, depois mais antigo. Assinatura do entregador: ____________________</p>
          </div>
          <div className="max-w-xl mx-auto mt-4 print:hidden">
            <button onClick={() => setMostrarLista(false)} className="w-full bg-slate-800 text-white font-black py-3 rounded-2xl uppercase text-[10px]">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilaEntregas;
