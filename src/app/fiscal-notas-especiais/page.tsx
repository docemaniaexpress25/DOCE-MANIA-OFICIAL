"use client";

/**
 * BLOCO 182 — NOTAS ESPECIAIS (admin, fora do app) — emissão MANUAL de NF-e
 * para devolução, bonificação e qualquer nota batida na mão.
 *
 * Pedido do dono (18/11): "aba do admin para notas especiais... uma tela onde
 * poderemos colocar o nosso destinatário da nota após isso os produtos,
 * poderemos calcular alíquota e trocar os códigos de emissão, como 5102,
 * seria 5202, 6202 fora do estado, cst 0101 seria 0900, nota sairia sem
 * pagamento ao invés de dinheiro... emitir uma nota toda personalizada...
 * de preferência ela deve ser responsiva para mobile. Diferente dos portais
 * que funcionam MT bem no computador e péssimos no celular. Crie isso e me
 * surpreenda."
 *
 * DIFERENÇA DOS PORTAIS (pedido literal): os portais anteriores são
 * PLANILHA horizontal (PC otimizado). Esta tela é um WIZARD MOBILE-FIRST:
 *  - UMA coluna fluida (max-w-2xl) — sem rolagem horizontal em nenhum tamanho;
 *  - inputs GRANDES (h-12, texto 16px — o iOS não dá zoom);
 *  - escolhas em BOTTOM SHEET (desliza de baixo, toque de polegar);
 *  - barra de ação fixa no rodapé com safe-area (Voltar / Continuar / Emitir);
 *  - 4 passos com barra de progresso: Tipo+Destinatário → Produtos →
 *    Pagamento → Revisão/Emissão;
 *  - MESMA validação do servidor (motor puro notaEspecial.ts roda no client:
 *    erros aparecem ANTES de gastar requisição na Focus).
 *
 * Regras fiscais do dono (motor do bloco):
 *  - DEVOLUÇÃO: CFOP 5202 (6202 fora do estado AUTOMÁTICO), CSOSN 900
 *    ("0101"->"900"), finalidade 4, tPag 90 SEM PAGAMENTO;
 *  - BONIFICAÇÃO: CFOP 5910 (6910 fora), CSOSN 900, tPag 90;
 *  - LIVRE: tudo editável (CST regime normal envia base + alíquota no XML).
 *
 * ICMS POR ITEM (pedido do dono: "Preciso calcular o ICMS de cada produto com
 * alíquota e etc"): o sistema CALCULA o valor (base × alíquota ÷ 100), mostra
 * ao vivo no editor do item, aceita override manual e envia base + alíquota +
 * VALOR no XML (CST 000/090 sempre; CSOSN 900 com o destaque ligado), com
 * totais icms_base_calculo + icms_valor_total no payload. Nota de referência
 * com COLAR + diagnóstico (UF/modelo decodificados) e observações por item
 * (infAdProd) além das da nota (infCpl).
 *
 * Sessão: MESMA do portal fiscal — POST /api/notas-admin { acao:'AUTH', pin }.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PortalPinGate from '@/components/doce/PortalPinGate';
import {
  CFOP_BASES,
  FINALIDADES,
  FORMAS_PAGAMENTO,
  PRESET_ESPECIAL,
  TRIBUTACOES,
  DestinatarioNotaEspecial,
  ItemNotaEspecial,
  NotaEspecialInput,
  TipoNotaEspecial,
  cfopAjustadoPorUf,
  diagnosticoChaveRef,
  ehCstNormal,
  faltandoEnderecoEspecial,
  icmsDoItem,
  labelCfop,
  labelFormaPagamento,
  normalizaTributacao,
  soDigitos,
  tributacaoDe,
  validarNotaEspecial,
} from '@/lib/notaEspecial';
import { mascaraCpfCnpj, validaCpfCnpj } from '@/lib/validaDoc';
import { buscarCep, mascararCep } from '@/lib/endereco';

// ---------------- tipos locais ----------------

interface ClienteLinha {
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

interface ProdutoLinha {
  id: string;
  codigo: string;
  nome: string;
  precoVenda: number;
  ncm: string;
  cest: string;
  cfop: string;
  ean: string;
  unidade: string;
  origem: string;
  ativo: boolean;
}

interface StatusFocus {
  configurado: boolean;
  ambiente: string;
  ufEmitente: string;
  regime: number;
  emitenteNome: string;
}

interface RespostaNota {
  status: string;
  ref: string;
  numero: string;
  chave: string;
  serie: string;
  protocolo: string;
  pdfUrl: string;
  xmlUrl: string;
  dataAutorizacao: string;
  erro: string;
  valorTotal: number;
  cfopsAjustados: string[];
  tipo: string;
}

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const parseNum = (v: string): number => {
  const n = Number(String(v || '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

const REGIME_LABEL: Record<number, string> = { 1: 'Simples Nacional', 2: 'Simples — excesso sublimite', 3: 'Regime normal' };

const DEST_VAZIO: DestinatarioNotaEspecial = {
  nome: '', cpfCnpj: '', ie: '',
  logradouro: '', numero: '', bairro: '', municipio: '', uf: '', cep: '',
  email: '', telefone: '',
};

const novoItemLivre = (tipo: TipoNotaEspecial): ItemNotaEspecial => ({
  descricao: '',
  codigo: '',
  ncm: '',
  ean: '',
  unidade: 'UN',
  origem: '0',
  cfop: PRESET_ESPECIAL[tipo].cfopMesmaUf,
  tributacao: PRESET_ESPECIAL[tipo].tributacao,
  quantidade: 1,
  valorUnitario: 0,
  desconto: 0,
  baseIcms: 0,
  aliquotaIcms: 0,
  valorIcms: undefined,
  observacao: '',
});

const ORIGENS: { valor: string; label: string }[] = [
  { valor: '0', label: '0 · Nacional' },
  { valor: '1', label: '1 · Estrangeira — imp. direta' },
  { valor: '2', label: '2 · Estrangeira — mercado interno' },
  { valor: '3', label: '3 · Nacional — cont. > 40%' },
  { valor: '4', label: '4 · Nacional — processos básicos' },
  { valor: '5', label: '5 · Nacional — cont. ≤ 40%' },
  { valor: '6', label: '6 · Estrangeira — CAMEX imp. direta' },
  { valor: '7', label: '7 · Estrangeira — CAMEX mercado interno' },
  { valor: '8', label: '8 · Nacional — cont. > 40% (categoria)' },
];

// ---------------- componentes de apoio ----------------

function Sheet({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[120] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-black/50" onClick={fechar} />
      <div className="relative bg-white rounded-t-3xl max-h-[86vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="sticky top-0 bg-white px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between rounded-t-3xl">
          <h3 className="font-black text-sm uppercase tracking-wide text-gray-800">{titulo}</h3>
          <button onClick={fechar} aria-label="Fechar" className="w-10 h-10 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center active:scale-90 transition-transform">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

function Campo({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[10px] font-bold text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full h-12 px-4 rounded-xl border-2 border-gray-200 bg-white text-base font-bold text-gray-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 placeholder:font-medium placeholder:text-gray-300 transition-colors';
const textareaCls = 'w-full px-4 py-3 rounded-xl border-2 border-gray-200 bg-white text-base font-bold text-gray-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 placeholder:font-medium placeholder:text-gray-300 resize-none';

function Progresso({ passo }: { passo: number }) {
  const nomes = ['Destinatário', 'Produtos', 'Pagamento', 'Emissão'];
  return (
    <div className="px-1 pt-1">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4].map(p => (
          <div key={p} className={`h-1.5 flex-1 rounded-full transition-colors ${p <= passo ? 'bg-amber-500' : 'bg-gray-200'}`} />
        ))}
      </div>
      <div className="flex mt-1.5">
        {nomes.map((n, i) => (
          <span key={n} className={`flex-1 text-center text-[9px] font-black uppercase tracking-wide ${i + 1 === passo ? 'text-amber-600' : 'text-gray-400'}`}>{n}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------- página ----------------

export default function PortalNotasEspeciaisPage() {
  // ---- sessão (MESMA do portal fiscal) ----
  const [token, setToken] = useState<string | null>(null);
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [booting, setBooting] = useState(true);
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);

  // ---- dados ----
  const [status, setStatus] = useState<StatusFocus | null>(null);
  const [clientes, setClientes] = useState<ClienteLinha[]>([]);
  const [produtos, setProdutos] = useState<ProdutoLinha[]>([]);
  const [carregandoDados, setCarregandoDados] = useState(false);

  // ---- wizard ----
  const [passo, setPasso] = useState(1);
  const [tipo, setTipo] = useState<TipoNotaEspecial>('DEVOLUCAO');
  const preset = PRESET_ESPECIAL[tipo];

  const [dest, setDest] = useState<DestinatarioNotaEspecial>({ ...DEST_VAZIO });
  const [cepMsg, setCepMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [docMsg, setDocMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [destErro, setDestErro] = useState<string[]>([]);

  const [itens, setItens] = useState<ItemNotaEspecial[]>([]);
  const [itemAberto, setItemAberto] = useState<number | null>(null);
  const [itensErro, setItensErro] = useState<string[]>([]);

  const [natureza, setNatureza] = useState(preset.natureza);
  const [finalidade, setFinalidade] = useState<number>(preset.finalidade);
  const [pagamentoForma, setPagamentoForma] = useState<string>(preset.pagamentoDefault);
  const [refNfe, setRefNfe] = useState('');
  const [informacoes, setInformacoes] = useState(preset.motivoSugerido);
  const [cfopAutoUf, setCfopAutoUf] = useState(true);
  const [destacarIcmsSimples, setDestacarIcmsSimples] = useState(false);
  const [pagErro, setPagErro] = useState<string[]>([]);

  const [errosTela, setErrosTela] = useState<string[]>([]);
  const [avisosTela, setAvisosTela] = useState<string[]>([]);

  // ---- emissão ----
  const [emitindo, setEmitindo] = useState(false);
  const emitindoRef = useRef(false);
  const [resultado, setResultado] = useState<RespostaNota | null>(null);
  const [jaEmitida, setJaEmitida] = useState(false);

  // ---- sheets ----
  const [sheetClientes, setSheetClientes] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [sheetProdutos, setSheetProdutos] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [sheetCfop, setSheetCfop] = useState<number | null>(null);
  const [cfopLivre, setCfopLivre] = useState('');
  const [sheetTrib, setSheetTrib] = useState<number | null>(null);
  const [sheetOrigem, setSheetOrigem] = useState<number | null>(null);
  const [sheetPagamento, setSheetPagamento] = useState(false);
  const [sheetFinalidade, setSheetFinalidade] = useState(false);

  // ---- toast ----
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const headers = (t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

  // ---------- boot: sessão ----------
  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const n = localStorage.getItem(NOME_KEY) || '';
      if (t) { setToken(t); setNomeAdmin(n); }
    } catch { /* storage bloqueado */ }
    setBooting(false);
  }, []);

  // ---------- carregar dados ----------
  const carregarDados = useCallback(async (t: string) => {
    setCarregandoDados(true);
    try {
      const [rS, rC, rP] = await Promise.all([
        fetch('/api/notas-especiais', { headers: headers(t), cache: 'no-store' }),
        fetch('/api/clientes-fiscal', { headers: headers(t), cache: 'no-store' }),
        fetch('/api/produtos-fiscal', { headers: headers(t), cache: 'no-store' }),
      ]);
      if (rS.status === 401 || rC.status === 401 || rP.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch { /* ignore */ }
        setToken(null); setNomeAdmin('');
        showToast('Sessão expirada. Entre com o PIN novamente.', false);
        return;
      }
      const dS = await rS.json().catch(() => null);
      if (dS?.ok) setStatus(dS.focus as StatusFocus);
      const dC = await rC.json().catch(() => null);
      if (dC?.ok) setClientes((dC.clientes || []) as ClienteLinha[]);
      const dP = await rP.json().catch(() => null);
      if (dP?.ok) setProdutos((dP.produtos || []) as ProdutoLinha[]);
    } catch {
      showToast('Falha de conexão ao carregar dados.', false);
    } finally {
      setCarregandoDados(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (token) void carregarDados(token);
  }, [token, carregarDados]);

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
        } catch { /* storage bloqueado */ }
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
    const proximo = (pin + d).slice(0, 6);
    setPin(proximo);
    if (proximo.length === 6) void entrarComPin(proximo);
  };
  const apagar = () => { setPinErro(''); setPin(p => p.slice(0, -1)); };

  const sair = () => {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch { /* ignore */ }
    setToken(null); setNomeAdmin(''); setStatus(null); setClientes([]); setProdutos([]);
    setPasso(1); setResultado(null); setJaEmitida(false);
  };

  // ---------- helpers de estado ----------
  const ufEmit = status?.ufEmitente || 'RS';
  const foraEstado = (dest.uf || '').toUpperCase().trim() !== ufEmit;

  const setDestCampo = (campo: keyof DestinatarioNotaEspecial, v: string) => {
    setDest(prev => ({ ...prev, [campo]: v }));
    setDestErro([]);
    if (campo === 'cep' || campo === 'cpfCnpj') { setCepMsg(null); setDocMsg(null); }
  };

  // ---------- CEP -> ViaCEP (debounce 450ms) ----------
  const cepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const d = soDigitos(dest.cep);
    if (d.length !== 8) { if (cepTimer.current) clearTimeout(cepTimer.current); return; }
    if (cepTimer.current) clearTimeout(cepTimer.current);
    cepTimer.current = setTimeout(async () => {
      setCepMsg({ ok: true, texto: 'Buscando nos Correios...' });
      const r = await buscarCep(d);
      if (!r.ok) {
        setCepMsg({ ok: false, texto: r.erro || 'CEP não encontrado.' });
        return;
      }
      const preenchidos: string[] = [];
      setDest(prev => ({
        ...prev,
        logradouro: prev.logradouro || (r.logradouro || ''),
        bairro: prev.bairro || (r.bairro || ''),
        municipio: prev.municipio || (r.cidade || ''),
        uf: prev.uf || (r.uf || ''),
      }));
      if (r.logradouro) preenchidos.push(r.logradouro);
      if (r.bairro) preenchidos.push(r.bairro);
      if (r.cidade || r.uf) preenchidos.push(`${r.cidade || ''}/${r.uf || ''}`);
      setCepMsg({ ok: true, texto: preenchidos.length ? `Correios preencheram: ${preenchidos.join(' · ')}` : 'CEP válido — complete os campos que faltam.' });
    }, 450);
    return () => { if (cepTimer.current) clearTimeout(cepTimer.current); };
  }, [dest.cep]);

  // ---------- CNPJ -> Receita (debounce 500ms) ----------
  const docTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const d = soDigitos(dest.cpfCnpj);
    if (d.length !== 14 || !validaCpfCnpj(d)) { if (docTimer.current) clearTimeout(docTimer.current); return; }
    if (docTimer.current) clearTimeout(docTimer.current);
    docTimer.current = setTimeout(async () => {
      setDocMsg({ ok: true, texto: 'Consultando a Receita...' });
      try {
        const res = await fetch(`/api/cnpj?cnpj=${d}`, { cache: 'no-store' });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          setDocMsg({ ok: false, texto: j?.erro || 'CNPJ não encontrado na Receita.' });
          return;
        }
        setDest(prev => ({
          ...prev,
          nome: prev.nome || String(j.razaoSocial || '').slice(0, 120),
          ie: prev.ie || String(j.ie || ''),
          logradouro: prev.logradouro || String(j.endereco || '').slice(0, 60),
          numero: prev.numero || String(j.numero || '').slice(0, 60),
          bairro: prev.bairro || String(j.bairro || '').slice(0, 60),
          municipio: prev.municipio || String(j.municipio || '').slice(0, 60),
          uf: prev.uf || String(j.uf || '').slice(0, 2),
          cep: prev.cep || (j.cep ? mascararCep(String(j.cep)) : ''),
        }));
        setDocMsg({ ok: true, texto: `Receita: ${String(j.razaoSocial || '').slice(0, 60)} — endereço preenchido` });
      } catch {
        setDocMsg({ ok: false, texto: 'Falha de rede ao consultar a Receita.' });
      }
    }, 500);
    return () => { if (docTimer.current) clearTimeout(docTimer.current); };
  }, [dest.cpfCnpj]);

  // ---------- trocar tipo de nota (presets do dono) ----------
  const mudarTipo = (novo: TipoNotaEspecial) => {
    const antigo = PRESET_ESPECIAL[tipo];
    const p = PRESET_ESPECIAL[novo];
    setTipo(novo);
    setNatureza(p.natureza);
    setFinalidade(p.finalidade);
    setPagamentoForma(p.pagamentoDefault);
    setInformacoes(p.motivoSugerido);
    setErrosTela([]);
    // itens que ainda usavam o preset antigo passam a usar o novo
    setItens(prev => prev.map(it => ({
      ...it,
      cfop: it.cfop === antigo.cfopMesmaUf ? p.cfopMesmaUf : it.cfop,
      tributacao: it.tributacao === antigo.tributacao ? p.tributacao : it.tributacao,
    })));
  };

  // ---------- itens ----------
  const addItemDeProduto = (p: ProdutoLinha) => {
    const vunit = Number(p.precoVenda) || 0;
    const novo: ItemNotaEspecial = {
      codigo: p.codigo || '',
      descricao: p.nome || '',
      ncm: p.ncm || '',
      ean: p.ean || '',
      unidade: p.unidade || 'UN',
      origem: p.origem || '0',
      cfop: PRESET_ESPECIAL[tipo].cfopMesmaUf,
      tributacao: PRESET_ESPECIAL[tipo].tributacao,
      quantidade: 1,
      valorUnitario: vunit,
      desconto: 0,
      baseIcms: vunit,
      aliquotaIcms: 0,
      valorIcms: undefined,
      observacao: '',
    };
    const proximo = itens.length;
    setItens(prev => [...prev, novo]);
    setItemAberto(proximo);
    setSheetProdutos(false);
    setBuscaProduto('');
  };

  const addItemLivre = () => {
    const proximo = itens.length;
    setItens(prev => [...prev, novoItemLivre(tipo)]);
    setItemAberto(proximo);
    setSheetProdutos(false);
  };

  const setItemCampo = (idx: number, campo: keyof ItemNotaEspecial, v: string | number) => {
    setItens(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const novo = { ...it, [campo]: v } as ItemNotaEspecial;
      // CST 000/090: sugere alíquota 18% e base = total do item quando vazios
      if (campo === 'tributacao' && ehCstNormal(String(v))) {
        const trib = tributacaoDe(String(v));
        if (trib && (trib.codigo === '000' || trib.codigo === '090')) {
          if (!Number(novo.aliquotaIcms)) novo.aliquotaIcms = 18;
          if (!Number(novo.baseIcms)) novo.baseIcms = totalItem(novo);
        }
      }
      // Base de cálculo acompanha o valor do item quando ela é 0 ou já
      // estava igual ao total (a base "viva" — trocou qtd/vlr/desconto, a
      // base segue; mexeu na base à mão, ela para de acompanhar).
      if (campo === 'quantidade' || campo === 'valorUnitario' || campo === 'desconto') {
        const base = Number(novo.baseIcms) || 0;
        if (base === 0 || Math.abs(base - totalItem(it)) < 0.005) {
          novo.baseIcms = totalItem(novo);
        }
      }
      return novo;
    }));
  };

  const removerItem = (idx: number) => {
    setItens(prev => prev.filter((_, i) => i !== idx));
    setItemAberto(null);
  };

  const totalItem = (it: ItemNotaEspecial): number =>
    Math.round((it.quantidade * it.valorUnitario - Math.max(0, Number(it.desconto) || 0)) * 100) / 100;

  const totalProdutos = useMemo(() => Math.round(itens.reduce((a, it) => a + it.quantidade * it.valorUnitario, 0) * 100) / 100, [itens]);
  const totalDescontos = useMemo(() => Math.round(itens.reduce((a, it) => a + Math.max(0, Number(it.desconto) || 0), 0) * 100) / 100, [itens]);
  const totalNota = useMemo(() => Math.round((totalProdutos - totalDescontos) * 100) / 100, [totalProdutos, totalDescontos]);
  // ICMS POR ITEM: o que SOBE no XML (destacado) x o que é só estimativa (Simples).
  const icmsItens = useMemo(() => itens.map(it => icmsDoItem(it, destacarIcmsSimples)), [itens, destacarIcmsSimples]);
  const icmsNaNota = useMemo(() => Math.round(icmsItens.filter(ic => ic.destacado).reduce((a, ic) => a + ic.valor, 0) * 100) / 100, [icmsItens]);
  const icmsEstimado = useMemo(() => Math.round(itens.reduce((a, it, idx) => {
    const ic = icmsItens[idx];
    if (ic?.destacado) return a;
    return a + totalItem(it) * (Number(it.aliquotaIcms) || 0) / 100;
  }, 0) * 100) / 100, [itens, icmsItens]);
  // Diagnóstico da chave da nota original (UF/modelo decodificados).
  const diagChave = useMemo(() => {
    const d = soDigitos(refNfe);
    return d.length === 44 ? diagnosticoChaveRef(d) : null;
  }, [refNfe]);

  // ---------- validações por passo (motor puro) ----------
  const inputCompleto = (): NotaEspecialInput => ({
    tipo,
    natureza,
    finalidade,
    cfopAutoUf,
    destacarIcmsSimples,
    destinatario: dest,
    itens,
    pagamentoForma,
    pagamentoValor: undefined,
    refNfe: refNfe || undefined,
    informacoes,
  });

  const errosDestinatario = (): string[] => {
    const erros: string[] = [];
    if (!dest.nome.trim()) erros.push('Informe o NOME / RAZÃO SOCIAL do destinatário.');
    const d = soDigitos(dest.cpfCnpj);
    if (!d) erros.push('Informe o CPF ou CNPJ do destinatário.');
    else if (!validaCpfCnpj(d)) erros.push(`${d.length === 11 ? 'CPF' : 'CNPJ'} com dígito verificador inválido — confira o número.`);
    const faltando = faltandoEnderecoEspecial(dest);
    if (faltando.length > 0) erros.push(`Endereço incompleto — falta: ${faltando.join(', ')}. A NF-e exige o endereço completo.`);
    return erros;
  };

  const errosDosItens = (): string[] => {
    const erros: string[] = [];
    if (itens.length === 0) erros.push('Adicione pelo menos UM produto à nota.');
    itens.forEach((it, i) => {
      const n = i + 1;
      if (!it.descricao.trim()) erros.push(`Item ${n}: informe a descrição.`);
      if (!(it.quantidade > 0)) erros.push(`Item ${n}: quantidade deve ser maior que zero.`);
      if (it.valorUnitario < 0) erros.push(`Item ${n}: valor unitário inválido.`);
      const cfop = soDigitos(it.cfop);
      if (cfop.length !== 4 || !/^[56]/.test(cfop)) erros.push(`Item ${n}: CFOP inválido (${cfop || 'vazio'}) — 4 dígitos começando com 5 ou 6.`);
      const trib = tributacaoDe(it.tributacao);
      if (!trib) erros.push(`Item ${n}: tributação inválida (${it.tributacao}).`);
      else if (trib.kind === 'CST' && (trib.codigo === '000' || trib.codigo === '090')) {
        if (!(Number(it.baseIcms) > 0) || Number(it.aliquotaIcms) < 0) erros.push(`Item ${n}: ${trib.label} exige base de cálculo e alíquota do ICMS.`);
      }
      if (it.valorIcms !== undefined && it.valorIcms !== null && Number(it.valorIcms) < 0) erros.push(`Item ${n}: valor do ICMS não pode ser negativo.`);
    });
    return erros;
  };

  const errosDoPagamento = (): string[] => {
    const erros: string[] = [];
    if (!natureza.trim()) erros.push('Informe a natureza da operação.');
    if (refNfe && soDigitos(refNfe).length !== 44) erros.push('A chave da nota original deve ter 44 dígitos (ou deixe vazia).');
    return erros;
  };

  const avancar = () => {
    if (passo === 1) {
      const e = errosDestinatario();
      setDestErro(e);
      if (e.length) { showToast('Complete o destinatário para seguir.', false); return; }
    }
    if (passo === 2) {
      const e = errosDosItens();
      setItensErro(e);
      if (e.length) { showToast('Confira os produtos antes de seguir.', false); return; }
    }
    if (passo === 3) {
      const e = errosDoPagamento();
      setPagErro(e);
      if (e.length) { showToast('Confira o pagamento antes de revisar.', false); return; }
    }
    setErrosTela([]);
    setPasso(p => Math.min(4, p + 1));
  };

  const voltar = () => { setErrosTela([]); setPasso(p => Math.max(1, p - 1)); };

  // ---------- emitir ----------
  const emitir = async () => {
    if (emitindoRef.current) return;
    const val = validarNotaEspecial(inputCompleto(), ufEmit);
    if (val.erros.length > 0) {
      setErrosTela(val.erros);
      showToast(val.erros[0], false);
      return;
    }
    setErrosTela([]);
    setAvisosTela(val.avisos);
    emitindoRef.current = true;
    setEmitindo(true);
    setResultado(null);
    setJaEmitida(false);
    try {
      const chaveUnica = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
      const res = await fetch('/api/notas-especiais', {
        method: 'POST',
        headers: headers(token || ''),
        body: JSON.stringify({ acao: 'EMITIR', nota: inputCompleto(), chaveUnica }),
      });
      const d = await res.json().catch(() => null);
      if (d?.avisos?.length) setAvisosTela(d.avisos as string[]);
      if (!res.ok || !d?.ok) {
        if (d?.erros?.length) setErrosTela(d.erros as string[]);
        setResultado({
          status: 'ERRO', ref: d?.ref || '', numero: '', chave: '', serie: '', protocolo: '',
          pdfUrl: '', xmlUrl: '', dataAutorizacao: '', erro: d?.erro || `Erro ${res.status}`,
          valorTotal: totalNota, cfopsAjustados: [], tipo: 'NFE',
        });
        showToast(d?.erro || 'A emissão falhou.', false);
        return;
      }
      setResultado(d.nota as RespostaNota);
      setJaEmitida(!!d.jaEmitida);
      showToast(d.jaEmitida ? 'Esta nota já estava emitida (mesma tentativa).' : 'Nota emitida na SEFAZ!', d.nota?.status === 'AUTORIZADA');
      void carregarDados(token || '');
    } catch {
      setResultado({
        status: 'ERRO', ref: '', numero: '', chave: '', serie: '', protocolo: '',
        pdfUrl: '', xmlUrl: '', dataAutorizacao: '', erro: 'Falha de conexão com o servidor.',
        valorTotal: totalNota, cfopsAjustados: [], tipo: 'NFE',
      });
      showToast('Falha de conexão com o servidor.', false);
    } finally {
      emitindoRef.current = false;
      setEmitindo(false);
    }
  };

  const novaNota = () => {
    setResultado(null); setJaEmitida(false); setErrosTela([]); setAvisosTela([]);
    setDest({ ...DEST_VAZIO }); setItens([]); setItemAberto(null); setRefNfe('');
    setPasso(1);
    const p = PRESET_ESPECIAL[tipo];
    setNatureza(p.natureza); setFinalidade(p.finalidade); setPagamentoForma(p.pagamentoDefault); setInformacoes(p.motivoSugerido);
  };

  const copiarChave = async () => {
    if (!resultado?.chave) return;
    try {
      await navigator.clipboard.writeText(resultado.chave);
      showToast('Chave de acesso copiada.');
    } catch {
      showToast('Não foi possível copiar — selecione o texto.', false);
    }
  };

  // Colar a chave da nota original direto da área de transferência (mobile).
  const colarChave = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      const d = soDigitos(txt).slice(0, 44);
      if (!d) { showToast('Nada para colar — copie a chave de 44 dígitos primeiro.', false); return; }
      setRefNfe(d);
      showToast(d.length === 44 ? 'Chave colada.' : `Colado com ${d.length} dígitos — complete até 44.`, d.length === 44);
    } catch {
      showToast('O navegador não deixou ler a área de transferência — cole com o dedo no campo.', false);
    }
  };

  // ================= PIN GATE =================
  if (booting) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-xs font-black uppercase tracking-widest text-gray-400 animate-pulse">Carregando...</p>
      </main>
    );
  }

  if (!token) {
    // BLOCO 206: tela de login ÚNICA dos portais (mesmo visual dos demais)
    return (
      <PortalPinGate
        titulo="Notas Especiais"
        subtitulo="Devolução · Bonificação · Nota manual"
        icone="fa-file-pen"
        accent="bg-amber-600"
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

  // ================= WIZARD =================
  const clienteFiltrados = clientes.filter(c => {
    const q = buscaCliente.trim().toLowerCase();
    if (!q) return c.ativo;
    return (c.nome || '').toLowerCase().includes(q) || (c.razaoSocial || '').toLowerCase().includes(q) || soDigitos(c.cnpj).includes(soDigitos(q));
  }).slice(0, 80);

  const produtosFiltrados = produtos.filter(p => {
    const q = buscaProduto.trim().toLowerCase();
    if (!q) return p.ativo;
    return (p.nome || '').toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q) || soDigitos(p.ean).includes(soDigitos(q));
  }).slice(0, 80);

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col">
      <div className="max-w-2xl mx-auto pb-40 w-full">
        {/* ---------- header ---------- */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200 px-4 pt-3 pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-lg font-black text-gray-800 tracking-tight leading-none truncate">Notas Especiais</h1>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1 truncate">Devolução · Bonificação · Nota manual (NF-e)</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {carregandoDados ? (
                <span className="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center"><i className="fa-solid fa-rotate animate-pulse"></i></span>
              ) : (
                <button onClick={() => void carregarDados(token)} aria-label="Atualizar" className="w-10 h-10 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center active:scale-90 transition-transform border border-gray-100"><i className="fa-solid fa-rotate"></i></button>
              )}
              <button onClick={sair} aria-label="Sair" className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center active:scale-90 transition-transform border border-rose-100"><i className="fa-solid fa-power-off text-sm"></i></button>
            </div>
          </div>
          {status && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wide ${status.configurado ? (status.ambiente === 'producao' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700') : 'bg-rose-50 text-rose-600'}`}>
                {status.configurado ? (status.ambiente === 'producao' ? 'Produção' : 'Homologação') : 'Focus não configurada'}
              </span>
              <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wide bg-gray-100 text-gray-600">UF emitente {status.ufEmitente}</span>
              <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wide bg-gray-100 text-gray-600">{REGIME_LABEL[status.regime] || 'Regime ' + status.regime}</span>
              {nomeAdmin && <span className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wide bg-teal-50 text-teal-700">{nomeAdmin}</span>}
            </div>
          )}
        </header>

        {/* ---------- resultado da emissão (passo 4) ---------- */}
        {passo === 4 && resultado ? (
          <section className="px-4 pt-4 space-y-3">
            {resultado.status === 'AUTORIZADA' ? (
              <div className="bg-white rounded-3xl border border-emerald-200 shadow-sm overflow-hidden">
                <div className="bg-emerald-600 text-white px-5 py-4 flex items-center gap-3">
                  <i className="fa-solid fa-circle-check text-xl"></i>
                  <div>
                    <p className="text-sm font-black uppercase tracking-wide">NF-e autorizada</p>
                    <p className="text-[10px] font-bold opacity-80">{jaEmitida ? 'Esta tentativa já tinha sido emitida — nada duplicado.' : `Nota ${resultado.numero || ''} · série ${resultado.serie || '—'}`}</p>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <div className="bg-gray-50 rounded-2xl p-4">
                    <p className="text-[9px] font-black uppercase tracking-wider text-gray-400 mb-1">Chave de acesso (44 dígitos)</p>
                    <p className="font-mono text-xs font-bold text-gray-800 break-all leading-relaxed">{resultado.chave || '—'}</p>
                  </div>
                  {resultado.protocolo && (
                    <p className="text-[11px] font-bold text-gray-500">Protocolo SEFAZ: <span className="font-black text-gray-700">{resultado.protocolo}</span>{resultado.dataAutorizacao ? ` · autorizada em ${new Date(resultado.dataAutorizacao).toLocaleString('pt-BR')}` : ''}</p>
                  )}
                  <div className="flex flex-col gap-2">
                    {resultado.pdfUrl && (
                      <a href={resultado.pdfUrl} target="_blank" rel="noopener noreferrer" className="h-12 rounded-xl bg-emerald-600 text-white font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                        <i className="fa-solid fa-file-pdf"></i>Abrir DANFE (PDF)
                      </a>
                    )}
                    <button onClick={copiarChave} className="h-12 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                      <i className="fa-solid fa-copy"></i>Copiar chave de acesso
                    </button>
                    <a href="/notas" target="_blank" rel="noopener noreferrer" className="h-12 rounded-xl bg-gray-800 text-white font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                      <i className="fa-solid fa-up-right-from-square"></i>Ver no Portal Fiscal (DANFE/XML)
                    </a>
                  </div>
                  <p className="text-[10px] font-bold text-gray-400 leading-relaxed">A nota entrou como AVULSA no Portal Fiscal com DANFE, XML e cancelamento dentro do prazo SEFAZ (NF-e: 24h).</p>
                  <button onClick={novaNota} className="w-full h-14 rounded-2xl bg-amber-500 text-white font-black text-sm uppercase tracking-widest shadow-lg active:scale-[0.98] transition-transform mt-1">
                    Emitir outra nota
                  </button>
                </div>
              </div>
            ) : resultado.status === 'EMITINDO' ? (
              <div className="bg-white rounded-3xl border border-amber-200 p-5 space-y-3">
                <div className="flex items-center gap-3 text-amber-600">
                  <i className="fa-solid fa-hourglass-half text-xl"></i>
                  <p className="text-sm font-black uppercase tracking-wide">SEFAZ está processando</p>
                </div>
                <p className="text-xs font-bold text-gray-600 leading-relaxed">A nota foi recebida e está na fila de autorização. Ela aparece no Portal Fiscal (AVULSAS) assim que autorizar — consulte lá em alguns instantes.</p>
                <button onClick={novaNota} className="w-full h-12 rounded-xl bg-gray-800 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-transform">Nova nota</button>
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-rose-200 p-5 space-y-3">
                <div className="flex items-center gap-3 text-rose-600">
                  <i className="fa-solid fa-circle-xmark text-xl"></i>
                  <p className="text-sm font-black uppercase tracking-wide">Emissão recusada</p>
                </div>
                <div className="bg-rose-50 rounded-2xl p-4">
                  <p className="text-xs font-bold text-rose-700 leading-relaxed break-words">{resultado.erro || 'Erro desconhecido.'}</p>
                </div>
                {errosTela.length > 0 && (
                  <ul className="space-y-1">
                    {errosTela.map((e, i) => <li key={i} className="text-[11px] font-bold text-gray-600 flex gap-2"><i className="fa-solid fa-circle-exclamation text-rose-400 mt-0.5"></i><span className="flex-1">{e}</span></li>)}
                  </ul>
                )}
                <p className="text-[10px] font-bold text-gray-400">Corrija os pontos acima e toque em EMITIR de novo — os dados continuam aqui, nada foi perdido.</p>
                <button onClick={() => setResultado(null)} className="w-full h-14 rounded-2xl bg-amber-500 text-white font-black text-sm uppercase tracking-widest shadow-lg active:scale-[0.98] transition-transform">
                  <i className="fa-solid fa-pen-to-square mr-2"></i>Corrigir e emitir de novo
                </button>
              </div>
            )}
            {avisosTela.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                {avisosTela.map((a, i) => <p key={i} className="text-[11px] font-bold text-amber-700 flex gap-2"><i className="fa-solid fa-triangle-exclamation mt-0.5"></i><span className="flex-1">{a}</span></p>)}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* ---------- progresso ---------- */}
            <div className="pt-3 px-3">
              <Progresso passo={passo} />
            </div>

            {/* ================= PASSO 1 — TIPO + DESTINATÁRIO ================= */}
            {passo === 1 && (
              <section className="px-4 pt-4 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {(['DEVOLUCAO', 'BONIFICACAO', 'LIVRE'] as TipoNotaEspecial[]).map(t => {
                    const p = PRESET_ESPECIAL[t];
                    const ativo = tipo === t;
                    const cor = t === 'DEVOLUCAO' ? 'rose' : t === 'BONIFICACAO' ? 'emerald' : 'amber';
                    return (
                      <button key={t} onClick={() => mudarTipo(t)} className={`rounded-2xl p-3 flex flex-col items-center gap-1.5 border-2 transition-all active:scale-95 ${ativo ? 'bg-white shadow-md' : 'bg-white/60 border-gray-100'}`}
                        style={ativo ? { borderColor: cor === 'rose' ? '#e11d48' : cor === 'emerald' ? '#059669' : '#d97706' } : {}}>
                        <i className={`fa-solid ${t === 'DEVOLUCAO' ? 'fa-rotate-left' : t === 'BONIFICACAO' ? 'fa-gift' : 'fa-sliders'} text-lg`} style={{ color: cor === 'rose' ? '#e11d48' : cor === 'emerald' ? '#059669' : '#d97706' }}></i>
                        <span className="text-[10px] font-black uppercase tracking-wide text-gray-800 text-center leading-tight">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] font-bold text-gray-500 leading-relaxed px-1">{preset.desc}</p>

                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-black uppercase tracking-widest text-gray-700">Destinatário da nota</h2>
                    <button onClick={() => setSheetClientes(true)} className="h-10 px-3 rounded-xl bg-gray-100 text-gray-700 text-[11px] font-black uppercase tracking-wide flex items-center gap-1.5 active:scale-95 transition-transform">
                      <i className="fa-solid fa-address-book text-amber-600"></i>Cadastro
                    </button>
                  </div>

                  <Campo label="Nome / Razão social *">
                    <input value={dest.nome} onChange={e => setDestCampo('nome', e.target.value)} className={inputCls} placeholder="Nome ou razão social" maxLength={120} autoComplete="off" />
                  </Campo>

                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="CPF / CNPJ *">
                      <input value={dest.cpfCnpj} onChange={e => setDestCampo('cpfCnpj', e.target.value)} onBlur={() => { const d = soDigitos(dest.cpfCnpj); if (validaCpfCnpj(d)) setDestCampo('cpfCnpj', mascaraCpfCnpj(d)); }} className={inputCls} placeholder="000.000.000-00" inputMode="numeric" autoComplete="off" />
                    </Campo>
                    <Campo label="Inscrição estadual">
                      <input value={dest.ie || ''} onChange={e => setDestCampo('ie', e.target.value)} className={inputCls} placeholder="ISENTO ou vazio" maxLength={20} autoComplete="off" />
                    </Campo>
                  </div>
                  {docMsg && <p className={`text-[10px] font-bold leading-snug ${docMsg.ok ? 'text-emerald-600' : 'text-rose-500'}`}>{docMsg.texto}</p>}

                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="CEP (Correios) *" hint="8 dígitos — preenche o endereço sozinho">
                      <input value={dest.cep} onChange={e => setDestCampo('cep', mascararCep(e.target.value))} className={inputCls} placeholder="00000-000" inputMode="numeric" autoComplete="off" />
                    </Campo>
                    <Campo label="Número *">
                      <input value={dest.numero} onChange={e => setDestCampo('numero', e.target.value)} className={inputCls} placeholder="123 ou S/N" maxLength={60} autoComplete="off" />
                    </Campo>
                  </div>
                  {cepMsg && <p className={`text-[10px] font-bold leading-snug ${cepMsg.ok ? 'text-emerald-600' : 'text-rose-500'}`}>{cepMsg.texto}</p>}

                  <Campo label="Logradouro (rua) *">
                    <input value={dest.logradouro} onChange={e => setDestCampo('logradouro', e.target.value)} className={inputCls} placeholder="Rua / Avenida" maxLength={60} autoComplete="off" />
                  </Campo>

                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Bairro *">
                      <input value={dest.bairro} onChange={e => setDestCampo('bairro', e.target.value)} className={inputCls} placeholder="Bairro" maxLength={60} autoComplete="off" />
                    </Campo>
                    <Campo label="Município *">
                      <input value={dest.municipio} onChange={e => setDestCampo('municipio', e.target.value)} className={inputCls} placeholder="Cidade" maxLength={60} autoComplete="off" />
                    </Campo>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="UF *" hint={foraEstado ? `Fora do estado (${ufEmit}) — CFOP vira 6xxx` : `Mesma UF do emitente (${ufEmit})`}>
                      <input value={dest.uf} onChange={e => setDestCampo('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))} className={inputCls} placeholder="RS" inputMode="text" autoComplete="off" />
                    </Campo>
                    <Campo label="Telefone">
                      <input value={dest.telefone || ''} onChange={e => setDestCampo('telefone', e.target.value)} className={inputCls} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="off" />
                    </Campo>
                  </div>

                  {destErro.length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 space-y-1">
                      {destErro.map((e, i) => <p key={i} className="text-[11px] font-black text-rose-600">{e}</p>)}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ================= PASSO 2 — PRODUTOS ================= */}
            {passo === 2 && (
              <section className="px-4 pt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-black uppercase tracking-widest text-gray-700">Produtos da nota <span className="text-gray-400">({itens.length})</span></h2>
                  <button onClick={() => setSheetProdutos(true)} className="h-11 px-4 rounded-xl bg-amber-500 text-white text-xs font-black uppercase tracking-wide flex items-center gap-2 shadow-md active:scale-95 transition-transform">
                    <i className="fa-solid fa-plus"></i>Produto
                  </button>
                </div>

                {itens.length === 0 && (
                  <div className="bg-white rounded-3xl border border-dashed border-gray-300 p-8 text-center space-y-2">
                    <i className="fa-solid fa-box-open text-2xl text-gray-300"></i>
                    <p className="text-xs font-black uppercase tracking-wide text-gray-400">Nenhum produto ainda</p>
                    <p className="text-[11px] font-bold text-gray-400">Toque em PRODUTO para escolher do catálogo ou digitar um item livre.</p>
                  </div>
                )}

                {itens.map((it, idx) => {
                  const aberto = itemAberto === idx;
                  const cfopFinal = cfopAjustadoPorUf(it.cfop, dest.uf, ufEmit, cfopAutoUf);
                  const trib = tributacaoDe(it.tributacao);
                  const ic = icmsItens[idx];
                  return (
                    <div key={idx} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${aberto ? 'border-amber-300' : 'border-gray-100'}`}>
                      <button onClick={() => setItemAberto(aberto ? null : idx)} className="w-full px-4 py-3.5 flex items-center gap-3 text-left">
                        <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 text-[11px] font-black flex items-center justify-center shrink-0">{idx + 1}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-black text-gray-800 truncate">{it.descricao || '(sem descrição)'}</span>
                          <span className="block text-[10px] font-bold text-gray-400 truncate">
                            {it.quantidade} × {fmtBRL(it.valorUnitario)}{Number(it.desconto) > 0 ? ` − ${fmtBRL(Number(it.desconto))}` : ''} = <span className="text-gray-700">{fmtBRL(totalItem(it))}</span>
                          </span>
                          <span className="flex flex-wrap gap-1 mt-1.5">
                            <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 text-[9px] font-black">{labelCfop(cfopFinal)}</span>
                            <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black ${trib?.kind === 'CST' ? 'bg-violet-50 text-violet-700' : 'bg-teal-50 text-teal-700'}`}>{trib?.label || it.tributacao}</span>
                            {ic && ic.aliquota > 0 && (
                              <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black ${ic.destacado ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                ICMS {ic.aliquota}% {ic.destacado ? `= ${fmtBRL(ic.valor)}` : '(estimado)'}
                              </span>
                            )}
                          </span>
                        </span>
                        <i className={`fa-solid fa-chevron-${aberto ? 'up' : 'down'} text-gray-300 text-xs shrink-0`}></i>
                      </button>

                      {aberto && (
                        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-50">
                          <Campo label="Descrição *">
                            <input value={it.descricao} onChange={e => setItemCampo(idx, 'descricao', e.target.value)} className={inputCls} placeholder="Descrição que sai na nota" maxLength={120} />
                          </Campo>
                          <div className="grid grid-cols-3 gap-2">
                            <Campo label="Código">
                              <input value={it.codigo || ''} onChange={e => setItemCampo(idx, 'codigo', e.target.value)} className={inputCls} placeholder="Interno" maxLength={60} />
                            </Campo>
                            <Campo label="NCM">
                              <input value={it.ncm || ''} onChange={e => setItemCampo(idx, 'ncm', e.target.value.replace(/\D/g, '').slice(0, 8))} className={inputCls} placeholder="8 dígitos" inputMode="numeric" />
                            </Campo>
                            <Campo label="EAN">
                              <input value={it.ean || ''} onChange={e => setItemCampo(idx, 'ean', e.target.value.replace(/\D/g, '').slice(0, 14))} className={inputCls} placeholder="Opcional" inputMode="numeric" />
                            </Campo>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <Campo label="Qtd *">
                              <input value={String(it.quantidade)} onChange={e => setItemCampo(idx, 'quantidade', parseNum(e.target.value))} className={inputCls} inputMode="decimal" placeholder="1" />
                            </Campo>
                            <Campo label="Vlr unit. *">
                              <input value={String(it.valorUnitario)} onChange={e => setItemCampo(idx, 'valorUnitario', parseNum(e.target.value))} className={inputCls} inputMode="decimal" placeholder="0,00" />
                            </Campo>
                            <Campo label="Desconto R$">
                              <input value={String(it.desconto || '')} onChange={e => setItemCampo(idx, 'desconto', parseNum(e.target.value))} className={inputCls} inputMode="decimal" placeholder="0,00" />
                            </Campo>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setSheetCfop(idx)} className="h-12 px-3 rounded-xl bg-gray-50 border-2 border-gray-200 flex items-center justify-between gap-2 active:scale-[0.98] transition-transform">
                              <span className="text-left min-w-0">
                                <span className="block text-[9px] font-black uppercase text-gray-400">CFOP</span>
                                <span className="block text-[11px] font-black text-gray-800 truncate">{labelCfop(cfopFinal)}</span>
                              </span>
                              <i className="fa-solid fa-shuffle text-amber-500 shrink-0"></i>
                            </button>
                            <button onClick={() => setSheetTrib(idx)} className="h-12 px-3 rounded-xl bg-gray-50 border-2 border-gray-200 flex items-center justify-between gap-2 active:scale-[0.98] transition-transform">
                              <span className="text-left min-w-0">
                                <span className="block text-[9px] font-black uppercase text-gray-400">Tributação ICMS</span>
                                <span className="block text-[11px] font-black text-gray-800 truncate">{trib?.label || it.tributacao}</span>
                              </span>
                              <i className="fa-solid fa-percent text-teal-500 shrink-0"></i>
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Campo label={ic.destacado ? 'Base ICMS R$ (vai na nota) *' : 'Base ICMS R$'} hint={ic.destacado ? 'Acompanha o valor do item — pode digitar outro' : trib?.kind === 'CSOSN' && ic.aliquota > 0 ? 'Simples: não sobe no XML com o destaque desligado' : undefined}>
                              <input value={String(it.baseIcms || '')} onChange={e => setItemCampo(idx, 'baseIcms', parseNum(e.target.value))} className={inputCls} inputMode="decimal" placeholder="0,00" />
                            </Campo>
                            <Campo label="Alíquota ICMS %" hint={ic.destacado ? undefined : 'Só estimativa na tela'}>
                              <input value={String(it.aliquotaIcms || '')} onChange={e => setItemCampo(idx, 'aliquotaIcms', parseNum(e.target.value))} className={inputCls} inputMode="decimal" placeholder="0" />
                            </Campo>
                          </div>
                          {/* ICMS CALCULADO POR ITEM (pedido do dono) + override */}
                          <div className="grid grid-cols-2 gap-2">
                            <Campo label="Valor do ICMS R$" hint="Vazio = calcula base × alíquota">
                              <input value={it.valorIcms !== undefined && it.valorIcms !== null && Number(it.valorIcms) > 0 ? String(it.valorIcms) : ''} onChange={e => setItemCampo(idx, 'valorIcms', parseNum(e.target.value))} className={inputCls} inputMode="decimal" placeholder="automático" />
                            </Campo>
                            <div className={`rounded-xl border-2 px-3 flex flex-col justify-center ${ic.destacado ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
                              <span className="block text-[9px] font-black uppercase tracking-wider text-gray-400 leading-tight">{ic.destacado ? 'ICMS na nota (XML)' : 'ICMS estimado (tela)'}</span>
                              <span className={`text-base font-black leading-tight ${ic.destacado ? 'text-emerald-600' : 'text-gray-500'}`}>{fmtBRL(ic.valor)}</span>
                            </div>
                          </div>
                          {ic.valorCalculado !== ic.valor && ic.valor > 0 && (
                            <p className="text-[10px] font-bold text-amber-600">Valor digitado ({fmtBRL(ic.valor)}) está substituindo o cálculo ({fmtBRL(ic.valorCalculado)} = base × alíquota).</p>
                          )}
                          <button onClick={() => setSheetOrigem(idx)} className="w-full h-12 px-3 rounded-xl bg-gray-50 border-2 border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform">
                            <span className="text-left">
                              <span className="block text-[9px] font-black uppercase text-gray-400">Origem da mercadoria</span>
                              <span className="block text-[11px] font-black text-gray-800">{ORIGENS.find(o => o.valor === (it.origem || '0'))?.label || it.origem}</span>
                            </span>
                            <i className="fa-solid fa-globe text-amber-500"></i>
                          </button>
                          <Campo label="Observação do item" hint="Sai impressa na DANFE abaixo do item (infAdProd) — até 500 caracteres">
                            <textarea value={it.observacao || ''} onChange={e => setItemCampo(idx, 'observacao', e.target.value.slice(0, 500))} rows={2} className={textareaCls} placeholder="Ex.: Lote 123 — devolvido com embalagem avariada" />
                          </Campo>
                          <div className="flex justify-between items-center pt-1">
                            <button onClick={() => removerItem(idx)} className="h-11 px-4 rounded-xl bg-rose-50 text-rose-600 text-[11px] font-black uppercase tracking-wide flex items-center gap-2 active:scale-95 transition-transform border border-rose-100">
                              <i className="fa-solid fa-trash-can"></i>Remover
                            </button>
                            <span className="text-xs font-black text-gray-700">Total: {fmtBRL(totalItem(it))}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {itens.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wide text-gray-500">Total dos produtos</span>
                    <span className="text-right">
                      <span className="block text-base font-black text-gray-800">{fmtBRL(totalNota)}</span>
                      {totalDescontos > 0 && <span className="block text-[10px] font-bold text-emerald-600">− descontos {fmtBRL(totalDescontos)}</span>}
                      {icmsNaNota > 0 && <span className="block text-[10px] font-black text-emerald-600">ICMS na nota {fmtBRL(icmsNaNota)}</span>}
                      {icmsEstimado > 0 && <span className="block text-[10px] font-bold text-gray-400">ICMS estimado (Simples) {fmtBRL(icmsEstimado)}</span>}
                    </span>
                  </div>
                )}

                <label className="flex items-start gap-3 bg-white rounded-2xl border border-gray-100 p-4">
                  <input type="checkbox" checked={cfopAutoUf} onChange={e => setCfopAutoUf(e.target.checked)} className="w-6 h-6 rounded accent-amber-500 shrink-0 mt-0.5" />
                  <span className="flex-1">
                    <span className="block text-xs font-black text-gray-800">CFOP inteligente por UF</span>
                    <span className="block text-[10px] font-bold text-gray-500 leading-snug mt-0.5">Ligado: 5xxx vira 6xxx SOZINHO quando o destinatário for de outra UF (o "5202 → 6202 fora do estado"). Desligado: manda o CFOP exatamente como digitou.</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 bg-white rounded-2xl border border-gray-100 p-4">
                  <input type="checkbox" checked={destacarIcmsSimples} onChange={e => setDestacarIcmsSimples(e.target.checked)} className="w-6 h-6 rounded accent-amber-500 shrink-0 mt-0.5" />
                  <span className="flex-1">
                    <span className="block text-xs font-black text-gray-800">Destacar ICMS na nota (CSOSN 900)</span>
                    <span className="block text-[10px] font-bold text-gray-500 leading-snug mt-0.5">Desligado (padrão Simples): a alíquota é só estimativa na tela. Ligado: os itens CSOSN 900 enviam BASE + ALÍQUOTA + VALOR do ICMS no XML (o schema da SEFAZ aceita o destaque no grupo 900) — para o fornecedor ver o ICMS da devolução.</span>
                  </span>
                </label>

                {itensErro.length > 0 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 space-y-1">
                    {itensErro.map((e, i) => <p key={i} className="text-[11px] font-black text-rose-600">{e}</p>)}
                  </div>
                )}
              </section>
            )}

            {/* ================= PASSO 3 — PAGAMENTO + INFO ================= */}
            {passo === 3 && (
              <section className="px-4 pt-4 space-y-4">
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4">
                  <h2 className="text-xs font-black uppercase tracking-widest text-gray-700">Pagamento</h2>
                  <button onClick={() => setSheetPagamento(true)} className="w-full h-14 px-4 rounded-xl bg-gray-50 border-2 border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform">
                    <span className="text-left">
                      <span className="block text-[9px] font-black uppercase text-gray-400">Forma de pagamento</span>
                      <span className="block text-sm font-black text-gray-800">{labelFormaPagamento(pagamentoForma)}</span>
                      {pagamentoForma === '90' && <span className="block text-[10px] font-bold text-amber-600 mt-0.5">A nota sai SEM bloco de cobrança — vPag 0 no XML</span>}
                    </span>
                    <i className={`fa-solid ${pagamentoForma === '90' ? 'fa-circle-minus' : 'fa-money-bill-wave'} text-xl ${pagamentoForma === '90' ? 'text-rose-400' : 'text-emerald-500'}`}></i>
                  </button>
                  {pagamentoForma !== '90' && (
                    <p className="text-[11px] font-bold text-gray-500 px-1">Valor do pagamento: <span className="font-black text-gray-800">{fmtBRL(totalNota)}</span> (total da nota, preenchido automaticamente)</p>
                  )}
                </div>

                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4">
                  <h2 className="text-xs font-black uppercase tracking-widest text-gray-700">Dados da operação</h2>
                  <Campo label="Natureza da operação *">
                    <input value={natureza} onChange={e => setNatureza(e.target.value)} className={inputCls} placeholder="Ex.: Devolução de venda de mercadoria" maxLength={120} />
                  </Campo>
                  <button onClick={() => setSheetFinalidade(true)} className="w-full h-12 px-4 rounded-xl bg-gray-50 border-2 border-gray-200 flex items-center justify-between active:scale-[0.98] transition-transform">
                    <span className="text-left">
                      <span className="block text-[9px] font-black uppercase text-gray-400">Finalidade SEFAZ</span>
                      <span className="block text-sm font-black text-gray-800">{FINALIDADES.find(f => f.valor === finalidade)?.label || finalidade}</span>
                    </span>
                    <i className="fa-solid fa-flag text-amber-500"></i>
                  </button>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Chave da nota original (devolução)</span>
                      <button onClick={() => void colarChave()} className="h-9 px-3 rounded-lg bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 active:scale-95 transition-transform">
                        <i className="fa-solid fa-paste text-amber-600"></i>Colar
                      </button>
                    </div>
                    <input value={refNfe} onChange={e => setRefNfe(e.target.value.replace(/\D/g, '').slice(0, 44))} className={`${inputCls} font-mono`} placeholder="Chave de acesso de 44 dígitos" inputMode="numeric" />
                    <span className="block text-[10px] font-bold text-gray-400 mt-1">44 dígitos — vira NF referenciada no XML; opcional (a SEFAZ de vários estados exige na devolução)</span>
                    {diagChave && (
                      <p className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-black ${diagChave.uf && diagChave.uf !== (dest.uf || '').toUpperCase().trim() ? 'text-rose-600' : 'text-emerald-600'}`}>
                        <span className={`px-1.5 py-0.5 rounded-md ${diagChave.modelo === '55' ? 'bg-violet-50 text-violet-700' : diagChave.modelo === '65' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{diagChave.modelo === '55' ? 'NF-e (55)' : diagChave.modelo === '65' ? 'NFC-e (65)' : 'modelo ?'}</span>
                        <span>emitida em {diagChave.uf || 'UF ?'} · {diagChave.anoMes || 'AAMM ?'}</span>
                        {diagChave.uf && diagChave.uf !== (dest.uf || '').toUpperCase().trim() && <span>≠ UF do destinatário ({(dest.uf || '').toUpperCase()}) — confira</span>}
                        {diagChave.modelo === '65' && <span>referência de NFC-e pode ser recusada em alguns estados</span>}
                      </p>
                    )}
                  </div>
                  <Campo label="Informações complementares / observações da nota" hint="Sai impressa na DANFE junto do carimbo automático do app — cada item também tem observação própria (passo Produtos)">
                    <textarea value={informacoes} onChange={e => setInformacoes(e.target.value.slice(0, 500))} rows={3} className={textareaCls} placeholder="Ex.: Devolução de mercadoria com defeito conforme negociação..." />
                  </Campo>
                  {pagErro.length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 space-y-1">
                      {pagErro.map((e, i) => <p key={i} className="text-[11px] font-black text-rose-600">{e}</p>)}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ================= PASSO 4 — REVISÃO ================= */}
            {passo === 4 && !resultado && (
              <section className="px-4 pt-4 space-y-3">
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                    <i className={`fa-solid ${tipo === 'DEVOLUCAO' ? 'fa-rotate-left text-rose-500' : tipo === 'BONIFICACAO' ? 'fa-gift text-emerald-500' : 'fa-sliders text-amber-500'}`}></i>
                    <p className="text-xs font-black uppercase tracking-widest text-gray-700">Revisão da {preset.label.toLowerCase()}</p>
                  </div>
                  <div className="p-5 space-y-2 text-xs font-bold text-gray-600">
                    <p><span className="text-gray-400 uppercase text-[9px] font-black block">Destinatário</span>{dest.nome} · {mascaraCpfCnpj(soDigitos(dest.cpfCnpj))}{dest.ie ? ` · IE ${dest.ie}` : ''}</p>
                    <p className="text-[11px] text-gray-500">{dest.logradouro}, {dest.numero} — {dest.bairro} · {dest.municipio}/{dest.uf} · CEP {dest.cep}</p>
                    <p><span className="text-gray-400 uppercase text-[9px] font-black block">Natureza / finalidade</span>{natureza} · {FINALIDADES.find(f => f.valor === finalidade)?.label}</p>
                    <p><span className="text-gray-400 uppercase text-[9px] font-black block">Pagamento</span>{labelFormaPagamento(pagamentoForma)}{pagamentoForma === '90' ? ' — SEM COBRANÇA' : ` · ${fmtBRL(totalNota)}`}</p>
                    {refNfe && <p className="break-all"><span className="text-gray-400 uppercase text-[9px] font-black block">Nota referenciada</span>{refNfe}</p>}
                    {informacoes && <p><span className="text-gray-400 uppercase text-[9px] font-black block">Informações</span>{informacoes}</p>}
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-50">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-700">Itens ({itens.length})</p>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {itens.map((it, i) => {
                      const cfopFinal = cfopAjustadoPorUf(it.cfop, dest.uf, ufEmit, cfopAutoUf);
                      const trib = tributacaoDe(it.tributacao);
                      const ic = icmsItens[i];
                      return (
                        <li key={i} className="px-5 py-3 flex items-start gap-3">
                          <span className="w-6 h-6 rounded-lg bg-gray-100 text-gray-500 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-black text-gray-800">{it.descricao}</span>
                            <span className="block text-[10px] font-bold text-gray-400">{it.quantidade} × {fmtBRL(it.valorUnitario)} = {fmtBRL(totalItem(it))} · {labelCfop(cfopFinal)} · {trib?.label || it.tributacao}{ic && ic.aliquota > 0 ? ` · ICMS ${ic.destacado ? `${fmtBRL(ic.valor)} na nota` : `${ic.aliquota}% estimado`}` : ''}</span>
                            {it.observacao && <span className="block text-[10px] font-bold text-gray-400 mt-0.5 italic">Obs: {it.observacao}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="px-5 py-4 bg-gray-50 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Total da nota</span>
                    <span className="text-right">
                      <span className="block text-lg font-black text-gray-800">{fmtBRL(totalNota)}</span>
                      {icmsNaNota > 0 && <span className="block text-[10px] font-black text-emerald-600">ICMS na nota {fmtBRL(icmsNaNota)}{destacarIcmsSimples ? ' (destaque ligado)' : ''}</span>}
                      {icmsEstimado > 0 && <span className="block text-[10px] font-bold text-gray-400">ICMS estimado (Simples) {fmtBRL(icmsEstimado)}</span>}
                    </span>
                  </div>
                </div>

                {foraEstado && cfopAutoUf && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                    <p className="text-[11px] font-black text-amber-700 flex gap-2"><i className="fa-solid fa-shuffle mt-0.5"></i>Destinatário em {dest.uf} (emitente {ufEmit}): todos os CFOPs 5xxx serão enviados como 6xxx automaticamente.</p>
                  </div>
                )}

                {avisosTela.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1">
                    {avisosTela.map((a, i) => <p key={i} className="text-[11px] font-bold text-amber-700 flex gap-2"><i className="fa-solid fa-triangle-exclamation mt-0.5"></i><span className="flex-1">{a}</span></p>)}
                  </div>
                )}

                {errosTela.length > 0 && (
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-1">
                    {errosTela.map((e, i) => <p key={i} className="text-[11px] font-black text-rose-600 flex gap-2"><i className="fa-solid fa-circle-exclamation mt-0.5"></i><span className="flex-1">{e}</span></p>)}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* ---------- sheets ---------- */}
        {sheetClientes && (
          <Sheet titulo="Escolher do cadastro" fechar={() => setSheetClientes(false)}>
            <input value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)} className={inputCls} placeholder="Buscar por nome ou CNPJ..." autoComplete="off" />
            <div className="mt-3 space-y-1.5">
              {clienteFiltrados.map(c => (
                <button key={c.id} onClick={() => {
                  setDest({
                    nome: (c.razaoSocial || c.nome || '').slice(0, 120),
                    cpfCnpj: c.cnpj || '',
                    ie: c.ie || '',
                    logradouro: c.endereco || '',
                    numero: c.numero || '',
                    bairro: c.bairro || '',
                    municipio: c.municipio || '',
                    uf: (c.uf || '').toUpperCase(),
                    cep: c.cep || '',
                    email: '', telefone: '',
                  });
                  setDestErro([]); setCepMsg(null); setDocMsg(null);
                  setSheetClientes(false);
                  showToast(`Destinatário: ${c.nome}`);
                }} className="w-full text-left px-4 py-3 rounded-2xl border border-gray-100 bg-white flex items-center gap-3 active:scale-[0.98] transition-transform">
                  <span className="w-9 h-9 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center shrink-0"><i className="fa-solid fa-user"></i></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-black text-gray-800 truncate">{c.nome}</span>
                    <span className="block text-[10px] font-bold text-gray-400 truncate">{c.cnpj ? `${c.cnpj} · ` : ''}{c.municipio || 'sem município'}{c.uf ? `/${c.uf}` : ''}</span>
                  </span>
                </button>
              ))}
              {clienteFiltrados.length === 0 && <p className="text-center text-[11px] font-bold text-gray-400 py-6">Nada encontrado — digite o destinatário na mão.</p>}
            </div>
          </Sheet>
        )}

        {sheetProdutos && (
          <Sheet titulo="Adicionar produto" fechar={() => setSheetProdutos(false)}>
            <button onClick={addItemLivre} className="w-full h-12 rounded-xl bg-gray-800 text-white text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mb-3">
              <i className="fa-solid fa-pen"></i>Item livre (digitar tudo na mão)
            </button>
            <input value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)} className={inputCls} placeholder="Buscar no catálogo..." autoComplete="off" />
            <div className="mt-3 space-y-1.5">
              {produtosFiltrados.map(p => (
                <button key={p.id} onClick={() => addItemDeProduto(p)} className="w-full text-left px-4 py-3 rounded-2xl border border-gray-100 bg-white flex items-center gap-3 active:scale-[0.98] transition-transform">
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-black text-gray-800 truncate">{p.nome}</span>
                    <span className="block text-[10px] font-bold text-gray-400 truncate">{p.codigo ? `cód. ${p.codigo} · ` : ''}NCM {p.ncm || 'faltando'} · {fmtBRL(Number(p.precoVenda) || 0)}</span>
                  </span>
                  <i className="fa-solid fa-plus text-amber-500 shrink-0"></i>
                </button>
              ))}
              {produtosFiltrados.length === 0 && <p className="text-center text-[11px] font-bold text-gray-400 py-6">Nada encontrado no catálogo.</p>}
            </div>
          </Sheet>
        )}

        {sheetCfop !== null && sheetCfop < itens.length && (
          <Sheet titulo="CFOP do item" fechar={() => { setSheetCfop(null); setCfopLivre(''); }}>
            <p className="text-[10px] font-bold text-gray-500 mb-3 leading-snug">O sistema ajusta o 1º dígito pela UF do destinatário: 5 = dentro do estado, 6 = fora ({dest.uf || ufEmit}).</p>
            <div className="space-y-1.5">
              {CFOP_BASES.map(b => {
                const cfopIt = itens[sheetCfop].cfop;
                const baseAtual = '5' + soDigitos(cfopIt).slice(1);
                return (
                  <button key={b.cfop} onClick={() => { setItemCampo(sheetCfop, 'cfop', b.cfop); setSheetCfop(null); setCfopLivre(''); }} className={`w-full text-left px-4 py-3 rounded-2xl border-2 flex items-center gap-3 active:scale-[0.98] transition-transform ${baseAtual === b.cfop ? 'border-amber-400 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                    <span className="w-14 text-center text-sm font-black text-gray-800 shrink-0">{b.cfop}</span>
                    <span className="flex-1 text-[11px] font-bold text-gray-600 leading-snug">{b.label}</span>
                    {baseAtual === b.cfop && <i className="fa-solid fa-check text-amber-500"></i>}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-black uppercase text-gray-400 mb-2">CFOP livre (4 dígitos)</p>
              <div className="flex gap-2">
                <input value={cfopLivre} onChange={e => setCfopLivre(e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputCls} inputMode="numeric" placeholder="5949" />
                <button onClick={() => {
                  if (cfopLivre.length === 4 && /^[56]/.test(cfopLivre)) {
                    setItemCampo(sheetCfop, 'cfop', cfopLivre);
                    setSheetCfop(null); setCfopLivre('');
                  } else showToast('CFOP deve ter 4 dígitos começando com 5 ou 6.', false);
                }} className="h-12 px-5 rounded-xl bg-amber-500 text-white font-black text-xs uppercase tracking-wide active:scale-95 transition-transform">OK</button>
              </div>
            </div>
          </Sheet>
        )}

        {sheetTrib !== null && sheetTrib < itens.length && (
          <Sheet titulo="Tributação ICMS do item" fechar={() => setSheetTrib(null)}>
            <div className="space-y-1.5">
              {TRIBUTACOES.map(t => {
                const atual = normalizaTributacao(itens[sheetTrib].tributacao) === t.codigo;
                return (
                  <button key={t.codigo} onClick={() => {
                    setItemCampo(sheetTrib, 'tributacao', t.codigo);
                    setSheetTrib(null);
                  }} className={`w-full text-left px-4 py-3 rounded-2xl border-2 flex items-start gap-3 active:scale-[0.98] transition-transform ${atual ? 'border-teal-400 bg-teal-50' : 'border-gray-100 bg-white'}`}>
                    <span className={`px-2 py-1 rounded-lg text-[11px] font-black shrink-0 ${t.kind === 'CST' ? 'bg-violet-100 text-violet-700' : 'bg-teal-100 text-teal-700'}`}>{t.label}</span>
                    <span className="flex-1 text-[11px] font-bold text-gray-600 leading-snug">{t.desc}</span>
                    {atual && <i className="fa-solid fa-check text-teal-600 mt-1"></i>}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] font-bold text-gray-400 mt-3 leading-snug">Simples Nacional (CSOSN): o ICMS não é destacado na nota — a alíquota da tela é estimativa de conferência. CST de regime normal: base + alíquota SOBEM no XML.</p>
          </Sheet>
        )}

        {sheetOrigem !== null && sheetOrigem < itens.length && (
          <Sheet titulo="Origem da mercadoria" fechar={() => setSheetOrigem(null)}>
            <div className="space-y-1.5">
              {ORIGENS.map(o => {
                const atual = (itens[sheetOrigem].origem || '0') === o.valor;
                return (
                  <button key={o.valor} onClick={() => { setItemCampo(sheetOrigem, 'origem', o.valor); setSheetOrigem(null); }} className={`w-full text-left px-4 py-3.5 rounded-2xl border-2 flex items-center gap-3 active:scale-[0.98] transition-transform ${atual ? 'border-amber-400 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                    <span className="flex-1 text-[11px] font-black text-gray-700">{o.label}</span>
                    {atual && <i className="fa-solid fa-check text-amber-500"></i>}
                  </button>
                );
              })}
            </div>
          </Sheet>
        )}

        {sheetPagamento && (
          <Sheet titulo="Forma de pagamento" fechar={() => setSheetPagamento(false)}>
            <div className="space-y-1.5">
              {FORMAS_PAGAMENTO.map(f => {
                const atual = pagamentoForma === f.forma;
                return (
                  <button key={f.forma} onClick={() => { setPagamentoForma(f.forma); setSheetPagamento(false); }} className={`w-full text-left px-4 py-3.5 rounded-2xl border-2 flex items-center gap-3 active:scale-[0.98] transition-transform ${atual ? 'border-emerald-400 bg-emerald-50' : 'border-gray-100 bg-white'}`}>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black shrink-0 ${f.forma === '90' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>tPag {f.forma}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-black text-gray-800">{f.label}</span>
                      {f.desc && <span className="block text-[10px] font-bold text-gray-400 leading-snug">{f.desc}</span>}
                    </span>
                    {atual && <i className="fa-solid fa-check text-emerald-600"></i>}
                  </button>
                );
              })}
            </div>
          </Sheet>
        )}

        {sheetFinalidade && (
          <Sheet titulo="Finalidade SEFAZ" fechar={() => setSheetFinalidade(false)}>
            <div className="space-y-1.5">
              {FINALIDADES.map(f => {
                const atual = finalidade === f.valor;
                return (
                  <button key={f.valor} onClick={() => { setFinalidade(f.valor); setSheetFinalidade(false); }} className={`w-full text-left px-4 py-3.5 rounded-2xl border-2 flex items-center gap-3 active:scale-[0.98] transition-transform ${atual ? 'border-amber-400 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-black text-gray-800">{f.label}</span>
                      <span className="block text-[10px] font-bold text-gray-400 leading-snug">{f.desc}</span>
                    </span>
                    {atual && <i className="fa-solid fa-check text-amber-500"></i>}
                  </button>
                );
              })}
            </div>
          </Sheet>
        )}

        {/* ---------- toast ---------- */}
        {toast && (
          <div className="fixed top-3 left-4 right-4 z-[130] flex justify-center pointer-events-none">
            <div className={`${toast.ok ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-5 py-3 rounded-2xl shadow-2xl font-black text-[11px] uppercase tracking-wide flex items-center gap-2 max-w-md`}>
              <i className={`fa-solid ${toast.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
              <span className="flex-1">{toast.msg}</span>
            </div>
          </div>
        )}

        {/* ---------- barra de ação fixa (mobile-first) ---------- */}
        <div className="fixed bottom-0 inset-x-0 z-[90] bg-white border-t border-gray-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-2xl mx-auto flex gap-2.5">
            {passo > 1 && !(passo === 4 && resultado) && (
              <button onClick={voltar} disabled={emitindo} className="h-14 px-5 rounded-2xl bg-gray-100 text-gray-600 font-black text-xs uppercase tracking-widest flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-40">
                <i className="fa-solid fa-arrow-left"></i>Voltar
              </button>
            )}
            {passo === 4 && resultado ? (
              <button onClick={() => { if (resultado.status === 'AUTORIZADA' || resultado.status === 'EMITINDO') novaNota(); else setResultado(null); }} className="flex-1 h-14 rounded-2xl bg-amber-500 text-white font-black text-sm uppercase tracking-widest shadow-lg active:scale-[0.98] transition-transform">
                {resultado.status === 'AUTORIZADA' || resultado.status === 'EMITINDO' ? 'Nova nota' : 'Corrigir e emitir de novo'}
              </button>
            ) : passo < 4 ? (
              <button onClick={avancar} className="flex-1 h-14 rounded-2xl bg-amber-500 text-white font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                Continuar<i className="fa-solid fa-arrow-right"></i>
              </button>
            ) : (
              <button onClick={() => void emitir()} disabled={emitindo || status?.configurado === false} className="flex-1 h-14 rounded-2xl bg-emerald-600 text-white font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50">
                {emitindo ? (<><i className="fa-solid fa-rotate animate-spin"></i>Emitindo...</>) : (<><i className="fa-solid fa-file-circle-check"></i>Emitir NF-e {fmtBRL(totalNota)}</>)}
              </button>
            )}
          </div>
        </div>
      </div>
      <footer className="mt-auto pt-2 text-center" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">Notas Especiais · Devolução · Bonificação · nota manual · Doce Mania</p>
      </footer>
    </main>
  );
}
