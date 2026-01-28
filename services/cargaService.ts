import { supabase } from '../supabaseClient';
import { Carga, CargaPendente } from '../types';

export const cargaService = {
  async getAllCargas(): Promise<Carga[]> {
    const { data, error } = await supabase
      .from('cargas')
      .select('*');
      
    if (error) {
      console.error('Erro ao buscar cargas ativas:', error);
      return [];
    }
    
    return data.map(c => ({
      vendedorId: c.vendedor_id,
      produtoId: c.produto_id,
      quantidade: Number(c.quantidade)
    })) as Carga[];
  },

  async updateActiveCarga(vId: string, items: { produtoId: string, quantidade: number }[]): Promise<boolean> {
    // 1. Limpar carga ativa atual do vendedor
    const { error: delError } = await supabase
      .from('cargas')
      .delete()
      .eq('vendedor_id', vId);
      
    if (delError) {
      console.error('Erro ao limpar carga anterior:', delError);
      return false;
    }

    // 2. Filtrar apenas itens com quantidade > 0
    const rows = items
      .filter(i => i.quantidade > 0)
      .map(i => ({
        vendedor_id: vId,
        produto_id: i.produtoId,
        quantidade: i.quantidade,
        updated_at: new Date().toISOString()
      }));

    if (rows.length === 0) return true;

    // 3. Inserir a nova carga
    const { error: insError } = await supabase
      .from('cargas')
      .insert(rows);
      
    if (insError) {
      console.error('Erro ao inserir nova carga ativa:', insError);
      return false;
    }
    
    return true;
  },

  async getAllCargasPendentes(): Promise<CargaPendente[]> {
    const { data, error } = await supabase
      .from('cargas_pendentes')
      .select('*')
      .eq('status', 'PENDENTE')
      .order('data_criacao', { ascending: false });

    if (error) {
      console.error('Erro ao buscar cargas pendentes:', error);
      return [];
    }
    
    return data.map(cp => ({
      id: cp.id,
      vendedorId: cp.vendedor_id,
      data: new Date(cp.data_criacao || cp.created_at),
      itens: cp.itens
    })) as CargaPendente[];
  },

  async insertCargaPendente(cp: Omit<CargaPendente, 'id'>): Promise<boolean> {
    const { error } = await supabase
      .from('cargas_pendentes')
      .insert({
        vendedor_id: cp.vendedorId,
        itens: cp.itens,
        data_criacao: cp.data.toISOString(),
        status: 'PENDENTE'
      });
    
    if (error) {
      console.error('Erro ao inserir carga pendente:', error);
      return false;
    }
    return true;
  },

  async deleteCargaPendente(id: string): Promise<boolean> {
    // Marcamos como 'ACEITO' ou deletamos para limpar a fila do vendedor
    const { error } = await supabase
      .from('cargas_pendentes')
      .delete()
      .eq('id', id);
      
    if (error) {
      console.error('Erro ao remover carga pendente:', error);
      return false;
    }
    return true;
  }
};