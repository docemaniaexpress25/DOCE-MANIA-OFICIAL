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
    // Busca todos clientes e encontra pelo codigo gerado
    const { data: allClients, error } = await supabase
      .from('clients')
      .select('id, nome_fantasia, endereco, bairro');

    if (error || !allClients) {
      return NextResponse.json({ error: 'Erro ao buscar clientes' }, { status: 500 });
    }

    let found = null;
    for (const c of allClients) {
      if (generateCode(c.id, c.nome_fantasia) === codigo.toUpperCase()) {
        found = c;
        break;
      }
    }

    if (!found) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 });
    }

    // Busca vendas
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, valor_total, valor_pago, metodo_pagamento, status_pagamento, data_venda, data_vencimento, sale_items(produto_id, quantidade, preco_venda)')
      .eq('client_id', found.id)
      .order('data_venda', { ascending: false })
      .limit(50);

    // Busca produtos
    const { data: prodData } = await supabase
      .from('products')
      .select('id, nome');

    const productMap: Record<string, string> = {};
    if (prodData) {
      prodData.forEach((p: { id: string; nome: string }) => {
        productMap[p.id] = p.nome;
      });
    }

    return NextResponse.json({
      client: found,
      sales: salesData || [],
      products: productMap,
    });
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}