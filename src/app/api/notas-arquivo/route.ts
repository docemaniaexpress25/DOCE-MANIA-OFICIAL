import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest, verifySessionToken } from '@/lib/session';
import { hasNotaColumns } from '@/lib/serverSchema';
import { lerArquivoNota, coletarArquivosNota, caminhoArquivo, invalidaPresenca } from '@/lib/focusArquivos';
import { FocusDoc } from '@/lib/focusNfe';

/**
 * BLOCO 141 — SERVE O PDF (DANFE) E O XML DENTRO DO NOSSO SISTEMA.
 *
 * O dono pediu: "quero que acesse o portal da focus e me traga o pdf e xml
 * das notas atraves da api! salve dentro do nosso sistema". Esta rota e a
 * porta de saida dos arquivos arquivados no bucket `notas-fiscais`:
 *
 *   GET /api/notas-arquivo?saleId={id}&tipo=pdf|xml|xml-cancelamento
 *   GET /api/notas-arquivo?ref={ref}&doc=nfe|nfce&tipo=...      (avulsa)
 *
 * Fluxo: 1) procura no NOSSO storage; 2) nao tem? busca na Focus na hora e
 * ARQUIVA (a proxima chamada ja sai do nosso sistema). Sessao obrigatoria:
 * ADMIN ve tudo; vendedor so as notas das PROPRIAS vendas (mesma regra do
 * /api/notas). Nome do arquivo amigavel: NFe-22-CLIENTE.pdf.
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

function nomeSeguro(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}

function resposta(a: { bytes: Buffer; contentType: string; ext: 'pdf' | 'html' | 'xml' }, prefixo: string, numero: string, cliente: string): NextResponse {
  const rotulo = prefixo.toUpperCase();
  const quem = cliente ? `-${nomeSeguro(cliente)}` : '';
  const nome = `${rotulo}${numero ? `-${numero}` : ''}${quem}.${a.ext}`;
  const body = new Uint8Array(a.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': a.contentType,
      'Content-Disposition': `inline; filename="${nome}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function GET(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde e a producao.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }
  // Sessao: header Authorization OU token na query (os links <a> de download do
  // portal nao carregam header — BLOCO 142: sem isso o clique dava 401).
  const sp0 = req.nextUrl.searchParams;
  const session = sessionFromRequest(req) || verifySessionToken(sp0.get('token') || '');
  if (!session) return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');

  const sp = req.nextUrl.searchParams;
  const tipoParam = (sp.get('tipo') || 'pdf').toLowerCase();
  const tipo = tipoParam === 'xml' ? 'xml' : tipoParam === 'xml-cancelamento' ? 'xml-cancelamento' : 'pdf';

  const saleId = sp.get('saleId') || '';
  const refParam = sp.get('ref') || '';
  const docParam = (sp.get('doc') || '').toLowerCase();

  // ---------------- por VENDA (nota ligada a uma sale) ----------------
  if (saleId) {
    if (!(await hasNotaColumns())) return BAD(503, 'Schema antigo — rode o SQL do Bloco 10 (docs/NOTAS-FISCAIS.md).');
    const db = getServiceClient();
    const { data: sale, error } = await db
      .from('sales')
      .select('id, vendedor_id, client_id, nota_ref, nota_tipo, nota_numero')
      .eq('id', saleId)
      .single();
    if (error || !sale) return BAD(404, 'Venda nao encontrada.');
    if (session.perfil !== 'ADMIN' && session.sub !== sale.vendedor_id) {
      return BAD(403, 'Voce so pode baixar os arquivos das suas proprias vendas.');
    }
    const ref = String(sale.nota_ref || '');
    if (!ref) return BAD(422, 'Esta venda ainda nao tem nota emitida.');
    const doc: FocusDoc = String(sale.nota_tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe';
    return await serve(doc, ref, tipo, String(sale.nota_numero || ''), sale.client_id as string);
  }

  // ---------------- por REF (nota avulsa do portal) ----------------
  if (refParam) {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa notas avulsas.');
    const doc: FocusDoc = docParam === 'nfce' ? 'nfce' : 'nfe';
    const refSan = refParam.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
    return await serve(doc, refSan, tipo, '', null);
  }

  return BAD(400, 'Parametros ausentes (saleId ou ref+doc).');
}

/** 1o nosso storage, 2o Focus (arquivando), 3o erro claro. */
async function serve(doc: FocusDoc, ref: string, tipo: 'pdf' | 'xml' | 'xml-cancelamento', numero: string, client_id: string | null): Promise<NextResponse> {
  // 1. NOSSO sistema (pdf tenta .pdf e depois .html do DANFCe)
  const candidatos: string[] = [];
  if (tipo === 'pdf') candidatos.push(caminhoArquivo(doc, ref, 'pdf', 'pdf'), caminhoArquivo(doc, ref, 'pdf', 'html'));
  else if (tipo === 'xml') candidatos.push(caminhoArquivo(doc, ref, 'xml'));
  else candidatos.push(caminhoArquivo(doc, ref, 'xml-cancelamento'));
  for (const c of candidatos) {
    const a = await lerArquivoNota(c);
    if (a) {
      const { cliente } = await nomeCliente(client_id);
      return resposta(a, doc === 'nfce' ? 'NFCe' : 'NFe', numero, cliente);
    }
  }
  // 2. Focus agora + arquiva (o proximo download ja e local)
  const coleta = await coletarArquivosNota(doc, ref);
  invalidaPresenca();
  if (!coleta.ok) return BAD(502, `Falha ao buscar na Focus NFe: ${coleta.motivo || 'erro desconhecido'}`);
  if (coleta.semArquivo) return BAD(409, `Nota ${coleta.status || 'processando'} — sem arquivo na SEFAZ ainda.`);
  for (const c of candidatos) {
    const a = await lerArquivoNota(c);
    if (a) {
      const { cliente } = await nomeCliente(client_id);
      return resposta(a, doc === 'nfce' ? 'NFCe' : 'NFe', coleta.numero || numero, cliente);
    }
  }
  return BAD(404, 'Arquivo nao disponivel nem no sistema nem na Focus. Consulte a nota e tente de novo.');
}

async function nomeCliente(client_id: string | null): Promise<{ cliente: string }> {
  if (!client_id) return { cliente: '' };
  try {
    const { data } = await getServiceClient().from('clients').select('nome_fantasia, nome, razao_social').eq('id', client_id).single();
    const c = (data || {}) as Record<string, unknown>;
    return { cliente: String(c.nome_fantasia || c.nome || c.razao_social || '') };
  } catch {
    return { cliente: '' };
  }
}
