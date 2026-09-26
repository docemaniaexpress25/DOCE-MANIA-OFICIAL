"use client";
import React, { useState, useEffect, useRef } from 'react';
import { User } from '@/lib/types';
import { authHeaders } from '@/services/userService';
import FilaEntregas from '@/components/doce/FilaEntregas';

/**
 * BLOCO 13 — ADMIN: fila continua de entregas.
 * O admin ve TODA a fila (P1/P2/antiguidade), pode priorizar, entregar,
 * cancelar pedidos falhados e CONFIRMAR o fechamento de caixa do entregador.
 * Mantem a configuracao da taxa de comissao de pre-venda.
 */

const AdminEntregas: React.FC<{ user?: User; showToast?: (m: string, t?: 'success' | 'error') => void }> = ({ user, showToast }) => {
  // Taxa da comissao de pre-venda (admin)
  const [comissaoPct, setComissaoPct] = useState<string>('');
  const [salvandoPct, setSalvandoPct] = useState(false);
  const [msg, setMsg] = useState<{ t: 'success' | 'error'; m: string } | null>(null);
  const mounted = useRef(true);

  const aviso = (m: string, t: 'success' | 'error' = 'success') => {
    setMsg({ t, m });
    setTimeout(() => setMsg(null), 4000);
  };

  useEffect(() => {
    fetch('/api/pre-venda?config=1', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (mounted.current && d.comissaoPct != null) setComissaoPct(String(d.comissaoPct)); })
      .catch(() => {});
  }, []);

  async function salvarPct() {
    const v = Number(comissaoPct);
    if (!isFinite(v) || v <= 0 || v > 100) { aviso('Informe um percentual entre 1 e 100.', 'error'); return; }
    setSalvandoPct(true);
    try {
      const res = await fetch('/api/pre-venda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'SET_CONFIG', comissaoPct: v }),
      });
      const d = await res.json();
      if (res.ok && d.ok) aviso(`Taxa da pre-venda salva: ${v}% da comissao normal.`);
      else aviso(d.error || 'Nao foi possivel salvar (Bloco 7 rodou no Supabase?).', 'error');
    } catch { aviso('Sem conexao. Tente novamente.', 'error'); }
    finally { if (mounted.current) setSalvandoPct(false); }
  }

  const toastFn = showToast || ((m: string, t?: 'success' | 'error') => aviso(m, t || 'success'));

  return (
    <div className="space-y-4">
      <FilaEntregas user={user || { id: 'ADMIN', nome: 'Admin', email: '', role: 'ADMIN', ativo: true }} showToast={toastFn} modo="ADMIN" />

      {/* ===== TAXA DE COMISSAO DA PRE-VENDA ===== */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 print:hidden">
        <p className="text-[10px] font-black text-gray-700 uppercase mb-1"><i className="fa-solid fa-percent mr-1.5 text-gray-300"></i>Comissão da pré-venda</p>
        <p className="text-[9px] text-gray-400 font-semibold mb-2 leading-snug">
          Percentual da comissão normal que o vendedor recebe por vendas de pré-venda (paga só quando a entrega é confirmada).
        </p>
        <div className="flex gap-2">
          <input
            type="number" value={comissaoPct} onChange={e => setComissaoPct(e.target.value)}
            placeholder="50" className="flex-1 p-3 bg-gray-50 border border-gray-100 rounded-xl text-[12px] font-black text-center outline-none"
          />
          <button onClick={salvarPct} disabled={salvandoPct}
            className="px-5 py-3 bg-slate-800 text-white rounded-xl text-[9px] font-black uppercase active:scale-95 disabled:opacity-60">
            {salvandoPct ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`fixed bottom-6 left-4 right-4 max-w-lg mx-auto z-[300] px-4 py-3 rounded-2xl font-black text-[10px] uppercase text-center shadow-xl ${msg.t === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          {msg.m}
        </div>
      )}
    </div>
  );
};

export default AdminEntregas;
