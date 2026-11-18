import { supabase } from '@/lib/supabaseClient';
import { fetchAllPages } from '@/lib/supabaseAll';
import { Client } from '@/lib/types';
// BLOCO 71: cliente ESPECIAL GB só vale nas rotas liberadas (Rota 03 Edipo Pena / Rota 04 Gil Pantoja)
import { podeClienteEspecialGB } from '@/lib/regraClienteGB';

/**
 * BLOCO 181 — PORTAL CLIENTES FISCAIS SEM DUPLICADO (dono: "veja o porque vc
 * duplicou alguns clientes no portal dos clientes! arrume isso agora mesmo!").
 *
 * Causa real (dado de produção, 18/11): a tabela clients tinha 14 grupos
 * duplicados — 24 linhas extras com o MESMO CNPJ (LANCHERIA REGINA 7x,
 * RADICAL GAMES 5x, MINI MERCADO CHIMARRAO 5x, COELHO/KLIPEL 4x...) criadas
 * quando vendedor/admin recadastrava um cliente que já existia: o form do
 * vendedor busca o CNPJ só na RECEITA (BLOCO 138), nunca na base do app, e o
 * INSERT criava uma linha NOVA a cada salvamento. 27 vendas ficaram
 * espalhadas entre linhas duplicadas.
 *
 * A partir deste bloco o insertClient é a PORTA ÚNICA com guardião
 * anti-duplicado: ANTES de inserir ele procura o cliente já existente e, se
 * achar, NÃO cria linha nova — ATUALIZA o cadastro existente preenchendo só
 * os campos VAZIOS (nunca sobrescreve rota/dia/ordem/pin de outro vendedor) e
 * devolve { mesclado: true } para o form avisar na tela.
 *
 * Regras de correspondência (nesta ordem):
 *   1. CNPJ com 14 dígitos -> MESMO CNPJ (dígitos) = mesmo cliente;
 *      se ninguém tem esse CNPJ, cai na regra 2 só quando existente
 *      sem CNPJ tem o mesmo nome (preenche o CNPJ no cadastro antigo).
 *   2. Sem CNPJ válido no form -> MESMO NOME normalizado (maiúsculas, 1
 *      espaço) + existente SEM CNPJ + SEM CONFLITO DUPLO: a mescla só é
 *      reprovada quando telefone E CEP são válidos nos dois lados E
 *      DIFERENTES (outro contato e outro endereço = cliente outro; BAR DA
 *      FATIMA: mesmo CEP/rua com telefone diferente = mesmo cliente).
 */

/** Resultado do insertClient com a verdade do que aconteceu no banco. */
export interface InsercaoClienteResultado {
  /** true = gravou (novo ou mesclado no existente). */
  ok: boolean;
  /** true = JÁ EXISTIA e o cadastro EXISTENTE foi atualizado (nada foi criado). */
  mesclado: boolean;
  /** Nome do cadastro já existente (para o toast do form). */
  nomeExistente?: string;
  cliente?: Client;
  erro?: string;
}

const normTexto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const digitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
/** Dado "válido" para comparar: telefone >= 8 dígitos, CEP = 8. Junk ('0', '') nunca conflita. */
const telValido = (v: unknown): string => { const d = digitos(v); return d.length >= 8 ? d : ''; };
const cepValido = (v: unknown): string => { const d = digitos(v); return d.length === 8 ? d : ''; };

const COLS_DEDUP = 'id, nome_fantasia, nome, ativar_cnpj, cnpj, telefone, endereco, bairro, endereco_cep, endereco_numero, endereco_municipio, endereco_uf, razao_social, inscricao_estadual, email, ativo, localizacao, pin_localizacao, rota, dia_roteiro, ordem, portal_code';

/**
 * Procura o cliente JÁ CADASTRADO que corresponda ao que o form quer salvar —
 * FUNÇÃO PURA sobre as linhas já buscadas (testável, QA BLOCO 181).
 * Devolve a linha escolhida ou null (= pode criar cliente novo).
 */
