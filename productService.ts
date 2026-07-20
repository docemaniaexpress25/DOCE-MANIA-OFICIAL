import { supabase } from '../supabaseClient';
import { Product } from '../types';

export const productService = {
  async getAllProducts(): Promise<Product[]> {
    const { data, error } = await supabase.from('products').select('*');
    if (error) {
      console.error('Erro ao buscar produtos:', error);
      return [];
    }
    return (data || []).map(p => ({
      id: p.id,
      nome: p.nome ?? '',
      precoCusto: Number(p.preco_custo) || 0,
      precoVenda: Number(p.preco_venda) || 0,
      comissaoPercentual: Number(p.comissao_percentual) || 0,
      estoquePrincipal: Number(p.estoque_principal) || 0,
      ativo: !!p.ativo,
      categoryId: p.category_id,
      subcategoryId: p.subcategory_id,
      precoMinimo: Number(p.preco_minimo) || 0
    })) as Product[];
  },

  async insertProduct(product: Omit<Product, 'id'>): Promise<Product | null> {
    const payload = {
      nome: product.nome,
      preco_custo: product.precoCusto,
      preco_venda: product.precoVenda,
      comissao_percentual: product.comissaoPercentual,
      estoque_principal: product.estoquePrincipal,
      ativo: product.ativo,
      category_id: product.categoryId,
      subcategory_id: product.subcategoryId,
      preco_minimo: product.precoMinimo
    };

    const { data, error } = await supabase.from('products').insert(payload).select().single();
    if (error) {
      console.error('Erro ao inserir produto:', error);
      return null;
    }
    return {
      ...data,
      id: data.id,
      nome: data.nome,
      precoCusto: data.preco_custo,
      precoVenda: data.preco_venda,
      comissaoPercentual: data.comissao_percentual,
      estoquePrincipal: data.estoque_principal,
      ativo: data.ativo,
      categoryId: data.category_id,
      subcategoryId: data.subcategory_id,
      precoMinimo: data.preco_minimo
    } as Product;
  },

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
    const payload: any = {};
    if (updates.nome !== undefined) payload.nome = updates.nome;
    if (updates.precoCusto !== undefined) payload.preco_custo = updates.precoCusto;
    if (updates.precoVenda !== undefined) payload.preco_venda = updates.precoVenda;
    if (updates.comissaoPercentual !== undefined) payload.comissao_percentual = updates.comissaoPercentual;
    if (updates.estoquePrincipal !== undefined) payload.estoque_principal = updates.estoquePrincipal;
    if (updates.ativo !== undefined) payload.ativo = updates.ativo;
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    if (updates.subcategoryId !== undefined) payload.subcategory_id = updates.subcategoryId;
    if (updates.precoMinimo !== undefined) payload.preco_minimo = updates.precoMinimo;

    const { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
    if (error) {
      console.error('Erro ao atualizar produto:', error);
      return null;
    }
    return {
      ...data,
      id: data.id,
      nome: data.nome,
      precoCusto: data.preco_custo,
      precoVenda: data.preco_venda,
      comissaoPercentual: data.comissao_percentual,
      estoquePrincipal: data.estoque_principal,
      ativo: data.ativo,
      categoryId: data.category_id,
      subcategoryId: data.subcategory_id,
      precoMinimo: data.preco_minimo
    } as Product;
  },

  async deleteProduct(id: string): Promise<boolean> {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      if (error.code === '23503') {
        const { error: updateError } = await supabase.from('products').update({ ativo: false }).eq('id', id);
        return !updateError;
      }
      console.error('Erro ao excluir produto:', error);
      return false;
    }
    return true;
  }
};