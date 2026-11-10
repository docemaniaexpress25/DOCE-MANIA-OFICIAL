"use client";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authHeaders } from '@/services/userService';
import { productService } from '@/services/productService';
import { Product } from '@/lib/types';

/**
 * MOVIMENTAÇÕES DE ESTOQUE (KARDEX) — histórico de entradas, saídas, ajustes e estornos.
 * GET  /api/estoque/movimentos?limit=150&tipo=ENTRADA&origem=VENDA&busca=  → { ok, disponivel, resumo, movimentos[] }
 * POST /api/estoque/movimentos { produtoId, tipo, quantidade, origem:'MANUAL', referencia?, custoUnitario? } → { ok, saldo }
 * Se `disponivel:false` → o SQL do Bloco 108 ainda não rodou no Supabase: banner amarelo + tela utilizável (vazia).
 */

interface Props {
  onBack: () => void;
}

interface Movimento {
  id: string;
  criado_em: string;
  tipo: string;           // ENTRADA | SAIDA | AJUSTE | ESTORNO
  origem: string;         // VENDA | MANUAL | XML
  referencia?: string;
  quantidade: number;
  custo_unitario?: number | null;
  saldo_apos: number;
  usuario_nome?: string;
  produto_nome: string;
}

const TIPO_CFG: Record<string, { label: string; chip: string; qtdCor: string; sinal: string }> = {
  ENTRADA: { label: 'Entrada', chip: 'bg-emerald-50 text-emerald-600 border-emerald-100', qtdCor: 'text-emerald-600', sinal: '+' },
  SAIDA:   { label: 'Saída',   chip: 'bg-rose-50 text-rose-600 border-rose-100',       qtdCor: 'text-rose-600',   sinal: '−' },
  AJUSTE:  { label: 'Ajuste',  chip: 'bg-slate-50 text-slate-600 border-slate-200',    qtdCor: 'text-slate-600',  sinal: '' },
  ESTORNO: { label: 'Estorno', chip: 'bg-amber-50 text-amber-600 border-amber-100',    qtdCor: 'text-amber-600',  sinal: '' },
};

const ORIGEM_ICON: Record<string, string> = {
  VENDA: 'fa-cart-shopping',
  MANUAL: 'fa-hand',
  XML: 'fa-file-invoice',
};

const FILTROS_TIPO = [
  { v: 'TODOS', l: 'Todos' },
  { v: 'ENTRADA', l: 'Entrada' },
  { v: 'SAIDA', l: 'Saída' },
  { v: 'AJUSTE', l: 'Ajuste' },
  { v: 'ESTORNO', l: 'Estorno' },
];

const FILTROS_ORIGEM = [
  { v: 'TODAS', l: 'Todas' },
  { v: 'VENDA', l: 'Venda' },
  { v: 'MANUAL', l: 'Manual' },
  { v: 'XML', l: 'XML' },
];

