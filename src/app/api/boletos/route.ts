import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasBoletoColumns, hasBoletoCpfColumn, hasSalesBoletosTable } from '@/lib/serverSchema';
import { isFocusConfigured, consultarNota, FocusDoc } from '@/lib/focusNfe';
import { lerErpConfig } from '@/lib/erpConfig';
import { validaCpfCnpj, mascaraCpfCnpj } from '@/lib/validaDoc';
import {
  isInterConfigured,
  getInterConfig,
  emitirCobrancaComRetry,
  ehErroTransienteInter,
  recuperarCobranca,
  recuperarPdf,
  cancelarCobranca,
  interpretarCobranca,
  montarPagador,
  seuNumeroBoleto,
  seuNumeroParcela,
  validaVencimento,
  hojeSp,
  CobrancaPublica,
} from '@/lib/interBoleto';
import { espelharParcelaInter, baixarParcelaPaga, type ParcelaRow } from '@/lib/baixaBoleto';
// BLOCO 200 (regra do dono): a divisão em 2 boletos é EXCLUSIVA da rota 5
// (Deivid/David) — o SERVIDOR confere de novo (fonte da verdade), com a
// mesma lib de equipe do caixa/comissão (sem dependências).
import { isDavidVendedor } from '@/lib/equipe';

/**
 * BOLETO BANCARIO INTER (Bloco 25) — cobranca boleto+pix na venda.
 *
 * GET  /api/boletos?saleId=...                 -> STATUS (le as colunas inter_*)
 *                                                 + parcelas (Bloco 199 — boleto duplo)
 * POST /api/boletos { acao: 'EMITIR', saleId, vencimento, valor?,
 *                     mensagem?, atrelarNFe?, docManual?, parcelaId? }
 *      /api/boletos { acao: 'CONSULTAR', saleId, parcelaId? }
 *      /api/boletos { acao: 'PDF', saleId, parcelaId? }        -> { pdfBase64 }
 *      /api/boletos { acao: 'CANCELAR', saleId, motivo, parcelaId? }   [ADMIN]
 *
 * BLOCO 199 — BOLETO DUPLICO (regra do dono, EXCLUSIVO rota 5 / Deivid):
 *      { acao: 'CRIAR_PARCELAS', saleId, boletos: [{valor, vencimento} x2] }
 *      { acao: 'EMITIR', saleId, parcelaId }        -> emite UMA parcela
 *      { acao: 'EMITIR_TODAS', saleId }             -> emite as parcelas abertas
 *      Dois boletos que JUNTOS fecham o valor da venda (ex.: 1º em 7 dias com
 *      parte do valor e o RESTANTE no 2º em 14 dias — ou dividir por 2). A
 *      venda continua única: cada parcela é uma cobrança própria no Inter e
 *      baixa com webhook/cron igual (lib/baixaBoleto).
 *
 * BLOCO 152: acao MINI (mini boleto 80mm) EXCLUIDA — o boleto do app e o
 * PDF ORIGINAL do Inter (acao PDF). O texto padrao do dono entra na LINHA 2
 * da mensagem da cobranca.
 *
 * Regras:
 * - Vendedor so mexe nas PROPRIAS vendas; admin em qualquer uma.
 * - Pagador: cadastro do cliente (cpfCnpj obrigatorio — boleto sem documento
 *   nao existe). Cliente sem doc aceita docManual informado na tela.
 *   Prioridade: docManual > parcela.doc > sales.boleto_cpf > cadastro.
 * - Valor: parcela tem o SEU valor; boleto unico usa o saldo (min R$ 2,50).
 * - Atrelar NF-e: venda com nota AUTORIZADA modelo 55 (Bloco 177) — nas
 *   parcelas, a NF-e entra com parcela = seq da cobranca.
 * - A emissao e ASSINCRONA no Inter: POST devolve codigoSolicitacao e a
 *   cobranca passa por EM_PROCESSAMENTO -> A_RECEBER. O app consulta.
 * - Se as colunas/tabelas ainda nao existirem, responde 503 com instrucao
 *   (probe serverSchema, padrao do projeto).
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

// BLOCO 225: inter_boleto_em entra no COLS — o card precisa saber HÁ QUANTO
// tempo a cobrança está EM_PROCESSAMENTO no Inter (processamento normal x
// emissão travada que merece o DESTRAVAR).
const COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, nota_status, nota_tipo, nota_chave, nota_numero, nota_ref, inter_boleto_status, inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_linha, inter_boleto_barras, inter_boleto_pix, inter_boleto_vencimento, inter_boleto_valor, inter_boleto_erro, inter_boleto_em';

// Bloco 199: colunas da parcela (sales_boletos)
const PARC_COLS = 'id, sale_id, seq, valor, vencimento, doc, cep, status, codigo, seu_numero, linha, barras, pix, erro, emitido_em, pago_em';

/**
 * BLOCO 225: minutos desde que a cobrança entrou EM_PROCESSAMENTO no Inter
 * (inter_boleto_em / parcela.emitido_em). Avisar o DESTRAVAR quando passa de
 * 30 minutos sem processar — o dono precisa distinguir "o Inter está
 * processando normal" de "essa emissão travou lá dentro".
 */
function tempoProcessando(emIso: unknown, status: string): { processandoMin: number | null; avisarDestravar: boolean } {
  if (status !== 'EM_PROCESSAMENTO' || !emIso) return { processandoMin: null, avisarDestravar: false };
  const t = new Date(String(emIso)).getTime();
  if (!Number.isFinite(t)) return { processandoMin: null, avisarDestravar: false };
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return { processandoMin: min, avisarDestravar: min >= 30 };
}

function cobrancaPublica(s: Record<string, unknown>): CobrancaPublica & { processandoMin: number | null; avisarDestravar: boolean } {
  const st = (s.inter_boleto_status as string) || 'NAO_GERADO';
  return {
    status: st,
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
    // BLOCO 225: tempo preso em EM_PROCESSAMENTO + aviso do DESTRAVAR.
    ...tempoProcessando(s.inter_boleto_em, st),
  };
}

/** Bloco 199: parcela no formato publico do app (camelCase, valores tipados). */
function parcelaPublica(p: Record<string, unknown>) {
  const st = String(p.status || 'NAO_GERADO');
  return {
    id: String(p.id || ''),
    seq: Number(p.seq) || 1,
    valor: Number(p.valor) || 0,
    vencimento: String(p.vencimento || '').slice(0, 10),
    status: st,
    codigo: String(p.codigo || ''),
    seuNumero: String(p.seu_numero || ''),
    linhaDigitavel: String(p.linha || ''),
    codigoBarras: String(p.barras || ''),
    pixCopiaECola: String(p.pix || ''),
    erro: String(p.erro || ''),
    // BLOCO 225: minutos em EM_PROCESSAMENTO + aviso do DESTRAVAR (>= 30 min).
    ...tempoProcessando(p.emitido_em, st),
  };
}

async function atualizar(saleId: string, patch: Record<string, unknown>) {
  // BLOCO 212: o erro do update NUNCA mais é engolido em silêncio — se a
  // gravação do código do Inter falhar, o boleto fica órfão no banco (sem PDF,
  // sem cancelar, webhook não casa). Log explícito para diagnosticar.
  const { error } = await getServiceClient().from('sales').update(patch).eq('id', saleId);
  if (error) console.error('[api/boletos] update sales falhou:', error.message, JSON.stringify(Object.keys(patch)));
}

/**
 * BLOCO 210 (botao CANCELAR BOLETO por cliente): o prazo EXIBIDO da venda
 * (fila de entregas / roteiro / cobranças) deve ser sempre o MENOR vencimento
 * EM ABERTO das parcelas — canceladas/expiradas/falhadas não contam. Chamado
 * depois de CANCELAR uma parcela e depois de EMITIR/REEMITIR uma parcela,
 * para que "cancelei o boleto 1 e gerei outro com nova data" atualize a fila.
 */
async function recomputeVencimentoVenda(saleId: string) {
  try {
    const { data: ps } = await getServiceClient()
      .from('sales_boletos')
      .select('vencimento, status')
      .eq('sale_id', saleId);
    const ativas = ((ps as Record<string, unknown>[]) || [])
      .filter(p => !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(String(p.status)))
      .map(p => String(p.vencimento || ''))
      .filter(Boolean)
      .sort();
    if (ativas.length === 0) return;
    await atualizar(saleId, { data_vencimento: `${ativas[0]}T23:59:59-03:00` });
  } catch { /* melhor esforco: fila segue com o prazo anterior */ }
}

/**
 * BLOCO 200 (regra do dono): a venda é da ROTA 5 (Deivid/David)? O casamento
 * é À PROVA DE RENOME/TROCA DE APARELHO: pela ROTA gravada (ROTA_05) OU pelo
 * id/nome do vendedor (lib/equipe — mesmo padrão do caixa/comissão). O Cupom
 * casa pelo id da venda no client; aqui o SERVIDOR é a fonte da verdade —
 * tanto para MOSTRAR a divisão no card (GET) quanto para ACEITAR gravá-la
 * (POST CRIAR_PARCELAS).
 */
