import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasNotaColumns, hasProductFiscalColumns, hasBoletoColumns, hasPrecoCupom, hasNotaEmitidaEm, hasClientModoCupom, hasProductCodigoColumn, hasProductCodigoGbColumn, hasClientEspecialGbColumn } from '@/lib/serverSchema';
// BLOCO 192 (regra do dono): cancelar a nota NÃO exclui mais a venda — o
// dono pode precisar ajustar algo. A nota cancelada é ARQUIVADA no Portal
// (helper arquivarNotaDaVenda) e a venda permanece intocada no sistema.
import { arquivarNotaDaVenda } from '@/lib/cascataCancelamento';
import { lerEmitentePayload, lerErpConfig } from '@/lib/erpConfig';
import {
  getFocusConfig,
  isFocusConfigured,
  emitirNfe,
  consultarNota,
  cancelarNota,
  interpretarResultado,
  montarPayloadNfe,
  montarPayloadNfce,
  tpagDeMetodo,
  labelTpag,
  refForSale,
  nextTentativa,
  validaCpfCnpj,
  numeroDoEndereco,
  faltandoEnderecoDestinatario,
  FocusDoc,
  FocusDestinatarioV2,
  FocusFormaPagamento,
  FocusNfePayloadV2,
} from '@/lib/focusNfe';
import { arquivarDaConsulta, invalidaPresenca } from '@/lib/focusArquivos';
import { cancelarCobranca, isInterConfigured } from '@/lib/interBoleto';
// BLOCO 142: prazo SEFAZ de cancelamento (NFC-e 30min / NF-e 24h) — fonte única front+servidor
import { prazoCancelamentoNota } from '@/lib/regras-fiscais';

/**
 * NOTAS FISCAIS (Bloco 10) — emissao de NF-e / NFC-e na venda de pronta entrega.
 *
 * BLOCO 85: payload atualizado para a API Focus v2.0 (formato "flat" da
 * referencia oficial doc.focusnfe.com.br — ago/2026). Mudancas que importam:
 * - destinatario RASO (cnpj_destinatario, nome_destinatario...), sem objeto cliente
 * - pagamento: PIX = tPag 17 (16 e deposito bancario!)
 * - NFC-e: data_emissao SEMPRE "agora" (SEFAZ recusa dhEmi > 5 min)
 * - NF-e: emissao no momento em que o usuario "bate" a nota (data de emissao
 *   real), referencia da venda vai nas informacoes adicionais
 *
 * POST /api/notas   { acao: 'EMITIR', saleId, tipo?: 'NFE'|'NFCE' }
 *                   { acao: 'CONSULTAR', saleId }
 *                   { acao: 'CANCELAR', saleId, justificativa }   [ADMIN]
 * GET  /api/notas?saleId=...  -> status da integracao Focus + nota da venda
 *                                (sem chamada externa; usado pelo Cupom para
 *                                avisar quando o env FOCUS_NFE_TOKEN falta)
 *
 * Regras:
 * - Vendedor so mexe nas PROPRIAS vendas; admin em qualquer uma.
 * - Cliente com CNPJ valido -> NF-e (modelo 55). Consumidor final -> NFC-e.
 * - NF-e exige cadastro minimo (CNPJ + razao — Bloco 77, regra do dono).
 * - Se as colunas do Bloco 10 ainda nao existirem no Supabase, responde 503
 *   com instrucao clara (probe serverSchema, padrao do projeto).
 */

interface NotaPublica {
  status: string;
  numero: string;
  ref: string;
  pdfUrl: string;
  erro: string;
  /** BLOCO 135: tipo real do documento ('NFE'|'NFCE') — rotula badge NFC/NF-e */
  tipo: string;
  /** BLOCO 142: quando a SEFAZ autorizou (ISO) — base do prazo de cancelamento */
  emitidaEm: string | null;
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
    // BLOCO 135: o front precisa saber se o documento é NFC-e ou NF-e
    // ("NF 17" virava NFC/NF-e errado no card quando a consulta não dizia o tipo)
    tipo: (s.nota_tipo as string) || '',
    // BLOCO 142: data de autorização da SEFAZ — o front usa para o prazo de cancelar
    emitidaEm: (s.nota_emitida_em as string) || null,
  };
}

