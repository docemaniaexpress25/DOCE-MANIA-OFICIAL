import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * EXCLUIR CLIENTE (Bloco 12)
 *
 * POST /api/clientes/excluir  { clientId }
 *
 * Antes o admin excluia direto pelo browser com a chave anon — o RLS
 * bloqueava o DELETE e "o admin nao consegue excluir clientes".
 * Aqui: sessao obrigatoria, somente ADMIN, e exclusao com service role.
 *
 * Cliente com vendas no historico (FK sales.client_id) NAO pode ser
 * excluido sem destruir o financeiro — nesse caso o cliente e DESATIVADO
 * e a resposta explica o motivo.
 */

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, erro: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }
  if (session.perfil !== 'ADMIN') {
    return NextResponse.json({ ok: false, erro: 'Somente o admin pode excluir clientes.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = String(body.clientId || '');
  if (!clientId) {
    return NextResponse.json({ ok: false, erro: 'Cliente nao informado.' }, { status: 400 });
  }

  try {
    const db = getServiceClient();

    const { data: client, error: selErr } = await db
      .from('clients')
      .select('id, nome_fantasia')
      .eq('id', clientId)
      .maybeSingle();

    if (selErr) {
      return NextResponse.json({ ok: false, erro: 'Erro ao consultar o cliente.', detalhe: selErr.message }, { status: 500 });
    }
    if (!client) {
      return NextResponse.json({ ok: false, erro: 'Cliente nao encontrado (ja excluido?).' }, { status: 404 });
    }

    const { error: delErr } = await db.from('clients').delete().eq('id', clientId);

    if (!delErr) {
      return NextResponse.json({ ok: true, excluido: true });
    }

    // FK violation: cliente tem vendas/comissoes vinculadas
    if (delErr.code === '23503' || /foreign key/i.test(delErr.message || '')) {
      const { error: updErr } = await db.from('clients').update({ ativo: false }).eq('id', clientId);
      if (updErr) {
        return NextResponse.json(
          { ok: false, erro: 'Cliente tem vendas no historico e nao pôde ser desativado automaticamente.' },
          { status: 500 }
        );
      }
      return NextResponse.json({
        ok: false,
        desativado: true,
        erro: `"${client.nome_fantasia || 'Cliente'}" tem vendas no histórico, então não pode ser excluído (o financeiro depende delas). Ele foi DESATIVADO e sai de todas as listas.`,
      });
    }

    return NextResponse.json({ ok: false, erro: delErr.message || 'Erro ao excluir o cliente.' }, { status: 500 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, erro: 'Erro ao excluir o cliente.', detalhe: msg }, { status: 500 });
  }
}
