import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * GET /api/caixa/fechamento?id=<fechamento>  [ADMIN | SECRETARIO | VENDEDOR]
 * BLOCO 118 — detalhe de um fechamento de caixa passado: totais + os
 * pagamentos presos no snapshot (jsonb). As fotos continuam no ledger
 * (caixa_pagamentos) — o snapshot guarda pid para buscar por /api/caixa/foto.
 */
export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, error: 'Servidor nao configurado.' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  if (!['ADMIN', 'SECRETARIO', 'VENDEDOR'].includes(session.perfil)) {
    return NextResponse.json({ ok: false, error: 'Acesso restrito.' }, { status: 403 });
  }

  try {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!id) return NextResponse.json({ ok: false, error: 'id obrigatorio.' }, { status: 400 });

    const supabase = getServiceClient();
    const { data: row, error } = await supabase
      .from('caixa_fechamentos_geral')
      .select('id, janela_inicio, fechado_em, fechado_por_nome, total_dinheiro, total_pix, total_deposito, total_geral, qtde_pagamentos, observacao, pagamentos')
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) {
      const msg = String(error.message || '');
      if (/caixa_fechamentos_geral|does not exist|schema cache/i.test(msg)) {
        return NextResponse.json({ ok: false, error: 'Banco desatualizado: rode o SQL do Bloco 118 (fechamento de caixa).' }, { status: 503 });
      }
      throw error;
    }
    if (!row) return NextResponse.json({ ok: false, error: 'Fechamento nao encontrado.' }, { status: 404 });

    const f = row as any;
    const pags = Array.isArray(f.pagamentos) ? f.pagamentos : [];
    return NextResponse.json({
      ok: true,
      fechamento: {
        id: f.id,
        janelaInicio: f.janela_inicio,
        fechadoEm: f.fechado_em,
        fechadoPorNome: f.fechado_por_nome,
        observacao: f.observacao,
        totais: {
          dinheiro: Number(f.total_dinheiro || 0),
          pix: Number(f.total_pix || 0),
          deposito: Number(f.total_deposito || 0),
          total: Number(f.total_geral || 0),
        },
        qtdePagamentos: Number(f.qtde_pagamentos || 0),
        pagamentos: pags.map((p: any) => ({
          id: p.pid || p.id,
          criadoEm: p.criado_em,
          origem: p.origem,
          saleId: p.sale_id,
          cliente: p.cliente,
          vendedor: p.vendedor,
          metodo: p.metodo,
          valor: Number(p.valor || 0),
          temComprovante: !!p.pid,
          detalhe: p.detalhe,
          usuarioNome: p.usuario_nome,
        })),
      },
    });
  } catch (e: any) {
    console.error('[api/caixa/fechamento][GET] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Erro ao carregar o fechamento.' }, { status: 500 });
  }
}
