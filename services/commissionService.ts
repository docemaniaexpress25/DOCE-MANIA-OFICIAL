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
    return (data || []).map(c => ({
      id: c.id,
      saleId: c.sale_id,
      vendedorId: c.seller_id,
      valor: safeNumber(c.valor_comissao),
      valorBase: safeNumber(c.valor_base),
      percentual: safeNumber(c.percentual),
      status: (c.status || 'DISPONIVEL').toUpperCase(), // Normaliza o status para maiúsculo
      dataGeracao: new Date(c.created_at)
    })) as Commission[];
  },

  async insertCommission(comm: Omit<Commission, 'id'>): Promise<boolean> {
    if (comm.valorBase === undefined || comm.percentual === undefined) {
        console.error('Erro: valorBase e percentual são obrigatórios para inserir comissão.');
        return false;
    }
    
    const { error } = await supabase.from('commissions').insert({
      sale_id: comm.saleId,
      seller_id: comm.vendedorId,
      valor_comissao: comm.valor,
      valor_base: comm.valorBase,
      percentual: comm.percentual,
      status: comm.status,
      created_at: comm.dataGeracao.toISOString()
    });
    return !error;
  },

  async updateCommission(id: string, updates: Partial<Commission>): Promise<boolean> {
    const payload: any = {};
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.valor !== undefined) payload.valor_comissao = updates.valor;
    if (updates.valorBase !== undefined) payload.valor_base = updates.valorBase;
    
    const { error } = await supabase.from('commissions').update(payload).eq('id', id);
    if (error) console.error('Erro ao atualizar comissão:', error);
    return !error;
  },

  async updateCommissionStatus(id: string, status: string): Promise<boolean> {
    return this.updateCommission(id, { status: status as any });
  },

  async bulkUpdateStatusByVendedor(vId: string, oldStatus: string, newStatus: string): Promise<boolean> {
    const { error } = await supabase.from('commissions')
      .update({ status: newStatus })
      .eq('seller_id', vId)
      .eq('status', oldStatus);
    if (error) console.error('Erro ao atualizar status em massa das comissões:', error);
    return !error;
  },

  async getAllPayouts(): Promise<CommissionPaymentLog[]> {
    const { data, error } = await supabase.from('commission_payment_logs').select('*');
    if (error) return [];
    return data.map(l => ({
      id: l.id,
      vendedorId: l.seller_id,
      vendedorNome: 'N/D',
      valorPago: safeNumber(l.valor_pago),
      valorRestante: 0,
      tipo: 'TOTAL',
      dataPagamento: new Date(l.created_at),
      adminId: 'N/D',
      status: l.observacao?.includes('CONFIRMADO') ? 'CONFIRMADO' : 'PENDENTE'
    })) as CommissionPaymentLog[];
  },

  async insertPayout(log: Omit<CommissionPaymentLog, 'id'>): Promise<string | null> {
    const payload = {
      seller_id: log.vendedorId,
      valor_pago: log.valorPago,
      metodo_pagamento: 'DINHEIRO',
      observacao: `Pagamento ${log.tipo} por Admin ${log.adminId}. STATUS: PENDENTE`,
      created_at: log.dataPagamento.toISOString(),
    };
    
    const { data, error } = await supabase.from('commission_payment_logs').insert(payload).select('id').single();
    if (error) {
      console.error('Erro ao inserir log de pagamento:', error);
      return null;
    }
    return data.id;
  },

  async confirmPayout(payoutId: string): Promise<boolean> {
    const { data: current } = await supabase.from('commission_payment_logs').select('observacao').eq('id', payoutId).single();
    const newObs = (current?.observacao || '').replace('STATUS: PENDENTE', 'STATUS: CONFIRMADO');
    
    const { error } = await supabase.from('commission_payment_logs')
      .update({ observacao: newObs })
      .eq('id', payoutId);
    
    return !error;
  },

  async deleteCommissionBySale(saleId: string): Promise<boolean> {
    const { error } = await supabase.from('commissions').delete().eq('sale_id', saleId);
    return !error;
  }
};