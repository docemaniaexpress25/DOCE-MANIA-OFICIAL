"use client";

/**
 * BLOCO 156 — PORTAL DE PRODUTOS FISCAIS (admin, fora do app) — PC otimizado.
 *
 * Regra do dono: "me traga uma lista editavel de todos os produtos com NCM
 * CEST e CFOP, lista editavel".
 *
 * MESMA linguagem do PORTAL FISCAL (/notas) e do PORTAL DE ENTRADAS (/entradas):
 *  - PIN do admin (6 dígitos) — MESMA SESSÃO do portal fiscal (token /notas);
 *  - TABELA PLANILHA: TODO o catálogo, uma linha por produto, campos editáveis
 *    na linha (NCM, CEST, CFOP, EAN, unidade, origem);
 *  - EDIÇÃO DIRETA: digita, o campo marca a linha como alterada (âmbar);
 *    ENTER salva a linha; SALVAR TUDO grava todas as alteradas de uma vez;
 *  - VALIDAÇÃO SEFAZ na digitação: NCM 8 dígitos, CEST 7, CFOP 4 de saída
 *    (5/6), EAN 8-14 — igual a NF-e aceita;
 *  - FILTROS: busca por nome/código/EAN + chips (sem NCM, sem CFOP, sem CEST,
 *    inativos); KPIs clicáveis;
 *  - ALERTA honesto: produto SEM NCM sai na nota com o código genérico
 *    21069090 (é o fallback real da emissão);
 *  - EXPORTAR CSV da lista filtrada (Excel).
 *
 * Os dados gravados aqui são EXATAMENTE os que a emissão da NF-e/NFC-e usa
 * (/api/notas → focusNfe) — completar aqui faz a nota sair certa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------- tipos ----------------
interface ProdutoFiscal {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
  precoVenda: number;
  ncm: string;
  cest: string;
  cfop: string;
  ean: string;
  unidade: string;
  origem: string;
}

type FKey = 'ncm' | 'cest' | 'cfop' | 'ean' | 'unidade' | 'origem';

const CAMPOS_FISCAIS: FKey[] = ['ncm', 'cest', 'cfop', 'ean', 'unidade', 'origem'];

interface Stats {
  total: number;
  ativos: number;
  comNcm: number;
  semNcm: number;
  comCfop: number;
  semCfop: number;
  comCest: number;
  semCest: number;
  comEan: number;
}

type Filtro = 'TODOS' | 'SEM_NCM' | 'SEM_CFOP' | 'SEM_CEST' | 'INATIVOS';

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

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

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

const soDigitos = (v: string) => String(v || '').replace(/\D/g, '');

/** Validação espelhada da API — devolve erro por campo (vazio = ok, limpa). */
function erroDeCampo(campo: FKey, valor: string): string {
  const v = campo === 'unidade' ? valor.trim().toUpperCase() : soDigitos(valor);
  if (!v) return '';
  switch (campo) {
    case 'ncm':
      return v.length !== 8 ? '8 dígitos' : '';
    case 'cest':
      return v.length !== 7 ? '7 dígitos' : '';
    case 'cfop':
      return v.length !== 4 ? '4 dígitos' : !/^[567]/.test(v) ? 'saída: começa 5 ou 6' : '';
    case 'ean':
      return v.length < 8 || v.length > 14 ? '8 a 14 dígitos' : '';
    case 'unidade':
      return v.length > 6 ? 'máx. 6 letras' : '';
    case 'origem':
      return !/^[0-8]$/.test(v) ? '0 a 8' : '';
    default:
      return '';
  }
}

interface LinhaEstado {
  salvando?: boolean;
  salvoEm?: number;
  erro?: string;
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
export default function PortalProdutosFiscaisPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [booting, setBooting] = useState(true);

