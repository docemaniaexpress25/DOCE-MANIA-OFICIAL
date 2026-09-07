import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sendPushToAll } from '@/lib/pushSender';

/**
 * POST /api/cliente/[codigo]/comprovante
 * Body: { saleId, valor, foto (dataURL jpeg), txid?, observacao? }
 *
 * Portal do cliente: envia o print do comprovante de pagamento Pix
 * para conferencia. O comprovante entra com status PENDENTE e o
 * admin aprova (baixa a divida) ou recusa na aba "Comprovantes".
 *
 * Anon NAO tem acesso a esta tabela (RLS fechada via Bloco 3):
 * toda escrita acontece aqui, com service_role.
 */

const MAX_FOTO_CHARS = 1_500_000; // ~1.1MB em base64 (ja comprimida no cliente)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;

  if (!codigo || codigo.length < 8) {
    return NextResponse.json({ error: 'Codigo invalido' }, { status: 400 });
  }
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Portal temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const saleId = String(body?.saleId || '');
    const foto = String(body?.foto || '');
    const valor = Math.round((Number(body?.valor) || 0) * 100) / 100;
    const txid = String(body?.txid || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || null;
    const observacao = String(body?.observacao || '').slice(0, 300) || null;

    if (!saleId || !foto || valor <= 0) {
      return NextResponse.json({ error: 'Dados incompletos (venda, valor e foto).' }, { status: 400 });
    }
    if (!foto.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Formato de imagem invalido.' }, { status: 400 });
    }
    if (foto.length > MAX_FOTO_CHARS) {
      return NextResponse.json({ error: 'Imagem muito grande. Tente um print menor.' }, { status: 413 });
    }

    const supabase = getServiceClient();

    // 1. Cliente pelo portal_code
    const { data: client, error: findErr } = await supabase
      .from('clients')
      .select('id, nome_fantasia')
      .eq('portal_code', codigo.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!client) return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });

    // 2. Venda do cliente (precisa ter saldo em aberto)
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .select('id, client_id, valor_total, valor_pago, status_pagamento')
      .eq('id', saleId)
      .limit(1)
      .maybeSingle();
    if (saleErr) throw saleErr;
    if (!sale || sale.client_id !== client.id) {
      return NextResponse.json({ error: 'Venda nao encontrada para este cliente.' }, { status: 404 });
    }
    const restante = Math.round((Number(sale.valor_total || 0) - Number(sale.valor_pago || 0)) * 100) / 100;
    if (restante <= 0) {
      return NextResponse.json({ error: 'Esta venda nao tem saldo em aberto.' }, { status: 400 });
    }
    if (valor > restante + 0.01) {
      return NextResponse.json({ error: `Valor maior que a divida em aberto (${restante.toFixed(2)}).` }, { status: 400 });
    }

    // 3. Registra o comprovante para conferencia
    const { data: inserted, error: insErr } = await supabase
      .from('payment_comprovantes')
      .insert({
        sale_id: sale.id,
        client_id: client.id,
        valor,
        txid,
        foto,
        observacao,
        status: 'PENDENTE',
      })
      .select('id')
      .single();

    if (insErr) {
      const missingTable = insErr.code === '42P01' || insErr.code === 'PGRST205' || /does not exist|relation|could not find the table/i.test(insErr.message || '');
      if (missingTable) {
        return NextResponse.json(
          { error: 'Sistema em atualizacao (rode o SQL do Bloco 3 no Supabase para ativar os comprovantes).' },
          { status: 503 }
        );
      }
      throw insErr;
    }

    // 4. Push para o admin (nao bloqueia a resposta)
    sendPushToAll({
      title: 'Comprovante Pix recebido!',
      body: `${client.nome_fantasia} enviou comprovante de R$ ${valor.toFixed(2)} — confira em Comprovantes.`,
      url: '/',
    }).catch(() => {});

    return NextResponse.json({ ok: true, id: inserted?.id });
  } catch (e: any) {
    console.error('[api/cliente/comprovante] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao enviar comprovante. Tente novamente.' }, { status: 500 });
  }
}
