import { supabase } from '../supabaseClient';
import { Commission, CommissionPaymentLog } from '../types';

const safeNumber = (value: any): number => Number(value || 0);

export const commissionService = {
  // ... (existing methods) ...

  async insertPayout(log: Omit<CommissionPaymentLog, 'id'>): Promise<boolean> {
    const payload = {
      seller_id: log.vendedorId,
      valor_pago: log.valorPago,
      metodo_pagamento: 'DINHEIRO',
      observacao: `Pagamento ${log.tipo} por Admin ${log.adminId}.`,
      created_at: log.dataPagamento.toISOString(),
      admin_id: log.adminId || 'N/D' // ✅ Add admin_id field
    };
    const { error } = await supabase.from('commission_payment_logs').insert(payload);
    if (error) console.error('Erro ao inserir log de pagamento:', error);
    return !error;
  },

  // ... (rest of file) ...
};