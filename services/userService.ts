import { supabase } from '../supabaseClient';
import { User, UserRole } from '../types';

export const userService = {
  async getAllUsers(): Promise<User[]> {
    const { data, error } = await supabase.from('app_users').select('*');
    if (error) {
      console.error('Erro ao buscar usuários na tabela app_users:', error);
      return [];
    }
    
    return data.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      role: u.perfil as UserRole,
      ativo: !!u.ativo,
      telefone: u.telefone,
      whatsapp: u.whatsapp,
      foto: u.foto,
      pin: u.pin,
      placaVeiculo: u.placa_veiculo,
      rota: u.rota || 'ROTA_01',
    })) as User[];
  },

  async insertUser(user: Omit<User, 'id'>): Promise<User | null> {
    const { role, placaVeiculo, rota, ...rest } = user;
    const payload = { 
      ...rest, 
      perfil: role,
      placa_veiculo: placaVeiculo,
      rota: rota || 'ROTA_01'
    };

    const { data, error } = await supabase.from('app_users').insert(payload).select().single();
    if (error) {
      console.error('Erro ao inserir usuário em app_users:', error);
      return null;
    }
    
    return {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.perfil as UserRole,
      ativo: !!data.ativo,
      telefone: data.telefone,
      whatsapp: data.whatsapp,
      foto: data.foto,
      pin: data.pin,
      placaVeiculo: data.placa_veiculo,
      rota: data.rota
    } as User;
  },

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const { role, placaVeiculo, ...rest } = updates;
    const payload: any = { ...rest };
    if (role !== undefined) payload.perfil = role;
    if (placaVeiculo !== undefined) payload.placa_veiculo = placaVeiculo;

    const { data, error } = await supabase.from('app_users').update(payload).eq('id', id).select().single();
    if (error) {
      console.error('Erro ao atualizar usuário em app_users:', error);
      return null;
    }

    return {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.perfil as UserRole,
      ativo: !!data.ativo,
      telefone: data.telefone,
      whatsapp: data.whatsapp,
      foto: data.foto,
      pin: data.pin,
      placaVeiculo: data.placa_veiculo,
      rota: data.rota
    } as User;
  },

  async deleteUser(id: string): Promise<boolean> {
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (error) {
      console.error('Erro ao excluir usuário:', error);
      return false;
    }
    return true;
  }
};