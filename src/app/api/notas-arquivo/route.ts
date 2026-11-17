import { NextRequest, NextResponse } from 'next/server';
import { isServerSupabaseConfigured, devBridge, getServiceClient } from '@/lib/serverSupabase';
// BLOCO 170: getServiceClient faltava no import — ReferenceError em RUNTIME
// (build passa por ignoreBuildErrors) e TODO clique no PDF/XML de nota de
// VENDA (caminho saleId) dava erro 500 no portal /notas. Notas avulsas não
// quebravam porque respostaArquivoNota cria o client dentro do próprio lib.
import { sessionFromRequest, verifySessionToken } from '@/lib/session';
import { hasNotaColumns } from '@/lib/serverSchema';
import { respostaArquivoNota, TipoServe } from '@/lib/notasArquivo';
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
 * Fluxo (implementado em src/lib/notasArquivo.ts): 1) procura no NOSSO
 * storage; 2) nao tem? busca na Focus na hora e ARQUIVA. Sessao obrigatoria:
 * ADMIN ve tudo; vendedor so as notas das PROPRIAS vendas (mesma regra do
 * /api/notas). Nome do arquivo amigavel: NFe-22-CLIENTE.pdf.
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

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
  const tipo: TipoServe = tipoParam === 'xml' ? 'xml' : tipoParam === 'xml-cancelamento' ? 'xml-cancelamento' : 'pdf';

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
    return await respostaArquivoNota(doc, ref, tipo, String(sale.nota_numero || ''), sale.client_id as string);
  }

  // ---------------- por REF (nota avulsa do portal) ----------------
  if (refParam) {
    if (session.perfil !== 'ADMIN') return BAD(403, 'Somente o admin acessa notas avulsas.');
    const doc: FocusDoc = docParam === 'nfce' ? 'nfce' : 'nfe';
    const refSan = refParam.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
    return await respostaArquivoNota(doc, refSan, tipo, '', null);
  }

  return BAD(400, 'Parametros ausentes (saleId ou ref+doc).');
}
