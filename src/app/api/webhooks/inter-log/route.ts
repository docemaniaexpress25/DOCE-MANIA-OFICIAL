import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';
import { isInterConfigured } from '@/lib/interBoleto';

/**
 * BLOCO 167 — LOG DO WEBHOOK DO INTER (admin/secretario).
 * GET /api/webhooks/inter-log  -> últimos 60 eventos recebidos do Inter:
 * { ok, configurado, eventos: [{ id, criadoEm, codigo, seuNumero, saleId,
 *                                resultado, processado }] }
 * Fonte: tabela webhook_logs (SQL 167, RLS fechada — service_role).
 * UI: Configurações > ERP Fiscal & Automações > Boletos > "Log de eventos do
 * webhook". Complementa o log textual de recebimentos em sales.detalhe_pagamento.
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!isAdminSession(req) && session.perfil !== 'SECRETARIO') {
    return NextResponse.json({ ok: false, error: 'Somente admin/secretario veem o log do webhook.' }, { status: 403 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from('webhook_logs')
    .select('id, criado_em, origem, codigo, seu_numero, sale_id, resultado, processado')
    .order('criado_em', { ascending: false })
    .limit(60);

  if (error) {
    const msg = String(error.message || '');
    if (error.code === '42P01' || /webhook_logs|does not exist|schema cache/i.test(msg)) {
      return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 167 (tabela webhook_logs).' }, { status: 503 });
    }
    console.error('[api/webhooks/inter-log] erro:', msg);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar o log.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    configurado: isInterConfigured(),
    eventos: (data || []).map((e: any) => ({
      id: e.id,
      criadoEm: e.criado_em,
      origem: e.origem,
      codigo: e.codigo,
      seuNumero: e.seu_numero,
      saleId: e.sale_id,
      resultado: e.resultado,
      processado: !!e.processado,
    })),
  });
}
