import { supabase } from '@/lib/supabaseClient';
import { fetchAllPages } from '@/lib/supabaseAll';
import { Expense } from '@/lib/types';

export const expenseService = {
  async getAllExpenses(): Promise<Expense[]> {
    // BLOCO 20: paginado (mesmo padrao de vendas/comissoes)
    const data = await fetchAllPages<any>('seller_expenses', '*');
    return data.map(e => ({
      id: e.id,
      sellerId: e.seller_id,
      descricao: e.descricao,
      valor: Number(e.valor),
      createdAt: new Date(e.created_at)
    })) as Expense[];
  },

  async insertExpense(e: Omit<Expense, 'id' | 'createdAt'>): Promise<boolean> {
    const { error } = await supabase.from('seller_expenses').insert({
      seller_id: e.sellerId,
      descricao: e.descricao,
      valor: e.valor
    });
    if (error) console.error('Erro ao inserir despesa:', error);
    return !error;
  }
};