async function vendaPodeDividir(vendedorId: string): Promise<boolean> {
  const { data: v } = await getServiceClient()
    .from('app_users')
    .select('id, nome, rota')
    .eq('id', vendedorId)
    .maybeSingle();
  if (!v) return false;
  const vu = v as Record<string, unknown>;
  if (String(vu.rota || '').toUpperCase() === 'ROTA_05') return true;
  return isDavidVendedor({ id: String(vu.id || ''), nome: String(vu.nome || '') });
}

/**
 * Busca a chave da NF-e/NFC-e: coluna nota_chave ou consulta Focus uma vez.
 * FIX "erro para atrelar NFe OU NFC ao boleto": a consulta na Focus usava
 * SEMPRE o endpoint /v2/nfe/{ref} — para venda com NFC-e a nota nunca era
 * encontrada (NFC-e vive em /v2/nfce) e o boleto saía sem notaFiscal.
 * Agora o doc segue nota_tipo (NFCE -> 'nfce').
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

/** Bloco 199: carrega uma parcela da venda (null se não existe). */
async function carregarParcela(saleId: string, parcelaId: string) {
  const { data } = await getServiceClient()
    .from('sales_boletos')
    .select(PARC_COLS)
    .eq('id', parcelaId)
    .eq('sale_id', saleId)
    .maybeSingle();
  return (data as Record<string, unknown>) || null;
}

/**
 * BLOCO 199: fluxo de EMISSAO de uma cobranca — usado pelo boleto ÚNICO
 * (grava nas colunas inter_* da venda) e pela PARCELA (grava na linha da
 * sales_boletos). Um só caminho = mesmas validações, mesmos fallbacks,
 * mesma mensagem e mesmas garantias.
 */
