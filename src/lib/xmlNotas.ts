import {
  gravarNoStorage,
  gravarMetaAvulsa,
  lerMetaAvulsa,
  caminhoArquivo,
  invalidaPresenca,
  NotaAvulsaMeta,
  MIME_XML,
  MIME_HTML,
} from './focusArquivos';
import { getServiceClient } from './serverSupabase';

/**
 * BLOCO 143 — IMPORTADOR DE XML EM LOTE (regra do dono):
 * "crie um botao para importar xml em lote, que entre automaticamente pq temos
 * notas de saidas que estao em outros sistemas de terceiros!"
 *
 * O admin seleciona (ou arrasta) varios XMLs no portal — de sistemas de
 * terceiros que ja bateram as notas. Esta lib:
 *  1. decodifica o arquivo (base64 do portal) respeitando o encoding declarado
 *     (UTF-8 / ISO-8859-1 — sistema terceiro costuma gravar latin1);
 *  2. classifica o XML: procNFe (nota autorizada), procEventoNFe (cancelamento
 *     de nota que ja temos) ou lixo (entrada, cupom, recibo...);
 *  3. nota de SAIDA autorizada (cStat 100/150) ou CANCELADA (101/135/151/155):
 *     arquiva o XML no bucket, GERA um DANFE imprimivel (HTML) porque a nota
 *     de terceiro nao tem PDF na Focus, e grava o JSON de metadados que
 *     alimenta a lista do portal (origem XML);
 *  4. evento de CANCELAMENTO (110111/110112): arquiva {chave}-can.xml e marca
 *     a avulsa como CANCELADA;
 *  5. duplicado (chave ja no sistema ou ja importada) e nota de ENTRADA sao
 *     ignorados com motivo claro — nunca duplica nem corrompe.
 *
 * Idempotente: rodar de novo com os mesmos XMLs devolve "duplicado" sem
 * gravar nada de novo.
 */

const TETO_ARQUIVOS = 50; // guarda-chuva por chamada (o portal envia em lotes)

export interface XmlLoteArquivo {
  nome: string;
  base64: string;
}

export interface XmlLoteResultado {
  nome: string;
  ok: boolean;
  tipo: 'SAIDA' | 'CANCELAMENTO' | 'DUPLICADO' | 'ENTRADA' | 'ILEGIVEL';
  mensagem: string;
  chave?: string;
  numero?: string;
  valor?: number;
  cliente?: string;
}

export interface XmlLoteResumo {
  recebidos: number;
  importados: number;
  cancelamentos: number;
  duplicados: number;
  entradas: number;
  ilegiveis: number;
  resultados: XmlLoteResultado[];
}

// ---------------------------------------------------------------------------
// decodificação (base64 -> texto com encoding correto)
// ---------------------------------------------------------------------------

