import { supabase } from '../supabaseClient';
import { Sale } from '../types';

const safeNumber = (value: any): number => Number(value || 0);

export const saleService = {
  async getAllSales(): Promise<Sale[]> {
    const { data, error } = await supabase.from('sales').select('*, sale_items(*)');
    if (error) return [];
    return data.map(s => {
      // Mapeia de volta para 'PRE_PEDIDO' se for 'A_PRAZO' e o detalhe começar com 'PRE_PEDIDO:'
      const isPreOrder = s.metodo_pagamento === 'A_PRAZO' && s.detalhe_pagamento?.startsWith('PRE_PEDIDO:');
      
      return {
        id: s.id,
        vendedorId: s.vendedor_id,
        clientId: s.client_id,
        valorTotal: safeNumber(s.valor_total),
        valorPago: safeNumber(s.valor_pago),
        metodoPagamento: isPreOrder ? 'PRE_PEDIDO' : s.metodo_pagamento,
        detalhePagamento: isPreOrder ? s.detalhe_pagamento.replace('PRE_PEDIDO: ', '') : s.detalhe_pagamento,
        statusPagamento: s.status_pagamento,
        dataVencimento: s.data_vencimento ? new Date(s.data_vencimento) : undefined,
        data: new Date(s.data_venda),
        itens: (s.sale_items || []).map((i: any) => ({
          produtoId: i.produto_id,
          quantidade: safeNumber(i.quantidade),
          precoVenda: safeNumber(i.preco_venda)
        }))
      };
    }) as Sale[];
  },

  async insertSale(sale: Omit<Sale, 'id'>): Promise<Sale | null> {
    const rpcItems = sale.itens.map(item => ({
      produtoid: item.produtoId,
      quantidade: item.quantidade,
      precovenda: item.precoVenda
    }));

    const saleDate = sale.data instanceof Date ? sale.data : new Date();

    const { data: saleId, error } = await supabase.rpc('processar_venda_v2', {
      p_vendedor_id: sale.vendedorId,
      p_client_id: sale.clientId,
      p_valor_total: sale.valorTotal,
      p_valor_pago: sale.valorPago ?? (sale.statusPagamento === 'PAGO' ? sale.valorTotal : 0),
      p_metodo_pagamento: sale.metodoPagamento,
      p_detalhe_pagamento: sale.detalhePagamento || '',
      p_status_pagamento: sale.statusPagamento,
      p_data_venda: saleDate.toISOString(),
      p_data_vencimento: sale.dataVencimento ? (sale.dataVencimento instanceof Date ? sale.dataVencimento.toISOString().split('T')[0] : new Date(sale.dataVencimento).toISOString().split('T')[0]) : null,
      p_itens: rpcItems
    });

    if (error) {
      console.error('Erro CRÍTICO no RPC processar_venda_v2:', error);
      return null;
    }

    return { ...sale, id: saleId };
  },

  async insertPreOrder(sale: Omit<Sale, 'id'>): Promise<Sale | null> {
    const saleDate = sale.data instanceof Date ? sale.data : new Date();
    
    let formattedDueDate: string | null = null;
    if (sale.dataVencimento) {
      try {
        const dueDateObj = sale.dataVencimento instanceof Date ? sale.dataVencimento : new Date(sale.dataVencimento);
        formattedDueDate = dueDateObj.toISOString().split('T')[0];
      } catch (e) {
        console.error('Erro ao formatar data_vencimento:', e);
      }
    }

    // 1. Insere o pré-pedido no banco como 'A_PRAZO' para respeitar a constraint,
    // mas identificamos com o prefixo 'PRE_PEDIDO:' para podermos mapear de volta.
    const { data: insertedSale, error: saleError } = await supabase
      .from('sales')
      .insert({
        vendedor_id: sale.vendedorId,
        client_id: sale.clientId,
        valor_total: sale.valorTotal,
        valor_pago: 0,
        metodo_pagamento: 'A_PRAZO', 
        detalhe_pagamento: `PRE_PEDIDO: ${sale.detalhePagamento || 'Pré-pedido para entrega futura'}`,
        status_pagamento: 'PENDENTE',
        data_venda: saleDate.toISOString(),
        data_vencimento: formattedDueDate
      })
      .select()
      .single();

    if (saleError || !insertedSale) {
      console.error('[saleService] Erro ao inserir pré-pedido:', saleError);
      return null;
    }

    // 2. Insere os itens e reduz diretamente o estoque principal central
    for (const item of sale.itens) {
      const { error: itemError } = await supabase
        .from('sale_items')
        .insert({
          sale_id: insertedSale.id,
          produto_id: item.produtoId,
          product_id: item.produtoId,
          quantidade: item.quantidade,
          preco_venda: item.precoVenda
        });

      if (itemError) {
        console.error('[saleService] Erro ao salvar item do pré-pedido:', itemError);
      }

      // Reduz o estoque principal
      const { data: prodData } = await supabase
        .from('products')
        .select('estoque_principal')
        .eq('id', item.produtoId)
        .single();

      if (prodData) {
        const currentStock = Number(prodData.estoque_principal || 0);
        const newStock = Math.max(0, currentStock - item.quantidade);
        await supabase
          .from('products')
          .update({ estoque_principal: newStock })
          .eq('id', item.produtoId);
      }
    }

    // 3. Calcular e Inserir Comissão
    let totalComissao = 0;
    for (const item of sale.itens) {
      const { data: prodData } = await supabase
        .from('products')
        .select('comissao_percentual')
        .eq('id', item.produtoId)
        .single();
      
      if (prodData) {
        const pct = safeNumber(prodData.comissao_percentual);
        totalComissao += (item.precoVenda * item.quantidade * (pct / 100));
      }
    }

    if (totalComissao > 0) {
      const { error: commError } = await supabase.from('commissions').insert({
        sale_id: insertedSale.id,
        seller_id: sale.vendedorId,
        valor_comissao: totalComissao,
        valor_base: sale.valorTotal,
        percentual: sale.valorTotal > 0 ? (totalComissao / sale.valorTotal) * 100 : 0,
        status: 'A_RECEBER',
        created_at: saleDate.toISOString()
      });
      if (commError) {
        console.error('[saleService] Erro ao criar comissão para o pré-pedido:', commError);
      }
    }

    return { ...sale, id: insertedSale.id };
  },

  async updateSale(id: string, updates: Partial<Sale>): Promise<boolean> {
    const payload: any = {};
    if (updates.valorPago !== undefined) payload.valor_pago = updates.valorPago;
    if (updates.statusPagamento !== undefined) payload.status_pagamento = updates.statusPagamento;
    if (updates.metodoPagamento !== undefined) payload.metodo_pagamento = updates.metodoPagamento;
    if (updates.detalhePagamento !== undefined) payload.detalhe_pagamento = updates.detalhePagamento;
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