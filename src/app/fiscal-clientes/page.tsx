"use client";

/**
 * BLOCO 174 — PORTAL DE CLIENTES FISCAIS (admin, fora do app) — gêmeo do
 * /fiscal-produtos, pedido do dono: "crie um portal identido ao de produtos
 * porem de clientes para eu poder editar dados dos clientes! coloque somente
 * informaçoes relevantes ao fiscal tbm o nome e cep editaveis".
 *
 * MESMA linguagem do PORTAL FISCAL (/notas) e de PRODUTOS FISCAIS
 * (/fiscal-produtos):
 *  - PIN do admin (6 dígitos) — MESMA SESSÃO do portal fiscal (token /notas);
 *  - TABELA PLANILHA: TODO o cadastro, uma linha por cliente, com SÓ o que a
 *    NF-e/NFC-e (destinatário) e o BOLETO do Inter usam;
 *  - EDITÁVEIS: NOME (nome_fantasia, obrigatório) e CEP (8 dígitos, gravado
 *    mascarado 00000-000) — o CEP é o que o BOLETO do Inter puxa do cadastro;
 *  - SOMENTE LEITURA: razão social, CNPJ, IE, município, UF, endereço,
 *    número e bairro — para conferir o cadastro fiscal na mesma tela;
 *  - EDIÇÃO DIRETA: digita, a linha marca alterada (âmbar); ENTER salva a
 *    linha; SALVAR TUDO grava todas as alteradas de uma vez;
 *  - FILTROS: busca por nome/razão/CNPJ/município/CEP + chips (sem CEP,
 *    sem CNPJ, sem IE, inativos); KPIs clicáveis;
 *  - ALERTA honesto: cliente SEM CEP força a digitação do CEP ao gerar
 *    boleto no PDV — complete pelo filtro "sem CEP";
 *  - EXPORTAR CSV da lista filtrada (Excel).
 *
 * O CEP gravado aqui é o que o gerador de boleto usa NA HORA (BoletoCard ->
 * clienteCep) e o que a NF-e usa no destinatário (endereco_cep).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

type CKey = 'nome' | 'cep';

const CAMPOS_EDIT: CKey[] = ['nome', 'cep'];

interface Stats {
  total: number;
  ativos: number;
  comCep: number;
  semCep: number;
  comCnpj: number;
  semCnpj: number;
  comIe: number;
  comMunicipio: number;
}

type Filtro = 'TODOS' | 'SEM_CEP' | 'SEM_CNPJ' | 'SEM_IE' | 'INATIVOS';

const TOKEN_KEY = 'dm_notas_admin_token';
const NOME_KEY = 'dm_notas_admin_nome';

/** Máscara progressiva de CEP: 95034240 -> 95034-240 */
function mascararCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Validação espelhada da API — devolve erro por campo (vazio CEP = limpa;
 *  NOME alterado para vazio é obrigatório). */
