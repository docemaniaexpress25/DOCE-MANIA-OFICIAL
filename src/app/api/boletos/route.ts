import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoColumns, hasBoletoCpfColumn } from '@/lib/serverSchema';
import { isFocusConfigured, consultarNota, FocusDoc } from '@/lib/focusNfe';
// BLOCO 147: nota cancelada + boleto cancelado = venda sai do sistema (e a nota fica no portal em CANCELADAS)
import { finalizarVendaCancelada } from '@/lib/cascataCancelamento';
import { lerErpConfig } from '@/lib/erpConfig';
import { validaCpfCnpj, mascaraCpfCnpj } from '@/lib/validaDoc';
import {
  isInterConfigured,
  getInterConfig,
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
 * BLOCO 152: acao MINI (mini boleto 80mm) EXCLUIDA — o boleto do app e o
 * PDF ORIGINAL do Inter (acao PDF). O texto padrao do dono entra na LINHA 2
 * da mensagem da cobranca (o Inter imprime as linhas 1..5 do campo mensagem
 * no PDF, secao INFORMAÇÕES DE RESPONSABILIDADE DO BENEFICIÁRIO) — o texto
 * é configurado no hub ERP Fiscal (app_settings.erp_config) e cai em TODO
 * boleto novo, sem mexer em nada na tela do vendedor.
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

const COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, nota_status, nota_tipo, nota_chave, nota_numero, nota_ref, inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_linha, inter_boleto_barras, inter_boleto_pix, inter_boleto_vencimento, inter_boleto_valor, inter_boleto_erro';

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
    notaFiscalChave: '',
  };
}

async function atualizar(saleId: string, patch: Record<string, unknown>) {
  await getServiceClient().from('sales').update(patch).eq('id', saleId);
}

/**
 * Busca a chave da NF-e/NFC-e: coluna nota_chave ou consulta Focus uma vez.
 * FIX "erro para atrelar NFe OU NFC ao boleto": a consulta na Focus usava
 * SEMPRE o endpoint /v2/nfe/{ref} — para venda com NFC-e a nota nunca era
 * encontrada (NFC-e vive em /v2/nfce) e o boleto saía sem notaFiscal.
 * Agora o doc segue nota_tipo (NFCE -> 'nfce').
 * BLOCO 150: nota_ref ENTROU no COLS — antes a busca na Focus usava
 * nota_numero (que não é a referência do documento na Focus) e a chave
 * nunca chegava; agora usa a MESMA referência gravada na emissão.
 */
