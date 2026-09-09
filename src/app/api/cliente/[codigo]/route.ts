import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';

/**
 * GET /api/cliente/[codigo]
 * Portal do cliente (Opcao A): o codigo agora e o portal_code
 * aleatorio de 12 chars (coluna criada na Fase 1 do SQL).
 *
 * Otimizacoes vs versao anterior:
 * - Cliente encontrado por INDICE (portal_code) — antes: baixava TODOS os clientes
 *   e comparava em JS.
 * - Sugestoes via RPC get_sugestoes_cliente — antes: baixava TODOS os sale_items
 *   do banco a cada visita.
 * - Usa service_role no servidor; anon nao precisa ler nada daqui.
 *
 * Formato de resposta: igual ao anterior + campo "pagamentos" por venda
 * (historico organizado dos recebimentos parciais, parseado do log em
 * detalhe_pagamento — nao expõe o detalhe bruto ao cliente).
 */

/**
 * Parseia o log de recebimentos acumulado no detalhe_pagamento da venda.
 * Padroes gravados pelo sistema:
 * - Recebimento manual do vendedor: "05/02/2025 14:33:12: R$ 50.00 (DINHEIRO)"
 *   (receiveAccount — aceita horario opcional e variacoes do toLocaleString)
 * - Comprovante Pix do portal confirmado: "PIX PORTAL R$ 30.00 em 06/02/2025"
 * O primeiro segmento do detalhe e a forma original da venda (ex: "Prazo Comum"),
 * nao e um pagamento — por isso o slice(1) apos dividir por " | ".
 */
function parsePagamentos(detalhe: string | null | undefined): { data: string; valor: number; metodo: string }[] {
  if (!detalhe) return [];
  const out: { data: string; valor: number; metodo: string }[] = [];
  const parts = String(detalhe).split(' | ');
  for (const raw of parts.slice(1)) {
    const p = raw.trim();
    let m = p.match(/^(\d{2}\/\d{2}\/\d{4})(?:,?\s*\d{2}:\d{2}(?::\d{2})?)?:\s*R\$\s*([\d.,]+)\s*\((.+)\)$/);
    if (m) {
      const v = Number(m[2]);
      if (isFinite(v) && v > 0) out.push({ data: m[1], valor: v, metodo: m[3].trim() });
      continue;
    }
    m = p.match(/^PIX PORTAL R\$\s*([\d.,]+)\s+em (.+)$/);
    if (m) {
      const v = Number(m[1]);
      if (isFinite(v) && v > 0) out.push({ data: m[2].trim(), valor: v, metodo: 'Pix (portal)' });
    }
  }
  return out;
}

