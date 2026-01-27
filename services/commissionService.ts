import { supabase } from '../supabaseClient';
import { Commission, CommissionPaymentLog } from '../types';

// Helper function to safely convert database numeric values (which might be null or string) to number
const safeNumber = (value: any): number => Number(value || 0);

export const commissionService = {
  async getAllCommissions(): Promise<Commission[]> {
    const { data, error } = await supabase.from('commissions').select('*');
    if (error) {
      console.error('Erro ao buscar comissões:', error);
      return [];
    }
    return data.map(c => ({
      id: c.id,
      saleId: c.sale_id,
      vendedorId: c.seller_id, // Mapped from seller_id
      valor: safeNumber(c.valor_comissao), // Mapped from valor_comissao
      valorBase: safeNumber(c.valor_base), // Mapped from valor_base
      percentual: safeNumber(c.percentual), // Mapped from percentual
      status: c.status,
      dataGeracao: new Date(c.created_at)
    })) as Commission[];
  },

  async insertCommission(comm: Omit<Commission, 'id'>): Promise<boolean> {
    // Ensure required fields are present, even if optional in TS interface
    if (comm.valorBase === undefined || comm.percentual === undefined) {
        console.error('Erro: valorBase e percentual são obrigatórios para inserir comissão.');
        return false;
    }
    
    const { error } = await supabase.from('commissions').insert({
      sale_id: comm.saleId,
      seller_id: comm.vendedorId, // Using seller_id
      valor_comissao: comm.valor, // Using valor_comissao
      valor_base: comm.valorBase, // Using valor_base
      percentual: comm.percentual, // Using percentual
      status: comm.status,
      created_at: comm.dataGeracao.toISOString()
    });
    return !error;
  },

  async updateCommissionStatus(id: string, status: string): Promise<boolean> {
    // Persiste a atualização de status no Supabase
    const { error } = await supabase.from('commissions').update({ status: status }).eq('id', id);
    if (error) console.error('Erro ao atualizar status da comissão:', error);
    return !error;
  },

  async bulkUpdateStatusByVendedor(vId: string, oldStatus: string, newStatus: string): Promise<boolean> {
    // Persiste a atualização em massa no Supabase
    const { error } = await supabase.from('commissions')
      .update({ status: newStatus })
      .eq('seller_id', vId) // Using seller_id
      .eq('status', oldStatus);
    if (error) console.error('Erro ao atualizar status em massa das comissões:', error);
    return !error;
  },

  async getAllPayouts(): Promise<CommissionPaymentLog[]> {
    const { data, error } = await supabase.from('commission_payment_logs').select('*');
    if (error) return [];
    return data.map(l => ({
      id: l.id,
      vendedorId: l.seller_id, // Mapeando de seller_id
      vendedorNome: 'N/D', // Não existe no DB, usando N/D
      valorPago: safeNumber(l.valor_pago), // Usando safeNumber
      valorRestante: 0, // Não existe no DB, usando 0
      tipo: 'TOTAL', // Não existe no DB, usando default
      dataPagamento: new Date(l.created_at),
      adminId: 'N/D' // Não existe no DB, usando N/D
    })) as CommissionPaymentLog[];
  },

  async insertPayout(log: Omit<CommissionPaymentLog, 'id'>): Promise<boolean> {
    // Mapeando apenas os campos que existem na tabela 'commission_payment_logs' do Supabase
    // (seller_id, valor_pago, metodo_pagamento, observacao, created_at)
    const payload = {
      seller_id: log.vendedorId,
      valor_pago: log.valorPago,
      // Adicionando valores padrão para campos obrigatórios/existentes no DB, mas ausentes na interface local
      metodo_pagamento: 'DINHEIRO', // Assumindo pagamento em dinheiro como padrão
      observacao: `Pagamento ${log.tipo} por Admin ${log.adminId}`,
      created_at: log.dataPagamento.toISOString(),
    };
    
    const { error } = await supabase.from('commission_payment_logs').insert(payload);
    
    if (error) console.error('Erro ao inserir log de pagamento de comissão:', error);
    return !error;
  },

  async deleteCommissionBySale(saleId: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').delete().eq('sale_id', saleId);
    return !error;
  }
};