const fmtDataHora = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const MovimentacoesEstoque: React.FC<Props> = ({ onBack }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [disponivel, setDisponivel] = useState(true);
  const [resumo, setResumo] = useState<{ entradas: number; saidas: number }>({ entradas: 0, saidas: 0 });
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);

  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [filtroOrigem, setFiltroOrigem] = useState('TODAS');

  /* ===== sheet: nova entrada/saída ===== */
  const [sheetAberto, setSheetAberto] = useState(false);
  const [produtos, setProdutos] = useState<Product[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(false);
  const [prodBusca, setProdBusca] = useState('');
  const [prodSel, setProdSel] = useState<Product | null>(null);
  const [tipoMov, setTipoMov] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [qtd, setQtd] = useState('1');
  const [custo, setCusto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [erroSheet, setErroSheet] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [toast, setToast] = useState<{ msg: string; tipo: 'success' | 'error' } | null>(null);
  const mostrarToast = (msg: string, tipo: 'success' | 'error') => {
    setToast({ msg, tipo });
    setTimeout(() => setToast(null), 2800);
  };

  /* ===== GET movimentos (filtros vão na query) ===== */
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ limit: '150', busca: '' });
      if (filtroTipo !== 'TODOS') params.set('tipo', filtroTipo);
      if (filtroOrigem !== 'TODAS') params.set('origem', filtroOrigem);
      const res = await fetch(`/api/estoque/movimentos?${params.toString()}`, { headers: { 'Content-Type': 'application/json', ...authHeaders() } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.erro || d.error || `Erro ${res.status} ao carregar movimentações`);
      setDisponivel(d.disponivel !== false);
      setResumo({ entradas: Number(d.resumo?.entradas) || 0, saidas: Number(d.resumo?.saidas) || 0 });
      setMovimentos(Array.isArray(d.movimentos) ? d.movimentos : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Sem conexão. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  }, [filtroTipo, filtroOrigem]);

  useEffect(() => { carregar(); }, [carregar]);

  /* ===== lista de produtos p/ o seletor (mesma fonte do SecretarioEstoque) ===== */
  const carregarProdutos = useCallback(async () => {
    setCarregandoProdutos(true);
    try {
      const ps = await productService.getAllProducts();
      setProdutos([...ps].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')));
    } finally {
      setCarregandoProdutos(false);
    }
  }, []);

  useEffect(() => {
    if (sheetAberto && produtos.length === 0) carregarProdutos();
  }, [sheetAberto, produtos.length, carregarProdutos]);

  const produtosFiltrados = useMemo(() => {
    const s = prodBusca.trim().toLowerCase();
    if (!s) return produtos;
    return produtos.filter(p => (p.nome || '').toLowerCase().includes(s));
  }, [produtos, prodBusca]);

  /* ===== POST movimentos ===== */
  const salvarMovimento = async () => {
    if (!prodSel || salvando) return;
    const q = parseInt(qtd, 10);
    if (!Number.isFinite(q) || q <= 0) { setErroSheet('Informe uma quantidade maior que zero.'); return; }
    setSalvando(true);
    setErroSheet(null);
    try {
      const body: Record<string, unknown> = { produtoId: prodSel.id, tipo: tipoMov, quantidade: q, origem: 'MANUAL' };
      const ref = referencia.trim();
      if (ref) body.referencia = ref;
      const custoNum = parseFloat(custo.replace(',', '.'));
      if (Number.isFinite(custoNum) && custoNum > 0) body.custoUnitario = custoNum;
      const res = await fetch('/api/estoque/movimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.erro || d.error || 'Falha ao registrar movimentação.');
      setSheetAberto(false);
      mostrarToast(`${tipoMov === 'ENTRADA' ? 'Entrada' : 'Saída'} de ${q} un — ${prodSel.nome}: saldo ${d.saldo ?? '?'} un`, 'success');
      setProdSel(null); setProdBusca(''); setQtd('1'); setCusto(''); setReferencia('');
      await carregar();
    } catch (e) {
      setErroSheet(e instanceof Error ? e.message : 'Erro ao registrar movimentação.');
    } finally {
      setSalvando(false);
    }
  };

  const chipCls = (ativo: boolean) =>
    `px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide border transition-colors whitespace-nowrap ${ativo ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-gray-500 border-gray-100'}`;

  return (
    <div className="space-y-3 pb-24">
      {/* ===== HEADER ===== */}
      <div className="flex items-center gap-3 px-2">
        <button onClick={onBack} className="w-10 h-10 bg-white text-gray-500 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90 transition-transform flex-shrink-0">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
        <div className="min-w-0">
          <h2 className="text-xl font-black text-gray-800 tracking-tight truncate">Movimentações de Estoque <span className="text-amber-500">(Kardex)</span></h2>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Quem movimentou, quando e por quê</p>
        </div>
      </div>

      {/* ===== RESUMO ===== */}
      <div className="grid grid-cols-3 gap-1.5 text-center px-0.5">
        <div className="bg-white rounded-xl p-2 border border-gray-100 shadow-sm">
          <p className="text-[7px] font-black text-gray-400 uppercase">Entradas</p>
          <p className="text-[15px] font-black text-emerald-600">{carregando ? '—' : resumo.entradas}</p>
        </div>
        <div className="bg-white rounded-xl p-2 border border-gray-100 shadow-sm">
          <p className="text-[7px] font-black text-gray-400 uppercase">Saídas</p>
          <p className="text-[15px] font-black text-rose-500">{carregando ? '—' : resumo.saidas}</p>
        </div>
        <div className="bg-white rounded-xl p-2 border border-gray-100 shadow-sm">
          <p className="text-[7px] font-black text-gray-400 uppercase">Registros</p>
          <p className="text-[15px] font-black text-gray-700">{carregando ? '—' : movimentos.length}</p>
        </div>
      </div>

      {/* ===== BANNER: SQL DO BLOCO 108 PENDENTE ===== */}
      {!carregando && !erro && !disponivel && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-2.5 mx-0.5">
          <i className="fa-solid fa-database text-amber-600 mt-0.5"></i>
          <p className="text-[9px] font-black text-amber-800 uppercase leading-snug">
            Kardex ainda não instalado — rode o SQL do Bloco 108 no Supabase para habilitar o histórico de movimentações.
          </p>
        </div>
      )}

      {/* ===== ERRO ===== */}
      {!carregando && erro && (
        <div className="bg-rose-50 border border-rose-200 rounded-3xl p-6 mx-0.5 text-center space-y-3">
          <i className="fa-solid fa-triangle-exclamation text-rose-500 text-2xl block"></i>
          <p className="text-[11px] font-black text-rose-600 uppercase leading-snug">{erro}</p>
          <button onClick={carregar} className="w-full py-3 rounded-xl text-[10px] font-black uppercase bg-rose-600 text-white active:scale-95 flex items-center justify-center gap-2">
            <i className="fa-solid fa-rotate-right"></i>Tentar novamente
          </button>
        </div>
      )}

      {/* ===== FILTROS ===== */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {FILTROS_TIPO.map(f => (
            <button key={f.v} onClick={() => setFiltroTipo(f.v)} className={chipCls(filtroTipo === f.v)}>{f.l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="text-[8px] font-black text-gray-300 uppercase tracking-wider pr-0.5">Origem</span>
          {FILTROS_ORIGEM.map(f => (
            <button key={f.v} onClick={() => setFiltroOrigem(f.v)} className={chipCls(filtroOrigem === f.v)}>{f.l}</button>
          ))}
        </div>
      </div>

      {/* ===== LISTA ===== */}
      {carregando ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-3.5 space-y-2 animate-pulse">
              <div className="h-3.5 w-2/3 bg-gray-100 rounded-lg"></div>
              <div className="h-3 w-1/3 bg-gray-50 rounded-lg"></div>
            </div>
          ))}
        </div>
      ) : !erro && movimentos.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
          <i className="fa-solid fa-clipboard-list text-gray-200 text-4xl mb-3 block"></i>
          <p className="text-xs font-black text-gray-600">Nenhuma movimentação encontrada</p>
          <p className="text-[9px] font-bold text-gray-400 mt-1">Registre a primeira entrada/saída no botão abaixo.</p>
        </div>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-0.5">
          {movimentos.map(m => {
            const cfg = TIPO_CFG[m.tipo] || { label: m.tipo, chip: 'bg-gray-50 text-gray-500 border-gray-200', qtdCor: 'text-gray-600', sinal: '' };
            const qtdTxt = `${cfg.sinal}${Number(m.quantidade) || 0} UN`;
            const custoNum = Number(m.custo_unitario) || 0;
            return (
              <div key={m.id || `${m.criado_em}-${m.produto_nome}`} className="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-gray-800 text-[12px] uppercase truncate">{m.produto_nome}</h3>
                  <span className="shrink-0 text-[8px] font-black text-gray-400 uppercase flex items-center gap-1 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-lg">
                    <i className={`fa-solid ${ORIGEM_ICON[m.origem] || 'fa-tag'} text-[8px]`}></i>{m.origem}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-lg border ${cfg.chip}`}>{cfg.label}</span>
                  <span className={`text-[11px] font-black tracking-tight ${cfg.qtdCor}`}>{qtdTxt}</span>
                  {custoNum > 0 && <span className="text-[8px] font-black text-gray-400 uppercase">Custo R$ {custoNum.toFixed(2).replace('.', ',')}</span>}
                  <span className="text-[8px] font-black text-gray-400 uppercase">Estoque após: {m.saldo_apos}</span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="text-[8px] font-bold text-gray-400"><i className="fa-regular fa-clock mr-1"></i>{fmtDataHora(m.criado_em)}</span>
                  {m.usuario_nome && <span className="text-[8px] font-bold text-gray-400"><i className="fa-solid fa-user mr-1"></i>{m.usuario_nome}</span>}
                  {m.referencia && <span className="text-[8px] font-bold text-gray-300 truncate max-w-[140px]" title={m.referencia}><i className="fa-solid fa-tag mr-1"></i>{m.referencia}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== BOTÃO FLUTUANTE ===== */}
      <button
        onClick={() => { setErroSheet(null); setSheetAberto(true); }}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[220] bg-slate-800 text-white px-6 py-3.5 rounded-2xl shadow-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 active:scale-95 transition-transform"
      >
        <i className="fa-solid fa-plus"></i>Nova entrada / saída
      </button>

      {/* ===== SHEET: NOVA MOVIMENTAÇÃO ===== */}
      {sheetAberto && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-end justify-center" onClick={() => !salvando && setSheetAberto(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-right-left text-slate-600 mr-1"></i>Nova movimentação</h3>
            <p className="text-[10px] text-gray-400 font-black text-center mt-1 uppercase">Entrada ou saída manual de estoque</p>

            {/* produto selecionado */}
            {prodSel ? (
              <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-box"></i></div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-gray-800 text-[12px] uppercase truncate">{prodSel.nome}</p>
                  <p className="text-[8px] font-black text-emerald-600 uppercase">Estoque atual: {prodSel.estoquePrincipal ?? 0} un</p>
                </div>
                <button onClick={() => setProdSel(null)} disabled={salvando} className="shrink-0 w-8 h-8 rounded-xl bg-white border border-emerald-100 text-gray-400 active:scale-90 transition-transform">
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                <input
                  value={prodBusca}
                  onChange={e => setProdBusca(e.target.value)}
                  placeholder="Buscar produto por nome..."
                  className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-100"
                />
                {carregandoProdutos ? (
                  <div className="py-8 text-center"><i className="fa-solid fa-circle-notch fa-spin text-gray-300 text-2xl"></i></div>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 border border-gray-50 rounded-2xl p-1.5">
                    {produtosFiltrados.length === 0 ? (
                      <p className="text-[10px] font-black text-gray-400 uppercase text-center py-6">Nenhum produto encontrado</p>
                    ) : produtosFiltrados.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setProdSel(p); setProdBusca(''); }}
                        className="w-full p-2.5 rounded-xl hover:bg-gray-50 flex items-center justify-between gap-2 text-left active:scale-[0.98] transition-transform"
                      >
                        <span className="font-bold text-gray-700 text-[11px] uppercase truncate">{p.nome}</span>
                        <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-lg border ${(p.estoquePrincipal ?? 0) > 0 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-rose-600 bg-rose-50 border-rose-100'}`}>
                          {(p.estoquePrincipal ?? 0) > 0 ? `${p.estoquePrincipal} un` : '0 un'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* tipo */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => setTipoMov('ENTRADA')}
                disabled={salvando}
                className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-wide border-2 flex items-center justify-center gap-1.5 transition-colors ${tipoMov === 'ENTRADA' ? 'bg-emerald-50 border-emerald-500 text-emerald-600' : 'bg-white border-gray-100 text-gray-400'}`}
              >
                <i className="fa-solid fa-arrow-down"></i>Entrada
              </button>
              <button
                onClick={() => setTipoMov('SAIDA')}
                disabled={salvando}
                className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-wide border-2 flex items-center justify-center gap-1.5 transition-colors ${tipoMov === 'SAIDA' ? 'bg-rose-50 border-rose-500 text-rose-600' : 'bg-white border-gray-100 text-gray-400'}`}
              >
                <i className="fa-solid fa-arrow-up"></i>Saída
              </button>
            </div>

            {/* quantidade */}
            <div className="space-y-1 mt-4">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Quantidade (un)</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setQtd(q => String(Math.max(1, (parseInt(q, 10) || 0) - 1)))} disabled={salvando}
                  className="w-12 h-14 bg-gray-50 border border-gray-100 rounded-2xl text-gray-500 font-black text-lg active:scale-95 transition-transform">−</button>
                <input
                  type="number" inputMode="numeric" min={1}
                  value={qtd}
                  onChange={e => setQtd(e.target.value)}
                  disabled={salvando}
                  className="flex-1 p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-center text-lg outline-none focus:ring-2 focus:ring-emerald-100"
                />
                <button onClick={() => setQtd(q => String((parseInt(q, 10) || 0) + 1))} disabled={salvando}
                  className="w-12 h-14 bg-gray-50 border border-gray-100 rounded-2xl text-gray-500 font-black text-lg active:scale-95 transition-transform">+</button>
              </div>
            </div>

            {/* custo + referência */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Custo unitário (opcional)</label>
                <input
                  value={custo}
                  onChange={e => setCusto(e.target.value)}
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                  disabled={salvando}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-[12px] font-bold outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Referência / obs (opcional)</label>
                <input
                  value={referencia}
                  onChange={e => setReferencia(e.target.value)}
                  placeholder="NF, motivo..."
                  disabled={salvando}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-[12px] font-bold outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>

            {erroSheet && (
              <div className="mt-3 bg-rose-50 border border-rose-100 rounded-xl px-3.5 py-2.5 flex items-start gap-2">
                <i className="fa-solid fa-triangle-exclamation text-rose-500 mt-0.5"></i>
                <p className="text-[9px] font-black text-rose-600 uppercase leading-snug">{erroSheet}</p>
              </div>
            )}

            <button
              onClick={salvarMovimento}
              disabled={!prodSel || salvando}
              className="w-full mt-4 py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2"
            >
              {salvando ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-check"></i>}
              {salvando ? 'Registrando...' : `Registrar ${tipoMov === 'ENTRADA' ? 'entrada' : 'saída'}`}
            </button>
            <button onClick={() => !salvando && setSheetAberto(false)} disabled={salvando} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* ===== TOAST LOCAL ===== */}
      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[500] px-5 py-3 rounded-2xl shadow-xl text-[11px] font-black uppercase tracking-wide flex items-center gap-2 max-w-[92%] ${toast.tipo === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          <i className={`fa-solid ${toast.tipo === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'} shrink-0`}></i>
          <span className="truncate">{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default MovimentacoesEstoque;
