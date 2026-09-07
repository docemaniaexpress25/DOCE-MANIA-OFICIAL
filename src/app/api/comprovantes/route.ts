import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';

/**
 * GET /api/comprovantes            [ADMIN]
 * Lista os comprovantes enviados pelo portal do cliente.
 * Pendentes primeiro; confirmados/recusados recentes depois.
 * A foto (base64) NAO vem na listagem — vem sob demanda em
 * /api/comprovantes/foto?id=... para nao estourar o payload.
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Nao autorizado. Faca login novamente.' }, { status: 401 });
  }

  try {
    const supabase = getServiceClient();

    const { data: comps, error } = await supabase
      .from('payment_comprovantes')
      .select('id, sale_id, client_id, valor, txid, status, observacao, review_note, created_at, reviewed_at')
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      const missingTable = error.code === '42P01' || /does not exist|relation/i.test(error.message || '');
      if (missingTable) {
        return NextResponse.json({ comprovantes: [], aviso: 'Rode o SQL do Bloco 3 (tabela payment_comprovantes).' });
      }
      throw error;
    }

    const lista = comps || [];

    // Nomes de clientes e dados das vendas (queries separadas — sem depender de embed)
    const clientIds = [...new Set(lista.map((c: any) => c.client_id))];
    const saleIds = [...new Set(lista.map((c: any) => c.sale_id))];

    const clientsMap: Record<string, string> = {};
    if (clientIds.length) {
      const { data: cs } = await supabase.from('clients').select('id, nome_fantasia').in('id', clientIds);
      (cs || []).forEach((c: any) => { clientsMap[c.id] = c.nome_fantasia; });
    }

    const salesMap: Record<string, { valor_total: number; valor_pago: number; data_venda: string; status_pagamento: string }> = {};
    if (saleIds.length) {
      const { data: ss } = await supabase
        .from('sales')
        .select('id, valor_total, valor_pago, data_venda, status_pagamento')
        .in('id', saleIds);
      (ss || []).forEach((s: any) => {
        salesMap[s.id] = { valor_total: Number(s.valor_total || 0), valor_pago: Number(s.valor_pago || 0), data_venda: s.data_venda, status_pagamento: s.status_pagamento };
      });
    }

    const pendentes = lista.filter((c: any) => c.status === 'PENDENTE');
    const revisados = lista.filter((c: any) => c.status !== 'PENDENTE');

    return NextResponse.json({
      comprovantes: [...pendentes, ...revisados],
      pendentesCount: pendentes.length,
    });
  } catch (e: any) {
    console.error('[api/comprovantes GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao carregar comprovantes.' }, { status: 500 });
  }
}
