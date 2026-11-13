'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 118 — FECHAMENTO DE CAIXA (pedido do dono):
 * "vamos trabalhar em uma nova aba com fechamento de caixa que nos mostra o
 *  dinheiro recebido assim como o pix recebido com comprovantes! esse caixa
 *  podera ser fechado a qualquer instante pelo admin, e sera persistido ate o
 *  fechamento assim como gerara log de pagamentos etc para ter rastreio!"
 *
 * - Mostra o CAIXA ABERTO: dinheiro recebido, pix recebido (com comprovante
 *   foto) e depositos, com o log completo de cada pagamento (origem, cliente,
 *   vendedor, hora).
 * - O ADMIN fecha a qualquer instante: snapshot persistido em caixa_fechamentos
 *   + pagamentos "presos" no fechamento (rastreio imutavel).
 * - Historico de fechamentos passados com detalhe expandivel.
 * - Vendedor/secretario veem em leitura — fechamento é do admin.
 */

interface PagamentoCaixa {
  id: string;
  criadoEm: string;
  origem: string;
  saleId?: string | null;
  cliente?: string | null;
  vendedor?: string | null;
  metodo: string;
  valor: number;
  temComprovante: boolean;
  detalhe?: string | null;
  usuarioNome?: string | null;
}

interface FechamentoResumo {
  id: string;
  fechadoEm: string;
  fechadoPorNome?: string | null;
  totais: { dinheiro: number; pix: number; deposito: number; total: number };
  qtdePagamentos: number;
  observacao?: string | null;
}

interface FechamentoDetalhe extends FechamentoResumo {
  janelaInicio?: string | null;
  pagamentos: PagamentoCaixa[];
}

interface CaixaFechamentoProps {
  user: { id?: string; nome?: string; role?: string } | any;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

const fmt = (v: number) => `R$ ${Number(v || 0).toFixed(2)}`;
const hora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

const ORIGEM_LABEL: Record<string, { txt: string; cls: string }> = {
  VENDA: { txt: 'Venda', cls: 'bg-emerald-50 text-emerald-600' },
  ENTREGA: { txt: 'Entrega', cls: 'bg-amber-50 text-amber-600' },
  RECEBIMENTO: { txt: 'Recebimento', cls: 'bg-rose-50 text-rose-600' },
  PORTAL: { txt: 'Portal', cls: 'bg-violet-50 text-violet-600' },
  AJUSTE: { txt: 'Ajuste', cls: 'bg-gray-100 text-gray-500' },
};

const METODO_LABEL: Record<string, { txt: string; cls: string }> = {
  DINHEIRO: { txt: 'Dinheiro', cls: 'bg-emerald-600 text-white' },
  PIX: { txt: 'Pix', cls: 'bg-violet-600 text-white' },
  DEPOSITO: { txt: 'Depósito', cls: 'bg-slate-600 text-white' },
};

const CaixaFechamento: React.FC<CaixaFechamentoProps> = ({ user, showToast }) => {
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<PagamentoCaixa[]>([]);
  const [totais, setTotais] = useState({ dinheiro: 0, pix: 0, deposito: 0, total: 0 });
  const [desde, setDesde] = useState<string | null>(null);
  const [historico, setHistorico] = useState<FechamentoResumo[]>([]);

  const [modalFechar, setModalFechar] = useState(false);
  const [obs, setObs] = useState('');
  const [fechando, setFechando] = useState(false);

  const [detalhe, setDetalhe] = useState<Record<string, FechamentoDetalhe>>({});
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null);

