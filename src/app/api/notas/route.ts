import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasNotaColumns, hasProductFiscalColumns } from '@/lib/serverSchema';
import {
  getFocusConfig,
  isFocusConfigured,
  emitirNfe,
  consultarNota,
  cancelarNota,
  interpretarResultado,
  montarPayloadNfe,
  refForSale,
  nextTentativa,
  validaCpfCnpj,
  numeroDoEndereco,
  FocusDoc,
} from '@/lib/focusNfe';

/**
 * NOTAS FISCAIS (Bloco 10) — emissao de NF-e / NFC-e na venda de pronta entrega.
 *
 * POST /api/notas   { acao: 'EMITIR', saleId, tipo?: 'NFE'|'NFCE' }
 *                   { acao: 'CONSULTAR', saleId }
 *                   { acao: 'CANCELAR', saleId, justificativa }   [ADMIN]
 *
 * Regras:
 * - Vendedor so mexe nas PROPRIAS vendas; admin em qualquer uma.
 * - Cliente com CNPJ valido -> NF-e (modelo 55). Consumidor final -> NFC-e.
 * - NF-e exige cadastro fiscal completo (razao, endereco, numero, bairro,
 *   municipio, UF). Rejeicao 422 orienta completar o cadastro.
 * - Se as colunas do Bloco 10 ainda nao existirem no Supabase, responde 503
 *   com instrucao clara (probe serverSchema, padrao do projeto).
 */

interface NotaPublica {
  status: string;
  numero: string;
  ref: string;
  pdfUrl: string;
  erro: string;
}

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

