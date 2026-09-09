"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '@/lib/types';
import { authHeaders } from '@/services/userService';

/**
 * ENTREGAS — visao do entregador (estilo Shopee):
 * rota do dia gerada ao finalizar o dia de pre-venda, paradas numeradas
 * em ordem, progresso, mapa, WhatsApp e confirmacao de entrega.
 *
 * No card da parada o entregador ve: nome do cliente, endereco, itens,
 * valor e a FORMA DE PAGAMENTO escolhida pelo cliente no pedido.
 * Pode abrir o cupom do pedido. Ao receber:
 *  - DINHEIRO: informa/conserta o valor recebido (calcula troco)
 *  - PIX: confirma o recebimento do valor correto
 *  - BOLETO: EXIGE foto do boleto entregue (comprovacao)
 *  - alternativa: ja pagou / nao cobrou
 * Nao entregue: escolhe o motivo.
 */

interface Parada {
  saleId: string;
  seq: number | null;
  entregaStatus: string; // PENDENTE | EM_ROTA | ENTREGUE | FALHOU
  valorTotal: number;
  valorPago: number;
  statusPagamento: string;
  formaPgto: string;     // DINHEIRO | PIX | BOLETO
  temFoto: boolean;      // foto do boleto entregue (Bloco 6)
  motivo: string | null;
  cliente: { id: string; nome: string; endereco: string; bairro: string; telefone: string; lat: number | null; lng: number | null };
  itens: { nome: string; quantidade: number; precoVenda: number }[];
  eventos: { status: string; motivo: string | null; criado_em: string }[];
}
interface Rota {
  id: string; data: string; status: string; totalParadas: number;
  criadaEm: string; iniciadaEm: string | null; concluidaEm: string | null;
  vendedorId: string; vendedorNome: string;
}
interface RotaBloco { rota: Rota; paradas: Parada[]; }
interface ApiResp {
  hoje: string; rota: Rota | null; paradas: Parada[];
  rotas?: RotaBloco[];
  pendentes?: { count: number; valor: number };
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

/** GPS silencioso da acao (best-effort, 6s de tolerancia) */
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

/** Comprime a foto para base64 jpeg (~max 900px) antes de enviar */
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

function mapaUrl(p: Parada): string {
  if (p.cliente.lat != null && p.cliente.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.cliente.lat},${p.cliente.lng}`;
  }
  const end = `${p.cliente.endereco || ''} ${p.cliente.bairro || ''}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end || p.cliente.nome)}`;
}
function zapUrl(p: Parada): string | null {
  const digits = (p.cliente.telefone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const msg = encodeURIComponent(`Ola! Aqui e da Doce Mania 🙂 Seu pedido ja esta a caminho!`);
  return `https://wa.me/${digits.length <= 11 ? '55' + digits : digits}?text=${msg}`;
}

const STATUS_STYLE: Record<string, { chip: string; label: string }> = {
  PENDENTE: { chip: 'bg-amber-100 text-amber-700', label: 'Na fila' },
  EM_ROTA: { chip: 'bg-blue-100 text-blue-700', label: 'Em rota' },
  ENTREGUE: { chip: 'bg-emerald-100 text-emerald-700', label: 'Entregue' },
  FALHOU: { chip: 'bg-rose-100 text-rose-700', label: 'Nao entregue' },
};

const MOTIVOS_FALHA = ['Cliente ausente', 'Recusou o pedido', 'Endereco errado', 'Loja fechada', 'Outro motivo'];

