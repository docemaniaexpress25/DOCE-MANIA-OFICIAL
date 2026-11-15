"use client";

/**
 * BLOCO 143 — PORTAL DE NOTAS (admin, fora do app) — MEGA OTIMIZAÇÃO PC:
 * "na imagem em anexo temos o portal da IOB emissor! junto com o nosso portal
 * vamos otimizar todos os fluxos e botões para que fique 100% funcional
 * acessando pelo PC. precisamos que tudo caiba em uma linha só, otimize os
 * espaços a direita e esquerda! ações sempre devem vir com pergunta de
 * confirmar! crie um botão para importar XML em lote... nesse portal também
 * devem ter em ações os boletos gerados!"
 *
 * BLOCO 146 — ajustes do portal fiscal pedidos pelo dono:
 *  - "DE CIMA PRA BAIXO SEMPRE DEIXAREMOS A ULTIMA NOTA BATIDA EM PRIMEIRO
 *    LUGAR": lista ordenada pelo momento da EMISSÃO (nota_emitida_em; fallback
 *    data da venda) — vendas do app e avulsas Focus/XML misturadas na mesma
 *    régua (antes as avulsas entravam sempre em cima);
 *  - FILTRO NF-e / NFC-e: select ao lado do período;
 *  - "VER O QUE FOI PEDIDO" emula o CUPOM NÃO FISCAL em IMAGEM (canvas 80mm,
 *    itens em lista) — modal CupomNaoFiscal, com baixar/compartilhar;
 *  - WHATSAPP: compartilha DANFE + XML com o cliente por LINK ASSINADO
 *    (7 dias, sem expor a sessão do admin) + abre conversa pelo telefone;
 *  - BOLETO ⇄ NF: o modal do boleto mostra se a NF-e/NFC-e está ATRELADA
 *    (chave vem do Inter) e orienta quando o boleto ficou sem nota.
 *
 * O que mudou no 143:
 *  - TABELA IOB: cada nota = UMA linha compacta (documento, cliente, emissão,
 *    valor, pagamento, vendedor, situação, ações) — página larga (1600px),
 *    paddings apertados, sem quebra de linha;
 *  - TODA ação que muda estado pede CONFIRMAÇÃO (modal unificado de pergunta);
 *  - IMPORTAR XML EM LOTE: botão no cabeçalho — arrasta/seleciona vários XMLs
 *    (ou .zip) de sistemas de terceiros; notas de SAÍDA autorizadas/canceladas
 *    entram arquivadas com DANFE imprimível gerado do XML (origem "XML");
 *  - BOLETOS: linha com boleto Inter mostra o botão de código de barras —
 *    abre o modal com linha digitável, PIX, PDF do boleto, consultar e
 *    cancelar (com motivo e confirmação);
 *  - SEM "FALTA NF A BATER": a lista tem SOMENTE documentos que vieram da API
 *    (venda com nota_ref / avulsas Focus / XMLs importados). Venda sem emissão
 *    não aparece mais (quem resolve pendência usa a aba NOTAS PENDENTES do app);
 *  - CANCELAR NA SEFAZ: botão só aparece DENTRO do prazo (NFC-e 30min /
 *    NF-e 24h) e some sozinho quando vence (relógio vivo de 15s).
 *
 * Auth: POST /api/notas-admin {acao:'AUTH', pin} valida o PIN com bcrypt
 * contra os usuários ADMIN e devolve token de sessão ADMIN (mesmo formato das
 * rotas fiscais /api/notas) — EMITIR/CONSULTAR/CANCELAR reutilizam o fluxo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
// BLOCO 142: prazo SEFAZ de cancelamento (NFC-e 30min / NF-e 24h) — fonte única com o servidor
import { prazoCancelamentoNota } from '@/lib/regras-fiscais';
// BLOCO 146: cupom não fiscal em IMAGEM + WhatsApp compartilhável
import CupomNaoFiscal, { foneWhatsApp } from './CupomNaoFiscal';

// ---------------- tipos ----------------
interface NotaRow {
  id: string;
  numero: string;
  tipo: string;
  status: string;
  ref: string;
  pdfUrl: string;
  xmlUrl: string;
  erro: string;
  chave: string;
  emitidaEm: string | null;
  valor: number;
  valorPago: number;
  metodo: string;
  detalhe: string;
  statusPagamento: string;
  dataVenda: string;
  modoNota: string;
  cliente: string;
  clienteDoc: string;
  clienteId: string;
  vendedor: string;
  // arquivos arquivados DENTRO do sistema (bucket notas-fiscais)
  pdfLocal: boolean;
  xmlLocal: boolean;
  // nota avulsa (emitida fora do app — importada da Focus ou XML de terceiro)
  avulsa?: boolean;
  origem?: string;
  // boleto Inter da venda (BLOCO 143)
  boletoStatus?: string;
  boletoVencimento?: string;
}

interface ItemDetalhe { produto: string; quantidade: number; preco: number; }

interface ClienteDetalhe {
  nome_fantasia: string; nome: string; cnpj: string; razao_social: string;
  inscricao_estadual: string; telefone: string; endereco: string; bairro: string;
  endereco_numero: string; endereco_cep: string; endereco_municipio: string;
  endereco_uf: string; email: string;
}

interface BoletoInfo {
  status: string;
  codigo: string;
  seuNumero: string;
  vencimento: string;
  valor: number | null;
  linhaDigitavel: string;
  codigoBarras: string;
  pixCopiaECola: string;
  valorRecebido: number | null;
  erro: string;
  /** BLOCO 146: chave 44 dig da NF-e/NFC-e atrelada à cobrança no Inter. */
  notaFiscalChave?: string;
}

// ---------------- helpers ----------------
const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

const fmtData = (iso: string) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch { return '—'; }
};

