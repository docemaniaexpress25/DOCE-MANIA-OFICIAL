import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasNotaColumns, hasBoletoColumns, hasProductFiscalColumns } from '@/lib/serverSchema';
import { lerEmitentePayload } from '@/lib/erpConfig';
import {
  getFocusConfig,
  isFocusConfigured,
  consultarNota,
  interpretarResultado,
  tpagDeMetodo,
} from '@/lib/focusNfe';
import { parseFocusXml, FocusXmlNota } from '@/lib/focusXml';
import { TPAG_LABEL, DanfeFiscalData } from '@/lib/danfe80';

/**
 * BLOCO 131 — CUPOM FISCAL 80mm PERFEITO (dados do documento AUTORIZADO)
 *
 * O dono mandou "transformar o PDF A4 da Focus em cupom fiscal perfeito para
 * a térmica 80mm". O cupom sai do layout oficial (danfeFiscal80) e os dados
 * vêm AQUI: consulta a nota na Focus e BAIXA O XML AUTORIZADO — fonte da
 * verdade da SEFAZ, com tudo que o A4 tem e o mini DANFE (BLOCO 82) não
 * mostrava: emitente com endereco completo, itens com valor total por item,
 * totais oficiais (vNF/desconto), formas de pagamento (tPag), TROCO, QR CODE
 * OFICIAL de consulta (infNFeSupl), protocolo + data de autorizacao e as
 * informacoes adicionais gravadas na nota (infCpl).
 *
 * GET /api/notas/cupom?saleId=...  -> { ok, cupom, aviso? }
 *
 * Regras:
 * - Mesma permissao do /api/notas (vendedor so nas PROPRIAS vendas).
 * - XML indisponivel (rede/sefaz) -> cupom montado com os dados do app
 *   (fonte 'APP' + aviso) — a impressao nunca fica bloqueada por queda da API.
 * - Consulta bem-sucedida tambem SINCRONIZA o banco (mesmo patch do CONSULTAR).
 */

const BAD = (status: number, erro: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, erro, ...extra }, { status });

const soDig = (v?: string | null): string => (v || '').replace(/\D/g, '');

