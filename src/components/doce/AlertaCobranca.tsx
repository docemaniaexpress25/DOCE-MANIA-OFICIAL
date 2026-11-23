'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 211 — ALERTA DE VENDAS SEM COBRANCA (pedido do dono):
 * "cria tbm um sistema onde nao deixamos passar nenhuma venda sem cobrar,
 * tanto a vista como prazo... esquecemos de gerar esse boleto entao precisa
 * nos avisa."
 *
 * Card que fica no TOPO da HOME (admin e vendedor) e AVISA quando existe:
 *  - VENDA A PRAZO sem boleto gerado (o caso do exemplo: vendeu a prazo,
 *    ninguem gerou o boleto) — badge VERMELHO "BOLETO NAO GERADO";
 *  - VENDA A VISTA sem recebimento registrado — badge AMBAR "SEM RECEBIMENTO".
 *
 * Acoes por item:
 *  - WHATSAPP: mensagem de cobranca (a mesma do portal /cobrancas, com os
 *    placeholders {nome} {valor} {dias} preenchidos);
 *  - ABRIR VENDA: abre o CUPOM da venda — la dentro o card do boleto tem
 *    GERAR BOLETO (e, depois de gerado, o botao CANCELAR BOLETO do Bloco 210
 *    para trocar a data quando o cliente pedir).
 *
 * Recarrega ao abrir a home, ao voltar o foco da janela e a cada 5 minutos.
 * Quando nao existe NADA em aberto o card nao aparece (zero ruido).
 */

export interface PendenciaCobranca {
  saleId: string;
  dataVenda: string;
  dias: number;
  cliente: string;
  telefone: string;
  valorTotal: number;
  valorPago: number;
  saldo: number;
  metodo: string;
  tipo: 'BOLETO_NAO_GERADO' | 'AVISTA_SEM_PAGAMENTO';
  vendedor: string;
  parcelasPendentes?: number;
}

interface AlertaCobrancaProps {
  /** Abre o cupom da venda (admin: selectedSale / vendedor: viewingSale) */
  onAbrirVenda?: (saleId: string) => void;
}

const fmt = (n: number): string => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Mesma montagem do portal de cobrancas: placeholders do template da ERP. */
function montarMensagem(tpl: string, p: PendenciaCobranca): string {
  return String(tpl || '')
    .replaceAll('{nome}', p.cliente)
    .replaceAll('{valor}', fmt(p.saldo))
    .replaceAll('{vencimento}', p.dataVenda.slice(0, 10).split('-').reverse().join('/'))
    .replaceAll('{dias}', String(p.dias));
}

