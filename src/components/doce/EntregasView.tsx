"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '@/lib/types';
import { authHeaders } from '@/services/userService';

/**
 * ENTREGAS — visao do entregador (estilo Shopee):
 * rota do dia gerada ao finalizar o dia de pre-venda, paradas numeradas
 * em ordem, progresso, mapa, WhatsApp e confirmacao de entrega com cobranca.
 */

interface Parada {
  saleId: string;
  seq: number | null;
  entregaStatus: string; // PENDENTE | EM_ROTA | ENTREGUE | FALHOU
  valorTotal: number;
  valorPago: number;
  statusPagamento: string;
  motivo: string | null;
  cliente: { id: string; nome: string; endereco: string; bairro: string; telefone: string; lat: number | null; lng: number | null };
  itens: { nome: string; quantidade: number }[];
  eventos: { status: string; motivo: string | null; criado_em: string }[];
}
interface Rota {
  id: string; data: string; status: string; totalParadas: number;
  criadaEm: string; iniciadaEm: string | null; concluidaEm: string | null;
  vendedorId: string; vendedorNome: string;
}
interface ApiResp {
  hoje: string; rota: Rota | null; paradas: Parada[];
  pendentes?: { count: number; valor: number };
  migracaoPendente?: boolean;
  error?: string;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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

const EntregasView: React.FC<{ user: User; showToast: (m: string, t?: 'success' | 'error') => void }> = ({ user, showToast }) => {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetEntregue, setSheetEntregue] = useState<Parada | null>(null);
  const [sheetFalhou, setSheetFalhou] = useState<Parada | null>(null);
  const [motivoOutro, setMotivoOutro] = useState('');
  const [motivoSel, setMotivoSel] = useState<string>(MOTIVOS_FALHA[0]);
  const mounted = useRef(true);

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch('/api/pre-venda', { headers: authHeaders() });
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

  if (loading && !data) {
    return <div className="py-14 flex justify-center"><div className="w-9 h-9 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" /></div>;
  }
  if (!data) return null;

  const rota = data.rota;
  const paradas = data.paradas || [];
  const entregues = paradas.filter(p => p.entregaStatus === 'ENTREGUE').length;
  const falhadas = paradas.filter(p => p.entregaStatus === 'FALHOU').length;
  const ativas = paradas.length - entregues - falhadas;
  const progresso = paradas.length > 0 ? Math.round((entregues / paradas.length) * 100) : 0;
  const valorRota = paradas.reduce((a, p) => a + p.valorTotal, 0);

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

      {/* ===== RESUMO DA ROTA ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
              <i className="fa-solid fa-route text-emerald-500 text-xs"></i>
            </div>
            <p className="text-[10px] font-black text-gray-700 uppercase">Rota de entrega de hoje</p>
          </div>
          <button onClick={() => load()} className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center active:scale-90">
            <i className={`fa-solid fa-rotate text-[11px] ${busy ? 'animate-spin' : ''}`}></i>
          </button>
        </div>

        {rota ? (
          <>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg ${rota.status === 'CONCLUIDA' ? 'bg-emerald-100 text-emerald-700' : rota.status === 'EM_ROTA' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                {rota.status === 'CONCLUIDA' ? 'Concluida' : rota.status === 'EM_ROTA' ? 'Em rota' : 'Gerada'}
              </span>
              <span className="text-[9px] text-gray-400 font-semibold">{paradas.length} paradas · {fmt(valorRota)}</span>
            </div>

            {/* Progresso estilo Shopee */}
            <div className="mt-3">
              <div className="flex justify-between text-[9px] font-black uppercase text-gray-400 mb-1">
                <span>{entregues} de {paradas.length} entregues</span>
                <span>{progresso}%</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all" style={{ width: `${progresso}%` }}></div>
              </div>
              <div className="flex gap-3 mt-2 text-[9px] font-bold">
                <span className="text-emerald-600"><i className="fa-solid fa-circle-check mr-1"></i>{entregues} ok</span>
                <span className="text-amber-600"><i className="fa-solid fa-clock mr-1"></i>{ativas} na fila</span>
                {falhadas > 0 && <span className="text-rose-600"><i className="fa-solid fa-circle-xmark mr-1"></i>{falhadas} falhas</span>}
              </div>
            </div>

