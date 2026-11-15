import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverSupabase';
import { lerArquivoNota, coletarArquivosNota, caminhoArquivo, invalidaPresenca } from '@/lib/focusArquivos';
import { FocusDoc } from '@/lib/focusNfe';

/**
 * SERVE O PDF (DANFE) E O XML ARQUIVADOS NO NOSSO SISTEMA — lógica única usada
 * por DUAS portas de saída:
 *  - GET /api/notas-arquivo        (sessão ADMIN/vendedor — portal e app)
 *  - GET /api/notas-compartilhar   (token assinado — link de WhatsApp p/ o cliente)
 *
 * Fluxo: 1) procura no NOSSO storage; 2) não tem? busca na Focus na hora e
 * ARQUIVA (a próxima chamada já sai do nosso sistema); 3) erro claro.
 */

export type TipoServe = 'pdf' | 'xml' | 'xml-cancelamento';

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

/** 1º nosso storage, 2º Focus (arquivando), 3º erro claro. */
export async function respostaArquivoNota(
  doc: FocusDoc,
  ref: string,
  tipo: TipoServe,
  numero: string,
  client_id: string | null,
): Promise<NextResponse> {
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
  if (!coleta.ok) {
    return NextResponse.json({ ok: false, erro: `Falha ao buscar na Focus NFe: ${coleta.motivo || 'erro desconhecido'}` }, { status: 502 });
  }
  if (coleta.semArquivo) {
    return NextResponse.json({ ok: false, erro: `Nota ${coleta.status || 'processando'} — sem arquivo na SEFAZ ainda.` }, { status: 409 });
  }
  for (const c of candidatos) {
    const a = await lerArquivoNota(c);
    if (a) {
      const { cliente } = await nomeCliente(client_id);
      return resposta(a, doc === 'nfce' ? 'NFCe' : 'NFe', coleta.numero || numero, cliente);
    }
  }
  return NextResponse.json({ ok: false, erro: 'Arquivo nao disponivel nem no sistema nem na Focus. Consulte a nota e tente de novo.' }, { status: 404 });
}