function carimbo(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

async function atualizarNota(saleId: string, patch: Record<string, unknown>) {
  await getServiceClient().from('sales').update(patch).eq('id', saleId);
}

function notaPublica(s: Record<string, unknown>): NotaPublica {
  return {
    status: (s.nota_status as string) || 'NAO_EMITIDA',
    numero: (s.nota_numero as string) || '',
    ref: (s.nota_ref as string) || '',
    pdfUrl: (s.nota_pdf_url as string) || '',
    erro: (s.nota_erro as string) || '',
  };
}

export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const body = await req.json().catch(() => ({}));
  const acao = body.acao as string;
  const saleId = body.saleId as string;
  if (!saleId || !acao) return BAD(400, 'Parametros ausentes (acao, saleId).');

  if (!(await hasNotaColumns())) {
    return BAD(503, 'Colunas de nota fiscal nao existem ainda no Supabase. Rode o SQL do Bloco 10 (docs/NOTAS-FISCAIS.md).');
  }

  const db = getServiceClient();

  // Carrega a venda e valida permissao
  const { data: sale, error: saleErr } = await db
    .from('sales')
    .select('id, vendedor_id, client_id, valor_total, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, nota_status, nota_tipo, nota_numero, nota_ref, nota_pdf_url, nota_xml_url, nota_erro')
    .eq('id', saleId)
    .single();

  if (saleErr || !sale) return BAD(404, 'Venda nao encontrada.');
  if (session.perfil !== 'ADMIN' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode emitir nota para suas proprias vendas.');
  }

  // ---------- CONSULTAR ----------
  if (acao === 'CONSULTAR') {
    if (!sale.nota_ref) return BAD(422, 'Esta venda ainda nao tem nota emitida.');
    if (!isFocusConfigured()) return BAD(503, 'Focus NFe nao configurada (env FOCUS_NFE_TOKEN no Vercel).');

    const doc: FocusDoc = sale.nota_tipo === 'NFCE' ? 'nfce' : 'nfe';
    const r = await consultarNota(doc, sale.nota_ref as string);
    if (!r.ok || !r.data || 'erro' in r.data) {
      return BAD(502, (r.data as { erro?: string }).erro || 'Falha ao consultar a Focus NFe.', { nota: notaPublica(sale as Record<string, unknown>) });
    }
    const res = interpretarResultado(r.data as Record<string, unknown>);
    const patch: Record<string, unknown> = {
      nota_status: res.autorizada ? 'AUTORIZADA' : res.cancelada ? 'CANCELADA' : res.motivo ? 'REJEITADA' : 'EMITINDO',
      nota_numero: res.numero || sale.nota_numero || null,
      nota_pdf_url: res.pdfUrl || sale.nota_pdf_url || null,
      nota_xml_url: res.xmlUrl || sale.nota_xml_url || null,
      nota_erro: res.autorizada ? null : res.motivo || null,
    };
    await atualizarNota(saleId, patch);
    return NextResponse.json({ ok: true, nota: { ...notaPublica(sale as Record<string, unknown>), ...res } });
  }

  // ---------- CANCELAR (ADMIN) ----------
  if (acao === 'CANCELAR') {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin pode cancelar notas.');
    if (!sale.nota_ref) return BAD(422, 'Esta venda nao tem nota para cancelar.');
    const just = (body.justificativa as string) || '';
    if (just.trim().length < 15) return BAD(422, 'Justificativa obrigatoria (minimo 15 caracteres — regra da SEFAZ).');
    if (!isFocusConfigured()) return BAD(503, 'Focus NFe nao configurada (env FOCUS_NFE_TOKEN no Vercel).');

    const doc: FocusDoc = sale.nota_tipo === 'NFCE' ? 'nfce' : 'nfe';
    const r = await cancelarNota(doc, sale.nota_ref as string, just);
    if (!r.ok || !r.data || 'erro' in r.data) {
      return BAD(502, (r.data as { erro?: string }).erro || 'Falha ao cancelar na Focus NFe.', { nota: notaPublica(sale as Record<string, unknown>) });
    }
    const res = interpretarResultado(r.data as Record<string, unknown>);
    await atualizarNota(saleId, {
      nota_status: res.cancelada ? 'CANCELADA' : sale.nota_status,
      nota_erro: res.cancelada ? null : res.motivo || null,
    });
    return NextResponse.json({ ok: res.cancelada, nota: { ...notaPublica(sale as Record<string, unknown>), ...res } });
  }

  // ---------- EMITIR ----------
  if (acao !== 'EMITIR') return BAD(400, `Acao desconhecida: ${acao}`);

  if (sale.nota_status === 'AUTORIZADA') {
    return NextResponse.json({ ok: true, jaEmitida: true, nota: notaPublica(sale as Record<string, unknown>) });
  }
  if (!isFocusConfigured()) {
    return BAD(503, 'Focus NFe nao configurada. Defina FOCUS_NFE_TOKEN no Vercel (docs/NOTAS-FISCAIS.md).');
  }

  const cfg = getFocusConfig();

  // Cliente da venda
  const { data: client } = await db
    .from('clients')
    .select('nome_fantasia, nome, cnpj, telefone, endereco, bairro, razao_social, inscricao_estadual, endereco_numero, endereco_cep, endereco_municipio, endereco_uf')
    .eq('id', sale.client_id)
    .single();

  if (!client) return BAD(422, 'Cliente da venda nao encontrado.');

  // Tipo automatico: CNPJ valido -> NFe; caso contrario NFC-e (consumidor)
  const cpfCnpj = validaCpfCnpj(client.cnpj);
  const tipoEscolhido = (body.tipo as string) || '';
  let doc: FocusDoc;
  if (tipoEscolhido === 'NFE' || tipoEscolhido === 'NFCE') {
    doc = tipoEscolhido === 'NFE' ? 'nfe' : 'nfce';
  } else {
    doc = cpfCnpj === 'CNPJ' ? 'nfe' : 'nfce';
  }

  // Itens + codigos fiscais (colunas ncm/cest/cfop se o Bloco 10 ja rodou)
  const fiscalCols = await hasProductFiscalColumns();
  const { data: items } = await db
    .from('sale_items')
    .select('produto_id, quantidade, preco_venda')
    .eq('sale_id', saleId);
  if (!items || items.length === 0) return BAD(422, 'Venda sem itens — nao e possivel emitir nota.');

  const prodIds = [...new Set(items.map((i: Record<string, unknown>) => i.produto_id as string))];
  const { data: prodsData } = await db
    .from('products')
    .select(fiscalCols ? 'id, nome, ncm, cest, cfop' : 'id, nome')
    .in('id', prodIds);
  const prods = (prodsData || []) as unknown as Record<string, unknown>[];
  const prodMap = new Map(prods.map(p => [p.id as string, p]));

  const metodos: Record<string, string> = { DINHEIRO: '01', PIX: '16', A_PRAZO: '15' };

  const payloadItems = items.map((i: Record<string, unknown>) => {
    const p = (prodMap.get(i.produto_id as string) || {}) as Record<string, unknown>;
    return {
      codigo: String(p.id || '').slice(0, 8),
      descricao: String(p.nome || 'Produto'),
      ncm: fiscalCols ? (p.ncm as string) || undefined : undefined,
      cest: fiscalCols ? (p.cest as string) || undefined : undefined,
      cfop: fiscalCols ? (p.cfop as string) || undefined : undefined,
      unidade: 'UN',
      quantidade: Number(i.quantidade) || 0,
      valorUnitario: Number(i.preco_venda) || 0,
    };
  });

  const valorTotal = Number(sale.valor_total) || 0;

  // Cliente para a nota (NF-e exige cadastro completo; NFC-e pode ser anonima)
  const uf = String(client.endereco_uf || '').toUpperCase().trim();
  const municipio = String(client.endereco_municipio || '').trim();
  const logradouro = String(client.endereco || '').trim();
  const bairro = String(client.bairro || '').trim();
  const razao = String(client.razao_social || client.nome_fantasia || '').trim();

  let clientePayload: Record<string, unknown> | undefined;
  if (doc === 'nfe') {
    const faltando: string[] = [];
    if (!cpfCnpj) faltando.push('CNPJ valido');
    if (!razao) faltando.push('Razao social / nome fantasia');
    if (!logradouro) faltando.push('Endereco (logradouro)');
    if (!bairro) faltando.push('Bairro');
    if (!municipio) faltando.push('Municipio');
    if (!uf) faltando.push('UF');
    if (faltando.length > 0) {
      return BAD(422, `Cadastro fiscal incompleto para NF-e. Complete no Admin > Clientes: ${faltando.join(', ')}.`);
    }
    const ie = String(client.inscricao_estadual || '').trim();
    clientePayload = {
      cpf_cnpj: String(client.cnpj).replace(/\D/g, ''),
      razao_social: razao,
      inscricao_estadual: ie || 'ISENTO',
      endereco_uf: uf,
      endereco_municipio: municipio,
      endereco_logradouro: logradouro,
      endereco_numero: numeroDoEndereco(client.endereco_numero as string, logradouro),
      endereco_bairro: bairro,
      endereco_cep: String(client.endereco_cep || '').replace(/\D/g, '') || undefined,
      telefone: String(client.telefone || '').replace(/\D/g, '') || undefined,
    };
  } else if (razao) {
    // NFC-e identificada (melhor para o cliente) — sem validacao dura
    clientePayload = {
      razao_social: razao.slice(0, 60),
      endereco_uf: uf || cfg.ufEmitente,
      endereco_municipio: municipio || '-',
      endereco_logradouro: logradouro || '-',
      endereco_numero: numeroDoEndereco(client.endereco_numero as string, logradouro),
      endereco_bairro: bairro || '-',
    };
    if (cpfCnpj) clientePayload.cpf_cnpj = String(client.cnpj).replace(/\D/g, '');
  }

  const ref = refForSale(saleId, nextTentativa(sale.nota_ref as string));

  const payload = montarPayloadNfe({
    dataVenda: new Date(sale.data_venda || Date.now()),
    natureza: cfg.natureza,
    ufEmitente: cfg.ufEmitente,
    cliente: (clientePayload || {
      razao_social: 'CONSUMIDOR NAO IDENTIFICADO',
      endereco_uf: cfg.ufEmitente,
      endereco_municipio: '-',
      endereco_logradouro: '-',
      endereco_numero: 'S/N',
      endereco_bairro: '-',
    }) as unknown as Parameters<typeof montarPayloadNfe>[0]['cliente'],
    itens: payloadItems,
    valorTotalVenda: valorTotal,
    pagamento: {
      forma_pagamento: metodos[sale.metodo_pagamento as string] || '01',
      valor_pagamento: valorTotal.toFixed(2),
    },
    informacoesAdicionais: `Venda ${saleId.slice(0, 8).toUpperCase()} registrada pelo app Doce Mania em ${carimbo()}.`,
  });

  // Marca EMITINDO antes de chamar a Focus (rastreabilidade se cair a conexao)
  await atualizarNota(saleId, { nota_status: 'EMITINDO', nota_tipo: doc === 'nfce' ? 'NFCE' : 'NFE', nota_ref: ref, nota_erro: null });

  const r = await emitirNfe(doc, ref, payload as never);
  if (!r.ok || !r.data || 'erro' in r.data) {
    const erro = (r.data as { erro?: string }).erro || `HTTP ${r.status}`;
    await atualizarNota(saleId, { nota_status: 'REJEITADA', nota_erro: erro });
    return BAD(502, erro, { nota: { status: 'REJEITADA', ref } });
  }

  const res = interpretarResultado(r.data as Record<string, unknown>);
  const patch: Record<string, unknown> = {
    nota_status: res.autorizada ? 'AUTORIZADA' : res.processando ? 'EMITINDO' : 'REJEITADA',
    nota_numero: res.numero || null,
    nota_pdf_url: res.pdfUrl || null,
    nota_xml_url: res.xmlUrl || null,
    nota_erro: res.autorizada ? null : res.motivo || 'Aguardando SEFAZ',
  };
  await atualizarNota(saleId, patch);

  return NextResponse.json({
    ok: res.autorizada || res.processando,
    nota: {
      status: patch.nota_status,
      numero: res.numero,
      ref,
      pdfUrl: res.pdfUrl,
      erro: patch.nota_erro,
    },
  });
}