export async function GET(
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
    const supabase = getServiceClient();

    // 1. Cliente pelo codigo aleatorio (indice unico)
    const { data: found, error: findErr } = await supabase
      .from('clients')
      .select('id, nome_fantasia, endereco, bairro, portal_code')
      .eq('portal_code', codigo.toUpperCase())
      .limit(1)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!found) return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });

    // 2. Vendas do cliente (detalhe_pagamento carrega o log de pagamentos parciais;
    //    entrega_status mostra a situacao da pre-venda no portal)
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, data_vencimento, detalhe_pagamento, entrega_status, sale_items(produto_id, quantidade, preco_venda)')
      .eq('client_id', found.id)
      .order('data_venda', { ascending: false });

    // 3. Nomes dos produtos
    const { data: prodData } = await supabase.from('products').select('id, nome, preco_venda');
    const productMap: Record<string, { nome: string; preco: number }> = {};
    if (prodData) {
      prodData.forEach((p: any) => { productMap[p.id] = { nome: p.nome, preco: p.preco_venda }; });
    }

    // 4. Estatisticas personalizadas
    const sales = salesData || [];
    const totalComprado = sales.reduce((a: number, s: any) => a + Number(s.valor_total || 0), 0);
    const totalPago = sales.reduce((a: number, s: any) => a + Number(s.valor_pago || 0), 0);

    const allDates = sales.map((s: any) => new Date(s.data_venda).getTime()).sort((a: number, b: number) => a - b);
    const primeiraData = allDates.length > 0 ? new Date(allDates[0]) : null;
    const clienteDesde = primeiraData ? primeiraData.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

    let frequenciaDias = 0;
    if (allDates.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < allDates.length; i++) intervals.push(allDates[i] - allDates[i - 1]);
      frequenciaDias = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length / 86400000);
    }

    // Produto favorito (mais comprado por unidades)
    const productQty: Record<string, number> = {};
    sales.forEach((s: any) => {
      (s.sale_items || []).forEach((i: any) => {
        productQty[i.produto_id] = (productQty[i.produto_id] || 0) + Number(i.quantidade);
      });
    });
    const favEntries = Object.entries(productQty).sort((a, b) => b[1] - a[1]);
    const produtoFavorito = favEntries.length > 0 ? productMap[favEntries[0][0]]?.nome || '' : '';
    const produtoFavoritoQtd = favEntries.length > 0 ? favEntries[0][1] : 0;

    // 5. Sugestoes via RPC (calculo dentro do Postgres)
    let sugestoes: any[] = [];
    try {
      const { data: rpcData, error: rpcErr } = await supabase
        .rpc('get_sugestoes_cliente', { p_client_id: String(found.id) });
      if (!rpcErr && Array.isArray(rpcData)) sugestoes = rpcData;
    } catch {
      sugestoes = [];
    }

    // 5b. Destaques comerciais fixos — os "mais comprados / nao pode ficar sem"
    // Casados POR NOME (robusto: nao quebra se o produto for recadastrado).
    const DESTAQUE_ORDER = ['toddynho', 'chargito', 'kit wanflo', 'batata palha'];
    const isDestaque = (nome: string) => {
      const n = String(nome || '').toLowerCase();
      return (
        n.includes('toddynho') ||
        n.includes('chargito') ||
        (n.includes('kit') && n.includes('wanflo')) ||
        (n.includes('batata palha') && n.includes('deut'))
      );
    };
    const rankDestaque = (nome: string) => {
      const n = String(nome || '').toLowerCase();
      const i = DESTAQUE_ORDER.findIndex((k) => n.includes(k));
      return i === -1 ? 99 : i;
    };
    const destaques = (prodData || ([] as any[]))
      .filter((p: any) => isDestaque(p.nome))
      .sort((a: any, b: any) => rankDestaque(a.nome) - rankDestaque(b.nome))
      .map((p: any) => ({ produto_id: p.id as string, nome: p.nome as string }));

    // 6. Comprovantes enviados pelo portal (sem a foto — so status)
    let comprovantes: any[] = [];
    try {
      const { data: compData } = await supabase
        .from('payment_comprovantes')
        .select('id, sale_id, valor, txid, status, observacao, review_note, created_at, reviewed_at')
        .eq('client_id', found.id)
        .order('created_at', { ascending: false })
        .limit(15);
      comprovantes = compData || [];
    } catch {
      comprovantes = []; // tabela ainda nao existe (Bloco 3 nao rodou)
    }

    return NextResponse.json({
      client: found,
      // Cada venda ganha "pagamentos": historico organizado dos recebimentos parciais
      sales: (salesData || []).map((s: any) => {
        const { detalhe_pagamento, ...rest } = s;
        return { ...rest, pagamentos: parsePagamentos(detalhe_pagamento) };
      }),
      products: Object.fromEntries(Object.entries(productMap).map(([k, v]) => [k, v.nome])),
      stats: {
        totalComprado,
        totalPago,
        clienteDesde,
        frequenciaDias,
        totalCompras: sales.length,
        produtoFavorito,
        produtoFavoritoQtd,
      },
      sugestoes,
      destaques,
      comprovantes,
    });
  } catch (e: any) {
    console.error('[api/cliente] erro:', e?.message);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
