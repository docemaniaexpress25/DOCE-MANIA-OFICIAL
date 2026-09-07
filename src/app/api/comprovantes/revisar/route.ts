import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';

/**
 * POST /api/comprovantes/revisar   [ADMIN]
 * Body: { id: string, acao: 'CONFIRMAR' | 'REJEITAR', reviewNote?: string }
 *
 * - CONFIRMAR: baixa o pagamento na venda (valor_pago += valor;
 *   status_pagamento = PAGO quando quitada) e registra o log no
 *   detalhe_pagamento (mesmo padrao usado pelos recebimentos manuais).
 * - REJEITAR: mantem a divida em aberto e guarda o motivo — o cliente
 *   ve o status no portal.
 */
export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Nao autorizado. Faca login novamente.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const id = String(body?.id || '');
    const acao = String(body?.acao || '').toUpperCase();
    const reviewNote = String(body?.reviewNote || '').slice(0, 200) || null;

    if (!id || !['CONFIRMAR', 'REJEITAR'].includes(acao)) {
      return NextResponse.json({ error: 'Parametros invalidos.' }, { status: 400 });
    }

    const supabase = getServiceClient();

    // 1. Comprovante
    const { data: comp, error: compErr } = await supabase
      .from('payment_comprovantes')
      .select('id, sale_id, client_id, valor, status')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (compErr) throw compErr;
    if (!comp) return NextResponse.json({ error: 'Comprovante nao encontrado.' }, { status: 404 });
    if (comp.status !== 'PENDENTE') {
      return NextResponse.json({ error: 'Este comprovante ja foi revisado.' }, { status: 400 });
    }

    if (acao === 'REJEITAR') {
      const { error: upErr } = await supabase
        .from('payment_comprovantes')
        .update({ status: 'REJEITADO', review_note: reviewNote, reviewed_at: new Date().toISOString() })
        .eq('id', id);
      if (upErr) throw upErr;
      return NextResponse.json({ ok: true, status: 'REJEITADO' });
    }

    // 2. CONFIRMAR: baixa na venda
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .select('id, valor_total, valor_pago, status_pagamento, detalhe_pagamento')
      .eq('id', comp.sale_id)
      .limit(1)
      .maybeSingle();
    if (saleErr) throw saleErr;
    if (!sale) return NextResponse.json({ error: 'Venda vinculada nao encontrada.' }, { status: 404 });

    const total = Math.round(Number(sale.valor_total || 0) * 100) / 100;
    const pagoAntes = Math.round(Number(sale.valor_pago || 0) * 100) / 100;
    const novoPago = Math.min(total, Math.round((pagoAntes + Number(comp.valor || 0)) * 100) / 100);
    const quitada = novoPago >= total - 0.009;

    const logEntry = `PIX PORTAL R$ ${Number(comp.valor).toFixed(2)} em ${new Date().toLocaleDateString('pt-BR')}`;
    const novoDetalhe = [sale.detalhe_pagamento, logEntry].filter(Boolean).join(' | ');

    const { error: saleUpErr } = await supabase
      .from('sales')
      .update({
        valor_pago: novoPago,
        status_pagamento: quitada ? 'PAGO' : 'PENDENTE',
        detalhe_pagamento: novoDetalhe,
      })
      .eq('id', sale.id);
    if (saleUpErr) throw saleUpErr;

    const { error: compUpErr } = await supabase
      .from('payment_comprovantes')
      .update({
        status: 'CONFIRMADO',
        review_note: reviewNote,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (compUpErr) throw compUpErr;

    return NextResponse.json({
      ok: true,
      status: 'CONFIRMADO',
      venda: { id: sale.id, valor_pago: novoPago, status_pagamento: quitada ? 'PAGO' : 'PENDENTE' },
    });
  } catch (e: any) {
    console.error('[api/comprovantes/revisar] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao revisar comprovante.' }, { status: 500 });
  }
}