export function procurarDuplicadoEntre(candidatos: Record<string, unknown>[], client: Omit<Client, 'id'>): Record<string, unknown> | null {
  const cnpjDig = digitos(client.cnpj);
  const nomeNorm = normTexto(client.nomeFantasia || client.nome);
  if (!cnpjDig && !nomeNorm) return null;

  // REGRA 1 — mesmo CNPJ (14 dígitos): a correspondência mais forte.
  if (cnpjDig.length === 14) {
    const mesmoCnpj = candidatos.find((c) => digitos(c.cnpj) === cnpjDig);
    if (mesmoCnpj) return mesmoCnpj;
    // CNPJ novo: só mescla com um MESMO NOME sem CNPJ (preenche o documento
    // no cadastro antigo em vez de criar outro).
    return candidatos.find((c) =>
      !digitos(c.cnpj) && normTexto(c.nome_fantasia || c.nome) === nomeNorm
    ) || null;
  }

  // REGRA 2 — mesmo nome SEM CNPJ e SEM CONFLITO DUPLO: telefone e CEP só
  // reprovam a mescla quando AMBOS são válidos nos dois lados E DIFERENTES
  // (outro contato E outro endereço = cliente outro). Um conflito só (ex.:
  // BAR DA FATIMA — mesmo CEP/rua, telefone diferente por 1 dígito) ainda
  // é o mesmo cliente: mescla e preenche os vazios.
  const telForm = telValido(client.telefone);
  const cepForm = cepValido(client.enderecoCep);
  return candidatos.find((c) => {
    if (digitos(c.cnpj)) return false; // existente tem CNPJ (diferente) — nunca mesclar por nome
    if (normTexto(c.nome_fantasia || c.nome) !== nomeNorm) return false;
    const telEx = telValido(c.telefone);
    const cepEx = cepValido(c.endereco_cep);
    const conflitaTel = !!(telForm && telEx && telForm !== telEx);
    const conflitaCep = !!(cepForm && cepEx && cepForm !== cepEx);
    return !(conflitaTel && conflitaCep);
  }) || null;
}

/**
 * Procura um cliente JÁ CADASTRADO que corresponda ao que o form quer salvar
 * (busca no banco + regras do BLOCO 181). Devolve a linha crua do Supabase ou null.
 */
async function buscarDuplicado(client: Omit<Client, 'id'>): Promise<Record<string, unknown> | null> {
  const cnpjDig = digitos(client.cnpj);
  const nomeNorm = normTexto(client.nomeFantasia || client.nome);
  if (!cnpjDig && !nomeNorm) return null;

  const { data, error } = await supabase.from('clients').select(COLS_DEDUP).limit(2000);
  if (error || !data?.length) return null;
  return procurarDuplicadoEntre(data as Record<string, unknown>[], client);
}

/**
 * Mescle PREENCHENDO VAZIOS (nunca sobrescreve o que o cadastro já tem):
 * rota/dia_roteiro/ordem/pin/localizacao/especial-GB de outro vendedor são
 * preservados — o recadastro só completa dado fiscal/contato que faltava e
 * reativa o cliente. Devolve o patch (vazio = nada a gravar além de ativo).
 */
export function patchMescla(exist: Record<string, unknown>, client: Omit<Client, 'id'>): Record<string, unknown> {
  const patch: Record<string, unknown> = { ativo: true }; // recadastrou = voltou a atender
  const fill = (col: string, valor: unknown, atual: unknown) => {
    const v = String(valor ?? '').trim();
    if (v && !String(atual ?? '').trim()) patch[col] = v;
  };
  fill('nome_fantasia', client.nomeFantasia, exist.nome_fantasia);
  fill('nome', client.nome, exist.nome);
  fill('telefone', client.telefone, exist.telefone);
  fill('endereco', client.endereco, exist.endereco);
  fill('bairro', client.bairro, exist.bairro);
  fill('endereco_numero', client.enderecoNumero, exist.endereco_numero);
  fill('endereco_cep', client.enderecoCep, exist.endereco_cep);
  fill('endereco_municipio', client.enderecoMunicipio, exist.endereco_municipio);
  fill('endereco_uf', client.enderecoUf, exist.endereco_uf);
  fill('razao_social', client.razaoSocial, exist.razao_social);
  fill('inscricao_estadual', client.inscricaoEstadual, exist.inscricao_estadual);
  fill('email', client.email, exist.email);
  fill('observacoes', client.observacoes, exist.observacoes);
  // CNPJ: entra mascarado quando o existente não tem documento.
  fill('cnpj', client.cnpj, exist.cnpj);
  // BLOCO 189: CPF preenche o cadastro antigo que não tinha documento pessoa.
  fill('cpf', client.cpf, exist.cpf);
  if (client.ativarCnpj && !exist.ativar_cnpj) patch.ativar_cnpj = true;
  fill('pin_localizacao', client.pinLocalizacao, exist.pin_localizacao);
  fill('localizacao', client.localizacao, exist.localizacao);
  delete patch.nome_fantasia; // nome NUNCA é alterado pela mescla (id do dono do cadastro)
  return patch;
}

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
    email: c.email || undefined,
    // BLOCO 70: cliente ESPECIAL GB — undefined = SQL ainda nao rodado (trata como normal)
    clienteEspecialGb: c.cliente_especial_gb === true,
    // BLOCO 108: modo cupom — undefined = SQL ainda nao rodado (trata como normal)
    modoCupom: c.modo_cupom === true,
    // BLOCO 189: CPF do cliente (pagador do boleto) — ausente = SQL pendente
    cpf: c.cpf || undefined,
    // BLOCO 190: frequência — ausente/SQL pendente = SEMANAL (comportamento atual)
    frequencia: c.frequencia || 'SEMANAL',
    semanaReferencia: c.semana_referencia || 1,
  } as Client;
}

