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
      ativo: !!p.ativo
    })) as Product[];
  },

  async insertProduct(product: Omit<Product, 'id'>): Promise<Product | null> {
    const payload = {
      nome: product.nome,
      preco_custo: product.precoCusto,
      preco_venda: product.precoVenda,
      comissao_percentual: product.comissaoPercentual,
      estoque_principal: product.estoquePrincipal,
      ativo: product.estoquePrincipal <= 0 ? false : product.ativo
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
      ativo: data.ativo
    } as Product;
  },

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
    const payload: any = {};
    if (updates.nome !== undefined) payload.nome = updates.nome;
    if (updates.precoCusto !== undefined) payload.preco_custo = updates.precoCusto;
    if (updates.precoVenda !== undefined) payload.preco_venda = updates.precoVenda;
    if (updates.comissaoPercentual !== undefined) payload.comissao_percentual = updates.comissaoPercentual;
    if (updates.estoquePrincipal !== undefined) {
      payload.estoque_principal = updates.estoquePrincipal;
      if (updates.estoquePrincipal <= 0) payload.ativo = false;
      else if (updates.ativo !== undefined) payload.ativo = updates.ativo;
    } else if (updates.ativo !== undefined) {
      payload.ativo = updates.ativo;
    }

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
      ativo: data.ativo
    } as Product;
  },

  async deleteProduct(id: string): Promise<boolean> {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      // Se houver FK, desativa o produto ao invés de excluir
      if (error.code === '23503') {
        const { error: upError } = await supabase.from('products').update({ ativo: false }).eq('id', id);
        return !upError;
      }
      console.error('Erro ao excluir produto:', error);
      return false;
    }
    return true;
  }
};