function decodificarXml(bytes: Buffer): string {
  const cabecalho = bytes.subarray(0, 200).toString('latin1');
  const m = /encoding=["']([^"']+)["']/i.exec(cabecalho);
  const enc = (m?.[1] || 'utf-8').toLowerCase();
  if (/8859|latin|windows-1252|cp1252/.test(enc)) {
    return new TextDecoder('iso-8859-1').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// ---------------------------------------------------------------------------
// helpers de extração (mesmo estilo do focusArquivos — regex tolerante)
// ---------------------------------------------------------------------------

function blocoXml(texto: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(texto);
  return m ? m[1] : '';
}

function valorTag(bloco: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(bloco);
  return m ? m[1].trim() : '';
}

export interface XmlItemNota {
  codigo: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
}

export interface XmlNotaSaida {
  chave: string;
  numero: string;
  serie: string;
  modelo: 'NFE' | 'NFCE';
  tpNF: string;
  cStat: string;
  status: 'AUTORIZADO' | 'CANCELADO' | 'OUTRO';
  dataEmissao: string;
  dataAutorizacao: string;
  valor: number;
  cliente: string;
  clienteDoc: string;
  pagamento: string;
  emitente: string;
  emitenteCnpj: string;
  emitenteEndereco: string;
  clienteEndereco: string;
  natureza: string;
  itens: XmlItemNota[];
  protocolo: string;
  dataEvento?: string;
  motivoEvento?: string;
}

/** Parse completo de um procNFe autorizado (ou cancelado via cStat). */
function parseNotaSaida(xml: string): XmlNotaSaida | null {
  try {
    const chave = (/Id="NFe(\d{44})"/i.exec(xml) || [])[1] || (/(\d{44})/.exec(valorTag(xml, 'chNFe')) || [])[1] || '';
    if (!/^\d{44}$/.test(chave)) return null;

    const inf = blocoXml(xml, 'infNFe');
    const ide = blocoXml(inf || xml, 'ide');
    const emit = blocoXml(inf || xml, 'emit');
    const dest = blocoXml(inf || xml, 'dest');
    const tot = blocoXml(inf || xml, 'ICMSTot');
    const prot = blocoXml(xml, 'protNFe');
    const cStat = valorTag(prot, 'cStat') || valorTag(xml, 'cStat');

    const enderEmit = blocoXml(emit, 'enderEmit');
    const enderDest = blocoXml(dest, 'enderDest');

    // formas de pagamento
    const tPags = [...xml.matchAll(/<tPag>(\d{2})<\/tPag>/gi)].map((m) => m[1]);
    const mapaPag: Record<string, string> = {
      '01': 'DINHEIRO', '02': 'CHEQUE', '03': 'CARTAO_CREDITO', '04': 'CARTAO_DEBITO',
      '05': 'CREDITO_LOJA', '10': 'A_PRAZO', '11': 'CREDITO_LOJA', '13': 'CARTAO_DEBITO',
      '15': 'BOLETO', '16': 'DEPOSITO', '17': 'PIX', '90': 'SEM_PAGAMENTO', '91': 'A_PRAZO',
    };
    const pagamento = [...new Set(tPags.map((t) => mapaPag[t] || t))].join('+');

    // itens (det pode repetir)
    const itens: XmlItemNota[] = [];
    for (const m of xml.matchAll(/<det\s[^>]*nItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/gi)) {
      const prod = blocoXml(m[2], 'prod');
      if (!prod) continue;
      const qtd = Number(valorTag(prod, 'qCom').replace(',', '.')) || 0;
      const vUn = Number(valorTag(prod, 'vUnCom').replace(',', '.')) || 0;
      itens.push({
        codigo: valorTag(prod, 'cProd'),
        descricao: valorTag(prod, 'xProd').slice(0, 120),
        quantidade: qtd,
        unidade: valorTag(prod, 'uCom') || 'UN',
        valorUnitario: vUn,
        valorTotal: Number(valorTag(prod, 'vProd').replace(',', '.')) || qtd * vUn,
      });
    }

    const modelo = chave.slice(20, 22) === '65' ? 'NFCE' : 'NFE';
    const status: XmlNotaSaida['status'] = cStat === '100' || cStat === '150' ? 'AUTORIZADO'
      : cStat === '101' || cStat === '135' || cStat === '151' || cStat === '155' ? 'CANCELADO'
        : 'OUTRO';

    return {
      chave,
      numero: valorTag(ide, 'nNF'),
      serie: valorTag(ide, 'serie'),
      modelo,
      tpNF: valorTag(ide, 'tpNF'),
      cStat,
      status,
      dataEmissao: valorTag(ide, 'dhEmi') || valorTag(ide, 'dEmi'),
      dataAutorizacao: valorTag(prot, 'dhRecbto'),
      valor: Number(valorTag(tot, 'vNF').replace(',', '.')) || 0,
      cliente: (valorTag(dest, 'xNome') || 'CONSUMIDOR NAO IDENTIFICADO').slice(0, 120),
      clienteDoc: valorTag(dest, 'CNPJ') || valorTag(dest, 'CPF'),
      pagamento,
      emitente: valorTag(emit, 'xNome').slice(0, 120),
      emitenteCnpj: valorTag(emit, 'CNPJ'),
      emitenteEndereco: [
        valorTag(enderEmit, 'xLgr'), valorTag(enderEmit, 'nro'),
        valorTag(enderEmit, 'xBairro'), valorTag(enderEmit, 'xMun'),
        valorTag(enderEmit, 'UF'),
      ].filter(Boolean).join(', '),
      clienteEndereco: [
        valorTag(enderDest, 'xLgr'), valorTag(enderDest, 'nro'),
        valorTag(enderDest, 'xBairro'), valorTag(enderDest, 'xMun'),
        valorTag(enderDest, 'UF'),
      ].filter(Boolean).join(', '),
      natureza: valorTag(ide, 'natOp'),
      itens,
      protocolo: valorTag(prot, 'nProt'),
    };
  } catch {
    return null;
  }
}

/** Parse de procEventoNFe (cancelamento/homologação) — devolve chave + tpEvento. */
function parseEventoCancelamento(xml: string): { chave: string; tpEvento: string; data: string; motivo: string } | null {
  const chave = valorTag(xml, 'chNFe').replace(/\D/g, '');
  if (!/^\d{44}$/.test(chave)) return null;
  const tpEvento = valorTag(xml, 'tpEvento');
  if (!tpEvento) return null;
  const infEvento = blocoXml(xml, 'infEvento') || xml;
  return {
    chave,
    tpEvento,
    data: valorTag(infEvento, 'dhEvento'),
    motivo: valorTag(infEvento, 'xEvento') || valorTag(infEvento, 'descEvento') || 'Cancelamento',
  };
}

// ---------------------------------------------------------------------------
// DANFE imprimível (HTML) — a nota de terceiro não tem PDF na Focus
// ---------------------------------------------------------------------------

export function gerarDanfeHtml(n: XmlNotaSaida): string {
  const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const fmtData = (iso: string) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    } catch { return iso; }
  };
  const docFmt = n.clienteDoc.length === 14
    ? n.clienteDoc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    : n.clienteDoc.length === 11
      ? n.clienteDoc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : n.clienteDoc || '—';
  const chaveFmt = n.chave.replace(/(\d{4})(?=\d)/g, '$1 ');
  const itensHtml = n.itens.length > 0
    ? n.itens.map((it, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="cod">${esc(it.codigo)}</td>
          <td>${esc(it.descricao)}</td>
          <td class="num">${it.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${esc(it.unidade)}</td>
          <td class="num">${brl(it.valorUnitario)}</td>
          <td class="num">${brl(it.valorTotal)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="text-align:center;color:#999">Itens não detalhados no XML</td></tr>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>DANFE ${n.modelo === 'NFCE' ? 'NFC-e' : 'NF-e'} nº ${esc(n.numero)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 24px; }
  .cab { display: flex; gap: 12px; border: 1px solid #333; }
  .cab .emit { flex: 1; padding: 10px; border-right: 1px solid #333; }
  .cab .doc { width: 220px; padding: 10px; text-align: center; }
  .doc .titulo { font-size: 20px; font-weight: 900; letter-spacing: 1px; }
  .doc .modelo { font-size: 11px; color: #555; }
  .banda { border: 1px solid #333; border-top: 0; padding: 6px 10px; font-size: 10px; display: flex; flex-wrap: wrap; gap: 4px 18px; }
  .banda b { margin-right: 3px; }
  h3 { font-size: 10px; margin: 14px 0 4px; padding: 4px 8px; background: #eee; border: 1px solid #333; text-transform: uppercase; letter-spacing: .5px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  th { background: #f2f2f2; font-size: 9px; text-transform: uppercase; }
  td.num, th.num { text-align: right; }
  td.cod { font-family: monospace; }
  .totais { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333; padding: 8px 12px; font-size: 13px; }
  .totais .valor { font-size: 18px; font-weight: 900; }
  .chave { margin-top: 10px; border: 1px solid #333; padding: 8px 12px; font-family: monospace; font-size: 12px; letter-spacing: 1px; text-align: center; }
  .rodape { margin-top: 8px; font-size: 9px; color: #555; display: flex; justify-content: space-between; }
  .cancelada { margin-top: 10px; background: #fee2e2; border: 1px solid #ef4444; color: #b91c1c; padding: 8px 12px; font-weight: 900; text-transform: uppercase; text-align: center; letter-spacing: 1px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <div class="cab">
    <div class="emit">
      <div style="font-weight:900;font-size:14px">${esc(n.emitente || 'EMITENTE')}</div>
      <div>CNPJ: ${esc(n.emitenteCnpj || '—')}</div>
      <div>${esc(n.emitenteEndereco || '—')}</div>
    </div>
    <div class="doc">
      <div class="titulo">DANFE</div>
      <div class="modelo">Documento Auxiliar de ${n.modelo === 'NFCE' ? 'Cupom Fiscal Eletrônico — NFC-e' : 'Nota Fiscal Eletrônica — NF-e'}</div>
      <div style="margin-top:6px;font-size:16px;font-weight:900">Nº ${esc(n.numero || '—')}</div>
      <div style="font-size:10px">Série ${esc(n.serie || '—')} · ${n.modelo === 'NFCE' ? 'NFC-e' : 'NF-e'}</div>
    </div>
  </div>
  <div class="banda">
    <span><b>Natureza:</b>${esc(n.natureza || '—')}</span>
    <span><b>Emissão:</b>${fmtData(n.dataEmissao)}</span>
    <span><b>Autorização:</b>${fmtData(n.dataAutorizacao)}</span>
    <span><b>Protocolo:</b>${esc(n.protocolo || '—')}</span>
  </div>
  <h3>Destinatário</h3>
  <div class="banda">
    <span><b>Nome:</b>${esc(n.cliente)}</span>
    <span><b>CPF/CNPJ:</b>${esc(docFmt)}</span>
    <span><b>Endereço:</b>${esc(n.clienteEndereco || '—')}</span>
  </div>
  <h3>Pagamento</h3>
  <div class="banda"><span><b>Forma:</b>${esc((n.pagamento || '—').replace(/_/g, ' '))}</span></div>
  <h3>Produtos (${n.itens.length} item${n.itens.length === 1 ? '' : 'ens'})</h3>
  <table>
    <thead><tr><th style="width:24px">#</th><th style="width:70px">Código</th><th>Descrição</th><th class="num" style="width:110px">Qtd.</th><th class="num" style="width:90px">Vl. Unit.</th><th class="num" style="width:90px">Vl. Total</th></tr></thead>
    <tbody>${itensHtml}</tbody>
  </table>
  <div class="totais"><span>TOTAL DA NOTA</span><span class="valor">${brl(n.valor)}</span></div>
  ${n.status === 'CANCELADO' ? '<div class="cancelada">NOTA CANCELADA NA SEFAZ</div>' : ''}
  <div class="chave">CHAVE DE ACESSO<br>${chaveFmt}</div>
  <div class="rodape">
    <span>Consulte pela chave em ${n.modelo === 'NFCE' ? 'sefaz.rs.gov.br/nfce' : 'sefaz.rs.gov.br/nfe'} — Consulta de Autenticidade</span>
    <span>Importado por XML (sistema de terceiros) · Portal Doce Mania</span>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// importador principal
// ---------------------------------------------------------------------------

/** Chaves que o sistema já conhece (sales.nota_chave) — nota do app não duplica. */
async function chavesDeVendas(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const db = getServiceClient();
    for (let range = 0; range < 5000; range += 1000) {
      const { data, error } = await db
        .from('sales')
        .select('nota_chave')
        .not('nota_chave', 'is', null)
        .range(range, range + 999);
      if (error || !data) break;
      for (const r of (data as unknown) as { nota_chave: string }[]) {
        const c = String(r.nota_chave || '').replace(/\D/g, '').slice(-44);
        if (c.length === 44) set.add(c);
      }
      if ((data as unknown[]).length < 1000) break;
    }
  } catch { /* banco fora — segue (o storage decide) */ }
  return set;
}

export async function importarLoteXml(arquivos: XmlLoteArquivo[]): Promise<XmlLoteResumo> {
  const resumo: XmlLoteResumo = {
    recebidos: Math.min(arquivos.length, TETO_ARQUIVOS),
    importados: 0,
    cancelamentos: 0,
    duplicados: 0,
    entradas: 0,
    ilegiveis: 0,
    resultados: [],
  };

  if (arquivos.length === 0) return resumo;
  const conhecidas = await chavesDeVendas();

  for (const arq of arquivos.slice(0, TETO_ARQUIVOS)) {
    const nome = String(arq.nome || 'xml').slice(0, 120);
    try {
      const bytes = Buffer.from(String(arq.base64 || ''), 'base64');
      if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) {
        resumo.ilegiveis++;
        resumo.resultados.push({ nome, ok: false, tipo: 'ILEGIVEL', mensagem: 'Arquivo vazio ou maior que 15 MB.' });
        continue;
      }
      const xml = decodificarXml(bytes);

      // XML de EVENTO (cancelamento) — não é nota
      const ev = parseEventoCancelamento(xml);
      if (ev) {
        const doc = ev.chave.slice(20, 22) === '65' ? 'nfce' : 'nfe';
        const meta = await lerMetaAvulsa(ev.chave);
        if (!meta) {
          resumo.duplicados++;
          resumo.resultados.push({ nome, ok: true, tipo: 'DUPLICADO', mensagem: 'Cancelamento de nota que não está no sistema (importada? busque na Focus).', chave: ev.chave });
          continue;
        }
        const salvoCan = await gravarNoStorage(caminhoArquivo(doc, meta.ref, 'xml-cancelamento'), bytes, MIME_XML);
        if (salvoCan) {
          meta.status = 'CANCELADO';
          await gravarMetaAvulsa(meta);
        }
        resumo.cancelamentos += salvoCan ? 1 : 0;
        resumo.resultados.push({
          nome, ok: salvoCan, tipo: 'CANCELAMENTO',
          mensagem: salvoCan ? `Cancelamento registrado na nota nº ${meta.numero || ev.chave.slice(-6)}.` : 'Falha ao gravar o XML de cancelamento.',
          chave: ev.chave, numero: meta.numero,
        });
        continue;
      }

      // XML de NOTA — precisa de protocolo de autorização
      const nota = parseNotaSaida(xml);
      if (!nota) {
        resumo.ilegiveis++;
        resumo.resultados.push({ nome, ok: false, tipo: 'ILEGIVEL', mensagem: 'XML ilegível — não é NF-e/NFC-e de saída com chave válida.' });
        continue;
      }
      if (!nota.cStat || nota.status === 'OUTRO') {
        resumo.ilegiveis++;
        resumo.resultados.push({ nome, ok: false, tipo: 'ILEGIVEL', mensagem: `XML sem protocolo de autorização da SEFAZ (cStat ${nota.cStat || 'ausente'}) — só entra nota AUTORIZADA ou CANCELADA.`, chave: nota.chave });
        continue;
      }
      if (nota.tpNF === '0') {
        resumo.entradas++;
        resumo.resultados.push({ nome, ok: false, tipo: 'ENTRADA', mensagem: 'Nota de ENTRADA (compra) — o portal importa somente notas de SAÍDA.', chave: nota.chave, numero: nota.numero });
        continue;
      }
      if (conhecidas.has(nota.chave)) {
        resumo.duplicados++;
        resumo.resultados.push({ nome, ok: true, tipo: 'DUPLICADO', mensagem: 'Já existe no sistema (nota de venda do app).', chave: nota.chave, numero: nota.numero });
        continue;
      }
      const metaExistente = await lerMetaAvulsa(nota.chave);
      if (metaExistente) {
        resumo.duplicados++;
        resumo.resultados.push({ nome, ok: true, tipo: 'DUPLICADO', mensagem: 'Já importada pelo portal (nº ' + (metaExistente.numero || '?') + ').', chave: nota.chave, numero: nota.numero });
        continue;
      }

      const doc = nota.modelo === 'NFCE' ? ('nfce' as const) : ('nfe' as const);
      const danfeHtml = gerarDanfeHtml(nota);
      const [xmlOk, pdfOk] = await Promise.all([
        gravarNoStorage(caminhoArquivo(doc, nota.chave, 'xml'), bytes, MIME_XML),
        gravarNoStorage(caminhoArquivo(doc, nota.chave, 'pdf', 'html'), Buffer.from(danfeHtml), MIME_HTML),
      ]);
      const meta: NotaAvulsaMeta = {
        ref: nota.chave,
        doc: nota.modelo,
        numero: nota.numero,
        serie: nota.serie,
        status: nota.status,
        chave: nota.chave,
        dataEmissao: nota.dataEmissao,
        dataAutorizacao: nota.dataAutorizacao || nota.dataEmissao,
        valor: nota.valor,
        cliente: nota.cliente,
        clienteDoc: nota.clienteDoc,
        pagamento: nota.pagamento,
        qrcodeUrl: '',
        importadoEm: new Date().toISOString(),
        origem: 'XML',
        emitente: nota.emitente,
        emitenteCnpj: nota.emitenteCnpj,
      };
      const metaOk = await gravarMetaAvulsa(meta);
      if (!xmlOk && !pdfOk && !metaOk) {
        resumo.ilegiveis++;
        resumo.resultados.push({ nome, ok: false, tipo: 'ILEGIVEL', mensagem: 'Falha ao gravar no sistema (storage).', chave: nota.chave });
        continue;
      }
      resumo.importados++;
      resumo.resultados.push({
        nome, ok: true, tipo: 'SAIDA',
        mensagem: `${nota.modelo === 'NFCE' ? 'NFC-e' : 'NF-e'} nº ${nota.numero || '?'} — ${nota.cliente} (${nota.status === 'CANCELADO' ? 'CANCELADA' : 'AUTORIZADA'})`,
        chave: nota.chave, numero: nota.numero, valor: nota.valor, cliente: nota.cliente,
      });
    } catch (e) {
      resumo.ilegiveis++;
      resumo.resultados.push({ nome, ok: false, tipo: 'ILEGIVEL', mensagem: (e as Error).message || 'Erro inesperado.' });
    }
  }

  invalidaPresenca();
  return resumo;
}