export const clientService = {
  async getAllClients(): Promise<Client[]> {
    // BLOCO 20: paginado — mantem ordem por 'ordem' com desempate estavel por id
    // EGRESS: colunas explicitas (206 clientes x colunas fiscais em toda recarga).
    // Fallback progressivo ao '*' caso alguma coluna ainda nao exista (SQL pendente).
    const COLS = 'id, nome_fantasia, nome, ativar_cnpj, cnpj, cpf, telefone, endereco, bairro, ativo, localizacao, dia_roteiro, ordem, observacoes, pin_localizacao, rota, portal_code, razao_social, inscricao_estadual, endereco_numero, endereco_cep, endereco_municipio, endereco_uf, email, cliente_especial_gb, modo_cupom, frequencia, semana_referencia';
    let data: any[];
    try {
      data = await fetchAllPages<any>('clients', COLS, { orderCol: 'ordem', ascending: true, tiebreak: true });
    } catch {
      data = await fetchAllPages<any>('clients', '*', { orderCol: 'ordem', ascending: true, tiebreak: true });
    }
    return data.map(mapClient);
  },

  /**
   * BLOCO 181 — INSERT com guardião anti-duplicado: procurou e JÁ EXISTIA?
   * NÃO cria linha nova — atualiza o cadastro existente (fill-blanks) e
   * devolve { ok, mesclado: true, nomeExistente } para o form avisar.
   */
  async insertClient(client: Omit<Client, 'id'>): Promise<InsercaoClienteResultado> {
    // ---- GUARDIÃO ANTI-DUPLICADO (antes de qualquer INSERT) ----
    let duplicado: Record<string, unknown> | null = null;
    try { duplicado = await buscarDuplicado(client); } catch { /* rede — segue o fluxo normal */ }
    if (duplicado?.id) {
      const patch = patchMescla(duplicado, client);
      const idEx = String(duplicado.id);
      const nomeEx = String(duplicado.nome_fantasia || duplicado.nome || '').trim();
      let { data, error } = await supabase.from('clients').update(patch).eq('id', idEx).select().single();
      // Colunas fiscais ausentes (SQL pendente): refaz sem elas — os campos
      // base (telefone/endereco/cnpj...) continuam indo.
      if (error && /razao_social|inscricao_estadual|endereco_numero|endereco_cep|endereco_municipio|endereco_uf|\bemail\b/i.test(error.message || '')) {
        const base = { ...patch };
        delete base.razao_social; delete base.inscricao_estadual;
        delete base.endereco_numero; delete base.endereco_cep;
        delete base.endereco_municipio; delete base.endereco_uf;
        delete base.email;
        ({ data, error } = await supabase.from('clients').update(base).eq('id', idEx).select().single());
      }
      if (error && /\bemail\b/i.test(error.message || '')) {
        const semEmail = { ...patch }; delete semEmail.email;
        ({ data, error } = await supabase.from('clients').update(semEmail).eq('id', idEx).select().single());
      }
      if (error && /localizacao/i.test(error.message || '')) {
        const semGps = { ...patch }; delete semGps.localizacao;
        ({ data, error } = await supabase.from('clients').update(semGps).eq('id', idEx).select().single());
      }
      if (!error && data) {
        return {
          ok: true,
          mesclado: true,
          nomeExistente: nomeEx || 'cliente já cadastrado',
          cliente: mapClient(data),
        };
      }
      if (error) return { ok: false, mesclado: true, nomeExistente: nomeEx, erro: error.message };
    }

    const { nomeFantasia, nome, ativarCnpj, cnpj, telefone, endereco, bairro, ativo, localizacao, diaRoteiro, ordem, observacoes, pinLocalizacao, rota, razaoSocial, inscricaoEstadual, enderecoNumero, enderecoCep, enderecoMunicipio, enderecoUf, email } = client;
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
      // BLOCO 70/71: tipo do cliente — normal (default) ou ESPECIAL GB.
      // BLOCO 71 (regra do dono): o flag só vale nas rotas liberadas — fora
      // delas o cliente nasce/grava sempre NORMAL, independente do form.
      cliente_especial_gb: podeClienteEspecialGB(rota || 'ROTA_01') ? !!client.clienteEspecialGb : false,
      // BLOCO 108: cliente "somente cupom"
      modo_cupom: !!client.modoCupom,
      // BLOCO 189: CPF do pagador do boleto + BLOCO 190: frequência
      cpf: client.cpf || null,
      frequencia: client.frequencia || 'SEMANAL',
      semana_referencia: client.semanaReferencia || 1,
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
      email: email || null,
    };

    let { data, error } = await supabase.from('clients').insert({ ...payload, ...fiscal }).select().single();
    if (error && /razao_social|inscricao_estadual|endereco_numero|endereco_cep|endereco_municipio|endereco_uf|\bemail\b/i.test(error.message || '')) {
      console.warn('Colunas fiscais ausentes (Bloco 10 nao rodado). Salvando sem elas.');
      ({ data, error } = await supabase.from('clients').insert(payload).select().single());
    }
    // clients.localizacao (GPS por mapa) pode nao existir (Bloco 12): refaz sem
    if (error && /localizacao/i.test(error.message || '')) {
      const semGps = { ...payload }; delete semGps.localizacao;
      ({ data, error } = await supabase.from('clients').insert(semGps).select().single());
    }
    // BLOCO 70: cliente_especial_gb pode nao existir (SQL pendente): refaz sem
    if (error && /cliente_especial_gb/i.test(error.message || '')) {
      console.warn('Coluna cliente_especial_gb ausente (Bloco 69 nao rodado). Salvando sem ela.');
      const semGb = { ...payload }; delete semGb.cliente_especial_gb;
      ({ data, error } = await supabase.from('clients').insert(semGb).select().single());
    }
    // BLOCO 108: modo_cupom pode nao existir (SQL pendente): refaz sem
    if (error && /modo_cupom/i.test(error.message || '')) {
      console.warn('Coluna modo_cupom ausente (Bloco 108 nao rodado). Salvando sem ela.');
      const semCupom = { ...payload }; delete semCupom.modo_cupom;
      ({ data, error } = await supabase.from('clients').insert(semCupom).select().single());
    }
    // BLOCO 189/190: cpf/frequencia/semana_referencia podem nao existir ainda
    if (error && /\bcpf\b|frequencia|semana_referencia/i.test(error.message || '')) {
      console.warn('Colunas cpf/frequencia ausentes (Bloco 189/190 nao rodado). Salvando sem elas.');
      const semNovos = { ...payload }; delete semNovos.cpf; delete semNovos.frequencia; delete semNovos.semana_referencia;
      ({ data, error } = await supabase.from('clients').insert(semNovos).select().single());
    }
    if (error) {
      console.error('Erro ao inserir cliente:', error);
      return { ok: false, mesclado: false, erro: error.message };
    }
    return {
      ok: true,
      mesclado: false,
      cliente: {
      ...data,
      nomeFantasia: data.nome_fantasia,
      ativarCnpj: data.ativar_cnpj,
      diaRoteiro: data.dia_roteiro,
      ordem: data.ordem,
      pinLocalizacao: data.pin_localizacao,
      rota: data.rota,
      portalCodigo: data.portal_code,
      } as Client,
    };
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
    if ((updates as Record<string, unknown>).email !== undefined) payload.email = (updates as Record<string, unknown>).email || null;
    // BLOCO 70: tipo do cliente (normal | especial GB) — só grava quando o form envia.
    // BLOCO 71 (regra do dono): guarda pela rota — o Admin e o Vendedor mandam
    // sempre a rota junto com o flag. Se a rota não veio no update, o flag
    // NÃO é alterado aqui (comportamento neutro: não quebra updates fiscais/GPS).
    if (updates.clienteEspecialGb !== undefined && updates.rota !== undefined) {
      payload.cliente_especial_gb = podeClienteEspecialGB(updates.rota) ? !!updates.clienteEspecialGb : false;
    }
    // BLOCO 108: cliente "somente cupom"
    if (updates.modoCupom !== undefined) payload.modo_cupom = !!updates.modoCupom;
    // BLOCO 189/190: CPF do pagador + frequência de atendimento
    if (updates.cpf !== undefined) payload.cpf = updates.cpf || null;
    if (updates.frequencia !== undefined) payload.frequencia = updates.frequencia || 'SEMANAL';
    if (updates.semanaReferencia !== undefined) payload.semana_referencia = updates.semanaReferencia || 1;

    let { data, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
    // BLOCO 76 (bug do dono): CNPJ/edicao do cliente nao salvava no app do
    // vendedor. Causa: UPDATE cai no erro de coluna fiscal ausente (SQL do
    // Bloco 12 nao rodado) e so havia retry para email — razao_social,
    // inscricao_estadual, endereco_numero/cep/municipio/uf abortavam o update
    // INTEIRO (e o form fechava como se tivesse salvo). Agora: qualquer
    // falha dessas refaz o update SEM todas as fiscais (cnpj/telefone/
    // endereco etc. continuam indo — sao colunas base, nunca descartadas).
    if (error && /razao_social|inscricao_estadual|endereco_numero|endereco_cep|endereco_municipio|endereco_uf|\bemail\b/i.test(error.message || '')) {
      console.warn('BLOCO 76: colunas fiscais ausentes — refazendo update sem elas.');
      const semFiscais = { ...payload };
      delete semFiscais.razao_social; delete semFiscais.inscricao_estadual;
      delete semFiscais.endereco_numero; delete semFiscais.endereco_cep;
      delete semFiscais.endereco_municipio; delete semFiscais.endereco_uf;
      delete semFiscais.email;
      ({ data, error } = await supabase.from('clients').update(semFiscais).eq('id', id).select().single());
    }
    if (error && /\bemail\b/i.test(error.message || '')) {
      const fallback = { ...payload }; delete fallback.email;
      ({ data, error } = await supabase.from('clients').update(fallback).eq('id', id).select().single());
    }
    if (error && /localizacao/i.test(error.message || '')) {
      const fallback2 = { ...payload }; delete fallback2.localizacao;
      ({ data, error } = await supabase.from('clients').update(fallback2).eq('id', id).select().single());
    }
    // BLOCO 70: cliente_especial_gb pode nao existir (SQL pendente): refaz sem
    if (error && /cliente_especial_gb/i.test(error.message || '')) {
      console.warn('Coluna cliente_especial_gb ausente (Bloco 69 nao rodado). Salvando sem ela.');
      const fallback3 = { ...payload }; delete fallback3.cliente_especial_gb;
      ({ data, error } = await supabase.from('clients').update(fallback3).eq('id', id).select().single());
    }
    // BLOCO 108: modo_cupom pode nao existir (SQL pendente): refaz sem
    if (error && /modo_cupom/i.test(error.message || '')) {
      console.warn('Coluna modo_cupom ausente (Bloco 108 nao rodado). Salvando sem ela.');
      const fallback4 = { ...payload }; delete fallback4.modo_cupom;
      ({ data, error } = await supabase.from('clients').update(fallback4).eq('id', id).select().single());
    }
    // BLOCO 189/190: cpf/frequencia/semana_referencia podem nao existir ainda
    if (error && /\bcpf\b|frequencia|semana_referencia/i.test(error.message || '')) {
      console.warn('Colunas cpf/frequencia ausentes (Bloco 189/190 nao rodado). Salvando sem elas.');
      const fallback5 = { ...payload }; delete fallback5.cpf; delete fallback5.frequencia; delete fallback5.semana_referencia;
      ({ data, error } = await supabase.from('clients').update(fallback5).eq('id', id).select().single());
    }
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

  /**
   * Bloco 12: exclusao de cliente via API server-side (service role).
   * Antes: delete direto pelo browser com chave anon — o RLS do Supabase
   * bloqueava e o admin nunca conseguia excluir.
   * Cliente com vendas no historico NAO e excluido (FK) — e desativado.
   */
  async deleteClient(id: string): Promise<{ ok: boolean; desativado?: boolean; erro?: string }> {
    const { authHeaders } = await import('@/services/userService');
    try {
      const res = await fetch('/api/clientes/excluir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ clientId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        return { ok: false, desativado: !!data.desativado, erro: data.erro || `Erro ${res.status} ao excluir.` };
      }
      return { ok: true };
    } catch {
      return { ok: false, erro: 'Falha de conexao ao excluir o cliente.' };
    }
  },
};