import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://eyjhqjrczzpfthsddlpg.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5amhxanJjenpwZnRoc2RkbHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MjczNTYsImV4cCI6MjA4NTAwMzM1Nn0.seIcDpp3VMz44Zuziahln1NTI4Hrqv879Hzzp-pUrl0';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

function generateCode(clientId: string, nome: string): string {
  const prefix = (nome || 'XXXX').replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase();
  const clean = clientId.replace(/-/g, '');
  const hex1 = parseInt(clean.substring(0, 8), 16).toString(36).toUpperCase().substring(0, 2);
  const hex2 = parseInt(clean.substring(8, 16), 16).toString(36).toUpperCase().substring(0, 2);
  return (prefix + hex1 + hex2).padEnd(8, 'X');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;

  if (!codigo || codigo.length < 4) {
    return NextResponse.json({ error: 'Codigo invalido' }, { status: 400 });
  }

  try {
    // 1. Encontra cliente
    const { data: allClients } = await supabase
      .from('clients')
      .select('id, nome_fantasia, endereco, bairro');

    if (!allClients) return NextResponse.json({ error: 'Erro' }, { status: 500 });

    let found = null;
    for (const c of allClients) {
      if (generateCode(c.id, c.nome_fantasia) === codigo.toUpperCase()) { found = c; break; }
    }
    if (!found) return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });

    // 2. Vendas do cliente
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, data_vencimento, sale_items(produto_id, quantidade, preco_venda)')
      .eq('client_id', found.id)
      .order('data_venda', { ascending: false });

    // 3. Produtos (nomes)
    const { data: prodData } = await supabase.from('products').select('id, nome, preco_venda');
    const productMap: Record<string, { nome: string; preco: number }> = {};
    if (prodData) {
      prodData.forEach((p: any) => { productMap[p.id] = { nome: p.nome, preco: p.preco_venda }; });
    }

    // 4. Dados personalizados
    const sales = salesData || [];
    const totalComprado = sales.reduce((a: number, s: any) => a + Number(s.valor_total || 0), 0);
    const totalPago = sales.reduce((a: number, s: any) => a + Number(s.valor_pago || 0), 0);

    // Primeira compra
    const allDates = sales.map((s: any) => new Date(s.data_venda).getTime()).sort((a: number, b: number) => a - b);
    const primeiraData = allDates.length > 0 ? new Date(allDates[0]) : null;
    const clienteDesde = primeiraData ? primeiraData.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

    // Frequencia media entre compras (em dias)
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

    // 5. Sugestoes: produtos que a MAIORIA compra mas este cliente NAO
    // Busca todos sale_items de todas as vendas
    const { data: allSaleItems } = await supabase
      .from('sale_items')
      .select('sale_id, produto_id, quantidade');

    if (allSaleItems) {
      // Mapeia sale_id -> client_id
      const saleClientMap: Record<string, string> = {};
      sales.forEach((s: any) => { saleClientMap[s.id] = found.id; });
      // Precisa das vendas de outros clientes tb
      const { data: otherSales } = await supabase
        .from('sales')
        .select('id, client_id')
        .neq('client_id', found.id);
      if (otherSales) {
        otherSales.forEach((s: any) => { saleClientMap[s.id] = s.client_id; });
      }

      // Produtos que este cliente ja comprou
      const clientProducts = new Set(Object.keys(productQty));

      // Conta clientes unicos por produto
      const productClients: Record<string, Set<string>> = {};
      allSaleItems.forEach((si: any) => {
        const cid = saleClientMap[si.sale_id];
        if (!cid) return;
        if (!productClients[si.produto_id]) productClients[si.produto_id] = new Set();
        productClients[si.produto_id].add(cid);
      });

      const totalClientes = new Set(Object.values(saleClientMap)).size;

      // Produtos populares que o cliente NAO compra
      const sugestoes = Object.entries(productClients)
        .filter(([pid]) => !clientProducts.has(pid))
        .map(([pid, clients]) => ({
          produto_id: pid,
          nome: productMap[pid]?.nome || 'Produto',
          popularidade: Math.round((clients.size / totalClientes) * 100),
          clientesQueCompram: clients.size,
          preco: productMap[pid]?.preco || 0,
        }))
        .filter(s => s.popularidade >= 20)
        .sort((a, b) => b.popularidade - a.popularidade)
        .slice(0, 6);

      return NextResponse.json({
        client: found,
        sales,
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
      });
    }

    return NextResponse.json({
      client: found,
      sales,
      products: Object.fromEntries(Object.entries(productMap).map(([k, v]) => [k, v.nome])),
      stats: { totalComprado, totalPago, clienteDesde, frequenciaDias, totalCompras: sales.length, produtoFavorito, produtoFavoritoQtd },
      sugestoes: [],
    });
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}