const fmtDia = (iso: string) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(2, 4);
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour12: false }).format(d);
  } catch { return '—'; }
};

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  AUTORIZADA: { label: 'Autorizada', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200', dot: 'bg-emerald-500' },
  EMITINDO: { label: 'Emitindo', cls: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-500' },
  REJEITADA: { label: 'Rejeitada', cls: 'bg-rose-50 text-rose-600 border-rose-200', dot: 'bg-rose-500' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-400' },
  NAO_EMITIDA: { label: 'Pendente', cls: 'bg-blue-50 text-blue-600 border-blue-200', dot: 'bg-blue-500' },
};

function metaStatus(st: string) {
  return STATUS_META[String(st || '').toUpperCase()] || { label: st || '—', cls: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-300' };
}

/** Rótulo certo do documento: NFCE -> "NFC-e", NFE -> "NF-e" (regra BLOCO 135). */
function rotuloTipo(tipo: string, modoNota: string): string {
  const t = String(tipo || '').toUpperCase();
  if (t === 'NFCE') return 'NFC-e';
  if (t === 'NFE') return 'NF-e';
  const m = String(modoNota || '').toUpperCase();
  if (m === 'NFE') return 'NF-e';
  if (m === 'NFCE') return 'NFC-e';
  return 'NF';
}

/** BLOCO 146: tipo cru do documento (NFE | NFCE) para o filtro do portal. */
function tipoDe(tipo: string, modoNota: string): 'NFE' | 'NFCE' {
  const t = String(tipo || '').toUpperCase();
  if (t === 'NFCE' || t === 'NFE') return t;
  return String(modoNota || '').toUpperCase() === 'NFCE' ? 'NFCE' : 'NFE';
}

type FiltroStatus = 'TODAS' | 'AUTORIZADA' | 'EMITINDO' | 'PENDENTE' | 'REJEITADA' | 'CANCELADA';
type FiltroPeriodo = 'TUDO' | 'HOJE' | '7D' | '30D' | 'MES';
type FiltroTipo = 'TODOS' | 'NFE' | 'NFCE';

const PERIODO_META: { key: FiltroPeriodo; label: string }[] = [
  { key: 'HOJE', label: 'Hoje' },
  { key: '7D', label: '7 dias' },
  { key: '30D', label: '30 dias' },
  { key: 'MES', label: 'Este mês' },
  { key: 'TUDO', label: 'Tudo' },
];

function dentroPeriodo(dataVenda: string, p: FiltroPeriodo): boolean {
  if (p === 'TUDO' || !dataVenda) return true;
  const d = new Date(dataVenda);
  if (!isFinite(d.getTime())) return true;
  const agora = new Date();
  const tz = 'America/Sao_Paulo';
  const diaStr = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  if (p === 'HOJE') return diaStr(d) === diaStr(agora);
  if (p === 'MES') return diaStr(d).slice(0, 7) === diaStr(agora).slice(0, 7);
  const dias = p === '7D' ? 7 : 30;
  return d.getTime() >= agora.getTime() - dias * 24 * 60 * 60 * 1000;
}

const FORMAS = ['DINHEIRO', 'PIX', 'BOLETO', 'CHEQUE', 'A_PRAZO'] as const;

// Boleto Inter (BLOCO 143) — rótulo/cor por status
const BOLETO_META: Record<string, { label: string; cls: string }> = {
  A_RECEBER: { label: 'A receber', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  EM_PROCESSAMENTO: { label: 'Processando', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  ATRASADO: { label: 'Atrasado', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  RECEBIDO: { label: 'Recebido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  MARCADO_RECEBIDO: { label: 'Recebido', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  EXPIRADO: { label: 'Expirado', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  FALHA_EMISSAO: { label: 'Falha', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
};

function metaBoleto(st: string) {
  const key = String(st || '').toUpperCase();
  return BOLETO_META[key] || { label: key.replace(/_/g, ' ').toLowerCase() || '—', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
}

const BOLETO_VIVO = ['A_RECEBER', 'EM_PROCESSAMENTO', 'ATRASADO', 'RECEBIDO', 'MARCADO_RECEBIDO', 'FALHA_EMISSAO'];

/** ArrayBuffer -> base64 (chunks para não estourar a pilha com XMLs grandes). */
function bytesToBase64(u8: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    bin += String.fromCharCode(...Array.from(u8.subarray(i, i + CH)));
  }
  return btoa(bin);
}

// ---------------- página ----------------
export default function PortalNotasPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [booting, setBooting] = useState(true);

  // PIN gate
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);

  // Lista
  const [notas, setNotas] = useState<NotaRow[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroStatus>('TODAS');
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('TODOS');
  const [periodo, setPeriodo] = useState<FiltroPeriodo>('TUDO');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Importação da Focus (PDF/XML dentro do sistema)
  const [importBusy, setImportBusy] = useState(false);
  const [importProg, setImportProg] = useState<{ fase: string; done: number; total: number } | null>(null);

  // Importação por ref/chave colada do painel da Focus
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);

  // Modais
  const [detalhe, setDetalhe] = useState<{ nota: NotaRow; cliente: ClienteDetalhe | null; itens: ItemDetalhe[] } | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);
  const [editModal, setEditModal] = useState<NotaRow | null>(null);
  const [editMetodo, setEditMetodo] = useState('');
  const [editDetalhe, setEditDetalhe] = useState('');
  const [cancelModal, setCancelModal] = useState<NotaRow | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [cloneModal, setCloneModal] = useState<NotaRow | null>(null);
  const [emitModal, setEmitModal] = useState<NotaRow | null>(null);
  const [emitTipo, setEmitTipo] = useState<'' | 'NFE' | 'NFCE'>("");

  // ------------------------------------------------------------------
  // BLOCO 143 — CONFIRMAÇÃO UNIFICADA: TODA ação que muda estado passa
  // por esta pergunta antes de executar ("ações sempre devem vir com
  // pergunta de confirmar!").
  // ------------------------------------------------------------------
  interface Conf {
    titulo: string;
    texto: string;
    detalhe?: string;
    icone?: string;
    perigo?: boolean;
    botao?: string;
    run: () => Promise<void> | void;
  }
  const [conf, setConf] = useState<Conf | null>(null);
  const [confBusy, setConfBusy] = useState(false);
  const executarConf = async () => {
    if (!conf || confBusy) return;
    setConfBusy(true);
    try { await conf.run(); } finally { setConfBusy(false); setConf(null); }
  };

  // BLOCO 143 — IMPORTAR XML EM LOTE
  const [xmlOpen, setXmlOpen] = useState(false);
  const [xmlArquivos, setXmlArquivos] = useState<{ nome: string; base64: string; tamanho: number }[]>([]);
  const [xmlBusy, setXmlBusy] = useState(false);
  const [xmlProg, setXmlProg] = useState<{ done: number; total: number } | null>(null);
  const [xmlRes, setXmlRes] = useState<{ importados: number; cancelamentos: number; duplicados: number; entradas: number; ilegiveis: number; erros: { nome: string; mensagem: string }[] } | null>(null);
  const [xmlDrag, setXmlDrag] = useState(false);
  const xmlInput = useRef<HTMLInputElement | null>(null);

  // BLOCO 143 — BOLETO (modal + cancelamento com motivo)
  const [boletoModal, setBoletoModal] = useState<{ n: NotaRow } | null>(null);
  const [boleto, setBoleto] = useState<BoletoInfo | null>(null);
  const [boletoBusy, setBoletoBusy] = useState(false);
  const [boletoMsg, setBoletoMsg] = useState('');
  const [cancelBoleto, setCancelBoleto] = useState<{ n: NotaRow } | null>(null);
  const [cancelBoletoMotivo, setCancelBoletoMotivo] = useState('');

  // BLOCO 146 — COMPARTILHAR NO WHATSAPP (DANFE/XML por link assinado)
  const [waModal, setWaModal] = useState<{ nota: NotaRow } | null>(null);
  const [waMsg, setWaMsg] = useState('');
  const [waFone, setWaFone] = useState('');
  const [waTemLinks, setWaTemLinks] = useState(false);
  const [waBusy, setWaBusy] = useState(false);

  // relógio "agora": o prazo SEFAZ de cancelamento é RELATIVO — o botão
  // de cancelar precisa SUMIR sozinho quando o prazo vence (tick 15s).
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    if (!token) return;
    const iv = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(iv);
  }, [token]);

  /** Prazo de cancelamento de UMA linha (NFC-e 30min / NF-e 24h). */
  const prazoCancelDe = useCallback((n: NotaRow) =>
    prazoCancelamentoNota({ tipo: n.tipo, status: n.status, emitidaEm: n.emitidaEm, fallbackData: n.dataVenda, agora }), [agora]);

  // Prazo da nota aberta no modal de cancelamento — re-render ao vivo (tick 15s)
  const prazoCancelModal = useMemo(
    () => (cancelModal ? prazoCancelamentoNota({ tipo: cancelModal.tipo, status: cancelModal.status, emitidaEm: cancelModal.emitidaEm, fallbackData: cancelModal.dataVenda, agora }) : null),
    [cancelModal, agora],
  );

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const headers = (t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

  // ---------- boot: retomar sessão ----------
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
      const res = await fetch('/api/notas-admin?acao=lista', { headers: headers(t) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
        setToken(null); setNomeAdmin('');
        setErroLista('Sessão expirada. Entre com o PIN novamente.');
        return;
      }
      if (!res.ok || !data.ok) { setErroLista(data.erro || `Erro ${res.status}`); return; }
      // BLOCO 150 (regra do dono): a lista agora inclui TODAS as notas criadas
      // pelo app — pendentes intencionais (NAO_EMITIDA) entram como PENDENTE
      // com botão EMITIR; nada criado pelo app pode sumir do portal.
      setNotas(((data.notas || []) as NotaRow[]));
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
    setToken(null); setNomeAdmin(''); setNotas([]); setBusca(''); setFiltro('TODAS'); setPeriodo('TUDO');
  };

  // ---------- lista filtrada ----------
  // BLOCO 146: filtro por TIPO (NF-e / NFC-e) + regra do dono "a última nota
  // batida sempre em primeiro lugar (de cima pra baixo)" — reordena pela
  // emissão do documento mesmo que a API venha com ordenação antiga.
  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = notas.filter(n => {
      if (filtroTipo !== 'TODOS' && tipoDe(n.tipo, n.modoNota) !== filtroTipo) return false;
      if (filtro !== 'TODAS' && String(n.status || '').toUpperCase() !== filtro) return false;
      if (!dentroPeriodo(n.dataVenda, periodo)) return false;
      if (!q) return true;
      return (
        (n.numero || '').includes(q) ||
        (n.cliente || '').toLowerCase().includes(q) ||
        (n.clienteDoc || '').toLowerCase().includes(q) ||
        (n.chave || '').includes(q) ||
        (n.vendedor || '').toLowerCase().includes(q)
      );
    });
    const batida = (n: NotaRow): string => String(n.emitidaEm || n.dataVenda || '');
    return [...base].sort((a, b) => batida(b).localeCompare(batida(a)));
  }, [notas, busca, filtro, filtroTipo, periodo]);

  const kpis = useMemo(() => {
    const visiveis = notas.filter(n => dentroPeriodo(n.dataVenda, periodo));
    const autorizadas = visiveis.filter(n => n.status === 'AUTORIZADA');
    const canceladas = visiveis.filter(n => n.status === 'CANCELADA');
    const rejeitadas = visiveis.filter(n => n.status === 'REJEITADA');
    const pendentes = visiveis.filter(n => n.status === 'NAO_EMITIDA');
    return {
      total: visiveis.length,
      autorizadas: autorizadas.length,
      canceladas: canceladas.length,
      rejeitadas: rejeitadas.length,
      pendentes: pendentes.length,
      valor: autorizadas.reduce((a, n) => a + (Number(n.valor) || 0), 0),
      pdfLocal: visiveis.filter(n => n.pdfLocal).length,
      xmlLocal: visiveis.filter(n => n.xmlLocal).length,
    };
  }, [notas, periodo]);

  const contagem = useCallback((f: FiltroStatus) => {
    if (f === 'TODAS') return listaFiltrada.length;
    if (f === 'PENDENTE') return listaFiltrada.filter(n => String(n.status || '').toUpperCase() === 'NAO_EMITIDA').length;
    return listaFiltrada.filter(n => String(n.status || '').toUpperCase() === f).length;
  }, [listaFiltrada]);

  // ---------- ações ----------
  const abrirDetalhe = async (n: NotaRow) => {
    if (!token) return;
    setBusyId(`det:${n.id}`);
    setDetalheLoading(true);
    setDetalhe(null);
    try {
      if (n.avulsa) {
        // avulsa: detalhe vem dos metadados (sem pedido interno)
        setDetalhe({ nota: n, cliente: null, itens: [] });
        return;
      }
      const res = await fetch(`/api/notas-admin?acao=detalhe&id=${encodeURIComponent(n.id)}`, { headers: headers(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao abrir o pedido.', false); return; }
      setDetalhe({ nota: (data.nota || n) as NotaRow, cliente: (data.cliente || null) as ClienteDetalhe | null, itens: (data.itens || []) as ItemDetalhe[] });
    } catch {
      showToast('Falha de conexão ao abrir o pedido.', false);
    } finally {
      setDetalheLoading(false);
      setBusyId(null);
    }
  };

  const salvarEdicao = async () => {
    if (!token || !editModal) return;
    setBusyId('edit');
    try {
      const res = await fetch('/api/notas-admin', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'EDITAR', saleId: editModal.id, metodoPagamento: editMetodo, detalhe: editDetalhe }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao salvar a edição.', false); return; }
      showToast('Registro atualizado (o XML fiscal já autorizado não muda).');
      setEditModal(null);
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao salvar.', false);
    } finally { setBusyId(null); }
  };

  const cancelarNota = async () => {
    if (!token || !cancelModal) return;
    if (justificativa.trim().length < 15) { showToast('Justificativa obrigatória (mínimo 15 caracteres — regra da SEFAZ).', false); return; }
    setBusyId('cancel');
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'CANCELAR', saleId: cancelModal.id, justificativa: justificativa.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.erro || 'Falha ao cancelar na SEFAZ.', false); return; }
      // BLOCO 147: o servidor cancela o BOLETO junto — se o boleto não saiu
      // (Inter fora), a venda fica na lista em CANCELADAS para resolver aqui.
      const aviso: string = String(data.aviso || (data.ok ? 'Nota cancelada na SEFAZ.' : 'Cancelamento em processamento — consulte em alguns segundos.'));
      showToast(aviso, !!data.ok);
      if (data.bloqueioBoleto) showToast('ATENÇÃO: o BOLETO continua VIVO no banco! A venda segue na lista (CANCELADAS) — cancele o boleto em Ações > Boleto > Cancelar.', false);
      setCancelModal(null); setJustificativa('');
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao cancelar.', false);
    } finally { setBusyId(null); }
  };

  const clonarVenda = async () => {
    if (!token || !cloneModal) return;
    setBusyId('clone');
    try {
      const res = await fetch('/api/notas-admin', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'CLONAR', saleId: cloneModal.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao clonar a venda.', false); return; }
      showToast('Cópia criada como venda pendente no app — emita a NF pela aba NOTAS PENDENTES.');
      setCloneModal(null);
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao clonar.', false);
    } finally { setBusyId(null); }
  };

  const emitirNota = async () => {
    if (!token || !emitModal) return;
    setBusyId('emit');
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'EMITIR', saleId: emitModal.id, tipo: emitTipo || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      const nota = data.nota || {};
      if (!res.ok) {
        showToast(data.erro || 'Falha ao emitir na SEFAZ.', false);
        void carregar(token);
        return;
      }
      if (nota.status === 'AUTORIZADA') showToast(`Documento autorizado — nº ${nota.numero || '?'}`);
      else if (nota.status === 'EMITINDO') showToast('Enviada à SEFAZ — aguardando autorização (use CONSULTAR).');
      else showToast(nota.erro || 'SEFAZ rejeitou a emissão — veja o motivo na linha.', false);
      setEmitModal(null);
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao emitir.', false);
    } finally { setBusyId(null); }
  };

  // ---------- IMPORTAR DA FOCUS ----------
  // Loop de lotes: o servidor processa 6 notas por chamada (rate limit da
  // Focus) e devolve done=true quando não sobra nada sem arquivo local.
  const importarTudo = async () => {
    if (!token || importBusy) return;
    setImportBusy(true);
    let okCount = 0, falhas = 0, semArq = 0, avulsasNovas = 0;
    try {
      setImportProg({ fase: 'Notas do app', done: 0, total: 0 });
      for (let i = 0; i < 50; i++) {
        const res = await fetch('/api/notas-importar', {
          method: 'POST',
          headers: headers(token),
          body: JSON.stringify({ acao: 'IMPORTAR' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao importar da Focus.', false); break; }
        okCount += Number(data.feitos) || 0;
        falhas += Number(data.comFalha) || 0;
        semArq += Number(data.semArquivo) || 0;
        setImportProg({ fase: 'Notas do app', done: (Number(data.total) || 0) - (Number(data.faltando) || 0), total: Number(data.total) || 0 });
        if (data.done) break;
      }
      // Varredura dos BACKUPS MENSAIS oficiais da Focus (app + painel).
      setImportProg({ fase: 'Varredura da Focus', done: 0, total: 0 });
      let avulsasMsg = '';
      let hooksFalhaMsg = '';
      for (let i = 0; i < 20; i++) {
        const res = await fetch('/api/notas-importar', {
          method: 'POST',
          headers: headers(token),
          body: JSON.stringify({ acao: 'AVULSAS' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) break;
        avulsasNovas += Number(data.novas) || 0;
        if (data.suportado === false) avulsasMsg = String(data.msg || '');
        // BLOCO 150: gatilho quebrado na Focus = notas novas NUNCA chegam em
        // tempo real — o dono precisa ver isso na hora (era o buraco NFC-e).
        const hf = Array.isArray(data.hooksFalhas) ? (data.hooksFalhas as string[]).filter(Boolean) : [];
        if (hf.length > 0) hooksFalhaMsg = `ATENÇÃO — gatilho da Focus com falha: ${hf.join('; ')}. Notas novas podem NÃO chegar em tempo real.`;
        if (data.fim) break;
      }
      const partes = [`${okCount} nota(s) arquivada(s)`];
      if (avulsasNovas > 0) partes.push(`${avulsasNovas} do painel da Focus`);
      if (semArq > 0) partes.push(`${semArq} sem arquivo ainda`);
      if (falhas > 0) partes.push(`${falhas} com falha`);
      showToast(avulsasMsg && avulsasNovas === 0 ? `Arquivamento concluído (${partes.join(' · ')}). ${avulsasMsg}` : `Importação concluída: ${partes.join(' · ')}.`);
      if (hooksFalhaMsg) showToast(hooksFalhaMsg, false);
      void carregar(token);
    } catch {
      showToast('Falha de conexão na importação.', false);
    } finally {
      setImportBusy(false);
      setImportProg(null);
    }
  };

  /** Importa notas coladas do painel da Focus (ref OU chave de acesso). */
  const importarColadas = async () => {
    if (!token || pasteBusy) return;
    if (!pasteText.trim()) { showToast('Cole a referência ou a chave de acesso (44 dígitos) copiada do painel da Focus.', false); return; }
    setPasteBusy(true);
    try {
      const res = await fetch('/api/notas-importar', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'IMPORTAR_POR_REF', texto: pasteText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao importar.', false); return; }
      const falhas = (data.resultados || []).filter((r: { ok: boolean }) => !r.ok);
      showToast(data.msg || 'Importação concluída.', !falhas.length);
      if (falhas.length) {
        setPasteText(falhas.map((f: { token: string }) => f.token).join('\n'));
      } else {
        setPasteText('');
        setPasteOpen(false);
      }
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao importar.', false);
    } finally { setPasteBusy(false); }
  };

  const atualizarAvulsa = async (n: NotaRow) => {
    if (!token) return;
    setBusyId(n.id);
    try {
      const res = await fetch('/api/notas-importar', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'ATUALIZAR_AVULSA', ref: n.ref }),
      });
      const data = await res.json().catch(() => ({}));
      showToast(data.ok ? 'Avulsa re-consultada na SEFAZ e arquivada.' : data.erro || 'Falha ao atualizar.', !!data.ok);
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao atualizar.', false);
    } finally { setBusyId(null); }
  };

  const excluirAvulsa = async (n: NotaRow) => {
    if (!token) return;
    setBusyId(n.id);
    try {
      const res = await fetch('/api/notas-importar', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'EXCLUIR_AVULSA', ref: n.ref }),
      });
      const data = await res.json().catch(() => ({}));
      showToast(data.ok ? 'Cópia interna apagada.' : data.erro || 'Falha ao apagar.', !!data.ok);
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao apagar.', false);
    } finally { setBusyId(null); }
  };

  /** Link do arquivo pela NOSSA rota (storage próprio → cai na Focus ao vivo).
   *  Token na query — o <a> de download não carrega header de auth. */
  const linkArquivo = (n: NotaRow, tipo: 'pdf' | 'xml'): string => {
    const t = token ? `&token=${encodeURIComponent(token)}` : '';
    if (n.avulsa) {
      const doc = String(n.tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe';
      return `/api/notas-arquivo?ref=${encodeURIComponent(n.ref)}&doc=${doc}&tipo=${tipo}${t}`;
    }
    return `/api/notas-arquivo?saleId=${encodeURIComponent(n.id)}&tipo=${tipo}${t}`;
  };

  // ---------- BLOCO 143: XML EM LOTE ----------
  const pegarArquivos = async (files: FileList | File[]) => {
    const add: { nome: string; base64: string; tamanho: number }[] = [];
    const zipTravados: string[] = [];
    for (const f of Array.from(files).slice(0, 200)) {
      try {
        if (/\.zip$/i.test(f.name)) {
          const zipped = unzipSync(new Uint8Array(await f.arrayBuffer()));
          for (const [nome, u8] of Object.entries(zipped)) {
            if (!/\.xml$/i.test(nome) || nome.startsWith('__MACOSX')) continue;
            add.push({ nome: `${f.name}/${nome}`, base64: bytesToBase64(u8), tamanho: u8.length });
          }
        } else if (/\.xml$/i.test(f.name) || f.type === 'text/xml' || f.type === 'application/xml') {
          const u8 = new Uint8Array(await f.arrayBuffer());
          add.push({ nome: f.name, base64: bytesToBase64(u8), tamanho: u8.length });
        } else {
          zipTravados.push(f.name);
        }
      } catch {
        zipTravados.push(f.name);
      }
    }
    setXmlArquivos(atuais => {
      const nomes = new Set(atuais.map(a => a.nome));
      const novos = add.filter(a => !nomes.has(a.nome) && a.tamanho > 0);
      return [...atuais, ...novos];
    });
    if (zipTravados.length) showToast(`${zipTravados.length} arquivo(s) ignorado(s) — só aceito .xml e .zip.`, false);
    if (xmlRes) setXmlRes(null);
  };

  const importarXmlLote = async () => {
    if (!token || xmlBusy || xmlArquivos.length === 0) return;
    setXmlBusy(true);
    setXmlRes(null);
    const total = xmlArquivos.length;
    setXmlProg({ done: 0, total });
    const erros: { nome: string; mensagem: string }[] = [];
    let importados = 0, cancelamentos = 0, duplicados = 0, entradas = 0, ilegiveis = 0;
    try {
      const CH = 8;
      for (let i = 0; i < total; i += CH) {
        const lote = xmlArquivos.slice(i, i + CH);
        const res = await fetch('/api/notas-importar', {
          method: 'POST',
          headers: headers(token),
          body: JSON.stringify({ acao: 'XML_LOTE', arquivos: lote.map(a => ({ nome: a.nome, base64: a.base64 })) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          showToast(data.erro || 'Falha ao importar o lote de XMLs.', false);
          break;
        }
        importados += Number(data.importados) || 0;
        cancelamentos += Number(data.cancelamentos) || 0;
        duplicados += Number(data.duplicados) || 0;
        entradas += Number(data.entradas) || 0;
        ilegiveis += Number(data.ilegiveis) || 0;
        for (const r of (data.resultados || []) as { nome: string; ok: boolean; mensagem: string }[]) {
          if (!r.ok) erros.push({ nome: r.nome, mensagem: r.mensagem });
        }
        setXmlProg({ done: Math.min(i + CH, total), total });
      }
      setXmlRes({ importados, cancelamentos, duplicados, entradas, ilegiveis, erros });
      showToast(`${importados} nota(s) importada(s) do XML — a lista já está atualizada.`);
      setXmlArquivos([]);
      void carregar(token);
    } catch {
      showToast('Falha de conexão na importação de XMLs.', false);
    } finally {
      setXmlBusy(false);
      setXmlProg(null);
    }
  };

  // ---------- BLOCO 143: BOLETO ----------
  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      showToast(`${rotulo} copiado.`);
    } catch {
      showToast('Não foi possível copiar — selecione e copie manualmente.', false);
    }
  };

  // ---------- BLOCO 146: COMPARTILHAR NO WHATSAPP ----------
  /** Monta a mensagem com os links assinados do DANFE/XML (expiram em 7 dias). */
  const montarMsgWhatsApp = (n: NotaRow, links: { pdf: string; xml: string } | null, temFone: boolean): string => {
    const linhas = [
      '*DOCE MANIA*',
      `Documento: ${rotuloTipo(n.tipo, n.modoNota)}${n.numero ? ` n\u00ba ${n.numero}` : ''}`,
      `Cliente: ${n.cliente}`,
      `Valor: ${fmtBRL(n.valor)}`,
    ];
    if (n.chave) linhas.push(`Chave de acesso: ${n.chave}`);
    if (links) {
      linhas.push('', `DANFE (PDF): ${links.pdf}`, `XML: ${links.xml}`, '(links v\u00e1lidos por 7 dias)');
    } else {
      linhas.push('', 'O DANFE e o XML podem ser baixados no portal de notas.');
    }
    if (!temFone) linhas.push('', '(abre o WhatsApp sem contato definido \u2014 escolha o destinat\u00e1rio)');
    linhas.push('', 'Obrigado pela compra!');
    return linhas.join('\n');
  };

  /** Prepara e abre o modal de compartilhamento (busca telefone + links assinados). */
  const abrirWhatsApp = async (n: NotaRow) => {
    if (!token || waBusy) return;
    setWaBusy(true);
    setWaModal({ nota: n });
    setWaMsg('');
    try {
      // telefone do cliente (cadastro) — só para vendas do app
      let fone = '';
      if (!n.avulsa) {
        const res = await fetch(`/api/notas-admin?acao=detalhe&id=${encodeURIComponent(n.id)}`, { headers: headers(token) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.cliente?.telefone) {
          fone = foneWhatsApp(String(data.cliente.telefone));
        }
      }
      // links assinados do DANFE/XML (servidor devolve absoluto com a origem atual)
      let links: { pdf: string; xml: string } | null = null;
      if (n.ref) {
        const q = n.avulsa
          ? `ref=${encodeURIComponent(n.ref)}&doc=${String(n.tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe'}`
          : `id=${encodeURIComponent(n.id)}`;
        const res = await fetch(`/api/notas-admin?acao=links&${q}`, { headers: headers(token) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.links?.pdf) links = data.links as { pdf: string; xml: string };
      }
      setWaFone(fone);
      setWaTemLinks(!!links);
      setWaMsg(montarMsgWhatsApp(n, links, !!fone));
    } catch {
      setWaMsg(montarMsgWhatsApp(n, null, false));
      setWaTemLinks(false);
    } finally {
      setWaBusy(false);
    }
  };

  /** Abre o WhatsApp Web/app com a mensagem (e o contato, quando existe). */
  const enviarWhatsApp = () => {
    const fone = waFone.replace(/\D/g, '');
    const texto = encodeURIComponent(waMsg);
    const url = fone ? `https://wa.me/${fone}?text=${texto}` : `https://wa.me/?text=${texto}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setWaModal(null);
    showToast('WhatsApp aberto — revise o destinatário e envie.');
  };


  const abrirBoleto = async (n: NotaRow) => {
    if (!token) return;
    setBoletoModal({ n });
    setBoleto(null);
    setBoletoMsg('');
    setBoletoBusy(true);
    try {
      const res = await fetch(`/api/boletos?saleId=${encodeURIComponent(n.id)}`, { headers: headers(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setBoletoMsg(data.erro || 'Falha ao carregar o boleto.'); return; }
      setBoleto(data.boleto as BoletoInfo);
    } catch {
      setBoletoMsg('Falha de conexão ao carregar o boleto.');
    } finally { setBoletoBusy(false); }
  };

  const pdfBoleto = async () => {
    if (!token || !boletoModal) return;
    setBoletoBusy(true);
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'PDF', saleId: boletoModal.n.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.pdfBase64) { showToast(data.erro || 'Falha ao buscar o PDF no Inter.', false); return; }
      const bin = atob(data.pdfBase64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `boleto-${boletoModal.n.numero || boletoModal.n.id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast('PDF do boleto baixado.');
    } catch {
      showToast('Falha ao gerar o PDF do boleto.', false);
    } finally { setBoletoBusy(false); }
  };

  const consultarBoleto = async () => {
    if (!token || !boletoModal) return;
    setBoletoBusy(true);
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'CONSULTAR', saleId: boletoModal.n.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao consultar o Inter.', false); return; }
      setBoleto(data.boleto as BoletoInfo);
      showToast('Boleto consultado no Inter.');
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao consultar o boleto.', false);
    } finally { setBoletoBusy(false); }
  };

  const cancelarBoleto = async () => {
    if (!token || !cancelBoleto) return;
    const motivo = cancelBoletoMotivo.trim();
    if (!motivo) { showToast('Informe o motivo do cancelamento (obrigatório no Inter).', false); return; }
    setBoletoBusy(true);
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ acao: 'CANCELAR', saleId: cancelBoleto.n.id, motivo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { showToast(data.erro || 'Falha ao cancelar o boleto no Inter.', false); return; }
      showToast('Boleto cancelado no Inter.');
      setCancelBoleto(null);
      setCancelBoletoMotivo('');
      setBoletoModal(null);
      void carregar(token);
    } catch {
      showToast('Falha de conexão ao cancelar o boleto.', false);
    } finally { setBoletoBusy(false); }
  };

  // ---------- tela: boot ----------
  if (booting) {
    return (
      <div className="min-h-screen bg-blue-600 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // ---------- tela: PIN ----------
  if (!token) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-6">
        <div className={`bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md text-center ${pinShake ? 'animate-shake' : ''}`}>
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <i className="fa-solid fa-file-invoice-dollar text-blue-600 text-3xl"></i>
          </div>
          <h1 className="text-xl font-black text-gray-800 mb-1">Portal de Notas Fiscais</h1>
          <p className="text-gray-400 text-sm mb-8 font-medium">Acesso restrito — mesmo PIN do admin</p>

          <div className="flex justify-center gap-3 mb-6" aria-label="PIN digitado">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${pin.length > i ? 'bg-blue-600 border-blue-600' : 'border-gray-200'}`} />
            ))}
          </div>
          {pinErro && <p className="text-rose-500 text-xs font-bold mb-4">{pinErro}</p>}

          <div className="grid grid-cols-3 gap-3 mb-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} type="button" onClick={() => digitar(d)} className="h-14 rounded-2xl bg-gray-50 text-lg font-black text-gray-700 active:scale-95 transition-transform" aria-label={`Digitar ${d}`}>{d}</button>
            ))}
            <button type="button" onClick={apagar} className="h-14 rounded-2xl bg-rose-50 text-rose-500 active:scale-95 transition-transform" aria-label="Apagar dígito">
              <i className="fa-solid fa-delete-left"></i>
            </button>
            <button type="button" onClick={() => digitar('0')} className="h-14 rounded-2xl bg-gray-50 text-lg font-black text-gray-700 active:scale-95 transition-transform" aria-label="Digitar 0">0</button>
            <button type="button" onClick={() => void entrarComPin(pin)} disabled={pinBusy || pin.length === 0} className="h-14 rounded-2xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-50">
              {pinBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Entrar'}
            </button>
          </div>
          <p className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">DOCE MANIA · Administração de notas de saída</p>
        </div>
        <style>{`@keyframes shake { 10%, 90% { transform: translateX(-1px);} 20%, 80% { transform: translateX(2px);} 30%, 50%, 70% { transform: translateX(-4px);} 40%, 60% { transform: translateX(4px);} } .animate-shake { animation: shake 0.5s; }`}</style>
      </div>
    );
  }

  // ---------- tela: lista (PC otimizado — BLOCO 143) ----------
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ================= HEADER compacto (1 linha de título + 1 de KPIs) ================= */}
      <header className="sticky top-0 z-40 shadow-lg shadow-blue-900/10">
        <div className="bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-900 text-white">
          <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-file-invoice-dollar text-blue-100"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Portal de Notas Fiscais <span className="text-blue-300">NF-e · NFC-e</span></h1>
              <p className="text-[10px] text-blue-200/70 font-semibold mt-1 leading-none truncate">
                {nomeAdmin ? <><i className="fa-solid fa-user-shield mr-1 text-[8px]"></i>{nomeAdmin} · </> : null}
                <span className="uppercase tracking-wide">administração de saída</span>
              </p>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setXmlOpen(true); setXmlRes(null); }}
                className="bg-teal-400 hover:bg-teal-300 text-teal-950 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-lg shadow-teal-900/30 flex items-center gap-1.5"
                title="Importar XMLs de notas de SAÍDA emitidas em sistemas de terceiros — aceita vários arquivos e .zip; entra arquivado com DANFE imprimível"
              >
                <i className="fa-solid fa-file-import"></i>Importar XML em lote
              </button>
              <button
                onClick={() => setConf({
                  titulo: 'Buscar TODAS na Focus?',
                  texto: 'A varredura busca TODAS as notas do CNPJ na API da Focus (do app e do painel), baixa PDF e XML e arquiva tudo dentro do sistema. Pode demorar alguns minutos.',
                  detalhe: 'Notas que já estão arquivadas são puladas (nunca duplica).',
                  icone: 'fa-cloud-arrow-down',
                  botao: 'Buscar agora',
                  run: importarTudo,
                })}
                disabled={importBusy}
                className="bg-emerald-400 hover:bg-emerald-300 disabled:opacity-60 text-emerald-950 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-lg shadow-emerald-900/30 flex items-center gap-1.5"
                title="Varre a API da Focus (NF-e + NFC-e do CNPJ) e grava PDF (DANFE) e XML de TODAS as notas DENTRO do sistema"
              >
                <i className={`fa-solid fa-cloud-arrow-down ${importBusy ? 'fa-bounce' : ''}`}></i>{importBusy ? 'Importando...' : 'Buscar TODAS na Focus'}
              </button>
              <button
                onClick={() => void carregar(token)}
                className="bg-white/15 hover:bg-white/25 text-white rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Atualizar lista"
              >
                <i className={`fa-solid fa-rotate ${carregando ? 'fa-spin' : ''}`}></i>Atualizar
              </button>
              <button
                onClick={sair}
                className="bg-white/10 hover:bg-white/20 text-blue-100 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Sair do portal"
              >
                <i className="fa-solid fa-right-from-bracket"></i>Sair
              </button>
            </div>
          </div>
        </div>
        {/* faixa de KPIs — uma linha só */}
        <div className="bg-blue-950 text-blue-100">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center gap-4 text-[10px] font-bold whitespace-nowrap overflow-x-auto" role="status">
            <span><b className="text-white">{kpis.total}</b> no período</span>
            <span className="text-emerald-300"><b>{kpis.autorizadas}</b> autorizadas</span>
            <span className="text-gray-400"><b>{kpis.canceladas}</b> canceladas</span>
            <span className="text-rose-300"><b>{kpis.rejeitadas}</b> rejeitadas</span>
            {kpis.pendentes > 0 && <span className="text-blue-200"><b>{kpis.pendentes}</b> pendentes</span>}
            <span className="text-amber-300"><b>{fmtBRL(kpis.valor)}</b> autorizado</span>
            <span className="text-blue-300/60">|</span>
            <span className="text-emerald-200/80">{kpis.pdfLocal} DANFE · {kpis.xmlLocal} XML no sistema</span>
            {importBusy && importProg && (
              <span className="ml-auto flex items-center gap-2 text-emerald-300">
                <i className="fa-solid fa-cloud-arrow-down animate-bounce"></i>
                {importProg.fase}
                {importProg.total > 0 && <span className="tabular-nums">{importProg.done}/{importProg.total}</span>}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ================= FILTROS — uma linha (busca + período + chips) ================= */}
      <div className="max-w-[1600px] w-full mx-auto px-4 mt-3 flex items-center gap-2 flex-wrap lg:flex-nowrap">
        <div className="relative flex-1 min-w-[220px]">
          <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por número, cliente, CNPJ, chave ou vendedor..."
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-100"
            aria-label="Buscar nota"
          />
        </div>
        <select
          value={periodo}
          onChange={e => setPeriodo(e.target.value as FiltroPeriodo)}
          className="bg-white border border-gray-200 rounded-xl shadow-sm px-3 py-2.5 text-[10px] font-black uppercase text-gray-600 outline-none"
          aria-label="Período"
        >
          {PERIODO_META.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {/* BLOCO 146: filtro por tipo de documento */}
        <select
          value={filtroTipo}
          onChange={e => setFiltroTipo(e.target.value as FiltroTipo)}
          className="bg-white border border-gray-200 rounded-xl shadow-sm px-3 py-2.5 text-[10px] font-black uppercase text-gray-600 outline-none"
          aria-label="Tipo de documento"
        >
          <option value="TODOS">NF-e + NFC-e</option>
          <option value="NFE">Só NF-e</option>
          <option value="NFCE">Só NFC-e</option>
        </select>
        <div className="flex gap-1.5 overflow-x-auto">
          {(['TODAS', 'AUTORIZADA', 'PENDENTE', 'EMITINDO', 'REJEITADA', 'CANCELADA'] as FiltroStatus[]).map(f => {
            const meta = metaStatus(f);
            const ativo = filtro === f;
            return (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-wider border transition-all active:scale-95 ${ativo ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : `bg-white ${meta.cls} border-gray-200`}`}
              >
                {f === 'TODAS' ? 'Todas' : f === 'PENDENTE' ? 'Pendente' : meta.label} ({contagem(f)})
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= IMPORTAR NOTA ESPECÍFICA (ref/chave colada) ================= */}
      <div className="max-w-[1600px] w-full mx-auto px-4 mt-2">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setPasteOpen(o => !o)}
            className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left"
            aria-expanded={pasteOpen}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
              <i className="fa-solid fa-clipboard-paste mr-2 text-blue-500"></i>
              Importar nota específica (ref ou chave) — manual
            </span>
            <i className={`fa-solid fa-chevron-down text-gray-300 text-[10px] transition-transform ${pasteOpen ? 'rotate-180' : ''}`}></i>
          </button>
          {pasteOpen && (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-[9px] font-bold text-gray-400 leading-snug">
                Para trazer UMA nota específica da Focus na hora: copie no painel da Focus a <b>referência</b> ou a <b>chave de acesso (44 dígitos)</b>, cole aqui (uma por linha). Para trazer todas de uma vez, use <b>Buscar TODAS na Focus</b>; para notas de sistemas de terceiros, use <b>Importar XML em lote</b>.
              </p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={3}
                placeholder={'41190612345678000123550010000000221923094166\nVENDA-0001  NFe411906...'}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[11px] font-mono font-semibold outline-none focus:ring-2 focus:ring-blue-100"
                aria-label="Referências ou chaves de acesso"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[8px] font-black uppercase text-gray-300 tracking-wider">máx. 20 por vez</p>
                <button
                  onClick={() => void importarColadas()}
                  disabled={pasteBusy || !pasteText.trim()}
                  className="bg-blue-600 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all"
                >
                  {pasteBusy ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Importando...</> : <><i className="fa-solid fa-cloud-arrow-down mr-1.5"></i>Importar coladas</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= TABELA (estilo IOB — 1 linha por nota) ================= */}
      <main className="max-w-[1600px] w-full mx-auto px-4 mt-2 flex-1 pb-6">
        {carregando && notas.length === 0 && (
          <div className="py-16 flex justify-center"><div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" /></div>
        )}

        {!carregando && erroLista && (
          <div className="bg-white rounded-2xl border border-rose-100 p-6 text-center mt-2">
            <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xl"></i>
            <p className="text-xs font-bold text-gray-600 mt-2">{erroLista}</p>
            <button onClick={() => void carregar(token)} className="mt-3 bg-blue-600 text-white rounded-xl px-4 py-2 text-[10px] font-black uppercase active:scale-95">Tentar novamente</button>
          </div>
        )}

        {!carregando && !erroLista && listaFiltrada.length === 0 && (
          <div className="text-center py-16 opacity-40 flex flex-col items-center gap-3">
            <i className="fa-solid fa-file-circle-xmark text-4xl"></i>
            <p className="font-black uppercase tracking-widest text-[10px]">Nenhuma nota neste filtro</p>
          </div>
        )}

        {!carregando && !erroLista && listaFiltrada.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Documento', 'Cliente', 'Emissão', 'Valor', 'Pagamento', 'Vendedor', 'Situação', 'Ações'].map(h => (
                      <th key={h} className={`px-3 py-2 text-[8px] font-black uppercase text-gray-400 tracking-wider whitespace-nowrap ${h === 'Ações' ? 'text-center' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.map(n => {
                    const meta = metaStatus(n.status);
                    const podeEmitir = n.status === 'REJEITADA' || n.status === 'CANCELADA' || n.status === 'NAO_EMITIDA';
                    const ocupado = busyId === n.id;
                    const prazo = prazoCancelDe(n);
                    const podeCancelar = !n.avulsa && (n.status === 'AUTORIZADA' || n.status === 'EMITINDO') && !!n.ref && prazo.dentroDoPrazo;
                    const temBoletoVivo = !n.avulsa && !!n.boletoStatus && BOLETO_VIVO.includes(String(n.boletoStatus).toUpperCase());
                    const bm = temBoletoVivo ? metaBoleto(n.boletoStatus as string) : null;
                    return (
                      <tr key={n.id} className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40 transition-colors group">
                        {/* Documento */}
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="text-xs font-black text-gray-800 tabular-nums">{n.numero ? `Nº ${n.numero}` : '—'}</span>
                          <span className="ml-1.5 inline-block align-middle text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{rotuloTipo(n.tipo, n.modoNota)}</span>
                          {n.avulsa && (
                            <span className={`ml-1 inline-block align-middle text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${n.origem === 'XML' ? 'bg-teal-50 text-teal-600' : 'bg-amber-50 text-amber-600'}`} title={n.origem === 'XML' ? 'Importada por XML de sistema de terceiros' : 'Nota emitida fora do app — importada da Focus'}>
                              {n.origem === 'XML' ? 'XML' : 'Focus'}
                            </span>
                          )}
                        </td>
                        {/* Cliente */}
                        <td className="px-3 py-1.5 max-w-[230px]">
                          <p className="text-[11px] font-bold text-gray-700 truncate" title={`${n.cliente}${n.clienteDoc ? ` · ${n.clienteDoc}` : ''}`}>{n.cliente}</p>
                        </td>
                        {/* Emissão */}
                        <td className="px-3 py-1.5 whitespace-nowrap text-[11px] font-semibold text-gray-600 tabular-nums" title={`venda: ${fmtData(n.dataVenda)}`}>
                          {fmtData(n.emitidaEm || n.dataVenda)}
                        </td>
                        {/* Valor */}
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="text-[11px] font-black text-gray-800 tabular-nums">{fmtBRL(n.valor)}</span>
                          <span className={`ml-1.5 text-[8px] font-black uppercase ${n.statusPagamento === 'PAGO' ? 'text-emerald-500' : 'text-amber-500'}`}>{n.statusPagamento === 'PAGO' ? 'pago' : n.avulsa ? '' : 'em aberto'}</span>
                        </td>
                        {/* Pagamento */}
                        <td className="px-3 py-1.5 whitespace-nowrap max-w-[150px]">
                          <p className="text-[10px] font-bold text-gray-600 uppercase truncate" title={n.detalhe}>{(n.metodo || '—').replace('_', ' ')}</p>
                        </td>
                        {/* Vendedor */}
                        <td className="px-3 py-1.5 whitespace-nowrap max-w-[120px]">
                          <p className="text-[10px] font-semibold text-gray-500 truncate">{n.vendedor || '—'}</p>
                        </td>
                        {/* Situação */}
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${meta.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></span>{meta.label}
                          </span>
                          {n.erro && <i className="fa-solid fa-triangle-exclamation text-rose-400 text-[9px] ml-1" title={`SEFAZ: ${n.erro}`}></i>}
                        </td>
                        {/* Ações — tudo em UMA linha */}
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            {!n.avulsa && (
                              <button onClick={() => void abrirDetalhe(n)} disabled={ocupado} className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 active:scale-90 transition-transform" title="Ver o que foi pedido (itens, cliente, pagamento)">
                                {busyId === `det:${n.id}` ? <i className="fa-solid fa-spinner fa-spin text-[10px]"></i> : <i className="fa-solid fa-eye text-[10px]"></i>}
                              </button>
                            )}
                            {n.ref && (
                              <a href={linkArquivo(n, 'pdf')} target="_blank" rel="noopener noreferrer" className={`w-7 h-7 rounded-lg flex items-center justify-center hover:brightness-95 active:scale-90 transition-transform ${n.pdfLocal ? 'bg-rose-100 text-rose-600 shadow-sm' : 'bg-rose-50 text-rose-400'}`} title={n.pdfLocal ? 'Abrir/baixar DANFE — arquivo salvo NO NOSSO sistema' : 'Abrir/baixar DANFE (busca na Focus ou usa o DANFE gerado do XML)'}>
                                <i className="fa-solid fa-file-pdf text-[10px]"></i>
                              </a>
                            )}
                            {n.ref && (
                              <a href={linkArquivo(n, 'xml')} target="_blank" rel="noopener noreferrer" className={`w-7 h-7 rounded-lg flex items-center justify-center hover:brightness-95 active:scale-90 transition-transform ${n.xmlLocal ? 'bg-gray-800 text-white shadow-sm' : 'bg-gray-100 text-gray-400'}`} title={n.xmlLocal ? 'Abrir/baixar XML — arquivo salvo NO NOSSO sistema' : 'Abrir/baixar XML (busca na Focus e arquiva no sistema)'}>
                                <i className="fa-solid fa-code text-[10px]"></i>
                              </a>
                            )}
                            {temBoletoVivo && (
                              <button onClick={() => void abrirBoleto(n)} disabled={ocupado} className={`w-7 h-7 rounded-lg flex items-center justify-center hover:brightness-95 active:scale-90 transition-transform border ${bm?.cls}`} title={`Boleto bancário (${bm?.label}${n.boletoVencimento ? ` · venc. ${fmtDia(n.boletoVencimento)}` : ''}) — PDF, linha digitável, consultar e cancelar`}>
                                <i className="fa-solid fa-barcode text-[10px]"></i>
                              </button>
                            )}
                            {n.ref && (
                              <button onClick={() => void abrirWhatsApp(n)} disabled={ocupado || waBusy} className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 active:scale-90 transition-transform" title="Compartilhar documentos com o cliente por WhatsApp — DANFE + XML por link seguro que expira em 7 dias">
                                <i className="fa-brands fa-whatsapp text-[11px]"></i>
                              </button>
                            )}
                            {!n.avulsa && n.ref && (
                              <button
                                onClick={() => setConf({
                                  titulo: 'Consultar na SEFAZ?',
                                  texto: `Consulta a situação atual do documento ${n.numero ? `Nº ${n.numero}` : ''} na SEFAZ e sincroniza o status aqui no portal.`,
                                  icone: 'fa-rotate',
                                  botao: 'Consultar',
                                  run: async () => {
                                    if (!token) return;
                                    setBusyId(n.id);
                                    try {
                                      const res = await fetch('/api/notas', { method: 'POST', headers: headers(token), body: JSON.stringify({ acao: 'CONSULTAR', saleId: n.id }) });
                                      const data = await res.json().catch(() => ({}));
                                      showToast(data.ok ? 'Consultado na SEFAZ — situação sincronizada.' : data.erro || 'Falha ao consultar.', !!data.ok);
                                      void carregar(token);
                                    } catch { showToast('Falha de conexão ao consultar.', false); }
                                    finally { setBusyId(null); }
                                  },
                                })}
                                disabled={ocupado}
                                className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center hover:bg-amber-100 active:scale-90 transition-transform"
                                title="Consultar situação na SEFAZ"
                              >
                                {ocupado ? <i className="fa-solid fa-spinner fa-spin text-[10px]"></i> : <i className="fa-solid fa-rotate text-[10px]"></i>}
                              </button>
                            )}
                            {n.avulsa && (
                              <button
                                onClick={() => setConf({
                                  titulo: 'Re-consultar na SEFAZ?',
                                  texto: `Re-consulta a nota ${n.numero ? `Nº ${n.numero}` : 'avulsa'} na SEFAZ e atualiza os arquivos arquivados.`,
                                  icone: 'fa-rotate',
                                  botao: 'Re-consultar',
                                  run: () => atualizarAvulsa(n),
                                })}
                                disabled={ocupado}
                                className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center hover:bg-amber-100 active:scale-90 transition-transform"
                                title="Re-consultar na SEFAZ e atualizar arquivos"
                              >
                                {ocupado ? <i className="fa-solid fa-spinner fa-spin text-[10px]"></i> : <i className="fa-solid fa-rotate text-[10px]"></i>}
                              </button>
                            )}
                            {!n.avulsa && podeEmitir && (
                              <button
                                onClick={() => { setEmitModal(n); setEmitTipo(''); }}
                                disabled={ocupado}
                                className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 active:scale-90 transition-transform"
                                title="Emitir documento fiscal (NF-e/NFC-e)"
                              >
                                <i className="fa-solid fa-bolt text-[10px]"></i>
                              </button>
                            )}
                            {/* BLOCO 150: EDITAR também na AVULSA (nota cancelada arquivada / XML de terceiro) —
                                a API atualiza o registro arquivado (JSON) quando o id começa com AVULSA- */}
                            <button
                              onClick={() => { setEditModal(n); setEditMetodo(n.metodo || ''); setEditDetalhe(n.detalhe || ''); }}
                              disabled={ocupado}
                              className="w-7 h-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center hover:bg-sky-100 active:scale-90 transition-transform"
                              title={n.avulsa ? 'Editar registro arquivado (pagamento/observação)' : 'Editar registro (pagamento/observação)'}
                            >
                              <i className="fa-solid fa-pen text-[10px]"></i>
                            </button>
                            {!n.avulsa && <button onClick={() => setCloneModal(n)} disabled={ocupado} className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center hover:bg-violet-100 active:scale-90 transition-transform" title="Clonar pedido (emite documento de novo)">
                              <i className="fa-solid fa-clone text-[10px]"></i>
                            </button>}
                            {podeCancelar && (
                              <button onClick={() => { setCancelModal(n); setJustificativa(''); }} disabled={ocupado} className="w-7 h-7 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-100 active:scale-90 transition-transform" title={`Cancelar na SEFAZ — restam ${prazo.textoRestante} (prazo: ${prazo.prazoLabel})`}>
                                <i className="fa-solid fa-ban text-[10px]"></i>
                              </button>
                            )}
                            {n.avulsa && (
                              <button
                                onClick={() => setConf({
                                  titulo: 'Apagar a cópia interna?',
                                  texto: `A cópia interna da nota ${n.numero || n.ref} será apagada DO NOSSO SISTEMA (arquivos e registro). A nota continua existindo na Focus/SEFAZ.`,
                                  detalhe: 'Se ela veio por XML, pode ser importada de novo com o mesmo arquivo.',
                                  icone: 'fa-trash',
                                  perigo: true,
                                  botao: 'Apagar',
                                  run: () => excluirAvulsa(n),
                                })}
                                disabled={ocupado}
                                className="w-7 h-7 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-gray-100 active:scale-90 transition-transform"
                                title="Apagar a cópia interna (a nota continua na Focus/SEFAZ)"
                              >
                                <i className="fa-solid fa-trash text-[10px]"></i>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                {listaFiltrada.length} nota(s) — a última batida vem primeiro
              </p>
              <p className="text-[9px] font-bold uppercase tracking-wider">
                <span className="text-emerald-500">{listaFiltrada.filter(n => n.pdfLocal).length} DANFE no sistema</span>
                <span className="text-gray-300"> · </span>
                <span className="text-emerald-500">{listaFiltrada.filter(n => n.xmlLocal).length} XML no sistema</span>
                <span className="text-gray-300"> · </span>
                <span className="text-teal-500">{listaFiltrada.filter(n => n.origem === 'XML').length} via XML</span>
                <span className="text-gray-300"> · </span>
                <span className="text-gray-400">{listaFiltrada.filter(n => n.avulsa).length} fora do app</span>
                <span className="text-gray-300"> · </span>
                <span className="text-blue-500">{listaFiltrada.filter(n => !n.avulsa && n.boletoStatus && BOLETO_VIVO.includes(String(n.boletoStatus).toUpperCase())).length} com boleto</span>
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto py-4 text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-300">DOCE MANIA · Portal de Notas Fiscais</p>
      </footer>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[300] max-w-[92vw] rounded-2xl px-5 py-3 shadow-2xl text-center text-[11px] font-bold ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`} role="status">
          {toast.msg}
        </div>
      )}

      {/* Progresso da importação Focus */}
      {importBusy && importProg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[280] bg-gray-900/95 text-white rounded-2xl px-5 py-3.5 shadow-2xl flex items-center gap-3 min-w-[240px]" role="status">
          <i className="fa-solid fa-cloud-arrow-down text-emerald-400 text-lg animate-bounce"></i>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider">{importProg.fase}</p>
            <div className="w-full h-1.5 bg-white/15 rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${importProg.total > 0 ? Math.min(100, Math.round((100 * importProg.done) / importProg.total)) : 30}%` }} />
            </div>
            {importProg.total > 0 && <p className="text-[8px] font-bold text-gray-400 mt-1">{importProg.done}/{importProg.total} arquivadas</p>}
          </div>
        </div>
      )}

      {/* Loading do detalhe */}
      {detalheLoading && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* ===== MODAL: CONFIRMAÇÃO UNIFICADA (BLOCO 143) ===== */}
      {conf && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[260] flex items-center justify-center p-6" onClick={() => !confBusy && setConf(null)}>
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl text-center" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={conf.titulo}>
            <div className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center ${conf.perigo ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
              <i className={`fa-solid ${conf.icone || 'fa-circle-question'} text-xl`}></i>
            </div>
            <h3 className="font-black text-gray-800 uppercase text-sm mt-3">{conf.titulo}</h3>
            <p className="text-[11px] text-gray-500 font-semibold mt-1.5 leading-snug">{conf.texto}</p>
            {conf.detalhe && <p className="text-[10px] text-gray-400 font-semibold mt-1.5 leading-snug">{conf.detalhe}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={() => setConf(null)} disabled={confBusy} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3 text-[11px] font-black uppercase active:scale-95 disabled:opacity-50">Voltar</button>
              <button onClick={() => void executarConf()} disabled={confBusy} className={`flex-1 ${conf.perigo ? 'bg-rose-600' : 'bg-blue-600'} text-white rounded-2xl py-3 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60`}>
                {confBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : (conf.botao || 'Confirmar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: IMPORTAR XML EM LOTE (BLOCO 143) ===== */}
      {xmlOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[240] flex items-center justify-center p-6" onClick={() => !xmlBusy && setXmlOpen(false)}>
          <div className="bg-white w-full max-w-lg rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Importar XML em lote">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black text-gray-800 uppercase text-sm"><i className="fa-solid fa-file-import mr-1.5 text-teal-500"></i>Importar XML em lote</h3>
                <p className="text-[10px] font-bold text-gray-400 mt-0.5">Notas de SAÍDA emitidas em outros sistemas</p>
              </div>
              <button onClick={() => !xmlBusy && setXmlOpen(false)} className="w-9 h-9 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center active:scale-90" aria-label="Fechar importação de XML">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="bg-teal-50 border border-teal-100 rounded-2xl p-3 mt-3">
              <p className="text-[9px] font-bold text-teal-700 leading-snug"><i className="fa-solid fa-circle-info mr-1"></i>Cada XML autorizado/cancelado entra ARQUIVADO no sistema (XML + DANFE imprimível gerado do XML) e aparece na lista com o selo <b>XML</b>. Notas de <b>ENTRADA</b> e XMLs sem protocolo da SEFAZ são ignorados. Duplicado nunca entra de novo.</p>
            </div>
            {/* zona de drop */}
            <label
              onDragOver={e => { e.preventDefault(); setXmlDrag(true); }}
              onDragLeave={() => setXmlDrag(false)}
              onDrop={e => { e.preventDefault(); setXmlDrag(false); if (!xmlBusy) void pegarArquivos(e.dataTransfer.files); }}
              className={`mt-3 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl px-4 py-6 text-center cursor-pointer transition-colors ${xmlDrag ? 'border-teal-400 bg-teal-50' : 'border-gray-200 bg-gray-50 hover:border-teal-300'}`}
            >
              <input ref={xmlInput} type="file" multiple accept=".xml,.zip,text/xml,application/xml,application/zip" className="hidden" onChange={e => { if (e.target.files) void pegarArquivos(e.target.files); e.target.value = ''; }} />
              <i className={`fa-solid ${xmlBusy ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'} text-2xl ${xmlBusy ? 'text-gray-400' : 'text-teal-500'}`}></i>
              <p className="text-[11px] font-black text-gray-600 uppercase tracking-wide">{xmlBusy ? 'Importando...' : 'Clique ou arraste os XMLs aqui'}</p>
              <p className="text-[9px] font-bold text-gray-400">aceita vários .xml e .zip de uma vez</p>
            </label>
            {/* lista de arquivos */}
            {xmlArquivos.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider">{xmlArquivos.length} arquivo(s) pronto(s)</p>
                  {!xmlBusy && <button onClick={() => setXmlArquivos([])} className="text-[9px] font-black uppercase text-rose-500 active:scale-95">Limpar</button>}
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1 dm-thin-scroll">
                  {xmlArquivos.map((a, i) => (
                    <div key={`${a.nome}-${i}`} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
                      <i className="fa-solid fa-file-code text-teal-500 text-[10px]"></i>
                      <p className="text-[10px] font-bold text-gray-600 flex-1 min-w-0 truncate" title={a.nome}>{a.nome}</p>
                      <span className="text-[9px] font-bold text-gray-400 tabular-nums">{(a.tamanho / 1024).toFixed(0)} KB</span>
                      {!xmlBusy && (
                        <button onClick={() => setXmlArquivos(atuais => atuais.filter((_, j) => j !== i))} className="text-gray-300 hover:text-rose-500" aria-label={`Remover ${a.nome}`}>
                          <i className="fa-solid fa-xmark text-[10px]"></i>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* progresso */}
            {xmlBusy && xmlProg && (
              <div className="mt-3">
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${Math.round((100 * xmlProg.done) / xmlProg.total)}%` }} />
                </div>
                <p className="text-[9px] font-bold text-gray-400 mt-1 uppercase">{xmlProg.done}/{xmlProg.total} XML(s) enviados</p>
              </div>
            )}
            {/* resultado */}
            {xmlRes && (
              <div className="mt-3 bg-gray-50 border border-gray-100 rounded-2xl p-3 space-y-1.5">
                <p className="text-[10px] font-black uppercase text-gray-600 tracking-wide">Resultado</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold">
                  <span className="text-emerald-600">{xmlRes.importados} importada(s)</span>
                  <span className="text-rose-500">{xmlRes.cancelamentos} cancelamento(s)</span>
                  <span className="text-gray-500">{xmlRes.duplicados} duplicada(s)</span>
                  <span className="text-amber-600">{xmlRes.entradas} entrada(s)</span>
                  <span className="text-rose-600">{xmlRes.ilegiveis} ilegível(is)</span>
                </div>
                {xmlRes.erros.length > 0 && (
                  <div className="max-h-24 overflow-y-auto space-y-1 pt-1 border-t border-gray-200 dm-thin-scroll">
                    {xmlRes.erros.slice(0, 10).map((e, i) => (
                      <p key={i} className="text-[9px] font-semibold text-gray-500 truncate" title={`${e.nome}: ${e.mensagem}`}>
                        <i className="fa-solid fa-circle-exclamation text-rose-400 mr-1"></i>{e.nome}: {e.mensagem}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setXmlOpen(false)} disabled={xmlBusy} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-50">Fechar</button>
              <button
                onClick={() => setConf({
                  titulo: `Importar ${xmlArquivos.length} XML(s)?`,
                  texto: 'As notas de SAÍDA autorizadas/canceladas entram arquivadas no sistema com DANFE imprimível. Entradas e duplicados são ignorados.',
                  icone: 'fa-file-import',
                  botao: 'Importar',
                  run: importarXmlLote,
                })}
                disabled={xmlBusy || xmlArquivos.length === 0}
                className="flex-1 bg-teal-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-50"
              >
                {xmlBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : `Importar ${xmlArquivos.length} XML(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: BOLETO (BLOCO 143) ===== */}
      {boletoModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[240] flex items-center justify-center p-6" onClick={() => !boletoBusy && setBoletoModal(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Boleto bancário">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-black text-gray-800 uppercase text-sm"><i className="fa-solid fa-barcode mr-1.5 text-blue-600"></i>Boleto bancário</h3>
                <p className="text-[9px] font-bold text-gray-400 mt-0.5">{boletoModal.n.cliente} · {rotuloTipo(boletoModal.n.tipo, boletoModal.n.modoNota)} {boletoModal.n.numero} · {fmtBRL(boletoModal.n.valor)}</p>
              </div>
              <button onClick={() => setBoletoModal(null)} className="w-9 h-9 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center active:scale-90" aria-label="Fechar boleto">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {boletoBusy && !boleto && (
              <div className="py-10 flex justify-center"><div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" /></div>
            )}

            {boletoMsg && !boleto && (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3 mt-3">
                <p className="text-[10px] font-bold text-amber-700 leading-snug"><i className="fa-solid fa-circle-info mr-1"></i>{boletoMsg}</p>
              </div>
            )}

            {boleto && (() => {
              const bm = metaBoleto(boleto.status);
              const nfAtrelada = !!boleto.notaFiscalChave;
              const notaDeveriaEstar = !boletoModal.n.avulsa && (boletoModal.n.status === 'AUTORIZADA' || !!boletoModal.n.chave);
              return (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border ${bm.cls}`}>{bm.label}</span>
                    {boleto.vencimento && <span className="text-[10px] font-bold text-gray-500 uppercase">Venc.: {fmtDia(boleto.vencimento)}</span>}
                    <span className="text-sm font-black text-gray-800 tabular-nums">{boleto.valor !== null ? fmtBRL(boleto.valor) : '—'}</span>
                  </div>
                  {/* BLOCO 146 — FIX "erro para atrelar NFe ou NFC ao boleto":
                      mostra o estado do atrelamento da nota na cobrança */}
                  {notaDeveriaEstar && (
                    <div className={`rounded-2xl border p-3 ${nfAtrelada ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`} role="status">
                      {nfAtrelada ? (
                        <p className="text-[9px] font-black text-emerald-700 uppercase tracking-wide"><i className="fa-solid fa-link mr-1"></i>NF-e/NFC-e {boletoModal.n.numero ? `nº ${boletoModal.n.numero} ` : ''}ATRELADA ao boleto — chave {boleto.notaFiscalChave!.slice(0, 8)}...{boleto.notaFiscalChave!.slice(-6)}</p>
                      ) : (
                        <div className="text-[9px] font-bold text-amber-700 leading-snug">
                          <p><i className="fa-solid fa-circle-info mr-1"></i>Boleto SEM nota fiscal atrelada {boletoModal.n.chave ? '(a venda tem chave autorizada no sistema)' : ''}. Boletos gerados ANTES da autorização da nota (ou com a chave ainda não sincronizada) saem assim — o Inter não permite atrelar depois.</p>
                          <p className="mt-1 font-black uppercase">Para atrelar: gere um NOVO boleto com a nota AUTORIZADA (o sistema busca a chave NF-e/NFC-e automaticamente).</p>
                        </div>
                      )}
                    </div>
                  )}
                  {boleto.linhaDigitavel && (
                    <div className="bg-gray-50 rounded-2xl p-3">
                      <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider mb-1">Linha digitável</p>
                      <p className="text-[11px] font-mono font-bold text-gray-700 break-all">{boleto.linhaDigitavel}</p>
                      <button onClick={() => void copiar(boleto.linhaDigitavel, 'Linha digitável')} className="mt-2 w-full bg-blue-600 text-white rounded-xl py-2 text-[10px] font-black uppercase active:scale-95"><i className="fa-solid fa-copy mr-1"></i>Copiar linha</button>
                    </div>
                  )}
                  {boleto.pixCopiaECola && (
                    <div className="bg-gray-50 rounded-2xl p-3">
                      <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider mb-1">PIX cobrança (copia e cola)</p>
                      <p className="text-[9px] font-mono font-semibold text-gray-500 break-all max-h-14 overflow-y-auto dm-thin-scroll">{boleto.pixCopiaECola}</p>
                      <button onClick={() => void copiar(boleto.pixCopiaECola, 'PIX copia e cola')} className="mt-2 w-full bg-emerald-600 text-white rounded-xl py-2 text-[10px] font-black uppercase active:scale-95"><i className="fa-solid fa-copy mr-1"></i>Copiar PIX</button>
                    </div>
                  )}
                  {boleto.erro && <p className="text-[10px] font-bold text-rose-500">{boleto.erro}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => void pdfBoleto()} disabled={boletoBusy} className="bg-blue-600 disabled:opacity-60 text-white rounded-2xl py-3 text-[10px] font-black uppercase active:scale-95 transition-transform"><i className="fa-solid fa-file-pdf mr-1"></i>{boletoBusy ? 'Buscando...' : 'Abrir PDF'}</button>
                    <button
                      onClick={() => setConf({
                        titulo: 'Consultar no Inter?',
                        texto: 'Sincroniza a situação atual do boleto (recebido, atrasado, cancelado...) com o banco Inter.',
                        icone: 'fa-rotate',
                        botao: 'Consultar',
                        run: consultarBoleto,
                      })}
                      disabled={boletoBusy}
                      className="bg-amber-500 disabled:opacity-60 text-white rounded-2xl py-3 text-[10px] font-black uppercase active:scale-95 transition-transform"><i className="fa-solid fa-rotate mr-1"></i>Consultar</button>
                  </div>
                  {['A_RECEBER', 'ATRASADO', 'EM_PROCESSAMENTO'].includes(String(boleto.status).toUpperCase()) && (
                    <button
                      onClick={() => { setCancelBoleto(boletoModal ? { n: boletoModal.n } : null); setCancelBoletoMotivo(''); }}
                      className="w-full bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl py-3 text-[10px] font-black uppercase active:scale-95 transition-transform"
                    >
                      <i className="fa-solid fa-ban mr-1"></i>Cancelar boleto no Inter
                    </button>
                  )}
                  <p className="text-[8px] font-bold text-gray-300 uppercase tracking-wider text-center">boleto gerado pela API do Inter · sale {boletoModal.n.id.slice(0, 8).toUpperCase()}</p>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===== MODAL: CANCELAR BOLETO (motivo + confirmação) ===== */}
      {cancelBoleto && boletoModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[260] flex items-center justify-center p-6" onClick={() => !boletoBusy && setCancelBoleto(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Cancelar boleto">
            <h3 className="font-black text-rose-600 uppercase text-sm mb-1"><i className="fa-solid fa-ban mr-1"></i>Cancelar boleto</h3>
            <p className="text-[9px] font-bold text-gray-400 mb-4">{boletoModal.n.cliente} · {fmtBRL(boletoModal.n.valor)}</p>
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 mb-4">
              <p className="text-[9px] font-bold text-rose-600 leading-snug"><i className="fa-solid fa-triangle-exclamation mr-1"></i>O boleto é CANCELADO no banco Inter e deixa de ser pago. Quem já recebeu a linha digitável não consegue mais quitar. Ação não pode ser desfeita.</p>
            </div>
            <label className="block text-[9px] font-black text-gray-400 uppercase ml-1 mb-1">Motivo (obrigatório, máx. 50 caracteres)</label>
            <textarea value={cancelBoletoMotivo} onChange={e => setCancelBoletoMotivo(e.target.value.slice(0, 50))} rows={2} maxLength={50} placeholder="Ex.: Venda cancelada pelo cliente." className="w-full p-4 bg-gray-50 rounded-2xl font-semibold text-sm outline-none focus:ring-2 focus:ring-rose-100 resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCancelBoleto(null)} disabled={boletoBusy} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-50">Voltar</button>
              <button onClick={() => void cancelarBoleto()} disabled={boletoBusy || !cancelBoletoMotivo.trim()} className="flex-1 bg-rose-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60">
                {boletoBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: DETALHE — CUPOM NÃO FISCAL em imagem (BLOCO 146) ===== */}
      {detalhe && (() => {
        const n = detalhe.nota;
        return (
          <CupomNaoFiscal
            nota={n}
            itens={detalhe.itens}
            cliente={detalhe.cliente}
            rotulo={rotuloTipo(n.tipo, n.modoNota)}
            urlPdf={linkArquivo(n, 'pdf')}
            urlXml={linkArquivo(n, 'xml')}
            onCompartilharDocumentos={() => { setDetalhe(null); void abrirWhatsApp(n); }}
            showToast={showToast}
            onFechar={() => setDetalhe(null)}
          />
        );
      })()}

      {/* ===== Modal: COMPARTILHAR NO WHATSAPP (BLOCO 146) ===== */}
      {waModal && (() => {
        const n = waModal.nota;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[240] flex items-center justify-center p-6" onClick={() => !waBusy && setWaModal(null)}>
            <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Compartilhar documentos no WhatsApp">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-black text-gray-800 uppercase text-sm"><i className="fa-brands fa-whatsapp mr-1.5 text-emerald-500"></i>Compartilhar documentos</h3>
                  <p className="text-[9px] font-bold text-gray-400 mt-0.5 truncate">{rotuloTipo(n.tipo, n.modoNota)} {n.numero ? `nº ${n.numero}` : ''} · {n.cliente} · {fmtBRL(n.valor)}</p>
                </div>
                <button onClick={() => setWaModal(null)} className="w-9 h-9 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center active:scale-90" aria-label="Fechar compartilhamento">
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>

              {waBusy ? (
                <div className="py-10 flex justify-center"><div className="w-10 h-10 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" /></div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className={`rounded-2xl border p-3 ${waTemLinks ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    {waTemLinks ? (
                      <p className="text-[9px] font-bold text-emerald-700 leading-snug"><i className="fa-solid fa-link mr-1"></i>Links seguros do DANFE e do XML prontos na mensagem — <b>valem 7 dias</b> e NÃO expõem a sessão do portal (só baixam os arquivos desta nota).</p>
                    ) : (
                      <p className="text-[9px] font-bold text-amber-700 leading-snug"><i className="fa-solid fa-circle-info mr-1"></i>Sem links agora (arquivos ainda não arquivados ou nota sem emissão) — a mensagem vai com a orientação para o cliente.</p>
                    )}
                  </div>

                  <label className="block text-[9px] font-black text-gray-400 uppercase ml-1">WhatsApp do cliente (com DDD — editável)</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-gray-400 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">+55</span>
                    <input
                      value={waFone}
                      onChange={e => setWaFone(e.target.value.replace(/\D/g, '').slice(0, 13))}
                      placeholder="54 99999-9999"
                      inputMode="tel"
                      className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-100"
                      aria-label="Telefone do cliente no WhatsApp"
                    />
                  </div>

                  <label className="block text-[9px] font-black text-gray-400 uppercase ml-1">Mensagem (editável)</label>
                  <textarea
                    value={waMsg}
                    onChange={e => setWaMsg(e.target.value)}
                    rows={9}
                    className="w-full p-3 bg-gray-50 rounded-2xl border border-gray-200 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-emerald-100 resize-none font-mono leading-relaxed"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => void copiar(waMsg, 'Mensagem')} className="bg-gray-100 text-gray-600 rounded-2xl py-3 text-[10px] font-black uppercase active:scale-95 transition-transform"><i className="fa-solid fa-copy mr-1"></i>Copiar mensagem</button>
                    <button onClick={enviarWhatsApp} className="bg-emerald-600 text-white rounded-2xl py-3 text-[10px] font-black uppercase active:scale-95 transition-transform"><i className="fa-brands fa-whatsapp mr-1"></i>Abrir WhatsApp</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ===== Modal: EDITAR ===== */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6" onClick={() => setEditModal(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-gray-800 uppercase text-sm mb-1">Editar registro</h3>
            <p className="text-[9px] font-bold text-gray-400 mb-4">{editModal.cliente} · {rotuloTipo(editModal.tipo, editModal.modoNota)} {editModal.numero}</p>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3 mb-4">
              <p className="text-[9px] font-bold text-amber-600 leading-snug"><i className="fa-solid fa-circle-info mr-1"></i>Isso atualiza o registro INTERNO da venda (controle do sistema). O XML/PDF já autorizado pela SEFAZ não muda.</p>
            </div>
            <label className="block text-[9px] font-black text-gray-400 uppercase ml-1 mb-1">Forma de pagamento</label>
            <select value={editMetodo} onChange={e => setEditMetodo(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold text-sm mb-3 outline-none focus:ring-2 focus:ring-blue-100">
              {FORMAS.map(f => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
            </select>
            <label className="block text-[9px] font-black text-gray-400 uppercase ml-1 mb-1">Detalhe do pagamento</label>
            <textarea value={editDetalhe} onChange={e => setEditDetalhe(e.target.value)} rows={3} maxLength={500} placeholder="Observação do pagamento (ex.: PAGO NA VISITA...)" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold text-sm outline-none focus:ring-2 focus:ring-blue-100 resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditModal(null)} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95">Voltar</button>
              <button onClick={() => void salvarEdicao()} disabled={busyId === 'edit'} className="flex-1 bg-blue-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60">
                {busyId === 'edit' ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: CANCELAR NOTA (prazo SEFAZ ao vivo) ===== */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6" onClick={() => setCancelModal(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-rose-600 uppercase text-sm mb-1"><i className="fa-solid fa-ban mr-1"></i>Cancelar nota</h3>
            <p className="text-[9px] font-bold text-gray-400 mb-4">{rotuloTipo(cancelModal.tipo, cancelModal.modoNota)} {cancelModal.numero} · {cancelModal.cliente} · {fmtBRL(cancelModal.valor)}</p>
            {/* contagem regressiva AO VIVO do prazo SEFAZ — venceu = botão inativo */}
            {prazoCancelModal && (
              <div className={`rounded-2xl border p-3 mb-3 ${prazoCancelModal.expirado ? 'bg-gray-100 border-gray-200' : 'bg-amber-50 border-amber-200'}`}>
                {prazoCancelModal.expirado ? (
                  <p className="text-[9px] font-bold text-gray-500 leading-snug"><i className="fa-solid fa-clock mr-1"></i>Prazo SEFAZ VENCIDO — o evento de cancelamento seria recusado. A janela de {prazoCancelModal.prazoLabel} após a autorização acabou.</p>
                ) : (
                  <p className="text-[9px] font-black text-amber-700 uppercase tracking-wide leading-snug"><i className="fa-solid fa-stopwatch mr-1"></i>Restam {prazoCancelModal.textoRestante} para cancelar (regra SEFAZ: {prazoCancelModal.prazoLabel})</p>
                )}
              </div>
            )}
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 mb-4">
              <p className="text-[9px] font-bold text-rose-600 leading-snug"><i className="fa-solid fa-triangle-exclamation mr-1"></i>Regra da SEFAZ: NFC-e pode ser cancelada até 30 MINUTOS após a emissão; NF-e até 24h. O cancelamento é enviado à SEFAZ e o XML original continua existindo (evento de cancelamento).</p>
            </div>
            <label className="block text-[9px] font-black text-gray-400 uppercase ml-1 mb-1">Justificativa (mínimo 15 caracteres)</label>
            <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={3} maxLength={255} placeholder="Ex.: Erro na emissão — valores divergentes." className="w-full p-4 bg-gray-50 rounded-2xl font-semibold text-sm outline-none focus:ring-2 focus:ring-rose-100 resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCancelModal(null)} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95">Voltar</button>
              {/* prazo vencido DURANTE a digitação = botão inativa na hora */}
              <button onClick={() => void cancelarNota()} disabled={busyId === 'cancel' || !prazoCancelModal || prazoCancelModal.expirado} className="flex-1 bg-rose-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60">
                {busyId === 'cancel' ? <i className="fa-solid fa-spinner fa-spin"></i> : prazoCancelModal?.expirado ? 'Fora do prazo' : 'Cancelar nota'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: CLONAR ===== */}
      {cloneModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6" onClick={() => setCloneModal(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-gray-800 uppercase text-sm mb-1"><i className="fa-solid fa-clone mr-1 text-violet-500"></i>Clonar pedido</h3>
            <p className="text-[9px] font-bold text-gray-400 mb-4">{cloneModal.cliente} · {fmtBRL(cloneModal.valor)}</p>
            <div className="bg-violet-50 border border-violet-100 rounded-2xl p-3 mb-4 space-y-1">
              <p className="text-[9px] font-bold text-violet-700 leading-snug"><i className="fa-solid fa-circle-info mr-1"></i>Cria uma NOVA venda com o mesmo cliente, itens e valores (não entra na fila de entrega, não baixa estoque de novo).</p>
              <p className="text-[9px] font-bold text-violet-700 leading-snug">A cópia fica como venda PENDENTE no app — emita a NF dela pela aba NOTAS PENDENTES (este portal mostra somente notas já emitidas).</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCloneModal(null)} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95">Voltar</button>
              <button onClick={() => void clonarVenda()} disabled={busyId === 'clone'} className="flex-1 bg-violet-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60">
                {busyId === 'clone' ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Clonar agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: EMITIR ===== */}
      {emitModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6" onClick={() => setEmitModal(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-gray-800 uppercase text-sm mb-1"><i className="fa-solid fa-bolt mr-1 text-emerald-500"></i>Emitir documento fiscal</h3>
            <p className="text-[9px] font-bold text-gray-400 mb-4">{emitModal.cliente} · {fmtBRL(emitModal.valor)}</p>
            <label className="block text-[9px] font-black text-gray-400 uppercase ml-1 mb-1">Documento</label>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[['', 'Automático'], ['NFE', 'NF-e'], ['NFCE', 'NFC-e']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setEmitTipo(v as '' | 'NFE' | 'NFCE')} className={`rounded-2xl py-3 text-[10px] font-black uppercase border-2 transition-all active:scale-95 ${emitTipo === v ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-500 border-gray-100'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 mb-4">
              <p className="text-[9px] font-bold text-emerald-700 leading-snug"><i className="fa-solid fa-circle-info mr-1"></i>Automático: cliente com CNPJ válido → NF-e; consumidor → NFC-e. A emissão usa os mesmos dados da venda (itens, pagamento, cadastro).</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEmitModal(null)} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95">Voltar</button>
              <button onClick={() => void emitirNota()} disabled={busyId === 'emit'} className="flex-1 bg-emerald-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60">
                {busyId === 'emit' ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Emitir'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dm-thin-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .dm-thin-scroll::-webkit-scrollbar-track { background: transparent; }
        .dm-thin-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
        .dm-thin-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