const cepFmt = (v?: string | null): string => {
  const d = soDig(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(v || '');
};

/** Endereco do emitente em blocos (logradouro / bairro-municipio / CEP). */
function enderecoEmitenteXml(e: NonNullable<FocusXmlNota['emitente']>): string {
  const linhas: string[] = [];
  const l1 = [e.logradouro, e.numero ? `, ${e.numero}` : '', e.complemento ? ` - ${e.complemento}` : ''].join('').trim();
  if (l1) linhas.push(l1);
  const l2 = [e.bairro, e.municipio ? `${e.municipio}/${e.uf || ''}` : e.uf].filter(Boolean).join(' - ');
  if (l2) linhas.push(l2);
  const cep = cepFmt(e.cep);
  if (cep) linhas.push(`CEP: ${cep}`);
  return linhas.join('\n');
}

function enderecoEmitentePayload(p: Record<string, unknown>): string {
  const linhas: string[] = [];
  const log = String(p.logradouro_emitente || '').trim();
  const numE = String(p.numero_emitente || '').trim();
  const l1 = [log, numE ? `, ${numE}` : ''].join('').trim();
  if (l1) linhas.push(l1);
  const mun = String(p.municipio_emitente || '').trim();
  const uf = String(p.uf_emitente || '').trim();
  const munUf = [mun, uf].filter(Boolean).join('/');
  const l2 = [String(p.bairro_emitente || '').trim(), munUf].filter(Boolean).join(' - ');
  if (l2) linhas.push(l2);
  const cep = cepFmt(String(p.cep_emitente || ''));
  if (cep) linhas.push(`CEP: ${cep}`);
  return linhas.join('\n');
}

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const saleId = req.nextUrl.searchParams.get('saleId') || '';
  if (!saleId) return BAD(400, 'Parametro ausente (saleId).');

  if (!(await hasNotaColumns())) {
    return BAD(503, 'Colunas de nota fiscal nao existem ainda no Supabase. Rode o SQL do Bloco 10 (docs/NOTAS-FISCAIS.md).');
  }

  const db = getServiceClient();

  // Venda + permissao (mesmo padrao do /api/notas)
  const temBoleto = await hasBoletoColumns();
  const cols = [
    'id, vendedor_id, client_id, valor_total, metodo_pagamento, detalhe_pagamento, status_pagamento, data_venda, nota_status, nota_tipo, nota_ref, nota_numero, nota_pdf_url, nota_erro',
    temBoleto ? 'nota_chave' : '',
  ].filter(Boolean).join(', ');
  const { data: sale, error } = await db.from('sales').select(cols).eq('id', saleId).single();
  if (error || !sale) return BAD(404, 'Venda nao encontrada.');
  if (session.perfil !== 'ADMIN' && session.sub !== sale.vendedor_id) {
    return BAD(403, 'Voce so pode ver o cupom fiscal das suas proprias vendas.');
  }

  const s = sale as Record<string, unknown>;
  const modelo: 'NFCE' | 'NFE' = sale.nota_tipo === 'NFE' ? 'NFE' : 'NFCE';
  const doc = modelo === 'NFCE' ? 'nfce' : 'nfe';

  let aviso = '';

  // ---------------------------------------------------------------
  // 1) CONSULTA a situacao na Focus (fonte: SEFAZ)
  // ---------------------------------------------------------------
  let foco: ReturnType<typeof interpretarResultado> | null = null;
  if (!isFocusConfigured()) {
    aviso = 'Focus NFe nao configurada no servidor (env FOCUS_NFE_TOKEN).';
  } else if (!sale.nota_ref) {
    return BAD(422, 'Esta venda ainda nao tem nota emitida.');
  } else {
    const r = await consultarNota(doc, String(sale.nota_ref));
    if (r.ok && r.data && !('erro' in r.data)) {
      foco = interpretarResultado(r.data as Record<string, unknown>);
      // Sincroniza o banco igual ao CONSULTAR do /api/notas
      const patch: Record<string, unknown> = {
        nota_status: foco.autorizada ? 'AUTORIZADA' : foco.cancelada ? 'CANCELADA' : foco.motivo ? 'REJEITADA' : 'EMITINDO',
        nota_numero: foco.numero || sale.nota_numero || null,
        nota_pdf_url: foco.pdfUrl || sale.nota_pdf_url || null,
        nota_erro: foco.autorizada ? null : foco.motivo || null,
      };
      if (foco.chave && temBoleto) patch.nota_chave = foco.chave;
      await db.from('sales').update(patch).eq('id', saleId);
    } else {
      aviso = 'SEFAZ/Focus nao respondeu agora — cupom montado com os dados do app.';
    }
  }

  // ---------------------------------------------------------------
  // 2) XML AUTORIZADO (fonte da verdade) — baixa e parseia
  // ---------------------------------------------------------------
  let xml: FocusXmlNota | null = null;
  if (foco?.xmlUrl) {
    try {
      const { token } = getFocusConfig();
      const res = await fetch(foco.xmlUrl, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${token}:`).toString('base64') },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const txt = await res.text();
        if (/<infNFe[\s>]/i.test(txt)) xml = parseFocusXml(txt);
      }
    } catch { /* rede caiu — segue com dados do app */ }
  }
  if (foco && !xml) aviso = 'XML da nota indisponivel no momento — cupom parcial (dados da SEFAZ limitados).';

  // ---------------------------------------------------------------
  // 3) Montagem do cupom (XML > Focus > dados do app)
  // ---------------------------------------------------------------
  const emitentePayload = (await lerEmitentePayload()) as Record<string, unknown>;

  const emitente = {
    nome: String(xml?.emitente?.nome || foco?.emitente?.nome || emitentePayload.nome_emitente || '').trim(),
    fantasia: (xml?.emitente?.fantasia || String(emitentePayload.nome_fantasia_emitente || '')).trim() || undefined,
    cnpj: soDig(xml?.emitente?.cnpj) || soDig(foco?.emitente?.cnpj) || soDig(emitentePayload.cnpj_emitente as string) || undefined,
    ie: (xml?.emitente?.ie || foco?.emitente?.ie || String(emitentePayload.inscricao_estadual_emitente || '')).trim() || undefined,
    endereco: (xml?.emitente ? enderecoEmitenteXml(xml.emitente) : enderecoEmitentePayload(emitentePayload)) || undefined,
  };

  // Destinatario: XML (autorizado) > cadastro do cliente
  // MINI DANFE fiel ao A4: endereco completo + IE do destinatario quando o
  // XML traz (NFC-e anonima nao tem bloco <dest> = consumidor nao identificado).
  let destinatario: DanfeFiscalData['destinatario'] | undefined;
  if (xml) {
    if (xml.destinatario && (xml.destinatario.nome || xml.destinatario.cpfCnpj)) {
      const dx = xml.destinatario;
      const l1 = [dx.logradouro, dx.numero ? `, ${dx.numero}` : '', dx.complemento ? ` - ${dx.complemento}` : ''].join('').trim();
      const l2 = [dx.bairro, dx.municipio ? `${dx.municipio}/${dx.uf || ''}` : dx.uf].filter(Boolean).join(' - ');
      const cepD = soDig(dx.cep);
      const linhas: string[] = [];
      if (l1) linhas.push(l1);
      if (l2) linhas.push(l2);
      if (cepD.length === 8) linhas.push(`CEP: ${cepFmt(cepD)}`);
      destinatario = {
        nome: dx.nome,
        doc: soDig(dx.cpfCnpj),
        ie: (dx.ie || '').trim() || undefined,
        endereco: linhas.length ? linhas.join('\n') : undefined,
      };
    }
  } else {
    const { data: cli } = await db.from('clients').select('nome, nome_fantasia, razao_social, cnpj').eq('id', String(sale.client_id || '')).single();
    const c = (cli || {}) as Record<string, unknown>;
    const cdoc = soDig(c.cnpj as string);
    if (cdoc) destinatario = { nome: String(c.razao_social || c.nome_fantasia || c.nome || '').trim(), doc: cdoc };
  }

  // Itens: XML (codigo/descricao/valores oficiais) > itens da venda
  let itens: DanfeFiscalData['itens'] = [];
  let fonte: 'XML' | 'APP' = 'APP';
  if (xml?.itens?.length) {
    fonte = 'XML';
    itens = xml.itens.map(it => ({
      codigo: it.codigo || undefined,
      descricao: it.descricao || 'ITEM',
      quantidade: it.quantidade,
      unidade: it.unidade || 'UN',
      valorUnitario: it.valorUnitario,
      valorTotal: Math.round((it.valorProduto - it.valorDesconto) * 100) / 100,
      ncm: it.ncm || undefined,
      cst: it.cst || undefined,
      cfop: it.cfop || undefined,
    }));
  } else {
    const fiscalCols = await hasProductFiscalColumns();
    const { data: itemsDb } = await db.from('sale_items').select('produto_id, quantidade, preco_venda').eq('sale_id', saleId);
    const ids = [...new Set((itemsDb || []).map((i: Record<string, unknown>) => i.produto_id as string))];
    const { data: prodsData } = ids.length
      ? await db.from('products').select(`id, nome${fiscalCols ? ', unidade' : ''}`).in('id', ids)
      : { data: [] as unknown[] };
    const prods = new Map(((prodsData || []) as unknown as Record<string, unknown>[]).map(p => [p.id as string, p]));
    itens = (itemsDb || []).map((i: Record<string, unknown>) => {
      const p = (prods.get(i.produto_id as string) || {}) as Record<string, unknown>;
      const q = Number(i.quantidade) || 0;
      const u = Number(i.preco_venda) || 0;
      return {
        descricao: String(p.nome || 'ITEM'),
        quantidade: q,
        unidade: fiscalCols && p.unidade ? String(p.unidade) : 'UN',
        valorUnitario: u,
        valorTotal: Math.round(q * u * 100) / 100,
      };
    });
  }

  const somaItens = Math.round(itens.reduce((a, it) => a + it.valorTotal, 0) * 100) / 100;
  const somaQtd = itens.reduce((a, it) => a + it.quantidade, 0);

  // Pagamentos: XML (tPag oficial + troco) > metodo da venda
  let pagamentos: DanfeFiscalData['pagamentos'];
  const troco = xml?.troco;
  if (xml?.pagamentos?.length) {
    pagamentos = xml.pagamentos.map(p => ({
      forma: TPAG_LABEL[String(p.tPag || '')] || String(p.tPag || 'PAGAMENTO'),
      valor: p.valor,
    }));
  } else {
    const tp = tpagDeMetodo(sale.metodo_pagamento as string);
    const valorTotalFiscal = xml?.totais?.valorTotal || foco?.total || Number(sale.valor_total) || 0;
    if (TPAG_LABEL[tp.forma]) {
      pagamentos = [{ forma: TPAG_LABEL[tp.forma], valor: Math.round(valorTotalFiscal * 100) / 100 }];
    }
  }

  // Regime tributario do emitente (mesma regra do lerEmitentePayload)
  const regime = emitentePayload.nome_emitente ? Number(emitentePayload.regime_tributario_emitente) || 1 : getFocusConfig().regime;

  // Chave: consultada na Focus > gravada no banco
  const chave = foco?.chave || soDig((s as Record<string, unknown>).nota_chave as string) || '';

  const cupom: DanfeFiscalData = {
    autorizada: foco ? foco.autorizada : sale.nota_status === 'AUTORIZADA',
    cancelada: foco ? foco.cancelada : sale.nota_status === 'CANCELADA',
    statusBruto: foco?.statusBruto || String(sale.nota_status || ''),
    contingencia: foco?.contingenciaOffline === true || xml?.tpEmis === '9',
    modelo,
    numero: String(xml?.numero || foco?.numero || sale.nota_numero || ''),
    serie: String(xml?.serie || foco?.serie || ''),
    chave,
    protocolo: xml?.protocolo || foco?.protocolo || '',
    dataAutorizacao: xml?.dataAutorizacao || foco?.dataAutorizacao || '',
    dataEmissao: xml?.dataEmissao || '',
    qrCode: xml?.qrCode || foco?.qrCode || '',
    emitente,
    destinatario,
    natureza: xml?.natureza || undefined,
    itens,
    quantidadeItens: Math.round(somaQtd * 1000) / 1000,
    valorProdutos: xml?.totais?.valorProdutos ?? somaItens,
    valorDesconto: xml?.totais?.valorDesconto || 0,
    valorTotal: xml?.totais?.valorTotal || foco?.total || Number(sale.valor_total) || somaItens,
    valorTributos: xml?.totais?.valorTributos,
    baseIcms: xml?.totais?.baseIcms || undefined,
    valorIcms: xml?.totais?.valorIcms || undefined,
    baseIcmsSt: xml?.totais?.baseIcmsSt || undefined,
    valorIcmsSt: xml?.totais?.valorIcmsSt || undefined,
    pagamentos,
    troco,
    informacoes: xml?.informacoes,
    simplesNacional: regime === 1,
    pdfUrl: foco?.pdfUrl || String(sale.nota_pdf_url || ''),
    fonte,
  };

  return NextResponse.json({ ok: true, cupom, aviso: aviso || undefined });
}
