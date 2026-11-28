'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '@/services/userService';
import ConfirmModal from '@/components/doce/ConfirmModal';
// BLOCO 232: recibo do pagamento ao David — valor por extenso
import { valorPorExtenso } from '@/lib/extenso';
// BLOCO 234: a tela do David (vendedor) é simplificada — só à vista Dinheiro+Pix
import { isDavidVendedor } from '@/lib/equipe';

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
 *
 * BLOCO 234 (regra do dono — A TELA DO DAVID + RECIBO DE ENTREGA):
 *   "tela caixa que aparece para o David deve mostrar tudo que entrou a vista
 *   dinheiro e Pix, no período de um fechamento de caixa até outro. Quem
 *   fecha o caixa é login admin. Conforme o caixa é fechado vai zerando.
 *   Somente isso e nada mais. Quando zerado o caixa o recibo gera para
 *   comprovar que foi entregue o dinheiro."
 *
 *   - LOGIN VENDEDOR (David) = TELA SIMPLIFICADA, só isso e nada mais:
 *       1. TOTAL À VISTA (Dinheiro + Pix) do período (último fechamento → agora)
 *       2. Decomposição Dinheiro / Pix
 *       3. Lista do que entrou à vista (com comprovante do Pix)
 *     Sem azul/verde, sem boletos, sem repasses, sem histórico, sem lixeira.
 *   - LOGIN ADMIN = tela gerencial completa (233) + no FECHAR o RECIBO DE
 *     ENTREGA abre sozinho: "Recebemos de Deivid (Rota 5) a quantia ...",
 *     assinado por quem entregou × quem recebeu — a prova do dinheiro entregue.
 *     Reimpressão: botão RECIBO em cada caixa fechado do histórico (mesma via,
 *     número sequencial da coluna recibo_numero — SQL 234; sem a coluna, o
 *     número é derivado do id, fallback determinístico).
 *
 * BLOCO 235 (regra do dono — o ADMIN TAMBÉM ganha tela simples + LOG):
 *   "olhando o caixa do David logado como admin tbm tem que aparecer uma tela
 *   simples e fácil entendimento, o que deve aparecer é de período até período
 *   de fechamento de caixa, ou seja tudo que o vendedor David recebeu a vista
 *   em dinheiro para acertar conosco e Pix para conferir na conta. Em outra
 *   tela ou botão um log de recebimento de tudo ou seja dinheiro Pix e o prazo
 *   pago e mostrando o quanto tem prazo pendente. Assim fica bem organizado, o
 *   admin fechou caixa quer dizer que recebeu o dinheiro daquele período e
 *   começa denovo."
 *   A tela do ADMIN agora tem 2 ABAS:
 *     - CAIXA (padrão) = a mesma tela SIMPLES do David: tudo que entrou à
 *       vista no período (Dinheiro "para acertar conosco" + Pix "para conferir
 *       na conta") + lista das entradas + FECHAR (entrega o dinheiro, zera e
 *       gera o recibo de entrega).
 *     - LOG = log de recebimentos de TUDO (dinheiro + Pix + prazo pago, com
 *       filtros) + A PRAZO PENDENTE (boletos em aberto, sobrevivem ao
 *       fechamento) + pagamentos ao David (recibos) + caixas fechados
 *       (reimpressão do recibo de entrega). Nada se perde — só fica organizado.
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
  // BLOCO 234: período do caixa + número do recibo de entrega (SQL 234;
  // null quando a coluna ainda não existe — recibo usa fallback pelo id)
  janelaInicio?: string | null;
  reciboNumero?: number | null;
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

  // ------------------------------------------------------------------
  // BLOCO 234 — DOIS JEITOS DE VER O MESMO CAIXA:
  //   - LOGIN VENDEDOR (David) = TELA DO DAVID: só o que entrou À VISTA
  //     (Dinheiro + Pix) do último fechamento até agora. Nada mais.
  //   - LOGIN ADMIN = tela gerencial (233) + fechar com recibo de entrega.
  //   O fechamento é EXCLUSIVO do admin — o David só acompanha o que
  //   entrou e vê os contadores zerarem quando o admin fecha.
  // ------------------------------------------------------------------
  const davidView = !isAdmin && (String(user?.role || '').toUpperCase() === 'VENDEDOR' || isDavidVendedor(user));

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

  // BLOCO 235: as duas abas do admin — CAIXA (tela simples do período) e LOG
  // (log de recebimentos de tudo + a prazo pendente + pagamentos + fechados)
  const [aba, setAba] = useState<'CAIXA' | 'LOG'>('CAIXA');

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
  // BLOCO 235 — NÚMEROS DO ADMIN:
  // À VISTA do período (Dinheiro + Pix + Depósito) = o que o admin RECEBE no
  // fechamento (aba CAIXA, botão FECHAR). VERDE = tudo que JÁ ENTROU no caixa
  // (à vista + prazo pago) — é o total do LOG de recebimentos. A PRAZO =
  // pendente de TODOS os períodos (boletos sobrevivem ao fechamento até o
  // pagamento cair — quando cai, entra no log como prazo pago).
  // ---------------------------------------------------------------------------
  const avistaTotal = Math.round((totais.dinheiro + totais.pix + totais.deposito) * 100) / 100;
  const verde = resumo
    ? Math.round((resumo.recebidoNoCaixa ?? (resumo.vista.total + resumo.prazo.recebidoNoPeriodo)) * 100) / 100
    : avistaTotal;
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
        `Caixa fechado — ${fmt(d.fechamento?.totalGeral || 0)} à vista entregues ao caixa da empresa`
        + (bp && bp.qtde > 0 ? ` · A prazo ${fmt(bp.valor)} (${bp.qtde}) continua no LOG até o pagamento cair` : ''),
        'success'
      );
      // BLOCO 234: "quando zerado o caixa o recibo gera para comprovar que
      // foi entregue o dinheiro" — o RECIBO DE ENTREGA abre sozinho no fechamento.
      if (d.fechamento) abrirReciboEntrega(d.fechamento);
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
  <p class="valor">R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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

  // ---------------------------------------------------------------------------
  // BLOCO 234 — RECIBO DE ENTREGA DO CAIXA: "quando zerado o caixa o recibo
  // gera para comprovar que foi entregue o dinheiro". É a via que prova que o
  // dinheiro À VISTA (Dinheiro + Pix) do período saiu da mão do David e entrou
  // no caixa da empresa. Gerado AUTOMATICAMENTE no FECHAR e reimpressível pelo
  // histórico — o número vem da coluna recibo_numero (SQL 234); sem a coluna,
  // fallback determinístico pelo id (mesma via em toda reimpressão).
  // ---------------------------------------------------------------------------
  const numReciboEntrega = (reciboNumero?: number | null, id?: string | null): string => {
    if (reciboNumero) return String(reciboNumero).padStart(6, '0');
    const seed = String(id || '').replace(/\D/g, '');
    return (seed || '0').slice(0, 6).padStart(6, '0');
  };

  const abrirReciboEntrega = (f: {
    id?: string; reciboNumero?: number | null; fechadoEm: string; janelaInicio?: string | null;
    dinheiro: number; pix: number; deposito?: number; total: number; qtde?: number;
    fechadoPorNome?: string | null;
  }) => {
    const esc = (s: unknown) => String(s ?? '').replace(/</g, '&lt;');
    const num = numReciboEntrega(f.reciboNumero, f.id);
    const v = Number(f.total || 0);
    const ext = valorPorExtenso(v);
    const fim = new Date(f.fechadoEm);
    const fimBR = `${fim.toLocaleDateString('pt-BR')} ${fim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const ini = f.janelaInicio ? new Date(f.janelaInicio) : null;
    const iniBR = ini ? `${ini.toLocaleDateString('pt-BR')} ${ini.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : null;
    const periodoTxt = iniBR ? `no período de ${iniBR} até ${fimBR}` : `até ${fimBR}`;
    const recebidoPor = esc(f.fechadoPorNome || user?.nome || 'Admin');
    const formasTxt = [
      `Dinheiro ${fmt(Number(f.dinheiro || 0))}`,
      `Pix ${fmt(Number(f.pix || 0))}`,
      ...(Number(f.deposito || 0) > 0 ? [`Depósito ${fmt(Number(f.deposito || 0))}`] : []),
    ].join(' · ');
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo de entrega do caixa nº ${num}</title>
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
    <div><h1>Recibo de Entrega</h1><p style="margin:2px 0 0;font-size:12px">Fechamento do caixa — Rota 5</p></div>
    <div class="num">Nº ${num}<br><span style="font-size:11px;color:#555">${esc(fimBR)}</span></div>
  </div>
  <p class="valor">R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
  <p class="ext">(${esc(ext)})</p>
  <p>Recebemos de <b>Deivid (Rota 5)</b> a quantia total acima, referente à <b>ENTREGA DO DINHEIRO DO CAIXA</b> — vendas à vista em Dinheiro e Pix ${esc(periodoTxt)}. Com este fechamento, os contadores do caixa do David ZERAM e o valor passa para o caixa da empresa.</p>
  <div class="ref"><b>Formas recebidas:</b> ${esc(formasTxt)}<br><b>Recebimentos à vista:</b> ${Number(f.qtde || 0)}</div>
</div>
<div class="assin"><div>Quem entregou<br><b>Deivid (Rota 5)</b></div><div>Quem recebeu<br><b>${recebidoPor}</b></div></div>
<p class="rodape">Recibo gerado pelo fechamento do caixa no sistema. Reimpressão desta via é sempre a mesma do recibo nº ${num}.</p>
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

  // ---------------------------------------------------------------------------
  // BLOCO 234 — A TELA DO DAVID (login VENDEDOR): "tudo que entrou a vista
  // dinheiro e Pix, no período de um fechamento de caixa até outro. Quem fecha
  // o caixa é login admin. Conforme o caixa é fechado vai zerando. Somente
  // isso e nada mais." — nada de azul/verde, boletos, repasses ou histórico.
  // ---------------------------------------------------------------------------
  const entradasDavid = React.useMemo(() => {
    return pagamentos
      .filter((p) => p.metodo === 'DINHEIRO' || p.metodo === 'PIX')
      .slice()
      .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }, [pagamentos]);
  const davidDinheiro = Math.round(entradasDavid.filter((p) => p.metodo === 'DINHEIRO').reduce((a, b) => a + Number(b.valor || 0), 0) * 100) / 100;
  const davidPix = Math.round(entradasDavid.filter((p) => p.metodo === 'PIX').reduce((a, b) => a + Number(b.valor || 0), 0) * 100) / 100;
  const davidTotal = Math.round((davidDinheiro + davidPix) * 100) / 100;
  const davidQtdeDinheiro = entradasDavid.filter((p) => p.metodo === 'DINHEIRO').length;
  const davidQtdePix = entradasDavid.filter((p) => p.metodo === 'PIX').length;

  // BLOCO 235: entradas à vista do ADMIN = tudo MENOS boleto (Dinheiro + Pix +
  // Depósito) — a lista da tela simples e o que trava no fechamento.
  const entradasAvistaAdmin = React.useMemo(() => {
    return pagamentos
      .filter((p) => p.metodo !== 'BOLETO')
      .slice()
      .sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }, [pagamentos]);
  const adminQtdeDinheiro = entradasAvistaAdmin.filter((p) => p.metodo === 'DINHEIRO').length;
  const adminQtdePix = entradasAvistaAdmin.filter((p) => p.metodo === 'PIX').length;

  if (davidView) {
    return (
      <div className="space-y-4">
        <div className="px-2">
          <h2 className="text-2xl font-black text-gray-800 tracking-tight">Caixa do David</h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">
            Rota 5 · {desde ? `do último fechamento (${hora(desde)}) até agora` : 'caixa aberto — primeiro período'}
          </p>
          <p className="text-[8px] text-gray-300 font-bold uppercase mt-0.5">
            <i className="fa-solid fa-rotate mr-1"></i>Atualiza sozinho a cada 20s{atualizadoEm ? ` · última atualização ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
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
            {/* NÚMERO ÚNICO DA TELA: tudo que entrou à vista neste caixa */}
            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md mx-1">
              <p className="text-[8px] font-black text-gray-400 uppercase">Tudo que entrou à vista neste caixa</p>
              <p className="text-4xl font-black text-gray-800 mt-1 tabular-nums leading-tight">{fmt(davidTotal)}</p>
              <p className="text-[8px] font-bold text-gray-400 uppercase mt-1.5">Dinheiro + Pix · {entradasDavid.length} recebimento(s) · do último fechamento até agora</p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="bg-emerald-50 rounded-2xl p-3 text-center">
                  <p className="text-[8px] font-black text-emerald-500 uppercase">Dinheiro</p>
                  <p className="text-base font-black text-emerald-600 mt-0.5 tabular-nums">{fmt(davidDinheiro)}</p>
                  <p className="text-[7px] font-bold text-emerald-500/80 uppercase mt-0.5">{davidQtdeDinheiro} recebimento(s)</p>
                </div>
                <div className="bg-violet-50 rounded-2xl p-3 text-center">
                  <p className="text-[8px] font-black text-violet-500 uppercase">Pix</p>
                  <p className="text-base font-black text-violet-600 mt-0.5 tabular-nums">{fmt(davidPix)}</p>
                  <p className="text-[7px] font-bold text-violet-500/80 uppercase mt-0.5">{davidQtdePix} recebimento(s)</p>
                </div>
              </div>
            </div>

            {/* LISTA: tudo que entrou à vista (Dinheiro e Pix) no período */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
              <div className="px-4 py-3 bg-gray-50/70">
                <p className="text-[9px] font-black text-gray-700 uppercase"><i className="fa-solid fa-list mr-1.5 text-gray-400"></i>Entradas à vista — Dinheiro e Pix</p>
              </div>
              {entradasDavid.length > 0 ? (
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {entradasDavid.map((p) => (
                    <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${p.metodo === 'DINHEIRO' ? 'bg-emerald-600 text-white' : 'bg-violet-600 text-white'}`}>{p.metodo === 'DINHEIRO' ? 'Dinheiro' : 'Pix'}</span>
                          {p.cliente && <span className="text-[9px] font-black text-gray-700 uppercase break-words">{p.cliente}</span>}
                        </div>
                        <p className="text-[8px] text-gray-400 font-bold uppercase mt-1">{hora(p.criadoEm)}</p>
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
                        <p className={`text-[11px] font-black text-right ${p.metodo === 'DINHEIRO' ? 'text-emerald-600' : 'text-violet-600'}`}>{fmt(p.valor)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center">
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest">Nada entrou à vista ainda neste caixa</p>
                  <p className="text-[8px] font-bold text-gray-300 uppercase mt-1">Conforme entrar em Dinheiro ou Pix, aparece aqui</p>
                </div>
              )}
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 mx-1">
              <p className="text-[8px] font-black text-gray-500 uppercase leading-relaxed">
                <i className="fa-solid fa-lock mr-1 text-gray-400"></i>Quem fecha o caixa é o ADMIN. Ao fechar, esses contadores ZERAM (novo período) e o recibo de entrega do dinheiro é gerado.
              </p>
            </div>
          </>
        )}

        {/* Comprovante do Pix (foto) — única janela extra da tela do David */}
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
      </div>
    );
  }

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
          Rota 5 · {desde ? `do último fechamento (${hora(desde)}) até agora` : 'caixa aberto — primeiro período'}
          {!isAdmin && ' · fechamento pelo admin'}
        </p>
        {/* BLOCO 167: "o caixa deve sempre atualizar" — refresh a cada 20s automático */}
        <p className="text-[8px] text-gray-300 font-bold uppercase mt-0.5">
          <i className="fa-solid fa-rotate mr-1"></i>Atualiza sozinho a cada 20s{atualizadoEm ? ` · última atualização ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
        </p>
      </div>

      {/* ================================================================
          BLOCO 235 — AS DUAS ABAS DO ADMIN (regra do dono):
          - CAIXA = tela SIMPLES: tudo que entrou à vista no período
            (Dinheiro para acertar conosco + Pix para conferir na conta).
          - LOG = log de recebimentos de TUDO (dinheiro, Pix e prazo pago)
            + o quanto tem A PRAZO PENDENTE + pagamentos + caixas fechados.
          ================================================================ */}
      <div className="flex gap-2 px-1">
        <button
          onClick={() => setAba('CAIXA')}
          className={`flex-1 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest border transition-all ${aba === 'CAIXA' ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}
        >
          <i className="fa-solid fa-cash-register mr-1.5"></i>Caixa do período
        </button>
        <button
          onClick={() => setAba('LOG')}
          className={`flex-1 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest border transition-all ${aba === 'LOG' ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white text-gray-400 border-gray-200'}`}
        >
          <i className="fa-solid fa-list-check mr-1.5"></i>Log de recebimentos
        </button>
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

      {/* ================================================================
          ABA CAIXA (padrão) — BLOCO 235: tela SIMPLES do admin, a mesma do
          David: tudo que entrou à vista no período (Dinheiro "para acertar
          conosco" + Pix "para conferir na conta") + lista das entradas +
          FECHAR (entrega o dinheiro, zera e gera o recibo de entrega).
          ================================================================ */}
      {!loading && !erro && aba === 'CAIXA' && (
        <>
          {/* O NÚMERO ÚNICO DA TELA: tudo que entrou à vista neste caixa */}
          <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-md mx-1">
            <p className="text-[8px] font-black text-gray-400 uppercase">Tudo que entrou à vista neste caixa</p>
            <p className="text-4xl font-black text-gray-800 mt-1 tabular-nums leading-tight">{fmt(avistaTotal)}</p>
            <p className="text-[8px] font-bold text-gray-400 uppercase mt-1.5">Dinheiro + Pix{totais.deposito > 0 ? ' + Depósito' : ''} · do último fechamento até agora</p>
            <div className={`grid gap-2 mt-4 ${totais.deposito > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="bg-emerald-50 rounded-2xl p-3 text-center">
                <p className="text-[8px] font-black text-emerald-500 uppercase">Dinheiro</p>
                <p className="text-base font-black text-emerald-600 mt-0.5 tabular-nums">{fmt(totais.dinheiro)}</p>
                <p className="text-[7px] font-bold text-emerald-500/80 uppercase mt-0.5 leading-tight">para acertar conosco · {adminQtdeDinheiro} recebimento(s)</p>
              </div>
              <div className="bg-violet-50 rounded-2xl p-3 text-center">
                <p className="text-[8px] font-black text-violet-500 uppercase">Pix</p>
                <p className="text-base font-black text-violet-600 mt-0.5 tabular-nums">{fmt(totais.pix)}</p>
                <p className="text-[7px] font-bold text-violet-500/80 uppercase mt-0.5 leading-tight">para conferir na conta · {adminQtdePix} recebimento(s)</p>
              </div>
              {totais.deposito > 0 && (
                <div className="bg-slate-50 rounded-2xl p-3 text-center">
                  <p className="text-[8px] font-black text-slate-500 uppercase">Depósito</p>
                  <p className="text-base font-black text-slate-600 mt-0.5 tabular-nums">{fmt(totais.deposito)}</p>
                  <p className="text-[7px] font-bold text-slate-500/80 uppercase mt-0.5 leading-tight">já direto no banco</p>
                </div>
              )}
            </div>
          </div>

          {/* LISTA: tudo que entrou à vista (Dinheiro e Pix) no período */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 py-3 bg-gray-50/70">
              <p className="text-[9px] font-black text-gray-700 uppercase"><i className="fa-solid fa-list mr-1.5 text-gray-400"></i>Entradas à vista — Dinheiro e Pix</p>
            </div>
            {entradasAvistaAdmin.length > 0 ? (
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {entradasAvistaAdmin.map((p) => (
                  <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${p.metodo === 'DINHEIRO' ? 'bg-emerald-600 text-white' : p.metodo === 'PIX' ? 'bg-violet-600 text-white' : 'bg-slate-600 text-white'}`}>{p.metodo === 'DINHEIRO' ? 'Dinheiro' : p.metodo === 'PIX' ? 'Pix' : 'Depósito'}</span>
                        {p.cliente && <span className="text-[9px] font-black text-gray-700 uppercase break-words">{p.cliente}</span>}
                      </div>
                      <p className="text-[8px] text-gray-400 font-bold uppercase mt-1">{hora(p.criadoEm)}</p>
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
                      <p className={`text-[11px] font-black text-right ${p.metodo === 'DINHEIRO' ? 'text-emerald-600' : p.metodo === 'PIX' ? 'text-violet-600' : 'text-slate-600'}`}>{fmt(p.valor)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-[9px] font-black uppercase text-gray-400 tracking-widest">Nada entrou à vista ainda neste caixa</p>
                <p className="text-[8px] font-bold text-gray-300 uppercase mt-1">Conforme o David receber em Dinheiro ou Pix, aparece aqui</p>
              </div>
            )}
          </div>

          {isAdmin ? (
            <button
              onClick={() => setModalFechar(true)}
              className="w-full mx-1 bg-gray-900 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest"
            >
              <i className="fa-solid fa-lock mr-2"></i>Fechar caixa agora — entregar {fmt(avistaTotal)}
            </button>
          ) : (
            <div className="w-full mx-1 bg-gray-100 text-gray-500 font-bold py-3 rounded-2xl uppercase text-[9px] tracking-widest text-center">
              <i className="fa-solid fa-lock mr-2"></i>Leitura — o ADMIN fecha o caixa
            </div>
          )}

          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 mx-1">
            <p className="text-[8px] font-black text-gray-500 uppercase leading-relaxed">
              <i className="fa-solid fa-lock mr-1 text-gray-400"></i>Fechar o caixa = você RECEBEU o dinheiro deste período (Dinheiro + Pix). Os contadores ZERAM, começa de novo e o RECIBO DE ENTREGA é gerado. O log de tudo e o a prazo pendente ficam no botão LOG DE RECEBIMENTOS.
            </p>
          </div>
        </>
      )}

      {/* ================================================================
          ABA LOG — BLOCO 235: "um log de recebimento de tudo ou seja
          dinheiro Pix e o prazo pago e mostrando o quanto tem prazo
          pendente" — mais os pagamentos ao David e os caixas fechados
          (recibo de entrega reimprimível).
          ================================================================ */}
      {!loading && !erro && aba === 'LOG' && (
        <>

          {/* ================================================================
              BLOCO 235 — LOG DE RECEBIMENTOS (o que já entrou = VERDE):
              à vista (com comprovante/exclusão) + boletos pagos com a DATA
              DA BAIXA. Filtro por forma para a conferência direta.
              ================================================================ */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 py-3 flex items-center justify-between bg-gray-50/70">
              <p className="text-[9px] font-black text-gray-700 uppercase"><i className="fa-solid fa-circle-check text-emerald-500 mr-1.5"></i>Log de recebimentos — tudo que já entrou</p>
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
              BLOCO 235 — A PRAZO PENDENTE (o quanto tem a prazo pendente):
              boletos em aberto de qualquer período. Não zera no fechamento —
              só sai daqui quando o pagamento cair (cai no LOG como prazo
              pago, com a data da baixa).
              ================================================================ */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden mx-1">
            <div className="px-4 py-3 flex items-center justify-between bg-gray-50/70">
              <p className="text-[9px] font-black text-gray-700 uppercase"><i className="fa-solid fa-barcode text-amber-500 mr-1.5"></i>A prazo pendente — o que ainda vai entrar</p>
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
                  {/* BLOCO 234: div clicável (não button) — o botão RECIBO fica
                      dentro do card e <button> não pode aninhar <button> */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => abrirFechamento(f)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirFechamento(f); } }}
                    className="w-full p-4 flex items-center justify-between gap-2 active:bg-gray-50 transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-gray-800 uppercase">
                        {new Date(f.fechadoEm).toLocaleDateString('pt-BR')} {new Date(f.fechadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        <span className="text-gray-400 font-bold normal-case"> · {f.fechadoPorNome || 'admin'}</span>
                      </p>
                      <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">
                        {f.qtdePagamentos} pagamento(s) · Din {fmt(f.totais.dinheiro)} · Pix {fmt(f.totais.pix)}{f.totais.deposito > 0 ? ` · Dep ${fmt(f.totais.deposito)}` : ''}{f.reciboNumero ? ` · recibo nº ${String(f.reciboNumero).padStart(6, '0')}` : ''}
                      </p>
                      {f.observacao && <p className="text-[8px] text-gray-400 font-semibold mt-0.5 break-words">{f.observacao}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* BLOCO 234: RECIBO DE ENTREGA — reimpressão da mesma via */}
                      <button
                        onClick={(e) => { e.stopPropagation(); abrirReciboEntrega({ id: f.id, reciboNumero: f.reciboNumero, fechadoEm: f.fechadoEm, janelaInicio: f.janelaInicio, dinheiro: f.totais.dinheiro, pix: f.totais.pix, deposito: f.totais.deposito, total: f.totais.total, qtde: f.qtdePagamentos, fechadoPorNome: f.fechadoPorNome }); }}
                        className="w-9 h-9 bg-gray-900 text-white rounded-xl flex items-center justify-center active:scale-90 transition-all"
                        title="Recibo de entrega do caixa (reimprimir)"
                      >
                        <i className="fa-solid fa-receipt text-xs"></i>
                      </button>
                      <p className="text-sm font-black text-gray-700">{fmt(f.totais.total)}</p>
                      {carregandoDetalhe === f.id ? <i className="fa-solid fa-spinner fa-spin text-gray-300 text-sm"></i> : <i className={`fa-solid fa-chevron-${detalhe[f.id] ? 'up' : 'down'} text-gray-300 text-xs`}></i>}
                    </div>
                  </div>
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
              <div className="flex justify-between text-sm font-black uppercase pt-1 border-t border-gray-200"><span className="text-gray-800">Total à vista a entregar</span><span className="text-emerald-600">{fmt(avistaTotal)}</span></div>
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
                <i className="fa-solid fa-lock mr-1"></i>Ao confirmar: o dinheiro à vista SAI DA MÃO DO DAVID e entra no caixa da empresa. Os contadores ZERAM e um novo período começa. O A PRAZO continua no LOG até o pagamento cair.
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
                Recebido no caixa: {fmt(verde)}
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