            {rota.status === 'GERADA' && (
              <button
                onClick={() => acao({ acao: 'INICIAR_ROTA' }, 'Rota iniciada — boas entregas!')}
                disabled={!!busy}
                className="w-full mt-4 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-play"></i> Iniciar rota de entrega
              </button>
            )}
            {rota.status === 'EM_ROTA' && (
              <p className="mt-3 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-[9px] font-bold text-blue-600 text-center uppercase">
                <i className="fa-solid fa-location-dot mr-1"></i>Sua posicao esta sendo registrada para o admin acompanhar
              </p>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <i className="fa-solid fa-clipboard-list text-gray-200 text-4xl mb-2 block"></i>
            {data.pendentes && data.pendentes.count > 0 ? (
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

      {/* ===== PARADAS EM ORDEM ===== */}
      {paradas.map(p => {
        const st = STATUS_STYLE[p.entregaStatus] || STATUS_STYLE.PENDENTE;
        const pend = p.entregaStatus === 'PENDENTE' || p.entregaStatus === 'EM_ROTA';
        const zap = zapUrl(p);
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
                <p className="text-[9px] text-gray-400 font-semibold mt-0.5 truncate">
                  <i className="fa-solid fa-location-dot mr-1"></i>{p.cliente.endereco || 'Sem endereco'}{p.cliente.bairro ? ` — ${p.cliente.bairro}` : ''}
                </p>
                <p className="text-[9px] text-gray-500 font-bold mt-1 truncate">
                  {p.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ')}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[12px] font-black text-gray-800">{fmt(p.valorTotal)}</span>
                  {p.statusPagamento === 'PAGO'
                    ? <span className="text-[8px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md uppercase">Pago</span>
                    : <span className="text-[8px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md uppercase">Cobrar na entrega</span>}
                </div>
              </div>
            </div>

            {/* faixa de resultado */}
            {p.entregaStatus === 'ENTREGUE' && (
              <div className="bg-emerald-50 px-4 py-2 border-t border-emerald-100">
                <p className="text-[9px] font-black text-emerald-700 uppercase">
                  <i className="fa-solid fa-circle-check mr-1"></i>Entregue{ultimoEvento ? ` as ${hora(ultimoEvento.criado_em)}` : ''}{ultimoEvento?.motivo ? ` · ${ultimoEvento.motivo}` : ''}
                </p>
              </div>
            )}
            {p.entregaStatus === 'FALHOU' && (
              <div className="bg-rose-50 px-4 py-2 border-t border-rose-100">
                <p className="text-[9px] font-black text-rose-700 uppercase"><i className="fa-solid fa-circle-xmark mr-1"></i>{p.motivo || 'Nao entregue'}</p>
              </div>
            )}

            {/* acoes */}
            {pend && rota?.status === 'EM_ROTA' && (
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
                  onClick={() => { setMotivoSel(MOTIVOS_FALHA[0]); setMotivoOutro(''); setSheetEntregue(p); }}
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
            {pend && rota?.status === 'GERADA' && (
              <div className="px-4 pb-3 pt-1">
                <p className="text-[8px] font-bold text-gray-300 uppercase text-center">Inicie a rota para liberar as acoes</p>
              </div>
            )}
            {p.entregaStatus === 'FALHOU' && rota?.status === 'EM_ROTA' && (
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

      {rota && paradas.length === 0 && (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <i className="fa-solid fa-box-open text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs text-gray-400 font-semibold">Rota sem paradas.</p>
        </div>
      )}

      {/* ===== SHEET: CONFIRMAR ENTREGA ===== */}
      {sheetEntregue && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={() => setSheetEntregue(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center">Entrega #{sheetEntregue.seq ?? ''} — {sheetEntregue.cliente.nome}</h3>
            <p className="text-[10px] text-gray-400 font-semibold text-center mt-1">Recebeu {fmt(sheetEntregue.valorTotal)}?</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={() => { const p = sheetEntregue; setSheetEntregue(null); acao({ acao: 'ENTREGUE', saleId: p.saleId, pagamento: 'DINHEIRO' }, 'Entrega confirmada — dinheiro!'); }}
                className="py-4 rounded-2xl bg-emerald-600 text-white text-[10px] font-black uppercase shadow-md active:scale-95 transition-transform">
                <i className="fa-solid fa-money-bill-wave mr-1"></i>Dinheiro
              </button>
              <button onClick={() => { const p = sheetEntregue; setSheetEntregue(null); acao({ acao: 'ENTREGUE', saleId: p.saleId, pagamento: 'PIX' }, 'Entrega confirmada — Pix!'); }}
                className="py-4 rounded-2xl bg-teal-600 text-white text-[10px] font-black uppercase shadow-md active:scale-95 transition-transform">
                <i className="fa-brands fa-pix mr-1"></i>Pix
              </button>
              <button onClick={() => { const p = sheetEntregue; setSheetEntregue(null); acao({ acao: 'ENTREGUE', saleId: p.saleId, pagamento: 'JA_PAGO' }, 'Entrega confirmada — ja pago!'); }}
                className="py-4 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase shadow-md active:scale-95 transition-transform">
                <i className="fa-solid fa-circle-check mr-1"></i>Ja pagou
              </button>
              <button onClick={() => { const p = sheetEntregue; setSheetEntregue(null); acao({ acao: 'ENTREGUE', saleId: p.saleId, pagamento: 'NAO_PAGO' }, 'Entrega confirmada — a receber!'); }}
                className="py-4 rounded-2xl bg-amber-500 text-white text-[10px] font-black uppercase shadow-md active:scale-95 transition-transform">
                <i className="fa-solid fa-hand-holding-dollar mr-1"></i>Nao cobrou
              </button>
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
    </div>
  );
};

export default EntregasView;
