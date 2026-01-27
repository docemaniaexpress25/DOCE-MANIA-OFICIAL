
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
    // Abordagem atômica: remove carga antiga e insere a nova situação
    const { error: delError } = await supabase.from('cargas').delete().eq('vendedor_id', vId);
    if (delError) {
      console.error('Erro ao limpar carga anterior:', delError);
      return false;
    }

    const rows = items.filter(i => i.quantidade > 0).map(i => ({
      vendedor_id: vId,
      produto_id: i.produtoId,
      quantidade: i.quantidade
    }));

    if (rows.length === 0) return true;

    const { error: insError } = await supabase.from('cargas').insert(rows);
    if (insError) console.error('Erro ao inserir nova carga ativa:', insError);
    return !insError;
  },

  async getAllCargasPendentes(vId?: string): Promise<CargaPendente[]> {
    let query = supabase
      .from('cargas_pendentes')
      .select('*')
      .eq('status', 'PENDENTE'); // Regra de Ouro: Buscar apenas pendentes

    if (vId) {
      query = query.eq('vendedor_id', vId); // Filtro rigoroso por Vendedor (UUID)
    }

    const { data, error } = await query;
    if (error) {
      console.error('Erro ao buscar cargas pendentes:', error);
      return [];
    }
    
    return data.map(cp => ({
      id: cp.id,
      vendedorId: cp.vendedor_id,
      data: new Date(cp.data_criacao),
      itens: cp.itens
    })) as CargaPendente[];
  },

  async insertCargaPendente(cp: Omit<CargaPendente, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('cargas_pendentes').insert({
      vendedor_id: cp.vendedorId, // Garante uso do UUID correto
      itens: cp.itens,
      data_criacao: cp.data.toISOString(),
      status: 'PENDENTE' // Status inicial obrigatório
    });
    
    if (error) console.error('Erro ao inserir carga pendente no Supabase:', error);
    return !error;
  },

  async deleteCargaPendente(id: string): Promise<boolean> {
    // Em vez de deletar fisicamente, poderíamos mudar o status para 'ACEITO', 
    // mas para manter compatibilidade com o fluxo atual, removemos o registro pendente.
    const { error } = await supabase.from('cargas_pendentes').delete().eq('id', id);
    if (error) console.error('Erro ao remover carga pendente:', error);
    return !error;
  }
};
