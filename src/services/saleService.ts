import { supabase } from '@/lib/supabaseClient';
import { fetchAllPages } from '@/lib/supabaseAll';
import { Sale } from '@/lib/types';

const safeNumber = (value: any): number => Number(value || 0);

export const saleService = {
  async getAllSales(): Promise<Sale[]> {
    // BLOCO 20: paginado — o servidor corta em 1000 linhas e as vendas novas
    // sumiam do historico/relatorios/contas a receber (caso Mio Mercato).
    // ECONOMIA DE EGRESS: colunas explicitas SEM comprovante_foto (base64 de
    // ate ~500KB por venda era baixado em TODA recarga por TODOS os aparelhos).
    // A foto agora le sob demanda via getComprovanteFoto(). Fallback '*' caso
    // alguma coluna ainda nao exista (SQL pendente).
    // BLOCO 29: modo_nota entra no COLS com fallback dedicado (nao cai no '*',
    // que traria comprovante_foto de volta e gastaria egress).
    const COLS = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_vencimento, data_venda, nota_status, nota_numero, nota_pdf_url, nota_erro, tipo_venda, entrega_status, trocas, prioridade, separado, entregador_id, modo_nota, sale_items(produto_id, quantidade, preco_venda)';
    const COLS_SEM_MODO = 'id, vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento, detalhe_pagamento, status_pagamento, data_vencimento, data_venda, nota_status, nota_numero, nota_pdf_url, nota_erro, tipo_venda, entrega_status, trocas, prioridade, separado, entregador_id, sale_items(produto_id, quantidade, preco_venda)';
    let data: any[];
    try {
      data = await fetchAllPages<any>('sales', COLS);
    } catch (e: any) {
      if (e && /modo_nota/i.test(e?.message || '')) {
        data = await fetchAllPages<any>('sales', COLS_SEM_MODO);
      } else {
        data = await fetchAllPages<any>('sales', '*, sale_items(*)');
      }
    }
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
      // EGRESS: foto do comprovante nao vem mais na lista — le sob demanda (getComprovanteFoto)
      comprovanteFoto: undefined,
      data: new Date(s.data_venda),
      itens: (s.sale_items || []).map((i: any) => ({
        produtoId: i.produto_id,
        quantidade: safeNumber(i.quantidade),
        precoVenda: safeNumber(i.preco_venda)
      })),
      // Nota fiscal (Bloco 10) — campos podem nao existir antes do SQL
      notaStatus: s.nota_status || undefined,
      notaNumero: s.nota_numero || undefined,
      notaPdfUrl: s.nota_pdf_url || undefined,
      notaErro: s.nota_erro || undefined,
      // Bloco 13: fila continua de pre-venda (colunas podem nao existir antes do SQL)
      tipoVenda: s.tipo_venda || undefined,
      entregaStatus: s.entrega_status || undefined,
      trocas: s.trocas || undefined,
      prioridade: typeof s.prioridade === 'number' ? s.prioridade : undefined,
      separado: typeof s.separado === 'boolean' ? s.separado : undefined,
      entregadorId: s.entregador_id || undefined,
      // BLOCO 29 (ROTA 2): modo do atendimento (NFE|NFCE|CUPOM) — pre-SQL = undefined
      modoNota: s.modo_nota || undefined,
    })) as Sale[];
  },

  /** Le a foto do comprovante de UMA venda sob demanda (egress: 1 venda, nao todas). */
  async getComprovanteFoto(saleId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('sales')
      .select('comprovante_foto')
      .eq('id', saleId)
      .maybeSingle();
    if (error) return null;
    return (data as any)?.comprovante_foto || null;
  },

  async insertSale(sale: Omit<Sale, 'id'>): Promise<Sale | null> {
    const rpcItems = sale.itens.map(item => ({
      produtoid: item.produtoId,
      quantidade: item.quantidade,
      precovenda: item.precoVenda
    }));

    // Garante que a data seja um objeto Date válido antes de converter para ISO string
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
      p_data_vencimento: sale.dataVencimento ? sale.dataVencimento.toISOString() : null,
      p_itens: rpcItems
    });

    if (error) {
      console.error('Erro CRÍTICO no RPC processar_venda_v2:', error);
      return null;
    }

    // BLOCO 29 (ROTA 2): grava o modo do atendimento na venda.
    // O RPC processar_venda_v2 (fora do repo) nao conhece a coluna — o modo
    // entra por update pos-insert (barato: 1 linha). Falha pre-SQL = ignora.
    const modo = (sale as any).modoNota;
    if (modo) {
      try {
        const { error: modoErr } = await supabase.from('sales').update({ modo_nota: modo }).eq('id', saleId);
        if (modoErr && !/modo_nota/i.test(modoErr.message || '')) {
          console.warn('modo_nota nao gravado:', modoErr.message);
        }
      } catch { /* modo e best-effort: nunca quebra a venda */ }
    }

    return { ...sale, id: saleId };
  },

  async updateSale(id: string, updates: Partial<Sale>): Promise<boolean> {
    const payload: any = {};
    if (updates.valorPago !== undefined) payload.valor_pago = updates.valorPago;
    if (updates.statusPagamento !== undefined) payload.status_pagamento = updates.statusPagamento;
    if (updates.metodoPagamento !== undefined) payload.metodo_pagamento = updates.metodoPagamento;
    if (updates.detalhePagamento !== undefined) payload.detalhe_pagamento = updates.detalhePagamento;
    if ((updates as any).comprovanteFoto !== undefined) payload.comprovante_foto = (updates as any).comprovanteFoto;
    if ((updates as any).modoNota !== undefined) payload.modo_nota = (updates as any).modoNota;
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