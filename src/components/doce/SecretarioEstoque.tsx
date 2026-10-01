"use client";
import React, { useState, useMemo } from 'react';
import { Product } from '@/lib/types';
import { authHeaders } from '@/services/userService';

/**
 * BLOCO 19 — ABA ESTOQUE DO SECRETARIO (somente quantidade).
 *
 * O secretario ve TODOS os produtos e pode ajustar APENAS a quantidade
 * em estoque. Nesta tela NAO existem precos, custo, nome, ativo/inativo,
 * fotos, ordem, adicao ou exclusao — nada disso. A gravacao vai pela
 * rota /api/secretario/estoque, que no servidor so aceita a coluna
 * estoque_principal (whitelist) com sessao SECRETARIO/ADMIN.
 */

interface Props {
  products: Product[];
  showToast: (m: string, t?: 'success' | 'error') => void;
  reloadProducts: () => void;
}

const SecretarioEstoque: React.FC<Props> = ({ products, showToast, reloadProducts }) => {
  const [search, setSearch] = useState('');
  const [editando, setEditando] = useState<Product | null>(null);
  const [qtd, setQtd] = useState('');
  const [busy, setBusy] = useState(false);

  const filtrados = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return products;
    return products.filter(p => (p.nome || '').toLowerCase().includes(s));
  }, [products, search]);

  const zerados = useMemo(() => products.filter(p => (p.estoquePrincipal ?? 0) <= 0).length, [products]);

  const abrirAjuste = (p: Product) => {
    setEditando(p);
    setQtd(String(p.estoquePrincipal ?? 0));
  };

  const salvar = async () => {
    if (!editando || busy) return;
    const n = parseInt(qtd, 10);
    if (Number.isNaN(n) || n < 0) { showToast('Digite uma quantidade valida.', 'error'); return; }
    if (n === (editando.estoquePrincipal ?? 0)) { setEditando(null); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/secretario/estoque', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ updates: [{ id: editando.id, estoquePrincipal: n }] }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        showToast(d.error || 'Nao foi possivel salvar o estoque.', 'error');
        return;
      }
      showToast(`Estoque de ${editando.nome} atualizado: ${n} un`, 'success');
      setEditando(null);
      reloadProducts();
    } catch {
      showToast('Sem conexao. Tente novamente.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* ===== AVISO: SOMENTE ESTOQUE ===== */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-start gap-2.5">
        <i className="fa-solid fa-shield-halved text-emerald-600 mt-0.5"></i>
        <p className="text-[9px] font-black text-emerald-800 uppercase leading-snug">
          Modo estoque — você pode ajustar <span className="underline">apenas a quantidade</span> dos produtos.
          Preços, custo e demais dados ficam liberados somente ao administrador.
        </p>
      </div>

      {/* ===== RESUMO ===== */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="bg-white rounded-xl p-2 border border-gray-100"><p className="text-[7px] font-black text-gray-400 uppercase">Produtos</p><p className="text-[15px] font-black text-gray-700">{products.length}</p></div>
        <div className="bg-white rounded-xl p-2 border border-gray-100"><p className="text-[7px] font-black text-gray-400 uppercase">Zerados</p><p className="text-[15px] font-black text-rose-500">{zerados}</p></div>
        <div className="bg-white rounded-xl p-2 border border-gray-100"><p className="text-[7px] font-black text-gray-400 uppercase">Ativos</p><p className="text-[15px] font-black text-emerald-600">{products.filter(p => p.ativo).length}</p></div>
      </div>

      {/* ===== BUSCA ===== */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar produto..."
        className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm focus:ring-2 focus:ring-emerald-100 outline-none"
      />

      {/* ===== LISTA (ordem do PDV) ===== */}
      <div className="space-y-2">
        {filtrados.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
            <i className="fa-solid fa-box-open text-gray-200 text-4xl mb-3 block"></i>
            <p className="text-xs font-black text-gray-600">Nenhum produto encontrado</p>
          </div>
        ) : filtrados.map(p => {
          const est = p.estoquePrincipal ?? 0;
          return (
            <div key={p.id} className={`bg-white p-3.5 rounded-2xl border shadow-sm flex items-center gap-3 min-w-0 ${!p.ativo ? 'opacity-50 grayscale' : ''}`}>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{p.nome}</h3>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border tracking-tighter whitespace-nowrap ${est > 0 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-rose-600 bg-rose-50 border-rose-100'}`}>
                    <i className="fa-solid fa-boxes-stacked mr-1 text-[8px]"></i>{est} un{est <= 0 ? ' — ESGOTADO' : ''}
                  </span>
                  {!p.ativo && <span className="text-[8px] font-black text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-lg border border-gray-100 uppercase">inativo</span>}
                </div>
              </div>
              <button
                onClick={() => abrirAjuste(p)}
                className="shrink-0 bg-slate-800 text-white h-10 px-4 rounded-xl text-[9px] font-black uppercase active:scale-95 transition-transform shadow-sm flex items-center gap-1.5"
              >
                <i className="fa-solid fa-pen-to-square text-[11px]"></i>Ajustar
              </button>
            </div>
          );
        })}
      </div>

      {/* ===== MODAL: AJUSTAR QUANTIDADE ===== */}
      {editando && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-end justify-center" onClick={() => !busy && setEditando(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <h3 className="text-sm font-black text-gray-800 uppercase text-center"><i className="fa-solid fa-boxes-stacked text-slate-600 mr-1"></i>Ajustar estoque</h3>
            <p className="text-[11px] text-gray-500 font-black text-center mt-1 capitalize truncate">{editando.nome}</p>

            <div className="bg-slate-50 rounded-2xl p-3.5 mt-4 text-center">
              <p className="text-[8px] font-black text-gray-400 uppercase">Quantidade atual</p>
              <p className="text-lg font-black text-gray-800">{editando.estoquePrincipal ?? 0} un</p>
            </div>

            <div className="space-y-1 mt-4">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nova quantidade (un)</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setQtd(q => String(Math.max(0, (parseInt(q, 10) || 0) - 1)))} disabled={busy}
                  className="w-12 h-14 bg-gray-50 border border-gray-100 rounded-2xl text-gray-500 font-black text-lg active:scale-95 transition-transform">−</button>
                <input
                  type="number" inputMode="numeric" min={0}
                  value={qtd}
                  onChange={e => setQtd(e.target.value)}
                  disabled={busy}
                  placeholder="0"
                  className="flex-1 p-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-center text-lg outline-none focus:ring-2 focus:ring-emerald-100"
                />
                <button onClick={() => setQtd(q => String((parseInt(q, 10) || 0) + 1))} disabled={busy}
                  className="w-12 h-14 bg-gray-50 border border-gray-100 rounded-2xl text-gray-500 font-black text-lg active:scale-95 transition-transform">+</button>
              </div>
              <p className="text-[8px] font-bold text-gray-400 uppercase ml-1 mt-1">
                <i className="fa-solid fa-circle-info mr-1"></i>A quantidade atual será substituída (contagem da prateleira).
              </p>
            </div>

            <button
              onClick={salvar}
              disabled={busy}
              className="w-full mt-4 py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {busy ? <i className="fa-solid fa-circle-notch fa-spin mr-1"></i> : <i className="fa-solid fa-check mr-1"></i>}
              {busy ? 'Salvando...' : 'Salvar estoque'}
            </button>
            <button onClick={() => setEditando(null)} disabled={busy} className="w-full mt-2 py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecretarioEstoque;
