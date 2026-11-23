"use client";

/**
 * BLOCO 174 — PORTAL DE CLIENTES FISCAIS (admin, fora do app) — gêmeo do
 * /fiscal-produtos, pedido do dono: "crie um portal identido ao de produtos
 * porem de clientes para eu poder editar dados dos clientes! coloque somente
 * informaçoes relevantes ao fiscal tbm o nome e cep editaveis".
 *
 * BLOCO 176 (erro ao bater a nota: "Element 'nro' not expected. Expected is
 * 'xLgr'" — clientes com nº preenchido e SEM logradouro, ex. MERCADO DALAGE):
 * agora o portal EDITA o ENDEREÇO FISCAL INTEIRO do destinatário — logradouro,
 * número, bairro, município e UF — porque a NF-e identificada só sobe com o
 * endereço COMPLETO do cadastro. O dono corrige aqui e bate a nota.
 *
 * BLOCO 178 (dono: "no momento que digitar faça a busca automatica do endereço
 * completo e preencha, o mesmo vale para o cnpj — todos esses campos devem
 * poder ser editados"):
 *  - CEP com PREENCHIMENTO AUTOMÁTICO: digita os 8 dígitos -> ViaCEP (Correios)
 *    preenche LOGRADOURO, BAIRRO, MUNICÍPIO e UF da linha na hora (debounce,
 *    spinner e feedback inline; não rebusca o mesmo CEP; falha permite tentar
 *    de novo);
 *  - CNPJ com PREENCHIMENTO AUTOMÁTICO: digita os 14 dígitos -> /api/cnpj
 *    (Receita/BrasilAPI, MESMA rota do cadastro) preenche RAZÃO SOCIAL,
 *    LOGRADOURO, NÚMERO, BAIRRO, MUNICÍPIO, UF e CEP. CPF (11) não tem consulta
 *    pública — feedback discreto explica que o endereço completa pelo CEP;
 *  - TUDO EDITÁVEL: NOME, CPF/CNPJ, CEP, RAZÃO SOCIAL e IE (antes só leitura)
 *    entraram na lista de inputs — a Receita puxa e o dono ajusta por cima.
 *
 * BLOCO 179 (dono: "otimize o portal dos clientes, esta pessimo fazer a ediçao,
 * nao conseguimos visualizar e editar as informaçoes que estao no canto,
 * diminua o espaço para nome da cidade, otimize isso. veja quem ja esta com o
 * cep e ja preencha"):
 *  - PLANILHA REORDENADA: o bloco de ENDEREÇO agora é VIZINHO do CEP —
 *    CEP -> LOGRADOURO -> Nº -> BAIRRO -> CIDADE -> UF — o que os Correios
 *    preenchem aparece na frente do dono (antes ficava no canto direito,
 *    fora da tela, depois de razão social/IE);
 *  - PLANILHA MENOR: largura total 2400 -> ~1295px (cabe na tela do PC SEM
 *    rolagem horizontal) e a coluna CIDADE diminuiu (150 -> 105px fixo — o
 *    nome longo rola DENTRO do input); "Município" virou "Cidade";
 *  - LOTE "PREENCHER": um clique vê quem JÁ TEM CEP e está com o endereço
 *    incompleto (chip "CEP sem endereço" + barra teal com o botão) e os
 *    CORREIOS completam TODOS de uma vez — preenche SÓ os campos VAZIOS
 *    (nunca sobrescreve o que o dono digitou) e grava direto no cadastro,
 *    com progresso x/y no botão;
 *  - cabeçalhos enxutos (tudo já é editável desde o 178) — dica só fica no
 *    CEP (Correios) e no CPF/CNPJ (Receita).
 *
 * MESMA linguagem do PORTAL FISCAL (/notas) e de PRODUTOS FISCAIS
 * (/fiscal-produtos):
 *  - PIN do admin (6 dígitos) — MESMA SESSÃO do portal fiscal (token /notas);
 *  - TABELA PLANILHA: TODO o cadastro, uma linha por cliente, com SÓ o que a
 *    NF-e/NFC-e (destinatário) e o BOLETO do Inter usam;
 *  - EDITÁVEIS: NOME (obrigatório), CEP (8 dígitos), LOGRADOURO, NÚMERO,
 *    BAIRRO, MUNICÍPIO (até 60, limite SEFAZ) e UF (2 letras);
 *  - SOMENTE LEITURA: razão social, CNPJ e IE — para conferir o cadastro;
 *  - EDIÇÃO DIRETA: digita, a linha marca alterada (âmbar); ENTER salva a
 *    linha; SALVAR TUDO grava todas as alteradas de uma vez;
 *  - FILTROS: busca por nome/razão/CNPJ/município/CEP + chips (sem CEP,
 *    SEM LOGRADOURO, SEM MUNICÍPIO, sem CNPJ, sem IE, inativos); KPIs;
 *  - ALERTAS honestos: sem CEP trava o BOLETO (pede na mão); sem logradouro
 *    /município trava a NF-e IDENTIFICADA (erro de schema na Focus);
 *  - EXPORTAR CSV da lista filtrada (Excel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PortalPinGate from '@/components/doce/PortalPinGate';
// BLOCO 177: o CPF/CNPJ virou EDITÁVEL no portal — boleto a prazo do cliente
// PF precisa do CPF (nfe = cnpj, nfc > cpf — regra do dono).
import { validaCpfCnpj } from '@/lib/validaDoc';
// BLOCO 178: busca do CEP nos CORREIOS (ViaCEP) — a mesma util do cadastro do
// app (AdminDashboard/VendedorDashboard), pura e sem estado.
import { buscarCep } from '@/lib/endereco';

// ---------------- tipos ----------------
interface ClienteFiscal {
  id: string;
  nome: string;
  razaoSocial: string;
  cnpj: string;
  ie: string;
  cep: string;
  municipio: string;
  uf: string;
  endereco: string;
  numero: string;
  bairro: string;
  ativo: boolean;
}

type CKey = 'nome' | 'doc' | 'cep' | 'razaoSocial' | 'ie' | 'endereco' | 'numero' | 'bairro' | 'municipio' | 'uf';

/** BLOCO 178: TODOS os campos do portal são editáveis (Razão Social e IE entrou). */
const CAMPOS_EDIT: CKey[] = ['nome', 'doc', 'cep', 'razaoSocial', 'ie', 'endereco', 'numero', 'bairro', 'municipio', 'uf'];

/** Campo do cliente que cada CKey edita (doc = CPF/CNPJ no MESMO campo cnpj). */
const CAMPO_CLIENTE: Record<CKey, 'nome' | 'cnpj' | 'cep' | 'razaoSocial' | 'ie' | 'endereco' | 'numero' | 'bairro' | 'municipio' | 'uf'> = {
  nome: 'nome', doc: 'cnpj', cep: 'cep', razaoSocial: 'razaoSocial', ie: 'ie', endereco: 'endereco', numero: 'numero', bairro: 'bairro', municipio: 'municipio', uf: 'uf',
};

interface Stats {
  total: number;
  ativos: number;
  comCep: number;
  semCep: number;
  comCnpj: number;
  semCnpj: number;
  comIe: number;
  comMunicipio: number;
  semEndereco: number;
  semMunicipio: number;
}

