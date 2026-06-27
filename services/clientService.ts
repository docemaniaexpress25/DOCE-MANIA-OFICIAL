import { supabase } from '../supabaseClient';
import { Client } from '../types';

export const clientService = {
  async getAllClients(): Promise<Client[]> {
    const { data, error } = await supabase.from('clients').select('*').order('ordem', { ascending: true });
    if (error) {
      console.error('Erro ao buscar clientes:', error);
      return [];
    }
    return data.map(c => ({
      ...c,
      nomeFantasia: c.nome_fantasia,
      ativarCnpj: c.ativar_cnpj,
      diaRoteiro: c.dia_roteiro,
      ordem: c.ordem || 0,
      pinLocalizacao: c.pin_localizacao,
      rota: c.rota || 'ROTA_01',
    })) as Client[];
  },

  async insertClient(client: Omit<Client, 'id'>): Promise<Client | null> {
    const { nomeFantasia, nome, ativarCnpj, cnpj, telefone, endereco, bairro, ativo, localizacao, diaRoteiro, ordem, observacoes, pinLocalizacao, rota } = client;
    const payload = {
      nome_fantasia: nomeFantasia,
      nome,
      ativar_cnpj: ativarCnpj,
      cnpj,
      telefone,
      endereco,
      bairro,
      ativo,
      localizacao,
      dia_roteiro: diaRoteiro,
      ordem: ordem || 0,
      observacoes,
      pin_localizacao: pinLocalizacao,
      rota: rota || 'ROTA_01',
    };

    const { data, error } = await supabase.from('clients').insert(payload).select().single();
    if (error) {
      console.error('Erro ao inserir cliente:', error);
      return null;
    }
    return {
      ...data,
      nomeFantasia: data.nome_fantasia,
      ativarCnpj: data.ativar_cnpj,
      diaRoteiro: data.dia_roteiro,
      ordem: data.ordem,
      pinLocalizacao: data.pin_localizacao,
      rota: data.rota,
    } as Client;
  },

  async updateClient(id: string, updates: Partial<Client>): Promise<Client | null> {
    const payload: Partial<any> = {}; 
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
    if (updates.ordem !== undefined) payload.ordem = updates.ordem;
    if (updates.observacoes !== undefined) payload.observacoes = updates.observacoes;
    if (updates.pinLocalizacao !== undefined) payload.pin_localizacao = updates.pinLocalizacao;
    if (updates.rota !== undefined) payload.rota = updates.rota;

    const { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
    if (error) {
      console.error('Erro ao atualizar cliente:', error);
      return null;
    }
    return {
      ...data,
      nomeFantasia: data.nome_fantasia,
      ativarCnpj: data.ativar_cnpj,
      diaRoteiro: data.dia_roteiro,
      ordem: data.ordem,
      pinLocalizacao: data.pin_localizacao,
      rota: data.rota,
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