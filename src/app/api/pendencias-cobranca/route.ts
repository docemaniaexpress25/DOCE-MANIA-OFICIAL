import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { lerErpConfig } from '@/lib/erpConfig';
import { hojeSp } from '@/lib/interBoleto';
import { hasSalesBoletosTable } from '@/lib/serverSchema';

/**
 * BLOCO 211 — ALERTA DE VENDAS SEM COBRANCA (pedido do dono):
 * "cria tbm um sistema onde nao deixamos passar nenhuma venda sem cobrar,
 * tanto a vista como prazo. Imagina que tem uma venda a prazo que seria pra
 * gerar boleto e algum momento esquecemos de gerar esse boleto entao precisa
 * nos avisa."
 *
 * GET /api/pendencias-cobranca  (sessao do app — mesmo padrao das rotas)
 *
 * Regras:
 * - Janela: vendas dos ULTIMOS 180 dias com SALDO em aberto (valor_total -
 *   valor_pago > 0.01). Venda paga integralmente nunca entra.
 * - PRE_VENDA sem entrega confirmada fica FORA (a cobranca acontece na
 *   entrega — o alerta nao pode apitar pedido que ainda nem saiu).
 * - Classificacao de cada venda em aberto:
 *     a) metodo A_PRAZO  -> e OBRIGATORIO ter cobranca (boleto) gerada:
 *        cobranca ATIVA = boleto UNICO (inter_boleto_codigo com status
 *        A_RECEBER/ATRASADO/EM_PROCESSAMENTO/RECEBIDO...) OU alguma PARCELA
 *        (sales_boletos) com cobranca ativa. Sem NENHUMA cobranca ativa
 *        (nunca gerou / so tem boleto CANCELADO/EXPIRADO/FALHADO / parcelas
 *        criadas e nunca emitidas) -> pendencia BOLETO_NAO_GERADO.
 *     b) metodo a VISTA (DINHEIRO/PIX/CARTAO/etc.) com saldo ->
 *        pendencia AVISTA_SEM_PAGAMENTO (recebimento nao registrado — o
 *        recebedor confirma em Contas a Receber).
 * - A prazo COM boleto ativo NAO entra aqui: boleto existe (o vencido/atraso
 *   e papel do Portal de Cobrancas /cobrancas).
 * - BLOCO 214 (pedido do dono): “Retire o card de vendas sem cobrança e
 *   deixe apenas para o admin” — o alerta é EXCLUSIVO do ADMIN: a HOME do
 *   vendedor não renderiza mais o card e esta API devolve 403 para qualquer
 *   perfil que não seja ADMIN (antes: ADMIN/SECRETARIO viam tudo e VENDEDOR
 *   via as proprias).
 * - Retorna a mensagem de cobranca do ERP (mesma do portal /cobrancas) para
 *   o WhatsApp do alerta usar os placeholders {nome} {valor} {dias}.
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

const JANELA_DIAS = 180;

/** Situacoes que NAO contam como cobranca ativa (boleto morto ou nunca emitido). */
const STATUS_MORTO = new Set(['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO']);

