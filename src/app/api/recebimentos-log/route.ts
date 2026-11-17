import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';

/**
 * BLOCO 172 — LOG DE PAGAMENTOS E RECEBIMENTOS (quem deu baixa e de onde veio).
 * GET /api/recebimentos-log  [admin/secretário]
 *   → { ok, recebimentos: [{ id, baixaEm, baixaOrigem, valor,
 *         metodo, cliente, detalhe }] }
 *
 * Fonte: sales com baixa_origem preenchida (SQL 172), mais recentes primeiro.
 * Origens:
 *   WEBHOOK_INTER = automático (webhook do Inter em tempo real)
 *   CRON_INTER    = automático (sync diário do Inter)
 *   MANUAL        = alguém deu baixa no app ("por NOME" fica no detalhe)
 *   PIX_PORTAL    = comprovante do portal do cliente confirmado pelo admin
 *   PDV           = venda à vista (nasce paga no PDV)
 * Null = pago antes do log existir (não inventa histórico).
 *
 * UI: Configurações > ERP Fiscal & Automações > Boletos > "Log de pagamentos e
 * recebimentos" — complementa o log de eventos do webhook (inter-log).
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!isAdminSession(req) && session.perfil !== 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Somente admin/secretario veem o log de recebimentos.' }, { status: 403 });
  }

  const db = getServiceClient();

  // 1. Últimas 40 vendas PAGO com origem da baixa (mais recentes primeiro)
  const { data: sales, error } = await db
    .from('sales')
    .select('id, baixa_em, baixa_origem, valor_total, metodo_pagamento, detalhe_pagamento, client_id')
    .not('baixa_origem', 'is', null)
    .order('baixa_em', { ascending: false })
    .limit(40);

  if (error) {
    const msg = String(error.message || '');
    // SQL 172 ainda não rodou (colunas ausentes) — mensagem clara, não 500
    if (error.code === '42703' || /baixa_origem|does not exist|schema cache/i.test(msg)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 172 (colunas baixa_origem/baixa_em).' }, { status: 503 });
    }
    console.error('[api/recebimentos-log] erro:', msg);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar o log de recebimentos.' }, { status: 500 });
  }

  // 2. Nomes dos clientes (uma query só, montada em mapa)
  const clientIds = [...new Set((sales || []).map((s: any) => String(s.client_id || '')).filter(Boolean))];
  const nomes = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clients } = await db
      .from('clients')
      .select('id, nome, nome_fantasia')
      .in('id', clientIds);
    (clients || []).forEach((c: any) => {
      nomes.set(String(c.id), String(c.nome_fantasia || c.nome || '').trim() || 'Cliente');
    });
  }

  return NextResponse.json({
    ok: true,
    recebimentos: (sales || []).map((s: any) => ({
      id: s.id,
      baixaEm: s.baixa_em,
      baixaOrigem: String(s.baixa_origem || ''),
      valor: Number(s.valor_total) || 0,
      metodo: String(s.metodo_pagamento || ''),
      cliente: nomes.get(String(s.client_id || '')) || 'Cliente',
      detalhe: String(s.detalhe_pagamento || '').slice(-260),
    })),
  });
}
