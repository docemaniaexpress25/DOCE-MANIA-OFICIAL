import { supabase } from '../supabaseClient';
import { Client } from '../types';

export const clientService = {
  async getAllClients(): Promise<Client[]> {
    const { data, error } = await supabase.from('clients').select('*');
    if (error) {
      console.error('Erro ao buscar clientes:', error);
      return [];
    }
    // Mapeia de 'snake_case' do DB para 'camelCase' do Type para consistência local
    return data.map(c => ({
      ...c,
      nomeFantasia: c.nome_fantasia,
      ativarCnpj: c.ativar_cnpj,
      diaRoteiro: c.dia_roteiro,
      pinLocalizacao: c.pin_localizacao,
    })) as Client[];
  },

  async insertClient(client: Omit<Client, 'id'>): Promise<Client | null> {
    const { nomeFantasia, nome, ativarCnpj, cnpj, telefone, endereco, bairro, ativo, localizacao, diaRoteiro, observacoes, pinLocalizacao } = client;
    const payload = {
      nome_fantasia: nomeFantasia,
      nome,
      ativar_cnpj: ativarCnpj,
      cnpj,
      telefone,
      endereco,
      bairro,
      ativo,
      localizacao, // JSONB type, might be directly compatible
      dia_roteiro: diaRoteiro,
      observacoes,
      pin_localizacao: pinLocalizacao,
    };

    const { data, error } = await supabase.from('clients').insert(payload).select().single();
    if (error) {
      console.error('Erro ao inserir cliente:', error);
      return null;
    }
    // Mapeia de volta para 'camelCase' para consistência com o tipo local
    return {
      ...data,
      nomeFantasia: data.nome_fantasia,
      ativarCnpj: data.ativar_cnpj,
      diaRoteiro: data.dia_roteiro,
      pinLocalizacao: data.pin_localizacao,
    } as Client;
  },

  async updateClient(id: string, updates: Partial<Client>): Promise<Client | null> {
    const payload: Partial<any> = {}; // Usar 'any' temporariamente para construir o payload dinamicamente
    if (updates.nomeFantasia !== undefined) payload.nome_fantasia = updates.nomeFantasia;
    if (updates.nome !== undefined) payload.nome = updates.nome;
    if (updates.ativarCnpj !== undefined) payload.ativar_cnpj = updates.ativarCnpj;
    if (updates.cnpj !== undefined) payload.cnpj = updates.cnpj;
    if (updates.telefone !== undefined) payload.telefone = updates.telefone;
    if (updates.endereco !== undefined) payload.endereco = updates.endereco;
    if (updates.bairro !== undefined) payload.bairro = updates.bairro;
    if (updates.ativo !== undefined) payload.ativo = updates.ativo;
    if (updates.localizacao !== undefined) payload.localizacao = updates.localizacao;
    if (updates.diaRoteiro !== undefined) payload.dia_roteiro = updates.diaRoteiro;
    if (updates.observacoes !== undefined) payload.observacoes = updates.observacoes;
    if (updates.pinLocalizacao !== undefined) payload.pin_localizacao = updates.pinLocalizacao;

    const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
    if (error) {
      console.error('Erro ao atualizar cliente:', error);
      return null;
    }
    // Mapeia de volta para 'camelCase' para consistência com o tipo local
    return {
      ...data,
      nomeFantasia: data.nome_fantasia,
      ativarCnpj: data.ativar_cnpj,
      diaRoteiro: data.dia_roteiro,
      pinLocalizacao: data.pin_localizacao,
    } as Client;
  },

  async deleteClient(id: string): Promise<boolean> {
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) {
      console.error('Erro ao deletar cliente:', error);
      return false;
    }
    return true;
  },
};