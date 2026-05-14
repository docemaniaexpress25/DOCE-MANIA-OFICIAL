import { supabase } from '../supabaseClient';
import { Carga, CargaPendente } from '../types';

export const cargaService = {
  async getAllCargas(): Promise<Carga[]> {
    const { data, error } = await supabase.from('cargas').select('*');
    if (error) throw error;
    return data.map(c => ({
      vendedorId: c.vendedor_id,
      produtoId: c.produto_id,
      quantidade: Number(c.quantidade)
    })) as Carga[];
  },

  async applyCargaAdminRPC(vId: string, items: { produtoId: string, quantidade: number }[]): Promise<void> {
    const { error } = await supabase.rpc('apply_carga_admin', {
      p_vendedor_id: vId,
      p_itens: items
    });
    if (error) throw error;
  },

  async getAllCargasPendentes(vId?: string): Promise<CargaPendente[]> {
    let query = supabase.from('cargas_pendentes').select('*').eq('status', 'PENDENTE');
    if (vId) query = query.eq('vendedor_id', vId);
    const { data, error } = await query;
    if (error) throw error;
    return data.map(cp => ({
      id: cp.id,
      vendedorId: cp.vendedor_id,
      data: new Date(cp.data_criacao),
      itens: cp.itens
    })) as CargaPendente[];
  },

  async insertCargaPendente(cp: Omit<CargaPendente, 'id'>): Promise<void> {
    const { error } = await supabase.from('cargas_pendentes').insert({
      vendedor_id: cp.vendedorId,
      itens: cp.itens,
      data_criacao: cp.data.toISOString(),
      status: 'PENDENTE'
    });
    if (error) throw error;
  },

  async aceitarCargaRPC(pendenciaId: string): Promise<void> {
    const { error } = await supabase.rpc('aceitar_carga_vendedor', {
      p_carga_pendente_id: pendenciaId
    });
    if (error) throw error;
  }
};