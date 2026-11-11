"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Product } from '@/lib/types';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 95 — FISCAL: XML → PRODUTOS (aba do ADMIN)
 *
 * A fila de sincronizacao do cadastro fiscal pedida pelo dono:
 *   "todos os produtos tem que vir das XML importadas! e assim sincronizar
 *    com os que ja existem! seria uma boa ideia criar uma aba de produtos
 *    vindo da xml ate integrar tudo!"
 *
 * Fluxo: sobe os XMLs de compra (arquivo .xml do PC/pen drive) → itens viram
 * FILA com sugestao de produto (EAN igual ou nome parecido) → VINCULAR
 * (completa NCM/EAN/unidade do produto onde estiver vazio), CRIAR PRODUTO
 * novo ou IGNORAR. NADA do fluxo de venda muda — vendedores em rota seguem
 * vendendo (pronta entrega e pre-venda) exatamente como sempre.
 *
 * Painel SPEDY: status da integracao (API key, ambiente, certificado A1 com
 * validade, notas recebidas DFe) + acoes de teste/sincronizacao/importacao
 * das notas recebidas — a fonte automatica que substitui o upload manual.
 */

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

interface DadosImportacao {
  ok: boolean;
  importacoes: Importacao[];
  stats: { PENDENTE: number; VINCULADO: number; CRIADO: number; IGNORADO: number };
  catalogo: { total: number; comNcm: number; comEan: number };
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

interface EstadoSpedy {
  configurado: boolean;
  ambiente: string;
  baseUrl: string;
  backofficeUrl: string;
  empresaId: string;
  conectado: boolean | null;
  mensagem?: string;
  erro?: string;
  empresas?: { id: string; nome: string; cnpj: string }[];
  certificado?: {
    subject: string;
    issuer: string;
    expirationAt: string;
    diasParaVencer: number | null;
    isActive: boolean;
  } | null;
  inbound?: { habilitado: boolean | null; motivo?: string; rateLimit?: boolean };
}

interface FiscalXmlProps {
  products: Product[];
  showToast: (message: string, type?: 'success' | 'error') => void;
  /** refresh do catalogo pai (AdminDashboard) apos criar produtos novos */
  onProdutoCriado?: () => void;
}

type SubAba = 'FILA' | 'VINCULADOS' | 'CRIADOS' | 'IGNORADOS' | 'NOTAS';

const fmtBRL = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

const scoreCor = (s: number) =>
  s >= 0.9 ? 'bg-emerald-500' : s >= 0.7 ? 'bg-teal-500' : s >= 0.55 ? 'bg-amber-500' : 'bg-gray-300';

const StatCard: React.FC<{ label: string; valor: React.ReactNode; cor: string; icone: string }> = ({ label, valor, cor, icone }) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cor}`}>
      <i className={`fa-solid ${icone}`} />
    </div>
    <div className="min-w-0">
      <div className="text-xl font-black text-gray-900 leading-tight">{valor}</div>
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">{label}</div>
    </div>
  </div>
);

const FiscalXml: React.FC<FiscalXmlProps> = ({ products, showToast, onProdutoCriado }) => {
  const [dados, setDados] = useState<DadosImportacao | null>(null);
  const [spedy, setSpedy] = useState<EstadoSpedy | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [subAba, setSubAba] = useState<SubAba>('FILA');
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [busca, setBusca] = useState('');

  const [subindo, setSubindo] = useState(false);
  const [resultadoUpload, setResultadoUpload] = useState<{ importadas: number; duplicadas: number; itens: number; erros: { nome: string; motivo: string }[] } | null>(null);
  const inputXmlRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  const [criandoId, setCriandoId] = useState<string | null>(null);
  const [criandoForm, setCriandoForm] = useState({ nome: '', precoCusto: '', precoVenda: '', unidade: 'UN' });
  const [trocandoId, setTrocandoId] = useState<string | null>(null);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [processando, setProcessando] = useState<string | null>(null);
  // BLOCO 95.1: entrada de estoque liberada so com o SQL 95.1 rodado (a API avisa)
  const [temEntrada, setTemEntrada] = useState(false);

  const [spedyAberto, setSpedyAberto] = useState(false);
  const [spedyOcupado, setSpedyOocupado] = useState<string | null>(null);
  const inputPfxRef = useRef<HTMLInputElement>(null);
  const [senhaCert, setSenhaCert] = useState('');
  const [pfxNome, setPfxNome] = useState('');
  const [pfxB64, setPfxB64] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [rDados, rSpedy] = await Promise.all([
        fetch('/api/xml-importacao', { headers: authHeaders(), cache: 'no-store' }),
        fetch('/api/spedy', { headers: authHeaders(), cache: 'no-store' }),
      ]);
      const d = await rDados.json().catch(() => null);
      const s = await rSpedy.json().catch(() => null);
      if (rDados.status === 503 && d?.erro) {
        setErro(String(d.erro));
        setDados(null);
      } else if (!rDados.ok || !d?.ok) {
        setErro(d?.erro || 'Não foi possível carregar as importações XML.');
      } else {
        setDados(d as DadosImportacao);
      }
      if (rSpedy.ok && s?.ok && s?.estado) setSpedy(s.estado as EstadoSpedy);
    } catch {
      setErro('Sem conexão. Verifique a internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const statusDeAba = (aba: SubAba): string => {
    switch (aba) {
      case 'FILA': return 'PENDENTE';
      case 'VINCULADOS': return 'VINCULADO';
      case 'CRIADOS': return 'CRIADO';
      case 'IGNORADOS': return 'IGNORADO';
      default: return 'TODOS';
    }
  };

  const carregarItens = useCallback(async (aba: SubAba) => {
    setCarregandoItens(true);
    try {
      const st = statusDeAba(aba);
      const res = await fetch(`/api/xml-importacao/itens?status=${st}&limit=300`, { headers: authHeaders(), cache: 'no-store' });
      const d = await res.json().catch(() => null);
      setItens(res.ok && d?.ok ? (d.itens as ItemFila[]) : []);
      setTemEntrada(!!d?.temEntrada);
      if (!res.ok && d?.erro && d.erro.includes('bloco95')) setErro(String(d.erro));
    } catch {
      setItens([]);
      setTemEntrada(false);
    } finally {
      setCarregandoItens(false);
    }
  }, []);

  useEffect(() => { if (subAba !== 'NOTAS') carregarItens(subAba); }, [subAba, carregarItens]);

  // ---------- UPLOAD ----------
  const importarArquivos = useCallback(async (files: FileList | File[]) => {
    const lista = Array.from(files).filter((f) => /\.xml$/i.test(f.name) || f.type.includes('xml'));
    if (lista.length === 0) {
      showToast('Selecione arquivos .xml de notas de compra.', 'error');
      return;
    }
    setSubindo(true);
    setResultadoUpload(null);
    try {
      const arquivos = await Promise.all(lista.slice(0, 60).map(async (f) => ({
        nome: f.name,
        conteudo: await f.text(),
      })));
      const res = await fetch('/api/xml-importacao', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivos }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast(d?.erro || 'Falha na importação dos XMLs.', 'error');
        return;
      }
      const r = d.resumo;
      setResultadoUpload({ importadas: r.importadas, duplicadas: r.duplicadas, itens: r.itens, erros: r.erros || [] });
      const partes: string[] = [];
      if (r.importadas > 0) partes.push(`${r.importadas} nota(s) importada(s)`);
      if (r.itens > 0) partes.push(`${r.itens} produtos na fila`);
      if (r.duplicadas > 0) partes.push(`${r.duplicadas} já existente(s)`);
      if ((r.erros || []).length > 0) partes.push(`${r.erros.length} com erro`);
      showToast(partes.length ? partes.join(' • ') : 'Nada para importar.', (r.erros || []).length > 0 && r.importadas === 0 ? 'error' : 'success');
      await carregar();
      if (subAba !== 'NOTAS') await carregarItens(subAba);
    } catch {
      showToast('Falha lendo os arquivos XML.', 'error');
    } finally {
      setSubindo(false);
      if (inputXmlRef.current) inputXmlRef.current.value = '';
    }
  }, [showToast, carregar, carregarItens, subAba]);

  // ---------- ACOES DA FILA ----------
  const acaoItem = useCallback(async (body: Record<string, unknown>, msgOk: string) => {
    setProcessando(String(body.itemId || 'LOTE'));
    try {
      const res = await fetch('/api/xml-importacao/itens', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast(d?.erro || 'Ação falhou.', 'error');
        return false;
      }
      showToast(msgOk, 'success');
      await carregar();
      await carregarItens(subAba);
      return true;
    } catch {
      showToast('Sem conexão para a ação.', 'error');
      return false;
    } finally {
      setProcessando(null);
    }
  }, [showToast, carregar, carregarItens, subAba]);

  const vincular = (item: ItemFila, produtoId: string, nomeProduto: string) =>
    acaoItem({ acao: 'VINCULAR', itemId: item.id, produtoId }, `Vinculado a ${nomeProduto} — cadastro fiscal completado.`);

  const ignorar = (item: ItemFila) =>
    acaoItem({ acao: 'IGNORAR', itemId: item.id }, 'Item ignorado.');

  const reabrir = (item: ItemFila) =>
    acaoItem({ acao: 'REABRIR', itemId: item.id }, 'Item devolvido para a fila.');

  const abrirCriar = (item: ItemFila) => {
    setCriandoId(item.id);
    const custo = item.valorUnitario.toFixed(2).replace('.', ',');
    const vendaSugerida = (item.valorUnitario * 2).toFixed(2).replace('.', ',');
    setCriandoForm({ nome: item.xProd, precoCusto: custo, precoVenda: vendaSugerida, unidade: item.unidade || 'UN' });
    setTrocandoId(null);
  };

  const confirmarCriar = async () => {
    if (!criandoId) return;
    const precoVenda = Number(criandoForm.precoVenda.replace(',', '.'));
    const precoCusto = Number(criandoForm.precoCusto.replace(',', '.'));
    if (!criandoForm.nome.trim()) { showToast('Informe o nome do produto.', 'error'); return; }
    if (!Number.isFinite(precoVenda) || precoVenda <= 0) { showToast('Preço de venda inválido.', 'error'); return; }
    const ok = await acaoItem({
      acao: 'CRIAR',
      itemId: criandoId,
      produto: {
        nome: criandoForm.nome.trim(),
        precoVenda,
        precoCusto: Number.isFinite(precoCusto) && precoCusto > 0 ? precoCusto : undefined,
        unidade: criandoForm.unidade.trim().toUpperCase() || 'UN',
      },
    }, 'Produto criado no catálogo com dados fiscais da XML.');
    if (ok) {
      setCriandoId(null);
      onProdutoCriado?.();
    }
  };

  const vincularSugestoes = async () => {
    setProcessando('LOTE');
    try {
      const res = await fetch('/api/xml-importacao/itens', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'VINCULAR_SUGESTOES' }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { showToast(d?.erro || 'Lote falhou.', 'error'); return; }
      showToast(`Vinculados por sugestão certa: ${d.vinculados}${(d.falhas || []).length ? ` • ${d.falhas.length} falha(s)` : ''}.`, 'success');
      await carregar();
      await carregarItens(subAba);
    } catch {
      showToast('Sem conexão para o lote.', 'error');
    } finally {
      setProcessando(null);
    }
  };

  // ---------- BLOCO 95.1: ENTRADA DE ESTOQUE ----------
  const darEntrada = async (item: ItemFila) => {
    setProcessando(item.id);
    try {
      const res = await fetch('/api/xml-importacao/itens', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'ENTRADA_ESTOQUE', itemId: item.id }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { showToast(d?.erro || 'Entrada falhou.', 'error'); return; }
      const saldo = d.saldo != null ? ` — saldo agora: ${Number(d.saldo).toLocaleString('pt-BR')} un` : '';
      showToast(`Estoque entrou! +${item.quantidade} ${item.unidade}${saldo}${d.aviso ? ' ⚠ ' + d.aviso : ''}`, 'success');
      await carregarItens(subAba);
    } catch {
      showToast('Sem conexão para a entrada.', 'error');
    } finally {
      setProcessando(null);
    }
  };

  const darEntradaLote = async () => {
    const alvos = itens.filter((i) => i.produtoId && !i.entradaEstoqueEm);
    if (alvos.length === 0) { showToast('Nenhum item desta lista sem entrada.', 'error'); return; }
    if (!window.confirm(`Dar entrada no estoque de ${alvos.length} item(ns)?\n\nQuantidades da nota somam no estoque central (custo = valor da nota).`)) return;
    setProcessando('LOTE_ENTRADA');
    try {
      const res = await fetch('/api/xml-importacao/itens', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'ENTRADA_LOTE' }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { showToast(d?.erro || 'Lote de entrada falhou.', 'error'); return; }
      showToast(`Entradas feitas: ${d.entradas}${(d.falhas || []).length ? ` • ${d.falhas.length} falha(s)` : ''}${d.aviso ? ' ⚠ ' + d.aviso : ''}`, (d.falhas || []).length ? 'error' : 'success');
      await carregarItens(subAba);
    } catch {
      showToast('Sem conexão para o lote de entrada.', 'error');
    } finally {
      setProcessando(null);
    }
  };

  // ---------- SPEDY ----------
  const acaoSpedy = useCallback(async (body: Record<string, unknown>, msgPadrao: string) => {
    setSpedyOcupado(String(body.acao));
    try {
      const res = await fetch('/api/spedy', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast(d?.erro || 'Ação Spedy falhou.', 'error');
        return;
      }
      if (d.estado) setSpedy(d.estado as EstadoSpedy);
      if (d.certificado) {
        setSpedy((prev) => prev ? { ...prev, certificado: d.certificado } : prev);
      }
      showToast(d.mensagem || msgPadrao, 'success');
      if (body.acao === 'IMPORTAR_INBOUND') {
        await carregar();
        if (subAba !== 'NOTAS') await carregarItens(subAba);
      }
    } catch {
      showToast('Sem conexão com o servidor.', 'error');
    } finally {
      setSpedyOocupado(null);
    }
  }, [showToast, carregar, carregarItens, subAba]);

  const selecionarPfx = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.pfx$|\.p12$/i.test(f.name)) { showToast('Selecione o arquivo .pfx do certificado A1.', 'error'); return; }
    const buf = await f.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    setPfxB64(btoa(bin));
    setPfxNome(f.name);
  };

  const enviarCertificado = () => {
    if (!pfxB64) { showToast('Selecione o arquivo .pfx primeiro.', 'error'); return; }
    if (!senhaCert) { showToast('Informe a senha do certificado.', 'error'); return; }
    acaoSpedy({ acao: 'ENVIAR_CERTIFICADO', arquivoBase64: pfxB64, senha: senhaCert, nomeArquivo: pfxNome }, 'Certificado enviado.');
    setSenhaCert('');
    setPfxB64('');
    setPfxNome('');
    if (inputPfxRef.current) inputPfxRef.current.value = '';
  };

  // ---------- RENDER ----------
  const stats = dados?.stats || { PENDENTE: 0, VINCULADO: 0, CRIADO: 0, IGNORADO: 0 };
  const totalItens = stats.PENDENTE + stats.VINCULADO + stats.CRIADO + stats.IGNORADO;
  const resolvidos = stats.VINCULADO + stats.CRIADO + stats.IGNORADO;
  const pctFila = totalItens > 0 ? Math.round((resolvidos / totalItens) * 100) : 0;
  const cat = dados?.catalogo || { total: 0, comNcm: 0, comEan: 0 };
  const pctNcm = cat.total > 0 ? Math.round((cat.comNcm / cat.total) * 100) : 0;

  const itensFiltrados = busca.trim()
    ? itens.filter((i) => `${i.xProd} ${i.cProd} ${i.emitNome} ${i.ncm}`.toLowerCase().includes(busca.trim().toLowerCase()))
    : itens;

  const produtosFiltrados = buscaProduto.trim()
    ? products.filter((p) => p.nome.toLowerCase().includes(buscaProduto.trim().toLowerCase())).slice(0, 30)
    : products.slice(0, 30);

  const certDias = spedy?.certificado?.diasParaVencer ?? null;
  const certCor = certDias == null ? 'text-gray-500' : certDias < 0 ? 'text-rose-600' : certDias <= 30 ? 'text-amber-600' : 'text-emerald-600';

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <i className="fa-solid fa-file-code text-teal-600" /> XML → Produtos
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Cadastro fiscal migrado pelas notas de compra — sem mexer no fluxo de venda.
          </p>
        </div>
        <button
          onClick={() => setSpedyAberto((v) => !v)}
          className={`px-3 h-9 rounded-xl text-xs font-bold flex items-center gap-2 border transition-colors flex-shrink-0 ${
            spedy?.configurado
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          <i className={`fa-solid ${spedy?.configurado ? 'fa-plug-circle-check' : 'fa-plug-circle-exclamation'}`} />
          SPEDY {spedy?.ambiente === 'producao' ? 'PROD' : spedy?.configurado ? 'SANDBOX' : ''}
          <i className={`fa-solid fa-chevron-${spedyAberto ? 'up' : 'down'} text-[10px]`} />
        </button>
      </div>

      {/* Painel Spedy */}
      {spedyAberto && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-bolt text-teal-600" />
            <span className="font-bold text-sm text-gray-900">Integração Spedy</span>
            {spedy?.conectado === true && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">CONECTADO</span>}
            {spedy?.conectado === false && <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">SEM CONEXÃO</span>}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded-xl p-2.5">
              <div className="text-gray-500 font-semibold uppercase text-[10px]">Ambiente</div>
              <div className="font-bold text-gray-900">{spedy?.ambiente || 'sandbox'}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <div className="text-gray-500 font-semibold uppercase text-[10px]">Empresa (ID)</div>
              <div className="font-bold text-gray-900 truncate">{spedy?.empresaId || '—'}</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <div className="text-gray-500 font-semibold uppercase text-[10px]">Certificado A1</div>
              {spedy?.certificado ? (
                <div className={`font-bold ${certCor}`}>
                  {certDias != null && certDias < 0 ? 'EXPIRADO' : `${certDias ?? '?'} dias`}
                  <span className="block text-[10px] font-medium text-gray-500 truncate">
                    {spedy.certificado.subject?.slice(0, 28) || '—'}
                  </span>
                </div>
              ) : (
                <div className="font-bold text-gray-500">não enviado</div>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <div className="text-gray-500 font-semibold uppercase text-[10px]">Notas recebidas (DFe)</div>
              <div className="font-bold text-gray-900">
                {spedy?.inbound?.habilitado === true ? 'ligado' : spedy?.inbound?.habilitado === false ? 'plano sem recurso' : '—'}
              </div>
            </div>
          </div>

          {spedy?.mensagem && <p className="text-xs text-gray-500">{spedy.mensagem}</p>}
          {spedy?.erro && <p className="text-xs text-rose-600 font-semibold">{spedy.erro}</p>}
          {spedy?.inbound?.motivo && <p className="text-xs text-amber-600">{spedy.inbound.motivo}</p>}

          {spedy?.configurado ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => acaoSpedy({ acao: 'TESTAR' }, 'Conexão testada.')}
                disabled={!!spedyOcupado}
                className="px-3 h-9 rounded-xl bg-teal-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {spedyOcupado === 'TESTAR' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-plug" />} Testar conexão
              </button>
              <button
                onClick={() => acaoSpedy({ acao: 'SINCRONIZAR' }, 'Sincronização solicitada.')}
                disabled={!!spedyOcupado}
                className="px-3 h-9 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {spedyOcupado === 'SINCRONIZAR' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-rotate" />} Buscar notas na SEFAZ
              </button>
              <button
                onClick={() => acaoSpedy({ acao: 'IMPORTAR_INBOUND' }, 'Notas recebidas importadas para a fila.')}
                disabled={!!spedyOcupado}
                className="px-3 h-9 rounded-xl bg-gray-900 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {spedyOcupado === 'IMPORTAR_INBOUND' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-cloud-arrow-down" />} Importar recebidas p/ fila
              </button>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-1">
              <p className="font-bold">Checklist para ligar (30 min):</p>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>Criar conta no <b>sandbox</b> da Spedy (plano Desenvolvedor, grátis): <span className="font-mono text-[10px]">sandbox-app.spedy.com.br</span></li>
                <li>Gerar a <b>API key</b> e configurar <span className="font-mono text-[10px]">SPEDY_API_KEY</span> na Vercel</li>
                <li>Cadastrar a empresa emissora (CNPJ) e subir o <b>certificado A1</b> (.pfx) abaixo</li>
                <li>Ligar as <b>notas recebidas</b> (DFe) na empresa — as compras passam a chegar sozinhas</li>
                <li>Falar com o contador: CSC da NFC-e + credenciamento RS</li>
              </ol>
            </div>
          )}

          {spedy?.configurado && (
            <div className="border-t border-dashed border-gray-200 pt-3">
              <p className="text-[11px] font-bold text-gray-500 uppercase mb-2">Enviar certificado A1 (.pfx) — a Spedy assina por você</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={inputPfxRef}
                  type="file"
                  accept=".pfx,.p12"
                  onChange={(e) => selecionarPfx(e.target.files?.[0])}
                  className="text-xs text-gray-500 file:mr-2 file:px-3 file:h-9 file:rounded-xl file:border-0 file:bg-gray-100 file:text-gray-700 file:text-xs file:font-bold"
                />
                <input
                  type="password"
                  value={senhaCert}
                  onChange={(e) => setSenhaCert(e.target.value)}
                  placeholder="Senha do certificado"
                  className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-gray-200 text-xs"
                />
                <button
                  onClick={enviarCertificado}
                  disabled={!!spedyOcupado}
                  className="px-4 h-9 rounded-xl bg-amber-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
                >
                  {spedyOcupado === 'ENVIAR_CERTIFICADO' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-shield-halved" />} Enviar
                </button>
              </div>
              {pfxNome && <p className="text-[11px] text-gray-500 mt-1">Arquivo: {pfxNome}</p>}
              {spedy?.empresas && spedy.empresas.length > 0 && (
                <div className="mt-2 text-[11px] text-gray-500">
                  Empresas da conta: {spedy.empresas.map((e) => `${e.nome} (${e.cnpj})`).join(' • ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Erro de banco */}
      {erro && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
          <i className="fa-solid fa-database text-rose-500 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-rose-700">Fila fiscal indisponível</p>
            <p className="text-xs text-rose-600 mt-0.5">{erro}</p>
          </div>
          <button onClick={carregar} className="px-3 h-8 rounded-lg bg-rose-600 text-white text-xs font-bold">Tentar novamente</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-2xl" />)}
          </div>
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Notas importadas" valor={dados?.importacoes.length ?? 0} cor="bg-teal-50 text-teal-600" icone="fa-file-invoice" />
            <StatCard label="Na fila" valor={stats.PENDENTE} cor="bg-amber-50 text-amber-600" icone="fa-hourglass-half" />
            <StatCard label="Vinculados" valor={stats.VINCULADO} cor="bg-emerald-50 text-emerald-600" icone="fa-link" />
            <StatCard label="Criados" valor={stats.CRIADO} cor="bg-gray-900 text-white" icone="fa-plus" />
            <StatCard label="Ignorados" valor={stats.IGNORADO} cor="bg-gray-100 text-gray-500" icone="fa-ban" />
          </div>

          {/* Progresso */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-bold text-gray-700">
                Migração da fila: <span className="text-teal-600">{pctFila}%</span>
                <span className="text-gray-400 font-medium"> ({resolvidos}/{totalItens} itens)</span>
              </span>
              <span className="font-bold text-gray-700">
                Produtos com NCM: <span className={pctNcm >= 80 ? 'text-emerald-600' : pctNcm >= 40 ? 'text-amber-600' : 'text-rose-600'}>{pctNcm}%</span>
                <span className="text-gray-400 font-medium"> ({cat.comNcm}/{cat.total})</span>
              </span>
            </div>
            <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${(stats.VINCULADO / Math.max(1, totalItens)) * 100}%` }} />
              <div className="h-full bg-gray-800 transition-all duration-700" style={{ width: `${(stats.CRIADO / Math.max(1, totalItens)) * 100}%` }} />
              <div className="h-full bg-gray-300 transition-all duration-700" style={{ width: `${(stats.IGNORADO / Math.max(1, totalItens)) * 100}%` }} />
            </div>
            <div className="flex gap-3 mt-2 text-[10px] font-semibold text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> vinculado</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-800" /> criado</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> ignorado</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> na fila</span>
            </div>
          </div>

          {/* Upload */}
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); importarArquivos(e.dataTransfer.files); }}
            className={`rounded-2xl border-2 border-dashed p-4 text-center transition-colors ${
              arrastando ? 'border-teal-400 bg-teal-50' : 'border-gray-200 bg-white'
            }`}
          >
            <i className="fa-solid fa-file-arrow-up text-2xl text-teal-500" />
            <p className="text-sm font-bold text-gray-800 mt-1">Arraste os XMLs de compra aqui</p>
            <p className="text-[11px] text-gray-500">Arquivos .xml das NF-e dos fornecedores (pen drive / pasta do contador)</p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <input
                ref={inputXmlRef}
                type="file"
                multiple
                accept=".xml"
                onChange={(e) => e.target.files && importarArquivos(e.target.files)}
                className="hidden"
              />
              <button
                onClick={() => inputXmlRef.current?.click()}
                disabled={subindo}
                className="px-4 h-10 rounded-xl bg-teal-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
              >
                {subindo ? <><i className="fa-solid fa-spinner fa-spin" /> Importando…</> : <><i className="fa-solid fa-folder-open" /> Selecionar XMLs</>}
              </button>
              {stats.PENDENTE > 0 && (
                <button
                  onClick={vincularSugestoes}
                  disabled={!!processando}
                  className="px-4 h-10 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-2"
                >
                  {processando === 'LOTE' ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-wand-magic-sparkles" />}
                  Vincular sugestões certas
                </button>
              )}
            </div>
            {resultadoUpload && (
              <div className="mt-3 text-left bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1">
                <p className="font-bold text-gray-800">
                  <i className="fa-solid fa-circle-check text-emerald-500" /> {resultadoUpload.importadas} nota(s) importada(s) • {resultadoUpload.itens} produtos na fila
                  {resultadoUpload.duplicadas > 0 && <> • {resultadoUpload.duplicadas} duplicada(s) pulada(s)</>}
                </p>
                {resultadoUpload.erros.length > 0 && (
                  <ul className="list-disc ml-4 text-rose-600">
                    {resultadoUpload.erros.slice(0, 6).map((e, i) => (
                      <li key={i}><b>{e.nome}</b>: {e.motivo}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Sub abas */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {([
              ['FILA', `Fila (${stats.PENDENTE})`],
              ['VINCULADOS', `Vinculados (${stats.VINCULADO})`],
              ['CRIADOS', `Criados (${stats.CRIADO})`],
              ['IGNORADOS', `Ignorados (${stats.IGNORADO})`],
              ['NOTAS', `Notas (${dados?.importacoes.length ?? 0})`],
            ] as [SubAba, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setSubAba(id); setBusca(''); }}
                className={`px-3 h-9 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                  subAba === id ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {subAba !== 'NOTAS' && (
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto, código, NCM ou fornecedor…"
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 text-sm"
              />
            </div>
          )}

          {/* BLOCO 95.1: entrada da NOTA INTEIRA 1 clique (vinculados/criados sem entrada) */}
          {(subAba === 'VINCULADOS' || subAba === 'CRIADOS') && temEntrada && (() => {
            const semEntrada = itens.filter((i) => i.produtoId && !i.entradaEstoqueEm).length;
            if (semEntrada === 0) return null;
            return (
              <button
                onClick={darEntradaLote}
                disabled={processando === 'LOTE_ENTRADA'}
                className="w-full py-3 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wide shadow-md active:scale-[0.99] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <i className={`fa-solid ${processando === 'LOTE_ENTRADA' ? 'fa-spinner fa-spin' : 'fa-truck-ramp-box'}`} />
                Dar entrada no estoque — {semEntrada} item(ns) da nota
              </button>
            );
          })()}

          {/* NOTAS: importacoes */}
          {subAba === 'NOTAS' && (
            <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
              {(dados?.importacoes || []).length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                  <i className="fa-solid fa-inbox text-3xl text-gray-200" />
                  <p className="text-sm font-bold text-gray-500 mt-2">Nenhuma nota importada ainda</p>
                  <p className="text-xs text-gray-400">Suba o primeiro XML de compra acima.</p>
                </div>
              )}
              {(dados?.importacoes || []).map((imp) => (
                <div key={imp.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center flex-shrink-0">
                    <i className={`fa-solid ${imp.origem === 'SPEDY_INBOUND' ? 'fa-cloud-arrow-down' : 'fa-file-invoice'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 truncate">{imp.emitNome || 'Emitente desconhecido'}</p>
                    <p className="text-[11px] text-gray-500">
                      NF {imp.numero || '—'} • {fmtData(imp.dataEmissao)} • {imp.qtdItens} itens
                      {imp.qtdPendentes > 0 && <span className="text-amber-600 font-bold"> • {imp.qtdPendentes} na fila</span>}
                    </p>
                    <p className="text-[10px] text-gray-300 font-mono truncate">{imp.chave.slice(0, 25)}…</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-black text-gray-900">{fmtBRL(imp.valorTotal)}</p>
                    {imp.origem === 'SPEDY_INBOUND' && <span className="text-[9px] font-bold bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">SPEDY DFe</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* FILA / VINCULADOS / CRIADOS / IGNORADOS: itens */}
          {subAba !== 'NOTAS' && (
            <div className="space-y-3 max-h-[36rem] overflow-y-auto pr-1">
              {carregandoItens && itens.length === 0 && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <div key={i} className="h-36 bg-gray-100 rounded-2xl animate-pulse" />)}
                </div>
              )}
              {!carregandoItens && itensFiltrados.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                  <i className="fa-solid fa-clipboard-check text-3xl text-emerald-200" />
                  <p className="text-sm font-bold text-gray-500 mt-2">
                    {subAba === 'FILA' ? 'Fila vazia — tudo sincronizado!' : 'Nada aqui ainda.'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {subAba === 'FILA' ? 'Importe mais XMLs ou aguarde as notas chegarem pela Spedy.' : 'Os itens resolvidos aparecem nesta lista.'}
                  </p>
                </div>
              )}
              {itensFiltrados.map((item) => (
                <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 leading-snug">{item.xProd}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                        cód {item.cProd || '—'} • {item.quantidade.toLocaleString('pt-BR')} {item.unidade} × {fmtBRL(item.valorUnitario)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-black text-gray-900">{fmtBRL(item.valorTotal)}</p>
                      <p className="text-[10px] text-gray-400">{item.emitNome || '—'} • {fmtData(item.dataEmissao)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {item.ncm ? (
                      <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">NCM {item.ncm}</span>
                    ) : (
                      <span className="text-[10px] font-bold bg-rose-50 text-rose-500 px-2 py-1 rounded-lg">SEM NCM</span>
                    )}
                    {item.cEAN ? (
                      <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">EAN {item.cEAN}</span>
                    ) : (
                      <span className="text-[10px] font-bold bg-gray-50 text-gray-400 px-2 py-1 rounded-lg">sem GTIN</span>
                    )}
                    {item.cfop && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">CFOP {item.cfop} (entrada)</span>}
                    {item.cstIcms && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded-lg">CST {item.cstIcms}</span>}
                    {item.cest && <span className="text-[10px] font-bold bg-violet-50 text-violet-600 px-2 py-1 rounded-lg" title="CEST da nota de compra — completa o cadastro na vinculação">CEST {item.cest}</span>}
                  </div>

                  {/* Status resolvido */}
                  {item.status !== 'PENDENTE' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl p-2.5">
                        <p className="text-xs text-gray-600 min-w-0">
                          {item.status === 'VINCULADO' && <><i className="fa-solid fa-link text-emerald-500" /> <b>Vinculado</b> a {item.produtoNome || '—'} • NCM/EAN/CEST completados</>}
                          {item.status === 'CRIADO' && <><i className="fa-solid fa-plus text-gray-700" /> <b>Criado</b>: {item.produtoNome || '—'} • no catálogo com dados fiscais</>}
                          {item.status === 'IGNORADO' && <><i className="fa-solid fa-ban text-gray-400" /> Ignorado</>}
                        </p>
                        <button
                          onClick={() => reabrir(item)}
                          disabled={processando === item.id}
                          className="px-2.5 h-7 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-600 disabled:opacity-50 flex-shrink-0"
                        >
                          Reabrir
                        </button>
                      </div>
                      {/* BLOCO 95.1: ENTRADA DE ESTOQUE (item vinculado/criado) */}
                      {(item.status === 'VINCULADO' || item.status === 'CRIADO') && temEntrada && (
                        item.entradaEstoqueEm ? (
                          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-2.5">
                            <i className="fa-solid fa-circle-check text-emerald-600" />
                            <p className="text-xs font-bold text-emerald-700 min-w-0 flex-1">
                              Estoque entrou: +{item.quantidade} {item.unidade} (custo {fmtBRL(item.valorUnitario)})
                              <span className="block text-[10px] font-semibold text-emerald-500">
                                {new Date(item.entradaEstoqueEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — não entra 2x
                              </span>
                            </p>
                          </div>
                        ) : (
                          <button
                            onClick={() => darEntrada(item)}
                            disabled={processando === item.id}
                            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wide shadow-sm active:scale-[0.98] transition-transform disabled:opacity-60"
                          >
                            <i className={`fa-solid ${processando === item.id ? 'fa-spinner fa-spin' : 'fa-truck-ramp-box'} mr-1.5`} />
                            Dar entrada no estoque — +{item.quantidade} {item.unidade}
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {/* Sugestao + acoes (fila) */}
                  {item.status === 'PENDENTE' && (
                    <div className="mt-3 space-y-2.5">
                      {item.sugestao && (
                        <button
                          onClick={() => vincular(item, item.sugestao!.produtoId, item.sugestao!.nome)}
                          disabled={processando === item.id}
                          className="w-full text-left bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 disabled:opacity-50 group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-emerald-700 uppercase">Sugestão {Math.round(item.sugestao.score * 100)}%</span>
                            <span className="text-[10px] font-bold text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white px-2 py-0.5 rounded-md transition-colors">
                              VINCULAR
                            </span>
                          </div>
                          <p className="text-xs font-bold text-gray-800 mt-0.5">{item.sugestao.nome}</p>
                          <div className="h-1.5 w-full bg-emerald-100 rounded-full overflow-hidden mt-1">
                            <div className={`h-full rounded-full ${scoreCor(item.sugestao.score)}`} style={{ width: `${item.sugestao.score * 100}%` }} />
                          </div>
                        </button>
                      )}

                      {trocandoId === item.id ? (
                        <div className="bg-gray-50 rounded-xl p-2.5 space-y-2">
                          <div className="relative">
                            <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 text-[10px]" />
                            <input
                              autoFocus
                              value={buscaProduto}
                              onChange={(e) => setBuscaProduto(e.target.value)}
                              placeholder="Buscar produto do catálogo…"
                              className="w-full h-9 pl-7 pr-3 rounded-lg border border-gray-200 text-xs"
                            />
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {produtosFiltrados.map((p) => (
                              <button
                                key={p.id}
                                onClick={async () => {
                                  const ok = await vincular(item, p.id, p.nome);
                                  if (ok) { setTrocandoId(null); setBuscaProduto(''); }
                                }}
                                className="w-full text-left px-2.5 h-9 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-teal-400 truncate"
                              >
                                {p.nome} {p.ncm ? <span className="text-[9px] text-gray-400">NCM {p.ncm}</span> : <span className="text-[9px] text-rose-400">sem NCM</span>}
                              </button>
                            ))}
                            {produtosFiltrados.length === 0 && (
                              <p className="text-[11px] text-gray-400 text-center py-2">Nenhum produto encontrado — crie novo abaixo.</p>
                            )}
                          </div>
                          <button onClick={() => { setTrocandoId(null); setBuscaProduto(''); }} className="w-full h-8 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-500">
                            Cancelar
                          </button>
                        </div>
                      ) : criandoId === item.id ? (
                        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                          <p className="text-[10px] font-bold text-gray-500 uppercase">Criar produto no catálogo</p>
                          <input
                            value={criandoForm.nome}
                            onChange={(e) => setCriandoForm((f) => ({ ...f, nome: e.target.value }))}
                            placeholder="Nome do produto"
                            className="w-full h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold"
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 uppercase">Custo</label>
                              <input
                                value={criandoForm.precoCusto}
                                onChange={(e) => setCriandoForm((f) => ({ ...f, precoCusto: e.target.value }))}
                                inputMode="decimal"
                                className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 uppercase">Venda *</label>
                              <input
                                value={criandoForm.precoVenda}
                                onChange={(e) => setCriandoForm((f) => ({ ...f, precoVenda: e.target.value }))}
                                inputMode="decimal"
                                className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-bold text-gray-400 uppercase">Un</label>
                              <input
                                value={criandoForm.unidade}
                                onChange={(e) => setCriandoForm((f) => ({ ...f, unidade: e.target.value }))}
                                className="w-full h-9 px-2 rounded-lg border border-gray-200 text-xs uppercase"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={confirmarCriar} disabled={processando === item.id} className="flex-1 h-9 rounded-lg bg-gray-900 text-white text-xs font-bold disabled:opacity-50">
                              {processando === item.id ? 'Criando…' : 'Confirmar criação'}
                            </button>
                            <button onClick={() => setCriandoId(null)} className="px-3 h-9 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-500">
                              Cancelar
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-400">
                            NCM/EAN da XML entram automaticamente. Estoque inicial 0 — a entrada de estoque segue o fluxo normal.
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setTrocandoId(item.id)}
                            className="px-3 h-8 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-600"
                          >
                            <i className="fa-solid fa-right-left mr-1" />Escolher produto
                          </button>
                          <button
                            onClick={() => abrirCriar(item)}
                            className="px-3 h-8 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-600"
                          >
                            <i className="fa-solid fa-plus mr-1" />Criar produto
                          </button>
                          <button
                            onClick={() => ignorar(item)}
                            disabled={processando === item.id}
                            className="px-3 h-8 rounded-lg bg-white border border-gray-200 text-[11px] font-bold text-gray-400 disabled:opacity-50"
                          >
                            <i className="fa-solid fa-ban mr-1" />Ignorar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">
            <i className="fa-solid fa-circle-info mr-1" />
            O fluxo de venda segue exatamente como sempre (pronta entrega e pré-venda) — esta aba só alimenta o cadastro fiscal.
            CFOP de entrada da XML não vira CFOP de venda: na emissão o sistema calcula 5102 (RS) ou 6102 (fora do estado).
          </p>
        </>
      )}
    </div>
  );
};

export default FiscalXml;