async function emitirCobrancaUnificada(args: {
  sale: Record<string, unknown>;
  saleId: string;
  docManual: string;
  cepManual: string;
  atrelarNFe: boolean;
  mensagemAvulsa: string;
  // destino parcela (null = boleto único na venda)
  parcela?: Record<string, unknown> | null;
  // valores no caso de boleto único
  valorUnico?: number;
  vencUnico?: string;
}): Promise<NextResponse> {
  const db = getServiceClient();
  const { sale, saleId, parcela } = args;
  const docManual = String(args.docManual || '');
  const cepManual = String(args.cepManual || '');

  if (!isInterConfigured()) {
    return BAD(503, 'Inter nao configurado. Defina INTER_CLIENT_ID, INTER_CLIENT_SECRET e o certificado no Vercel (docs/BOLETOS-INTER.md).');
  }

  // Cliente + pagador
  // BLOCO 189: o CPF do cadastro entra no montarPagador — mas a coluna só
  // existe depois do SQL. Sem o SQL: refaz o select sem cpf (degrada ok).
  let { data: client, error: eClient } = await db
    .from('clients')
    .select('nome_fantasia, nome, cnpj, cpf, telefone, endereco, bairro, razao_social, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email')
    .eq('id', sale.client_id as string)
    .single();
  if (eClient && /column|cpf/i.test(eClient.message || '')) {
    ({ data: client } = await db
      .from('clients')
      .select('nome_fantasia, nome, cnpj, telefone, endereco, bairro, razao_social, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email')
      .eq('id', sale.client_id as string)
      .single());
  }
  if (!client) return BAD(422, 'Cliente da venda nao encontrado.');

  // -----------------------------------------------------------------
  // BLOCO 187: o CPF/CNPJ capturado NA VENDA (sales.boleto_cpf) entra como
  // fallback quando a tela do boleto não digitou nada. BLOCO 199: a PARCELA
  // também tem doc/cep próprios (capturados na tela 6) — entram antes do
  // boleto_cpf da venda. Prioridade: docManual > parcela.doc > boleto_cpf
  // da venda > cadastro do cliente (dentro do montarPagador).
  // -----------------------------------------------------------------
  let docDaVenda = '';
  const docManualDig = docManual.replace(/\D/g, '');
  if (!docManualDig && (await hasBoletoCpfColumn())) {
    const { data: saleCpf } = await db.from('sales').select('boleto_cpf').eq('id', saleId).maybeSingle();
    docDaVenda = String((saleCpf as Record<string, unknown> | null)?.boleto_cpf || '').replace(/\D/g, '');
  }
  const docDaParcela = parcela ? String((parcela.doc as string) || '').replace(/\D/g, '') : '';
  const cepDaParcela = parcela ? String((parcela.cep as string) || '').replace(/\D/g, '') : '';
  const pagador = montarPagador(client as Record<string, unknown>, docManualDig || docDaParcela || docDaVenda, cepManual.replace(/\D/g, '') || cepDaParcela);
  if (!pagador) {
    return BAD(422, 'Boleto precisa de CPF ou CNPJ do pagador. Complete o cadastro do cliente (Admin > Clientes) ou informe o documento na tela do boleto.');
  }

  // CEP: OBRIGATORIO na API do Inter (spec PagadorBase: cpfCnpj, nome,
  // tipoPessoa, cep, endereco, cidade, uf — cep com 8 digitos exatos).
  const cepDig = String((pagador.cep as string) || '').replace(/\D/g, '');
  if (cepDig.length !== 8) {
    return BAD(422, 'O boleto do Inter precisa do CEP do pagador (8 digitos). Complete o CEP no cadastro do cliente (Admin > Clientes > endereço) ou informe o CEP na tela do boleto.');
  }

  // Documento com dígito verificador invalido tambem cai na mensagem
  // generica do Inter — validamos aqui para o erro ser claro.
  if (!validaCpfCnpj(pagador.cpfCnpj as string)) {
    return BAD(422, `O documento ${mascaraCpfCnpj(pagador.cpfCnpj as string)} está com os números inválidos — confira o CPF (11 digitos) ou CNPJ (14 digitos) do pagador.`);
  }

  // Valor (parcela tem o SEU valor) e vencimento
  const valor = parcela ? Number(parcela.valor) || 0 : Number(args.valorUnico ?? 0);
  if (!Number.isFinite(valor) || valor < 2.5) {
    return BAD(422, 'Valor invalido: o boleto do Inter precisa ser de no minimo R$ 2,50.');
  }
  if (valor > 99999999) return BAD(422, 'Valor acima do limite da API do Inter.');
  let venc = parcela ? String(parcela.vencimento || '').slice(0, 10) : String(args.vencUnico || '');
  if (!validaVencimento(venc)) return BAD(422, 'Data de vencimento invalida (formato AAAA-MM-DD).');

  // ------------------------------------------------------------------
  // BLOCO 227 — AUTO-CORRECAO DO VENCIMENTO VENCIDO (o conflito real que
  // travava "nenhum boleto novo"): quando a venda tem prazo combinado ja
  // PASSADO (pre-venda antiga, venda reaberta depois do vencimento), o
  // card preenchia a data vencida e o Inter RECUSAVA o POST com a
  // mensagem generica "Verifique se os dados informados estao de acordo
  // com a documentacao disponibilizada e tente novamente." (caso real
  // gravado na venda Missioneiro 24668267: venc. 08/10 emitido em 27/11 —
  // 50 dias no passado; e o boleto do paradouro da nota cancelada nem
  // chegou a nascer pelo mesmo motivo). Em vez de recusar e deixar o
  // dono sem resposta, o servidor AGORA corrige sozinho: vencimento no
  // passado sai como HOJE (valido no Inter) + aviso claro na resposta —
  // o boleto SEMPRE sai e o dono sabe exatamente o que aconteceu.
  // ------------------------------------------------------------------
  let avisoVencimento = '';
  const hojeIso227 = hojeSp();
  if (venc < hojeIso227) {
    avisoVencimento = `O prazo combinado (${venc.slice(8, 10)}/${venc.slice(5, 7)}/${venc.slice(0, 4)}) ja tinha passado — o boleto saiu vencendo HOJE (${hojeIso227.slice(8, 10)}/${hojeIso227.slice(5, 7)}/${hojeIso227.slice(0, 4)}). Ajuste o vencimento no card se precisar de outra data.`;
    venc = hojeIso227;
  }

  // Nota fiscal atrelada (opcional): chave de 44 digitos.
  // BLOCO 177: só NF-e (modelo 55) atrela — NFC-e nunca. Nas PARCELAS a
  // mesma NF-e entra com parcela = seq (boleto 1 -> parcela 1 da nota).
  let notaFiscal: Record<string, unknown> | undefined;
  let avisoAtrelamento = '';
  const tipoNota = String(sale.nota_tipo || '').toUpperCase();
  const podeAtrelar = sale.nota_status === 'AUTORIZADA' && tipoNota === 'NFE';
  const atrelar = args.atrelarNFe !== false && podeAtrelar;
  if (podeAtrelar) {
    const chave = await chaveDaNota(sale);
    if (chave) {
      if (atrelar) {
        notaFiscal = {
          chaveNFe: chave,
          numero: Number(sale.nota_numero) || undefined,
          dataEmissao: hojeSp(),
          parcela: parcela ? Number(parcela.seq) || 1 : 1,
          naturezaOperacao: 'Venda de mercadoria',
        };
      } else {
        avisoAtrelamento = 'A venda tem NF-e autorizada — ative "Atrelar NF-e" para vinculá-la ao boleto.';
      }
    } else {
      avisoAtrelamento = 'NF-e autorizada, mas a chave de acesso ainda não chegou (SEFAZ/Focus). O boleto sai sem nota atrelada — consulte o boleto depois para conferir.';
    }
  }

  // seuNumero único: parcela usa o formato -P<seq> (e -P<seq>rN na reemissão)
  const totalParcelas = parcela
    ? Math.max(2, Number((await db.from('sales_boletos').select('id').eq('sale_id', saleId)).data?.length) || 2)
    : 1;
  const anteriorSeu = parcela ? String(parcela.seu_numero || '') : String(sale.inter_boleto_seu_numero || '');
  const seuNumero = parcela
    ? seuNumeroParcela(saleId, Number(parcela!.seq) || 1, anteriorSeu || undefined)
    : seuNumeroBoleto(saleId, anteriorSeu || undefined);
  const vendaCurta = String(saleId).slice(0, 8).toUpperCase();

  // ------------------------------------------------------------------
  // BLOCO 152 — TEXTO PADRÃO DO BOLETO (linhas 1..5 do campo mensagem,
  // até 78 chars cada, saem no PDF do Inter).
  // linha1 = venda (sempre) + rotulo da parcela quando for o caso
  // linha2 = texto padrao do dono (hub ERP Fiscal) | linha3 = mensagem
  // avulsa | linha4 = nota nao atrelada (quando couber).
  // ------------------------------------------------------------------
  const erpCfg = await lerErpConfig();
  const msgPadrao = (erpCfg.boletoMensagemPadrao || process.env.INTER_MENSAGEM_PADRAO || '').trim().slice(0, 78);
  const rotuloParcela = parcela ? ` - Boleto ${Number(parcela.seq) || 1}/${totalParcelas}` : '';

  const payload = {
    seuNumero,
    valorNominal: Math.round(valor * 100) / 100,
    dataVencimento: venc,
    numDiasAgenda: 30,
    pagador,
    mensagem: {
      linha1: `Venda ${vendaCurta} - Doce Mania${rotuloParcela}`.slice(0, 78),
      ...(msgPadrao ? { linha2: msgPadrao } : {}),
      ...(args.mensagemAvulsa ? { linha3: args.mensagemAvulsa.slice(0, 78) } : {}),
      ...(notaFiscal ? {} : podeAtrelar ? { linha4: `NF-e ${String(sale.nota_numero)} (nao atrelada)` } : {}),
    },
    formasRecebimento: ['BOLETO', 'PIX'],
    notaFiscal,
  };

  // Marca processando antes de chamar o Inter (rastreabilidade se cair a conexao)
  if (parcela) {
    // BLOCO 212 (race de emissão): dois cliques/telas podem chegar aqui juntos
    // e gravar EM_PROCESSAMENTO DUAS VEZES antes de qualquer código existir —
    // o CAS por status NAO_GERADO/FALHA/CANCELADO garante que só UM request
    // conquista a emissão (o outro perde e sai com 409).
    const { data: ganhou } = await db.from('sales_boletos').update({
      status: 'EM_PROCESSAMENTO',
      seu_numero: seuNumero,
      erro: null,
    })
      .eq('id', String(parcela.id))
      .in('status', ['NAO_GERADO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'])
      .select('id');
    if (!ganhou || ganhou.length === 0) {
      return NextResponse.json({ ok: false, erro: 'Boleto ' + (Number(parcela.seq) || 1) + ' já está sendo gerado agora (aguarde alguns segundos).' }, { status: 409 });
    }
  } else {
    await atualizar(saleId, {
      inter_boleto_status: 'EM_PROCESSAMENTO',
      inter_boleto_seu_numero: seuNumero,
      inter_boleto_valor: payload.valorNominal,
      inter_boleto_vencimento: venc,
      inter_boleto_erro: null,
    });
  }

  // BLOCO 225: emissão com RETRY automático — instabilidade do Inter
  // ("Tente novamente mais tarde...", 5xx, timeout) tenta até 3x sozinho.
  let r = await emitirCobrancaComRetry(payload as never);
  // -----------------------------------------------------------------
  // BLOCO 150: o POST da cobranca v3 pode recusar o objeto notaFiscal e aí
  // o boleto morria INTEIRO. Retenta SEM o vínculo formal e leva a NF para
  // a MENSAGEM (aparece no PDF). O boleto NUNCA falha por causa da nota.
  // -----------------------------------------------------------------
  let fallbackSemNota = false;
  if (!r.ok && notaFiscal) {
    const semNota = {
      ...payload,
      notaFiscal: undefined,
      mensagem: {
        ...payload.mensagem,
        linha5: `${tipoNota === 'NFE' ? 'NF-e' : 'NFC-e'} ${String(sale.nota_numero || '')} atrelada a esta cobranca`,
      },
    };
    r = await emitirCobrancaComRetry(semNota as never);
    fallbackSemNota = r.ok;
  }
  if (!r.ok || !r.data || !(r.data as Record<string, unknown>).codigoSolicitacao) {
    const erro = r.erro || `HTTP ${r.status}`;
    // BLOCO 225: falhou MESMO com o retry — quando é instabilidade do Inter,
    // a mensagem orienta o dono a esperar e tocar GERAR de novo (a falha
    // transiente costuma passar em minutos: caso Paradouro 07:48 recusou,
    // 08:28 o mesmo Inter aceitou).
    const dicaInstabilidade = ehErroTransienteInter(r.status, r.erro)
      ? ' O Inter está instável agora (já tentamos 3x). Aguarde 2 minutos e toque GERAR de novo.'
      : '';
    if (parcela) {
      await db.from('sales_boletos').update({ status: 'FALHA_EMISSAO', erro }).eq('id', String(parcela.id))
        .then(({ error }) => { if (error) console.error('[api/boletos] rollback FALHA_EMISSAO parcela:', error.message); });
      return BAD(502, `Inter recusou o boleto ${Number(parcela.seq) || 1}: ${erro}${dicaInstabilidade}`, { parcela: parcelaPublica({ ...parcela, status: 'FALHA_EMISSAO', erro }) });
    }
    await atualizar(saleId, { inter_boleto_status: 'FALHA_EMISSAO', inter_boleto_erro: erro });
    return BAD(502, `Inter recusou o boleto: ${erro}${dicaInstabilidade}`, { boleto: { status: 'FALHA_EMISSAO', erro } });
  }

  const codigo = String((r.data as Record<string, unknown>).codigoSolicitacao);
  if (parcela) {
    const { error: codErr } = await db.from('sales_boletos').update({ codigo, emitido_em: new Date().toISOString() }).eq('id', String(parcela.id));
    // BLOCO 212: se a gravação do código falhar o boleto fica órfão — log.
    if (codErr) console.error('[api/boletos] gravação do codigo da parcela falhou:', codErr.message);
    // BLOCO 210: prazo da venda acompanha o vencimento mais novo em aberto
    // (a parcela reemitida pode ter OUTRA data que o cliente escolheu).
    await recomputeVencimentoVenda(saleId);
  } else {
    await atualizar(saleId, { inter_boleto_codigo: codigo, inter_boleto_em: new Date().toISOString() });
  }

  // A emissao e assincrona: consulta em seguida pra pegar linha digitavel se ja processou
  const boleto: CobrancaPublica = { status: 'EM_PROCESSAMENTO', codigo, seuNumero, vencimento: venc, valor: payload.valorNominal, linhaDigitavel: '', codigoBarras: '', pixCopiaECola: '', valorRecebido: null, erro: '', notaFiscalChave: '' };
  const c = await recuperarCobranca(codigo);
  if (c.ok && c.data) {
    const cob = interpretarCobranca(c.data as Record<string, unknown>);
    if (parcela) {
      await db.from('sales_boletos').update({
        status: cob.status === 'A_RECEBER' ? 'A_RECEBER' : cob.status,
        linha: cob.linhaDigitavel || null,
        barras: cob.codigoBarras || null,
        pix: cob.pixCopiaECola || null,
      }).eq('id', String(parcela.id));
      return NextResponse.json({
        ok: true,
        parcela: { ...parcelaPublica({ ...parcela, status: cob.status, codigo, seu_numero: seuNumero }), linhaDigitavel: cob.linhaDigitavel || '', codigoBarras: cob.codigoBarras || '', pixCopiaECola: cob.pixCopiaECola || '', status: cob.status },
        ...(notaFiscal && !fallbackSemNota ? { notaAtrelada: true } : {}),
        // BLOCO 227: vencimento vencido foi corrigido para hoje — o dono precisa saber.
        ...(avisoVencimento ? { avisoVencimento } : {}),
        ...(fallbackSemNota ? { avisoAtrelamento: `Boleto GERADO com o valor da parcela. O Inter não aceitou o vínculo formal da nota agora — ela ficou escrita na mensagem do boleto.` } : avisoAtrelamento ? { avisoAtrelamento } : {}),
      });
    }
    await atualizar(saleId, {
      inter_boleto_status: cob.status,
      inter_boleto_linha: cob.linhaDigitavel || null,
      inter_boleto_barras: cob.codigoBarras || null,
      inter_boleto_pix: cob.pixCopiaECola || null,
    });
  }

  return NextResponse.json({
    ok: true,
    boleto,
    // BLOCO 199: na emissão de PARCELA devolvemos a parcela (mesmo quando a
    // consulta pós-emissão falhou — o frontend recarrega e vê EM_PROCESSAMENTO)
    ...(parcela
      ? {
          parcela: parcelaPublica({
            ...parcela,
            status: c.ok && c.data ? (interpretarCobranca(c.data as Record<string, unknown>).status) : 'EM_PROCESSAMENTO',
            codigo,
            seu_numero: seuNumero,
          }),
        }
      : {}),
    ...(notaFiscal && !fallbackSemNota ? { notaAtrelada: true } : {}),
    // BLOCO 227: vencimento vencido foi corrigido para hoje — o dono precisa saber.
    ...(avisoVencimento ? { avisoVencimento } : {}),
    ...(fallbackSemNota
      ? { avisoAtrelamento: `Boleto GERADO com o valor da venda. O Inter não aceitou o vínculo formal da nota agora — a ${tipoNota === 'NFE' ? 'NF-e' : 'NFC-e'} ${String(sale.nota_numero || '')} ficou escrita na mensagem do boleto (aparece no PDF e no comprovante).` }
      : avisoAtrelamento ? { avisoAtrelamento } : {}),
  });
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
  // BLOCO 195 (regra do dono): o SECRETÁRIO separa o pedido e agora também
  // GERA O BOLETO e acompanha a nota pela aba dele — pode ver o boleto de
  // QUALQUER venda da fila (cancelar segue só admin).
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode ver o boleto das suas proprias vendas.');
  }
  // BLOCO 199: parcelas do boleto duplo (rota 5) — vazio = venda sem parcelas
  // (o card segue o fluxo de boleto único de sempre).
  let parcelas: Record<string, unknown>[] | undefined;
  if (await hasSalesBoletosTable()) {
    const { data: pl } = await db
      .from('sales_boletos')
      .select(PARC_COLS)
      .eq('sale_id', saleId)
      .order('seq', { ascending: true });
    if (pl && pl.length > 0) parcelas = (pl as Record<string, unknown>[]).map(parcelaPublica);
  }
  // BLOCO 85: status das credenciais Inter visivel no app — o card AVISA quando falta env.
  const erpCfgGet = await lerErpConfig();
  // BLOCO 200 (regra do dono): o SERVIDOR decide se a venda pode DIVIDIR em
  // 2 boletos (rota 5) — o card usa junto com a prop do client (reforço).
  let podeDividirServidor = false;
  try { podeDividirServidor = await vendaPodeDividir(String(sale.vendedor_id || '')); } catch { /* degrada: prop do client decide */ }
  // BLOCO 210 (botão CANCELAR BOLETO junto ao boleto de cada cliente): o
  // servidor DIZ ao card se o botão pode aparecer (cancelamento segue só
  // ADMIN — mesma regra da ação abaixo). Vendedor não vê o botão.
  const podeCancelar = session.perfil === 'ADMIN';
  return NextResponse.json({
    ok: true,
    boleto: cobrancaPublica(sale as Record<string, unknown>),
    ...(parcelas ? { parcelas } : {}),
    podeDividir: podeDividirServidor,
    podeCancelar,
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
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode gerar boleto para suas proprias vendas.');
  }

  // ===================================================================
  // BLOCO 199 — CRIAR_PARCELAS (boleto duplo da rota 5)
  // Grava as 2 parcelas que JUNTAS fecham o saldo da venda. Cada uma é
  // uma cobrança própria no Inter (emissão individual por parcelaId ou
  // EMITIR_TODAS). Recriar só é permitido enquanto NENHUMA parcela tem
  // cobrança no Inter (nada emitido) e não existe boleto único ativo.
  // ===================================================================
  if (acao === 'CRIAR_PARCELAS') {
    if (!(await hasSalesBoletosTable())) {
      return BAD(503, 'Tabela de parcelas nao existe ainda no Supabase. Rode o SQL do Bloco 199 (sql/bloco199_boleto_duplo.sql).');
    }
    // BLOCO 200 (regra do dono): divisão em 2 boletos é EXCLUSIVA da rota 5
    // (Deivid/David) — o servidor recusa qualquer outra rota (fonte da
    // verdade, à prova de troca de aparelho/renome).
    if (!(await vendaPodeDividir(String(sale.vendedor_id || '')))) {
      return BAD(403, 'A divisão em 2 boletos é exclusiva da rota 5 (Deivid).');
    }
    // Boleto único já ativo? Dividir aqui cobraria o cliente DUAS vezes.
    if (sale.inter_boleto_codigo && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(String(sale.inter_boleto_status))) {
      return BAD(422, 'Esta venda já tem um boleto único gerado. Cancele-o (Admin) antes de dividir em dois boletos.');
    }
    const lista = Array.isArray(body.boletos) ? body.boletos : [];
    if (lista.length < 2) return BAD(422, 'Informe os 2 boletos (valor + vencimento de cada um).');
    if (lista.length > 4) return BAD(422, 'No máximo 4 boletos por venda.');

    // Saldo em aberto fecha EXATAMENTE com a soma das parcelas
    const total = Number(sale.valor_total) || 0;
    const pago = Number(sale.valor_pago) || 0;
    const saldo = Math.max(0, Math.round((total - pago) * 100) / 100);
    let soma = 0;
    const linhas: Record<string, unknown>[] = [];
    for (let i = 0; i < lista.length; i++) {
      const item = lista[i] as Record<string, unknown>;
      const valor = Math.round((Number(item.valor) || 0) * 100) / 100;
      const venc = String(item.vencimento || '').trim();
      if (!Number.isFinite(valor) || valor < 2.5) {
        return BAD(422, `Boleto ${i + 1}: o valor precisa ser de no mínimo R$ 2,50 (regra do Inter).`);
      }
      if (!validaVencimento(venc)) {
        return BAD(422, `Boleto ${i + 1}: data de vencimento invalida (formato AAAA-MM-DD).`);
      }
      soma = Math.round((soma + valor) * 100) / 100;
      linhas.push({
        sale_id: saleId,
        seq: i + 1,
        valor,
        vencimento: venc,
        doc: String(item.doc || '').replace(/\D/g, '').slice(0, 20) || null,
        cep: String(item.cep || '').replace(/\D/g, '').slice(0, 8) || null,
        status: 'NAO_GERADO',
      });
    }
    if (Math.abs(soma - saldo) > 0.02) {
      return BAD(422, `Os dois boletos devem fechar o saldo da venda: soma R$ ${soma.toFixed(2)} vs saldo R$ ${saldo.toFixed(2)}. Ajuste os valores.`);
    }
    // BLOCO 210 (fluxo do dono: cancelou o boleto para trocar a data):
    // regravar a divisão fica PERMITIDO quando TODAS as parcelas com cobrança
    // estão CANCELADAS/EXPIRADAS/FALHADAS (nada ATIVO no Inter) e NENHUMA foi
    // paga. Parcela ATIVA ou PAGA continua travando (dinheiro em jogo).
    const { data: existentes } = await db.from('sales_boletos').select('id, seq, status, codigo').eq('sale_id', saleId);
    const temPaga = (existentes || []).some((p: Record<string, unknown>) => ['RECEBIDO', 'MARCADO_RECEBIDO'].includes(String(p.status)));
    if (temPaga) return BAD(422, 'Há boleto da divisão já PAGO — a divisão não pode ser regravada.');
    const temAtiva = (existentes || []).some((p: Record<string, unknown>) => p.codigo && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(String(p.status)));
    if (temAtiva) return BAD(422, 'Esta venda tem boleto da divisão ATIVO no Inter — use o botão CANCELAR BOLETO antes de regravar a divisão.');
    await db.from('sales_boletos').delete().eq('sale_id', saleId);
    const { error: insErr } = await db.from('sales_boletos').insert(linhas);
    if (insErr) {
      console.error('[api/boletos] CRIAR_PARCELAS falhou (1a tentativa):', insErr.message);
      // BLOCO 212 (delete+insert sem transação): as parcelas antigas já foram
      // apagadas — tentar de novo ANTES de devolver erro; se falhar de novo,
      // devolver mensagem que deixa claro que a divisão foi apagada e pode
      // ser regravada (estado recuperável, não corrompido).
      const { error: insErr2 } = await db.from('sales_boletos').insert(linhas);
      if (insErr2) {
        console.error('[api/boletos] CRIAR_PARCELAS falhou (2a tentativa):', insErr2.message);
        return BAD(500, 'Falha ao gravar os dois boletos (a divisão anterior foi apagada — regrave a divisão no card do boleto).');
      }
    }
    // data_vencimento da venda = vencimento mais próximo (fila/cupom enxergam o prazo certo)
    const vencimentos = linhas.map(l => String(l.vencimento)).sort();
    await atualizar(saleId, { data_vencimento: `${vencimentos[0]}T23:59:59-03:00` });
    const { data: criadas } = await db.from('sales_boletos').select(PARC_COLS).eq('sale_id', saleId).order('seq', { ascending: true });
    return NextResponse.json({ ok: true, parcelas: (criadas || []).map(p => parcelaPublica(p as Record<string, unknown>)) });
  }

  // ---------- CONSULTAR (venda ou parcela) ----------
  if (acao === 'CONSULTAR') {
    if (!isInterConfigured()) return BAD(503, 'Inter nao configurado (env INTER_CLIENT_ID / INTER_CLIENT_SECRET / certificado no Vercel).');
    if (body.parcelaId) {
      if (!(await hasSalesBoletosTable())) return BAD(503, 'Rode o SQL do Bloco 199 (sales_boletos).');
      const parcela = await carregarParcela(saleId, String(body.parcelaId));
      if (!parcela) return BAD(404, 'Parcela nao encontrada.');
      if (!parcela.codigo) return BAD(422, `Boleto ${Number(parcela.seq)} ainda não foi gerado.`);
      const r = await recuperarCobranca(String(parcela.codigo));
      // BLOCO 222: 404 = o Inter NAO conhece a cobranca (emissao morreu lá
      // apos o POST). Antes devolvia 502 PARA SEMPRE e o card ficava
      // "Gerando..."; agora marca FALHA_EMISSAO e devolve o estado — o card
      // mostra o erro e volta a oferecer o botao GERAR/REEMITIR.
      if (!r.ok && r.status === 404) {
        const msgErro = 'Cobranca nao encontrada no Inter (404) — gere o boleto novamente.';
        await db.from('sales_boletos').update({ status: 'FALHA_EMISSAO', erro: msgErro }).eq('id', String(parcela.id));
        const { data: falhou } = await db.from('sales_boletos').select(PARC_COLS).eq('id', String(parcela.id)).maybeSingle();
        return NextResponse.json({ ok: true, parcela: parcelaPublica(falhou as Record<string, unknown>) });
      }
      if (!r.ok) return BAD(502, r.erro || 'Falha ao consultar a API do Inter.');
      const cob = interpretarCobranca(r.data as Record<string, unknown>);
      const hoje = hojeSp();
      await espelharParcelaInter(db, parcela as unknown as ParcelaRow, cob, hoje);
      // Pago? Baixa a parcela (e fecha a venda quando as duas pagarem)
      const pago = cob.status === 'RECEBIDO' || cob.status === 'MARCADO_RECEBIDO' || (cob.valorRecebido !== null && cob.valorRecebido > 0);
      if (pago) await baixarParcelaPaga(db, parcela as unknown as ParcelaRow, 'CONSULTA_MANUAL');
      const { data: atual } = await db.from('sales_boletos').select(PARC_COLS).eq('id', String(parcela.id)).maybeSingle();
      return NextResponse.json({ ok: true, parcela: parcelaPublica(atual as Record<string, unknown>) });
    }
    if (!sale.inter_boleto_codigo) return BAD(422, 'Esta venda ainda nao tem boleto gerado.');
    const r = await recuperarCobranca(String(sale.inter_boleto_codigo));
    // BLOCO 222: mesmo destrave do 404 na parcela — boleto unico que o Inter
    // nao conhece sai do EM_PROCESSAMENTO eterno e volta a ser reemitivel.
    if (!r.ok && r.status === 404) {
      const msgErro = 'Cobranca nao encontrada no Inter (404) — emita o boleto novamente.';
      await atualizar(saleId, { inter_boleto_status: 'FALHA_EMISSAO', inter_boleto_erro: msgErro });
      return NextResponse.json({ ok: true, boleto: { ...cobrancaPublica(sale as Record<string, unknown>), status: 'FALHA_EMISSAO', erro: msgErro } });
    }
    if (!r.ok) return BAD(502, r.erro || 'Falha ao consultar a API do Inter.', { boleto: cobrancaPublica(sale as Record<string, unknown>) });
    const cob = interpretarCobranca(r.data as Record<string, unknown>);
    await atualizar(saleId, {
      inter_boleto_status: cob.status,
      inter_boleto_linha: cob.linhaDigitavel || sale.inter_boleto_linha || null,
      inter_boleto_barras: cob.codigoBarras || sale.inter_boleto_barras || null,
      inter_boleto_pix: cob.pixCopiaECola || sale.inter_boleto_pix || null,
      inter_boleto_erro: cob.status === 'FALHA_EMISSAO' ? 'Falha na emissao no Inter' : null,
    });
    // BLOCO 225: quando a cobrança segue EM_PROCESSAMENTO, a resposta leva
    // HÁ QUANTO tempo (inter_boleto_em) + aviso do DESTRAVAR após 30 min —
    // o dono finalmente vê se é processamento normal ou emissão travada.
    return NextResponse.json({
      ok: true,
      boleto: { ...cob, ...tempoProcessando(sale.inter_boleto_em, cob.status) },
    });
  }

  // ---------- PDF (venda ou parcela) ----------
  if (acao === 'PDF') {
    if (!isInterConfigured()) return BAD(503, 'Inter nao configurado (env INTER_CLIENT_ID / INTER_CLIENT_SECRET / certificado no Vercel).');
    if (body.parcelaId) {
      if (!(await hasSalesBoletosTable())) return BAD(503, 'Rode o SQL do Bloco 199 (sales_boletos).');
      const parcela = await carregarParcela(saleId, String(body.parcelaId));
      if (!parcela || !parcela.codigo) return BAD(422, 'Esta parcela ainda nao tem boleto gerado.');
      const r = await recuperarPdf(String(parcela.codigo));
      if (!r.ok || !r.pdf) return BAD(502, r.erro || 'Falha ao buscar o PDF no Inter.');
      return NextResponse.json({ ok: true, pdfBase64: r.pdf.toString('base64') });
    }
    if (!sale.inter_boleto_codigo) return BAD(422, 'Esta venda ainda nao tem boleto gerado.');
    const r = await recuperarPdf(String(sale.inter_boleto_codigo));
    if (!r.ok || !r.pdf) return BAD(502, r.erro || 'Falha ao buscar o PDF no Inter.');
    return NextResponse.json({ ok: true, pdfBase64: r.pdf.toString('base64') });
  }

  // ------------------------------------------------------------------
  // BLOCO 224 — DESTRAVAR (ADMIN): boleto preso em EM_PROCESSAMENTO
  // dentro do Inter (caso Paradouro do Campo / Zotti Tijuca). O Inter
  // RECUSA o cancelamento de cobrança em processamento ("A cobrança
  // não pode ser cancelada, pois se encontra na situação
  // EM_PROCESSAMENTO") e a reconsulta não sai do lugar; o GERAR
  // devolvia "já gerado" para sempre. O destravamento é LOCAL: marca
  // FALHA_EMISSAO, registra o código antigo no campo erro e LIMPA o
  // inter_boleto_codigo (senão o sync/webhook reescreveriam o
  // EM_PROCESSAMENTO por cima). A cobrança antiga segue no Inter sem
  // linha digitável — ninguém consegue pagá-la; na sequência o card
  // oferece GERAR para um boleto NOVO (novo seuNumero).
  // ------------------------------------------------------------------
  if (acao === 'DESTRAVAR') {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin pode destravar boletos.');
    const carimbo = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    if (body.parcelaId) {
      if (!(await hasSalesBoletosTable())) return BAD(503, 'Rode o SQL do Bloco 199 (sales_boletos).');
      const parcela = await carregarParcela(saleId, String(body.parcelaId));
      if (!parcela) return BAD(404, 'Parcela não encontrada.');
      if (String(parcela.status) !== 'EM_PROCESSAMENTO') {
        return BAD(422, `Só boleto em EM_PROCESSAMENTO pode ser destravado (esta parcela está ${String(parcela.status || 'NAO_GERADO')}).`);
      }
      const codAntigo = String(parcela.codigo || '');
      // =================================================================
      // BLOCO 226 — o DESTRAVAR agora tenta CANCELAR a cobrança no Inter
      // ANTES de liberar local: se ela saiu de EM_PROCESSAMENTO (virou
      // A_RECEBER), o cancelamento CONSEGUE e o risco de o cliente pagar a
      // cobrança antiga acaba NA HORA. Se o Inter ainda recusa (estado
      // EM_PROCESSAMENTO), a cobrança fica registrada como ÓRFÃ e o sync
      // passa a vigiá-la: cancela sozinho quando ela processar e avisa
      // URGENTE se alguém pagou.
      // =================================================================
      let destinoOrfao = 'recusado';
      if (codAntigo && isInterConfigured()) {
        try {
          const c = await cancelarCobranca(codAntigo, 'Cobranca presa - liberada pelo sistema');
          if (c.ok || c.status === 202) destinoOrfao = 'cancelado';
          else if (c.status === 404) destinoOrfao = 'inexistente';
        } catch { /* degrada: órfã fica sob vigilância do sync */ }
      }
      if (codAntigo && destinoOrfao === 'recusado') {
        try {
          await db.from('webhook_logs').insert({
            origem: 'ORFAO_INTER',
            evento: { fonte: 'destravar-parcela' },
            codigo: codAntigo.slice(0, 120),
            seu_numero: String(parcela.seu_numero || '').slice(0, 60) || null,
            sale_id: saleId.slice(0, 64),
            resultado: `parcela ${Number(parcela.seq) || 1} destravada pelo admin — cobrança segue VIVA no Inter (cancelamento recusado); sync vigia e cancela sozinho quando sair do EM_PROCESSAMENTO`,
            processado: false,
          });
        } catch { /* tabela ausente (SQL 167 pendente) não trava o destravamento */ }
      }
      await db.from('sales_boletos').update({
        status: 'FALHA_EMISSAO',
        codigo: null,
        erro: `Destravado pelo admin em ${carimbo}: cobrança ${codAntigo.slice(0, 36)} estava presa em EM_PROCESSAMENTO no Inter${destinoOrfao === 'cancelado' ? ' e foi CANCELADA lá agora' : destinoOrfao === 'inexistente' ? ' e nem existe mais lá' : ' (cancelamento recusado lá — o sync vigia e cancela sozinho quando sair do processamento)'}. Gere um novo boleto.`,
      }).eq('id', String(parcela.id));
      await recomputeVencimentoVenda(saleId);
      const { data: atual } = await db.from('sales_boletos').select(PARC_COLS).eq('id', String(parcela.id)).maybeSingle();
      return NextResponse.json({ ok: true, parcela: parcelaPublica(atual as Record<string, unknown>) });
    }
    if (String(sale.inter_boleto_status) !== 'EM_PROCESSAMENTO') {
      return BAD(422, `Só boleto em EM_PROCESSAMENTO pode ser destravado (esta venda está ${String(sale.inter_boleto_status || 'NAO_GERADO')}).`);
    }
    const codUnico = String(sale.inter_boleto_codigo || '');
    // BLOCO 226: mesmo tratamento do DESTRAVAR de parcela (acima) — tenta
    // cancelar no Inter primeiro; recusado, registra a ÓRFÃ para o sync
    // vigiar/cancelar sozinho.
    let destinoOrfaoUnico = 'recusado';
    if (codUnico && isInterConfigured()) {
      try {
        const c = await cancelarCobranca(codUnico, 'Cobranca presa - liberada pelo sistema');
        if (c.ok || c.status === 202) destinoOrfaoUnico = 'cancelado';
        else if (c.status === 404) destinoOrfaoUnico = 'inexistente';
      } catch { /* degrada: órfã fica sob vigilância do sync */ }
    }
    if (codUnico && destinoOrfaoUnico === 'recusado') {
      try {
        await db.from('webhook_logs').insert({
          origem: 'ORFAO_INTER',
          evento: { fonte: 'destravar-boleto-unico' },
          codigo: codUnico.slice(0, 120),
          seu_numero: String(sale.inter_boleto_seu_numero || '').slice(0, 60) || null,
          sale_id: saleId.slice(0, 64),
          resultado: 'boleto único destravado pelo admin — cobrança segue VIVA no Inter (cancelamento recusado); sync vigia e cancela sozinho quando sair do EM_PROCESSAMENTO',
          processado: false,
        });
      } catch { /* tabela ausente (SQL 167 pendente) não trava o destravamento */ }
    }
    await atualizar(saleId, {
      inter_boleto_status: 'FALHA_EMISSAO',
      inter_boleto_codigo: null,
      inter_boleto_erro: `Destravado pelo admin em ${carimbo}: cobrança ${codUnico.slice(0, 36)} estava presa em EM_PROCESSAMENTO no Inter${destinoOrfaoUnico === 'cancelado' ? ' e foi CANCELADA lá agora' : destinoOrfaoUnico === 'inexistente' ? ' e nem existe mais lá' : ' (cancelamento recusado lá — o sync vigia e cancela sozinho quando sair do processamento)'}. Gere um novo boleto.`,
    });
    return NextResponse.json({ ok: true, boleto: { ...cobrancaPublica(sale as Record<string, unknown>), status: 'FALHA_EMISSAO' } });
  }

  // ------------------------------------------------------------------
  // BLOCO 227 — RESET TOTAL DO BOLETO (ADMIN, venda inteira de uma vez).
  // Pedido literal do dono ("reseta todo o sistema de boletos e deixa
  // tudo funcional novamente"): um botao de ULTIMO RECURSO que devolve
  // a venda ao estado NAO_GERADO puro em qualquer situacao travada —
  // boleto unico + divisao apagados, cobrancas vivas canceladas no Inter
  // (best-effort; recusa vira ORFA vigiada pelo sync, BLOCO 226) e um
  // log RESET_BOLETO no webhook_logs. PROTECAO: nada de apagar dinheiro
  // real — boleto unico ou parcela RECEBIDO/MARCADO_RECEBIDO bloqueia
  // o reset (e nem faz sentido: a venda ja foi paga).
  // ------------------------------------------------------------------
  if (acao === 'RESET') {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin pode resetar boletos.');
    const carimboReset = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    // Protecao 1: boleto unico recebido = dinheiro real registrado
    if (['RECEBIDO', 'MARCADO_RECEBIDO'].includes(String(sale.inter_boleto_status))) {
      return BAD(422, 'O boleto unico desta venda ja foi RECEBIDO (dinheiro real) — o reset nao pode apaga-lo. A venda ja esta paga.');
    }
    // Protecao 2: parcela da divisao recebida
    if (await hasSalesBoletosTable()) {
      const { data: pl } = await db.from('sales_boletos').select('id, seq, status, codigo, seu_numero').eq('sale_id', saleId);
      const pagaP = (pl || []).some((p: Record<string, unknown>) => ['RECEBIDO', 'MARCADO_RECEBIDO'].includes(String(p.status)));
      if (pagaP) return BAD(422, 'Ha boleto da divisao ja RECEBIDO (dinheiro real) — o reset nao pode apagar. A venda ja esta paga.');
      // --- Cancela no Inter as cobrancas VIVAS (unico + parcelas) ---
      let canceladasInter = 0;
      let orfasVigiadas = 0;
      const cancelarOuOrfa = async (codigo: string, seuNumero: string, fonte: string) => {
        if (!codigo) return;
        if (!isInterConfigured()) return;
        try {
          const c = await cancelarCobranca(codigo, 'Reset do boleto pelo admin');
          if (c.ok || c.status === 202 || c.status === 404) { canceladasInter++; return; }
        } catch { /* segue para orfa */ }
        orfasVigiadas++;
        try {
          await db.from('webhook_logs').insert({
            origem: 'ORFAO_INTER',
            evento: { fonte },
            codigo: codigo.slice(0, 120),
            seu_numero: String(seuNumero || '').slice(0, 60) || null,
            sale_id: saleId.slice(0, 64),
            resultado: `cobranca ficou viva no Inter apos RESET do admin (cancelamento recusado) — sync vigia e cancela sozinho quando sair do EM_PROCESSAMENTO; avisa se alguem pagar`,
            processado: false,
          });
        } catch { /* tabela ausente nao trava o reset */ }
      };
      const codUnicoR = String(sale.inter_boleto_codigo || '');
      const stUnicoR = String(sale.inter_boleto_status || '');
      if (codUnicoR && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO'].includes(stUnicoR)) {
        await cancelarOuOrfa(codUnicoR, String(sale.inter_boleto_seu_numero || ''), 'reset-boleto-unico');
      }
      const { data: plR } = await db.from('sales_boletos').select('id, seq, status, codigo, seu_numero').eq('sale_id', saleId);
      for (const p of (plR || []) as Record<string, unknown>[]) {
        const cd = String(p.codigo || '');
        const st = String(p.status || '');
        if (!cd || ['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO'].includes(st)) continue;
        await cancelarOuOrfa(cd, String(p.seu_numero || ''), 'reset-parcela');
      }
      // --- Apaga a divisao inteira e zera o boleto unico da venda ---
      await db.from('sales_boletos').delete().eq('sale_id', saleId);
      await atualizar(saleId, {
        inter_boleto_status: 'NAO_GERADO',
        inter_boleto_codigo: null,
        inter_boleto_seu_numero: null,
        inter_boleto_linha: null,
        inter_boleto_barras: null,
        inter_boleto_pix: null,
        inter_boleto_erro: null,
        inter_boleto_valor: null,
        inter_boleto_vencimento: null,
        inter_boleto_em: null,
      });
      try {
        await db.from('webhook_logs').insert({
          origem: 'RESET_BOLETO',
          evento: { fonte: 'reset-admin' },
          sale_id: saleId.slice(0, 64),
          resultado: `RESET total do boleto pelo admin em ${carimboReset}: cobrancas canceladas no Inter ${canceladasInter}, orfas sob vigilancia ${orfasVigiadas} — venda voltou a NAO_GERADO (boleto unico e divisao apagados)`,
          processado: true,
        });
      } catch { /* tabela ausente nao trava o reset */ }
      return NextResponse.json({
        ok: true,
        boleto: { status: 'NAO_GERADO', codigo: '', seuNumero: '', vencimento: '', valor: null, linhaDigitavel: '', codigoBarras: '', pixCopiaECola: '', valorRecebido: null, erro: '', notaFiscalChave: '' },
        parcelas: [],
        ...(orfasVigiadas > 0 ? { aviso: `${orfasVigiadas} cobranca(s) antiga(s) seguiram vivas no Inter (cancelamento recusado lá) — o sistema vigia e cancela sozinho quando sair do processamento.` } : {}),
      });
    }
    // Sem tabela de parcelas (SQL 199 pendente): reset so do boleto unico
    const codUnicoR2 = String(sale.inter_boleto_codigo || '');
    if (codUnicoR2 && isInterConfigured()) {
      try { await cancelarCobranca(codUnicoR2, 'Reset do boleto pelo admin'); } catch { /* degrada */ }
    }
    await atualizar(saleId, {
      inter_boleto_status: 'NAO_GERADO',
      inter_boleto_codigo: null,
      inter_boleto_seu_numero: null,
      inter_boleto_linha: null,
      inter_boleto_barras: null,
      inter_boleto_pix: null,
      inter_boleto_erro: null,
      inter_boleto_valor: null,
      inter_boleto_vencimento: null,
      inter_boleto_em: null,
    });
    try {
      await db.from('webhook_logs').insert({
        origem: 'RESET_BOLETO',
        evento: { fonte: 'reset-admin' },
        sale_id: saleId.slice(0, 64),
        resultado: `RESET do boleto unico pelo admin em ${carimboReset} — venda voltou a NAO_GERADO`,
        processado: true,
      });
    } catch { /* tabela ausente nao trava o reset */ }
    return NextResponse.json({ ok: true, boleto: { status: 'NAO_GERADO', codigo: '', seuNumero: '', vencimento: '', valor: null, linhaDigitavel: '', codigoBarras: '', pixCopiaECola: '', valorRecebido: null, erro: '', notaFiscalChave: '' } });
  }

  // ---------- CANCELAR (ADMIN, venda ou parcela) ----------
  if (acao === 'CANCELAR') {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin pode cancelar boletos.');
    if (!isInterConfigured()) return BAD(503, 'Inter nao configurado (env INTER_CLIENT_ID / INTER_CLIENT_SECRET / certificado no Vercel).');
    const motivo = String(body.motivo || '').trim();
    if (!motivo) return BAD(422, 'Motivo do cancelamento obrigatorio (max. 50 caracteres).');
    if (body.parcelaId) {
      if (!(await hasSalesBoletosTable())) return BAD(503, 'Rode o SQL do Bloco 199 (sales_boletos).');
      const parcela = await carregarParcela(saleId, String(body.parcelaId));
      if (!parcela || !parcela.codigo) return BAD(422, 'Esta parcela nao tem boleto para cancelar.');
      const r = await cancelarCobranca(String(parcela.codigo), motivo);
      // BLOCO 223: 404 = a cobranca NAO existe no Inter (emissao morreu lá
      // depois do POST) — nao ha nada a cancelar lá e o cancelamento LOCAL
      // segue para destravar o card. 202 = cancelamento assincrono aceito.
      if (!r.ok && r.status !== 202 && r.status !== 404) {
        // BLOCO 224: recusa CLÁSSICA do Inter para cobrança ainda em
        // processamento ("A cobrança não pode ser cancelada, pois se
        // encontra na situação EM_PROCESSAMENTO") — orienta o DESTRAVAR.
        if (String(r.erro || '').toUpperCase().includes('EM_PROCESSAMENTO')) {
          // BLOCO 226: a recusa deixa a cobrança REGISTRADA como ÓRFÃ — o
          // sync vigia: cancela sozinho se ela sair do processamento e avisa
          // URGENTE se alguém pagar (protege contra boleto pago duplicado).
          try {
            await db.from('webhook_logs').insert({
              origem: 'ORFAO_INTER',
              evento: { fonte: 'cancelar-parcela-recusado' },
              codigo: String(parcela.codigo).slice(0, 120),
              seu_numero: String(parcela.seu_numero || '').slice(0, 60) || null,
              sale_id: saleId.slice(0, 64),
              resultado: `cancelamento da parcela ${Number(parcela.seq) || 1} recusado pelo Inter (EM_PROCESSAMENTO) — sync vigia e cancela sozinho quando sair do processamento`,
              processado: false,
            });
          } catch { /* tabela ausente não trava a resposta */ }
          return BAD(409, 'O Inter não permite cancelar um boleto que ainda está processando lá dentro. Use DESTRAVAR (botão do admin) para liberar e gerar um boleto novo — a cobrança antiga fica vigiada e será cancelada automaticamente se sair do processamento.');
        }
        return BAD(502, r.erro || 'Falha ao cancelar na API do Inter.');
      }
      // BLOCO 210: CANCELADO volta a oferecer Gerar/Refazer no card — a
      // parcela continua na divisão (a venda NÃO é cancelada, só o boleto).
      await db.from('sales_boletos').update({ status: 'CANCELADO', erro: null }).eq('id', String(parcela.id));
      await recomputeVencimentoVenda(saleId);
      const { data: atual } = await db.from('sales_boletos').select(PARC_COLS).eq('id', String(parcela.id)).maybeSingle();
      return NextResponse.json({ ok: true, parcela: parcelaPublica(atual as Record<string, unknown>) });
    }
    if (!sale.inter_boleto_codigo) return BAD(422, 'Esta venda nao tem boleto para cancelar.');
    const r = await cancelarCobranca(String(sale.inter_boleto_codigo), motivo);
    // BLOCO 223: mesmo 404 da parcela — cobranca inexistente no Inter nao
    // impede o cancelamento local (destrava GERAR/REEMITIR no card).
    if (!r.ok && r.status !== 202 && r.status !== 404) {
      // BLOCO 224: mesma recusa do Inter para cobrança em processamento.
      if (String(r.erro || '').toUpperCase().includes('EM_PROCESSAMENTO')) {
        // BLOCO 226: registra a ÓRFÃ — o sync vigia e cancela sozinho.
        try {
          await db.from('webhook_logs').insert({
            origem: 'ORFAO_INTER',
            evento: { fonte: 'cancelar-unico-recusado' },
            codigo: String(sale.inter_boleto_codigo).slice(0, 120),
            seu_numero: String(sale.inter_boleto_seu_numero || '').slice(0, 60) || null,
            sale_id: saleId.slice(0, 64),
            resultado: 'cancelamento do boleto único recusado pelo Inter (EM_PROCESSAMENTO) — sync vigia e cancela sozinho quando sair do processamento',
            processado: false,
          });
        } catch { /* tabela ausente não trava a resposta */ }
        return BAD(409, 'O Inter não permite cancelar um boleto que ainda está processando lá dentro. Use DESTRAVAR (botão do admin) para liberar e gerar um boleto novo — a cobrança antiga fica vigiada e será cancelada automaticamente se sair do processamento.');
      }
      return BAD(502, r.erro || 'Falha ao cancelar na API do Inter.', { boleto: cobrancaPublica(sale as Record<string, unknown>) });
    }
    await atualizar(saleId, { inter_boleto_status: 'CANCELADO', inter_boleto_erro: null });

    // -----------------------------------------------------------------
    // BLOCO 192 (regra do dono): cancelar o boleto NÃO exclui mais a venda —
    // a venda permanece no sistema para ajustes (mesma regra do cancelamento
    // da nota). Quem quiser apagar a venda usa Estornar/Excluir Venda, que
    // agora CANCELA a nota batida na SEFAZ antes de remover.
    // -----------------------------------------------------------------
    return NextResponse.json({ ok: true, boleto: { ...cobrancaPublica(sale as Record<string, unknown>), status: 'CANCELADO' } });
  }

  // ---------- EMITIR_TODAS (Bloco 199: gera as 2 parcelas de uma vez) ----------
  if (acao === 'EMITIR_TODAS') {
    if (!(await hasSalesBoletosTable())) return BAD(503, 'Rode o SQL do Bloco 199 (sales_boletos).');
    const { data: abertas } = await db
      .from('sales_boletos')
      .select(PARC_COLS)
      .eq('sale_id', saleId)
      .order('seq', { ascending: true });
    const fila = (abertas || []).filter((p: Record<string, unknown>) => {
      // BLOCO 212 (race): antes o filtro era `!p.codigo || status em [mortos]`
      // — uma parcela EM_PROCESSAMENTO (emissão em voo, código ainda null)
      // PASSAVA pelo `!p.codigo` e era re-emitida: 2 boletos vivos no Inter
      // para o mesmo débito. Agora EM_PROCESSAMENTO sai da fila SEMPRE;
      // emissão conjunta ainda tem o CAS dentro de emitirCobrancaUnificada.
      const st = String(p.status || '');
      if (st === 'EM_PROCESSAMENTO') return false;
      if (['NAO_GERADO', 'FALHA_EMISSAO', 'CANCELADO', 'EXPIRADO'].includes(st)) return true;
      return !p.codigo; // legado: status desconhecido sem código de cobrança
    });
    if (!fila || fila.length === 0) {
      return NextResponse.json({ ok: true, resultados: [], aviso: 'Todos os boletos da divisão já estão gerados.' });
    }
    const resultados: Array<{ seq: number; ok: boolean; erro?: string; parcela?: Record<string, unknown> }> = [];
    for (const p of fila) {
      const res = await emitirCobrancaUnificada({
        sale: sale as Record<string, unknown>,
        saleId,
        docManual: String(body.docManual || ''),
        cepManual: String(body.cepManual || ''),
        atrelarNFe: body.atrelarNFe !== false,
        mensagemAvulsa: '',
        parcela: p,
      });
      if (res.status === 200) {
        const j = await res.json();
        resultados.push({ seq: Number(p.seq), ok: true, parcela: j.parcela });
      } else {
        const j = await res.json().catch(() => ({ erro: `HTTP ${res.status}` }));
        resultados.push({ seq: Number(p.seq), ok: false, erro: String(j.erro || 'Falha na emissão') });
      }
    }
    return NextResponse.json({ ok: resultados.every(r => r.ok), resultados });
  }

  // ---------- EMITIR (boleto único OU parcela por parcelaId) ----------
  if (acao !== 'EMITIR') return BAD(400, `Acao desconhecida: ${acao}`);

  // Bloco 199: emissão de UMA parcela
  if (body.parcelaId) {
    if (!(await hasSalesBoletosTable())) return BAD(503, 'Rode o SQL do Bloco 199 (sales_boletos).');
    const parcela = await carregarParcela(saleId, String(body.parcelaId));
    if (!parcela) return BAD(404, 'Parcela nao encontrada.');
    // ------------------------------------------------------------------
    // BLOCO 223 (destravamento do "EM PROCESSAMENTO que nao vai"): parcela
    // com codigo e status ainda nao final — reconsulta o Inter NO CLIQUE:
    //   - existe e processou -> espelha o estado REAL (A_RECEBER + linha/
    //     pix/PDF) e devolve jaGerado atualizado (card mostra o boleto);
    //   - 404 (o Inter NAO conhece a cobranca) -> marca FALHA_EMISSAO e
    //     SEGUE para a emissao nova logo abaixo (GERAR finalmente gera);
    //   - falhou por outro motivo (rede/token) -> mantem jaGerado antigo.
    // ------------------------------------------------------------------
    if (parcela.codigo && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(String(parcela.status))) {
      const rec = await recuperarCobranca(String(parcela.codigo));
      if (!rec.ok && rec.status === 404) {
        await db.from('sales_boletos').update({
          status: 'FALHA_EMISSAO',
          erro: 'Cobranca anterior nao existe no Inter (404) — pode gerar de novo.',
        }).eq('id', String(parcela.id));
      } else if (rec.ok && rec.data) {
        const cobOk = interpretarCobranca(rec.data as Record<string, unknown>);
        await espelharParcelaInter(db, parcela as unknown as ParcelaRow, cobOk, hojeSp());
        const pagoAgora = cobOk.status === 'RECEBIDO' || cobOk.status === 'MARCADO_RECEBIDO' || (cobOk.valorRecebido !== null && cobOk.valorRecebido > 0);
        if (pagoAgora) await baixarParcelaPaga(db, parcela as unknown as ParcelaRow, 'CONSULTA_MANUAL');
        const { data: atual } = await db.from('sales_boletos').select(PARC_COLS).eq('id', String(parcela.id)).maybeSingle();
        return NextResponse.json({ ok: true, jaGerado: true, parcela: parcelaPublica(atual as Record<string, unknown>) });
      } else {
        return NextResponse.json({ ok: true, jaGerado: true, parcela: parcelaPublica(parcela) });
      }
    }
    return emitirCobrancaUnificada({
      sale: sale as Record<string, unknown>,
      saleId,
      docManual: String(body.docManual || ''),
      cepManual: String(body.cepManual || ''),
      atrelarNFe: body.atrelarNFe !== false,
      mensagemAvulsa: String(body.mensagem || ''),
      parcela,
    });
  }

  // ------------------------------------------------------------------
  // BLOCO 223 (mesmo destravamento do EMITIR de parcela): boleto UNICO com
  // codigo e status ainda nao final — reconsulta o Inter NO CLIQUE:
  //   - existe -> espelha e devolve jaGerado com o estado REAL;
  //   - 404 -> FALHA_EMISSAO e SEGUE para gerar o boleto novo;
  //   - outro erro -> comportamento antigo (jaGerado).
  // ------------------------------------------------------------------
  if (sale.inter_boleto_codigo && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(String(sale.inter_boleto_status))) {
    const rec = await recuperarCobranca(String(sale.inter_boleto_codigo));
    if (!rec.ok && rec.status === 404) {
      const msgErro = 'Cobranca anterior nao existe no Inter (404) — pode gerar de novo.';
      await atualizar(saleId, { inter_boleto_status: 'FALHA_EMISSAO', inter_boleto_erro: msgErro });
      sale.inter_boleto_status = 'FALHA_EMISSAO';
    } else if (rec.ok && rec.data) {
      const cobOk = interpretarCobranca(rec.data as Record<string, unknown>);
      await atualizar(saleId, {
        inter_boleto_status: cobOk.status,
        inter_boleto_linha: cobOk.linhaDigitavel || (sale.inter_boleto_linha as string) || null,
        inter_boleto_barras: cobOk.codigoBarras || (sale.inter_boleto_barras as string) || null,
        inter_boleto_pix: cobOk.pixCopiaECola || (sale.inter_boleto_pix as string) || null,
        inter_boleto_erro: cobOk.status === 'FALHA_EMISSAO' ? 'Falha na emissao no Inter' : null,
      });
      return NextResponse.json({ ok: true, jaGerado: true, boleto: { ...cobrancaPublica(sale as Record<string, unknown>), ...cobOk } });
    } else {
      return NextResponse.json({ ok: true, jaGerado: true, boleto: cobrancaPublica(sale as Record<string, unknown>) });
    }
  }
  // BLOCO 212 (race do boleto unico): EM_PROCESSAMENTO SEM codigo = emissao
  // em voo (o update roda antes do POST ao Inter). Re-emitir aqui criaria a
  // segunda cobranca — o vendedor aguarda ou recarrega o card.
  if (!sale.inter_boleto_codigo && String(sale.inter_boleto_status) === 'EM_PROCESSAMENTO') {
    return BAD(429, 'O boleto desta venda já está sendo gerado agora — aguarde alguns segundos e recarregue o card.');
  }

  // Valor: saldo em aberto (ou informado), minimo R$ 2,50 (regra da API)
  const total = Number(sale.valor_total) || 0;
  const pago = Number(sale.valor_pago) || 0;
  const saldo = Math.max(0, Math.round((total - pago) * 100) / 100);
  const valorUnico = body.valor !== undefined && body.valor !== null && body.valor !== '' ? Number(body.valor) : saldo;
  // BLOCO 212 (boleto acima do saldo): o valor digitado podia passar do saldo
  // em aberto (ex.: recebimento parcial feito por outro canal depois que o
  // card abriu) — o cliente pagaria MAIS que a dívida. Agora o servidor recusa.
  if (Number.isFinite(valorUnico) && saldo > 0 && Math.round(valorUnico * 100) / 100 > saldo + 0.02) {
    return BAD(422, `O valor do boleto (R$ ${(Math.round(valorUnico * 100) / 100).toFixed(2)}) está acima do saldo em aberto desta venda (R$ ${saldo.toFixed(2)}). Atualize o card e ajuste o valor.`);
  }
  const vencUnico = String(body.vencimento || '').trim();

  return emitirCobrancaUnificada({
    sale: sale as Record<string, unknown>,
    saleId,
    docManual: String(body.docManual || ''),
    cepManual: String(body.cepManual || ''),
    atrelarNFe: body.atrelarNFe !== false,
    mensagemAvulsa: String(body.mensagem || ''),
    parcela: null,
    valorUnico,
    vencUnico,
  });
}