function dataMenosDiasSp(dias: number): string {
  const d = new Date(new Date(`${hojeSp()}T12:00:00Z`).getTime() - dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Telefone do cadastro -> wa.me (55 + DDD + numero). Vazio se invalido. */
function telWaMe(tel: string): string {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  while (d.startsWith('0')) d = d.slice(1);
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  return '';
}

export interface PendenciaCobrancaApi {
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
  /** a prazo: parcelas da divisao criadas mas nunca emitidas (se existirem) */
  parcelasPendentes?: number;
}

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  // BLOCO 214 (regra do dono): alerta EXCLUSIVO do administrador.
  if (session.perfil !== 'ADMIN') return BAD(403, 'Alerta de cobranca exclusivo do administrador.');

  const db = getServiceClient();
  const desde = dataMenosDiasSp(JANELA_DIAS);

  // Colunas inter_* podem nao existir (SQL do Bloco 25 nao rodado): degrada
  // sem as colunas e o boleto unico fica "sempre ausente" (as parcelas da
  // sales_boletos ainda cobrem a deteccao quando a tabela existir).
  let vendas: Record<string, unknown>[] | null = null;
  const colsComBoleto = 'id, data_venda, valor_total, valor_pago, metodo_pagamento, status_pagamento, tipo_venda, entrega_status, client_id, vendedor_id, inter_boleto_status, inter_boleto_codigo';
  let e: { message: string } | null = null;
  {
    // BLOCO 212: order DESC antes do limit — sem order, quando a base passa de
    // 1000 vendas no período o PostgREST cortava linhas ARBITRARIAS e vendas
    // em aberto sumiam do alerta (o propósito do Bloco 211 falhava).
    const r = await db.from('sales').select(colsComBoleto).gte('data_venda', desde).order('data_venda', { ascending: false }).limit(2000);
    if (r.error) e = r.error;
    else vendas = (r.data as Record<string, unknown>[]) || [];
  }
  if (vendas === null && e && /column/i.test(e.message || '')) {
    const r2 = await db.from('sales').select('id, data_venda, valor_total, valor_pago, metodo_pagamento, status_pagamento, tipo_venda, entrega_status, client_id, vendedor_id').gte('data_venda', desde).order('data_venda', { ascending: false }).limit(2000);
    vendas = (r2.data as Record<string, unknown>[]) || [];
  } else if (vendas === null) {
    return BAD(500, e?.message || 'Falha ao consultar as vendas.');
  }

  const hoje = hojeSp();
  const hojeTs = new Date(`${hoje}T12:00:00Z`).getTime();

  // Candidatas: saldo em aberto + pre-venda ja entregue (ou venda pronta)
  const candidatas = (vendas || []).filter(s => {
    const total = Number(s.valor_total) || 0;
    const pago = Number(s.valor_pago) || 0;
    if (Math.round((total - pago) * 100) / 100 <= 0.01) return false;
    if (String(s.tipo_venda || '') === 'PRE_VENDA' && String(s.entrega_status || '') !== 'ENTREGUE') return false;
    return true;
  });

  // Parcelas das candidatas (boleto duplo rota 5): so se a tabela existir
  const parcelasPorSale = new Map<string, { codigo: string; status: string; seq: number }[]>();
  if (candidatas.length > 0 && (await hasSalesBoletosTable())) {
    const ids = candidatas.map(s => String(s.id));
    const { data: pl } = await db.from('sales_boletos').select('sale_id, seq, status, codigo').in('sale_id', ids).order('seq', { ascending: true }).limit(4000);
    for (const p of (pl as Record<string, unknown>[]) || []) {
      const sid = String(p.sale_id || '');
      if (!parcelasPorSale.has(sid)) parcelasPorSale.set(sid, []);
      parcelasPorSale.get(sid)!.push({ codigo: String(p.codigo || ''), status: String(p.status || 'NAO_GERADO'), seq: Number(p.seq) || 1 });
    }
  }

  // Clientes + vendedores para nome/telefone
  const [cRes, uRes] = await Promise.all([
    db.from('clients').select('id, nome_fantasia, nome, telefone'),
    db.from('app_users').select('id, nome'),
  ]);
  const clientePorId = new Map<string, Record<string, unknown>>();
  for (const c of (cRes.data as Record<string, unknown>[]) || []) clientePorId.set(String(c.id || ''), c);
  const vendedorPorId = new Map<string, string>();
  for (const u of (uRes.data as Record<string, unknown>[]) || []) vendedorPorId.set(String(u.id || ''), String(u.nome || ''));

  // BLOCO 214: sem filtro por vendedor — so o ADMIN chega aqui e ve TODAS as
  // pendencias da empresa.

  const pendencias: PendenciaCobrancaApi[] = [];
  for (const s of candidatas) {
    const metodo = String(s.metodo_pagamento || 'A_PRAZO').toUpperCase();
    const total = Math.round((Number(s.valor_total) || 0) * 100) / 100;
    const pago = Math.round((Number(s.valor_pago) || 0) * 100) / 100;
    const saldo = Math.round((total - pago) * 100) / 100;
    const saleId = String(s.id);

    // Cobranca ATIVA existe? (boleto unico OU alguma parcela emitida)
    const statusUnico = String(s.inter_boleto_status || 'NAO_GERADO');
    const unicoAtivo = Boolean(s.inter_boleto_codigo) && !STATUS_MORTO.has(statusUnico);
    const parcelas = parcelasPorSale.get(saleId) || [];
    const parcelaAtiva = parcelas.some(p => p.codigo && !STATUS_MORTO.has(p.status));

    let tipo: PendenciaCobrancaApi['tipo'] | null = null;
    let parcelasPendentes: number | undefined;
    if (metodo === 'A_PRAZO') {
      if (!unicoAtivo && !parcelaAtiva) {
        tipo = 'BOLETO_NAO_GERADO';
        const pend = parcelas.filter(p => !p.codigo || STATUS_MORTO.has(p.status)).length;
        if (pend > 0) parcelasPendentes = pend;
      }
    } else {
      tipo = 'AVISTA_SEM_PAGAMENTO';
    }
    if (!tipo) continue;

    const dataVenda = String(s.data_venda || '');
    const dias = Math.max(0, Math.round((hojeTs - new Date(`${dataVenda.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000));
    const cli = clientePorId.get(String(s.client_id || '')) || {};
    const nomeCliente = String((cli.nome_fantasia as string) || (cli.nome as string) || 'Cliente');
    pendencias.push({
      saleId,
      dataVenda,
      dias,
      cliente: nomeCliente,
      telefone: telWaMe(String((cli.telefone as string) || '')),
      valorTotal: total,
      valorPago: pago,
      saldo,
      metodo,
      tipo,
      vendedor: vendedorPorId.get(String(s.vendedor_id || '')) || '',
      ...(parcelasPendentes ? { parcelasPendentes } : {}),
    });
  }

  // Mais antiga primeiro (a que foi esquecida ha mais tempo grita primeiro)
  pendencias.sort((a, b) => a.dataVenda.localeCompare(b.dataVenda));

  const erp = await lerErpConfig();
  const totalSaldo = Math.round(pendencias.reduce((acc, p) => acc + p.saldo, 0) * 100) / 100;

  return NextResponse.json({
    ok: true,
    pendencias,
    totalPendencias: pendencias.length,
    totalSaldo,
    mensagemPadrao: erp.cobrancaMensagem || '',
    consultadoEm: new Date().toISOString(),
  });
}
