import { supabase } from '../supabaseClient';
import { User, UserRole } from '../types';

export const userService = {
  async getAllUsers(): Promise<User[]> {
    // Busca exclusivamente da tabela 'app_users' para evitar conflito com a tabela interna do Supabase Auth
    const { data, error } = await supabase.from('app_users').select('*');
    if (error) {
      console.error('Erro ao buscar usuários na tabela app_users:', error);
      return [];
    }
    
    // Mapeia os campos do banco para a interface User do TypeScript
    return data.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      role: u.perfil as UserRole, // Mapeia 'perfil' (ADMIN/VENDEDOR) para 'role'
      ativo: !!u.ativo,
      telefone: u.telefone,
      whatsapp: u.whatsapp,
      foto: u.foto,
      pin: u.pin, // Campo PIN para autenticação manual
    })) as User[];
  },

  async insertUser(user: Omit<User, 'id'>): Promise<User | null> {
    // Mapeia 'role' para 'perfil' no payload de inserção
    const { role, ...rest } = user;
    const payload = { 
      ...rest, 
      perfil: role 
    };

    const { data, error } = await supabase.from('app_users').insert(payload).select().single();
    if (error) {
      console.error('Erro ao inserir usuário em app_users:', error);
      return null;
    }
    
    // Retorna o objeto mapeado de volta para o formato da interface User
    return {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.perfil as UserRole,
      ativo: !!data.ativo,
      telefone: data.telefone,
      whatsapp: data.whatsapp,
      foto: data.foto,
      pin: data.pin
    } as User;
  },

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    // Mapeia 'role' para 'perfil' se estiver presente nas atualizações
    const { role, ...rest } = updates;
    const payload: any = { ...rest };
    if (role !== undefined) {
      payload.perfil = role;
    }

    const { data, error } = await supabase.from('app_users').update(payload).eq('id', id).select().single();
    if (error) {
      console.error('Erro ao atualizar usuário em app_users:', error);
      return null;
    }

    // Retorna o objeto mapeado para consistência
    return {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.perfil as UserRole,
      ativo: !!data.ativo,
      telefone: data.telefone,
      whatsapp: data.whatsapp,
      foto: data.foto,
      pin: data.pin
    } as User;
  },
};