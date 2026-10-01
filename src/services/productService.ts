import { supabase } from '@/lib/supabaseClient';
import { Product } from '@/lib/types';

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
      precoMinimo: Number(p.preco_minimo) || 0,
      comissaoPercentual: Number(p.comissao_percentual) || 0,
      // Bloco 14: comissão de pré-venda — undefined = herda a taxa padrão da PV
      comissaoPvPercentual: (p.comissao_pv_percentual === null || p.comissao_pv_percentual === undefined) ? undefined : Number(p.comissao_pv_percentual),
      estoquePrincipal: Number(p.estoque_principal) || 0,
      ativo: !!p.ativo,
      categoryId: p.category_id,
      subcategoryId: p.subcategory_id,
      // Fiscais (Bloco 12) — podem nao existir antes do SQL
      ncm: p.ncm || undefined,
      cest: p.cest || undefined,
      cfop: p.cfop || undefined,
      ean: p.ean || undefined,
      unidade: p.unidade || undefined,
      origem: p.origem || undefined,
      // Bloco 15: foto + caixa do atacado (podem nao existir antes do SQL)
      imagem: p.imagem || undefined,
      unidadesPorCaixa: (p.unidades_por_caixa === null || p.unidades_por_caixa === undefined) ? undefined : Number(p.unidades_por_caixa),
      // Bloco 18: observacao do produto — SO o cliente ve (catalogo do portal)
      obs: p.obs || null,
    })) as Product[];
  },

  async insertProduct(product: Omit<Product, 'id'>): Promise<Product | null> {
    const payload = {
      nome: product.nome,
      preco_custo: product.precoCusto,
      preco_venda: product.precoVenda,
      preco_minimo: product.precoMinimo,
      comissao_percentual: product.comissaoPercentual,
      estoque_principal: product.estoquePrincipal,
      ativo: product.ativo,
      category_id: product.categoryId,
      subcategory_id: product.subcategoryId
    };
    // Fiscais (Bloco 12): envia com fallback — se a coluna ainda nao existir,
    // o Supabase rejeita o insert e refaz sem elas.
    const fiscal: Record<string, string | null> = {};
    if (product.ncm !== undefined) fiscal.ncm = product.ncm || null;
    if (product.cest !== undefined) fiscal.cest = product.cest || null;
    if (product.cfop !== undefined) fiscal.cfop = product.cfop || null;
    if (product.ean !== undefined) fiscal.ean = product.ean || null;
    if (product.unidade !== undefined) fiscal.unidade = product.unidade || null;
    if (product.origem !== undefined) fiscal.origem = product.origem || null;
    // Bloco 15: foto + caixa do atacado
    const b15: Record<string, string | number | null> = {};
    if (product.imagem !== undefined) b15.imagem = product.imagem || null;
    if (product.unidadesPorCaixa !== undefined) b15.unidades_por_caixa = Math.max(1, Math.floor(Number(product.unidadesPorCaixa) || 1));
    // Bloco 18: observacao para o cliente (portal)
    const b18: Record<string, string | null> = {};
    if (product.obs !== undefined) b18.obs = product.obs || null;
    // Bloco 14: comissão PV (undefined = usa taxa padrão)
    const extra14: Record<string, number | null> = {};
    if (product.comissaoPvPercentual !== undefined) extra14.comissao_pv_percentual = product.comissaoPvPercentual;

    let { data, error } = await supabase.from('products').insert({ ...payload, ...fiscal, ...extra14, ...b15, ...b18 }).select().single();
    if (error && /comissao_pv_percentual/i.test(error.message || '')) {
      console.warn('Coluna comissao_pv_percentual ausente (Bloco 14 nao rodado). Salvando sem ela.');
      ({ data, error } = await supabase.from('products').insert({ ...payload, ...fiscal, ...b15, ...b18 }).select().single());
    } else if (error && /imagem|unidades_por_caixa/i.test(error.message || '')) {
      console.warn('Colunas foto/caixa ausentes (Bloco 15 nao rodado). Salvando sem elas.');
      const sem15: Record<string, unknown> = { ...payload, ...fiscal, ...extra14, ...b18 };
      delete (sem15 as any).imagem; delete (sem15 as any).unidades_por_caixa;
      ({ data, error } = await supabase.from('products').insert(sem15).select().single());
    } else if (error && /\bobs\b/i.test(error.message || '')) {
      console.warn('Coluna obs ausente (Bloco 18 nao rodado). Salvando sem ela.');
      ({ data, error } = await supabase.from('products').insert({ ...payload, ...fiscal, ...extra14, ...b15 }).select().single());
    } else if (error && /ncm|cest|cfop|\bean\b|unidade|origem/i.test(error.message || '')) {
      console.warn('Colunas fiscais de produto ausentes (Bloco 12 nao rodado). Salvando sem elas.');
      ({ data, error } = await supabase.from('products').insert({ ...payload, ...extra14 }).select().single());
    }
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
      precoMinimo: data.preco_minimo,
      comissaoPercentual: data.comissao_percentual,
      comissaoPvPercentual: (data.comissao_pv_percentual === null || data.comissao_pv_percentual === undefined) ? undefined : Number(data.comissao_pv_percentual),
      estoquePrincipal: data.estoque_principal,
      ativo: data.ativo,
      categoryId: data.category_id,
      subcategoryId: data.subcategory_id,
      ncm: data.ncm || undefined,
      cest: data.cest || undefined,
      cfop: data.cfop || undefined,
      ean: data.ean || undefined,
      unidade: data.unidade || undefined,
      origem: data.origem || undefined,
      imagem: data.imagem || undefined,
      unidadesPorCaixa: (data.unidades_por_caixa === null || data.unidades_por_caixa === undefined) ? undefined : Number(data.unidades_por_caixa),
      obs: data.obs || null,
    } as Product;
  },

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
    const payload: any = {};
    if (updates.nome !== undefined) payload.nome = updates.nome;
    if (updates.precoCusto !== undefined) payload.preco_custo = updates.precoCusto;
    if (updates.precoVenda !== undefined) payload.preco_venda = updates.precoVenda;
    if (updates.precoMinimo !== undefined) payload.preco_minimo = updates.precoMinimo;
    if (updates.comissaoPercentual !== undefined) payload.comissao_percentual = updates.comissaoPercentual;
    // Bloco 14: comissão PV — undefined = usa taxa padrão (NULL no banco)
    if (updates.comissaoPvPercentual !== undefined) payload.comissao_pv_percentual = updates.comissaoPvPercentual;
    if (updates.estoquePrincipal !== undefined) payload.estoque_principal = updates.estoquePrincipal;
    if (updates.ativo !== undefined) payload.ativo = updates.ativo;
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    if (updates.subcategoryId !== undefined) payload.subcategory_id = updates.subcategoryId;
    // Fiscais (Bloco 12)
    if (updates.ncm !== undefined) payload.ncm = updates.ncm || null;
    if (updates.cest !== undefined) payload.cest = updates.cest || null;
    if (updates.cfop !== undefined) payload.cfop = updates.cfop || null;
    if (updates.ean !== undefined) payload.ean = updates.ean || null;
    if (updates.unidade !== undefined) payload.unidade = updates.unidade || null;
    if (updates.origem !== undefined) payload.origem = updates.origem || null;
    // Bloco 15: foto + caixa do atacado
    if (updates.imagem !== undefined) payload.imagem = updates.imagem || null;
    if (updates.unidadesPorCaixa !== undefined) payload.unidades_por_caixa = Math.max(1, Math.floor(Number(updates.unidadesPorCaixa) || 1));
    // Bloco 18: observacao para o cliente (portal) — vazio = limpa
    if (updates.obs !== undefined) payload.obs = updates.obs || null;

    let { data, error } = await supabase.from('products').update(payload).eq('id', id).select().single();
    if (error && /comissao_pv_percentual/i.test(error.message || '')) {
      const fb14: Record<string, unknown> = { ...payload };
      delete fb14.comissao_pv_percentual;
      ({ data, error } = await supabase.from('products').update(fb14).eq('id', id).select().single());
    } else if (error && /imagem|unidades_por_caixa/i.test(error.message || '')) {
      const fb15: Record<string, unknown> = { ...payload };
      delete fb15.imagem; delete fb15.unidades_por_caixa;
      ({ data, error } = await supabase.from('products').update(fb15).eq('id', id).select().single());
    } else if (error && /\bobs\b/i.test(error.message || '')) {
      const fb18: Record<string, unknown> = { ...payload };
      delete fb18.obs;
      ({ data, error } = await supabase.from('products').update(fb18).eq('id', id).select().single());
    } else if (error && /ncm|cest|cfop|\bean\b|unidade|origem/i.test(error.message || '')) {
      const fallback: Record<string, unknown> = { ...payload };
      delete fallback.ncm; delete fallback.cest; delete fallback.cfop;
      delete fallback.ean; delete fallback.unidade; delete fallback.origem;
      ({ data, error } = await supabase.from('products').update(fallback).eq('id', id).select().single());
    }
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
      precoMinimo: data.preco_minimo,
      comissaoPercentual: data.comissao_percentual,
      comissaoPvPercentual: (data.comissao_pv_percentual === null || data.comissao_pv_percentual === undefined) ? undefined : Number(data.comissao_pv_percentual),
      estoquePrincipal: data.estoque_principal,
      ativo: data.ativo,
      categoryId: data.category_id,
      subcategoryId: data.subcategory_id,
      ncm: data.ncm || undefined,
      cest: data.cest || undefined,
      cfop: data.cfop || undefined,
      ean: data.ean || undefined,
      unidade: data.unidade || undefined,
      origem: data.origem || undefined,
      imagem: data.imagem || undefined,
      unidadesPorCaixa: (data.unidades_por_caixa === null || data.unidades_por_caixa === undefined) ? undefined : Number(data.unidades_por_caixa),
      obs: data.obs || null,
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