  const [modalFoto, setModalFoto] = useState<{ foto: string } | null>(null);
  const [carregandoFoto, setCarregandoFoto] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch('/api/caixa', { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErro(String(d?.error || 'Nao foi possivel carregar o caixa.'));
        setPagamentos([]);
        setHistorico([]);
        return;
      }
      setPagamentos(d.aberto?.pagamentos || []);
      setTotais(d.aberto?.totais || { dinheiro: 0, pix: 0, deposito: 0, total: 0 });
      setDesde(d.aberto?.desde || null);
      setHistorico(d.historico || []);
    } catch {
      setErro('Sem conexao para carregar o caixa.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const fecharCaixa = async () => {
    setFechando(true);
    try {
      const res = await fetch('/api/caixa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'FECHAR', observacao: obs }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast?.(String(d?.error || 'Nao foi possivel fechar o caixa.'), 'error');
        return;
      }
      showToast?.(`Caixa fechado — ${fmt(d.fechamento?.totalGeral || 0)} em ${d.fechamento?.qtde ?? 0} pagamento(s)`, 'success');
      setModalFechar(false);
      setObs('');
      setDetalhe({});
      carregar();
    } catch {
      showToast?.('Sem conexao para fechar o caixa.', 'error');
    } finally {
      setFechando(false);
    }
  };

  const verFoto = async (pagamentoId: string) => {
    setCarregandoFoto(true);
    try {
      const res = await fetch(`/api/caixa/foto?id=${encodeURIComponent(pagamentoId)}`, { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast?.(String(d?.error || 'Comprovante nao encontrado.'), 'error');
        return;
      }
      setModalFoto({ foto: d.foto });
    } catch {
      showToast?.('Sem conexao para abrir o comprovante.', 'error');
    } finally {
      setCarregandoFoto(false);
    }
  };

  const abrirFechamento = async (f: FechamentoResumo) => {
    if (detalhe[f.id]) {
      setDetalhe((prev) => { const n = { ...prev }; delete n[f.id]; return n; });
      return;
    }
    setCarregandoDetalhe(f.id);
    try {
      const res = await fetch(`/api/caixa/fechamento?id=${encodeURIComponent(f.id)}`, { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast?.(String(d?.error || 'Nao foi possivel abrir o fechamento.'), 'error');
        return;
      }
      setDetalhe((prev) => ({ ...prev, [f.id]: d.fechamento }));
    } catch {
      showToast?.('Sem conexao para abrir o fechamento.', 'error');
    } finally {
      setCarregandoDetalhe(null);
    }
  };

  const renderPagamento = (p: PagamentoCaixa, fechado = false) => {
    const o = ORIGEM_LABEL[p.origem] || ORIGEM_LABEL.AJUSTE;
    const m = METODO_LABEL[p.metodo] || { txt: p.metodo, cls: 'bg-gray-400 text-white' };
    return (
      <div key={`${p.id}-${fechado ? 'f' : 'a'}`} className="p-3 flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-md ${o.cls}`}>{o.txt}</span>
            <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-md ${m.cls}`}>{m.txt}</span>
            {p.cliente && <span className="text-[9px] font-black text-gray-700 uppercase truncate">{p.cliente}</span>}
          </div>
          <p className="text-[8px] text-gray-400 font-bold uppercase mt-1 truncate">
            {hora(p.criadoEm)}{p.vendedor ? ` · ${p.vendedor}` : ''}{p.usuarioNome ? ` · por ${p.usuarioNome}` : ''}
          </p>
          {p.detalhe && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 truncate">{p.detalhe}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {p.temComprovante && (
            <button
              onClick={() => verFoto(p.id)}
              className="w-9 h-9 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center border border-violet-100 active:scale-90 transition-all"
              title="Ver comprovante"
            >
              <i className="fa-solid fa-image text-xs"></i>
            </button>
          )}
          <p className={`text-[11px] font-black text-right ${p.metodo === 'DINHEIRO' ? 'text-emerald-600' : p.metodo === 'PIX' ? 'text-violet-600' : 'text-slate-600'}`}>
            {fmt(p.valor)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="px-2">
        <h2 className="text-2xl font-black text-gray-800 tracking-tight">Fechamento de Caixa</h2>
        <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">
          {desde ? `Caixa aberto desde ${new Date(desde).toLocaleDateString('pt-BR')} ${new Date(desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Caixa aberto — primeiro período'}
          {!isAdmin && ' · fechamento pelo admin'}
        </p>
      </div>

      {loading && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
          <i className="fa-solid fa-spinner fa-spin text-2xl text-gray-300"></i>
          <p className="text-[9px] font-black uppercase text-gray-400 mt-3 tracking-widest">Carregando caixa...</p>
        </div>
      )}

      {!loading && erro && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 mx-1">
          <p className="text-[9px] font-bold text-rose-600 leading-relaxed uppercase">
            <i className="fa-solid fa-triangle-exclamation mr-1"></i>{erro}
          </p>
          <button onClick={carregar} className="mt-2 bg-rose-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase active:scale-95">Tentar de novo</button>
        </div>
      )}

      {!loading && !erro && (
        <>
          {/* Totais do caixa aberto */}
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md mx-1">
            <p className="text-[8px] font-black text-gray-400 uppercase mb-3">Dinheiro e Pix recebidos (caixa aberto)</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="text-center bg-emerald-50 p-3 rounded-2xl">
                <i className="fa-solid fa-money-bill-wave text-emerald-500 text-sm"></i>
                <p className="text-[7px] font-black text-emerald-500 uppercase mt-1">Dinheiro</p>
                <p className="text-[11px] font-black text-emerald-700">{fmt(totais.dinheiro)}</p>
              </div>
              <div className="text-center bg-violet-50 p-3 rounded-2xl">
                <i className="fa-solid fa-qrcode text-violet-500 text-sm"></i>
                <p className="text-[7px] font-black text-violet-500 uppercase mt-1">Pix</p>
                <p className="text-[11px] font-black text-violet-700">{fmt(totais.pix)}</p>
              </div>
              <div className="text-center bg-slate-50 p-3 rounded-2xl">
                <i className="fa-solid fa-building-columns text-slate-500 text-sm"></i>
                <p className="text-[7px] font-black text-slate-500 uppercase mt-1">Depósito</p>
                <p className="text-[11px] font-black text-slate-700">{fmt(totais.deposito)}</p>
              </div>
            </div>
            <div className="bg-gray-900 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[8px] font-black text-white opacity-60 uppercase">Total no caixa</p>
                <p className="text-xl font-black text-emerald-400">{fmt(totais.total)}</p>
              </div>
              <i className="fa-solid fa-cash-register text-emerald-400/30 text-2xl"></i>
            </div>
            {isAdmin && (
              <button
                onClick={() => setModalFechar(true)}
                className="w-full mt-3 bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest"
              >
                <i className="fa-solid fa-lock mr-2"></i>Fechar caixa agora
              </button>
            )}
          </div>

          {/* Log de pagamentos do caixa aberto (rastreio) */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="text-[10px] font-black text-gray-800 uppercase tracking-widest"><i className="fa-solid fa-receipt text-emerald-500 mr-2"></i>Log de pagamentos</h3>
              <span className="text-[8px] font-black text-gray-400 uppercase">{pagamentos.length} registro(s)</span>
            </div>
            <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
              {pagamentos.length === 0 && (
                <div className="text-center py-10 px-4">
                  <i className="fa-solid fa-inbox text-3xl text-gray-200"></i>
                  <p className="text-[9px] font-black uppercase text-gray-400 mt-2 tracking-widest">Nenhum pagamento no caixa aberto</p>
                  <p className="text-[8px] font-bold text-gray-300 uppercase mt-1">Vendas a vista, entregas, recebimentos e pix do portal entram aqui</p>
                </div>
              )}
              {pagamentos.slice().reverse().map((p) => renderPagamento(p))}
            </div>
          </div>

          {/* Histórico de fechamentos (persistido) */}
          <div className="px-1 pt-1">
            <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider px-1 mb-3"><i className="fa-solid fa-box-archive text-slate-500 mr-2"></i>Caixas fechados</h3>
            {historico.length === 0 && (
              <p className="text-center py-6 opacity-30 text-[9px] uppercase font-bold tracking-widest">Nenhum fechamento ainda.</p>
            )}
            <div className="grid gap-3">
              {historico.map((f) => (
                <div key={f.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                  <button onClick={() => abrirFechamento(f)} className="w-full p-4 flex items-center justify-between gap-2 active:bg-gray-50 transition-colors text-left">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-gray-800 uppercase">
                        {new Date(f.fechadoEm).toLocaleDateString('pt-BR')} {new Date(f.fechadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        <span className="text-gray-400 font-bold normal-case"> · {f.fechadoPorNome || 'admin'}</span>
                      </p>
                      <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">
                        {f.qtdePagamentos} pagamento(s) · Din {fmt(f.totais.dinheiro)} · Pix {fmt(f.totais.pix)}{f.totais.deposito > 0 ? ` · Dep ${fmt(f.totais.deposito)}` : ''}
                      </p>
                      {f.observacao && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 truncate">{f.observacao}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <p className="text-sm font-black text-gray-700">{fmt(f.totais.total)}</p>
                      {carregandoDetalhe === f.id ? <i className="fa-solid fa-spinner fa-spin text-gray-300 text-sm"></i> : <i className={`fa-solid fa-chevron-${detalhe[f.id] ? 'up' : 'down'} text-gray-300 text-xs`}></i>}
                    </div>
                  </button>
                  {detalhe[f.id] && (
                    <div className="border-t border-gray-50 divide-y divide-gray-50 max-h-72 overflow-y-auto bg-gray-50/50">
                      {detalhe[f.id].pagamentos.length === 0 && <p className="text-center py-4 text-[8px] font-black uppercase text-gray-300">Sem registros no snapshot.</p>}
                      {detalhe[f.id].pagamentos.map((p) => renderPagamento(p, true))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Modal: fechar caixa (admin) */}
      {modalFechar && (
        <div className="fixed inset-0 z-[400] bg-black/60 flex items-end justify-center sm:items-center p-4" onClick={() => !fechando && setModalFechar(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <i className="fa-solid fa-lock text-emerald-600"></i>Fechar o caixa agora
            </h3>
            <p className="text-[9px] font-bold text-gray-400 uppercase mt-1">O caixa atual fica PERSISTIDO para rastreio e um novo período começa vazio.</p>
            <div className="bg-gray-50 rounded-2xl p-4 mt-4 space-y-1.5">
              <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-emerald-600">Dinheiro</span><span className="text-gray-700">{fmt(totais.dinheiro)}</span></div>
              <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-violet-600">Pix</span><span className="text-gray-700">{fmt(totais.pix)}</span></div>
              {totais.deposito > 0 && <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-slate-600">Depósito</span><span className="text-gray-700">{fmt(totais.deposito)}</span></div>}
              <div className="flex justify-between text-sm font-black uppercase pt-1 border-t border-gray-200"><span className="text-gray-800">Total</span><span className="text-emerald-600">{fmt(totais.total)}</span></div>
              <p className="text-[8px] font-bold text-gray-400 uppercase">{pagamentos.length} pagamento(s) no log</p>
            </div>
            <div className="mt-4">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Observação (opcional)</label>
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="Ex: conferido com o dinheiro na gaveta..."
                className="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-semibold outline-none resize-none"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModalFechar(false)} disabled={fechando} className="flex-1 bg-gray-100 text-gray-500 font-black py-3.5 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95">Cancelar</button>
              <button onClick={fecharCaixa} disabled={fechando} className="flex-1 bg-emerald-600 text-white font-black py-3.5 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg active:scale-95">
                {fechando ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Confirmar fechamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: comprovante (foto) */}
      {modalFoto && (
        <div className="fixed inset-0 z-[400] bg-black/70 flex items-center justify-center p-4" onClick={() => setModalFoto(null)}>
          <div className="bg-white rounded-3xl p-3 max-w-lg w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="text-[9px] font-black uppercase text-gray-500 tracking-widest">Comprovante do pagamento</p>
              <button onClick={() => setModalFoto(null)} className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-xmark text-gray-500"></i></button>
            </div>
            <img src={modalFoto.foto} alt="Comprovante do pagamento recebido no caixa" className="w-full rounded-2xl max-h-[70vh] object-contain bg-gray-50" />
          </div>
        </div>
      )}
    </div>
  );
};

export default CaixaFechamento;
