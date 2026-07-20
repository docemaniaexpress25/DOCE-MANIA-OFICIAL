import { supabase } from '../supabaseClient';
import { Expense } from '../types';

export const expenseService = {
  async getAllExpenses(): Promise<Expense[]> {
    const { data, error } = await supabase.from('seller_expenses').select('*');
    if (error) return [];
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