async function chaveDaNota(sale: Record<string, unknown>): Promise<string> {
  const chave = String((sale.nota_chave as string) || '').replace(/\D/g, '');
  if (chave.length === 44) return chave;
  if (sale.nota_status !== 'AUTORIZADA' || !isFocusConfigured()) return '';
  const ref = String(sale.nota_ref || sale.nota_numero || '');
  if (!ref) return '';
  const doc: FocusDoc = String(sale.nota_tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe';
  try {
    const r = await consultarNota(doc, ref);
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
  // BLOCO 85: status das credenciais Inter visivel no app — o dono para de
  // adivinhar "pode ser o env na vercel": o card AVISA quando falta env.
  // FIX atrelamento: devolve o estado da NOTA da venda para o portal/card
  // mostrar se a NF-e/NFC-e está atrelada ao boleto (ou deveria estar).
  // BLOCO 177: nota ganha TIPO ('NFE' | 'NFCE') — o card só oferece
  // atrelamento (e o papel só escreve "ATRELADO A NF-e") no modelo 55; e o
  // config leva o TEXTO configurado no ERP Fiscal + o beneficiário real
  // (emitente do ERP) para o MINI BOLETO sair completo.
  const erpCfgGet = await lerErpConfig();
  return NextResponse.json({
    ok: true,
    boleto: cobrancaPublica(sale as Record<string, unknown>),
    inter: { configurado: isInterConfigured(), ambiente: getInterConfig().ambiente },
    nota: {
      status: String(sale.nota_status || ''),
      numero: String(sale.nota_numero || ''),
      chave: String(sale.nota_chave || ''),
      tipo: String(sale.nota_tipo || ''),
    },
    config: {
      mensagemPadrao: erpCfgGet.boletoMensagemPadrao || '',
      beneficiarioNome: erpCfgGet.emitente.fantasia || erpCfgGet.emitente.razao || 'DOCE MANIA',
      beneficiarioDoc: erpCfgGet.emitente.cnpj || '',
    },
  });
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

    // -----------------------------------------------------------------
    // BLOCO 147 (regra do dono): nota CANCELADA + boleto CANCELADO = a
    // venda termina de sair do sistema. Este caso nasce quando o
    // cancelamento da NOTA parou porque o boleto estava vivo (Inter fora/
    // sem config) — a venda ficou no portal em CANCELADAS justamente para
    // o admin cancelar o boleto aqui. Agora que o boleto saiu, a cascata
    // finaliza: arquiva a nota cancelada no portal + devolve estoque +
    // exclui a venda. O portal passa a listar a nota no filtro CANCELADAS.
    // -----------------------------------------------------------------
    if (String(sale.nota_status || '').toUpperCase() === 'CANCELADA') {
      const cascade = await finalizarVendaCancelada(saleId);
      return NextResponse.json({
        ok: true,
        boleto: { ...cobrancaPublica(sale as Record<string, unknown>), status: 'CANCELADO' },
        aviso: `Boleto cancelado no Inter. ${cascade.length > 0 ? cascade.join(' · ') + '.' : ''}`,
        cascade,
      });
    }
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
  // BLOCO 189: o CPF do cadastro entra no montarPagador — mas a coluna só
  // existe depois do SQL. Sem o SQL: refaz o select sem cpf (degrada ok).
  let { data: client, error: eClient } = await db
    .from('clients')
    .select('nome_fantasia, nome, cnpj, cpf, telefone, endereco, bairro, razao_social, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email')
    .eq('id', sale.client_id)
    .single();
  if (eClient && /column|cpf/i.test(eClient.message || '')) {
    ({ data: client } = await db
      .from('clients')
      .select('nome_fantasia, nome, cnpj, telefone, endereco, bairro, razao_social, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email')
      .eq('id', sale.client_id)
      .single());
  }
  if (!client) return BAD(422, 'Cliente da venda nao encontrado.');

  // -----------------------------------------------------------------
  // BLOCO 187 (regra do dono): o CPF/CNPJ capturado NA VENDA (sales.boleto_cpf,
  // coluna do bloco 187 — vendedor é OBRIGADO a pedir na tela 6) entra como
  // fallback quando a tela do boleto não digitou nada — o boleto do prazo
  // nasce sozinho, SEM pedir CPF de novo. Prioridade: docManual digitado na
  // tela > boleto_cpf da venda > cadastro do cliente (dentro do montarPagador).
  // -----------------------------------------------------------------
  let docDaVenda = '';
  if (!String(body.docManual || '').replace(/\D/g, '') && (await hasBoletoCpfColumn())) {
    const { data: saleCpf } = await db.from('sales').select('boleto_cpf').eq('id', saleId).maybeSingle();
    docDaVenda = String((saleCpf as Record<string, unknown> | null)?.boleto_cpf || '').replace(/\D/g, '');
  }
  const pagador = montarPagador(client as Record<string, unknown>, String(body.docManual || '') || docDaVenda, String(body.cepManual || ''));
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

  // Nota fiscal atrelada (opcional): chave de 44 digitos.
  // BLOCO 177 (regra do dono: "nfe seria cnpj, nfc > cpf... nesse boleto nao
  // precisa atrelar a nfc, somente atrelar a nfe o boleto"): o vinculo
  // formal notaFiscal agora so acontece na NF-e (modelo 55). NFC-e AUTORIZADA
  // NUNCA atrela (nem aviso, nem linha "nao atrelada" no PDF) — o boleto do
  // cliente PF (CPF) simplesmente NAO tem nota para atrelar.
  let notaFiscal: Record<string, unknown> | undefined;
  let avisoAtrelamento = '';
  const tipoNota = String(sale.nota_tipo || '').toUpperCase();
  const podeAtrelar = sale.nota_status === 'AUTORIZADA' && tipoNota === 'NFE';
  const atrelar = body.atrelarNFe !== false && podeAtrelar;
  if (podeAtrelar) {
    const chave = await chaveDaNota(sale as Record<string, unknown>);
    if (chave) {
      if (atrelar) {
        notaFiscal = {
          chaveNFe: chave,
          numero: Number(sale.nota_numero) || undefined,
          dataEmissao: hojeSp(),
          parcela: 1,
          naturezaOperacao: 'Venda de mercadoria',
        };
      } else {
        avisoAtrelamento = 'A venda tem NF-e autorizada — ative "Atrelar NF-e" para vinculá-la ao boleto.';
      }
    } else {
      avisoAtrelamento = 'NF-e autorizada, mas a chave de acesso ainda não chegou (SEFAZ/Focus). O boleto sai sem nota atrelada — consulte o boleto depois para conferir.';
    }
  }

  const seuNumero = seuNumeroBoleto(saleId, (sale.inter_boleto_seu_numero as string) || undefined);
  const vendaCurta = String(saleId).slice(0, 8).toUpperCase();

  // ------------------------------------------------------------------
  // BLOCO 152 — TEXTO PADRÃO DO BOLETO (pedido do dono): as linhas do
  // campo `mensagem` da API do Inter (linha1..linha5, ate 78 chars cada)
  // saem no PDF na seção "INFORMAÇÕES DE RESPONSABILIDADE DO BENEFICIÁRIO".
  // linha1 = venda (sempre) | linha2 = texto padrao do dono (config no hub
  // ERP Fiscal / env INTER_MENSAGEM_PADRAO) | linha3 = mensagem avulsa da
  // tela | linha4 = nota nao atrelada (quando couber).
  // ------------------------------------------------------------------
  const erpCfg = await lerErpConfig();
  const msgPadrao = (erpCfg.boletoMensagemPadrao || process.env.INTER_MENSAGEM_PADRAO || '').trim().slice(0, 78);

  const payload = {
    seuNumero,
    valorNominal: Math.round(valor * 100) / 100,
    dataVencimento: venc,
    numDiasAgenda: 30,
    pagador,
    mensagem: {
      linha1: `Venda ${vendaCurta} - Doce Mania`,
      ...(msgPadrao ? { linha2: msgPadrao } : {}),
      ...(body.mensagem ? { linha3: String(body.mensagem).slice(0, 78) } : {}),
      ...(notaFiscal ? {} : podeAtrelar ? { linha4: `NF-e ${String(sale.nota_numero)} (nao atrelada)` } : {}),
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

  let r = await emitirCobranca(payload as never);
  // -----------------------------------------------------------------
  // BLOCO 150 (dono: "ESTA DANDO FALHA AO GERAR BOLETO ATRELADO A NF").
  // O POST da cobranca v3 pode recusar o objeto notaFiscal (campo não
  // aceito em todas as contas/ambiente) e aí o boleto do prazo morria
  // INTEIRO. Agora: retenta SEM o vínculo formal e leva a NFC-e/NF-e
  // para a MENSAGEM do boleto (aparece no PDF do Inter e no comprovante
  // 80mm). O boleto NUNCA mais falha por causa da nota — e o VALOR
  // segue sendo X (saldo da VENDA): a NFC-e anônima sai no preço cupom
  // e pode ter valor menor — isso NÃO interfere no boleto.
  // -----------------------------------------------------------------
  let fallbackSemNota = false;
  if (!r.ok && notaFiscal) {
    const semNota = {
      ...payload,
      notaFiscal: undefined,
      mensagem: {
        ...payload.mensagem,
        linha5: `${String(sale.nota_tipo || '').toUpperCase() === 'NFE' ? 'NF-e' : 'NFC-e'} ${String(sale.nota_numero || '')} atrelada a esta cobranca`,
      },
    };
    r = await emitirCobranca(semNota as never);
    fallbackSemNota = r.ok;
  }
  if (!r.ok || !r.data || !(r.data as Record<string, unknown>).codigoSolicitacao) {
    const erro = r.erro || `HTTP ${r.status}`;
    await atualizar(saleId, { inter_boleto_status: 'FALHA_EMISSAO', inter_boleto_erro: erro });
    return BAD(502, `Inter recusou o boleto: ${erro}`, { boleto: { status: 'FALHA_EMISSAO', erro } });
  }

  const codigo = String((r.data as Record<string, unknown>).codigoSolicitacao);
  await atualizar(saleId, { inter_boleto_codigo: codigo, inter_boleto_em: new Date().toISOString() });

  // A emissao e assincrona: consulta em seguida pra pegar linha digitavel se ja processou
  let boleto: CobrancaPublica = { status: 'EM_PROCESSAMENTO', codigo, seuNumero, vencimento: venc, valor: payload.valorNominal, linhaDigitavel: '', codigoBarras: '', pixCopiaECola: '', valorRecebido: null, erro: '', notaFiscalChave: '' };
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

  return NextResponse.json({
    ok: true,
    boleto,
    ...(notaFiscal && !fallbackSemNota ? { notaAtrelada: true } : {}),
    ...(fallbackSemNota
      ? { avisoAtrelamento: `Boleto GERADO com o valor da venda. O Inter não aceitou o vínculo formal da nota agora — a ${String(sale.nota_tipo || '').toUpperCase() === 'NFE' ? 'NF-e' : 'NFC-e'} ${String(sale.nota_numero || '')} ficou escrita na mensagem do boleto (aparece no PDF e no comprovante).` }
      : avisoAtrelamento ? { avisoAtrelamento } : {}),
  });
}
