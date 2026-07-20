import { supabase } from '../supabaseClient';
import { SystemMessage } from '../types';

export const messageService = {
  async getAllMessages(): Promise<SystemMessage[]> {
    const { data, error } = await supabase.from('system_messages').select('*');
    if (error) return [];
    return data.map(m => ({
      id: m.id,
      vendedorId: m.seller_id,
      titulo: m.titulo,
      mensagem: m.mensagem,
      data: new Date(m.created_at),
      lida: !!m.lida,
      type: m.type
    })) as SystemMessage[];
  },

  async insertMessage(m: Omit<SystemMessage, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('system_messages').insert({
      seller_id: m.vendedorId,
      titulo: m.titulo,
      mensagem: m.mensagem,
      created_at: m.data.toISOString(),
      lida: m.lida,
      type: m.type
    });
    if (error) console.error('Erro ao inserir mensagem do sistema:', error);
    return !error;
  },

  async updateMessage(id: string, updates: Partial<SystemMessage>): Promise<boolean> {
    const payload: any = {};
    if (updates.lida !== undefined) payload.lida = updates.lida;
    const { error } = await supabase.from('system_messages').update(payload).eq('id', id);
    if (error) console.error('Erro ao atualizar mensagem do sistema:', error);
    return !error;
  }
};