  // PIN gate
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);

  // Dados
  const [produtos, setProdutos] = useState<ProdutoFiscal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState('');

  // Edição (apenas os campos alterados por produto)
  const [edits, setEdits] = useState<Record<string, Partial<Record<FKey, string>>>>({});
  const [linha, setLinha] = useState<Record<string, LinhaEstado>>({});

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('TODOS');

  // Salvar tudo
  const [salvandoTudo, setSalvandoTudo] = useState(false);
  const [conf, setConf] = useState<ConfModal | null>(null);

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
      const res = await fetch('/api/produtos-fiscal', { headers: headers(t), cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (res.status === 401 || res.status === 403) {
        try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NOME_KEY); } catch {}
        setToken(null); setNomeAdmin('');
        setErroLista('Sessão expirada. Entre com o PIN novamente.');
        return;
      }
      if (!res.ok || !d?.ok) { setErroLista(d?.erro || `Erro ${res.status}`); return; }
      setProdutos((d.produtos || []) as ProdutoFiscal[]);
      setStats((d.stats || null) as Stats | null);
      setEdits({});
      setLinha({});
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
    setToken(null); setNomeAdmin(''); setProdutos([]); setEdits({}); setBusca('');
  };

  // ---------- helpers de edição ----------
  const valorDe = useCallback((p: ProdutoFiscal, campo: FKey): string => {
    const e = edits[p.id];
    if (e && e[campo] !== undefined) return String(e[campo]);
    return String(p[campo] ?? '');
  }, [edits]);

  const alteradoDe = useCallback((p: ProdutoFiscal, campo: FKey): boolean => {
    const e = edits[p.id];
    if (!e || e[campo] === undefined) return false;
    return String(e[campo]) !== String(p[campo] ?? '');
  }, [edits]);

  const setValor = (p: ProdutoFiscal, campo: FKey, bruto: string) => {
    // máscara na digitação: só dígitos nos campos numéricos, letras na unidade
    // limites reais da NF-e: NCM 8 · CEST 7 · CFOP 4 · EAN 14 · origem 1
    let v = bruto;
    if (campo === 'unidade') v = bruto.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    else if (campo === 'origem') v = soDigitos(bruto).slice(0, 1);
    else {
      const limite = campo === 'ncm' ? 8 : campo === 'cest' ? 7 : campo === 'cfop' ? 4 : 14;
      v = soDigitos(bruto).slice(0, limite);
    }
    setEdits(prev => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [campo]: v } }));
    setLinha(prev => ({ ...prev, [p.id]: { ...prev[p.id], erro: undefined } }));
  };

  const linhasAlteradas = useMemo(
    () => produtos.filter(p => CAMPOS_FISCAIS.some(c => alteradoDe(p, c))),
    [produtos, alteradoDe],
  );

  const linhasComErro = useMemo(() => {
    const ids: string[] = [];
    for (const p of linhasAlteradas) {
      const comErro = CAMPOS_FISCAIS.some(c => alteradoDe(p, c) && erroDeCampo(c, valorDe(p, c)));
      if (comErro) ids.push(p.id);
    }
    return new Set(ids);
  }, [linhasAlteradas, alteradoDe, valorDe]);

  // ---------- salvar UMA linha ----------
  const salvarLinha = useCallback(async (p: ProdutoFiscal): Promise<boolean> => {
    if (!token) return false;
    const patch: Record<string, string> = {};
    for (const c of CAMPOS_FISCAIS) {
      if (alteradoDe(p, c)) {
        const err = erroDeCampo(c, valorDe(p, c));
        if (err) { setLinha(prev => ({ ...prev, [p.id]: { erro: `${c.toUpperCase()}: ${err}` } })); return false; }
        patch[c] = valorDe(p, c);
      }
    }
    if (Object.keys(patch).length === 0) return true;
    setLinha(prev => ({ ...prev, [p.id]: { salvando: true } }));
    try {
      const res = await fetch('/api/produtos-fiscal', { method: 'PATCH', headers: headers(token), body: JSON.stringify({ id: p.id, ...patch }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setLinha(prev => ({ ...prev, [p.id]: { erro: d?.erro || `Erro ${res.status}` } }));
        return false;
      }
      const salvo = d.produto as ProdutoFiscal;
      setProdutos(prev => prev.map(x => (x.id === salvo.id ? salvo : x)));
      setEdits(prev => { const n = { ...prev }; delete n[salvo.id]; return n; });
      setLinha(prev => ({ ...prev, [p.id]: { salvoEm: Date.now() } }));
      return true;
    } catch {
      setLinha(prev => ({ ...prev, [p.id]: { erro: 'Sem conexão.' } }));
      return false;
    }
  }, [token, alteradoDe, valorDe]);

  // ---------- SALVAR TUDO ----------
  const salvarTudo = () => {
    const alvos = linhasAlteradas.filter(p => !linhasComErro.has(p.id));
    if (alvos.length === 0) {
      showToast(linhasAlteradas.length ? 'Corrija os campos marcados em vermelho antes de salvar.' : 'Nenhuma alteração pendente.', false);
      return;
    }
    setConf({
      titulo: 'Salvar tudo?',
      texto: `${alvos.length} produto(s) com alterações fiscais serão gravados no catálogo.`,
      detalhe: 'Os códigos entram na NF-e/NFC-e na próxima emissão. Linhas com erro de digitação não são gravadas.',
      icone: 'fa-floppy-disk',
      botao: `Salvar ${alvos.length} produto(s)`,
      run: async () => {
        setSalvandoTudo(true);
        let ok = 0; let falha = 0;
        for (const p of alvos) {
          const r = await salvarLinha(p);
          if (r) ok += 1; else falha += 1;
        }
        setSalvandoTudo(false);
        if (falha === 0) showToast(`Salvo! ${ok} produto(s) atualizado(s).`, true);
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
      run: () => { setEdits({}); setLinha({}); showToast('Alterações descartadas.'); },
    });
  };

  // ---------- filtros ----------
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos.filter(p => {
      if (filtro === 'SEM_NCM' && p.ncm) return false;
      if (filtro === 'SEM_CFOP' && p.cfop) return false;
      if (filtro === 'SEM_CEST' && p.cest) return false;
      if (filtro === 'INATIVOS' && p.ativo) return false;
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
        p.ean.includes(q)
      );
    });
  }, [produtos, busca, filtro]);

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
      ['codigo', 'produto', 'ncm', 'cest', 'cfop', 'ean', 'unidade', 'origem', 'ativo', 'preco_venda'].join(';'),
      ...filtrados.map(p => [
        p.codigo, p.nome.replace(/;/g, ','), p.ncm, p.cest, p.cfop, p.ean,
        p.unidade, p.origem, p.ativo ? 'SIM' : 'NAO', p.precoVenda.toFixed(2).replace('.', ','),
      ].join(';')),
    ];
    const blob = new Blob(['\ufeff' + linhasCsv.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produtos-fiscais-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`CSV exportado: ${filtrados.length} produto(s).`);
  };

  const kpis = { total: stats?.total ?? produtos.length, ...{ ativos: stats?.ativos ?? 0, comNcm: stats?.comNcm ?? 0, semNcm: stats?.semNcm ?? 0, semCfop: stats?.semCfop ?? 0, semCest: stats?.semCest ?? 0, comEan: stats?.comEan ?? 0 } };

  // ================= TELA: PIN =================
  if (booting) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-amber-100 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className={`min-h-screen bg-gray-100 flex items-center justify-center p-4 ${pinShake ? 'animate-shake' : ''}`}>
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 mx-auto flex items-center justify-center mb-4">
            <i className="fa-solid fa-clipboard-list text-amber-600 text-3xl"></i>
          </div>
          <h1 className="text-xl font-black text-gray-800 mb-1">Produtos Fiscais</h1>
          <p className="text-gray-400 text-sm mb-8 font-medium">NCM · CEST · CFOP · lista editável</p>
          <div className="flex justify-center gap-3 mb-6" aria-label="PIN digitado">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${pin.length > i ? 'bg-amber-600 border-amber-600' : 'border-gray-200'}`} />
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
            <button type="button" onClick={() => void entrarComPin(pin)} disabled={pinBusy || pin.length === 0} className="h-14 rounded-2xl bg-amber-600 text-white text-[11px] font-black uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-50">
              {pinBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Entrar'}
            </button>
          </div>
          <p className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">DOCE MANIA · Códigos fiscais do catálogo</p>
          <style>{`@keyframes shake { 10%, 90% { transform: translateX(-1px);} 20%, 80% { transform: translateX(2px);} 30%, 50%, 70% { transform: translateX(-4px);} 40%, 60% { transform: translateX(4px);} } .animate-shake { animation: shake 0.5s; }`}</style>
        </div>
      </div>
    );
  }

  // ================= TELA: PORTAL (PC otimizado) =================
  const salvoRecente = (p: ProdutoFiscal) => !!linha[p.id]?.salvoEm && Date.now() - (linha[p.id].salvoEm || 0) < 4000;
  const estadoLinha = (p: ProdutoFiscal): { fundo: string; borda: string } => {
    const st = linha[p.id];
    if (st?.erro) return { fundo: 'bg-rose-50/70', borda: 'border-l-4 border-l-rose-400' };
    if (linhasComErro.has(p.id)) return { fundo: 'bg-rose-50/40', borda: 'border-l-4 border-l-rose-300' };
    if (st?.salvando || salvandoTudo) return { fundo: 'bg-gray-50', borda: 'border-l-4 border-l-gray-300' };
    if (salvoRecente(p)) return { fundo: 'bg-emerald-50/60', borda: 'border-l-4 border-l-emerald-400' };
    if (CAMPOS_FISCAIS.some(c => alteradoDe(p, c))) return { fundo: 'bg-amber-50/70', borda: 'border-l-4 border-l-amber-400' };
    return { fundo: 'bg-white', borda: 'border-l-4 border-l-transparent' };
  };

  const inputCls = (p: ProdutoFiscal, c: FKey) => {
    const err = alteradoDe(p, c) && erroDeCampo(c, valorDe(p, c));
    const base = 'h-8 w-full rounded-lg border text-[12px] font-bold text-gray-800 px-2 font-mono tracking-wide transition-colors focus:outline-none focus:ring-2';
    if (err) return `${base} border-rose-300 bg-rose-50 focus:ring-rose-200`;
    if (alteradoDe(p, c)) return `${base} border-amber-300 bg-amber-50 focus:ring-amber-200`;
    if (valorDe(p, c)) return `${base} border-gray-200 bg-white focus:ring-gray-200`;
    return `${base} border-dashed border-gray-300 bg-gray-50/50 text-gray-400 focus:ring-gray-200`;
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-40 shadow-lg shadow-amber-900/10">
        <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-orange-800 text-white">
          <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-clipboard-list text-amber-100"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Produtos Fiscais <span className="text-amber-200">NCM · CEST · CFOP</span></h1>
              <p className="text-[10px] text-amber-100/70 font-semibold mt-1 leading-none truncate">
                {nomeAdmin ? <><i className="fa-solid fa-user-shield mr-1 text-[8px]"></i>{nomeAdmin} · </> : null}
                <span className="uppercase tracking-wide">lista editável do catálogo</span>
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
                disabled={carregando || salvandoTudo}
                className="bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Recarregar a lista (descarta alterações não salvas)"
              >
                <i className={`fa-solid fa-rotate ${carregando ? 'fa-spin' : ''}`}></i>Atualizar
              </button>
              <button
                onClick={sair}
                className="bg-white/10 hover:bg-white/20 text-amber-100 rounded-xl px-3.5 h-9 text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all flex items-center gap-1.5"
                title="Sair do portal"
              >
                <i className="fa-solid fa-right-from-bracket"></i>Sair
              </button>
            </div>
          </div>
        </div>
        {/* faixa de KPIs — uma linha só */}
        <div className="bg-orange-950 text-orange-100">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center gap-4 text-[10px] font-bold whitespace-nowrap overflow-x-auto" role="status">
            <span><b className="text-white">{kpis.total}</b> produtos</span>
            <span><b className="text-white">{kpis.ativos}</b> ativos</span>
            <span className="text-emerald-300"><b>{kpis.comNcm}</b> com NCM</span>
            <span className={kpis.semNcm > 0 ? 'text-amber-300' : ''}><b>{kpis.semNcm}</b> sem NCM</span>
            <span className={kpis.semCfop > 0 ? 'text-amber-300' : ''}><b>{kpis.semCfop}</b> sem CFOP</span>
            <span className={kpis.semCest > 0 ? 'text-amber-300' : ''}><b>{kpis.semCest}</b> sem CEST</span>
            <span className="text-orange-300/70"><b>{kpis.comEan}</b> com EAN</span>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-4 space-y-3">
        {/* ================= ALERTA SEM NCM ================= */}
        {stats && stats.semNcm > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
            <p className="text-[11px] font-bold text-amber-800">
              {stats.semNcm} produto(s) SEM NCM — a nota sai com o código genérico <b>21069090</b> na emissão. Use o filtro <b>sem NCM</b> abaixo e complete antes de emitir.
            </p>
          </div>
        )}

        {/* ================= FILTROS ================= */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, código interno ou EAN..."
              className="w-full h-9 pl-8 pr-3 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-200"
              aria-label="Buscar produto"
            />
          </div>
          {chipFiltro('TODOS', 'Todos', kpis.total, 'bg-gray-900 text-white')}
          {chipFiltro('SEM_NCM', 'Sem NCM', kpis.semNcm, 'bg-amber-600 text-white')}
          {chipFiltro('SEM_CFOP', 'Sem CFOP', kpis.semCfop, 'bg-orange-600 text-white')}
          {chipFiltro('SEM_CEST', 'Sem CEST', kpis.semCest, 'bg-rose-600 text-white')}
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
              <b>{linhasAlteradas.length}</b> linha(s) alterada(s){linhasComErro.size ? ` · ${linhasComErro.size} com erro de digitação` : ''} — salve para gravar no catálogo.
            </p>
            <button
              onClick={descartarTudo}
              className="h-8 px-3 rounded-lg bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase tracking-wider active:scale-95"
            >
              Descartar
            </button>
            <button
              onClick={salvarTudo}
              disabled={salvandoTudo}
              className="h-8 px-4 rounded-lg bg-amber-600 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-60 flex items-center gap-1.5"
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
            <table className="w-full min-w-[1480px] text-left">
              <thead>
                <tr className="bg-gray-900 text-white text-[9px] font-black uppercase tracking-wider">
                  <th className="px-3 py-2.5 w-14">#</th>
                  <th className="px-3 py-2.5 w-24">Código</th>
                  <th className="px-3 py-2.5 min-w-[260px]">Produto</th>
                  <th className="px-3 py-2.5 w-32">NCM <span className="text-gray-400 normal-case font-semibold">(8)</span></th>
                  <th className="px-3 py-2.5 w-32">CEST <span className="text-gray-400 normal-case font-semibold">(7)</span></th>
                  <th className="px-3 py-2.5 w-28">CFOP <span className="text-gray-400 normal-case font-semibold">(4)</span></th>
                  <th className="px-3 py-2.5 w-36">EAN <span className="text-gray-400 normal-case font-semibold">(8-14)</span></th>
                  <th className="px-3 py-2.5 w-20">Un</th>
                  <th className="px-3 py-2.5 w-56">Origem</th>
                  <th className="px-3 py-2.5 w-28 text-right">Situação</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr><td colSpan={10} className="px-4 py-16 text-center"><div className="w-8 h-8 border-4 border-amber-100 border-t-amber-600 rounded-full animate-spin mx-auto" /></td></tr>
                )}
                {!carregando && filtrados.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-16 text-center text-gray-400 text-sm font-semibold">
                    {produtos.length === 0 ? 'Nenhum produto no catálogo.' : 'Nenhum produto com este filtro.'}
                  </td></tr>
                )}
                {!carregando && filtrados.map((p, idx) => {
                  const est = estadoLinha(p);
                  const st = linha[p.id];
                  const pend = CAMPOS_FISCAIS.some(c => alteradoDe(p, c));
                  return (
                    <tr key={p.id} className={`${est.fundo} ${est.borda} border-b border-gray-100 hover:bg-gray-50/60 transition-colors`}>
                      <td className="px-3 py-1.5 text-[10px] font-bold text-gray-300">{idx + 1}</td>
                      <td className="px-3 py-1.5 text-[11px] font-black text-gray-500 font-mono">{p.codigo || '—'}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-bold text-gray-800 truncate max-w-[320px]" title={p.nome}>{p.nome}</span>
                          {!p.ativo && <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500 shrink-0">inativo</span>}
                        </div>
                        <p className="text-[9px] text-gray-400 font-semibold">{fmtBRL(p.precoVenda)}</p>
                      </td>
                      {(['ncm', 'cest', 'cfop', 'ean'] as FKey[]).map(c => (
                        <td key={c} className="px-3 py-1.5">
                          <input
                            value={valorDe(p, c)}
                            onChange={e => setValor(p, c, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(p); }}
                            inputMode="numeric"
                            placeholder={c === 'ncm' ? '21069090' : c === 'cfop' ? '5102' : c === 'cest' ? '0000000' : '789...'}
                            className={inputCls(p, c)}
                            aria-label={`${c.toUpperCase()} de ${p.nome}`}
                          />
                          {alteradoDe(p, c) && erroDeCampo(c, valorDe(p, c)) && (
                            <p className="text-[8px] font-black text-rose-500 mt-0.5">{erroDeCampo(c, valorDe(p, c))}</p>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <input
                          value={valorDe(p, 'unidade')}
                          onChange={e => setValor(p, 'unidade', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(p); }}
                          placeholder="UN"
                          className={inputCls(p, 'unidade')}
                          aria-label={`Unidade de ${p.nome}`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={valorDe(p, 'origem') || '0'}
                          onChange={e => setValor(p, 'origem', e.target.value)}
                          className="h-8 w-full rounded-lg border border-gray-200 bg-white text-[11px] font-bold text-gray-700 px-1.5 focus:outline-none focus:ring-2 focus:ring-amber-200"
                          aria-label={`Origem de ${p.nome}`}
                        >
                          {ORIGENS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {st?.erro ? (
                          <span className="text-[9px] font-black text-rose-600 leading-tight block max-w-[120px] inline-block" title={st.erro}>{st.erro}</span>
                        ) : st?.salvando || salvandoTudo ? (
                          <i className="fa-solid fa-spinner fa-spin text-gray-400"></i>
                        ) : salvoRecente(p) ? (
                          <span className="text-[9px] font-black text-emerald-600 uppercase"><i className="fa-solid fa-check mr-0.5"></i>salvo</span>
                        ) : pend ? (
                          <button
                            onClick={() => void salvarLinha(p)}
                            disabled={linhasComErro.has(p.id)}
                            className="h-7 px-2.5 rounded-lg bg-amber-600 text-white text-[9px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-50"
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
            <i className="fa-solid fa-circle-info text-amber-600 mr-1.5"></i>
            Os códigos gravados aqui são os que saem na NF-e/NFC-e. <b>NCM</b> 8 dígitos (sem NCM a nota sai 21069090) · <b>CEST</b> 7 dígitos (só para produtos com ST) · <b>CFOP</b> 4 dígitos de saída (5102 venda dentro do estado / 6102 fora) · <b>EAN</b> código de barras 8-14 · <b>Un</b> unidade comercial (UN, KG, PC, CX) · <b>Origem</b> 0 nacional / 1-2 estrangeira. ENTER na linha salva só aquela linha.
          </p>
        </div>
      </main>

      {/* ================= FOOTER FIXO ================= */}
      <footer className="mt-auto bg-white border-t border-gray-200">
        <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
          <i className="fa-solid fa-clipboard-list text-amber-600"></i>
          DOCE MANIA · Produtos Fiscais — lista editável de NCM / CEST / CFOP
          <span className="ml-auto">{kpis.total} produtos · {kpis.comNcm} com NCM</span>
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
            <div className="w-12 h-12 rounded-2xl bg-amber-50 mx-auto flex items-center justify-center mb-3">
              <i className={`fa-solid ${conf.icone} text-amber-600 text-xl`}></i>
            </div>
            <h3 className="text-center text-base font-black text-gray-800 mb-1">{conf.titulo}</h3>
            <p className="text-center text-[12px] font-semibold text-gray-500 mb-2">{conf.texto}</p>
            {conf.detalhe && <p className="text-center text-[10px] font-bold text-gray-400 mb-4 leading-relaxed">{conf.detalhe}</p>}
            <div className="flex gap-2">
              <button onClick={() => setConf(null)} className="flex-1 h-11 rounded-xl bg-gray-100 text-gray-500 text-[11px] font-black uppercase tracking-wider active:scale-95">Cancelar</button>
              <button
                onClick={() => { const run = conf.run; setConf(null); void run(); }}
                className="flex-1 h-11 rounded-xl bg-amber-600 text-white text-[11px] font-black uppercase tracking-wider active:scale-95"
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
