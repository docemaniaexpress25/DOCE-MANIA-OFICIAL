import { supabase } from '../supabaseClient';
import { Category } from '../types';

export const categoryService = {
  async getAllCategories(): Promise<Category[]> {
    const { data, error } = await supabase.from('product_categories').select('*').order('name');
    if (error) {
      console.error('Erro ao buscar categorias:', error);
      return [];
    }
    return data as Category[];
  },

  async insertCategory(name: string): Promise<Category | null> {
    const { data, error } = await supabase.from('product_categories').insert({ name }).select().single();
    if (error) {
      console.error('Erro ao inserir categoria:', error);
      return null;
    }
    return data as Category;
  },

  async deleteCategory(id: string): Promise<boolean> {
    const { error } = await supabase.from('product_categories').delete().eq('id', id);
    if (error) {
      console.error('Erro ao excluir categoria:', error);
      return false;
    }
    return true;
  }
};