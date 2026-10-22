import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoColumns } from '@/lib/serverSchema';
import { isFocusConfigured, consultarNota } from '@/lib/focusNfe';
import { validaCpfCnpj, mascaraCpfCnpj } from '@/lib/validaDoc';
import {
  isInterConfigured,
  emitirCobranca,
  recuperarCobranca,
  recuperarPdf,
  cancelarCobranca,
  interpretarCobranca,
  montarPagador,
  seuNumeroBoleto,
  validaVencimento,
  hojeSp,
  CobrancaPublica,
} from '@/lib/interBoleto';

/**
 * BOLETO BANCARIO INTER (Bloco 25) — cobranca boleto+pix na venda.
 *
 * GET  /api/boletos?saleId=...                 -> STATUS (le as colunas inter_*)
 * POST /api/boletos { acao: 'EMITIR', saleId, vencimento, valor?,
 *                     mensagem?, atrelarNFe?, docManual? }
 *      /api/boletos { acao: 'CONSULTAR', saleId }
 *      /api/boletos { acao: 'PDF', saleId }        -> { pdfBase64 }
 *      /api/boletos { acao: 'CANCELAR', saleId, motivo }   [ADMIN]
 *
 * Regras:
 * - Vendedor so mexe nas PROPRIAS vendas; admin em qualquer uma.
 * - Pagador: cadastro do cliente (cpfCnpj obrigatorio — boleto sem documento
 *   nao existe). Cliente sem doc aceita docManual informado na tela.
 * - Valor: saldo em aberto (valor_total - valor_pago) por padrao; min R$ 2,50
 *   (regra da API do Inter).
 * - Atrelar NF-e: se a venda tem nota AUTORIZADA com chave (44 dig), envia
 *   notaFiscal.chaveNFe na cobranca; sem chave, tenta buscar na Focus uma vez.
 * - A emissao e ASSINCRONA no Inter: POST devolve codigoSolicitacao e a
 *   cobranca passa por EM_PROCESSAMENTO -> A_RECEBER. O app consulta.
 * - Se as colunas do Bloco 25 ainda nao existirem, responde 503 com instrucao
 *   (probe serverSchema, padrao do projeto).
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

const COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, nota_status, nota_chave, nota_numero, inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_linha, inter_boleto_barras, inter_boleto_pix, inter_boleto_vencimento, inter_boleto_valor, inter_boleto_erro';

function cobrancaPublica(s: Record<string, unknown>): CobrancaPublica {
  return {
    status: (s.inter_boleto_status as string) || 'NAO_GERADO',
    codigo: (s.inter_boleto_codigo as string) || '',
    seuNumero: (s.inter_boleto_seu_numero as string) || '',
    vencimento: (s.inter_boleto_vencimento as string) || '',
    valor: s.inter_boleto_valor === null || s.inter_boleto_valor === undefined ? null : Number(s.inter_boleto_valor),
    linhaDigitavel: (s.inter_boleto_linha as string) || '',
    codigoBarras: (s.inter_boleto_barras as string) || '',
    pixCopiaECola: (s.inter_boleto_pix as string) || '',
    valorRecebido: null,
    erro: (s.inter_boleto_erro as string) || '',
  };
}

async function atualizar(saleId: string, patch: Record<string, unknown>) {
  await getServiceClient().from('sales').update(patch).eq('id', saleId);
}

/** Busca a chave da NF-e: coluna nota_chave ou consulta Focus uma vez. */
async function chaveDaNota(sale: Record<string, unknown>): Promise<string> {
  const chave = String((sale.nota_chave as string) || '').replace(/\D/g, '');
  if (chave.length === 44) return chave;
  if (sale.nota_status !== 'AUTORIZADA' || !isFocusConfigured()) return '';
  const ref = String(sale.nota_ref || sale.nota_numero || '');
  if (!ref) return '';
  try {
    const r = await consultarNota('nfe', ref);
    if (!r.ok || !r.data || 'erro' in r.data) return '';
    const data = r.data as Record<string, unknown>;
    const c = String(data.chave || '').replace(/\D/g, '');
    if (c.length === 44) {
      await atualizar(String(sale.id), { nota_chave: c });
      return c;
    }
  } catch { /* melhor esforco: segue sem atrelar */ }
  return '';
}

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const saleId = req.nextUrl.searchParams.get('saleId') || '';
  if (!saleId) return BAD(400, 'Parametro ausente (saleId).');
  if (!(await hasBoletoColumns())) return BAD(503, 'Colunas do boleto nao existem ainda no Supabase. Rode o SQL do Bloco 25 (sql/bloco25_boleto_inter.sql).');

  const db = getServiceClient();
  const { data: sale, error } = await db.from('sales').select(COLS).eq('id', saleId).single();
  if (error || !sale) return BAD(404, 'Venda nao encontrada.');
  if (session.perfil !== 'ADMIN' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode ver o boleto das suas proprias vendas.');
  }
  return NextResponse.json({ ok: true, boleto: cobrancaPublica(sale as Record<string, unknown>) });
}

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const body = await req.json().catch(() => ({}));
  const acao = body.acao as string;
  const saleId = body.saleId as string;
  if (!saleId || !acao) return BAD(400, 'Parametros ausentes (acao, saleId).');

  if (!(await hasBoletoColumns())) {
    return BAD(503, 'Colunas do boleto nao existem ainda no Supabase. Rode o SQL do Bloco 25 (sql/bloco25_boleto_inter.sql).');
  }

  const db = getServiceClient();
  const { data: sale, error: saleErr } = await db.from('sales').select(COLS).eq('id', saleId).single();
  if (saleErr || !sale) return BAD(404, 'Venda nao encontrada.');
  if (session.perfil !== 'ADMIN' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode gerar boleto para suas proprias vendas.');
  }

  // ---------- CONSULTAR ----------
  if (acao === 'CONSULTAR') {
    if (!sale.inter_boleto_codigo) return BAD(422, 'Esta venda ainda nao tem boleto gerado.');
    if (!isInterConfigured()) return BAD(503, 'Inter nao configurado (env INTER_CLIENT_ID / INTER_CLIENT_SECRET / certificado no Vercel).');
    const r = await recuperarCobranca(String(sale.inter_boleto_codigo));
    if (!r.ok) return BAD(502, r.erro || 'Falha ao consultar a API do Inter.', { boleto: cobrancaPublica(sale as Record<string, unknown>) });
    const cob = interpretarCobranca(r.data as Record<string, unknown>);
    await atualizar(saleId, {
      inter_boleto_status: cob.status,
      inter_boleto_linha: cob.linhaDigitavel || sale.inter_boleto_linha || null,
      inter_boleto_barras: cob.codigoBarras || sale.inter_boleto_barras || null,
      inter_boleto_pix: cob.pixCopiaECola || sale.inter_boleto_pix || null,
      inter_boleto_erro: cob.status === 'FALHA_EMISSAO' ? 'Falha na emissao no Inter' : null,
    });
    return NextResponse.json({ ok: true, boleto: cob });
  }

  // ---------- PDF ----------
  if (acao === 'PDF') {
    if (!sale.inter_boleto_codigo) return BAD(422, 'Esta venda ainda nao tem boleto gerado.');
    if (!isInterConfigured()) return BAD(503, 'Inter nao configurado (env INTER_CLIENT_ID / INTER_CLIENT_SECRET / certificado no Vercel).');
    const r = await recuperarPdf(String(sale.inter_boleto_codigo));
    if (!r.ok || !r.pdf) return BAD(502, r.erro || 'Falha ao buscar o PDF no Inter.');
    return NextResponse.json({ ok: true, pdfBase64: r.pdf.toString('base64') });
  }

  // ---------- CANCELAR (ADMIN) ----------
  if (acao === 'CANCELAR') {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin pode cancelar boletos.');
    if (!sale.inter_boleto_codigo) return BAD(422, 'Esta venda nao tem boleto para cancelar.');
    if (!isInterConfigured()) return BAD(503, 'Inter nao configurado (env INTER_CLIENT_ID / INTER_CLIENT_SECRET / certificado no Vercel).');
    const motivo = String(body.motivo || '').trim();
    if (!motivo) return BAD(422, 'Motivo do cancelamento obrigatorio (max. 50 caracteres).');
    const r = await cancelarCobranca(String(sale.inter_boleto_codigo), motivo);
    if (!r.ok && r.status !== 202) {
      return BAD(502, r.erro || 'Falha ao cancelar na API do Inter.', { boleto: cobrancaPublica(sale as Record<string, unknown>) });
    }
    await atualizar(saleId, { inter_boleto_status: 'CANCELADO', inter_boleto_erro: null });
    return NextResponse.json({ ok: true, boleto: { ...cobrancaPublica(sale as Record<string, unknown>), status: 'CANCELADO' } });
  }

  // ---------- EMITIR ----------
  if (acao !== 'EMITIR') return BAD(400, `Acao desconhecida: ${acao}`);

  // Ja tem boleto ATIVO? Devolve os dados (idempotencia na tela).
  if (sale.inter_boleto_codigo && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(String(sale.inter_boleto_status))) {
    return NextResponse.json({ ok: true, jaGerado: true, boleto: cobrancaPublica(sale as Record<string, unknown>) });
  }
  if (!isInterConfigured()) {
    return BAD(503, 'Inter nao configurado. Defina INTER_CLIENT_ID, INTER_CLIENT_SECRET e o certificado no Vercel (docs/BOLETOS-INTER.md).');
  }

  // Cliente + pagador
  const { data: client } = await db
    .from('clients')
    .select('nome_fantasia, nome, cnpj, telefone, endereco, bairro, razao_social, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email')
    .eq('id', sale.client_id)
    .single();
  if (!client) return BAD(422, 'Cliente da venda nao encontrado.');

  const pagador = montarPagador(client as Record<string, unknown>, String(body.docManual || ''), String(body.cepManual || ''));
  if (!pagador) {
    return BAD(422, 'Boleto precisa de CPF ou CNPJ do pagador. Complete o cadastro do cliente (Admin > Clientes) ou informe o documento na tela do boleto.');
  }

  // CEP: OBRIGATORIO na API do Inter (spec PagadorBase: cpfCnpj, nome,
  // tipoPessoa, cep, endereco, cidade, uf — cep com 8 digitos exatos).
  // Sem CEP o Inter recusa com a mensagem generica "Verifique se os dados
  // informados..." — aqui avisamos exatamente o que falta.
  const cepDig = String((pagador.cep as string) || '').replace(/\D/g, '');
  if (cepDig.length !== 8) {
    return BAD(422, 'O boleto do Inter precisa do CEP do pagador (8 digitos). Complete o CEP no cadastro do cliente (Admin > Clientes > endereço) ou informe o CEP na tela do boleto.');
  }

  // Documento com dígito verificador invalido tambem cai na mensagem
  // generica do Inter — validamos aqui para o erro ser claro.
  if (!validaCpfCnpj(pagador.cpfCnpj as string)) {
    return BAD(422, `O documento ${mascaraCpfCnpj(pagador.cpfCnpj as string)} está com os números inválidos — confira o CPF (11 digitos) ou CNPJ (14 digitos) do pagador.`);
  }

  // Valor: saldo em aberto (ou informado), minimo R$ 2,50 (regra da API)
  const total = Number(sale.valor_total) || 0;
  const pago = Number(sale.valor_pago) || 0;
  const saldo = Math.max(0, Math.round((total - pago) * 100) / 100);
  const valor = body.valor !== undefined && body.valor !== null && body.valor !== '' ? Number(body.valor) : saldo;
  if (!Number.isFinite(valor) || valor < 2.5) {
    return BAD(422, 'Valor invalido: o boleto do Inter precisa ser de no minimo R$ 2,50.');
  }
  if (valor > 99999999) return BAD(422, 'Valor acima do limite da API do Inter.');

  // Vencimento
  const venc = String(body.vencimento || '').trim();
  if (!validaVencimento(venc)) return BAD(422, 'Data de vencimento invalida (formato AAAA-MM-DD).');

  // Nota fiscal atrelada (opcional): chave de 44 digitos
  let notaFiscal: Record<string, unknown> | undefined;
  const atrelar = body.atrelarNFe !== false && sale.nota_status === 'AUTORIZADA';
  if (atrelar) {
    const chave = await chaveDaNota(sale as Record<string, unknown>);
    if (chave) {
      notaFiscal = {
        chaveNFe: chave,
        numero: Number(sale.nota_numero) || undefined,
        dataEmissao: hojeSp(),
        parcela: 1,
        naturezaOperacao: 'Venda de mercadoria',
      };
    }
  }

  const seuNumero = seuNumeroBoleto(saleId, (sale.inter_boleto_seu_numero as string) || undefined);
  const vendaCurta = String(saleId).slice(0, 8).toUpperCase();

  const payload = {
    seuNumero,
    valorNominal: Math.round(valor * 100) / 100,
    dataVencimento: venc,
    numDiasAgenda: 30,
    pagador,
    mensagem: {
      linha1: `Venda ${vendaCurta} - Doce Mania`,
      ...(body.mensagem ? { linha2: String(body.mensagem).slice(0, 70) } : {}),
      ...(notaFiscal ? {} : sale.nota_status === 'AUTORIZADA' ? { linha3: `NF-e ${String(sale.nota_numero)} (nao atrelada)` } : {}),
    },
    formasRecebimento: ['BOLETO', 'PIX'],
    notaFiscal,
  };

  // Marca processando antes de chamar o Inter (rastreabilidade se cair a conexao)
  await atualizar(saleId, {
    inter_boleto_status: 'EM_PROCESSAMENTO',
    inter_boleto_seu_numero: seuNumero,
    inter_boleto_valor: payload.valorNominal,
    inter_boleto_vencimento: venc,
    inter_boleto_erro: null,
  });

  const r = await emitirCobranca(payload as never);
  if (!r.ok || !r.data || !(r.data as Record<string, unknown>).codigoSolicitacao) {
    const erro = r.erro || `HTTP ${r.status}`;
    await atualizar(saleId, { inter_boleto_status: 'FALHA_EMISSAO', inter_boleto_erro: erro });
    return BAD(502, `Inter recusou o boleto: ${erro}`, { boleto: { status: 'FALHA_EMISSAO', erro } });
  }

  const codigo = String((r.data as Record<string, unknown>).codigoSolicitacao);
  await atualizar(saleId, { inter_boleto_codigo: codigo, inter_boleto_em: new Date().toISOString() });

  // A emissao e assincrona: consulta em seguida pra pegar linha digitavel se ja processou
  let boleto: CobrancaPublica = { status: 'EM_PROCESSAMENTO', codigo, seuNumero, vencimento: venc, valor: payload.valorNominal, linhaDigitavel: '', codigoBarras: '', pixCopiaECola: '', valorRecebido: null, erro: '' };
  const c = await recuperarCobranca(codigo);
  if (c.ok && c.data) {
    boleto = interpretarCobranca(c.data as Record<string, unknown>);
    await atualizar(saleId, {
      inter_boleto_status: boleto.status,
      inter_boleto_linha: boleto.linhaDigitavel || null,
      inter_boleto_barras: boleto.codigoBarras || null,
      inter_boleto_pix: boleto.pixCopiaECola || null,
    });
  }

  return NextResponse.json({ ok: true, boleto });
}
