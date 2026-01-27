import { supabase } from '../supabaseClient';
import { Commission, CommissionPaymentLog } from '../types';

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
      vendedorId: c.vendedor_id,
      valor: Number(c.valor),
      status: c.status, // CORRIGIDO: Usando 'status'
      dataGeracao: new Date(c.created_at) // Assumindo que data de criação é 'created_at'
    })) as Commission[];
  },

  async insertCommission(comm: Omit<Commission, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('commissions').insert({
      sale_id: comm.saleId,
      vendedor_id: comm.vendedorId,
      valor: comm.valor,
      status: comm.status, // CORRIGIDO: Usando 'status'
      created_at: comm.dataGeracao.toISOString() // Assumindo que data de geração é 'created_at'
    });
    return !error;
  },

  async updateCommissionStatus(id: string, status: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').update({ status: status }).eq('id', id); // CORRIGIDO: Usando 'status'
    return !error;
  },

  async bulkUpdateStatusByVendedor(vId: string, oldStatus: string, newStatus: string): Promise<boolean> {
    const { error } = await supabase.from('commissions')
      .update({ status: newStatus }) // CORRIGIDO: Usando 'status'
      .eq('vendedor_id', vId)
      .eq('status', oldStatus); // CORRIGIDO: Usando 'status'
    return !error;
  },

  async getAllPayouts(): Promise<CommissionPaymentLog[]> {
    const { data, error } = await supabase.from('commission_payment_logs').select('*');
    if (error) return [];
    return data.map(l => ({
      id: l.id,
      vendedorId: l.vendedor_id,
      vendedorNome: l.vendedor_nome,
      valorPago: Number(l.valor_pago),
      valorRestante: Number(l.valor_restante),
      tipo: l.tipo,
      dataPagamento: new Date(l.created_at), // Assumindo que data de pagamento é 'created_at'
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
      created_at: log.dataPagamento.toISOString(), // Assumindo que data de pagamento é 'created_at'
      admin_id: log.adminId
    });
    return !error;
  },

  // Fix: Adding missing method deleteCommissionBySale
  async deleteCommissionBySale(saleId: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').delete().eq('sale_id', saleId);
    return !error;
  }
};