import { NextRequest, NextResponse } from 'next/server';
import { isServerSupabaseConfigured, devBridge, getServiceClient } from '@/lib/serverSupabase';
import { verifyShareToken } from '@/lib/shareLinks';
import { respostaArquivoNota, TipoServe } from '@/lib/notasArquivo';
import { hasNotaColumns } from '@/lib/serverSchema';
import { FocusDoc } from '@/lib/focusNfe';

/**
 * PORTA DO CLIENTE — download do DANFE/XML por LINK ASSINADO (WhatsApp).
 *
 * O dono compartilha os documentos da nota com o CLIENTE pelo WhatsApp. Não
 * podemos mandar o token de sessão do admin na URL — esta rota aceita apenas
 * o token HMAC do src/lib/shareLinks.ts, que:
 *  - autoriza SOMENTE os arquivos de UMA nota (saleId ou ref+doc);
 *  - EXPIRA em 7 dias (exp no payload);
 *  - não dá acesso a NADA além do download do arquivo daquela nota.
 *
 *   GET /api/notas-compartilhar?token={body.sig}&tipo=pdf|xml
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }

  const sp = req.nextUrl.searchParams;
  const payload = verifyShareToken(sp.get('token') || '');
  if (!payload) return BAD(403, 'Link de compartilhamento invalido ou expirado. Peça um novo link ao vendedor.');

  const tipoParam = (sp.get('tipo') || 'pdf').toLowerCase();
  const tipo: TipoServe = tipoParam === 'xml' ? 'xml' : tipoParam === 'xml-cancelamento' ? 'xml-cancelamento' : 'pdf';

  // por VENDA (token nasce do saleId)
  if (payload.saleId) {
    if (!(await hasNotaColumns())) return BAD(503, 'Schema antigo — rode o SQL do Bloco 10 (docs/NOTAS-FISCAIS.md).');
    const { data: sale, error } = await getServiceClient()
      .from('sales')
      .select('id, client_id, nota_ref, nota_tipo, nota_numero')
      .eq('id', payload.saleId)
      .single();
    if (error || !sale) return BAD(404, 'Venda nao encontrada.');
    const ref = String(sale.nota_ref || '');
    if (!ref) return BAD(422, 'Esta venda ainda nao tem nota emitida.');
    const doc: FocusDoc = String(sale.nota_tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe';
    return await respostaArquivoNota(doc, ref, tipo, String(sale.nota_numero || ''), sale.client_id as string);
  }

  // por REF (nota avulsa do portal)
  if (payload.ref && payload.doc) {
    const refSan = payload.ref.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120);
    const doc: FocusDoc = payload.doc === 'nfce' ? 'nfce' : 'nfe';
    return await respostaArquivoNota(doc, refSan, tipo, '', null);
  }

  return BAD(400, 'Token sem nota associada.');
}
