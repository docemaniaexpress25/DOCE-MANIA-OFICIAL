import { supabase } from '@/lib/supabaseClient';
import { Client } from '@/lib/types';

/** Codigo aleatorio do portal (12 chars) para clientes novos */
function generatePortalCode(): string {
  let hex = '';
  while (hex.length < 12) hex += Math.floor(Math.random() * 16).toString(16);
  return hex.toUpperCase();
}

function mapClient(c: any): Client {
  return {
    ...c,
    nomeFantasia: c.nome_fantasia,
    ativarCnpj: c.ativar_cnpj,
    diaRoteiro: c.dia_roteiro,
    ordem: c.ordem || 0,
    pinLocalizacao: c.pin_localizacao,
    rota: c.rota || 'ROTA_01',
    portalCodigo: c.portal_code,
    // Fiscais (Bloco 10) — podem nao existir antes do SQL
    razaoSocial: c.razao_social || undefined,
    inscricaoEstadual: c.inscricao_estadual || undefined,
    enderecoNumero: c.endereco_numero || undefined,
    enderecoCep: c.endereco_cep || undefined,
    enderecoMunicipio: c.endereco_municipio || undefined,
    enderecoUf: c.endereco_uf || undefined,
  } as Client;
}

export const clientService = {
  async getAllClients(): Promise<Client[]> {
    const { data, error } = await supabase.from('clients').select('*').order('ordem', { ascending: true });
    if (error) {
      console.error('Erro ao buscar clientes:', error);
      return [];
    }
    return data.map(mapClient);
  },

  async insertClient(client: Omit<Client, 'id'>): Promise<Client | null> {
    const { nomeFantasia, nome, ativarCnpj, cnpj, telefone, endereco, bairro, ativo, localizacao, diaRoteiro, ordem, observacoes, pinLocalizacao, rota, razaoSocial, inscricaoEstadual, enderecoNumero, enderecoCep, enderecoMunicipio, enderecoUf } = client;
    const payload: Record<string, unknown> = {
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
      portal_code: generatePortalCode(),
    };
    // Fiscais (Bloco 10): envia com checagem suave — se a coluna ainda nao
    // existir o Supabase rejeita o insert, entao refaz sem elas (fallback).
    const fiscal = {
      razao_social: razaoSocial || null,
      inscricao_estadual: inscricaoEstadual || null,
      endereco_numero: enderecoNumero || null,
      endereco_cep: enderecoCep || null,
      endereco_municipio: enderecoMunicipio || null,
      endereco_uf: enderecoUf || null,
    };

    let { data, error } = await supabase.from('clients').insert({ ...payload, ...fiscal }).select().single();
    if (error && /razao_social|inscricao_estadual|endereco_numero|endereco_cep|endereco_municipio|endereco_uf/i.test(error.message || '')) {
      console.warn('Colunas fiscais ausentes (Bloco 10 nao rodado). Salvando sem elas.');
      ({ data, error } = await supabase.from('clients').insert(payload).select().single());
    }
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
      portalCodigo: data.portal_code,
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
    // Fiscais (Bloco 10)
    if ((updates as Record<string, unknown>).razaoSocial !== undefined) payload.razao_social = (updates as Record<string, unknown>).razaoSocial;
    if ((updates as Record<string, unknown>).inscricaoEstadual !== undefined) payload.inscricao_estadual = (updates as Record<string, unknown>).inscricaoEstadual;
    if ((updates as Record<string, unknown>).enderecoNumero !== undefined) payload.endereco_numero = (updates as Record<string, unknown>).enderecoNumero;
    if ((updates as Record<string, unknown>).enderecoCep !== undefined) payload.endereco_cep = (updates as Record<string, unknown>).enderecoCep;
    if ((updates as Record<string, unknown>).enderecoMunicipio !== undefined) payload.endereco_municipio = (updates as Record<string, unknown>).enderecoMunicipio;
    if ((updates as Record<string, unknown>).enderecoUf !== undefined) payload.endereco_uf = (updates as Record<string, unknown>).enderecoUf;

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
      portalCodigo: data.portal_code,
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