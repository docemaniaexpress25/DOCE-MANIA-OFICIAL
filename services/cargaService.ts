import { supabase } from '../supabaseClient';
import { Carga, CargaPendente } from '../types';

export const cargaService = {
  async getAllCargas(): Promise<Carga[]> {
    const { data, error } = await supabase.from('cargas').select('*');
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
    const { error: delError } = await supabase.from('cargas').delete().eq('vendedor_id', vId);
    if (delError) return false;

    const rows = items.filter(i => i.quantidade > 0).map(i => ({
      vendedor_id: vId,
      produto_id: i.produtoId,
      quantidade: i.quantidade
    }));

    if (rows.length === 0) return true;
    const { error: insError } = await supabase.from('cargas').insert(rows);
    return !insError;
  },

  async getAllCargasPendentes(vId?: string): Promise<CargaPendente[]> {
    let query = supabase.from('cargas_pendentes').select('*').eq('status', 'PENDENTE');
    if (vId) query = query.eq('vendedor_id', vId);
    const { data, error } = await query;
    if (error) return [];
    return data.map(cp => ({
      id: cp.id,
      vendedorId: cp.vendedor_id,
      data: new Date(cp.data_criacao),
      itens: cp.itens
    })) as CargaPendente[];
  },

  async insertCargaPendente(cp: Omit<CargaPendente, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('cargas_pendentes').insert({
      vendedor_id: cp.vendedorId,
      itens: cp.itens,
      data_criacao: cp.data.toISOString(),
      status: 'PENDENTE'
    });
    return !error;
  },

  async deleteCargaPendente(id: string): Promise<boolean> {
    const { error } = await supabase.from('cargas_pendentes').delete().eq('id', id);
    return !error;
  },

  // Nova função RPC para Aceite Atômico
  async aceitarCargaRPC(pendenciaId: string): Promise<boolean> {
    const { error } = await supabase.rpc('aceitar_carga_vendedor', {
      p_carga_pendente_id: pendenciaId
    });
    if (error) console.error('Erro RPC aceitar_carga_vendedor:', error);
    return !error;
  }
};