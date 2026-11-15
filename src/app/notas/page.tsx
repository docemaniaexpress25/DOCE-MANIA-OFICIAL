"use client";

/**
 * BLOCO 140 — PORTAL DE NOTAS (admin, fora do app — "no mesmo estilo do
 * portal do cliente"): link externo que abre no navegador e pede o MESMO PIN
 * do admin. Lista TODAS as notas de saída (NF-e / NFC-e) na horizontal, uma
 * abaixo da outra: número, tipo, status, cliente, data, valor, pagamento,
 * vendedor — com DANFE (PDF) e XML para abrir/baixar e ações completas de
 * administração: VER (o que foi pedido), CONSULTAR, EMITIR, EDITAR, CLONAR
 * e CANCELAR.
 *
 * Auth: POST /api/notas-admin {acao:'AUTH', pin} valida o PIN com bcrypt
 * contra os usuários ADMIN (igual tela de login do app) e devolve um token
 * de sessão ADMIN — o mesmo formato usado pelas rotas fiscais (/api/notas),
 * então EMITIR/CONSULTAR/CANCELAR reutilizam TODO o fluxo de produção.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  // BLOCO 141: arquivos arquivados DENTRO do sistema (bucket notas-fiscais)
  pdfLocal: boolean;
  xmlLocal: boolean;
  // nota avulsa (emitida fora do app — importada da Focus pelo portal)
  avulsa?: boolean;
}

interface ItemDetalhe { produto: string; quantidade: number; preco: number; }

interface ClienteDetalhe {
  nome_fantasia: string; nome: string; cnpj: string; razao_social: string;
  inscricao_estadual: string; telefone: string; endereco: string; bairro: string;
  endereco_numero: string; endereco_cep: string; endereco_municipio: string;
  endereco_uf: string; email: string;
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

type FiltroStatus = 'TODAS' | 'AUTORIZADA' | 'EMITINDO' | 'REJEITADA' | 'CANCELADA' | 'NAO_EMITIDA';
type FiltroPeriodo = 'TUDO' | 'HOJE' | '7D' | '30D' | 'MES';

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
  const [periodo, setPeriodo] = useState<FiltroPeriodo>('TUDO');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Importação da Focus (BLOCO 141 — PDF/XML dentro do sistema)
  const [importBusy, setImportBusy] = useState(false);
  const [importProg, setImportProg] = useState<{ fase: string; done: number; total: number } | null>(null);

  // Importação por ref/chave colada do painel da Focus (a API não lista notas
  // emitidas fora do app — o admin copia do painel e cola aqui)
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
  const [emitTipo, setEmitTipo] = useState<'' | 'NFE' | 'NFCE'>('');

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
        // sessão inválida — volta pro PIN
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
        setToken(null); setNomeAdmin('');
        setErroLista('Sessão expirada. Entre com o PIN novamente.');
        return;
      }
      if (!res.ok || !data.ok) { setErroLista(data.erro || `Erro ${res.status}`); return; }
      setNotas((data.notas || []) as NotaRow[]);
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
    // Auto-entrada no 6º dígito (PIN padrão do admin tem 6); PINs de outro
    // tamanho usam o botão ENTRAR.
    if (proximo.length === 6) void entrarComPin(proximo);
  };

  const apagar = () => { setPinErro(''); setPin(p => p.slice(0, -1)); };

  const sair = () => {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
    setToken(null); setNomeAdmin(''); setNotas([]); setBusca(''); setFiltro('TODAS'); setPeriodo('TUDO');
  };

  // ---------- lista filtrada ----------
  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return notas.filter(n => {
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
  }, [notas, busca, filtro, periodo]);

  const kpis = useMemo(() => {
    const visiveis = notas.filter(n => dentroPeriodo(n.dataVenda, periodo));
    const autorizadas = visiveis.filter(n => n.status === 'AUTORIZADA');
    const rejeitadas = visiveis.filter(n => n.status === 'REJEITADA');
    const pendentes = visiveis.filter(n => n.status === 'NAO_EMITIDA' || n.status === 'EMITINDO');
    return {
      total: visiveis.length,
      autorizadas: autorizadas.length,
      rejeitadas: rejeitadas.length,
      pendentes: pendentes.length,
      valor: autorizadas.reduce((a, n) => a + (Number(n.valor) || 0), 0),
    };
  }, [notas, periodo]);

  const contagem = useCallback((f: FiltroStatus) => {
    if (f === 'TODAS') return listaFiltrada.length;
    return listaFiltrada.filter(n => String(n.status || '').toUpperCase() === f).length;
  }, [listaFiltrada]);

  // ---------- ações ----------
  const abrirDetalhe = async (n: NotaRow) => {
    if (!token) return;
    setBusyId(`det:${n.id}`);
    setDetalheLoading(true);
    setDetalhe(null);
    try {
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
      showToast(data.ok ? 'Nota cancelada na SEFAZ.' : 'Cancelamento em processamento — consulte em alguns segundos.', !!data.ok);
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
      showToast('Cópia criada (sem nota). Ela aparece na lista como PENDENTE.');
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

  // ---------- IMPORTAR DA FOCUS (BLOCO 141) ----------
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
      // BLOCO 142: varredura da LISTAGEM OFICIAL da Focus (/v2/nfes?cnpj= e
      // /v2/nfces?cnpj=) — traz notas batidas no PAINEL tbm. Se a conta não
      // expõe a listagem, o aviso do toast diz e o manual por ref continua.
      setImportProg({ fase: 'Varredura da Focus', done: 0, total: 0 });
      let avulsasMsg = '';
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
        if (data.fim) break;
      }
      const partes = [`${okCount} nota(s) arquivada(s)`];
      if (avulsasNovas > 0) partes.push(`${avulsasNovas} do painel da Focus`);
      if (semArq > 0) partes.push(`${semArq} sem arquivo ainda`);
      if (falhas > 0) partes.push(`${falhas} com falha`);
      showToast(avulsasMsg && avulsasNovas === 0 ? `Arquivamento concluído (${partes.join(' · ')}). ${avulsasMsg}` : `Importação concluída: ${partes.join(' · ')}.`);
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
    if (!window.confirm(`Apagar a cópia interna da nota ${n.numero || n.ref}? A nota continua gravada na Focus/SEFAZ.`)) return;
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
   *  BLOCO 142: token na query — o <a> de download não carrega header de auth. */
  const linkArquivo = (n: NotaRow, tipo: 'pdf' | 'xml'): string => {
    const t = token ? `&token=${encodeURIComponent(token)}` : '';
    if (n.avulsa) {
      const doc = String(n.tipo || '').toUpperCase() === 'NFCE' ? 'nfce' : 'nfe';
      return `/api/notas-arquivo?ref=${encodeURIComponent(n.ref)}&doc=${doc}&tipo=${tipo}${t}`;
    }
    return `/api/notas-arquivo?saleId=${encodeURIComponent(n.id)}&tipo=${tipo}${t}`;
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

  // ---------- tela: lista ----------
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white px-5 pt-10 pb-20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="max-w-6xl mx-auto relative z-10 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-blue-200/70 uppercase tracking-[0.2em] mb-2">Administração · Saída</p>
            <h1 className="text-2xl font-black uppercase tracking-tight leading-tight">Notas Fiscais <span className="text-blue-200">NF-e · NFC-e</span></h1>
            {nomeAdmin && <p className="text-[11px] text-blue-200/70 font-semibold mt-2"><i className="fa-solid fa-user-shield mr-1 text-[9px]"></i>{nomeAdmin}</p>}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={() => void importarTudo()} disabled={importBusy} className="bg-emerald-400 hover:bg-emerald-300 disabled:opacity-60 text-emerald-950 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-lg shadow-emerald-900/30" title="Varre a API da Focus (NF-e + NFC-e do CNPJ, inclusive notas batidas no PAINEL) e grava PDF (DANFE) e XML de TODAS as notas DENTRO do sistema">
              <i className={`fa-solid fa-cloud-arrow-down mr-1.5 ${importBusy ? 'fa-bounce' : ''}`}></i>
              {importBusy ? 'Importando...' : 'Buscar TODAS na Focus'}
            </button>
            <button onClick={() => void carregar(token)} className="bg-white/15 hover:bg-white/25 text-white rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all" title="Atualizar lista">
              <i className={`fa-solid fa-rotate mr-1.5 ${carregando ? 'fa-spin' : ''}`}></i>Atualizar
            </button>
            <button onClick={sair} className="bg-white/10 hover:bg-white/20 text-blue-100 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all" title="Sair do portal">
              <i className="fa-solid fa-right-from-bracket mr-1.5"></i>Sair
            </button>
          </div>
        </div>
      </div>

      {/* KPIs flutuante */}
      <div className="max-w-6xl w-full mx-auto px-4 -mt-14 relative z-20">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Notas no período</p>
            <p className="text-lg font-black text-gray-800 mt-0.5">{kpis.total}</p>
          </div>
          <div className="text-center sm:border-x border-gray-100">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Autorizadas</p>
            <p className="text-lg font-black text-emerald-600 mt-0.5">{kpis.autorizadas}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Rejeitadas</p>
            <p className="text-lg font-black text-rose-500 mt-0.5">{kpis.rejeitadas}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-black uppercase text-gray-400 tracking-wider">Valor autorizado</p>
            <p className="text-lg font-black text-blue-600 mt-0.5">{fmtBRL(kpis.valor)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="max-w-6xl w-full mx-auto px-4 mt-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 text-sm"></i>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por número, cliente, CNPJ, chave ou vendedor..."
              className="w-full pl-10 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Buscar nota"
            />
          </div>
          <select
            value={periodo}
            onChange={e => setPeriodo(e.target.value as FiltroPeriodo)}
            className="bg-white border border-gray-100 rounded-2xl shadow-sm px-4 py-3.5 text-xs font-black uppercase text-gray-600 outline-none"
            aria-label="Período"
          >
            {PERIODO_META.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {(['TODAS', 'AUTORIZADA', 'EMITINDO', 'REJEITADA', 'CANCELADA', 'NAO_EMITIDA'] as FiltroStatus[]).map(f => {
            const meta = metaStatus(f);
            const ativo = filtro === f;
            return (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-wider border transition-all active:scale-95 ${ativo ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : `bg-white ${meta.cls} border-gray-100`}`}
              >
                {f === 'TODAS' ? 'Todas' : meta.label} ({contagem(f)})
              </button>
            );
          })}
        </div>
      </div>

      {/* IMPORTAR DO PAINEL DA FOCUS (ref/chave colada) */}
      <div className="max-w-6xl w-full mx-auto px-4 mt-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setPasteOpen(o => !o)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            aria-expanded={pasteOpen}
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-600">
              <i className="fa-solid fa-clipboard-paste mr-2 text-blue-500"></i>
              Importar nota específica (ref ou chave) — manual
            </span>
            <i className={`fa-solid fa-chevron-down text-gray-300 text-[10px] transition-transform ${pasteOpen ? 'rotate-180' : ''}`}></i>
          </button>
          {pasteOpen && (
            <div className="px-4 pb-4 space-y-2">
              <p className="text-[9px] font-bold text-gray-400 leading-snug">
                O botão <b>Buscar TODAS na Focus</b> já busca sozinho os <b>backups mensais oficiais</b> da Focus pelo CNPJ do emitente e traz <b>todas</b> as notas — do app e batidas direto no painel (PDF e XML entram arquivados dentro do sistema). Use este campo só para trazer uma nota específica na hora: copie no painel da Focus a <b>referência</b> ou a <b>chave de acesso (44 dígitos)</b>, cole aqui (uma por linha) e ela entra na lista abaixo.
              </p>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={3}
                placeholder={'41190612345678000123550010000000221923094166\nVENDA-0001  NFe411906...'}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-[11px] font-mono font-semibold outline-none focus:ring-2 focus:ring-blue-100"
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

      {/* Lista horizontal — uma linha abaixo da outra */}
      <main className="max-w-6xl w-full mx-auto px-4 mt-3 flex-1">
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
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6">
            {/* overflow horizontal no celular: a tabela continua "tudo na horizontal" */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Documento', 'Situação', 'Cliente', 'Data de emissão', 'Valor', 'Pagamento', 'Vendedor', 'Ações'].map(h => (
                      <th key={h} className="px-4 py-3 text-[8px] font-black uppercase text-gray-400 tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.map(n => {
                    const meta = metaStatus(n.status);
                    const podeEmitir = n.status === 'NAO_EMITIDA' || n.status === 'REJEITADA' || n.status === 'CANCELADA';
                    const ocupado = busyId === n.id;
                    return (
                      <tr key={n.id} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/30 transition-colors">
                        {/* Documento */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-xs font-black text-gray-800">{n.numero ? `Nº ${n.numero}` : '—'}</p>
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">{rotuloTipo(n.tipo, n.modoNota)}</span>
                          {n.avulsa && <span className="ml-1 inline-flex items-center mt-0.5 text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-600" title="Nota emitida fora do app — importada da Focus pelo portal">fora do app</span>}
                          <p className="text-[8px] font-black uppercase tracking-wide mt-1">
                            {n.pdfLocal && <span className="text-emerald-500" title="DANFE arquivado no nosso sistema">PDF ✓ </span>}
                            {n.xmlLocal && <span className="text-emerald-500" title="XML arquivado no nosso sistema">XML ✓</span>}
                            {!n.pdfLocal && !n.xmlLocal && n.ref && <span className="text-gray-300" title="Ainda não importado — clique em IMPORTAR DO FOCUS">não arquivado</span>}
                          </p>
                        </td>
                        {/* Situação */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${meta.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></span>{meta.label}
                          </span>
                          {n.erro && <p className="text-[8px] font-bold text-rose-400 mt-1 max-w-[180px] truncate" title={n.erro}>SEFAZ: {n.erro}</p>}
                        </td>
                        {/* Cliente */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <p className="text-[11px] font-black text-gray-700 truncate">{n.cliente}</p>
                          <p className="text-[9px] font-bold text-gray-400">{n.clienteDoc || 'sem documento'}</p>
                        </td>
                        {/* Data */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-[11px] font-bold text-gray-600">{fmtData(n.emitidaEm || n.dataVenda)}</p>
                          <p className="text-[8px] font-bold text-gray-400 uppercase">venda: {fmtData(n.dataVenda)}</p>
                        </td>
                        {/* Valor */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-[11px] font-black text-gray-800">{fmtBRL(n.valor)}</p>
                          <p className="text-[8px] font-bold text-gray-400 uppercase">{n.statusPagamento === 'PAGO' ? 'pago' : 'pendente'}</p>
                        </td>
                        {/* Pagamento */}
                        <td className="px-4 py-3 max-w-[220px]">
                          <p className="text-[10px] font-black text-gray-700 uppercase">{(n.metodo || '—').replace('_', ' ')}</p>
                          <p className="text-[9px] font-bold text-gray-400 truncate max-w-[200px]" title={n.detalhe}>{n.detalhe || ''}</p>
                        </td>
                        {/* Vendedor */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-[10px] font-bold text-gray-600">{n.vendedor || '—'}</p>
                        </td>
                        {/* Ações */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {!n.avulsa && (
                              <button onClick={() => void abrirDetalhe(n)} disabled={ocupado} className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center active:scale-90 transition-transform" title="Ver o que foi pedido (itens, cliente, pagamento)">
                                {busyId === `det:${n.id}` ? <i className="fa-solid fa-spinner fa-spin text-[11px]"></i> : <i className="fa-solid fa-eye text-[11px]"></i>}
                              </button>
                            )}
                            {n.ref && (
                              <a href={linkArquivo(n, 'pdf')} target="_blank" rel="noopener noreferrer" className={`w-8 h-8 rounded-xl flex items-center justify-center active:scale-90 transition-transform ${n.pdfLocal ? 'bg-rose-100 text-rose-600 shadow-sm' : 'bg-rose-50 text-rose-400'}`} title={n.pdfLocal ? 'Abrir/baixar DANFE — arquivo salvo NO NOSSO sistema' : 'Abrir/baixar DANFE (busca na Focus e arquiva no sistema)'}>
                                <i className="fa-solid fa-file-pdf text-[11px]"></i>
                              </a>
                            )}
                            {n.ref && (
                              <a href={linkArquivo(n, 'xml')} target="_blank" rel="noopener noreferrer" className={`w-8 h-8 rounded-xl flex items-center justify-center active:scale-90 transition-transform ${n.xmlLocal ? 'bg-gray-200 text-gray-700 shadow-sm' : 'bg-gray-50 text-gray-400'}`} title={n.xmlLocal ? 'Abrir/baixar XML — arquivo salvo NO NOSSO sistema' : 'Abrir/baixar XML (busca na Focus e arquiva no sistema)'}>
                                <i className="fa-solid fa-code text-[11px]"></i>
                              </a>
                            )}
                            {!n.avulsa && n.ref && (
                              <button
                                onClick={async () => {
                                  if (!token) return;
                                  setBusyId(n.id);
                                  try {
                                    const res = await fetch('/api/notas', { method: 'POST', headers: headers(token), body: JSON.stringify({ acao: 'CONSULTAR', saleId: n.id }) });
                                    const data = await res.json().catch(() => ({}));
                                    showToast(data.ok ? 'Consultado na SEFAZ — situação sincronizada.' : data.erro || 'Falha ao consultar.', !!data.ok);
                                    void carregar(token);
                                  } catch { showToast('Falha de conexão ao consultar.', false); }
                                  finally { setBusyId(null); }
                                }}
                                disabled={ocupado}
                                className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center active:scale-90 transition-transform"
                                title="Consultar situação na SEFAZ"
                              >
                                {ocupado ? <i className="fa-solid fa-spinner fa-spin text-[11px]"></i> : <i className="fa-solid fa-rotate text-[11px]"></i>}
                              </button>
                            )}
                            {n.avulsa && (
                              <button onClick={() => void atualizarAvulsa(n)} disabled={ocupado} className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center active:scale-90 transition-transform" title="Re-consultar na SEFAZ e atualizar arquivos">
                                {ocupado ? <i className="fa-solid fa-spinner fa-spin text-[11px]"></i> : <i className="fa-solid fa-rotate text-[11px]"></i>}
                              </button>
                            )}
                            {!n.avulsa && podeEmitir && (
                              <button
                                onClick={() => { setEmitModal(n); setEmitTipo(''); }}
                                disabled={ocupado}
                                className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center active:scale-90 transition-transform"
                                title="Emitir documento fiscal (NF-e/NFC-e)"
                              >
                                <i className="fa-solid fa-bolt text-[11px]"></i>
                              </button>
                            )}
                            {!n.avulsa && (
                              <button
                                onClick={() => { setEditModal(n); setEditMetodo(n.metodo || ''); setEditDetalhe(n.detalhe || ''); }}
                                disabled={ocupado}
                                className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center active:scale-90 transition-transform"
                                title="Editar registro (pagamento/observação)"
                              >
                                <i className="fa-solid fa-pen text-[11px]"></i>
                              </button>
                            )}
                            {!n.avulsa && <button onClick={() => setCloneModal(n)} disabled={ocupado} className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center active:scale-90 transition-transform" title="Clonar pedido (emite documento de novo)">
                              <i className="fa-solid fa-clone text-[11px]"></i>
                            </button>}
                            {!n.avulsa && (n.status === 'AUTORIZADA' || n.status === 'EMITINDO') && n.ref && (
                              <button onClick={() => { setCancelModal(n); setJustificativa(''); }} disabled={ocupado} className="w-8 h-8 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center active:scale-90 transition-transform" title="Cancelar nota na SEFAZ">
                                <i className="fa-solid fa-ban text-[11px]"></i>
                              </button>
                            )}
                            {n.avulsa && (
                              <button onClick={() => void excluirAvulsa(n)} disabled={ocupado} className="w-8 h-8 rounded-xl bg-gray-50 text-gray-500 flex items-center justify-center active:scale-90 transition-transform" title="Apagar a cópia interna (a nota continua na Focus/SEFAZ)">
                                <i className="fa-solid fa-trash text-[11px]"></i>
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
            <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                {listaFiltrada.length} nota(s) — mais recentes primeiro
              </p>
              <p className="text-[9px] font-bold uppercase tracking-wider">
                <span className="text-emerald-500">{listaFiltrada.filter(n => n.pdfLocal).length} DANFE no sistema</span>
                <span className="text-gray-300"> · </span>
                <span className="text-emerald-500">{listaFiltrada.filter(n => n.xmlLocal).length} XML no sistema</span>
                <span className="text-gray-300"> · </span>
                <span className="text-gray-400">{listaFiltrada.filter(n => n.avulsa).length} fora do app</span>
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto py-5 text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-300">DOCE MANIA · Portal de Notas Fiscais</p>
      </footer>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[300] max-w-[92vw] rounded-2xl px-5 py-3 shadow-2xl text-center text-[11px] font-bold ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`} role="status">
          {toast.msg}
        </div>
      )}

      {/* Progresso da importação (BLOCO 141) */}
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

      {/* ===== Modal: DETALHE (o que foi pedido) ===== */}
      {detalhe && (() => {
        const n = detalhe.nota;
        const meta = metaStatus(n.status);
        const c = detalhe.cliente;
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setDetalhe(null)}>
            <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-5 sticky top-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-blue-200">{rotuloTipo(n.tipo, n.modoNota)} {n.numero ? `Nº ${n.numero}` : '(sem número)'}</p>
                    <p className="text-lg font-black mt-0.5">{n.cliente}</p>
                    <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase px-2 py-1 rounded-lg mt-2 bg-white/15`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></span>{meta.label}
                    </span>
                  </div>
                  <button onClick={() => setDetalhe(null)} className="w-9 h-9 rounded-xl bg-white/15 text-white flex items-center justify-center active:scale-90" aria-label="Fechar detalhes">
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
              <div className="p-5 space-y-4">
                {n.erro && (
                  <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3">
                    <p className="text-[9px] font-black uppercase text-rose-500 tracking-wider">Motivo da SEFAZ</p>
                    <p className="text-[10px] font-bold text-rose-600 mt-1 leading-snug">{n.erro}</p>
                  </div>
                )}
                {/* Itens */}
                <div>
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-2"><i className="fa-solid fa-basket-shopping mr-1"></i>O que foi pedido ({detalhe.itens.length} item(ns))</p>
                  <div className="max-h-56 overflow-y-auto space-y-1.5">
                    {detalhe.itens.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2">
                        <p className="text-[11px] font-bold text-gray-700 flex-1 min-w-0 truncate">{it.produto}</p>
                        <p className="text-[10px] font-black text-gray-500 whitespace-nowrap">{it.quantidade} × {fmtBRL(it.preco)}</p>
                        <p className="text-[11px] font-black text-gray-800 whitespace-nowrap">{fmtBRL(it.quantidade * it.preco)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-2 px-3">
                    <p className="text-[10px] font-black uppercase text-gray-500">Total da venda</p>
                    <p className="text-sm font-black text-blue-600">{fmtBRL(n.valor)}</p>
                  </div>
                </div>
                {/* Cliente */}
                {c && (
                  <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4">
                    <p className="text-[9px] font-black uppercase text-blue-500 tracking-wider mb-2"><i className="fa-solid fa-user mr-1"></i>Cliente</p>
                    <div className="grid grid-cols-1 gap-1 text-[10px] font-bold text-gray-600">
                      <p>{c.razao_social || c.nome_fantasia || c.nome || '—'}</p>
                      {c.cnpj && <p className="text-gray-400">DOC: {c.cnpj}</p>}
                      {c.inscricao_estadual && <p className="text-gray-400">IE: {c.inscricao_estadual}</p>}
                      {(c.endereco || c.bairro || c.endereco_municipio) && (
                        <p className="text-gray-400">{[c.endereco, c.endereco_numero].filter(Boolean).join(', ')}{c.bairro ? ` - ${c.bairro}` : ''}{c.endereco_municipio ? ` - ${c.endereco_municipio}/${c.endereco_uf || ''}` : ''}</p>
                      )}
                      {c.email && <p className="text-gray-400"><i className="fa-solid fa-envelope text-[8px] mr-1"></i>{c.email}</p>}
                      {c.telefone && <p className="text-gray-400"><i className="fa-solid fa-phone text-[8px] mr-1"></i>{c.telefone}</p>}
                    </div>
                  </div>
                )}
                {/* Pagamento */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-2"><i className="fa-solid fa-wallet mr-1"></i>Pagamento</p>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-gray-700 uppercase">{(n.metodo || '—').replace('_', ' ')}</p>
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg ${n.statusPagamento === 'PAGO' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{n.statusPagamento === 'PAGO' ? 'Pago' : 'Pendente'}</span>
                  </div>
                  {n.detalhe && <p className="text-[9px] font-bold text-gray-400 mt-1 leading-snug">{n.detalhe}</p>}
                  <p className="text-[9px] font-bold text-gray-400 mt-1">Pago registrado: {fmtBRL(n.valorPago)} · Vendedor: {n.vendedor || '—'}</p>
                </div>
                {/* Documento */}
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase text-gray-400 tracking-wider mb-2"><i className="fa-solid fa-receipt mr-1"></i>Documento fiscal</p>
                  {n.chave && <p className="text-[9px] font-bold text-gray-500 break-all leading-snug">Chave: {n.chave}</p>}
                  <p className="text-[9px] font-bold text-gray-400 mt-1">Emissão: {fmtData(n.emitidaEm || n.dataVenda)} · Venda: {fmtData(n.dataVenda)}</p>
                  {n.ref && <p className="text-[9px] font-bold text-gray-400">Referência: {n.ref}</p>}
                  {(n.pdfUrl || n.xmlUrl) && (
                    <div className="flex gap-2 mt-3">
                      {n.pdfUrl && <a href={n.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex-1 text-center bg-rose-600 text-white rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"><i className="fa-solid fa-file-pdf mr-1"></i>DANFE (PDF)</a>}
                      {n.xmlUrl && <a href={n.xmlUrl} target="_blank" rel="noopener noreferrer" className="flex-1 text-center bg-gray-800 text-white rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"><i className="fa-solid fa-code mr-1"></i>XML</a>}
                    </div>
                  )}
                </div>
              </div>
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

      {/* ===== Modal: CANCELAR ===== */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6" onClick={() => setCancelModal(null)}>
          <div className="bg-white w-full max-w-md rounded-[2rem] p-6 shadow-2xl overflow-y-auto max-h-[90dvh]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-rose-600 uppercase text-sm mb-1"><i className="fa-solid fa-ban mr-1"></i>Cancelar nota</h3>
            <p className="text-[9px] font-bold text-gray-400 mb-4">{rotuloTipo(cancelModal.tipo, cancelModal.modoNota)} {cancelModal.numero} · {cancelModal.cliente} · {fmtBRL(cancelModal.valor)}</p>
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 mb-4">
              <p className="text-[9px] font-bold text-rose-600 leading-snug"><i className="fa-solid fa-triangle-exclamation mr-1"></i>Regra da SEFAZ: NFC-e pode ser cancelada até 30 MINUTOS após a emissão; NF-e até 24h. O cancelamento é enviado à SEFAZ e o XML original continua existindo (evento de cancelamento).</p>
            </div>
            <label className="block text-[9px] font-black text-gray-400 uppercase ml-1 mb-1">Justificativa (mínimo 15 caracteres)</label>
            <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={3} maxLength={255} placeholder="Ex.: Erro na emissão — valores divergentes." className="w-full p-4 bg-gray-50 rounded-2xl font-semibold text-sm outline-none focus:ring-2 focus:ring-rose-100 resize-none" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCancelModal(null)} className="flex-1 bg-gray-100 text-gray-500 rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95">Voltar</button>
              <button onClick={() => void cancelarNota()} disabled={busyId === 'cancel'} className="flex-1 bg-rose-600 text-white rounded-2xl py-3.5 text-[11px] font-black uppercase active:scale-95 disabled:opacity-60">
                {busyId === 'cancel' ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Cancelar nota'}
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
              <p className="text-[9px] font-bold text-violet-700 leading-snug">Use para RE-EMITIR o documento fiscal (ex.: nota cancelada) — depois toque EMITIR na linha da cópia.</p>
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
    </div>
  );
}
