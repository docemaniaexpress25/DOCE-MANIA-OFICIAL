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
      vendedorId: c.seller_id, // FIX: Mapped from seller_id
      valor: safeNumber(c.valor_comissao), // FIX: Mapped from valor_comissao
      valorBase: safeNumber(c.valor_base), // NEW: Mapped from valor_base
      percentual: safeNumber(c.percentual), // NEW: Mapped from percentual
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
      seller_id: comm.vendedorId, // FIX: Using seller_id
      valor_comissao: comm.valor, // FIX: Using valor_comissao
      valor_base: comm.valorBase, // NEW: Using valor_base
      percentual: comm.percentual, // NEW: Using percentual
      status: comm.status,
      created_at: comm.dataGeracao.toISOString()
    });
    return !error;
  },

  async updateCommissionStatus(id: string, status: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').update({ status: status }).eq('id', id);
    return !error;
  },

  async bulkUpdateStatusByVendedor(vId: string, oldStatus: string, newStatus: string): Promise<boolean> {
    const { error } = await supabase.from('commissions')
      .update({ status: newStatus })
      .eq('seller_id', vId) // FIX: Using seller_id
      .eq('status', oldStatus);
    return !error;
  },

  async getAllPayouts(): Promise<CommissionPaymentLog[]> {
    const { data, error } = await supabase.from('commission_payment_logs').select('*');
    if (error) return [];
    return data.map(l => ({
      id: l.id,
      vendedorId: l.vendedor_id,
      vendedorNome: l.vendedor_nome,
      valorPago: safeNumber(l.valor_pago), // Usando safeNumber
      valorRestante: safeNumber(l.valor_restante), // Usando safeNumber
      tipo: l.tipo,
      dataPagamento: new Date(l.created_at),
      adminId: l.admin_id
    })) as CommissionPaymentLog[];
  },

  async insertPayout(log: Omit<CommissionPaymentLog, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('commission_payment_logs').insert({
      vendedor_id: log.vendedorId,
      vendedor_nome: log.vendedorNome,
      valor_pago: log.valorPago,
      valor_restante: log.valorRestante,
      tipo: log.tipo,
      created_at: log.dataPagamento.toISOString(),
      admin_id: log.adminId
    });
    return !error;
  },

  async deleteCommissionBySale(saleId: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').delete().eq('sale_id', saleId);
    return !error;
  }
};