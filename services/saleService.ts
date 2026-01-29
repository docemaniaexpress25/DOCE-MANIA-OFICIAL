import { supabase } from '../supabaseClient';
import { Sale } from '../types';

const safeNumber = (value: any): number => Number(value || 0);

export const saleService = {
  async getAllSales(): Promise<Sale[]> {
    const { data, error } = await supabase.from('sales').select('*, sale_items(*)');
    if (error) return [];
    return data.map(s => ({
      id: s.id,
      vendedorId: s.vendedor_id,
      clientId: s.client_id,
      valorTotal: safeNumber(s.valor_total),
      valorPago: safeNumber(s.valor_pago),
      metodoPagamento: s.metodo_pagamento,
      detalhePagamento: s.detalhe_pagamento,
      statusPagamento: s.status_pagamento,
      dataVencimento: s.data_vencimento ? new Date(s.data_vencimento) : undefined,
      data: new Date(s.data_venda),
      itens: (s.sale_items || []).map((i: any) => ({
        produtoId: i.produto_id,
        quantidade: safeNumber(i.quantidade),
        precoVenda: safeNumber(i.preco_venda)
      }))
    })) as Sale[];
  },

  async insertSale(sale: Omit<Sale, 'id'>): Promise<Sale | null> {
    // Garante que todos os campos obrigatórios pelo RPC sejam enviados, mesmo como null
    const { data: saleId, error } = await supabase.rpc('processar_venda_v2', {
      p_vendedor_id: sale.vendedorId,
      p_client_id: sale.clientId,
      p_valor_total: sale.valorTotal,
      p_valor_pago: sale.valorPago,
      p_metodo_pagamento: sale.metodoPagamento,
      p_detalhe_pagamento: sale.detalhePagamento || '',
      p_status_pagamento: sale.statusPagamento,
      p_data_venda: sale.data.toISOString(),
      p_data_vencimento: sale.dataVencimento ? sale.dataVencimento.toISOString() : null,
      p_itens: sale.itens
    });

    if (error) {
      console.error('Erro CRÍTICO no RPC processar_venda_v2:', error);
      return null;
    }

    return { ...sale, id: saleId };
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
    const { error } = await supabase.rpc('excluir_venda_estornar_estoque', {
      p_sale_id: id
    });
    if (error) console.error('Erro RPC excluir_venda_estornar_estoque:', error);
    return !error;
  }
};