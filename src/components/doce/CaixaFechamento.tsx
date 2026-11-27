'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '@/services/userService';
import ConfirmModal from '@/components/doce/ConfirmModal';
// BLOCO 232: recibo do pagamento ao David — valor por extenso
import { valorPorExtenso } from '@/lib/extenso';

/**
 * BLOCO 118 — FECHAMENTO DE CAIXA (pedido do dono): caixa persistido do
 * David (Rota 5) com log de cada pagamento (origem, comprovante, hora).
 * BLOCO 167: caixa sempre atualiza (polling 20s); FECHAR só trava o À VISTA;
 * boletos pendentes sobrevivem ao fechamento e só "zeram" quando o pagamento
 * a prazo ocorrer (trigger SQL 167 marca pago_em).
 *
 * BLOCO 232: contas do David + PAGAMENTO AO DAVID com valor digitado pelo
 * admin e RECIBO numerado imprimível (caixa_repasses_david, SQL 232).
 *
 * BLOCO 233 (regra do dono — A LINHA DO CAIXA, números fáceis sem poluição):
 *   "total de vendas geradas isso em azul, em Verde tudo o que foi recebido
 *   a vista Dinheiro + Pix e tbm prazo já pago na mesma linha tudo que ainda
 *   está a prazo... meus cálculos serão encima do que já entrou no caixa...
 *   quando o caixa for fechado vc deve perguntar se realmente deseja fechar,
 *   então ali zeramos os contadores do que foi recebido e continuamos tendo
 *   visão do que vai entrar, conforme vai entrando vai caindo em recebidos."
 *
 *   A TELA MOSTRA UMA ÚNICA LINHA COM OS 3 NÚMEROS:
 *   - AZUL — Total gerado: vendas à vista + a prazo do período (do caixa).
 *   - VERDE — Recebido no caixa: o que JÁ ENTROU = Dinheiro + Pix à vista +
 *     prazo já pago (baixa dos boletos). É EM CIMA DO VERDE que o dono faz
 *     os cálculos/pagamento do David.
 *   - A PRAZO — Ainda vai entrar: saldo dos boletos em aberto (não zera no
 *     fechamento; quando o pagamento cai, entra no VERDE do período).
 *
 *   FLUXO DO FECHAMENTO: a tela PERGUNTA "Deseja realmente fechar o caixa?" —
 *   confirmando, o dinheiro recebido SAI DA MÃO DO DAVID e entra no caixa da
 *   empresa, os contadores de RECEBIDOS ZERAM (novo período) e o A PRAZO
 *   continua visível até o pagamento cair.
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

// ---------------------------------------------------------------------------
// BLOCO 232/233 — resumo das contas do David. recebidoNoCaixa (VERDE) é
// calculado no SERVIDOR (fonte única da verdade): à vista + prazo já pago.
// ---------------------------------------------------------------------------
interface ResumoCaixa {
  vista: { dinheiro: number; pix: number; deposito: number; total: number; qtde: number };
  prazo: {
    geradoNoPeriodo: number; qtdeGerados: number;
    recebidoNoPeriodo: number; qtdeRecebidos: number;
    recebidosLista: { id: string; pagoEm: string; valor: number; cliente?: string | null; saleId?: string | null }[];
    pendentes: number; qtdePendentes: number;
  };
  totalGerado: number;
  recebidoNoCaixa?: number;
}

interface RepasseDavid {
  id: string;
  reciboNumero: number;
  criadoEm: string;
  valor: number;
  forma: string;
  observacao?: string | null;
  registradoPorNome?: string | null;
}

// BLOCO 233: item unificado da lista de RECEBIDOS (à vista + prazo pago)
interface ItemRecebido {
  key: string;
  tipo: 'AVISTA' | 'PRAZOPAGO';
  metodo: string;
  id: string;
  valor: number;
  cliente?: string | null;
  quando: string;
  origem?: string | null;
  temComprovante?: boolean;
  detalhe?: string | null;
  usuarioNome?: string | null;
  pagoEm?: string | null;
}

interface CaixaFechamentoProps {
  user: { id?: string; nome?: string; role?: string } | any;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

// BLOCO 233: números fáceis — formato BR (1.234,56)
const fmt = (v: number) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  // BLOCO 165: boleto (venda a prazo do David) agora entra no caixa
  BOLETO: { txt: 'Boleto', cls: 'bg-amber-500 text-white' },
};

const CaixaFechamento: React.FC<CaixaFechamentoProps> = ({ user, showToast }) => {
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<PagamentoCaixa[]>([]);
  const [totais, setTotais] = useState({ dinheiro: 0, pix: 0, deposito: 0, boleto: 0, total: 0 });
  const [desde, setDesde] = useState<string | null>(null);
  const [historico, setHistorico] = useState<FechamentoResumo[]>([]);

  const [modalFechar, setModalFechar] = useState(false);
  const [obs, setObs] = useState('');
  const [fechando, setFechando] = useState(false);

  const [detalhe, setDetalhe] = useState<Record<string, FechamentoDetalhe>>({});
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null);

  const [modalFoto, setModalFoto] = useState<{ foto: string } | null>(null);
  const [carregandoFoto, setCarregandoFoto] = useState(false);
  // BLOCO 167: caixa "sempre atualiza" — momento do último refresh (hint na tela)
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  // BLOCO 124: correção do caixa — o ADMIN/SECRETARIO apaga registro ERRADO do
  // ledger aberto (a venda NÃO é tocada). Ex.: recebimento a prazo que poluiu
  // o caixa à vista do David.
  const [excluirAlvo, setExcluirAlvo] = useState<PagamentoCaixa | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // BLOCO 232: contas do David no período + pagamentos ao David (recibos)
  const [resumo, setResumo] = useState<ResumoCaixa | null>(null);
  const [repasses, setRepasses] = useState<RepasseDavid[]>([]);
  const [repassesSqlOk, setRepassesSqlOk] = useState(true);
  const [modalRepasse, setModalRepasse] = useState(false);
  const [repValor, setRepValor] = useState('');
  const [repForma, setRepForma] = useState<'DINHEIRO' | 'PIX'>('DINHEIRO');
  const [repObs, setRepObs] = useState('');
  const [registrandoRep, setRegistrandoRep] = useState(false);

  // BLOCO 233: filtro da lista de recebidos (conferência direta por forma)
  const [filtroRecebidos, setFiltroRecebidos] = useState<'TUDO' | 'DINHEIRO' | 'PIX' | 'PRAZO'>('TUDO');

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    setErro(null);
    try {
      const res = await fetch('/api/caixa', { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErro(String(d?.error || 'Nao foi possivel carregar o caixa.'));
        if (!silencioso) {
          setPagamentos([]);
          setHistorico([]);
        }
        return;
      }
      setPagamentos(d.aberto?.pagamentos || []);
      setTotais(d.aberto?.totais || { dinheiro: 0, pix: 0, deposito: 0, boleto: 0, total: 0 });
      setDesde(d.aberto?.desde || null);
      setHistorico(d.historico || []);
      // BLOCO 232: resumo das contas + pagamentos (recibos) já registrados
      setResumo((d.resumo as ResumoCaixa) || null);
      setRepasses((d.repasses as RepasseDavid[]) || []);
      setRepassesSqlOk(d.repassesSqlOk !== false);
      setAtualizadoEm(new Date());
    } catch {
      if (!silencioso) setErro('Sem conexao para carregar o caixa.');
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // BLOCO 167 ("o caixa deve sempre atualizar"): polling silencioso a cada 20s
  // + refresh imediato quando o usuário volta para a aba/tela.
  useEffect(() => {
    const id = setInterval(() => { void carregar(true); }, 20_000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') void carregar(true); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [carregar]);

  // ---------------------------------------------------------------------------
  // BLOCO 233 — OS 3 NÚMEROS DA LINHA DO CAIXA.
  // VERDE vem do SERVIDOR (recebidoNoCaixa = à vista + prazo já pago no
  // período). AZUL = total gerado no período. A PRAZO = pendente de TODOS os
  // períodos (boletos sobrevivem ao fechamento até o pagamento cair).
  // ---------------------------------------------------------------------------
  const verde = resumo
    ? Math.round((resumo.recebidoNoCaixa ?? (resumo.vista.total + resumo.prazo.recebidoNoPeriodo)) * 100) / 100
    : Math.round((totais.dinheiro + totais.pix + totais.deposito) * 100) / 100;
  const azul = resumo ? resumo.totalGerado : verde;
  const aprazo = resumo ? resumo.prazo.pendentes : totais.boleto;
  const qtdeBoletosPendentes = resumo ? resumo.prazo.qtdePendentes : pagamentos.filter((p) => p.metodo === 'BOLETO').length;

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
      const bp = d.boletosPendentes as { qtde: number; valor: number } | undefined;
      showToast?.(
        `Caixa fechado — ${fmt(d.fechamento?.totalGeral || 0)} recebidos zerados e vão para o caixa da empresa`
        + (bp && bp.qtde > 0 ? ` · A prazo ${fmt(bp.valor)} (${bp.qtde}) continua na tela até o pagamento cair` : ''),
        'success'
      );
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

  // BLOCO 124: apaga UM registro do ledger aberto. Só toca caixa_pagamentos —
  // a venda fica no histórico (pedido do dono: "apenas no histórico do caixa,
  // não apague do histórico de vendas").
  const excluirPagamento = async () => {
    if (!excluirAlvo) return;
    setExcluindo(true);
    try {
      const res = await fetch('/api/caixa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EXCLUIR', id: excluirAlvo.id }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast?.(String(d?.error || 'Nao foi possivel excluir o registro.'), 'error');
        return;
      }
      showToast?.(`Registro removido do caixa${d.excluido?.cliente ? ` (${d.excluido.cliente})` : ''} — a venda segue intacta no histórico.`, 'success');
      setExcluirAlvo(null);
      setDetalhe({});
      carregar();
    } catch {
      showToast?.('Sem conexao para excluir o registro.', 'error');
    } finally {
      setExcluindo(false);
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

  // ---------------------------------------------------------------------------
  // BLOCO 232 — RECIBO do pagamento ao David (imprimível, nova aba — mesmo
  // padrão dos portes/DANFE do app). Persistido no banco (SQL 232), o número
  // do recibo é identity — reimpressão é sempre a MESMA via.
  // ---------------------------------------------------------------------------
  const abrirRecibo = (r: RepasseDavid) => {
    const esc = (s: unknown) => String(s ?? '').replace(/</g, '&lt;');
    const v = Number(r.valor) || 0;
    const ext = valorPorExtenso(v);
    const d = new Date(r.criadoEm);
    const dataBR = `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const num = String(r.reciboNumero || 0).padStart(6, '0');
    const formaTxt = String(r.forma || 'DINHEIRO') === 'PIX' ? 'Pix' : 'Dinheiro';
    const pagouPor = esc(r.registradoPorNome || user?.nome || 'Admin');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo nº ${num} — Pagamento ao vendedor</title>
<style>
  * { font-family: Arial, Helvetica, sans-serif; box-sizing: border-box; }
  body { margin: 0; padding: 32px; color: #111; font-size: 14px; line-height: 1.6; }
  .box { border: 2px solid #111; border-radius: 10px; padding: 18px 22px; max-width: 720px; margin: 0 auto; }
  .topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #999; padding-bottom: 10px; }
  h1 { font-size: 18px; margin: 0; text-transform: uppercase; letter-spacing: 2px; }
  .num { font-size: 16px; font-weight: bold; text-align: right; }
  .valor { font-size: 22px; font-weight: bold; margin: 16px 0 4px; }
  .ext { font-style: italic; font-size: 13px; color: #333; }
  p { margin: 10px 0; text-align: justify; }
  .ref { background: #f6f6f6; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  .assin { display: flex; gap: 60px; margin-top: 60px; max-width: 720px; margin-left: auto; margin-right: auto; }
  .assin div { flex: 1; border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 12px; }
  .rodape { max-width: 720px; margin: 26px auto 0; font-size: 10px; color: #777; text-align: center; }
  @media print { body { padding: 12mm; } }
</style></head><body>
<div class="box">
  <div class="topo">
    <div><h1>RECIBO</h1><p style="margin:2px 0 0;font-size:12px">Pagamento ao vendedor — Rota 5</p></div>
    <div class="num">Nº ${num}<br><span style="font-size:11px;color:#555">${esc(dataBR)}</span></div>
  </div>
  <p class="valor">R$ ${v.toFixed(2).replace('.', ',')}</p>
  <p class="ext">(${esc(ext)})</p>
  <p>Recebemos de <b>DOCE MANIA EXPRESS</b> a quantia acima, referente ao pagamento do repasse das vendas do caixa do vendedor <b>Deivid (Rota 5)</b>.</p>
  <div class="ref"><b>Forma do pagamento:</b> ${formaTxt}${r.observacao ? `<br><b>Referência:</b> ${esc(r.observacao)}` : ''}</div>
</div>
<div class="assin"><div>Quem recebeu<br><b>Deivid (Rota 5)</b></div><div>Quem pagou<br><b>${pagouPor}</b></div></div>
<p class="rodape">Recibo registrado no sistema (caixa — pagamentos ao David). Reimpressão desta via é sempre a mesma do recibo nº ${num}.</p>
<script>window.onload = () => { try { window.print(); } catch (e) {} };</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { showToast?.('Libere o pop-up para imprimir o recibo.', 'error'); return; }
    w.document.write(html);
    w.document.close();
  };

  // BLOCO 232 — registra o pagamento digitado pelo dono e abre o recibo.
  const registrarRepasse = async () => {
    const valorNum = Math.round(parseFloat(String(repValor).replace(/[^0-9,\.]/g, '').replace(',', '.')) * 100) / 100;
    if (!(valorNum > 0)) {
      showToast?.('Digite o valor do pagamento antes de registrar.', 'error');
      return;
    }
    setRegistrandoRep(true);
    try {
      const res = await fetch('/api/caixa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'REPASSE', valor: valorNum, forma: repForma, observacao: repObs }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast?.(String(d?.error || 'Não foi possível registrar o pagamento.'), 'error');
        return;
      }
      showToast?.(`Pagamento registrado — recibo nº ${String(d.repasse?.reciboNumero || 0).padStart(6, '0')}`, 'success');
      setModalRepasse(false);
      setRepValor('');
      setRepObs('');
      if (d.repasse) abrirRecibo(d.repasse as RepasseDavid);
      carregar();
    } catch {
      showToast?.('Sem conexão para registrar o pagamento.', 'error');
    } finally {
      setRegistrandoRep(false);
    }
  };

  const renderPagamento = (p: PagamentoCaixa, fechado = false) => {
    const o = ORIGEM_LABEL[p.origem] || ORIGEM_LABEL.AJUSTE;
    const m = METODO_LABEL[p.metodo] || { txt: p.metodo, cls: 'bg-gray-400 text-white' };
    return (
      <div key={`${p.id}-${fechado ? 'f' : 'a'}`} className="p-3 flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${o.cls}`}>{o.txt}</span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${m.cls}`}>{m.txt}</span>
            {p.cliente && <span className="text-[9px] font-black text-gray-700 uppercase break-words">{p.cliente}</span>}
          </div>
          <p className="text-[8px] text-gray-400 font-bold uppercase mt-1 break-words">
            {hora(p.criadoEm)}{p.vendedor ? ` · ${p.vendedor}` : ''}{p.usuarioNome ? ` · por ${p.usuarioNome}` : ''}
          </p>
          {p.detalhe && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 break-words">{p.detalhe}</p>}
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
          {!fechado && isAdmin && (
            <button
              onClick={() => setExcluirAlvo(p)}
              className="w-9 h-9 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center border border-rose-100 active:scale-90 transition-all"
              title="Excluir registro do caixa (a venda não é apagada)"
            >
              <i className="fa-solid fa-trash-can text-xs"></i>
            </button>
          )}
          <p className={`text-[11px] font-black text-right ${p.metodo === 'DINHEIRO' ? 'text-emerald-600' : p.metodo === 'PIX' ? 'text-violet-600' : p.metodo === 'BOLETO' ? 'text-amber-600' : 'text-slate-600'}`}>
            {fmt(p.valor)}
          </p>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // BLOCO 233 — LISTA ÚNICA DE RECEBIDOS (o que já entrou no caixa = VERDE):
  // à vista (dinheiro/pix/depósito do ledger aberto) + boletos com BAIXA no
  // período (pago_em — o boleto gerado antes e pago agora entra aqui).
  // Mais recente primeiro: "conforme vai entrando vai caindo em recebidos".
  // ---------------------------------------------------------------------------
  const recebidosTodos = React.useMemo<ItemRecebido[]>(() => {
    const avista: ItemRecebido[] = pagamentos
      .filter((p) => p.metodo !== 'BOLETO')
      .map((p) => ({
        key: `av-${p.id}`,
        tipo: 'AVISTA',
        metodo: p.metodo,
        id: p.id,
        valor: p.valor,
        cliente: p.cliente,
        quando: p.criadoEm,
        origem: p.origem,
        temComprovante: p.temComprovante,
        detalhe: p.detalhe,
        usuarioNome: p.usuarioNome,
      }));
    const prazoPago: ItemRecebido[] = (resumo?.prazo.recebidosLista || []).map((b) => ({
      key: `bp-${b.id}`,
      tipo: 'PRAZOPAGO',
      metodo: 'BOLETO',
      id: b.id,
      valor: b.valor,
      cliente: b.cliente,
      quando: b.pagoEm,
      pagoEm: b.pagoEm,
    }));
    return [...avista, ...prazoPago].sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')));
  }, [pagamentos, resumo]);

  const recebidosFiltrados = React.useMemo(() => {
    if (filtroRecebidos === 'TUDO') return recebidosTodos;
    if (filtroRecebidos === 'PRAZO') return recebidosTodos.filter((r) => r.tipo === 'PRAZOPAGO');
    return recebidosTodos.filter((r) => r.tipo === 'AVISTA' && r.metodo === filtroRecebidos);
  }, [recebidosTodos, filtroRecebidos]);

  // A PRAZO — o que ainda vai entrar (boletos em aberto, sobrevivem ao fechamento)
  const pendentesLista = React.useMemo(() => {
    return pagamentos
      .filter((p) => p.metodo === 'BOLETO')
      .slice()
      .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }, [pagamentos]);

  const renderRecebido = (r: ItemRecebido) => {
    if (r.tipo === 'PRAZOPAGO') {
      return (
        <div key={r.key} className="p-3 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0 pr-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-teal-600 text-white">
                <i className="fa-solid fa-circle-check mr-1"></i>Prazo pago (baixa)
              </span>
              {r.cliente && <span className="text-[9px] font-black text-gray-700 uppercase break-words">{r.cliente}</span>}
            </div>
            <p className="text-[8px] text-gray-400 font-bold uppercase mt-1">
              pago em {hora(r.pagoEm || r.quando)} — boleto a prazo que caiu no caixa
            </p>
          </div>
          <p className="text-[11px] font-black text-teal-700 text-right flex-shrink-0">{fmt(r.valor)}</p>
        </div>
      );
    }
    const o = ORIGEM_LABEL[r.origem || ''] || ORIGEM_LABEL.AJUSTE;
    const m = METODO_LABEL[r.metodo] || { txt: r.metodo, cls: 'bg-gray-400 text-white' };
    return (
      <div key={r.key} className="p-3 flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${o.cls}`}>{o.txt}</span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${m.cls}`}>{m.txt}</span>
            {r.cliente && <span className="text-[9px] font-black text-gray-700 uppercase break-words">{r.cliente}</span>}
          </div>
          <p className="text-[8px] text-gray-400 font-bold uppercase mt-1 break-words">
            {hora(r.quando)}{r.usuarioNome ? ` · por ${r.usuarioNome}` : ''}
          </p>
          {r.detalhe && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 break-words">{r.detalhe}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {r.temComprovante && (
            <button
              onClick={() => verFoto(r.id)}
              className="w-9 h-9 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center border border-violet-100 active:scale-90 transition-all"
              title="Ver comprovante"
            >
              <i className="fa-solid fa-image text-xs"></i>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                const alvo = pagamentos.find((p) => p.id === r.id);
                if (alvo) setExcluirAlvo(alvo);
              }}
              className="w-9 h-9 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center border border-rose-100 active:scale-90 transition-all"
              title="Excluir registro do caixa (a venda não é apagada)"
            >
              <i className="fa-solid fa-trash-can text-xs"></i>
            </button>
          )}
          <p className={`text-[11px] font-black text-right ${r.metodo === 'DINHEIRO' ? 'text-emerald-600' : r.metodo === 'PIX' ? 'text-violet-600' : 'text-slate-600'}`}>
            {fmt(r.valor)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="px-2">
        <h2 className="text-2xl font-black text-gray-800 tracking-tight">Caixa do David</h2>
        <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">
          Rota 5 · {desde ? `caixa aberto desde ${new Date(desde).toLocaleDateString('pt-BR')} ${new Date(desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'caixa aberto — primeiro período'}
          {!isAdmin && ' · fechamento pelo admin'}
        </p>
        {/* BLOCO 167: "o caixa deve sempre atualizar" — refresh a cada 20s automático */}
        <p className="text-[8px] text-gray-300 font-bold uppercase mt-0.5">
          <i className="fa-solid fa-rotate mr-1"></i>Atualiza sozinho a cada 20s{atualizadoEm ? ` · última atualização ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
        </p>
      </div>

      {/* BLOCO 233: a regra em 1 linha — números fáceis, sem poluição */}
      <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 mx-1">
        <p className="text-[8px] font-black text-gray-500 uppercase leading-relaxed">
          <i className="fa-solid fa-circle-info text-gray-400 mr-1"></i>
          <span className="text-blue-600">Azul</span> = tudo que ele gerou (à vista + a prazo) · <span className="text-emerald-600">Verde</span> = o que JÁ ENTROU no caixa (dinheiro + Pix + prazo pago) · <span className="text-amber-600">A prazo</span> = o que ainda vai entrar. Ao fechar, os recebidos zeram — o a prazo continua até o pagamento cair.
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
          <button onClick={() => void carregar()} className="mt-2 bg-rose-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase active:scale-95">Tentar de novo</button>
        </div>
      )}

      {!loading && !erro && (
        <>
          {/* ================================================================
              BLOCO 233 — A LINHA DO CAIXA (uma linha, os 3 números):
              AZUL total gerado | VERDE recebido (à vista + prazo pago) |
              A PRAZO ainda vai entrar. Seus cálculos ficam no VERDE.
              ================================================================ */}
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md mx-1">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[8px] font-black text-gray-400 uppercase">A linha do caixa</p>
              {resumo && (
                <span className="text-[8px] font-black text-gray-400 uppercase">{resumo.prazo.qtdeRecebidos} baixa(s) · {resumo.vista.qtde} à vista</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* AZUL — total de vendas geradas (à vista + a prazo) */}
              <div className="bg-blue-50 rounded-2xl p-3 text-center">
                <p className="text-[8px] font-black text-blue-500 uppercase">Total gerado</p>
                <p className="text-[13px] sm:text-lg font-black text-blue-600 mt-1 tabular-nums leading-tight">{fmt(azul)}</p>
                <p className="text-[7px] font-bold text-blue-400 uppercase mt-1 leading-tight">vendas à vista + a prazo</p>
              </div>
              {/* VERDE — o que JÁ ENTROU no caixa (dinheiro + pix + prazo pago) */}
              <div className="bg-emerald-50 rounded-2xl p-3 text-center ring-1 ring-emerald-200">
                <p className="text-[8px] font-black text-emerald-500 uppercase">Recebido</p>
                <p className="text-[13px] sm:text-lg font-black text-emerald-600 mt-1 tabular-nums leading-tight">{fmt(verde)}</p>
                <p className="text-[7px] font-bold text-emerald-500/80 uppercase mt-1 leading-tight">entrou no caixa</p>
              </div>
              {/* A PRAZO — o que ainda vai entrar */}
              <div className="bg-amber-50 rounded-2xl p-3 text-center">
                <p className="text-[8px] font-black text-amber-500 uppercase">A prazo</p>
                <p className="text-[13px] sm:text-lg font-black text-amber-600 mt-1 tabular-nums leading-tight">{fmt(aprazo)}</p>
                <p className="text-[7px] font-bold text-amber-500/80 uppercase mt-1 leading-tight">ainda vai entrar</p>
              </div>
            </div>

            {/* Decomposição — 3 linhas pequenas, a conta na mesa */}
            <div className="mt-3 space-y-1">
              <p className="text-[8px] font-bold text-gray-400 uppercase leading-relaxed">
                <span className="font-black text-emerald-600">Verde</span> = Dinheiro {fmt(totais.dinheiro)} + Pix {fmt(totais.pix)}{totais.deposito > 0 ? ` + Depósito ${fmt(totais.deposito)}` : ''} + prazo pago {fmt(resumo ? resumo.prazo.recebidoNoPeriodo : 0)} ({resumo ? resumo.prazo.qtdeRecebidos : 0} baixa(s))
              </p>
              <p className="text-[8px] font-bold text-gray-400 uppercase leading-relaxed">
                <span className="font-black text-blue-600">Azul</span> = à vista {fmt(resumo ? resumo.vista.total : 0)} + a prazo gerado {fmt(resumo ? resumo.prazo.geradoNoPeriodo : 0)} — seus cálculos ficam em cima do VERDE
              </p>
              <p className="text-[8px] font-bold text-gray-400 uppercase leading-relaxed">
                <span className="font-black text-amber-600">A prazo</span> = {qtdeBoletosPendentes} boleto(s) em aberto — não zera no fechamento; quando o pagamento cai, cai no VERDE
              </p>
            </div>

            {isAdmin ? (
              <button
                onClick={() => setModalFechar(true)}
                className="w-full mt-3 bg-gray-900 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest"
              >
                <i className="fa-solid fa-lock mr-2"></i>Fechar caixa agora — recebido {fmt(verde)}
              </button>
            ) : (
              <div className="w-full mt-3 bg-gray-100 text-gray-500 font-bold py-3 rounded-2xl uppercase text-[9px] tracking-widest text-center">
                <i className="fa-solid fa-lock mr-2"></i>Leitura — o ADMIN fecha o caixa
              </div>
            )}
          </div>

          {/* ================================================================
              BLOCO 233 — RECEBIDOS NO CAIXA (o que já entrou = VERDE):
              à vista (com comprovante/exclusão) + boletos pagos com a DATA
              DA BAIXA. Filtro por forma para a conferência direta.
              ================================================================ */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 py-3 flex items-center justify-between bg-gray-50/70">
              <p className="text-[9px] font-black text-gray-700 uppercase"><i className="fa-solid fa-circle-check text-emerald-500 mr-1.5"></i>Recebidos no caixa — o que já entrou</p>
              <p className="text-sm font-black text-emerald-600">{fmt(verde)}</p>
            </div>
            <div className="px-4 py-2 flex gap-1.5 flex-wrap border-b border-gray-50">
              {([['TUDO', 'Tudo'], ['DINHEIRO', 'Dinheiro'], ['PIX', 'Pix'], ['PRAZO', 'Prazo pago']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFiltroRecebidos(k)}
                  className={`text-[8px] font-black uppercase px-2.5 py-1.5 rounded-lg border transition-all ${filtroRecebidos === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-400 border-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {recebidosFiltrados.length > 0 ? (
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {recebidosFiltrados.map(renderRecebido)}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                  {filtroRecebidos === 'TUDO' ? 'Nada recebido ainda neste caixa' : 'Nada neste filtro'}
                </p>
                <p className="text-[8px] font-bold text-gray-300 uppercase mt-1">
                  Entra à vista (venda/entrega em dinheiro/pix) e os boletos a prazo quando o pagamento cair (baixa)
                </p>
              </div>
            )}
          </div>

          {/* ================================================================
              BLOCO 233 — AINDA A PRAZO (o que vai entrar): boletos em aberto
              de qualquer período. Não zera no fechamento — só sai daqui
              quando o pagamento cair (e cai no VERDE, com a data da baixa).
              ================================================================ */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 py-3 flex items-center justify-between bg-gray-50/70">
              <p className="text-[9px] font-black text-gray-700 uppercase"><i className="fa-solid fa-barcode text-amber-500 mr-1.5"></i>Ainda a prazo — o que vai entrar</p>
              <p className="text-sm font-black text-amber-600">{fmt(aprazo)}</p>
            </div>
            {pendentesLista.length > 0 ? (
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {pendentesLista.map((p) => (
                  <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0 pr-1">
                      <p className="text-[9px] font-black text-gray-700 uppercase break-words">{p.cliente || 'Boleto'}</p>
                      <p className="text-[8px] text-gray-400 font-bold uppercase mt-0.5">
                        gerado em {hora(p.criadoEm)} — aguardando o pagamento
                      </p>
                    </div>
                    <p className="text-[11px] font-black text-amber-600 text-right flex-shrink-0">{fmt(p.valor)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest">Nenhum boleto em aberto</p>
                <p className="text-[8px] font-bold text-gray-300 uppercase mt-1">Tudo que era a prazo já caiu no caixa</p>
              </div>
            )}
          </div>

          {/* ==================================================================
              BLOCO 232: PAGAMENTOS AO DAVID (recibos) — o dono digita o valor
              que vai pagar a ele, registra e o recibo numerado é gerado.
              ================================================================== */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 py-3 flex items-center justify-between bg-gray-50/70">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[8px] font-black uppercase px-2 py-1 rounded-md bg-gray-900 text-white"><i className="fa-solid fa-hand-holding-dollar mr-1"></i>Pagamentos ao David</span>
                <span className="text-[8px] font-black text-gray-400 uppercase">{repasses.length} registro(s)</span>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setModalRepasse(true)}
                  className="bg-gray-900 text-white text-[9px] font-black uppercase px-3 py-2 rounded-xl active:scale-95 transition-all flex items-center gap-1.5 flex-shrink-0"
                >
                  <i className="fa-solid fa-plus text-[9px]"></i>Pagar
                </button>
              )}
            </div>
            {!repassesSqlOk && (
              <div className="bg-amber-50 border-t border-amber-100 p-3">
                <p className="text-[8px] font-bold text-amber-600 uppercase leading-relaxed">
                  <i className="fa-solid fa-database mr-1"></i>SQL do Bloco 232 pendente — rode o SQL do bloco 232 no Supabase para registrar pagamentos com recibo.
                </p>
              </div>
            )}
            {repasses.length > 0 ? (
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {repasses.map((r) => (
                  <div key={r.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md bg-gray-900 text-white">Recibo #{String(r.reciboNumero || 0).padStart(6, '0')}</span>
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${r.forma === 'PIX' ? 'bg-violet-600 text-white' : 'bg-emerald-600 text-white'}`}>{r.forma === 'PIX' ? 'Pix' : 'Dinheiro'}</span>
                      </div>
                      <p className="text-[8px] text-gray-400 font-bold uppercase mt-1">
                        {hora(r.criadoEm)}{r.registradoPorNome ? ` · pagou ${r.registradoPorNome}` : ''}
                      </p>
                      {r.observacao && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 break-words">{r.observacao}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => abrirRecibo(r)}
                        className="w-9 h-9 bg-gray-900 text-white rounded-xl flex items-center justify-center active:scale-90 transition-all"
                        title="Abrir / imprimir recibo"
                      >
                        <i className="fa-solid fa-receipt text-xs"></i>
                      </button>
                      <p className="text-[11px] font-black text-gray-800 text-right">{fmt(r.valor)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest">Nenhum pagamento registrado ainda</p>
                <p className="text-[8px] font-bold text-gray-300 uppercase mt-1">
                  {isAdmin ? 'Use o botão PAGAR para registrar o valor que você paga ao David — o recibo sai na hora.' : 'Somente o admin registra pagamentos.'}
                </p>
              </div>
            )}
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
                      {f.observacao && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 break-words">{f.observacao}</p>}
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

      {/* ================================================================
          BLOCO 233 — MODAL DO FECHAMENTO: a PERGUNTA EXPLÍCITA do dono.
          "quando o caixa for fechado vc deve perguntar se realmente deseja
          fechar, então ali zeramos os contadores do que foi recebido e
          continuamos tendo visão do que vai entrar."
          ================================================================ */}
      {modalFechar && (
        <div className="fixed inset-0 z-[400] bg-black/60 flex items-end justify-center sm:items-center p-4" onClick={() => !fechando && setModalFechar(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <i className="fa-solid fa-circle-question text-gray-900"></i>Deseja realmente fechar o caixa?
            </h3>
            <p className="text-[9px] font-bold text-gray-400 uppercase mt-1">Confira o que vai travar antes de confirmar.</p>

            {/* O que trava: o dinheiro RECEBIDO (à vista) */}
            <div className="bg-gray-50 rounded-2xl p-4 mt-4 space-y-1.5">
              <p className="text-[8px] font-black text-gray-500 uppercase">O que trava e vai para o caixa da empresa</p>
              <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-emerald-600">Dinheiro</span><span className="text-gray-700">{fmt(totais.dinheiro)}</span></div>
              <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-violet-600">Pix</span><span className="text-gray-700">{fmt(totais.pix)}</span></div>
              {totais.deposito > 0 && <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-slate-600">Depósito</span><span className="text-gray-700">{fmt(totais.deposito)}</span></div>}
              <div className="flex justify-between text-sm font-black uppercase pt-1 border-t border-gray-200"><span className="text-gray-800">Recebido (verde)</span><span className="text-emerald-600">{fmt(verde)}</span></div>
              <p className="text-[8px] font-bold text-gray-400 uppercase">{pagamentos.filter((p) => p.metodo !== 'BOLETO').length} recebimento(s) à vista no log</p>
            </div>

            {/* O que NÃO trava: prazo pago no período (já caiu na conta) + a prazo pendente */}
            <div className="bg-gray-50 rounded-2xl p-4 mt-2 space-y-1.5">
              <p className="text-[8px] font-black text-gray-500 uppercase">O que NÃO trava com o fechamento</p>
              <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-teal-600">Prazo pago no período</span><span className="text-gray-700">{fmt(resumo ? resumo.prazo.recebidoNoPeriodo : 0)} ({resumo ? resumo.prazo.qtdeRecebidos : 0})</span></div>
              <div className="flex justify-between text-[10px] font-black uppercase"><span className="text-amber-600">A prazo pendente</span><span className="text-gray-700">{fmt(aprazo)} ({qtdeBoletosPendentes})</span></div>
              <p className="text-[8px] font-bold text-gray-400 uppercase">O prazo pago já caiu na conta; o pendente continua na tela até o pagamento cair — aí entra no VERDE do novo caixa.</p>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3.5 mt-3">
              <p className="text-[9px] font-black text-blue-700 uppercase leading-relaxed">
                <i className="fa-solid fa-lock mr-1"></i>Ao confirmar: o dinheiro recebido SAI DA MÃO DO DAVID e entra no caixa da empresa. Os contadores de RECEBIDOS ZERAM e um novo período começa. O A PRAZO continua aparecendo até o pagamento cair.
              </p>
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
              <button onClick={() => setModalFechar(false)} disabled={fechando} className="flex-1 bg-gray-100 text-gray-500 font-black py-3.5 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95">Não, voltar</button>
              <button onClick={fecharCaixa} disabled={fechando} className="flex-1 bg-gray-900 text-white font-black py-3.5 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg active:scale-95">
                {fechando ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Sim, fechar e zerar'}
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
              <button onClick={() => setModalFoto(null)} className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-xmark text-gray-500"></i></button>
            </div>
            <img src={modalFoto.foto} alt="Comprovante do pagamento recebido no caixa" className="w-full rounded-2xl max-h-[70dvh] object-contain bg-gray-50" />
          </div>
        </div>
      )}

      {/* MODAL: novo pagamento ao David (admin) — BLOCO 232. O dono DIGITA o
          valor, escolhe a forma e o recibo numerado é gerado ao registrar. */}
      {modalRepasse && (
        <div className="fixed inset-0 z-[400] bg-black/60 flex items-end justify-center sm:items-center p-4" onClick={() => !registrandoRep && setModalRepasse(false)}>
          <div className="bg-white w-full max-w-md rounded-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
              <i className="fa-solid fa-hand-holding-dollar text-gray-900"></i>Pagar o David
            </h3>
            <p className="text-[9px] font-bold text-gray-400 uppercase mt-1">Digite o valor que você vai pagar a ele — o recibo numerado sai ao registrar. Não interfere no fechamento do caixa.</p>

            {/* Atalhos: preencher com os números da linha do caixa (BLOCO 233) */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button onClick={() => setRepValor(verde.toFixed(2))} className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[8px] font-black uppercase px-2.5 py-1.5 rounded-lg active:scale-95">
                Recebido (verde): {fmt(verde)}
              </button>
              <button onClick={() => setRepValor(totais.dinheiro.toFixed(2))} className="bg-gray-50 text-gray-600 border border-gray-200 text-[8px] font-black uppercase px-2.5 py-1.5 rounded-lg active:scale-95">
                Dinheiro: {fmt(totais.dinheiro)}
              </button>
              <button onClick={() => setRepValor(totais.pix.toFixed(2))} className="bg-violet-50 text-violet-700 border border-violet-100 text-[8px] font-black uppercase px-2.5 py-1.5 rounded-lg active:scale-95">
                Pix: {fmt(totais.pix)}
              </button>
            </div>

            <div className="mt-3">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor do pagamento (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={repValor}
                onChange={(e) => setRepValor(e.target.value.replace(/[^0-9,.]/g, ''))}
                placeholder="0,00"
                className="w-full mt-1 p-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black text-gray-800 outline-none focus:border-gray-400"
              />
            </div>

            <div className="mt-3">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Forma</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button onClick={() => setRepForma('DINHEIRO')} className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all ${repForma === 'DINHEIRO' ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-400'}`}>
                  <i className="fa-solid fa-money-bill-wave mr-1.5"></i>Dinheiro
                </button>
                <button onClick={() => setRepForma('PIX')} className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-wide border transition-all ${repForma === 'PIX' ? 'bg-violet-600 border-violet-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-400'}`}>
                  <i className="fa-brands fa-pix mr-1.5"></i>Pix
                </button>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Referência / observação (opcional)</label>
              <textarea
                value={repObs}
                onChange={(e) => setRepObs(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="Ex: repasse das vendas de hoje — à vista + boletos pagos"
                className="w-full mt-1 p-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-semibold outline-none resize-none"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModalRepasse(false)} disabled={registrandoRep} className="flex-1 bg-gray-100 text-gray-500 font-black py-3.5 rounded-2xl uppercase text-[10px] tracking-widest active:scale-95">Cancelar</button>
              <button onClick={registrarRepasse} disabled={registrandoRep} className="flex-1 bg-gray-900 text-white font-black py-3.5 rounded-2xl uppercase text-[10px] tracking-widest shadow-lg active:scale-95">
                {registrandoRep ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Registrar + recibo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BLOCO 124: confirmar exclusão do registro do caixa (a venda fica) */}
      {excluirAlvo && (
        <ConfirmModal
          title="Excluir do caixa?"
          message={`Remove o registro de ${fmt(excluirAlvo.valor)} (${excluirAlvo.origem === 'RECEBIMENTO' ? 'Recebimento' : excluirAlvo.origem === 'VENDA' ? 'Venda' : excluirAlvo.origem === 'ENTREGA' ? 'Entrega' : excluirAlvo.origem}${excluirAlvo.cliente ? ` · ${excluirAlvo.cliente}` : ''}) do CAIXA aberto.\n\nA venda continua intacta no histórico de vendas. Registro já fechado é imutável.`}
          icon="fa-solid fa-trash-can"
          type="danger"
          confirmLabel={excluindo ? 'Excluindo...' : 'Excluir do caixa'}
          onConfirm={excluirPagamento}
          onCancel={() => !excluindo && setExcluirAlvo(null)}
        />
      )}
    </div>
  );
};

export default CaixaFechamento;