const EntregasView: React.FC<{ user: User; showToast: (m: string, t?: 'success' | 'error') => void; entregador?: boolean }> = ({ user, showToast, entregador = false }) => {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetEntregue, setSheetEntregue] = useState<Parada | null>(null);
  const [sheetFalhou, setSheetFalhou] = useState<Parada | null>(null);
  const [motivoOutro, setMotivoOutro] = useState('');
  const [motivoSel, setMotivoSel] = useState<string>(MOTIVOS_FALHA[0]);
  // Recebimento por forma de pagamento
  const [valorRecebido, setValorRecebido] = useState('');
  const [valorPix, setValorPix] = useState('');
  const [fotoBoleto, setFotoBoleto] = useState<string | null>(null);
  const [fotoPix, setFotoPix] = useState<string | null>(null);
  // Cupom do pedido (visao entregador)
  const [cupom, setCupom] = useState<Parada | null>(null);
  // Foto do boleto entregue
  const [verFoto, setVerFoto] = useState<Parada | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [fotoLoading, setFotoLoading] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(entregador ? '/api/pre-venda?all=1' : '/api/pre-venda', { headers: authHeaders() });
      const d: ApiResp = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { if (!silencioso) showToast(d.error || 'Erro ao carregar entregas.', 'error'); }
      else setData(d);
    } catch {
      if (mounted.current && !silencioso) showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    mounted.current = true;
    // defer: evita setState sincrono dentro do effect (lint)
    const t0 = setTimeout(() => load(), 0);
    const t = setInterval(() => load(true), 60_000);
    return () => { mounted.current = false; clearTimeout(t0); clearInterval(t); };
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

  // Confirma o recebimento conforme a forma de pagamento
  async function confirmarEntrega(p: Parada, pagamento: string, extra: Record<string, any> = {}) {
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

  // Exclusao de pedido: vendedor ate 11h59 (o servidor revalida; admin qualquer hora)
  async function excluirPedido(p: Parada) {
    const nome = p.cliente.nome || 'cliente';
    if (!window.confirm(`Excluir o pedido de ${nome}?\n\nO pedido sai da rota de entrega.\nRegra: o vendedor pode excluir ate as 11:59 de hoje; apos isso somente o administrador.`)) return;
    await acao({ acao: 'EXCLUIR_VENDA', saleId: p.saleId }, 'Pedido excluido da rota.');
  }

  async function abrirFotoBoleto(p: Parada) {
    setVerFoto(p);
    setFotoUrl(null);
    setFotoLoading(true);
    try {
      const res = await fetch(`/api/pre-venda/foto?saleId=${p.saleId}`, { headers: authHeaders() });
      const d = await res.json();
      if (res.ok && d.foto) setFotoUrl(d.foto);
      else showToast(d.error || 'Foto nao encontrada.', 'error');
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      if (mounted.current) setFotoLoading(false);
    }
  }

  if (loading && !data) {
    return <div className="py-14 flex justify-center"><div className="w-9 h-9 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" /></div>;
  }
  if (!data) return null;

  const paradas = data.paradas || [];
  const secoes: RotaBloco[] = data.rotas && data.rotas.length > 0
    ? data.rotas
    : (data.rota ? [{ rota: data.rota, paradas }] : []);
  const rota = data.rota;
  // Totais globais (entregador soma todas as rotas; vendedor tem uma so)
  const todas = secoes.flatMap(sb => sb.paradas);
  const entregues = todas.filter(p => p.entregaStatus === 'ENTREGUE').length;
  const falhadas = todas.filter(p => p.entregaStatus === 'FALHOU').length;
  const ativas = todas.length - entregues - falhadas;
  const progresso = todas.length > 0 ? Math.round((entregues / todas.length) * 100) : 0;
  const valorRota = todas.reduce((a, p) => a + p.valorTotal, 0);
  const aReceber = todas
    .filter(p => p.entregaStatus !== 'ENTREGUE')
    .reduce((a, p) => a + Math.max(0, p.valorTotal - p.valorPago), 0);
  const rotaImutavel = entregues > 0 || falhadas > 0;

  // Parada em foco no sheet de entrega
  const sp = sheetEntregue;
  const spMetodo = sp ? (PGTO_META[sp.formaPgto] ? sp.formaPgto : 'DINHEIRO') : 'DINHEIRO';
  const rec = parseFloat(valorRecebido) || 0;
  const troco = sp && rec > sp.valorTotal ? rec - sp.valorTotal : 0;
  const falta = sp && rec > 0 && rec < sp.valorTotal ? sp.valorTotal - rec : 0;

  return (
    <div className="space-y-4">
      {/* Bloco 5 (SQL) ainda nao rodou no Supabase */}
      {data.migracaoPendente && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
          <i className="fa-solid fa-database text-amber-500"></i>
          <p className="text-[10px] font-black text-amber-700 uppercase leading-snug">
            Pre-venda em preparacao: aguardando a migracao do banco (Bloco 5). Fale com o administrador.
          </p>
        </div>
      )}

      {/* ===== RESUMO ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-route text-emerald-500 text-xs"></i>
            </div>
            <p className="text-[10px] font-black text-gray-700 uppercase">
              {entregador ? 'Entregas de hoje' : 'Rota de entrega de hoje'}
            </p>
          </div>
          <button onClick={() => load()} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center active:scale-90">
            <i className={`fa-solid fa-rotate text-[11px] ${busy ? 'animate-spin' : ''}`}></i>
          </button>
        </div>

        {todas.length > 0 ? (
          <>
            {/* Entregador: um selo por rota/vendedor */}
            {entregador && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {secoes.map(sb => (
                  <span key={sb.rota.id} className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg ${sb.rota.status === 'CONCLUIDA' ? 'bg-emerald-100 text-emerald-700' : sb.rota.status === 'EM_ROTA' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                    <i className="fa-solid fa-user mr-1"></i>{sb.rota.vendedorNome || 'Vendedor'}: {sb.rota.status === 'CONCLUIDA' ? 'concluida' : sb.rota.status === 'EM_ROTA' ? 'em rota' : 'gerada'}
                  </span>
                ))}
              </div>
            )}
            {!entregador && rota && (
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg ${rota.status === 'CONCLUIDA' ? 'bg-emerald-100 text-emerald-700' : rota.status === 'EM_ROTA' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {rota.status === 'CONCLUIDA' ? 'Concluida' : rota.status === 'EM_ROTA' ? 'Em rota' : 'Gerada'}
                </span>
                <span className="text-[9px] text-gray-400 font-semibold">{todas.length} paradas · {fmt(valorRota)}</span>
              </div>
            )}

            {/* Progresso estilo Shopee */}
            <div className="mt-3">
              <div className="flex justify-between text-[9px] font-black uppercase text-gray-400 mb-1">
                <span>{entregues} de {todas.length} entregues</span>
                <span>{progresso}%</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all" style={{ width: `${progresso}%` }}></div>
              </div>
              <div className="flex gap-3 mt-2 text-[9px] font-bold flex-wrap">
                <span className="text-emerald-600"><i className="fa-solid fa-circle-check mr-1"></i>{entregues} ok</span>
                <span className="text-amber-600"><i className="fa-solid fa-clock mr-1"></i>{ativas} na fila</span>
                {falhadas > 0 && <span className="text-rose-600"><i className="fa-solid fa-circle-xmark mr-1"></i>{falhadas} falhas</span>}
                <span className="text-gray-700"><i className="fa-solid fa-wallet mr-1"></i>A receber: {fmt(aReceber)}</span>
              </div>
            </div>

            {/* Vendedor: inicia a propria rota */}
            {!entregador && rota?.status === 'GERADA' && (
              <button
                onClick={() => acao({ acao: 'INICIAR_ROTA' }, 'Rota iniciada — boas entregas!')}
                disabled={!!busy}
                className="w-full mt-4 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-play"></i> Iniciar rota de entrega
              </button>
            )}
            {!entregador && rota?.status === 'EM_ROTA' && (
              <p className="mt-3 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-[9px] font-bold text-blue-600 text-center uppercase">
                <i className="fa-solid fa-location-dot mr-1"></i>Sua posicao esta sendo registrada para o admin acompanhar
              </p>
            )}

            {/* Vendedor: regenerar enquanto NADA foi registrado (inclui novos pedidos / reordena) */}
            {!entregador && rota && !rotaImutavel && (
              <button
                onClick={() => acao({ acao: 'GERAR_ROTA' }, 'Rota regenerada!')}
                disabled={!!busy}
                className="w-full mt-3 py-3.5 bg-white border-2 border-dashed border-blue-200 text-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-wider active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-rotate"></i> Regenerar rota (reordenar / incluir novos pedidos)
              </button>
            )}
            {!entregador && rota && rotaImutavel && (
              <p className="mt-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-[9px] font-bold text-gray-400 text-center uppercase">
                <i className="fa-solid fa-lock mr-1"></i>Rota travada — ja ha entregas registradas (so o admin pode excluir pedidos)
              </p>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            {entregador ? (
              <>
                <i className="fa-solid fa-truck text-gray-200 text-4xl mb-2 block"></i>
                <p className="text-xs font-black text-gray-700">Nenhuma rota foi gerada hoje ainda.</p>
                <p className="text-[10px] text-gray-400 font-semibold mt-1">Aguarde o vendedor finalizar o dia.</p>
              </>
            ) : data.pendentes && data.pendentes.count > 0 ? (
              <>
                <p className="text-xs font-black text-gray-700">Voce tem {data.pendentes.count} pedido(s) de pre-venda hoje</p>
                <p className="text-[10px] text-gray-400 font-semibold mt-1">Total {fmt(data.pendentes.valor)} — finalize o dia para montar a rota</p>
                <button
                  onClick={() => acao({ acao: 'GERAR_ROTA' }, 'Rota gerada!')}
                  disabled={!!busy}
                  className="mt-4 w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-flag-checkered"></i> Finalizar dia e gerar rota
                </button>
              </>
            ) : (
              <p className="text-xs text-gray-400 font-semibold">Nenhuma pre-venda registrada hoje ainda.<br />Comece atendendo os clientes.</p>
            )}
          </div>
        )}
      </div>

      {/* ===== PARADAS EM ORDEM (agrupadas por vendedor) ===== */}
      {secoes.map(sb => (
        <div key={sb.rota.id} className="space-y-3">
          {/* Cabeçalho por vendedor — o entregador entrega tudo e vê separado */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-1.5">
              <i className="fa-solid fa-user text-[8px]"></i>
              {entregador ? `Vendedor: ${sb.rota.vendedorNome || 'N/D'}` : 'Suas paradas'}
              <span className="text-gray-300 font-normal">·</span>
              <span className="text-gray-400">{sb.paradas.length} paradas</span>
            </p>
            <p className="text-[10px] font-black text-gray-500">{fmt(sb.paradas.reduce((a, p) => a + p.valorTotal, 0))}</p>
          </div>
          {/* Entregador: inicia cada rota para liberar as acoes de entrega */}
          {entregador && sb.rota.status === 'GERADA' && (
            <button
              onClick={() => acao({ acao: 'INICIAR_ROTA', rotaId: sb.rota.id }, 'Rota iniciada — boas entregas!')}
              disabled={!!busy}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-wider shadow-md active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-play"></i> Iniciar rota de {sb.rota.vendedorNome || 'vendedor'}
            </button>
          )}
          {sb.paradas.map(p => {
        const st = STATUS_STYLE[p.entregaStatus] || STATUS_STYLE.PENDENTE;
        const pend = p.entregaStatus === 'PENDENTE' || p.entregaStatus === 'EM_ROTA';
        const zap = zapUrl(p);
        const pg = pgtoMeta(p.formaPgto);
        const ultimoEvento = p.eventos.length > 0 ? p.eventos[p.eventos.length - 1] : null;
        return (
          <div key={p.saleId} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${p.entregaStatus === 'ENTREGUE' ? 'border-emerald-100' : p.entregaStatus === 'FALHOU' ? 'border-rose-100' : 'border-gray-100'}`}>
            <div className="p-4 flex gap-3">
              {/* numero da parada */}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${p.entregaStatus === 'ENTREGUE' ? 'bg-emerald-500 text-white' : p.entregaStatus === 'FALHOU' ? 'bg-rose-500 text-white' : 'bg-gray-800 text-white'}`}>
                {p.seq ?? '·'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[12px] font-black text-gray-800 truncate capitalize">{p.cliente.nome}</p>
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md shrink-0 ${st.chip}`}>{st.label}</span>
                </div>
                {/* endereco escrito no card */}
                <p className="text-[9px] text-gray-400 font-semibold mt-0.5 truncate">
                  <i className="fa-solid fa-location-dot mr-1"></i>{p.cliente.endereco || 'Sem endereco'}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}
                </p>
                <p className="text-[9px] text-gray-500 font-bold mt-1 truncate">
                  {p.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ')}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[12px] font-black text-gray-800">{fmt(p.valorTotal)}</span>
                  {p.statusPagamento === 'PAGO'
                    ? <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md uppercase">Pago</span>
                    : (
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase ${pg.chip}`}>
                        <i className={`${pg.icon} mr-1`}></i>Cobrar {pg.label}
                      </span>
                    )}
                </div>
              </div>
            </div>

            {/* faixa de resultado */}
            {p.entregaStatus === 'ENTREGUE' && (
              <div className="bg-emerald-50 px-4 py-2 border-t border-emerald-100 flex items-center justify-between gap-2">
                <p className="text-[9px] font-black text-emerald-700 uppercase leading-snug">
                  <i className="fa-solid fa-circle-check mr-1"></i>Entregue{ultimoEvento ? ` as ${hora(ultimoEvento.criado_em)}` : ''}{ultimoEvento?.motivo ? ` · ${ultimoEvento.motivo}` : ''}
                </p>
                {p.temFoto && (
                  <button onClick={() => abrirFotoBoleto(p)} className="text-[8px] font-black text-emerald-700 underline uppercase shrink-0">
                    <i className="fa-solid fa-camera mr-0.5"></i>Foto boleto
                  </button>
                )}
              </div>
            )}
            {p.entregaStatus === 'FALHOU' && (
              <div className="bg-rose-50 px-4 py-2 border-t border-rose-100">
                <p className="text-[9px] font-black text-rose-700 uppercase"><i className="fa-solid fa-circle-xmark mr-1"></i>{p.motivo || 'Nao entregue'}</p>
              </div>
            )}

            {/* acoes */}
            <div className="px-4 pb-4 flex flex-wrap gap-2 border-t border-gray-50 pt-3">
              <a href={mapaUrl(p)} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-blue-50 text-blue-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
                <i className="fa-solid fa-diamond-turn-right mr-1"></i>Mapa
              </a>
              {p.cliente.telefone && (
                <a href={`tel:${p.cliente.telefone}`} className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-gray-50 text-gray-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
                  <i className="fa-solid fa-phone mr-1"></i>Ligar
                </a>
              )}
              {zap && (
                <a href={zap} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase text-center active:scale-95 transition-transform">
                  <i className="fa-brands fa-whatsapp mr-1"></i>Zap
                </a>
              )}
              <button
                onClick={() => setCupom(p)}
                className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-amber-50 text-amber-700 text-[9px] font-black uppercase text-center active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-receipt mr-1"></i>Cupom
              </button>
              {pend && !entregador && (
                <button
                  onClick={() => excluirPedido(p)}
                  disabled={!!busy}
                  className="flex-1 min-w-[64px] py-2.5 rounded-xl bg-rose-50 text-rose-500 text-[9px] font-black uppercase text-center active:scale-95 transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-trash-can mr-1"></i>Excluir
                </button>
              )}
            </div>

            {pend && sb.rota.status === 'EM_ROTA' && (
              <div className="px-4 pb-4 flex flex-wrap gap-2">
                <button
                  onClick={() => { setValorRecebido(''); setValorPix(''); setFotoBoleto(null); setFotoPix(null); setSheetEntregue(p); }}
                  disabled={!!busy}
                  className="flex-[1.4] min-w-[90px] py-2.5 rounded-xl bg-emerald-600 text-white text-[9px] font-black uppercase shadow-sm active:scale-95 transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-check mr-1"></i>Entregue
                </button>
                <button
                  onClick={() => { setMotivoSel(MOTIVOS_FALHA[0]); setMotivoOutro(''); setSheetFalhou(p); }}
                  disabled={!!busy}
                  className="flex-1 min-w-[70px] py-2.5 rounded-xl bg-rose-50 text-rose-600 text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-xmark mr-1"></i>Falhou
                </button>
              </div>
            )}
            {pend && sb.rota.status === 'GERADA' && (
              <div className="px-4 pb-3">
                <p className="text-[8px] font-bold text-gray-300 uppercase text-center">Inicie a rota para liberar as acoes</p>
              </div>
            )}
            {p.entregaStatus === 'FALHOU' && sb.rota.status === 'EM_ROTA' && (
              <div className="px-4 pb-4">
                <button
                  onClick={() => acao({ acao: 'REABRIR', saleId: p.saleId }, 'Parada reaberta.')}
                  disabled={!!busy}
                  className="w-full py-2.5 rounded-xl bg-gray-50 text-gray-500 text-[9px] font-black uppercase active:scale-95 transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-rotate-left mr-1"></i>Tentar novamente
                </button>
              </div>
            )}
          </div>
        );
      })}
        </div>
      ))}

      {rota && paradas.length === 0 && (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <i className="fa-solid fa-box-open text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs text-gray-400 font-semibold">Rota sem paradas.</p>
        </div>
      )}

      {/* ===== SHEET: CONFIRMAR ENTREGA / RECEBIMENTO ===== */}
      {sp && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetEntregue(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Entrega #{sp.seq ?? ''} — {sp.cliente.nome}</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1">
              Cliente escolheu pagar com <span className="text-gray-700 font-black uppercase">{pgtoMeta(spMetodo).label}</span>
            </p>

            {/* --- DINHEIRO: valor recebido + troco --- */}
            {spMetodo === 'DINHEIRO' && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-gray-50 rounded-2xl p-4 text-center border border-gray-100">
                  <p className="text-[9px] font-black text-gray-400 uppercase">Valor a receber</p>
                  <p className="text-2xl font-black text-gray-800">{fmt(sp.valorTotal)}</p>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dinheiro recebido R$ (opcional)</label>
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
                  <p className="text-[9px] font-black text-amber-600 text-center uppercase">Faltam {fmt(falta)} — confira com o cliente</p>
                )}
                <button
                  onClick={() => {
                    if (falta > 0) {
                      if (window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(rec)} de ${fmt(sp.valorTotal)}.\nO restante (${fmt(falta)}) continua em aberto no sistema.`)) {
                        confirmarEntrega(sp, 'DINHEIRO', { valorRecebido: rec });
                      }
                      return;
                    }
                    confirmarEntrega(sp, 'DINHEIRO', { valorConfirmado: true, valorRecebido: rec > 0 ? rec : undefined });
                  }}
                  disabled={!!busy}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  <i className="fa-solid fa-check mr-1"></i>
                  {falta > 0 ? `Registrar parcial — recebi ${fmt(rec)}` : `Confirmei que recebi ${fmt(sp.valorTotal)}`}
                </button>
              </div>
            )}

            {/* --- PIX: valor (parcial ok) + FOTO DO COMPROVANTE OBRIGATORIA --- */}
            {spMetodo === 'PIX' && (
              <div className="mt-4 space-y-3 animate-in fade-in duration-300">
                <div className="bg-teal-50 rounded-2xl p-4 text-center border border-teal-100">
                  <i className="fa-brands fa-pix text-teal-600 text-2xl"></i>
                  <p className="text-[9px] font-black text-teal-700 uppercase mt-1">Pagamento via Pix</p>
                  <p className="text-2xl font-black text-teal-800">{fmt(sp.valorTotal)}</p>
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
                    if (pv > 0 && pv < sp.valorTotal) {
                      if (!window.confirm(`Registrar pagamento PARCIAL?\n\nRecebeu ${fmt(pv)} de ${fmt(sp.valorTotal)}.\nO restante (${fmt(sp.valorTotal - pv)}) continua em aberto.`)) return;
                    }
                    confirmarEntrega(sp, 'PIX', { foto: fotoPix, valorRecebido: pv > 0 ? pv : undefined });
                  }}
                  disabled={!!busy || !fotoPix}
                  className="w-full py-4 bg-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <i className="fa-solid fa-check mr-1"></i>Recebi com o comprovante
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

            {/* --- alternativas (qualquer forma) --- */}
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

            <button onClick={() => setSheetEntregue(null)} className="w-full mt-3 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== SHEET: NAO ENTREGUE ===== */}
      {sheetFalhou && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetFalhou(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Nao entregue — #{sheetFalhou.seq ?? ''}</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1">{sheetFalhou.cliente.nome}</p>
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

      {/* ===== MODAL: CUPOM DO PEDIDO ===== */}
      {cupom && (
        <div className="fixed inset-0 z-[160] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCupom(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* cupom */}
            <div className="bg-gray-800 text-white px-5 py-3 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em]">Doce Mania</p>
              <p className="text-[8px] font-bold uppercase text-white/60 mt-0.5">Pedido de Pre-Venda</p>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono">
              <div className="text-center border-b border-dashed border-gray-200 pb-3">
                <p className="text-xs font-black text-gray-800 capitalize">{cupom.cliente.nome}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{cupom.cliente.endereco || 'Sem endereco'}{cupom.cliente.bairro ? ` — ${cupom.cliente.bairro}` : ''}</p>
                {cupom.cliente.telefone && <p className="text-[9px] text-gray-400">{cupom.cliente.telefone}</p>}
              </div>
              <div className="py-3 space-y-1.5 border-b border-dashed border-gray-200">
                {cupom.itens.map((i, idx) => (
                  <div key={idx} className="flex justify-between text-[10px] text-gray-600">
                    <span className="truncate pr-2">{i.quantidade}x {i.nome}</span>
                    <span className="font-bold">{fmt(i.quantidade * (i.precoVenda || 0))}</span>
                  </div>
                ))}
                {cupom.itens.length === 0 && <p className="text-[10px] text-gray-400 text-center">Sem itens detalhados.</p>}
              </div>
              <div className="py-3 space-y-1.5">
                <div className="flex justify-between text-[11px] font-black text-gray-800">
                  <span>TOTAL</span>
                  <span>{fmt(cupom.valorTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-600">
                  <span>Pagamento na entrega</span>
                  <span className={`px-1.5 py-0.5 rounded font-black uppercase text-[8px] ${pgtoMeta(cupom.formaPgto).chip}`}>
                    <i className={`${pgtoMeta(cupom.formaPgto).icon} mr-1`}></i>{pgtoMeta(cupom.formaPgto).label}
                  </span>
                </div>
              </div>
              <p className="text-center text-[8px] text-gray-300 pt-2 border-t border-dashed border-gray-200 uppercase tracking-widest">
                Obrigado pela preferencia!
              </p>
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-100">
              <button onClick={() => setCupom(null)} className="w-full py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: FOTO DO BOLETO ENTREGUE ===== */}
      {verFoto && (
        <div className="fixed inset-0 z-[160] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setVerFoto(null)}>
          <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 bg-amber-500 text-white text-center">
              <p className="text-[10px] font-black uppercase">Foto do boleto entregue</p>
              <p className="text-[9px] font-bold text-white/80 capitalize">{verFoto.cliente.nome}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 bg-gray-50 flex items-center justify-center min-h-[220px]">
              {fotoLoading ? (
                <div className="w-8 h-8 border-4 border-amber-100 border-t-amber-500 rounded-full animate-spin"></div>
              ) : fotoUrl ? (
                <img src={fotoUrl} alt="Foto do boleto entregue" className="w-full rounded-xl" />
              ) : (
                <p className="text-[10px] text-gray-400 font-bold uppercase">Foto nao encontrada.</p>
              )}
            </div>
            <div className="p-4 bg-white border-t border-gray-100">
              <button onClick={() => setVerFoto(null)} className="w-full py-3 text-gray-400 font-bold text-[10px] uppercase tracking-widest">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntregasView;
