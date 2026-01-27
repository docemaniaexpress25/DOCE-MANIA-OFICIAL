import type { CommissionPaymentLog } from '../types';
import { supabase } from '../supabaseClient';
import { Commission } from '../types';

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
      vendedorId: c.vendedor_id,
      valor: safeNumber(c.valor),
      status: c.status,
      dataGeracao: c.data_criacao ? new Date(c.data_criacao) : new Date()
    })) as Commission[];
  },

  async insertCommission(comm: Omit<Commission, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('commissions').insert({
      sale_id: comm.saleId,
      vendedor_id: comm.vendedorId,
      valor: comm.valor,
      status: comm.status,
      data_criacao: comm.dataGeracao.toISOString(),
      percentual: null,
      valor_comissao: null,
      paid_at: null
    });
    if (error) {
      console.error('Erro ao inserir comissão:', error);
      return false;
    }
    return true;
  },

  async updateCommissionStatus(id: string, status: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').update({ status: status }).eq('id', id);
    return !error;
  },

  async bulkUpdateStatusByVendedor(vId: string, oldStatus: string, newStatus: string): Promise<boolean> {
    const { error } = await supabase.from('commissions')
      .update({ status: newStatus })
      .eq('vendedor_id', vId)
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
      valorPago: safeNumber(l.valor_pago),
      valorRestante: safeNumber(l.valor_restante),
      tipo: l.tipo,
      dataPagamento: l.created_at ? new Date(l.created_at) : new Date(),
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