// BLOCO 142: nota_emitida_em entra SÓ quando a coluna existe (SQL do Bloco 108);
// sem ela a leitura inteira quebraria (mesmo padrão de probe do projeto).
const COLS_NOTA_BASE = 'id, vendedor_id, client_id, valor_total, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, nota_status, nota_tipo, nota_numero, nota_ref, nota_pdf_url, nota_xml_url, nota_erro';
const colsNota = async () => ((await hasNotaEmitidaEm()) ? `${COLS_NOTA_BASE}, nota_emitida_em` : COLS_NOTA_BASE);

/** Data-hora legível pt-BR p/ as mensagens de prazo (mesmo formato do carimbo). */
function fmtDataBR(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const saleId = req.nextUrl.searchParams.get('saleId') || '';
  if (!saleId) return BAD(400, 'Parametro ausente (saleId).');

  // Status da integracao (sem tocar a Focus) — o Cupom usa para avisar
  // quando o env da Vercel esta faltando em vez de erro generico no clique.
  const cfg = getFocusConfig();
  const focus = {
    configurado: isFocusConfigured(),
    ambiente: cfg.ambiente,
    emitenteCnpj: !!cfg.cnpj,
  };

  if (!(await hasNotaColumns())) {
    return NextResponse.json({ ok: true, focus, nota: null });
  }

  const db = getServiceClient();
  const { data: sale, error } = await db.from('sales').select(await colsNota()).eq('id', saleId).single();
  if (error || !sale) return BAD(404, 'Venda nao encontrada.');
  if (session.perfil !== 'ADMIN' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode ver a nota das suas proprias vendas.');
  }
  return NextResponse.json({ ok: true, focus, nota: notaPublica(sale as Record<string, unknown>) });
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

  if (!(await hasNotaColumns())) {
    return BAD(503, 'Colunas de nota fiscal nao existem ainda no Supabase. Rode o SQL do Bloco 10 (docs/NOTAS-FISCAIS.md).');
  }

  const db = getServiceClient();

  // Carrega a venda e valida permissao
  const { data: sale, error: saleErr } = await db
    .from('sales')
    .select(await colsNota())
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
    // Bloco 25: guarda a chave de acesso (44 dig) p/ atrelar a NF-e ao boleto Inter
    if (res.chave && (await hasBoletoColumns())) patch.nota_chave = res.chave;
    // BLOCO 142: primeira vez que a SEFAZ confirma a autorização, grava a
    // data-hora oficial — é a BASE do prazo de cancelamento (NFC-e 30min/NF-e 24h)
    if (res.autorizada && res.dataAutorizacao && (await hasNotaEmitidaEm()) && !(sale as Record<string, unknown>).nota_emitida_em) {
      const dAuto = new Date(res.dataAutorizacao);
      if (!isNaN(dAuto.getTime())) patch.nota_emitida_em = dAuto.toISOString();
    }
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

    // ---------------------------------------------------------------
    // BLOCO 142 — GUARDA DO PRAZO SEFAZ (NFC-e 30min / NF-e 24h após a
    // autorização). Passado o prazo a SEFAZ RECUSA o evento — o servidor
    // recusa antes com mensagem clara. Usa a data-hora REAL de autorização:
    // sales.nota_emitida_em; quando ela não existe (venda antiga) consulta
    // a Focus UMA vez (data_autorizacao) e grava. Sem timestamp real o
    // julgamento fica com a SEFAZ — nunca bloqueia por chute (a NF-e pode
    // ter sido batida DIAS depois da venda).
    // ---------------------------------------------------------------
    let prazo: ReturnType<typeof prazoCancelamentoNota> | null = null;
    if (String(sale.nota_status).toUpperCase() === 'AUTORIZADA') {
      let baseAutorizacao = (await hasNotaEmitidaEm()) ? ((sale as Record<string, unknown>).nota_emitida_em as string) || null : null;
      if (!baseAutorizacao && sale.nota_ref) {
        try {
          const c = await consultarNota(doc, sale.nota_ref as string);
          if (c.ok && c.data && !('erro' in c.data)) {
            const ci = interpretarResultado(c.data as Record<string, unknown>);
            if (ci.autorizada && ci.dataAutorizacao) {
              const dAuto = new Date(ci.dataAutorizacao);
              if (!isNaN(dAuto.getTime())) {
                baseAutorizacao = dAuto.toISOString();
                if (await hasNotaEmitidaEm()) await atualizarNota(saleId, { nota_emitida_em: baseAutorizacao });
              }
            }
          }
        } catch { /* Focus indisponível -> a SEFAZ decide no cancelamento */ }
      }
      prazo = prazoCancelamentoNota({ tipo: sale.nota_tipo as string, status: 'AUTORIZADA', emitidaEm: baseAutorizacao });
      if (prazo.expirado && baseAutorizacao) {
        return BAD(
          422,
          `Cancelamento FORA DO PRAZO da SEFAZ — ${doc === 'nfce' ? 'NFC-e' : 'NF-e'} autorizada em ${fmtDataBR(baseAutorizacao)} e o prazo de ${prazo.prazoLabel} já venceu. O evento de cancelamento seria recusado.`,
          { nota: notaPublica(sale as Record<string, unknown>), prazo: { expiraEm: prazo.expiraEm, expirado: true, prazoLabel: prazo.prazoLabel } },
        );
      }
    }

    const r = await cancelarNota(doc, sale.nota_ref as string, just);
    if (!r.ok || !r.data || 'erro' in r.data) {
      return BAD(502, (r.data as { erro?: string }).erro || 'Falha ao cancelar na Focus NFe.', { nota: notaPublica(sale as Record<string, unknown>) });
    }
    const res = interpretarResultado(r.data as Record<string, unknown>);
    await atualizarNota(saleId, {
      nota_status: res.cancelada ? 'CANCELADA' : sale.nota_status,
      nota_erro: res.cancelada ? null : res.motivo || null,
    });

    // -----------------------------------------------------------------
    // BLOCO 192 (regra do dono): O QUE ACONTECE AO CANCELAR A NOTA:
    //   0. BOLETO INTER: cancelado JUNTO (regra antiga do BLOCO 147 — se o
    //      Inter falhar a nota segue cancelada e o aviso pede o cancelamento
    //      manual no Portal Fiscal > Ações > Boleto).
    //   1. Nota cancelada é ARQUIVADA como avulsa no Portal (filtro
    //      CANCELADAS): DANFE + XML + XML do cancelamento + cliente, valor,
    //      pagamento e vendedor da venda original.
    //   2. A VENDA CONTINUA no sistema — SEM exclusão, SEM estorno de
    //      estoque, SEM tocar em comissão: "se eu cancelar a nota antes vc
    //      não deve excluir a venda pq de repente eu vou ajustar algo". O
    //      admin ajusta o que precisar e depois exclui a venda pela tela
    //      normal (a exclusão devolve o estoque e cancela o que faltar).
    // Falha de qualquer etapa NUNCA desfaz o cancelamento na SEFAZ — vira
    // aviso na resposta para o admin resolver manualmente.
    // -----------------------------------------------------------------
    const cascade: string[] = [];
    let boletoBloqueado = false;
    if (res.cancelada) {
      // ----- 0) BOLETO INTER (primeiro de tudo) -----
      try {
        if (await hasBoletoColumns()) {
          const { data: sB } = await db.from('sales')
            .select('inter_boleto_codigo, inter_boleto_status')
            .eq('id', saleId).single();
          const codigoB = String((sB as Record<string, unknown>)?.inter_boleto_codigo || '');
          const statusB = String((sB as Record<string, unknown>)?.inter_boleto_status || '').toUpperCase();
          if (codigoB && !['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'].includes(statusB)) {
            if (isInterConfigured()) {
              const rB = await cancelarCobranca(codigoB, `NF ${res.numero || ''} cancelada`.slice(0, 50));
              if (rB.ok || rB.status === 202 || rB.status === 204) {
                await db.from('sales').update({ inter_boleto_status: 'CANCELADO', inter_boleto_erro: null }).eq('id', saleId);
                cascade.push('Boleto bancário cancelado no Inter');
              } else {
                cascade.push(`Boleto NÃO cancelado no Inter (${rB.erro || 'falha'}) — cancele no Portal Fiscal (Ações > Boleto > Cancelar)`);
                boletoBloqueado = true;
              }
            } else {
              cascade.push('Boleto vivo mas o Inter não está configurado — cancele no Portal Fiscal (Ações > Boleto > Cancelar)');
              boletoBloqueado = true;
            }
          }
        }
      } catch (eB) {
        cascade.push(`Boleto não cancelado (${(eB as Error).message}) — cancele no Portal Fiscal (Ações > Boleto > Cancelar)`);
        boletoBloqueado = true;
      }

      // ----- 1) ARQUIVA A NOTA NO PORTAL (CANCELADAS) — a venda PERMANECE -----
      if (sale.nota_ref) {
        try {
          const rA = await arquivarNotaDaVenda(sale as Record<string, unknown>, { statusFinal: 'CANCELADO' });
          if (rA.ok) cascade.push('Nota cancelada arquivada no Portal Fiscal (filtro CANCELADAS)');
          else if (rA.motivo !== 'SEM_NOTA') cascade.push(`Arquivamento da nota cancelada falhou (${rA.motivo || 'erro'}) — reimporte depois em Ações > Importar`);
        } catch (eA) {
          cascade.push(`Arquivamento da nota cancelada falhou (${(eA as Error).message}) — reimporte depois em Ações > Importar`);
        }
      }
    }

    // BLOCO 116 (doc reference/cancelar_nfce.md): NFC-e so pode ser
    // cancelada em ate 30 MINUTOS apos a emissao (NF-e: 24h). O aviso vai
    // na resposta para o admin saber por que a SEFAZ pode recusar.
    return NextResponse.json({
      ok: res.cancelada,
      aviso: res.cancelada
        ? `Nota cancelada na SEFAZ e arquivada no Portal (CANCELADAS). A VENDA CONTINUA no sistema para ajustes — ela NÃO foi excluída.${cascade.length > 0 ? ' ' + cascade.join(' · ') + '.' : ''}`
        : (doc === 'nfce'
          ? 'NFC-e so pode ser cancelada em ate 30 minutos apos a emissao (regra da SEFAZ).'
          : undefined),
      cascade,
      bloqueioBoleto: boletoBloqueado,
      prazo: prazo ? { expiraEm: prazo.expiraEm, prazoLabel: prazo.prazoLabel, textoRestante: prazo.textoRestante } : undefined,
      nota: { ...notaPublica(sale as Record<string, unknown>), ...res },
    });
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

  // ------------------------------------------------------------------
  // BLOCO 108 — MODO CUPOM (regra do dono): cliente que "quer somente
  // cupom" recebe e paga o cupom normal; a NFC-e ANONIMA que alimenta
  // a fiscal sai com o PREÇO CUPOM do produto (products.preco_cupom;
  // 0 = cai no preço de custo). Liga/desliga nas Configurações ERP.
  // Cliente marcado modo_cupom entra no modo AUTOMATICAMENTE.
  // ------------------------------------------------------------------
  const erp = await lerErpConfig();
  const temPrecoCupom = await hasPrecoCupom();
  const temClientModoCupom = await hasClientModoCupom();
  const temEmitidaEm = await hasNotaEmitidaEm();
  // BLOCO 157: código do produto ESPECIAL GB (sobe na NF desses clientes) + flag do cliente
  const temCodigoGb = await hasProductCodigoGbColumn();
  const temClientGb = await hasClientEspecialGbColumn();
  const emitentePayload = (await lerEmitentePayload()) as Partial<FocusNfePayloadV2>;

  // Cliente da venda
  const { data: client } = await db
    .from('clients')
    .select(`nome_fantasia, nome, cnpj, telefone, endereco, bairro, razao_social, inscricao_estadual, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email${temClientModoCupom ? ', modo_cupom' : ''}${temClientGb ? ', cliente_especial_gb' : ''}`)
    .eq('id', sale.client_id)
    .single();

  if (!client) return BAD(422, 'Cliente da venda nao encontrado.');

  const modoCupomPed = body.modoCupom === true;
  const clientModoCupom = temClientModoCupom && (client as Record<string, unknown>).modo_cupom === true;
  if (modoCupomPed && !erp.cupomDuploNfc) {
    return BAD(422, 'Modo cupom DESLIGADO. Ligue em Configuracoes -> ERP Fiscal & Automacoes (cupomDuploNfc).');
  }
  const modoCupom = erp.cupomDuploNfc && (modoCupomPed || clientModoCupom);

  // Tipo automatico: CNPJ valido -> NFe; caso contrario NFC-e (consumidor)
  const cpfCnpj = validaCpfCnpj(client.cnpj);
  const tipoEscolhido = (body.tipo as string) || '';
  let doc: FocusDoc;
  if (modoCupom) {
    doc = 'nfce'; // BLOCO 108: modo cupom e SEMPRE NFC-e anonima (sem consumidor)
  } else if (tipoEscolhido === 'NFE' || tipoEscolhido === 'NFCE') {
    doc = tipoEscolhido === 'NFE' ? 'nfe' : 'nfce';
  } else {
    doc = cpfCnpj === 'CNPJ' ? 'nfe' : 'nfce';
  }

  // ------------------------------------------------------------------
  // BLOCO 137 (regra do dono): NFC-e ANONIMA = PREÇO ESPECIAL. A NFC-e sai
  // sem consumidor (CONSUMIDOR NAO IDENTIFICADO) quando nao tem CPF
  // digitado E o cadastro nao tem documento valido — ou quando e o modo
  // cupom (BLOCO 108). Nesses casos os itens vao no PREÇO CUPOM do produto
  // (preco_cupom; 0 = custo; 0 = preço da venda) e o total da NFC e a soma
  // desses valores. BUG do papel corrigido: a NFC-e "sem CPF" emitida pela
  // tela 8 do PDV ou pela fila do admin saia no PREÇO CHEIO da venda porque
  // so o modo cupom explicito precificava (a mensagem do XML mostrava
  // "Venda ... registrada pelo app" em vez de "Venda cupom ...").
  // NFC-e identificada e NF-e continuam no preço digitado pelo vendedor.
  // ------------------------------------------------------------------
  const uf = String(client.endereco_uf || '').toUpperCase().trim();
  const municipio = String(client.endereco_municipio || '').trim();
  const logradouro = String(client.endereco || '').trim();
  const bairro = String(client.bairro || '').trim();
  const razao = String(client.razao_social || client.nome_fantasia || '').trim();
  const cpfNaNota = String(body.cpf || '').replace(/\D/g, '');
  const nfceIdentificada = doc === 'nfce' && (!!cpfNaNota || (!modoCupom && !!razao && !!cpfCnpj));
  const nfceAnonima = doc === 'nfce' && !nfceIdentificada;
  const precoAnonimo = modoCupom || nfceAnonima;

  // BLOCO 117 (doc reference/emitir_nfce.md — NFCeRequest required): a NFC-e
  // EXIGE cnpj_emitente no payload (a NF-e cai no cadastro da conta). Sem
  // CNPJ (nem na tela ERP Fiscal, nem no env), recusamos ANTES de marcar a
  // venda EMITINDO — com instrucao clara, em vez de rejeicao criptica da Focus.
  if (doc === 'nfce') {
    const cnpjEmit =
      String(erp.emitente.cnpj || '').replace(/\D/g, '') || String(cfg.cnpj || '').replace(/\D/g, '');
    if (!cnpjEmit) {
      return BAD(
        503,
        'A NFC-e exige o CNPJ do emitente. Cadastre em Configuracoes -> ERP Fiscal & Automacoes (Dados do emitente) ou defina FOCUS_NFE_CNPJ na Vercel.'
      );
    }
  }

  // Itens + codigos fiscais (colunas ncm/cest/cfop se o Bloco 10 ja rodou)
  const fiscalCols = await hasProductFiscalColumns();
  // BLOCO 145: codigo INTERNO do produto (aparece na NF — nao é o EAN)
  const temCodigoProduto = await hasProductCodigoColumn();
  const { data: items } = await db
    .from('sale_items')
    .select('produto_id, quantidade, preco_venda')
    .eq('sale_id', saleId);
  if (!items || items.length === 0) return BAD(422, 'Venda sem itens — nao e possivel emitir nota.');

  const prodIds = [...new Set(items.map((i: Record<string, unknown>) => i.produto_id as string))];
  const prodCols = [
    'id, nome',
    fiscalCols ? 'ncm, cest, cfop, ean, unidade, origem' : '',
    temCodigoProduto ? 'codigo' : '',
    // BLOCO 157: código do produto ESPECIAL GB (quando o cliente da nota for ESPECIAL GB)
    temCodigoGb ? 'codigo_especial_gb' : '',
    // BLOCO 108: preco_cupom (0 = cai no custo) + custo como fallback
    temPrecoCupom ? 'preco_cupom' : '',
    'preco_custo',
  ].filter(Boolean).join(', ');
  const { data: prodsData } = await db
    .from('products')
    .select(prodCols)
    .in('id', prodIds);
  const prods = (prodsData || []) as unknown as Record<string, unknown>[];
  const prodMap = new Map(prods.map(p => [p.id as string, p]));

  // ------------------------------------------------------------------
  // BLOCO 157 (regra do dono): cliente ESPECIAL GB -> a nota desses
  // clientes sobe com o CÓDIGO DO PRODUTO ESPECIAL GB (products.
  // codigo_especial_gb) no lugar do código interno — igual ao Preço
  // Especial GB no PDV. Produto sem código GB ou cliente NORMAL segue
  // o código interno (ou prefixo do id, legado). NFC-e ANÔNIMA (modo
  // cupom / sem identificação) NÃO usa: a nota não é "para o cliente".
  // ------------------------------------------------------------------
  const clienteEspecialGb = !precoAnonimo && temClientGb && (client as unknown as Record<string, unknown>).cliente_especial_gb === true;

  const payloadItems = items.map((i: Record<string, unknown>) => {
    const p = (prodMap.get(i.produto_id as string) || {}) as Record<string, unknown>;
    // BLOCO 108 (regra do dono): no modo cupom a NFC anônima sai com o
    // PREÇO CUPOM do produto; sem preco_cupom (0), usa o PREÇO DE CUSTO;
    // sem custo também (0), cai no preço de venda da venda.
    const precoCupom = temPrecoCupom ? Number(p.preco_cupom) || 0 : 0;
    const custo = Number(p.preco_custo) || 0;
    const valorUnitCupom = precoCupom > 0 ? precoCupom : custo > 0 ? custo : Number(i.preco_venda) || 0;
    // BLOCO 157: código especial GB tem prioridade para cliente ESPECIAL GB
    const codEspecialGb = temCodigoGb ? String(p.codigo_especial_gb || '').trim() : '';
    return {
      // BLOCO 145/157: cliente ESPECIAL GB + produto com código especial ->
      // sobe o código ESPECIAL; sem, o código INTERNO do cadastro; sem
      // cadastro, prefixo do id (legado). NAO é o EAN.
      codigo: (clienteEspecialGb && codEspecialGb) || (temCodigoProduto && String(p.codigo || '').trim()) || String(p.id || '').slice(0, 8),
      descricao: String(p.nome || 'Produto'),
      ncm: fiscalCols ? (p.ncm as string) || undefined : undefined,
      cfop: fiscalCols ? (p.cfop as string) || undefined : undefined,
      ean: fiscalCols ? (p.ean as string) || undefined : undefined,
      unidade: fiscalCols ? ((p.unidade as string) || 'UN') : 'UN',
      origem: fiscalCols ? (p.origem as string) || undefined : undefined,
      quantidade: Number(i.quantidade) || 0,
      valorUnitario: precoAnonimo ? valorUnitCupom : (Number(i.preco_venda) || 0),
    };
  });

  // BLOCO 108/137: na NFC-e ANONIMA (modo cupom ou consumidor nao
  // identificado) o TOTAL da NFC e a soma dos preços especiais
  // (a venda real continua no valor que o cliente pagou — gravado no banco)
  const valorTotalCupom = Math.round(payloadItems.reduce((acc, it) => acc + it.quantidade * it.valorUnitario, 0) * 100) / 100;
  const valorTotal = precoAnonimo ? valorTotalCupom : (Number(sale.valor_total) || 0);

  // Pagamento v2.0 — PIX = tPag 17 (armadilha: 16 e deposito bancario)
  const tp = tpagDeMetodo(sale.metodo_pagamento as string);
  const pagamento: FocusFormaPagamento = {
    indicador_pagamento: tp.indicador,
    forma_pagamento: tp.forma,
    valor_pagamento: Math.round(valorTotal * 100) / 100,
  };

  // BLOCO 145 — FORMA DE PAGAMENTO SEMPRE APARECE NA NOTA (regra do dono):
  // além do grupo detPag do XML (impresso na DANFE), o rótulo legível entra
  // nas informações adicionais — NFC-e anonima, contingencia e qualquer
  // layout de impressora mostram a forma de pagamento.
  const pagamentoLabel = labelTpag(tp.forma);

  // Data de emissao: AGORA (NFC-e recusa dhEmi com +5 min; a NF-e "batida"
  // pelo botao tambem emite na hora — a data da venda vai nas informacoes)
  const dataEmissao = new Date();
  const vendaCurta = String(saleId).slice(0, 8).toUpperCase();
  const dataVendaTxt = sale.data_venda
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(sale.data_venda as string))
    : '';
  const informacoes = precoAnonimo
    ? `Venda cupom ${vendaCurta} — NFC-e nao identificada${modoCupom ? ' (modo cupom)' : ''}. Forma de pagamento: ${pagamentoLabel}. Emitida em ${carimbo()}.`
    : `Venda ${vendaCurta}${dataVendaTxt ? ` de ${dataVendaTxt}` : ''} registrada pelo app Doce Mania. Forma de pagamento: ${pagamentoLabel}. Emitida em ${carimbo()}.`;

  // Destinatario + payload por tipo de documento
  let payload;
  if (doc === 'nfe') {
    // BLOCO 77 (regra do dono): a NF-e NAO e batida por este app (o dono
    // emite no sistema externo dele) — aqui o app so CONTROLA a venda como
    // NF. Exigencia minima: CNPJ valido (+ razao, que cai no nome fantasia).
    const faltando: string[] = [];
    if (!cpfCnpj) faltando.push('CNPJ valido');
    if (!razao) faltando.push('Razao social / nome fantasia');
    // BLOCO 176 (erro real: "Element 'nro' not expected. Expected is 'xLgr'"):
    // o enderDest é OBRIGATÓRIO no modelo 55 e o schema SEFAZ aceita TODO OU
    // NADA — logradouro vazio com numero preenchido (ou qualquer campo faltando)
    // montava um XML que a Focus recusava DEPOIS de marcar a venda EMITINDO.
    // Agora recusa ANTES, com a lista exata do que falta e onde corrigir.
    const faltandoEnd = faltandoEnderecoDestinatario({
      logradouro,
      bairro,
      municipio,
      uf,
      cep: String(client.endereco_cep || ''),
    });
    if (faltando.length > 0 || faltandoEnd.length > 0) {
      return BAD(
        422,
        `Cadastro incompleto para NF-e. Complete no portal CLIENTES FISCAIS (menu admin) e tente de novo: ${[...faltando, ...faltandoEnd].join(', ')}.`
      );
    }
    const destinatario: FocusDestinatarioV2 = {
      nome: razao,
      cpf_cnpj: String(client.cnpj).replace(/\D/g, ''),
      inscricao_estadual: String(client.inscricao_estadual || '').trim() || undefined,
      logradouro,
      numero: numeroDoEndereco(client.endereco_numero as string, logradouro),
      bairro,
      municipio,
      uf,
      cep: String(client.endereco_cep || '').replace(/\D/g, ''),
      email: String((client as Record<string, unknown>).email || '').trim() || undefined,
      telefone: String(client.telefone || '').replace(/\D/g, '') || undefined,
    };
    payload = montarPayloadNfe({
      dataEmissao,
      natureza: cfg.natureza,
      ufEmitente: cfg.ufEmitente,
      destinatario,
      itens: payloadItems,
      valorTotalVenda: valorTotal,
      pagamento,
      informacoesAdicionais: informacoes,
      emitente: emitentePayload,
    });
  } else {
    // NFC-e (Bloco 12): escolha explicita do vendedor na tela de venda
    // - CPF informado (e valido): NFC-e identificando o consumidor
    // - Sem CPF: NFC-e ANONIMA (CONSUMIDOR NAO IDENTIFICADO) — BLOCO 137:
    //   sai no PREÇO ESPECIAL (precoAnonimo ja decidido acima)
    let destinatario: FocusDestinatarioV2 | undefined;
    if (cpfNaNota) {
      if (validaCpfCnpj(cpfNaNota) !== 'CPF') {
        return BAD(422, 'CPF invalido (digitos verificadores nao conferem). Corrija o CPF ou deixe vazio para NFC-e sem identificacao.');
      }
      const nomeConsumidor = String(client.nome || client.nome_fantasia || '').trim();
      // BLOCO 176: no modelo 65 o enderDest é OPCIONAL e o schema aceita TODO
      // OU NADA — endereço parcial derruba a nota na Focus (o erro "nro not
      // expected"). Completo vai; incompleto o destinatário sai SEM endereço
      // (a nota não trava).
      const enderCpf = {
        logradouro,
        numero: numeroDoEndereco(client.endereco_numero as string, logradouro),
        bairro,
        municipio,
        uf: uf || cfg.ufEmitente,
        cep: String(client.endereco_cep || '').replace(/\D/g, ''),
      };
      const enderCpfCompleto = faltandoEnderecoDestinatario(enderCpf).length === 0;
      destinatario = {
        nome: (nomeConsumidor || 'CONSUMIDOR').slice(0, 60),
        cpf_cnpj: cpfNaNota,
        ...(enderCpfCompleto ? enderCpf : {}),
      };
    } else if (razao && cpfCnpj && !modoCupom) {
      // BLOCO 128 (pedido do dono): a NFC-e — escolhida na tela OU automatica —
      // identifica o destinatario pelo CADASTRO sempre que o cliente tem
      // CPF/CNPJ valido, e leva o ENDERECO do cadastro. A SEFAZ nao aceita
      // destinatario sem documento, entao cadastro sem CPF/CNPJ valido segue
      // anonimo (como antes — NFC-e de consumidor de passagem).
      // BLOCO 176: endereço TODO OU NADA — cadastro incompleto (ex. MERCADO
      // DALAGE: nº 312 sem rua) sai SEM endereço em vez de derrubar a nota.
      const enderCad = {
        logradouro,
        numero: numeroDoEndereco(client.endereco_numero as string, logradouro),
        bairro,
        municipio,
        uf: uf || cfg.ufEmitente,
        cep: String(client.endereco_cep || '').replace(/\D/g, ''),
      };
      const enderCadCompleto = faltandoEnderecoDestinatario(enderCad).length === 0;
      destinatario = {
        nome: razao.slice(0, 60),
        cpf_cnpj: String(client.cnpj).replace(/\D/g, ''),
        ...(enderCadCompleto ? enderCad : {}),
      };
    }
    // Sem CPF digitado E sem documento valido no cadastro: NFC-e anonima.
    payload = montarPayloadNfce({
      dataEmissao,
      natureza: undefined, // v2.0 NFC-e tem padrao proprio ("VENDA AO CONSUMIDOR")
      ufEmitente: cfg.ufEmitente,
      destinatario,
      itens: payloadItems,
      valorTotalVenda: valorTotal,
      pagamento,
      informacoesAdicionais: informacoes,
      emitente: emitentePayload,
    });
  }

  const ref = refForSale(saleId, nextTentativa(sale.nota_ref as string));

  // Marca EMITINDO antes de chamar a Focus (rastreabilidade se cair a conexao)
  await atualizarNota(saleId, { nota_status: 'EMITINDO', nota_tipo: doc === 'nfce' ? 'NFCE' : 'NFE', nota_ref: ref, nota_erro: null });

  const r = await emitirNfe(doc, ref, payload);
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
  // Bloco 25: guarda a chave de acesso (44 dig) p/ atrelar a NF-e ao boleto Inter
  if (res.chave && (await hasBoletoColumns())) patch.nota_chave = res.chave;
  // BLOCO 108: carimbo de emissao autorizada (historico completo do admin)
  if (res.autorizada && temEmitidaEm) patch.nota_emitida_em = new Date().toISOString();
  const { error: errPatch } = await db.from('sales').update(patch).eq('id', saleId);
  if (errPatch && temEmitidaEm) {
    // coluna nota_emitida_em ainda nao existe (SQL 108 pendente) — grava sem ela
    delete patch.nota_emitida_em;
    await atualizarNota(saleId, patch);
  }

  // -------------------------------------------------------------------
  // BLOCO 141 (regra do dono — "salve dentro do nosso sistema"): quando a
  // nota autoriza na MESMA requisicao (sincrona — NFC-e e boa parte das
  // NF-e), PDF e XML sao arquivados no NOSSO storage em background
  // (after). Assim o portal/estoque de arquivos nasce junto com a nota,
  // sem depender do botao IMPORTAR. Best-effort: falha nao afeta a venda.
  // -------------------------------------------------------------------
  if (res.autorizada) {
    after(async () => {
      try {
        await arquivarDaConsulta(doc, ref, r.data as unknown as Record<string, unknown>);
        invalidaPresenca();
      } catch (e) {
        console.warn('[notas:emitir] arquivamento em background falhou (importador cobre):', (e as Error).message);
      }
    });
  }

  return NextResponse.json({
    ok: res.autorizada || res.processando,
    nota: {
      status: patch.nota_status,
      numero: res.numero,
      ref,
      pdfUrl: res.pdfUrl,
      erro: patch.nota_erro,
      // BLOCO 135: tipo do documento emitido — badge certo (NFC/NF-e) na hora
      tipo: doc === 'nfce' ? 'NFCE' : 'NFE',
      // BLOCO 82: dados p/ imprimir o mini DANFE 80mm logo apos a autorizacao
      // (sem precisar de outra consulta) — o app usa na hora da venda
      chave: res.chave || '',
      serie: res.serie || '',
      protocolo: res.protocolo || '',
      dataAutorizacao: res.dataAutorizacao || '',
      qrCode: res.qrCode || '',
      emitente: res.emitente,
    },
  });
}