function erroDeCampo(campo: CKey, valor: string): string {
  const v = valor.trim();
  if (campo === 'nome') return !v ? 'obrigatório' : (v.length > 120 ? 'máx. 120 caracteres' : '');
  if (campo === 'cep') {
    const d = v.replace(/\D/g, '');
    return d && d.length !== 8 ? '8 dígitos' : '';
  }
  return '';
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
    return String(c[campo] ?? '');
  }, [edits]);

  const alteradoDe = useCallback((c: ClienteFiscal, campo: CKey): boolean => {
    const e = edits[c.id];
    if (!e || e[campo] === undefined) return false;
    return String(e[campo]) !== String(c[campo] ?? '');
  }, [edits]);

  const setValor = (c: ClienteFiscal, campo: CKey, bruto: string) => {
    // máscara na digitação: nome texto livre (120), CEP mascarado 00000-000
    const v = campo === 'nome' ? bruto.replace(/\s+/g, ' ').slice(0, 120) : mascararCep(bruto);
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
        patch[k] = valorDe(c, k);
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
      detalhe: 'O nome e o CEP gravados aqui são os que o BOLETO do Inter e a NF-e usam. Linhas com erro de digitação não são gravadas.',
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
      run: () => { setEdits({}); setLinha({}); showToast('Alterações descartadas.'); },
    });
  };

  // ---------- filtros ----------
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    return clientes.filter(c => {
      if (filtro === 'SEM_CEP' && c.cep) return false;
      if (filtro === 'SEM_CNPJ' && c.cnpj) return false;
      if (filtro === 'SEM_IE' && c.ie) return false;
      if (filtro === 'INATIVOS' && c.ativo) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.razaoSocial.toLowerCase().includes(q) ||
        (c.cnpj && c.cnpj.toLowerCase().includes(q)) ||
        (c.municipio && c.municipio.toLowerCase().includes(q)) ||
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
    };
  }, [clientes]);

  // ================= TELA: PIN =================
  if (booting) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className={`min-h-screen bg-gray-100 flex items-center justify-center p-4 ${pinShake ? 'animate-shake' : ''}`}>
        <div className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 mx-auto flex items-center justify-center mb-4">
            <i className="fa-solid fa-users-viewfinder text-teal-600 text-3xl"></i>
          </div>
          <h1 className="text-xl font-black text-gray-800 mb-1">Clientes Fiscais</h1>
          <p className="text-gray-400 text-sm mb-8 font-medium">Nome · CEP — destinatário da NF e do boleto</p>
          <div className="flex justify-center gap-3 mb-6" aria-label="PIN digitado">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${pin.length > i ? 'bg-teal-600 border-teal-600' : 'border-gray-200'}`} />
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
            <button type="button" onClick={() => void entrarComPin(pin)} disabled={pinBusy || pin.length === 0} className="h-14 rounded-2xl bg-teal-600 text-white text-[11px] font-black uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-50">
              {pinBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Entrar'}
            </button>
          </div>
          <p className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">DOCE MANIA · Cadastro fiscal dos clientes</p>
          <style>{`@keyframes shake { 10%, 90% { transform: translateX(-1px);} 20%, 80% { transform: translateX(2px);} 30%, 50%, 70% { transform: translateX(-4px);} 40%, 60% { transform: translateX(4px);} } .animate-shake { animation: shake 0.5s; }`}</style>
        </div>
      </div>
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
    const base = `h-8 w-full rounded-lg border text-[12px] font-bold text-gray-800 px-2 transition-colors focus:outline-none focus:ring-2 ${k === 'cep' ? 'font-mono tracking-wide' : ''}`;
    if (err) return `${base} border-rose-300 bg-rose-50 focus:ring-rose-200`;
    if (alteradoDe(c, k)) return `${base} border-amber-300 bg-amber-50 focus:ring-amber-200`;
    if (valorDe(c, k)) return `${base} border-gray-200 bg-white focus:ring-gray-200`;
    return `${base} border-dashed border-gray-300 bg-gray-50/50 text-gray-400 focus:ring-gray-200`;
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-40 shadow-lg shadow-teal-900/10">
        <div className="bg-gradient-to-r from-teal-600 via-teal-700 to-cyan-800 text-white">
          <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-users-viewfinder text-teal-100"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-black uppercase tracking-tight leading-none whitespace-nowrap">Clientes Fiscais <span className="text-teal-200">Nome · CEP · CNPJ · IE · Município</span></h1>
              <p className="text-[10px] text-teal-100/70 font-semibold mt-1 leading-none truncate">
                {nomeAdmin ? <><i className="fa-solid fa-user-shield mr-1 text-[8px]"></i>{nomeAdmin} · </> : null}
                <span className="uppercase tracking-wide">destinatário da NF · CEP que o boleto do Inter puxa</span>
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
            <span className={kpis.semCnpj > 0 ? 'text-amber-300' : ''}><b>{kpis.comCnpj}</b> com CNPJ</span>
            <span className="text-cyan-300/70"><b>{kpis.comIe}</b> com IE</span>
            <span className="text-cyan-300/70"><b>{kpis.comMunicipio}</b> com município</span>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-4 space-y-3">
        {/* ================= ALERTA SEM CEP ================= */}
        {kpis.semCep > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <i className="fa-solid fa-triangle-exclamation text-amber-600"></i>
            <p className="text-[11px] font-bold text-amber-800">
              {kpis.semCep} cliente(s) SEM CEP — ao gerar boleto o sistema vai pedir o CEP na mão. Use o filtro <b>sem CEP</b> abaixo e complete o cadastro.
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
              placeholder="Buscar por nome, razão social, CNPJ, município ou CEP..."
              className="w-full h-9 pl-8 pr-3 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-200"
              aria-label="Buscar cliente"
            />
          </div>
          {chipFiltro('TODOS', 'Todos', kpis.total, 'bg-gray-900 text-white')}
          {chipFiltro('SEM_CEP', 'Sem CEP', kpis.semCep, 'bg-amber-600 text-white')}
          {chipFiltro('SEM_CNPJ', 'Sem CNPJ', kpis.semCnpj, 'bg-stone-700 text-white')}
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
              disabled={salvandoTudo}
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
            <table className="w-full min-w-[1560px] text-left">
              <thead>
                <tr className="bg-gray-900 text-white text-[9px] font-black uppercase tracking-wider">
                  <th className="px-3 py-2.5 w-14">#</th>
                  <th className="px-3 py-2.5 min-w-[220px]">Nome <span className="text-gray-400 normal-case font-semibold">(editável)</span></th>
                  <th className="px-3 py-2.5 w-32">CEP <span className="text-gray-400 normal-case font-semibold">(editável)</span></th>
                  <th className="px-3 py-2.5 w-40">CNPJ</th>
                  <th className="px-3 py-2.5 min-w-[200px]">Razão Social</th>
                  <th className="px-3 py-2.5 w-28">IE</th>
                  <th className="px-3 py-2.5 w-40">Município</th>
                  <th className="px-3 py-2.5 w-12">UF</th>
                  <th className="px-3 py-2.5 min-w-[220px]">Endereço</th>
                  <th className="px-3 py-2.5 w-28 text-right">Situação</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr><td colSpan={10} className="px-4 py-16 text-center"><div className="w-8 h-8 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin mx-auto" /></td></tr>
                )}
                {!carregando && filtrados.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-16 text-center text-gray-400 text-sm font-semibold">
                    {clientes.length === 0 ? 'Nenhum cliente no cadastro.' : 'Nenhum cliente com este filtro.'}
                  </td></tr>
                )}
                {!carregando && filtrados.map((c, idx) => {
                  const est = estadoLinha(c);
                  const st = linha[c.id];
                  const pend = CAMPOS_EDIT.some(k => alteradoDe(c, k));
                  return (
                    <tr key={c.id} className={`${est.fundo} ${est.borda} border-b border-gray-100 hover:bg-gray-50/60 transition-colors`}>
                      <td className="px-3 py-1.5 text-[10px] font-bold text-gray-300">{idx + 1}</td>
                      {/* BLOCO 174: NOME editável — obrigatório (catálogo, PDV, NF) */}
                      <td className="px-3 py-1.5">
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
                      {/* BLOCO 174: CEP editável — o que o BOLETO do Inter puxa do cadastro */}
                      <td className="px-3 py-1.5">
                        <input
                          value={valorDe(c, 'cep')}
                          onChange={e => setValor(c, 'cep', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void salvarLinha(c); }}
                          inputMode="numeric"
                          placeholder="00000-000"
                          className={inputCls(c, 'cep')}
                          aria-label={`CEP de ${c.nome}`}
                        />
                        {alteradoDe(c, 'cep') && erroDeCampo('cep', valorDe(c, 'cep')) ? (
                          <p className="text-[8px] font-black text-rose-500 mt-0.5">CEP: {erroDeCampo('cep', valorDe(c, 'cep'))}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[11px] font-bold font-mono ${c.cnpj ? 'text-gray-700' : 'text-gray-300'}`}>{c.cnpj || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[11px] font-bold truncate block max-w-[240px] ${c.razaoSocial ? 'text-gray-600' : 'text-gray-300'}`} title={c.razaoSocial}>{c.razaoSocial || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[11px] font-bold font-mono ${c.ie ? 'text-gray-700' : 'text-gray-300'}`}>{c.ie || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[11px] font-bold ${c.municipio ? 'text-gray-600' : 'text-gray-300'}`}>{c.municipio || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[11px] font-black ${c.uf ? 'text-gray-700' : 'text-gray-300'}`}>{c.uf || '—'}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="text-[11px] font-semibold text-gray-500 truncate block max-w-[260px]" title={[c.endereco, c.numero && `nº ${c.numero}`, c.bairro].filter(Boolean).join(', ')}>
                          {[c.endereco, c.numero && `nº ${c.numero}`, c.bairro].filter(Boolean).join(', ') || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
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
            O que está aqui é o que a NF-e/NFC-e e o BOLETO do Inter usam. <b>Nome</b> editável (obrigatório, até 120) · <b>CEP</b> editável (8 dígitos — é o CEP do pagador que o boleto puxa do cadastro; vazio = limpa) · <b>CNPJ / IE / Município / UF / Endereço</b> somente leitura — para editar o resto, use Clientes no app. ENTER na linha salva só aquela linha.
          </p>
        </div>
      </main>

      {/* ================= FOOTER FIXO ================= */}
      <footer className="mt-auto bg-white border-t border-gray-200">
        <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">
          <i className="fa-solid fa-users-viewfinder text-teal-600"></i>
          DOCE MANIA · Clientes Fiscais — nome e CEP editáveis
          <span className="ml-auto">{kpis.total} clientes · {kpis.comCep} com CEP · {kpis.semCep} sem CEP</span>
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
