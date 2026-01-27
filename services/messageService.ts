import { supabase } from '../supabaseClient';
import { SystemMessage } from '../types';

export const messageService = {
  async getAllMessages(): Promise<SystemMessage[]> {
    const { data, error } = await supabase.from('system_messages').select('*');
    if (error) return [];
    return data.map(m => ({
      id: m.id,
      vendedorId: m.vendedor_id,
      titulo: m.titulo,
      mensagem: m.mensagem,
      data: new Date(m.data_envio),
      lida: !!m.lida,
      type: m.type
    })) as SystemMessage[];
  },

  async insertMessage(m: Omit<SystemMessage, 'id'>): Promise<boolean> {
    const { error } = await supabase.from('system_messages').insert({
      vendedor_id: m.vendedorId,
      titulo: m.titulo,
      mensagem: m.mensagem,
      data_envio: m.data.toISOString(),
      lida: m.lida,
      type: m.type
    });
    return !error;
  },

  async updateMessage(id: string, updates: Partial<SystemMessage>): Promise<boolean> {
    const payload: any = {};
    if (updates.lida !== undefined) payload.lida = updates.lida;
    const { error } = await supabase.from('system_messages').update(payload).eq('id', id);
    return !error;
  }
};