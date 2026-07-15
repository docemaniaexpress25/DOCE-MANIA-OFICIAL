import { supabase } from '../supabaseClient';
import { Category, Subcategory } from '../types';

export const categoryService = {
  async getAllCategories(): Promise<Category[]> {
    const { data, error } = await supabase
      .from('product_categories')
      .select('*')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
      
    if (error) {
      console.error('[categoryService] Erro ao buscar categorias:', error);
      return [];
    }
    return data as Category[];
  },

  async insertCategory(name: string, order: number = 0): Promise<Category | null> {
    const { data, error } = await supabase
      .from('product_categories')
      .insert({ name, display_order: order })
      .select()
      .single();
      
    if (error) {
      console.error('[categoryService] Erro ao inserir categoria:', error);
      return null;
    }
    return data as Category;
  },

  async updateCategory(id: string, updates: Partial<Category>): Promise<boolean> {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.display_order !== undefined) payload.display_order = updates.display_order;

    const { error } = await supabase
      .from('product_categories')
      .update(payload)
      .eq('id', id);
      
    if (error) {
      console.error('[categoryService] Erro ao atualizar categoria:', error);
      return false;
    }
    return true;
  },

  async deleteCategory(id: string): Promise<boolean> {
    const { error } = await supabase.from('product_categories').delete().eq('id', id);
    if (error) {
      console.error('[categoryService] Erro ao excluir categoria:', error);
      return false;
    }
    return true;
  },

  // Métodos para Subcategorias
  async getAllSubcategories(): Promise<Subcategory[]> {
    const { data, error } = await supabase
      .from('product_subcategories')
      .select('*')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
      
    if (error) {
      console.error('[categoryService] Erro ao buscar subcategorias:', error);
      return [];
    }
    return data.map(s => ({
      id: s.id,
      categoryId: s.category_id,
      name: s.name,
      display_order: s.display_order
    })) as Subcategory[];
  },

  async insertSubcategory(catId: string, name: string, order: number = 0): Promise<Subcategory | null> {
    const { data, error } = await supabase
      .from('product_subcategories')
      .insert({ category_id: catId, name, display_order: order })
      .select()
      .single();
      
    if (error) {
      console.error('[categoryService] Erro ao inserir subcategoria:', error);
      return null;
    }
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      display_order: data.display_order
    } as Subcategory;
  },

  async updateSubcategory(id: string, updates: Partial<Subcategory>): Promise<boolean> {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.display_order !== undefined) payload.display_order = updates.display_order;

    const { error } = await supabase
      .from('product_subcategories')
      .update(payload)
      .eq('id', id);
      
    if (error) {
      console.error('[categoryService] Erro ao atualizar subcategoria:', error);
      return false;
    }
    return true;
  },

  async deleteSubcategory(id: string): Promise<boolean> {
    const { error } = await supabase.from('product_subcategories').delete().eq('id', id);
    if (error) {
      console.error('[categoryService] Erro ao excluir subcategoria:', error);
      return false;
    }
    return true;
  }
};