const AlertaCobranca: React.FC<AlertaCobrancaProps> = ({ onAbrirVenda }) => {
  const [pendencias, setPendencias] = useState<PendenciaCobranca[]>([]);
  const [mensagem, setMensagem] = useState('');
  const [expandido, setExpandido] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const aliveRef = useRef(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/pendencias-cobranca', { headers: { ...authHeaders() } });
      if (!res.ok) { setPendencias([]); return; }
      const j = await res.json();
      if (!aliveRef.current) return;
      setPendencias(Array.isArray(j.pendencias) ? j.pendencias : []);
      setMensagem(String(j.mensagemPadrao || ''));
    } catch {
      if (aliveRef.current) setPendencias([]);
    } finally {
      if (aliveRef.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void carregar();
    const onFocus = () => { void carregar(); };
    window.addEventListener('focus', onFocus);
    const iv = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void carregar(); }, 300_000);
    return () => { aliveRef.current = false; window.removeEventListener('focus', onFocus); clearInterval(iv); };
  }, [carregar]);

  if (pendencias.length === 0) return null;

  const boletoPend = pendencias.filter(p => p.tipo === 'BOLETO_NAO_GERADO').length;
  const avistaPend = pendencias.length - boletoPend;
  const saldoTotal = Math.round(pendencias.reduce((a, p) => a + p.saldo, 0) * 100) / 100;

  return (
    <div className="rounded-3xl border-2 border-rose-200 bg-white shadow-sm overflow-hidden">
      {/* Cabecalho: contagem + total (expande/recolhe) */}
      <button onClick={() => setExpandido(!expandido)} className="w-full bg-rose-600 px-4 py-3.5 flex items-center gap-3 text-left active:scale-[0.99] transition-transform" aria-expanded={expandido}>
        <span className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center shrink-0 relative">
          <i className={`fa-solid ${carregando ? 'fa-spinner fa-spin' : 'fa-triangle-exclamation'} text-white`}></i>
          {!carregando && <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 bg-amber-400 text-rose-900 text-[9px] font-black rounded-full flex items-center justify-center border border-white">{pendencias.length > 9 ? '9+' : pendencias.length}</span>}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-black uppercase text-white tracking-wide">Vendas sem cobrança</span>
          <span className="block text-[8.5px] font-bold text-white/80 leading-snug">
            {boletoPend > 0 && <>{boletoPend} sem boleto gerado{avistaPend > 0 ? ' · ' : ''}</>}
            {avistaPend > 0 && <>{avistaPend} à vista sem recebimento</>}
            {' · '}{fmt(saldoTotal)}
          </span>
        </span>
        <i className={`fa-solid fa-chevron-${expandido ? 'up' : 'down'} text-white/80 text-xs`}></i>
      </button>

      {expandido && (
        <div className="p-3 space-y-2">
          <p className="text-[8px] font-bold text-gray-400 leading-snug px-1">
            Nenhuma venda pode passar sem cobrar: a prazo SEM boleto gerado e à vista SEM recebimento ficam aqui até a cobrança sair. “Abrir” leva direto ao cupom da venda (gerar/cancelar boleto).
          </p>
          <div className="space-y-2 max-h-96 overflow-y-auto cobrancas-scroll pr-0.5">
            {pendencias.map(p => {
              const tipoBoleto = p.tipo === 'BOLETO_NAO_GERADO';
              const msg = montarMensagem(mensagem, p);
              return (
                <div key={p.saleId} className={`rounded-2xl border p-2.5 space-y-1.5 ${tipoBoleto ? 'border-rose-200 bg-rose-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[7.5px] font-black uppercase px-1.5 py-0.5 rounded-md ${tipoBoleto ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'}`}>
                      {tipoBoleto ? 'Boleto não gerado' : 'À vista sem recebimento'}
                    </span>
                    <span className="text-[8px] font-black text-gray-400 uppercase flex-1 truncate text-right">
                      {p.vendedor || '—'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-black text-gray-800 truncate flex-1">{p.cliente}</span>
                    <span className="text-[11px] font-black text-gray-800 whitespace-nowrap">{fmt(p.saldo)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[8px] font-black text-gray-500 bg-white border border-gray-200 rounded-md px-1.5 py-0.5">{p.dias === 0 ? 'hoje' : `${p.dias} dia${p.dias === 1 ? '' : 's'}`}</span>
                    <span className="text-[8px] font-bold text-gray-400 uppercase">{p.metodo === 'A_PRAZO' ? 'a prazo' : 'à vista'}</span>
                    {p.parcelasPendentes ? (
                      <span className="text-[8px] font-black text-rose-600 bg-rose-100 rounded-md px-1.5 py-0.5">{p.parcelasPendentes} parcela{p.parcelasPendentes === 1 ? '' : 's'} sem emitir</span>
                    ) : null}
                    <span className="text-[8px] font-bold text-gray-300">#{p.saleId.slice(0, 8).toUpperCase()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    {onAbrirVenda && (
                      <button onClick={() => onAbrirVenda(p.saleId)}
                        className="bg-slate-800 text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 flex items-center justify-center gap-1">
                        <i className="fa-solid fa-receipt"></i>Abrir venda
                      </button>
                    )}
                    {p.telefone ? (
                      <a href={`https://wa.me/${p.telefone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                        className={`text-white font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest active:scale-95 flex items-center justify-center gap-1 bg-green-600 ${!onAbrirVenda ? 'col-span-2' : ''}`}>
                        <i className="fa-brands fa-whatsapp text-sm"></i>WhatsApp
                      </a>
                    ) : (
                      <button disabled title="Cliente sem telefone no cadastro"
                        className={`bg-gray-100 text-gray-300 font-black py-2.5 rounded-xl text-[8px] uppercase tracking-widest cursor-not-allowed ${!onAbrirVenda ? 'col-span-2' : ''}`}>
                        <i className="fa-brands fa-whatsapp mr-1"></i>Sem WhatsApp
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertaCobranca;
