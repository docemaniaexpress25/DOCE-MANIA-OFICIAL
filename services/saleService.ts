import { supabase } from '../supabaseClient';
import { Sale } from '../types';

export const saleService = {
  async getAllSales(): Promise<Sale[]> {
    const { data, error } = await supabase.from('sales').select('*, sale_items(*)');
    if (error) {
      console.error('Erro ao buscar vendas:', error);
      return [];
    }
    return data.map(s => ({
      id: s.id,
      vendedorId: s.vendedor_id,
      clientId: s.client_id,
      valorTotal: Number(s.valor_total),
      valorPago: Number(s.valor_pago),
      metodoPagamento: s.metodo_pagamento,
      detalhePagamento: s.detalhe_pagamento,
      statusPagamento: s.status_pagamento,
      dataVencimento: s.data_vencimento ? new Date(s.data_vencimento) : undefined,
      data: new Date(s.data_venda),
      itens: (s.sale_items || []).map((i: any) => ({
        produtoId: i.produto_id,
        quantidade: Number(i.quantidade),
        precoVenda: Number(i.preco_venda)
      }))
    })) as Sale[];
  },

  async insertSale(sale: Omit<Sale, 'id'>): Promise<Sale | null> {
    const { data, error } = await supabase.from('sales').insert({
      vendedor_id: sale.vendedorId,
      client_id: sale.clientId,
      valor_total: sale.valorTotal,
      valor_pago: sale.valorPago,
      metodo_pagamento: sale.metodoPagamento,
      detalhe_pagamento: sale.detalhePagamento,
      status_pagamento: sale.statusPagamento,
      data_venda: sale.data.toISOString(),
      data_vencimento: sale.dataVencimento?.toISOString(),
    }).select().single();

    if (error || !data) {
      console.error('Erro ao inserir venda:', error);
      return null;
    }

    const itemsRows = sale.itens.map(i => ({
      sale_id: data.id,
      produto_id: i.produtoId,
      product_id: i.produtoId, // Adicionado para satisfazer a restrição NOT NULL
      quantidade: i.quantidade,
      preco_venda: i.precoVenda
    }));

    const { error: itemsError } = await supabase.from('sale_items').insert(itemsRows);
    if (itemsError) {
      console.error('Erro ao inserir itens da venda:', itemsError);
      return null;
    }

    return { ...sale, id: data.id };
  },

  async updateSale(id: string, updates: Partial<Sale>): Promise<boolean> {
    const payload: any = {};
    if (updates.valorPago !== undefined) payload.valor_pago = updates.valorPago;
    if (updates.statusPagamento !== undefined) payload.status_pagamento = updates.statusPagamento;
    if (updates.metodoPagamento !== undefined) payload.metodo_pagamento = updates.metodoPagamento;

    const { error } = await supabase.from('sales').update(payload).eq('id', id);
    return !error;
  },

  async deleteSale(id: string): Promise<boolean> {
    const { error } = await supabase.from('sales').delete().eq('id', id);
    return !error;
  }
};