"use client";

/**
 * BLOCO 148 — PORTAL DE ENTRADAS (admin, fora do app) — PC otimizado.
 *
 * Regra do dono: "da mesma forma que vc criou o portal fiscal vc vai criar o
 * portal de entradas que é as notas xml de fornecedores que hoje ja funciona
 * na aba xml produtos! otimize assim como o portal fiscal, entrada por lote e
 * organização de cada xml para fazer a vinculação com produtos existentes."
 *
 * Mesma linguagem do PORTAL FISCAL (/notas) aplicada às ENTRADAS:
 *  - TABELA IOB: cada nota de fornecedor = UMA linha (emissão, fornecedor,
 *    NF nº/série, itens, pendentes, valor, situação, ações) — página larga
 *    (1600px), paddings apertados, sem quebra de linha;
 *  - ENTRADA POR LOTE: arrasta/seleciona vários XMLs (ou .zip) de uma vez;
 *  - ORGANIZAÇÃO POR XML: linha expande e mostra TODOS os itens da nota
 *    (código, EAN, NCM, quantidade, custo) com sugestão de produto;
 *  - VINCULAÇÃO com produtos existentes: por sugestão segura (>= 90%) na
 *    nota inteira OU item a item (busca no catálogo / cria produto novo);
 *  - ENTRADA NO ESTOQUE por nota (1 clique, com confirmação) — soma via
 *    kardex, custo = valor da nota;
 *  - TODA ação que muda estado pede CONFIRMAÇÃO (modal de pergunta);
 *  - SPEDY integrado (notas recebidas DFe — manifestação → fila).
 *
 * Auth: mesmo modelo do portal fiscal — POST /api/notas-admin {acao:'AUTH'}
 * valida o PIN do admin (bcrypt) e o token nasce ADMIN (as rotas
 * /api/xml-importacao e /api/spedy já aceitam).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { unzipSync } from 'fflate';
import PortalPinGate from '@/components/doce/PortalPinGate';

// ---------------- tipos ----------------
interface Importacao {
  id: string;
  chave: string;
  origem: string;
  emitCnpj: string;
  emitNome: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  valorTotal: number;
  criadoEm: string;
  qtdItens: number;
  qtdPendentes: number;
}

interface ItemFila {
  id: string;
  importacaoId: string;
  emitNome: string;
  dataEmissao: string;
  chave: string;
  cProd: string;
  cEAN: string;
  xProd: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  cstIcms: string;
  status: string;
  produtoId: string | null;
  produtoNome: string | null;
  entradaEstoqueEm: string | null;
  sugestao: { produtoId: string; nome: string; score: number } | null;
}

interface ProdutoMini { id: string; nome: string; ean: string; }

interface EstadoSpedy {
  configurado: boolean;
  ambiente: string;
  conectado: boolean | null;
  mensagem?: string;
  erro?: string;
  inbound?: { habilitado: boolean | null; motivo?: string };
  certificado?: { diasParaVencer: number | null; isActive: boolean } | null;
}

interface ConfModal {
  titulo: string;
  texto: string;
  detalhe?: string;
  icone: string;
  botao: string;
  run: () => Promise<void> | void;
}

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

const fmtData = (iso: string) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
  } catch { return '—'; }
};

const fmtCnpj = (raw: string) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 14) return raw || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  PENDENTE: { label: 'Na fila', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  VINCULADO: { label: 'Vinculado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  CRIADO: { label: 'Criado', cls: 'bg-gray-900 text-white border-gray-900', dot: 'bg-gray-900' },
  IGNORADO: { label: 'Ignorado', cls: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-300' },
};

function metaStatus(st: string) {
  return STATUS_META[String(st || '').toUpperCase()] || { label: st || '—', cls: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-300' };
}

type FiltroItem = 'TODOS' | 'PENDENTE' | 'VINCULADO' | 'CRIADO' | 'IGNORADO';
type FiltroPeriodo = 'TUDO' | '7D' | '30D' | 'MES';

const PERIODO_META: { key: FiltroPeriodo; label: string }[] = [
  { key: '7D', label: '7 dias' },
  { key: '30D', label: '30 dias' },
  { key: 'MES', label: 'Este mês' },
  { key: 'TUDO', label: 'Tudo' },
];

function dentroPeriodo(iso: string, p: FiltroPeriodo): boolean {
  if (p === 'TUDO' || !iso) return true;
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return true;
  const agora = new Date();
  const diaStr = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  if (p === 'MES') return diaStr(d).slice(0, 7) === diaStr(agora).slice(0, 7);
  const dias = p === '7D' ? 7 : 30;
  return d.getTime() >= agora.getTime() - dias * 24 * 60 * 60 * 1000;
}

/** Situação da nota: resume a fila daquele XML em um rótulo. */
function situacaoDaNota(pend: number, comEntrada: number, total: number): { label: string; cls: string } {
  if (total > 0 && comEntrada >= total) return { label: 'Entrou no estoque', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (pend === 0) return { label: comEntrada > 0 ? 'Pronta p/ entrada' : 'Resolvida', cls: 'bg-teal-50 text-teal-700 border-teal-200' };
  if (pend === total) return { label: 'Fila inteira', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: `${pend} na fila`, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
}

// ---------------- página ----------------
export default function PortalEntradasPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [booting, setBooting] = useState(true);

  // PIN gate
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);

  // Dados
  const [importacoes, setImportacoes] = useState<Importacao[]>([]);
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [produtos, setProdutos] = useState<ProdutoMini[]>([]);
  const [catalogo, setCatalogo] = useState({ total: 0, comNcm: 0, comEan: 0 });
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState('');
  const [temEntrada, setTemEntrada] = useState(false);

  // Filtros
  const [busca, setBusca] = useState('');
  const [periodo, setPeriodo] = useState<FiltroPeriodo>('TUDO');
  const [filtroForn, setFiltroForn] = useState('TODOS');
  const [filtroItem, setFiltroItem] = useState<FiltroItem>('TODOS');
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);

  // Upload
  const [subindo, setSubindo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [uploadRes, setUploadRes] = useState<{ importadas: number; duplicadas: number; itens: number; erros: { nome: string; motivo: string }[] } | null>(null);
  const inputXmlRef = useRef<HTMLInputElement>(null);

  // SPEDY
  const [spedy, setSpedy] = useState<EstadoSpedy | null>(null);
  const [spedyAberto, setSpedyAberto] = useState(false);
  const [spedyOcupado, setSpedyOcupado] = useState<string | null>(null);
  const [spedyMsg, setSpedyMsg] = useState('');

  // Ações
  const [busy, setBusy] = useState<string | null>(null);
  const [conf, setConf] = useState<ConfModal | null>(null);
  const [criandoItem, setCriandoItem] = useState<ItemFila | null>(null);
  const [criandoForm, setCriandoForm] = useState({ nome: '', precoCusto: '', precoVenda: '', unidade: 'UN' });
  const [vincItem, setVincItem] = useState<ItemFila | null>(null);
  const [vincBusca, setVincBusca] = useState('');

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const headers = (t: string): HeadersInit => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

  // ---------- boot: retomar sessão (mesma do portal fiscal) ----------
  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const n = localStorage.getItem(NOME_KEY) || '';
      if (t) { setToken(t); setNomeAdmin(n); }
    } catch { /* storage bloqueado */ }
    setBooting(false);
  }, []);

  // ---------- carregar dados ----------
  const carregar = useCallback(async (t: string) => {
    setCarregando(true);
    setErroLista('');
    try {
      const [rImp, rItens, rSpedy] = await Promise.all([
        fetch('/api/xml-importacao', { headers: headers(t), cache: 'no-store' }),
        fetch('/api/xml-importacao/itens?status=TODOS&limit=500', { headers: headers(t), cache: 'no-store' }),
        fetch('/api/spedy', { headers: headers(t), cache: 'no-store' }),
      ]);
      const dImp = await rImp.json().catch(() => null);
      const dItens = await rItens.json().catch(() => null);
      const dSpedy = await rSpedy.json().catch(() => null);
      if (rImp.status === 401 || rImp.status === 403) {
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
        setToken(null); setNomeAdmin('');
        setErroLista('Sessão expirada. Entre com o PIN novamente.');
        return;
      }
      if (!rImp.ok || !dImp?.ok) { setErroLista(dImp?.erro || `Erro ${rImp.status}`); return; }
      setImportacoes((dImp.importacoes || []) as Importacao[]);
      setProdutos((dImp.produtos || []) as ProdutoMini[]);
      setCatalogo(dImp.catalogo || { total: 0, comNcm: 0, comEan: 0 });
      setItens(rItens.ok && dItens?.ok ? (dItens.itens as ItemFila[]) : []);
      setTemEntrada(!!dItens?.temEntrada);
      if (rSpedy.ok && dSpedy?.ok && dSpedy?.estado) setSpedy(dSpedy.estado as EstadoSpedy);
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
    setToken(null); setNomeAdmin(''); setImportacoes([]); setItens([]); setBusca('');
  };

  // ---------- itens por nota (agrupamento em memória) ----------
  const itensPorNota = useMemo(() => {
    const map = new Map<string, ItemFila[]>();
    for (const it of itens) {
      const k = it.importacaoId || 'sem';
      const arr = map.get(k) || [];
      arr.push(it);
      map.set(k, arr);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => String(a.xProd || '').localeCompare(String(b.xProd || ''), 'pt-BR'));
    }
    return map;
  }, [itens]);

  // ---------- linhas da tabela (nota = 1 linha) ----------
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return importacoes
      .filter(imp => {
        if (!dentroPeriodo(imp.dataEmissao || imp.criadoEm, periodo)) return false;
        if (filtroForn !== 'TODOS' && imp.emitNome !== filtroForn) return false;
        if (!q) return true;
        const its = itensPorNota.get(imp.id) || [];
        return (
          (imp.emitNome || '').toLowerCase().includes(q) ||
          (imp.emitCnpj || '').includes(q) ||
          (imp.numero || '').includes(q) ||
          (imp.chave || '').includes(q) ||
          its.some(i => (i.xProd || '').toLowerCase().includes(q) || (i.cProd || '').toLowerCase().includes(q))
        );
      })
      .sort((a, b) => String(b.dataEmissao || b.criadoEm || '').localeCompare(String(a.dataEmissao || a.criadoEm || '')));
  }, [importacoes, itensPorNota, busca, periodo, filtroForn]);

  const fornecedores = useMemo(() => {
    return [...new Set(importacoes.map(i => i.emitNome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [importacoes]);

  const kpis = useMemo(() => {
    const visiveis = importacoes.filter(i => dentroPeriodo(i.dataEmissao || i.criadoEm, periodo));
    const itsVisiveis = visiveis.flatMap(i => itensPorNota.get(i.id) || []);
    const count = (st: string) => itsVisiveis.filter(i => i.status === st).length;
    return {
      notas: visiveis.length,
      itens: itsVisiveis.length,
      pendente: count('PENDENTE'),
      vinculado: count('VINCULADO'),
      criado: count('CRIADO'),
      ignorado: count('IGNORADO'),
      valor: visiveis.reduce((a, i) => a + (Number(i.valorTotal) || 0), 0),
      comEntrada: itsVisiveis.filter(i => !!i.entradaEstoqueEm).length,
    };
  }, [importacoes, itensPorNota, periodo]);

  // ---------- UPLOAD XML EM LOTE (xml + zip) ----------
  const enviarLote = useCallback(async (arqs: { nome: string; conteudo: string }[]) => {
    if (!token || arqs.length === 0) return;
    setSubindo(true);
    setUploadRes(null);
    try {
      const res = await fetch('/api/xml-importacao', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ arquivos: arqs }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { showToast(d?.erro || 'Falha na importação dos XMLs.', false); return; }
      const r = d.resumo;
      setUploadRes({ importadas: r.importadas, duplicadas: r.duplicadas, itens: r.itens, erros: r.erros || [] });
      const partes: string[] = [];
      if (r.importadas > 0) partes.push(`${r.importadas} nota(s) importada(s)`);
      if (r.itens > 0) partes.push(`${r.itens} itens na fila`);
      if (r.duplicadas > 0) partes.push(`${r.duplicadas} já existente(s)`);
      if ((r.erros || []).length > 0) partes.push(`${r.erros.length} com erro`);
      showToast(partes.length ? `Lote processado: ${partes.join(' • ')}.` : 'Nada para importar.', (r.erros || []).length > 0 && r.importadas === 0 ? 'error' : 'success');
      await carregar(token);
    } catch {
      showToast('Falha lendo os arquivos XML.', false);
    } finally {
      setSubindo(false);
      if (inputXmlRef.current) inputXmlRef.current.value = '';
    }
  }, [token, showToast, carregar]);

  const importarArquivos = useCallback(async (files: FileList | File[]) => {
    const lista = Array.from(files);
    const xmls: File[] = [];
    const zips: File[] = [];
    for (const f of lista) {
      if (/\.zip$/i.test(f.name)) zips.push(f);
      else if (/\.xml$/i.test(f.name) || f.type.includes('xml')) xmls.push(f);
    }
    if (xmls.length === 0 && zips.length === 0) {
      showToast('Selecione arquivos .xml ou .zip de notas de compra.', false);
      return;
    }
    const conteudos: { nome: string; conteudo: string }[] = [];
    for (const f of xmls.slice(0, 60)) {
      conteudos.push({ nome: f.name, conteudo: await f.text() });
    }
    for (const z of zips.slice(0, 5)) {
      try {
        const buf = new Uint8Array(await z.arrayBuffer());
        const files = unzipSync(buf);
        for (const [nome, data] of Object.entries(files)) {
          if (/\.xml$/i.test(nome) && !/-can\.xml$/i.test(nome) && !nome.startsWith('__MACOSX')) {
            conteudos.push({ nome: nome.split('/').pop() || nome, conteudo: new TextDecoder('utf-8').decode(data) });
            if (conteudos.length >= 60) break;
          }
        }
      } catch {
        showToast(`ZIP ilegível: ${z.name}`, false);
      }
    }
    if (conteudos.length === 0) { showToast('Nenhum XML encontrado nos arquivos.', false); return; }
    await enviarLote(conteudos);
  }, [enviarLote, showToast]);

  // ---------- AÇÕES (sempre com confirmação) ----------
  const acaoItem = useCallback(async (body: Record<string, unknown>, msgOk: string) => {
    if (!token) return null;
    setBusy(String(body.itemId || body.importacaoId || body.acao || 'LOTE'));
    try {
      const res = await fetch('/api/xml-importacao/itens', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { showToast(d?.erro || 'Ação falhou.', false); return null; }
      const aviso = d.aviso ? ` ⚠ ${d.aviso}` : '';
      if (msgOk) showToast(msgOk + aviso, !aviso);
      await carregar(token);
      return d;
    } catch {
      showToast('Sem conexão para a ação.', false);
      return null;
    } finally {
      setBusy(null);
    }
  }, [token, showToast, carregar]);

  const vincularSugestoesNota = (imp: Importacao) => {
    const pend = (itensPorNota.get(imp.id) || []).filter(i => i.status === 'PENDENTE');
    const seguras = pend.filter(i => (i.sugestao?.score ?? 0) >= 0.9);
    setConf({
      titulo: 'Vincular sugestões seguras?',
      texto: `A nota ${imp.numero || ''} de ${imp.emitNome || 'fornecedor'} tem ${pend.length} item(ns) na fila e ${seguras.length} com sugestão de correspondência >= 90% no catálogo.`,
      detalhe: 'A vinculação completa o cadastro fiscal do produto (NCM/EAN/unidade/CEST) onde estiver vazio — nunca sobrescreve valor já preenchido.',
      icone: 'fa-wand-magic-sparkles',
      botao: `Vincular ${seguras.length} item(ns)`,
      run: async () => {
        if (seguras.length === 0) { showToast('Nenhum item com sugestão segura (>= 90%) — vincule manualmente.', false); return; }
        const r = await acaoItem({ acao: 'VINCULAR_SUGESTOES', importacaoId: imp.id }, `Vinculados por sugestão: ${seguras.length}`);
        if (r && typeof r.vinculados === 'number' && r.vinculados === 0) showToast('Nenhum vinculado — confira as sugestões manualmente.', false);
      },
    });
  };

  const darEntradaNota = (imp: Importacao) => {
    const alvos = (itensPorNota.get(imp.id) || []).filter(i => (i.status === 'VINCULADO' || i.status === 'CRIADO') && !i.entradaEstoqueEm);
    const comEntrada = (itensPorNota.get(imp.id) || []).filter(i => !!i.entradaEstoqueEm).length;
    setConf({
      titulo: 'Dar entrada no estoque?',
      texto: `A nota ${imp.numero || ''} de ${imp.emitNome || 'fornecedor'} tem ${alvos.length} item(ns) prontos e ${comEntrada} que já entraram.`,
      detalhe: `As quantidades da nota SOMAM no estoque central (custo = valor da nota).`,
      icone: 'fa-truck-ramp-box',
      botao: `Entrar ${alvos.length} item(ns)`,
      run: async () => {
        if (alvos.length === 0) { showToast('Nada a entrar nesta nota — vincule os itens primeiro ou a entrada já foi feita.', false); return; }
        await acaoItem({ acao: 'ENTRADA_LOTE', importacaoId: imp.id }, `Entrada no estoque: ${alvos.length} item(ns) da nota.`);
      },
    });
  };

  const vincularItem = (item: ItemFila, produtoId: string, nomeProduto: string) => {
    setConf({
      titulo: 'Vincular ao produto?',
      texto: `"${item.xProd}" (${item.quantidade} ${item.unidade} × ${fmtBRL(item.valorUnitario)}) será vinculado a "${nomeProduto}".`,
      detalhe: 'Campos fiscais vazios do produto (NCM/EAN/unidade/CEST) serão completados com os dados da nota.',
      icone: 'fa-link',
      botao: 'Vincular',
      run: async () => { await acaoItem({ acao: 'VINCULAR', itemId: item.id, produtoId }, `Vinculado a ${nomeProduto}.`); },
    });
  };

  const ignorarItem = (item: ItemFila) => {
    setConf({
      titulo: 'Ignorar item?',
      texto: `"${item.xProd}" sai da fila e não entra no estoque.`,
      detalhe: 'Você pode reabrir depois no botão REABRIR da linha.',
      icone: 'fa-ban',
      botao: 'Ignorar',
      run: async () => { await acaoItem({ acao: 'IGNORAR', itemId: item.id }, 'Item ignorado.'); },
    });
  };

  const reabrirItem = (item: ItemFila) => {
    setConf({
      titulo: 'Reabrir item?',
      texto: `"${item.xProd}" volta para a fila de vinculação.`,
      icone: 'fa-rotate-left',
      botao: 'Reabrir',
      run: async () => { await acaoItem({ acao: 'REABRIR', itemId: item.id }, 'Item devolvido para a fila.'); },
    });
  };

  // BLOCO 206 (regra do dono): excluir o XML inteiro da lista do portal
  const excluirImportacao = (imp: Importacao) => {
    const totalItens = imp.qtdItens || (itensPorNota.get(imp.id)?.length || 0);
    setConf({
      titulo: 'Excluir XML da lista?',
      texto: `A nota ${imp.numero || ''} de ${imp.emitNome || 'fornecedor'} (${totalItens} itens, ${fmtBRL(imp.valorTotal)}) será APAGADA — sai da lista e do balanço fiscal.`,
      detalhe: 'Itens que JÁ entraram no estoque continuam no estoque (a exclusão não devolve nem tira quantidade). Não dá para desfazer.',
      icone: 'fa-trash',
      botao: 'Excluir nota',
      run: async () => {
        if (!token) return;
        setBusy(imp.id);
        try {
          const res = await fetch(`/api/xml-importacao?id=${encodeURIComponent(imp.id)}`, { method: 'DELETE', headers: headers(token) });
          const d = await res.json().catch(() => null);
          if (!res.ok || !d?.ok) { showToast(String(d?.erro || 'Falha ao excluir.'), false); return; }
          showToast('XML excluído do portal.');
          if (linhaAberta === imp.id) setLinhaAberta(null);
          await carregar(token);
        } catch {
          showToast('Sem conexão para excluir.', false);
        } finally {
          setBusy(null);
        }
      },
    });
  };

  const entradaItem = (item: ItemFila) => {
    setConf({
      titulo: 'Entrada no estoque deste item?',
      texto: `+${item.quantidade} ${item.unidade} de "${item.produtoNome || item.xProd}" (custo ${fmtBRL(item.valorUnitario)}).`,
      detalhe: 'A quantidade soma no estoque central via kardex (origem XML). Não entra 2x.',
      icone: 'fa-plus',
      botao: 'Entrar no estoque',
      run: async () => {
        const r = await acaoItem({ acao: 'ENTRADA_ESTOQUE', itemId: item.id }, 'Estoque entrou!');
        if (r && r.saldo != null) showToast(`Estoque entrou — saldo agora: ${Number(r.saldo).toLocaleString('pt-BR')} un${r.aviso ? ' ⚠ ' + r.aviso : ''}`, 'success');
      },
    });
  };

  // ---------- CRIAR PRODUTO ----------
  const abrirCriar = (item: ItemFila) => {
    setCriandoItem(item);
    const custo = item.valorUnitario.toFixed(2).replace('.', ',');
    const vendaSugerida = (item.valorUnitario * 2).toFixed(2).replace('.', ',');
    setCriandoForm({ nome: item.xProd, precoCusto: custo, precoVenda: vendaSugerida, unidade: item.unidade || 'UN' });
  };

  const confirmarCriar = async () => {
    if (!criandoItem || !token) return;
    const precoVenda = Number(criandoForm.precoVenda.replace(',', '.'));
    const precoCusto = Number(criandoForm.precoCusto.replace(',', '.'));
    if (!criandoForm.nome.trim()) { showToast('Informe o nome do produto.', false); return; }
    if (!Number.isFinite(precoVenda) || precoVenda <= 0) { showToast('Preço de venda inválido.', false); return; }
    setBusy(criandoItem.id);
    try {
      const res = await fetch('/api/xml-importacao/itens', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({
          acao: 'CRIAR',
          itemId: criandoItem.id,
          produto: {
            nome: criandoForm.nome.trim(),
            precoVenda,
            precoCusto: Number.isFinite(precoCusto) && precoCusto > 0 ? precoCusto : undefined,
            unidade: criandoForm.unidade.trim().toUpperCase() || 'UN',
          },
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { showToast(d?.erro || 'Falha criando produto.', false); return; }
      showToast(`Produto "${d.produtoNome}" criado no catálogo com os dados fiscais da XML.`, 'success');
      setCriandoItem(null);
      await carregar(token);
    } catch {
      showToast('Falha de conexão ao criar produto.', false);
    } finally { setBusy(null); }
  };

  // ---------- SPEDY ----------
  const acaoSpedy = useCallback(async (body: Record<string, unknown>, msgPadrao: string) => {
    if (!token) return;
    setSpedyOcupado(String(body.acao));
    try {
      const res = await fetch('/api/spedy', {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setSpedyMsg(d?.erro || 'Ação Spedy falhou.'); showToast(d?.erro || 'Ação Spedy falhou.', false); return; }
      if (d.estado) setSpedy(d.estado as EstadoSpedy);
      const msg = String(d.mensagem || msgPadrao);
      setSpedyMsg(msg);
      showToast(msg, 'success');
      if (body.acao === 'IMPORTAR_INBOUND') await carregar(token);
    } catch {
      showToast('Sem conexão com o servidor.', false);
    } finally {
      setSpedyOcupado(null);
    }
  }, [token, showToast, carregar]);

  // ---------- busca de produtos para vinculação manual ----------
  const produtosFiltrados = useMemo(() => {
    const q = vincBusca.trim().toLowerCase();
    const base = q
      ? produtos.filter(p => p.nome.toLowerCase().includes(q) || (p.ean || '').includes(q))
      : produtos;
    return base.slice(0, 40);
  }, [produtos, vincBusca]);

  // ================= TELA: PIN =================
  if (booting) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    // BLOCO 206: tela de login ÚNICA dos portais (mesmo visual do fiscal/financeiro/cobranças)
    return (
      <PortalPinGate
        titulo="Portal de Entradas"
        subtitulo="XMLs de fornecedores · estoque · fiscal"
        icone="fa-truck-ramp-box"
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
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-40 shadow-lg shadow-teal-900/10">
        <div className="bg-gradient-to-r from-teal-700 via-teal-800 to-emerald-900 text-white">
          <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-truck-ramp-box text-emerald-100"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Portal de Entradas <span className="text-emerald-300">XML · Estoque · Fiscal</span></h1>
              <p className="text-[10px] text-emerald-200/70 font-semibold mt-1 leading-none truncate">
                {nomeAdmin ? <><i className="fa-solid fa-user-shield mr-1 text-[8px]"></i>{nomeAdmin} · </> : null}
                <span className="uppercase tracking-wide">notas de fornecedores</span>
              </p>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => inputXmlRef.current?.click()}
                disabled={subindo}
                className="bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-amber-950 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-lg shadow-amber-900/30 flex items-center gap-1.5"
                title="Entrada por lote: arraste ou selecione vários XMLs (ou .zip) de notas de fornecedores"
              >
                <i className="fa-solid fa-file-import"></i>{subindo ? 'Importando...' : 'Importar XML em lote'}
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
                className="bg-white/10 hover:bg-white/20 text-emerald-100 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Sair do portal"
              >
                <i className="fa-solid fa-right-from-bracket"></i>Sair
              </button>
            </div>
          </div>
        </div>
        {/* faixa de KPIs — uma linha só */}
        <div className="bg-emerald-950 text-emerald-100">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center gap-4 text-[10px] font-bold whitespace-nowrap overflow-x-auto" role="status">
            <span><b className="text-white">{kpis.notas}</b> notas</span>
            <span><b className="text-white">{kpis.itens}</b> itens</span>
            <span className="text-amber-300"><b>{kpis.pendente}</b> na fila</span>
            <span className="text-emerald-300"><b>{kpis.vinculado}</b> vinculados</span>
            <span className="text-gray-300"><b>{kpis.criado}</b> criados</span>
            <span className="text-gray-400"><b>{kpis.ignorado}</b> ignorados</span>
            <span className="text-teal-300"><b>{kpis.comEntrada}</b> com estoque</span>
            <span className="text-emerald-300/60">|</span>
            <span className="text-emerald-200/80"><b>{fmtBRL(kpis.valor)}</b> em compras</span>
            <span className="text-emerald-300/60">|</span>
            <span className="text-emerald-200/60">NCM {catalogo.total > 0 ? Math.round((catalogo.comNcm / catalogo.total) * 100) : 0}% ({catalogo.comNcm}/{catalogo.total})</span>
            <span className="ml-auto flex items-center gap-2 text-emerald-300/80">
              <i className={`fa-solid ${spedy?.configurado ? 'fa-plug-circle-check text-emerald-300' : 'fa-plug-circle-exclamation text-amber-300'}`}></i>
              SPEDY {spedy?.ambiente === 'producao' ? 'PROD' : spedy?.configurado ? 'SANDBOX' : 'off'}
              <button onClick={() => setSpedyAberto(o => !o)} className="underline underline-offset-2 hover:text-white" aria-expanded={spedyAberto}>
                {spedyAberto ? 'fechar' : 'abrir'}
              </button>
            </span>
          </div>
        </div>
      </header>

      {/* ================= SPEDY (colapsável) ================= */}
      {spedyAberto && (
        <div className="max-w-[1600px] w-full mx-auto px-4 mt-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-black uppercase tracking-wider text-gray-700"><i className="fa-solid fa-cloud-arrow-down text-teal-600 mr-1.5"></i>Spedy — notas recebidas (DFe)</span>
              <span className={`text-[9px] font-black px-2 py-1 rounded-full ${spedy?.configurado ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {spedy?.configurado ? `conectado · ${spedy.ambiente || ''}` : 'não configurado'}
              </span>
              <span className="text-[10px] font-semibold text-gray-500">
                Inbound DFe: {spedy?.inbound?.habilitado === true ? 'ligado' : spedy?.inbound?.habilitado === false ? 'plano sem recurso' : '—'}
              </span>
              {spedy?.certificado?.diasParaVencer != null && (
                <span className={`text-[10px] font-bold ${spedy.certificado.diasParaVencer < 0 ? 'text-rose-600' : spedy.certificado.diasParaVencer <= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  certificado: {spedy.certificado.diasParaVencer < 0 ? 'VENCIDO' : `${spedy.certificado.diasParaVencer} dias`}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => acaoSpedy({ acao: 'TESTAR' }, 'Conexão testada.')}
                disabled={!!spedyOcupado}
                className="px-3 h-8 rounded-lg bg-teal-600 text-white text-[10px] font-bold disabled:opacity-50 flex items-center gap-1.5"
              >
                {spedyOcupado === 'TESTAR' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-plug" />} Testar
              </button>
              <button
                onClick={() => acaoSpedy({ acao: 'IMPORTAR_INBOUND' }, 'Importação das notas recebidas solicitada.')}
                disabled={!!spedyOcupado}
                className="px-3 h-8 rounded-lg bg-emerald-600 text-white text-[10px] font-bold disabled:opacity-50 flex items-center gap-1.5"
                title="Puxa as notas recebidas completas (DFe) da Spedy e joga na MESMA fila do portal"
              >
                {spedyOcupado === 'IMPORTAR_INBOUND' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-cloud-arrow-down" />} Puxar DFe
              </button>
            </div>
            {spedy?.mensagem && <p className="text-[10px] text-gray-500">{spedy.mensagem}</p>}
            {spedy?.erro && <p className="text-[10px] text-rose-600 font-semibold">{spedy.erro}</p>}
            {spedyMsg && <p className="text-[10px] text-teal-700 font-semibold">{spedyMsg}</p>}
            <p className="text-[9px] font-bold text-gray-400 leading-snug">
              As notas recebidas entram na MESMA fila abaixo (origem SPEDY DFe) — vincule ao catálogo e dê entrada no estoque igual às XMLs de arquivo.
            </p>
          </div>
        </div>
      )}

      {/* ================= UPLOAD EM LOTE (drag & drop) ================= */}
      <div className="max-w-[1600px] w-full mx-auto px-4 mt-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files.length) void importarArquivos(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed px-4 py-3 flex items-center gap-3 transition-colors ${arrastando ? 'border-teal-400 bg-teal-50' : 'border-gray-200 bg-white'}`}
        >
          <i className="fa-solid fa-file-arrow-up text-xl text-teal-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-gray-800">Entrada por lote — arraste os XMLs dos fornecedores aqui</p>
            <p className="text-[10px] text-gray-500">Vários .xml ou .zip de uma vez (pen drive / pasta do contador). Idempotente: chave repetida nunca duplica.</p>
          </div>
          <input
            ref={inputXmlRef}
            type="file"
            multiple
            accept=".xml,.zip"
            onChange={(e) => e.target.files && void importarArquivos(e.target.files)}
            className="hidden"
          />
          <button
            onClick={() => inputXmlRef.current?.click()}
            disabled={subindo}
            className="shrink-0 px-4 h-9 rounded-xl bg-teal-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50 flex items-center gap-1.5"
          >
            {subindo ? <><i className="fa-solid fa-spinner fa-spin" /> Processando</> : <><i className="fa-solid fa-folder-open" /> Selecionar</>}
          </button>
        </div>
        {uploadRes && (
          <div className="mt-2 bg-white rounded-xl border border-gray-200 p-3 text-[11px] text-gray-600">
            <p className="font-bold text-gray-800">
              <i className="fa-solid fa-circle-check text-emerald-500" /> {uploadRes.importadas} nota(s) importada(s) • {uploadRes.itens} itens na fila
              {uploadRes.duplicadas > 0 && <> • {uploadRes.duplicadas} duplicada(s) pulada(s)</>}
            </p>
            {uploadRes.erros.length > 0 && (
              <ul className="list-disc ml-4 mt-1 text-rose-600">
                {uploadRes.erros.slice(0, 6).map((e, i) => <li key={i}><b>{e.nome}</b>: {e.motivo}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ================= FILTROS — uma linha ================= */}
      <div className="max-w-[1600px] w-full mx-auto px-4 mt-3 flex items-center gap-2 flex-wrap lg:flex-nowrap">
        <div className="relative flex-1 min-w-[220px]">
          <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por fornecedor, NF, item, código ou chave..."
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-100"
            aria-label="Buscar nota de entrada"
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
        <select
          value={filtroForn}
          onChange={e => setFiltroForn(e.target.value)}
          className="bg-white border border-gray-200 rounded-xl shadow-sm px-3 py-2.5 text-[10px] font-black uppercase text-gray-600 outline-none max-w-[220px]"
          aria-label="Fornecedor"
        >
          <option value="TODOS">Todos os fornecedores</option>
          {fornecedores.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="flex gap-1.5 overflow-x-auto">
          {(['TODOS', 'PENDENTE', 'VINCULADO', 'CRIADO', 'IGNORADO'] as FiltroItem[]).map(f => {
            const meta = metaStatus(f);
            const n = f === 'TODOS'
              ? linhas.length
              : linhas.filter(imp => (itensPorNota.get(imp.id) || []).some(i => i.status === f)).length;
            const ativo = filtroItem === f;
            return (
              <button
                key={f}
                onClick={() => setFiltroItem(f)}
                className={`shrink-0 rounded-xl px-3 py-2 text-[9px] font-black uppercase tracking-wider border transition-all active:scale-95 ${ativo ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : `bg-white ${f === 'TODOS' ? 'text-gray-600' : meta.cls} border-gray-200`}`}
              >
                {f === 'TODOS' ? 'Todas' : meta.label} ({n})
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= TABELA (estilo IOB — 1 linha por nota) ================= */}
      <main className="max-w-[1600px] w-full mx-auto px-4 mt-2 flex-1 pb-10">
        {carregando && importacoes.length === 0 && (
          <div className="py-16 flex justify-center"><div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" /></div>
        )}

        {!carregando && erroLista && (
          <div className="bg-white rounded-2xl border border-rose-100 p-6 text-center mt-2">
            <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xl"></i>
            <p className="text-xs font-bold text-gray-600 mt-2">{erroLista}</p>
            <button onClick={() => void carregar(token)} className="mt-3 bg-teal-600 text-white rounded-xl px-4 py-2 text-[10px] font-black uppercase active:scale-95">Tentar novamente</button>
          </div>
        )}

        {!carregando && !erroLista && linhas.length === 0 && (
          <div className="text-center py-16 opacity-40 flex flex-col items-center gap-3">
            <i className="fa-solid fa-truck-ramp-box text-4xl"></i>
            <p className="font-black uppercase tracking-widest text-[10px]">Nenhuma nota de entrada neste filtro</p>
            <p className="text-[10px] font-semibold text-gray-500">Arraste os XMLs dos fornecedores na área acima — tudo entra organizado por nota.</p>
          </div>
        )}

        {!erroLista && linhas.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* cabeçalho da tabela */}
            <div className="hidden lg:grid grid-cols-[92px_1fr_110px_130px_110px_150px_240px] gap-2 items-center px-3 py-2 bg-gray-50 border-b border-gray-200 text-[9px] font-black uppercase tracking-wider text-gray-400">
              <span>Emissão</span>
              <span>Fornecedor</span>
              <span className="text-center">NF nº</span>
              <span className="text-center">Itens / fila</span>
              <span className="text-right">Valor</span>
              <span>Situação</span>
              <span className="text-right">Ações</span>
            </div>

            {linhas.map(imp => {
              const its = itensPorNota.get(imp.id) || [];
              const pend = its.filter(i => i.status === 'PENDENTE').length;
              const comEntrada = its.filter(i => !!i.entradaEstoqueEm).length;
              const sit = situacaoDaNota(pend, comEntrada, its.length);
              const aberta = linhaAberta === imp.id;
              const visiveis = filtroItem === 'TODOS' ? its : its.filter(i => i.status === filtroItem);
              return (
                <div key={imp.id} className={`border-b border-gray-100 last:border-0 ${aberta ? 'bg-teal-50/30' : ''}`}>
                  {/* LINHA DA NOTA */}
                  <div className="grid grid-cols-1 lg:grid-cols-[92px_1fr_110px_130px_110px_150px_240px] gap-x-2 gap-y-1 items-center px-3 py-2.5 hover:bg-gray-50/70 transition-colors">
                    <span className="text-[11px] font-bold text-gray-700 whitespace-nowrap">{fmtData(imp.dataEmissao || imp.criadoEm)}</span>
                    <span className="min-w-0 flex items-center gap-2">
                      <i className={`fa-solid ${imp.origem === 'SPEDY_INBOUND' ? 'fa-cloud-arrow-down text-teal-500' : 'fa-file-invoice text-gray-300'} shrink-0`}></i>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-bold text-gray-900 truncate">{imp.emitNome || 'Emitente desconhecido'}</span>
                        <span className="block text-[9px] font-semibold text-gray-400 font-mono">{fmtCnpj(imp.emitCnpj)}</span>
                      </span>
                    </span>
                    <span className="text-center text-[11px] font-black text-gray-800 whitespace-nowrap">{imp.numero || '—'}<span className="text-gray-400 font-semibold"> s/{imp.serie || '1'}</span></span>
                    <span className="text-center whitespace-nowrap">
                      <span className="text-[11px] font-bold text-gray-800">{its.length || imp.qtdItens}</span>
                      {pend > 0 && <span className="ml-1 inline-flex items-center gap-1 text-[9px] font-black bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>{pend} fila</span>}
                    </span>
                    <span className="text-right text-[12px] font-black text-gray-900 tabular-nums whitespace-nowrap">{fmtBRL(imp.valorTotal)}</span>
                    <span>
                      <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full border ${sit.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${pend > 0 ? 'bg-amber-400' : comEntrada > 0 ? 'bg-emerald-500' : 'bg-teal-500'}`}></span>{sit.label}
                      </span>
                      {imp.origem === 'SPEDY_INBOUND' && <span className="ml-1 text-[8px] font-black bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">DFE</span>}
                    </span>
                    <span className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => setLinhaAberta(aberta ? null : imp.id)}
                        className={`rounded-lg px-2 h-7 text-[9px] font-black uppercase tracking-wide border transition-all active:scale-95 flex items-center gap-1 ${aberta ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                        aria-expanded={aberta}
                        title="Ver os itens da nota e vincular"
                      >
                        <i className={`fa-solid ${aberta ? 'fa-chevron-up' : 'fa-list'}`}></i>Itens
                      </button>
                      {pend > 0 && (
                        <button
                          onClick={() => vincularSugestoesNota(imp)}
                          disabled={busy === imp.id}
                          className="rounded-lg px-2 h-7 text-[9px] font-black uppercase tracking-wide bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-500 disabled:opacity-50 active:scale-95 flex items-center gap-1"
                          title="Vincula os itens com sugestão >= 90% (com confirmação)"
                        >
                          <i className={`fa-solid ${busy === imp.id ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>Vincular
                        </button>
                      )}
                      {temEntrada && (
                        <button
                          onClick={() => darEntradaNota(imp)}
                          disabled={busy === imp.id}
                          className="rounded-lg px-2 h-7 text-[9px] font-black uppercase tracking-wide bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 disabled:opacity-50 active:scale-95 flex items-center gap-1"
                          title="Entrada no estoque dos itens prontos da nota (com confirmação)"
                        >
                          <i className={`fa-solid ${busy === imp.id ? 'fa-spinner fa-spin' : 'fa-truck-ramp-box'}`}></i>Entrada
                        </button>
                      )}
                      {/* BLOCO 206 (regra do dono): excluir o XML da lista */}
                      <button
                        onClick={() => excluirImportacao(imp)}
                        disabled={busy === imp.id}
                        className="rounded-lg px-2 h-7 text-[9px] font-black uppercase tracking-wide bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 disabled:opacity-50 active:scale-95 flex items-center gap-1"
                        title="Excluir este XML do portal (com confirmação)"
                      >
                        <i className={`fa-solid ${busy === imp.id ? 'fa-spinner fa-spin' : 'fa-trash'} text-[10px]`}></i>Excluir
                      </button>
                    </span>
                  </div>

                  {/* EXPANSÃO — itens da nota */}
                  {aberta && (
                    <div className="px-3 pb-3">
                      {visiveis.length === 0 ? (
                        <p className="text-[10px] font-bold text-gray-400 bg-white border border-gray-100 rounded-xl px-3 py-3 text-center">Nenhum item neste filtro da nota.</p>
                      ) : (
                        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                          <div className="grid grid-cols-[1fr_120px_90px_100px_110px_170px] gap-2 items-center px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[8px] font-black uppercase tracking-wider text-gray-400">
                            <span>Produto (XML)</span>
                            <span className="text-center">Cód / EAN</span>
                            <span className="text-center">Qtd</span>
                            <span className="text-right">Custo un.</span>
                            <span className="text-center">Fiscal</span>
                            <span className="text-right">Vínculo / ações</span>
                          </div>
                          <div className="max-h-96 overflow-y-auto">
                            {visiveis.map(item => {
                              const st = metaStatus(item.status);
                              return (
                                <div key={item.id} className="grid grid-cols-[1fr_120px_90px_100px_110px_170px] gap-2 items-center px-3 py-2 border-b border-gray-50 last:border-0">
                                  <span className="min-w-0">
                                    <span className="block text-[11px] font-bold text-gray-900 truncate" title={item.xProd}>{item.xProd}</span>
                                    <span className="block text-[9px] font-semibold text-gray-400">
                                      {item.sugestao && item.status === 'PENDENTE' && (
                                        <span className="text-teal-600">sugestão: {item.sugestao.nome} ({Math.round(item.sugestao.score * 100)}%) · </span>
                                      )}
                                      {item.produtoNome ? <>→ {item.produtoNome}{item.entradaEstoqueEm ? ' · entrou no estoque' : ''}</> : null}
                                    </span>
                                  </span>
                                  <span className="text-center text-[9px] font-mono text-gray-500 leading-tight">{item.cProd || '—'}<br /><span className="text-gray-300">{item.cEAN || 'sem GTIN'}</span></span>
                                  <span className="text-center text-[11px] font-black text-gray-800 whitespace-nowrap">{item.quantidade.toLocaleString('pt-BR')} {item.unidade}</span>
                                  <span className="text-right text-[11px] font-bold text-gray-900 tabular-nums whitespace-nowrap">{fmtBRL(item.valorUnitario)}</span>
                                  <span className="text-center">
                                    <span className={`inline-flex items-center gap-1 text-[8px] font-black px-1.5 py-0.5 rounded-full border ${st.cls}`}>
                                      <span className={`w-1 h-1 rounded-full ${st.dot}`}></span>{st.label}
                                    </span>
                                    {item.ncm && <span className="block text-[8px] font-semibold text-gray-400 mt-0.5">NCM {item.ncm}</span>}
                                  </span>
                                  <span className="flex items-center justify-end gap-1 flex-wrap">
                                    {item.status === 'PENDENTE' && (
                                      <>
                                        {item.sugestao && (
                                          <button
                                            onClick={() => vincularItem(item, item.sugestao!.produtoId, item.sugestao!.nome)}
                                            disabled={busy === item.id}
                                            className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-emerald-600 text-white disabled:opacity-50 active:scale-95"
                                            title={`Vincular à sugestão: ${item.sugestao.nome}`}
                                          >
                                            <i className="fa-solid fa-link"></i> Sugestão
                                          </button>
                                        )}
                                        <button
                                          onClick={() => { setVincItem(item); setVincBusca(''); }}
                                          disabled={busy === item.id}
                                          className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 active:scale-95"
                                        >
                                          <i className="fa-solid fa-magnifying-glass"></i> Buscar
                                        </button>
                                        <button
                                          onClick={() => abrirCriar(item)}
                                          disabled={busy === item.id}
                                          className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-slate-900 text-white disabled:opacity-50 active:scale-95"
                                        >
                                          <i className="fa-solid fa-plus"></i> Criar
                                        </button>
                                        <button
                                          onClick={() => ignorarItem(item)}
                                          disabled={busy === item.id}
                                          className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-white text-gray-400 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 active:scale-95"
                                        >
                                          <i className="fa-solid fa-ban"></i>
                                        </button>
                                      </>
                                    )}
                                    {(item.status === 'VINCULADO' || item.status === 'CRIADO') && (
                                      <>
                                        {temEntrada && !item.entradaEstoqueEm && (
                                          <button
                                            onClick={() => entradaItem(item)}
                                            disabled={busy === item.id}
                                            className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-slate-900 text-white disabled:opacity-50 active:scale-95"
                                          >
                                            <i className="fa-solid fa-plus"></i> Estoque
                                          </button>
                                        )}
                                        <button
                                          onClick={() => reabrirItem(item)}
                                          disabled={busy === item.id}
                                          className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 active:scale-95"
                                          title="Reabrir na fila"
                                        >
                                          <i className="fa-solid fa-rotate-left"></i>
                                        </button>
                                      </>
                                    )}
                                    {item.status === 'IGNORADO' && (
                                      <button
                                        onClick={() => reabrirItem(item)}
                                        disabled={busy === item.id}
                                        className="rounded-lg px-1.5 h-6 text-[8px] font-black uppercase bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 active:scale-95"
                                      >
                                        <i className="fa-solid fa-rotate-left"></i> Reabrir
                                      </button>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <footer className="mt-6 text-center">
          <p className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">
            Portal de Entradas · XMLs de fornecedores → catálogo → estoque · Doce Mania
          </p>
        </footer>
      </main>

      {/* ================= MODAL: CONFIRMAÇÃO (toda ação de estado) ================= */}
      {conf && (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={conf.titulo}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <i className={`fa-solid ${conf.icone} text-lg`}></i>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-black text-gray-900 leading-snug">{conf.titulo}</h2>
                <p className="text-[11px] font-semibold text-gray-500 mt-1 leading-snug">{conf.texto}</p>
                {conf.detalhe && (
                  <p className="text-[10px] font-semibold text-gray-400 mt-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 leading-snug">{conf.detalhe}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setConf(null)} className="flex-1 h-11 rounded-xl bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase tracking-wider active:scale-95">
                Voltar
              </button>
              <button
                onClick={() => { const run = conf.run; setConf(null); void run(); }}
                className="flex-1 h-11 rounded-xl bg-teal-600 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 flex items-center justify-center gap-1.5"
              >
                <i className="fa-solid fa-check"></i>{conf.botao}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: VINCULAR MANUALMENTE ================= */}
      {vincItem && (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Vincular produto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-5 flex flex-col max-h-[85vh]">
            <h2 className="text-sm font-black text-gray-900 flex items-center gap-2"><i className="fa-solid fa-link text-teal-600"></i>Vincular &quot;{vincItem.xProd}&quot;</h2>
            <p className="text-[10px] font-semibold text-gray-400 mt-1">{vincItem.quantidade} {vincItem.unidade} × {fmtBRL(vincItem.valorUnitario)} · {vincItem.emitNome || 'XML de fornecedor'}</p>
            <div className="relative mt-3">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
              <input
                value={vincBusca}
                onChange={e => setVincBusca(e.target.value)}
                placeholder="Buscar produto no catálogo (nome ou EAN)..."
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-100"
                aria-label="Buscar produto"
              />
            </div>
            <div className="mt-3 space-y-1.5 overflow-y-auto max-h-96 flex-1">
              {produtosFiltrados.length === 0 && <p className="text-[11px] font-bold text-gray-400 text-center py-6">Nenhum produto encontrado no catálogo.</p>}
              {produtosFiltrados.map(p => (
                <button
                  key={p.id}
                  onClick={() => { const item = vincItem; setVincItem(null); vincularItem(item, p.id, p.nome); }}
                  className="w-full text-left rounded-xl border border-gray-100 hover:border-teal-300 hover:bg-teal-50/50 px-3 py-2.5 transition-colors flex items-center gap-2"
                >
                  <i className="fa-solid fa-box text-gray-300 text-xs"></i>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold text-gray-900 truncate">{p.nome}</span>
                    {p.ean && <span className="block text-[9px] font-mono text-gray-400">EAN {p.ean}</span>}
                  </span>
                  <i className="fa-solid fa-arrow-right text-gray-300 text-[10px]"></i>
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { const item = vincItem; setVincItem(null); abrirCriar(item); }} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 flex items-center justify-center gap-1.5">
                <i className="fa-solid fa-plus"></i>Criar produto novo
              </button>
              <button onClick={() => setVincItem(null)} className="h-11 px-5 rounded-xl bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase tracking-wider active:scale-95">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: CRIAR PRODUTO ================= */}
      {criandoItem && (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Criar produto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-sm font-black text-gray-900 flex items-center gap-2"><i className="fa-solid fa-plus text-slate-700"></i>Criar produto do XML</h2>
            <p className="text-[10px] font-semibold text-gray-400 mt-1">Dados fiscais (NCM {criandoItem.ncm || '—'}) entram automaticamente no cadastro.</p>
            <div className="space-y-3 mt-4">
              <div>
                <label htmlFor="criar-nome" className="text-[9px] font-black uppercase tracking-wider text-gray-400">Nome do produto</label>
                <input id="criar-nome" value={criandoForm.nome} onChange={e => setCriandoForm(f => ({ ...f, nome: e.target.value }))} className="w-full mt-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-100" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="criar-custo" className="text-[9px] font-black uppercase tracking-wider text-gray-400">Custo (R$)</label>
                  <input id="criar-custo" value={criandoForm.precoCusto} onChange={e => setCriandoForm(f => ({ ...f, precoCusto: e.target.value }))} inputMode="decimal" className="w-full mt-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-100" />
                </div>
                <div>
                  <label htmlFor="criar-venda" className="text-[9px] font-black uppercase tracking-wider text-gray-400">Venda (R$)</label>
                  <input id="criar-venda" value={criandoForm.precoVenda} onChange={e => setCriandoForm(f => ({ ...f, precoVenda: e.target.value }))} inputMode="decimal" className="w-full mt-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-100" />
                </div>
                <div>
                  <label htmlFor="criar-un" className="text-[9px] font-black uppercase tracking-wider text-gray-400">Unidade</label>
                  <input id="criar-un" value={criandoForm.unidade} onChange={e => setCriandoForm(f => ({ ...f, unidade: e.target.value }))} className="w-full mt-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-100 uppercase" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setCriandoItem(null)} className="flex-1 h-11 rounded-xl bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase tracking-wider active:scale-95">Cancelar</button>
              <button onClick={() => void confirmarCriar()} disabled={busy === criandoItem.id} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5">
                {busy === criandoItem.id ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-check"></i>Criar produto</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= TOAST ================= */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[130] w-full max-w-md px-4" role="status">
          <div className={`rounded-2xl px-4 py-3 shadow-2xl text-[11px] font-bold flex items-start gap-2 ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
            <i className={`fa-solid ${toast.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'} mt-0.5`}></i>
            <span className="flex-1 leading-snug">{toast.msg}</span>
            <button onClick={() => setToast(null)} aria-label="Fechar aviso"><i className="fa-solid fa-xmark opacity-70"></i></button>
          </div>
        </div>
      )}
    </div>
  );
}