type Filtro = 'TODOS' | 'SEM_CEP' | 'SEM_ENDERECO' | 'SEM_MUNICIPIO' | 'SEM_CNPJ' | 'SEM_IE' | 'INATIVOS' | 'CEP_SEM_ENDERECO';

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

/** Máscara progressiva de CEP: 95034240 -> 95034-240 */
function mascararCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * BLOCO 177: máscara progressiva do CPF/CNPJ (mesmo campo):
 * 000.000.000-00 (11) ou 00.000.000/0000-00 (14).
 */
function mascararDoc(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d{1,2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Validação espelhada da API — devolve erro por campo (vazio = limpa o campo,
 * menos o NOME que é obrigatório). Limites do schema SEFAZ: 60 caracteres.
 */
function erroDeCampo(campo: CKey, valor: string): string {
  const v = valor.trim().replace(/\s+/g, ' ');
  if (campo === 'nome') return !v ? 'obrigatório' : (v.length > 120 ? 'máx. 120 caracteres' : '');
  // BLOCO 177: CPF (11) ou CNPJ (14) com dígito verificador válido — o que
  // o BOLETO do Inter usa como pagador (o Inter recusa documento inválido).
  if (campo === 'doc') {
    const d = v.replace(/\D/g, '');
    if (!d) return '';
    if (d.length !== 11 && d.length !== 14) return 'CPF 11 ou CNPJ 14 dígitos';
    return validaCpfCnpj(d) ? '' : 'dígito verificador inválido';
  }
  if (campo === 'cep') {
    const d = v.replace(/\D/g, '');
    return d && d.length !== 8 ? '8 dígitos' : '';
  }
  if (campo === 'uf') {
    const u = v.toUpperCase().replace(/[^A-Z]/g, '');
    return u && u.length !== 2 ? '2 letras (RS)' : '';
  }
  // BLOCO 178: Razão Social (120) e IE (20, aceita ISENTO) — vazio = limpa.
  if (campo === 'razaoSocial') return v.length > 120 ? 'máx. 120 caracteres' : '';
  if (campo === 'ie') return v.length > 20 ? 'máx. 20 caracteres' : '';
  return v.length > 60 ? 'máx. 60 caracteres' : '';
}

interface LinhaEstado {
  salvando?: boolean;
  salvoEm?: number;
  erro?: string;
}

/** BLOCO 178: estado do preenchimento automático de UMA célula (CEP ou doc). */
interface BuscaEstado {
  buscando?: boolean;
  msg?: string;
  msgOk?: boolean;
}

interface ConfModal {
  titulo: string;
  texto: string;
  detalhe?: string;
  icone: string;
  botao: string;
  run: () => Promise<void> | void;
}

// ---------------- página ----------------
export default function PortalClientesFiscaisPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [booting, setBooting] = useState(true);

  // PIN gate
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);

  // Dados
  const [clientes, setClientes] = useState<ClienteFiscal[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState('');

  // Edição (apenas os campos alterados por cliente)
  const [edits, setEdits] = useState<Record<string, Partial<Record<CKey, string>>>>({});
  const [linha, setLinha] = useState<Record<string, LinhaEstado>>({});

  // BLOCO 178: feedback do PREENCHIMENTO AUTOMÁTICO (CEP/CNPJ) por linha.
  // Chave `${id}:cep` | `${id}:doc` -> estado { buscando, msg, msgOk }.
  const [buscas, setBuscas] = useState<Record<string, BuscaEstado>>({});
  const buscaTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** Último CEP/CNPJ que preencheu a linha com sucesso — evita rebuscar e sobrescrever edições. */
  const buscaFeitaOk = useRef<Record<string, string>>({});
  /** Último valor digitado — só limpa o feedback quando o valor muda de verdade. */
  const ultimoDigitado = useRef<Record<string, string>>({});

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('TODOS');

  // Salvar tudo
  const [salvandoTudo, setSalvandoTudo] = useState(false);
  const [conf, setConf] = useState<ConfModal | null>(null);
  // BLOCO 179: progresso do preenchimento em LOTE pelo CEP (feito de total).
  const [lote, setLote] = useState<{ done: number; total: number } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const headers = (t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

  // ---------- boot: retomar sessão (MESMA do portal fiscal /notas) ----------
  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const n = localStorage.getItem(NOME_KEY) || '';
      if (t) { setToken(t); setNomeAdmin(n); }
    } catch { /* storage bloqueado */ }
    setBooting(false);
  }, []);

  // ---------- carregar lista ----------
  const carregar = useCallback(async (t: string) => {
    setCarregando(true);
    setErroLista('');
    try {
      const res = await fetch('/api/clientes-fiscal', { headers: headers(t), cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (res.status === 401 || res.status === 403) {
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
        setToken(null); setNomeAdmin('');
        setErroLista('Sessão expirada. Entre com o PIN novamente.');
        return;
      }
      if (!res.ok || !d?.ok) { setErroLista(d?.erro || `Erro ${res.status}`); return; }
      setClientes((d.clientes || []) as ClienteFiscal[]);
      setEdits({});
      setLinha({});
      setBuscas({});
      buscaFeitaOk.current = {};
      ultimoDigitado.current = {};
      Object.values(buscaTimers.current).forEach(t => clearTimeout(t));
      buscaTimers.current = {};
    } catch {
      setErroLista('Falha de conexão. Toque em ATUALIZAR.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (token) void carregar(token);
  }, [token, carregar]);

  // ---------- PIN ----------
  const entrarComPin = useCallback(async (pinFinal: string) => {
    if (pinBusy) return;
    setPinBusy(true);
    setPinErro('');
    try {
      const res = await fetch('/api/notas-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'AUTH', pin: pinFinal }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.token) {
        try {
          localStorage.setItem(TOKEN_KEY, data.token);
          localStorage.setItem(NOME_KEY, data.nome || '');
        } catch {}
        setToken(data.token);
        setNomeAdmin(data.nome || '');
        setPin('');
      } else {
        setPinErro(data.erro || 'PIN incorreto. Tente novamente.');
        setPin('');
        setPinShake(true);
        setTimeout(() => setPinShake(false), 500);
      }
    } catch {
      setPinErro('Falha de conexão. Tente novamente.');
      setPin('');
    } finally {
      setPinBusy(false);
    }
  }, [pinBusy]);

  const digitar = (d: string) => {
    if (pinBusy) return;
    setPinErro('');
    const proximo = (pin + d).slice(0, 8);
    setPin(proximo);
    if (proximo.length === 6) void entrarComPin(proximo);
  };

  const apagar = () => { setPinErro(''); setPin(p => p.slice(0, -1)); };

  const sair = () => {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
    setToken(null); setNomeAdmin(''); setClientes([]); setEdits({}); setBusca('');
  };

  // ---------- helpers de edição ----------
  const valorDe = useCallback((c: ClienteFiscal, campo: CKey): string => {
    const e = edits[c.id];
    if (e && e[campo] !== undefined) return String(e[campo]);
    return String(c[CAMPO_CLIENTE[campo]] ?? '');
  }, [edits]);

  const alteradoDe = useCallback((c: ClienteFiscal, campo: CKey): boolean => {
    const e = edits[c.id];
    if (!e || e[campo] === undefined) return false;
    return String(e[campo]) !== String(c[CAMPO_CLIENTE[campo]] ?? '');
  }, [edits]);

  const setValor = (c: ClienteFiscal, campo: CKey, bruto: string) => {
    // máscara na digitação: nome/razão social 120 colapsado; CEP 00000-000;
    // CPF/CNPJ com pontuação; UF 2 letras uppercase; IE até 20; demais textos
    // até 60 (limite SEFAZ)
    let v: string;
    if (campo === 'nome') v = bruto.replace(/\s+/g, ' ').slice(0, 120);
    else if (campo === 'razaoSocial') v = bruto.replace(/\s+/g, ' ').slice(0, 120);
    else if (campo === 'ie') v = bruto.replace(/\s+/g, ' ').slice(0, 20);
    else if (campo === 'cep') v = mascararCep(bruto);
    else if (campo === 'doc') v = mascararDoc(bruto);
    else if (campo === 'uf') v = bruto.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    else v = bruto.replace(/\s+/g, ' ').slice(0, 60);
    setEdits(prev => ({ ...prev, [c.id]: { ...(prev[c.id] || {}), [campo]: v } }));
    setLinha(prev => ({ ...prev, [c.id]: { ...prev[c.id], erro: undefined } }));
  };

  const linhasAlteradas = useMemo(
    () => clientes.filter(c => CAMPOS_EDIT.some(k => alteradoDe(c, k))),
    [clientes, alteradoDe],
  );

  const linhasComErro = useMemo(() => {
    const ids: string[] = [];
    for (const c of linhasAlteradas) {
      const comErro = CAMPOS_EDIT.some(k => alteradoDe(c, k) && erroDeCampo(k, valorDe(c, k)));
      if (comErro) ids.push(c.id);
    }
    return new Set(ids);
  }, [linhasAlteradas, alteradoDe, valorDe]);

  // ---------- salvar UMA linha ----------
  const salvarLinha = useCallback(async (c: ClienteFiscal): Promise<boolean> => {
    if (!token) return false;
    const patch: Record<string, string> = {};
    for (const k of CAMPOS_EDIT) {
      if (alteradoDe(c, k)) {
        const err = erroDeCampo(k, valorDe(c, k));
        if (err) { setLinha(prev => ({ ...prev, [c.id]: { erro: `${k.toUpperCase()}: ${err}` } })); return false; }
        // BLOCO 177: o campo do documento vai como 'documento' na API
        patch[k === 'doc' ? 'documento' : k] = valorDe(c, k);
      }
    }
    if (Object.keys(patch).length === 0) return true;
    setLinha(prev => ({ ...prev, [c.id]: { salvando: true } }));
    try {
      const res = await fetch('/api/clientes-fiscal', { method: 'PATCH', headers: headers(token), body: JSON.stringify({ id: c.id, ...patch }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setLinha(prev => ({ ...prev, [c.id]: { erro: d?.erro || `Erro ${res.status}` } }));
        return false;
      }
      const salvo = d.cliente as ClienteFiscal;
      setClientes(prev => prev.map(x => (x.id === salvo.id ? salvo : x)));
      setEdits(prev => { const n = { ...prev }; delete n[salvo.id]; return n; });
      setLinha(prev => ({ ...prev, [c.id]: { salvoEm: Date.now() } }));
      // BLOCO 178: feedback de busca consumido após gravar — a linha vai para "salvo".
      setBuscas(prev => {
        const n = { ...prev };
        delete n[`${salvo.id}:cep`];
        delete n[`${salvo.id}:doc`];
        return n;
      });
      return true;
    } catch {
      setLinha(prev => ({ ...prev, [c.id]: { erro: 'Sem conexão.' } }));
      return false;
    }
  }, [token, alteradoDe, valorDe]);

  // ---------- SALVAR TUDO ----------
  const salvarTudo = () => {
    const alvos = linhasAlteradas.filter(c => !linhasComErro.has(c.id));
    if (alvos.length === 0) {
      showToast(linhasAlteradas.length ? 'Corrija os campos marcados em vermelho antes de salvar.' : 'Nenhuma alteração pendente.', false);
      return;
    }
    setConf({
      titulo: 'Salvar tudo?',
      texto: `${alvos.length} cliente(s) com alterações serão gravados no cadastro.`,
      detalhe: 'Nome, CPF/CNPJ, CEP e ENDEREÇO FISCAL gravados aqui são o que a NF-e usa no destinatário e o que o BOLETO do Inter puxa (CPF do pagador a prazo). Linhas com erro de digitação não são gravadas.',
      icone: 'fa-floppy-disk',
      botao: `Salvar ${alvos.length} cliente(s)`,
      run: async () => {
        setSalvandoTudo(true);
        let ok = 0; let falha = 0;
        for (const c of alvos) {
          const r = await salvarLinha(c);
          if (r) ok += 1; else falha += 1;
        }
        setSalvandoTudo(false);
        if (falha === 0) showToast(`Salvo! ${ok} cliente(s) atualizado(s).`, true);
        else showToast(`${ok} salvo(s), ${falha} com erro — veja as linhas em vermelho.`, false);
      },
    });
  };

  const descartarTudo = () => {
    if (linhasAlteradas.length === 0) return;
    setConf({
      titulo: 'Descartar alterações?',
      texto: `${linhasAlteradas.length} linha(s) alteradas voltam ao que está gravado no banco.`,
      icone: 'fa-rotate-left',
      botao: 'Descartar',
      run: () => { setEdits({}); setLinha({}); setBuscas({}); showToast('Alterações descartadas.'); },
    });
  };

  // -----------------------------------------------------------------
  // BLOCO 178 — PREENCHIMENTO AUTOMÁTICO (pedido do dono: "no momento
  // que digitar faça a busca automatica do endereço completo e preencha,
  // o mesmo vale para o cnpj"):
  //  · CEP (8 dígitos) -> ViaCEP/Correios -> logradouro, bairro, município, UF;
  //  · CNPJ (14 dígitos com DV válido) -> /api/cnpj (Receita) -> razão social,
  //    logradouro, número, bairro, município, UF e CEP;
  //  · CPF (11) não tem consulta pública — feedback discreto orienta pelo CEP;
  //  · debounce curto, spinner e mensagem INLINE na célula; não rebusca o
  //    mesmo valor que já preencheu (protege edições manuais); falha permite
  //    apagar e digitar de novo.
  // -----------------------------------------------------------------
  const setBuscaEstado = (id: string, campo: 'cep' | 'doc', st: Partial<BuscaEstado>) => {
    const key = `${id}:${campo}`;
    setBuscas(prev => ({ ...prev, [key]: { campo, ...(prev[key] || {}), ...st } }));
  };

  const buscarCepPara = async (c: { id: string }, d: string) => {
    setBuscaEstado(c.id, 'cep', { buscando: true, msg: undefined, msgOk: undefined });
    const r = await buscarCep(d);
    if (r.ok) {
      buscaFeitaOk.current[`${c.id}:cep`] = d;
      setEdits(prev => {
        const cur = prev[c.id] || {};
        const prox = { ...cur };
        if (r.logradouro) prox.endereco = r.logradouro.replace(/\s+/g, ' ').slice(0, 60);
        if (r.bairro) prox.bairro = r.bairro.replace(/\s+/g, ' ').slice(0, 60);
        if (r.cidade) prox.municipio = r.cidade.replace(/\s+/g, ' ').slice(0, 60);
        if (r.uf) prox.uf = r.uf.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
        return { ...prev, [c.id]: prox };
      });
      const partes = [r.logradouro, r.bairro, r.cidade ? `${r.cidade}/${r.uf}` : ''].filter(Boolean).join(' · ');
      setBuscaEstado(c.id, 'cep', { buscando: false, msgOk: true, msg: `Correios preencheram: ${partes || 'CEP válido'}` });
    } else {
      setBuscaEstado(c.id, 'cep', { buscando: false, msgOk: false, msg: r.erro || 'CEP não encontrado — corrija ou preencha na mão.' });
    }
  };

  const buscarCnpjPara = async (c: { id: string }, d: string, tk: string) => {
    setBuscaEstado(c.id, 'doc', { buscando: true, msg: undefined, msgOk: undefined });
    try {
      const res = await fetch(`/api/cnpj?cnpj=${encodeURIComponent(d)}`, { headers: { Authorization: `Bearer ${tk}` } });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || !data?.ok) {
        setBuscaEstado(c.id, 'doc', { buscando: false, msgOk: false, msg: String(data?.erro || 'CNPJ não encontrado na Receita — preencha na mão.') });
        return;
      }
      buscaFeitaOk.current[`${c.id}:doc`] = d;
      setEdits(prev => {
        const cur = prev[c.id] || {};
        const prox = { ...cur };
        if (data.razaoSocial) prox.razaoSocial = String(data.razaoSocial).replace(/\s+/g, ' ').slice(0, 120);
        if (data.endereco) prox.endereco = String(data.endereco).replace(/\s+/g, ' ').slice(0, 60);
        if (data.numero) prox.numero = String(data.numero).slice(0, 60);
        if (data.bairro) prox.bairro = String(data.bairro).replace(/\s+/g, ' ').slice(0, 60);
        if (data.municipio) prox.municipio = String(data.municipio).replace(/\s+/g, ' ').slice(0, 60);
        if (data.uf) prox.uf = String(data.uf).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
        const cepD = String(data.cep || '').replace(/\D/g, '');
        if (cepD.length === 8) prox.cep = `${cepD.slice(0, 5)}-${cepD.slice(5)}`;
        return { ...prev, [c.id]: prox };
      });
      const extras = [data.situacao ? String(data.situacao) : '', data.simples ? 'Simples Nacional' : '', data.mei ? 'MEI' : ''].filter(Boolean).join(' · ');
      const nomeReceita = String(data.razaoSocial || data.nomeFantasia || 'dados recebidos');
      setBuscaEstado(c.id, 'doc', {
        buscando: false,
        msgOk: data.situacaoOk !== false,
        msg: `Receita: ${nomeReceita}${extras ? ` — ${extras}` : ''} · endereço preenchido`,
      });
    } catch {
      setBuscaEstado(c.id, 'doc', { buscando: false, msgOk: false, msg: 'Falha de conexão ao consultar o CNPJ. Digite de novo para tentar.' });
    }
  };

  /** onChange do CEP: máscara + debounce + busca automática nos Correios. */
  const aoDigitarCep = (c: ClienteFiscal, bruto: string) => {
    setValor(c, 'cep', bruto);
    const d = bruto.replace(/\D/g, '');
    const key = `${c.id}:cep`;
    if (ultimoDigitado.current[key] !== d) {
      ultimoDigitado.current[key] = d;
      setBuscaEstado(c.id, 'cep', { msg: undefined, msgOk: undefined });
    }
    if (d.length !== 8) return;
    if (buscaFeitaOk.current[key] === d) return; // já preencheu com esse CEP
    clearTimeout(buscaTimers.current[key]);
    buscaTimers.current[key] = setTimeout(() => void buscarCepPara(c, d), 450);
  };

  /** onChange do CPF/CNPJ: máscara + debounce + consulta na Receita (CNPJ 14). */
  const aoDigitarDoc = (c: ClienteFiscal, bruto: string, tk: string) => {
    setValor(c, 'doc', bruto);
    const d = bruto.replace(/\D/g, '');
    const key = `${c.id}:doc`;
    if (ultimoDigitado.current[key] !== d) {
      ultimoDigitado.current[key] = d;
      setBuscaEstado(c.id, 'doc', { msg: undefined, msgOk: undefined });
    }
    if (d.length === 11) {
      // CPF: sem consulta pública — orienta o dono pelo CEP.
      if (validaCpfCnpj(d)) setBuscaEstado(c.id, 'doc', { msgOk: true, msg: 'CPF ok — a Receita não abre consulta de CPF; o CEP preenche o endereço.' });
      return;
    }
    if (d.length !== 14) return;
    if (buscaFeitaOk.current[key] === d) return;
    if (!validaCpfCnpj(d)) return; // DV inválido: erro já aparece no campo
    clearTimeout(buscaTimers.current[key]);
    buscaTimers.current[key] = setTimeout(() => void buscarCnpjPara(c, d, tk), 500);
  };

  // ---------- filtros ----------
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    return clientes.filter(c => {
      if (filtro === 'SEM_CEP' && c.cep) return false;
      // BLOCO 179: "CEP sem endereço" — JÁ tem CEP (8 dígitos) e está com
      // rua, bairro, cidade ou UF vazia (são os alvos do botão PREENCHER).
      if (filtro === 'CEP_SEM_ENDERECO' && !(c.cep.replace(/\D/g, '').length === 8 && (!c.endereco || !c.bairro || !c.municipio || !c.uf))) return false;
      if (filtro === 'SEM_ENDERECO' && c.endereco) return false;
      if (filtro === 'SEM_MUNICIPIO' && c.municipio) return false;
      if (filtro === 'SEM_CNPJ' && c.cnpj) return false;
      if (filtro === 'SEM_IE' && c.ie) return false;
      if (filtro === 'INATIVOS' && c.ativo) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.razaoSocial.toLowerCase().includes(q) ||
        (c.cnpj && c.cnpj.toLowerCase().includes(q)) ||
        (c.cnpj && digitos.length >= 3 && c.cnpj.replace(/\D/g, '').includes(digitos)) ||
        (c.municipio && c.municipio.toLowerCase().includes(q)) ||
        (c.endereco && c.endereco.toLowerCase().includes(q)) ||
        (digitos.length >= 3 && c.cep.replace(/\D/g, '').includes(digitos))
      );
    });
  }, [clientes, busca, filtro]);

  const chipFiltro = (f: Filtro, label: string, count: number, cor: string) => (
    <button
      onClick={() => setFiltro(f)}
      className={`px-3 h-8 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all whitespace-nowrap ${filtro === f ? `${cor} border-transparent` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
    >
      {label} <b>{count}</b>
    </button>
  );

  // ---------- CSV ----------
  const exportarCsv = () => {
    const linhasCsv = [
      ['nome_fantasia', 'razao_social', 'cnpj', 'ie', 'cep', 'municipio', 'uf', 'endereco', 'numero', 'bairro', 'ativo'].join(';'),
      ...filtrados.map(c => [
        c.nome.replace(/;/g, ','), c.razaoSocial.replace(/;/g, ','), c.cnpj, c.ie, c.cep,
        c.municipio.replace(/;/g, ','), c.uf, c.endereco.replace(/;/g, ','), c.numero, c.bairro.replace(/;/g, ','), c.ativo ? 'SIM' : 'NAO',
      ].join(';')),
    ];
    const blob = new Blob(['\ufeff' + linhasCsv.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes-fiscais-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`CSV exportado: ${filtrados.length} cliente(s).`);
  };

  // ---------- KPIs DERIVADOS da lista em memória (atualizam NA HORA ao salvar) ----------
  const kpis = useMemo<Stats>(() => {
    const total = clientes.length;
    const comCep = clientes.filter(c => c.cep).length;
    const comCnpj = clientes.filter(c => c.cnpj).length;
    return {
      total,
      ativos: clientes.filter(c => c.ativo).length,
      comCep,
      semCep: total - comCep,
      comCnpj,
      semCnpj: total - comCnpj,
      comIe: clientes.filter(c => c.ie).length,
      comMunicipio: clientes.filter(c => c.municipio).length,
      semEndereco: clientes.filter(c => !c.endereco).length,
      semMunicipio: clientes.filter(c => !c.municipio).length,
    };
  }, [clientes]);

  // -----------------------------------------------------------------
  // BLOCO 179 — LOTE "PREENCHER" (dono: "veja quem ja esta com o cep e ja
  // preencha"): quem JÁ TEM CEP (8 dígitos) mas está com rua, bairro, cidade
  // ou UF vazia é completado pelos CORREIOS de uma vez. Preenche SÓ os campos
  // VAZIOS (nunca sobrescreve o que o dono digitou) e grava DIRETO no cadastro
  // (PATCH por cliente, só os campos que faltam), com progresso x/y.
  // -----------------------------------------------------------------
  const alvosLote = useMemo(
    () => clientes.filter(c => c.cep.replace(/\D/g, '').length === 8 && (!c.endereco || !c.bairro || !c.municipio || !c.uf)),
    [clientes],
  );

  const preencherLotePeloCep = () => {
    if (!token || alvosLote.length === 0 || lote) return;
    setConf({
      titulo: 'Completar endereço pelo CEP?',
      texto: `${alvosLote.length} cliente(s) JÁ têm CEP e estão com rua, bairro, cidade ou UF vazios.`,
      detalhe: 'Os CORREIOS são consultados pelo CEP gravado e preenchem SÓ os campos VAZIOS — nada que já esteja digitado é sobrescrito. Cada linha já é gravada no cadastro na hora.',
      icone: 'fa-wand-magic-sparkles',
      botao: `Preencher ${alvosLote.length} cliente(s)`,
      run: async () => {
        setLote({ done: 0, total: alvosLote.length });
        let ok = 0; let nada = 0; let falha = 0;
        for (let i = 0; i < alvosLote.length; i++) {
          const c = alvosLote[i];
          const r = await buscarCep(c.cep);
          if (!r.ok) { falha += 1; }
          else {
            const patch: Record<string, string> = {};
            if (!c.endereco && r.logradouro) patch.endereco = r.logradouro.replace(/\s+/g, ' ').slice(0, 60);
            if (!c.bairro && r.bairro) patch.bairro = r.bairro.replace(/\s+/g, ' ').slice(0, 60);
            if (!c.municipio && r.cidade) patch.municipio = r.cidade.replace(/\s+/g, ' ').slice(0, 60);
            if (!c.uf && r.uf) patch.uf = r.uf.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
            if (Object.keys(patch).length === 0) { nada += 1; }
            else {
              try {
                const res = await fetch('/api/clientes-fiscal', { method: 'PATCH', headers: headers(token), body: JSON.stringify({ id: c.id, ...patch }) });
                const dj = await res.json().catch(() => null) as Record<string, unknown> | null;
                if (res.ok && dj?.ok) {
                  setClientes(prev => prev.map(x => (x.id === c.id ? (dj.cliente as ClienteFiscal) : x)));
                  ok += 1;
                } else falha += 1;
              } catch { falha += 1; }
            }
          }
          setLote({ done: i + 1, total: alvosLote.length });
        }
        setLote(null);
        const partes = [`${ok} preenchido(s)`, nada ? `${nada} sem dados nos Correios` : '', falha ? `${falha} falha(s)` : ''].filter(Boolean).join(' · ');
        showToast(`Lote concluído: ${partes}.`, falha === 0);
      },
    });
  };

  // ================= TELA: PIN =================
  if (booting) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    // BLOCO 206: tela de login ÚNICA dos portais (mesmo visual dos demais)
    return (
      <PortalPinGate
        titulo="Clientes Fiscais"
        subtitulo="Nome · CPF/CNPJ · CEP · Endereço — preenche sozinho e tem lote pelo CEP"
        icone="fa-address-card"
        accent="bg-teal-600"
        pin={pin}
        pinErro={pinErro}
        pinBusy={pinBusy}
        pinShake={pinShake}
        onDigito={digitar}
        onApagar={apagar}
        onEntrar={() => void entrarComPin(pin)}
      />
    );
  }

  // ================= TELA: PORTAL (PC otimizado) =================
  const salvoRecente = (c: ClienteFiscal) => !!linha[c.id]?.salvoEm && Date.now() - (linha[c.id].salvoEm || 0) < 4000;
  const estadoLinha = (c: ClienteFiscal): { fundo: string; borda: string } => {
    const st = linha[c.id];
    if (st?.erro) return { fundo: 'bg-rose-50/70', borda: 'border-l-4 border-l-rose-400' };
    if (linhasComErro.has(c.id)) return { fundo: 'bg-rose-50/40', borda: 'border-l-4 border-l-rose-300' };
    if (st?.salvando || salvandoTudo) return { fundo: 'bg-gray-50', borda: 'border-l-4 border-l-gray-300' };
    if (salvoRecente(c)) return { fundo: 'bg-emerald-50/60', borda: 'border-l-4 border-l-emerald-400' };
    if (CAMPOS_EDIT.some(k => alteradoDe(c, k))) return { fundo: 'bg-amber-50/70', borda: 'border-l-4 border-l-amber-400' };
    return { fundo: 'bg-white', borda: 'border-l-4 border-l-transparent' };
  };

  const inputCls = (c: ClienteFiscal, k: CKey) => {
    const err = alteradoDe(c, k) && erroDeCampo(k, valorDe(c, k));
    const base = `h-8 w-full rounded-lg border text-[12px] font-bold text-gray-800 px-2 transition-colors focus:outline-none focus:ring-2 ${(k === 'cep' || k === 'doc' || k === 'ie') ? 'font-mono tracking-wide' : ''}`;
    if (err) return `${base} border-rose-300 bg-rose-50 focus:ring-rose-200`;
    if (alteradoDe(c, k)) return `${base} border-amber-300 bg-amber-50 focus:ring-amber-200`;
    if (valorDe(c, k)) return `${base} border-gray-200 bg-white focus:ring-gray-200`;
    return `${base} border-dashed border-gray-300 bg-gray-50/50 text-gray-400 focus:ring-gray-200`;
  };

  // BLOCO 178: mensagem INLINE do preenchimento automático (Correios/Receita).
  const msgBuscaCelula = (c: ClienteFiscal, campo: 'cep' | 'doc', largura: string) => {
    const b = buscas[`${c.id}:${campo}`];
    if (!b) return null;
    if (b.buscando) {
      return (
        <p className={`text-[8px] font-black text-teal-600 mt-0.5 truncate ${largura}`}>
          <i className="fa-solid fa-spinner fa-spin mr-1"></i>
          {campo === 'cep' ? 'buscando nos Correios...' : 'consultando a Receita...'}
        </p>
      );
    }
    if (!b.msg) return null;
    return (
      <p className={`text-[8px] font-black mt-0.5 truncate ${largura} ${b.msgOk ? 'text-emerald-600' : 'text-rose-500'}`} title={b.msg}>
        {b.msgOk ? <i className="fa-solid fa-circle-check mr-1"></i> : <i className="fa-solid fa-circle-exclamation mr-1"></i>}
        {b.msg}
      </p>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-40 shadow-lg shadow-teal-900/10">
        <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-cyan-800 text-white">
          <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-address-card text-teal-100"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Clientes Fiscais <span className="text-teal-200">Nome · CPF/CNPJ · CEP · Endereço do destinatário</span></h1>
              <p className="text-[10px] text-teal-100/70 font-semibold mt-1 leading-none truncate">
                {nomeAdmin ? <><i className="fa-solid fa-user-shield mr-1 text-[8px]"></i>{nomeAdmin} · </> : null}
                <span className="uppercase tracking-wide">CEP (Correios) e CNPJ (Receita) preenchem o resto · botão PREENCHER completa quem já tem CEP · tudo editável</span>
              </p>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={exportarCsv}
                className="hidden md:flex bg-white/15 hover:bg-white/25 text-white rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all items-center gap-1.5"
                title="Exportar a lista filtrada em CSV (Excel)"
              >
                <i className="fa-solid fa-file-csv"></i>Exportar CSV
              </button>
              <button
                onClick={() => void carregar(token)}
                disabled={carregando || salvandoTudo || !!lote}
                className="bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Recarregar a lista (descarta alterações não salvas)"
              >
                <i className={`fa-solid fa-rotate ${carregando ? 'fa-spin' : ''}`}></i>Atualizar
              </button>
              <button
                onClick={sair}
                className="bg-white/10 hover:bg-white/20 text-teal-100 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Sair do portal"
              >
                <i className="fa-solid fa-right-from-bracket"></i>Sair
              </button>
            </div>
          </div>
        </div>
        {/* faixa de KPIs — uma linha só */}
        <div className="bg-cyan-950 text-cyan-100">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center gap-4 text-[10px] font-bold whitespace-nowrap overflow-x-auto" role="status">
            <span><b className="text-white">{kpis.total}</b> clientes</span>
            <span><b className="text-white">{kpis.ativos}</b> ativos</span>
            <span className={kpis.semCep > 0 ? 'text-amber-300' : 'text-emerald-300'}><b>{kpis.comCep}</b> com CEP</span>
            <span className={kpis.semCep > 0 ? 'text-amber-300' : 'text-emerald-300'}><b>{kpis.semCep}</b> sem CEP</span>
            <span className={kpis.semEndereco > 0 ? 'text-amber-300' : 'text-emerald-300'}><b>{kpis.semEndereco}</b> sem logradouro</span>
            <span className={kpis.semMunicipio > 0 ? 'text-amber-300' : 'text-emerald-300'}><b>{kpis.semMunicipio}</b> sem cidade</span>
            <span className={kpis.semCnpj > 0 ? 'text-amber-300' : 'text-emerald-300'}><b>{kpis.comCnpj}</b> com CPF/CNPJ</span>
            <span className={kpis.semCnpj > 0 ? 'text-amber-300' : ''}><b>{kpis.semCnpj}</b> sem CPF/CNPJ</span>
            <span className="text-cyan-300/70"><b>{kpis.comIe}</b> com IE</span>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-4 space-y-3">
        {/* ================= ALERTAS: SEM CEP (boleto) + SEM ENDEREÇO/MUNICÍPIO (NF-e) ================= */}
        {kpis.semEndereco > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <i className="fa-solid fa-ban text-rose-500"></i>
            <p className="text-[11px] font-bold text-rose-800">
              {kpis.semEndereco} cliente(s) SEM LOGRADOURO (rua) — a NF-e IDENTIFICADA desses é recusada pela SEFAZ (endereço obrigatório). Use o filtro <b>sem logradouro</b> e complete: rua, número, bairro, município, UF e CEP.
            </p>
          </div>
        )}
        {kpis.semMunicipio > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
            <p className="text-[11px] font-bold text-amber-800">
              {kpis.semMunicipio} cliente(s) SEM CIDADE — o endereço completo (cidade + UF) também é exigido na NF-e identificada. Complete pelo filtro <b>sem cidade</b> ou pelo botão <b>Preencher</b> (para quem já tem CEP).
            </p>
          </div>
        )}
        {kpis.semCnpj > 0 && (
          <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <i className="fa-solid fa-id-card text-stone-500"></i>
            <p className="text-[11px] font-bold text-stone-700">
              {kpis.semCnpj} cliente(s) SEM CPF/CNPJ — o boleto A PRAZO não sai sem o documento do pagador (NFe = CNPJ · NFC/boleto PF = CPF). Use o filtro <b>sem CPF/CNPJ</b>: CNPJ completo puxa os dados da RECEITA sozinho.
            </p>
          </div>
        )}
        {kpis.semCep > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
            <p className="text-[11px] font-bold text-amber-800">
              {kpis.semCep} cliente(s) SEM CEP — ao gerar boleto o sistema vai pedir o CEP na mão. Use o filtro <b>sem CEP</b> abaixo e complete o cadastro.
            </p>
          </div>
        )}

        {/* ================= BLOCO 179: LOTE — quem JÁ TEM CEP fica completo pelos Correios ================= */}
        {alvosLote.length > 0 && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5 flex-wrap">
            <i className="fa-solid fa-wand-magic-sparkles text-teal-600"></i>
            <p className="text-[11px] font-bold text-teal-900 flex-1 min-w-[220px]">
              {alvosLote.length} cliente(s) JÁ TÊM CEP e estão com rua, bairro, cidade ou UF vazios — os Correios completam SÓ o que falta, de uma vez.
            </p>
            <button
              onClick={preencherLotePeloCep}
              disabled={!!lote || salvandoTudo}
              className="h-9 px-4 rounded-xl bg-teal-600 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all disabled:opacity-60 flex items-center gap-1.5"
            >
              {lote ? <><i className="fa-solid fa-spinner fa-spin"></i>{lote.done}/{lote.total}…</> : <><i className="fa-solid fa-wand-magic-sparkles"></i>Preencher ({alvosLote.length})</>}
            </button>
          </div>
        )}

        {/* ================= FILTROS ================= */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, razão social, CPF/CNPJ, município ou CEP..."
              className="w-full h-9 pl-8 pr-3 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-200"
              aria-label="Buscar cliente"
            />
          </div>
          {chipFiltro('TODOS', 'Todos', kpis.total, 'bg-gray-900 text-white')}
          {chipFiltro('SEM_ENDERECO', 'Sem logradouro', kpis.semEndereco, 'bg-rose-600 text-white')}
          {chipFiltro('SEM_MUNICIPIO', 'Sem cidade', kpis.semMunicipio, 'bg-orange-600 text-white')}
          {chipFiltro('SEM_CEP', 'Sem CEP', kpis.semCep, 'bg-amber-600 text-white')}
          {chipFiltro('CEP_SEM_ENDERECO', 'CEP sem endereço', alvosLote.length, 'bg-teal-700 text-white')}
          {chipFiltro('SEM_CNPJ', 'Sem CPF/CNPJ', kpis.semCnpj, 'bg-stone-700 text-white')}
          {chipFiltro('SEM_IE', 'Sem IE', kpis.total - kpis.comIe, 'bg-teal-700 text-white')}
          {chipFiltro('INATIVOS', 'Inativos', kpis.total - kpis.ativos, 'bg-gray-500 text-white')}
          <button
            onClick={exportarCsv}
            className="md:hidden px-3 h-8 rounded-full text-[10px] font-black uppercase tracking-wider border border-gray-200 bg-white text-gray-500"
          >
            <i className="fa-solid fa-file-csv mr-1"></i>CSV
          </button>
        </div>

        {/* ================= BARRA DE ALTERAÇÕES PENDENTES ================= */}
        {linhasAlteradas.length > 0 && (
          <div className={`sticky top-[74px] z-30 rounded-xl border px-4 py-2 flex items-center gap-3 shadow-lg ${linhasComErro.size ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-300'}`}>
            <i className={`fa-solid ${linhasComErro.size ? 'fa-triangle-exclamation text-rose-500' : 'fa-pen-to-square text-amber-600'} text-sm`}></i>
            <p className="text-[11px] font-black text-gray-700 flex-1">
              <b>{linhasAlteradas.length}</b> linha(s) alterada(s){linhasComErro.size ? ` · ${linhasComErro.size} com erro de digitação` : ''} — salve para gravar no cadastro.
            </p>
            <button
              onClick={descartarTudo}
              className="h-8 px-3 rounded-lg bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase tracking-wider active:scale-95"
            >
              Descartar
            </button>
            <button
              onClick={salvarTudo}
              disabled={salvandoTudo || !!lote}
              className="h-8 px-4 rounded-lg bg-teal-600 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-60 flex items-center gap-1.5"
            >
              {salvandoTudo ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
              {salvandoTudo ? 'Salvando...' : 'Salvar tudo'}
            </button>
          </div>
        )}

        {/* ================= ERRO DA LISTA ================= */}
        {erroLista && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center gap-2.5">
            <i className="fa-solid fa-circle-exclamation text-rose-500"></i>
            <p className="text-[12px] font-bold text-rose-700 flex-1">{erroLista}</p>
            <button onClick={() => token && void carregar(token)} className="text-[10px] font-black uppercase text-rose-600 underline underline-offset-2">Tentar de novo</button>
          </div>
        )}

        {/* ================= TABELA PLANILHA ================= */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1295px] text-left">
              <thead>
                <tr className="bg-gray-900 text-white text-[9px] font-black uppercase tracking-wider">
                  <th className="px-2.5 py-2.5 w-12">#</th>
                  <th className="px-2.5 py-2.5 min-w-[150px]">Nome</th>
                  <th className="px-2.5 py-2.5 w-[166px]">CPF/CNPJ <span className="text-gray-400 normal-case font-semibold">(Receita)</span></th>
                  <th className="px-2.5 py-2.5 min-w-[130px]">Razão Social</th>
                  <th className="px-2.5 py-2.5 w-[84px]">IE</th>
                  <th className="px-2.5 py-2.5 w-[104px]">CEP <span className="text-gray-400 normal-case font-semibold">(Correios)</span></th>
                  <th className="px-2.5 py-2.5 min-w-[150px]">Logradouro</th>
                  <th className="px-2.5 py-2.5 w-[70px]">Nº</th>
                  <th className="px-2.5 py-2.5 min-w-[130px]">Bairro</th>
                  <th className="px-2.5 py-2.5 w-[105px]">Cidade</th>
                  <th className="px-2.5 py-2.5 w-12">UF</th>
                  <th className="px-2.5 py-2.5 w-[110px] text-right">Situação</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr><td colSpan={12} className="px-4 py-16 text-center"><div className="w-8 h-8 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin mx-auto" /></td></tr>
                )}
                {!carregando && filtrados.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-16 text-center text-gray-400 text-sm font-semibold">
                    {clientes.length === 0 ? 'Nenhum cliente no cadastro.' : 'Nenhum cliente com este filtro.'}
                  </td></tr>
                )}
                {!carregando && filtrados.map((c, idx) => {
                  const est = estadoLinha(c);
                  const st = linha[c.id];
                  const pend = CAMPOS_EDIT.some(k => alteradoDe(c, k));
                  return (
                    <tr key={c.id} className={`${est.fundo} ${est.borda} border-b border-gray-100 hover:bg-gray-50/60 transition-colors`}>
                      <td className="px-2.5 py-1.5 text-[10px] font-bold text-gray-300">{idx + 1}</td>
                      {/* BLOCO 174: NOME editável — obrigatório (catálogo, PDV, NF) */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'nome')}
                          onChange={e => setValor(c, 'nome', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="Nome do cliente"
                          className={inputCls(c, 'nome')}
                          aria-label={`Nome de ${c.nome}`}
                        />
                        <div className="flex items-center gap-2 mt-0.5">
                          {!c.ativo && <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500 shrink-0">inativo</span>}
                          {alteradoDe(c, 'nome') && erroDeCampo('nome', valorDe(c, 'nome')) ? (
                            <p className="text-[8px] font-black text-rose-500">Nome: {erroDeCampo('nome', valorDe(c, 'nome'))}</p>
                          ) : null}
                        </div>
                      </td>
                      {/* BLOCO 177/179: CPF/CNPJ EDITÁVEL — ao completar 14 dígitos com
                          DV válido, a RECEITA preenche razão social + endereço sozinhos
                          (CPF 11 não tem consulta pública — feedback orienta pelo CEP). */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'doc')}
                          onChange={e => aoDigitarDoc(c, e.target.value, token || '')}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          inputMode="numeric"
                          placeholder="CPF ou CNPJ"
                          className={inputCls(c, 'doc')}
                          aria-label={`CPF/CNPJ de ${c.nome}`}
                        />
                        {msgBuscaCelula(c, 'doc', 'max-w-[146px]')}
                        {alteradoDe(c, 'doc') && erroDeCampo('doc', valorDe(c, 'doc')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">CPF/CNPJ: {erroDeCampo('doc', valorDe(c, 'doc'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 178: RAZÃO SOCIAL editável — a Receita puxa no CNPJ e o dono ajusta por cima */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'razaoSocial')}
                          onChange={e => setValor(c, 'razaoSocial', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="Razão social (opcional)"
                          className={inputCls(c, 'razaoSocial')}
                          aria-label={`Razão social de ${c.nome}`}
                        />
                        {alteradoDe(c, 'razaoSocial') && erroDeCampo('razaoSocial', valorDe(c, 'razaoSocial')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">Razão: {erroDeCampo('razaoSocial', valorDe(c, 'razaoSocial'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 178: IE editável (aceita ISENTO) */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'ie')}
                          onChange={e => setValor(c, 'ie', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="IE ou ISENTO"
                          className={inputCls(c, 'ie')}
                          aria-label={`IE de ${c.nome}`}
                        />
                        {alteradoDe(c, 'ie') && erroDeCampo('ie', valorDe(c, 'ie')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">IE: {erroDeCampo('ie', valorDe(c, 'ie'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 174/179: CEP editável — ao completar 8 dígitos o ViaCEP
                          (Correios) preenche logradouro/bairro/cidade/UF SOZINHOS e
                          VISÍVEIS — são as colunas seguintes, junto do CEP */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'cep')}
                          onChange={e => aoDigitarCep(c, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          inputMode="numeric"
                          placeholder="00000-000"
                          className={inputCls(c, 'cep')}
                          aria-label={`CEP de ${c.nome}`}
                        />
                        {msgBuscaCelula(c, 'cep', 'max-w-[84px]')}
                        {alteradoDe(c, 'cep') && erroDeCampo('cep', valorDe(c, 'cep')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">CEP: {erroDeCampo('cep', valorDe(c, 'cep'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 176/179: LOGRADOURO editável — o xLgr que faltava e derrubava a NF-e
                          (agora É A COLUNA SEGUINTE ao CEP — o que os Correios preenchem aparece na hora) */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'endereco')}
                          onChange={e => setValor(c, 'endereco', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="Rua / Avenida (sem o nº)"
                          className={inputCls(c, 'endereco')}
                          aria-label={`Logradouro de ${c.nome}`}
                        />
                        {alteradoDe(c, 'endereco') && erroDeCampo('endereco', valorDe(c, 'endereco')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">Logradouro: {erroDeCampo('endereco', valorDe(c, 'endereco'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 176: NÚMERO editável — aceita S/N */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'numero')}
                          onChange={e => setValor(c, 'numero', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="Nº ou S/N"
                          className={inputCls(c, 'numero')}
                          aria-label={`Número de ${c.nome}`}
                        />
                        {alteradoDe(c, 'numero') && erroDeCampo('numero', valorDe(c, 'numero')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">Nº: {erroDeCampo('numero', valorDe(c, 'numero'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 176: BAIRRO editável — o xBairro do enderDest */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'bairro')}
                          onChange={e => setValor(c, 'bairro', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="Bairro"
                          className={inputCls(c, 'bairro')}
                          aria-label={`Bairro de ${c.nome}`}
                        />
                        {alteradoDe(c, 'bairro') && erroDeCampo('bairro', valorDe(c, 'bairro')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">Bairro: {erroDeCampo('bairro', valorDe(c, 'bairro'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 176/179: CIDADE editável — o xMun do enderDest da NF-e
                          (coluna ESTREITA, pedido do dono: "diminua o espaço para nome
                          da cidade" — nome longo rola dentro do input) */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'municipio')}
                          onChange={e => setValor(c, 'municipio', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="Cidade"
                          className={inputCls(c, 'municipio')}
                          aria-label={`Cidade de ${c.nome}`}
                        />
                        {alteradoDe(c, 'municipio') && erroDeCampo('municipio', valorDe(c, 'municipio')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">Cidade: {erroDeCampo('municipio', valorDe(c, 'municipio'))}</p>
                        ) : null}
                      </td>
                      {/* BLOCO 176: UF editável — 2 letras */}
                      <td className="px-2.5 py-1.5">
                        <input
                          value={valorDe(c, 'uf')}
                          onChange={e => setValor(c, 'uf', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          placeholder="RS"
                          className={inputCls(c, 'uf')}
                          aria-label={`UF de ${c.nome}`}
                        />
                        {alteradoDe(c, 'uf') && erroDeCampo('uf', valorDe(c, 'uf')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">UF: {erroDeCampo('uf', valorDe(c, 'uf'))}</p>
                        ) : null}
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        {st?.erro ? (
                          <span className="text-[9px] font-black text-rose-600 leading-tight block max-w-[120px] inline-block" title={st.erro}>{st.erro}</span>
                        ) : st?.salvando || salvandoTudo ? (
                          <i className="fa-solid fa-spinner fa-spin text-gray-400"></i>
                        ) : salvoRecente(c) ? (
                          <span className="text-[9px] font-black text-emerald-600 uppercase"><i className="fa-solid fa-check mr-0.5"></i>salvo</span>
                        ) : pend ? (
                          <button
                            onClick={() => void salvarLinha(c)}
                            disabled={linhasComErro.has(c.id)}
                            className="h-7 px-2.5 rounded-lg bg-teal-600 text-white text-[9px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-50"
                          >
                            <i className="fa-solid fa-floppy-disk mr-1"></i>Salvar
                          </button>
                        ) : (
                          <span className="text-[9px] font-bold text-gray-300 uppercase">gravado</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ================= RODAPÉ DE AJUDA ================= */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3">
          <p className="text-[10px] font-bold text-gray-500 leading-relaxed">
            <i className="fa-solid fa-circle-info text-teal-600 mr-1.5"></i>
            <b>PREENCHIMENTO AUTOMÁTICO:</b> digite o CEP (8 dígitos) e os CORREIOS preenchem rua, bairro, cidade e UF DA LINHA NA HORA — agora colados no CEP, visíveis sem rolar a tela; digite o CNPJ (14 dígitos) e a RECEITA preenche razão social, endereço completo e CEP. CPF (11) não tem consulta pública: o endereço completa pelo CEP. <b>LOTE:</b> o botão PREENCHER (barra verde acima) completa TODOS que já têm CEP e estão com o endereço incompleto — preenche só o que falta e grava na hora. <b>Tudo editável:</b> Nome (obrigatório até 120) · CPF/CNPJ (11 ou 14 com dígito verificador — documento do PAGADOR do boleto a prazo: NFe = CNPJ, cliente PF = CPF) · CEP · Razão Social · IE (aceita ISENTO) · Logradouro (rua, SEM o número) · Nº (aceita S/N) · Bairro · Cidade · UF — limite SEFAZ de 60 caracteres por campo. A NF-e IDENTIFICADA só sobe com o endereço COMPLETO (rua + nº + bairro + cidade + UF + CEP); a NFC-e identificada com cadastro incompleto sai SEM endereço em vez de ser recusada. ENTER na linha salva só aquela linha.
          </p>
        </div>
      </main>

      {/* ================= FOOTER FIXO ================= */}
      <footer className="mt-auto bg-white border-t border-gray-200">
        <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
          <i className="fa-solid fa-address-card text-teal-600"></i>
          DOCE MANIA · Clientes Fiscais — tudo editável · CEP e CNPJ preenchem o endereço automaticamente
          <span className="ml-auto">{kpis.total} clientes · {kpis.semEndereco} sem logradouro · {kpis.semMunicipio} sem cidade · {kpis.semCep} sem CEP · {alvosLote.length} CEP sem endereço</span>
        </div>
      </footer>

      {/* ================= TOAST ================= */}
      {toast && (
        <div className={`fixed bottom-16 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-[12px] font-black max-w-lg ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`} role="status">
          <i className={`fa-solid ${toast.ok ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-1.5`}></i>{toast.msg}
        </div>
      )}

      {/* ================= MODAL DE CONFIRMAÇÃO ================= */}
      {conf && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 mx-auto flex items-center justify-center mb-3">
              <i className={`fa-solid ${conf.icone} text-teal-600 text-xl`}></i>
            </div>
            <h3 className="text-center text-base font-black text-gray-800 mb-1">{conf.titulo}</h3>
            <p className="text-center text-[12px] font-semibold text-gray-500 mb-2">{conf.texto}</p>
            {conf.detalhe && <p className="text-center text-[10px] font-bold text-gray-400 mb-4 leading-relaxed">{conf.detalhe}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConf(null)} className="flex-1 h-11 rounded-xl bg-gray-100 text-gray-500 text-[11px] font-black uppercase tracking-wider active:scale-95">Cancelar</button>
              <button
                onClick={() => { const run = conf.run; setConf(null); void run(); }}
                className="flex-1 h-11 rounded-xl bg-teal-600 text-white text-[11px] font-black uppercase tracking-wider active:scale-95"
              >
                {conf.botao}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
