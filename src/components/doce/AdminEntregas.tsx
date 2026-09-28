"use client";
import React, { useState } from 'react';
import { User } from '@/lib/types';
import FilaEntregas from '@/components/doce/FilaEntregas';

/**
 * BLOCO 13 — ADMIN: fila continua de entregas.
 * O admin ve TODA a fila (P1/P2/antiguidade), pode priorizar, entregar,
 * cancelar pedidos falhados e CONFIRMAR o fechamento de caixa do entregador.
 * (A taxa padrão da comissão de pré-venda ficou na aba Configurações — Bloco 14;
 * por produto, o % fica no cadastro do produto em Estoque.)
 */

const AdminEntregas: React.FC<{ user?: User; showToast?: (m: string, t?: 'success' | 'error') => void }> = ({ user, showToast }) => {
  const [msg, setMsg] = useState<{ t: 'success' | 'error'; m: string } | null>(null);

  const aviso = (m: string, t: 'success' | 'error' = 'success') => {
    setMsg({ t, m });
    setTimeout(() => setMsg(null), 4000);
  };

  const toastFn = showToast || ((m: string, t?: 'success' | 'error') => aviso(m, t || 'success'));

  return (
    <div className="space-y-4">
      <FilaEntregas user={user || { id: 'ADMIN', nome: 'Admin', email: '', role: 'ADMIN', ativo: true }} showToast={toastFn} modo="ADMIN" />

      {msg && (
        <div className={`fixed bottom-6 left-4 right-4 max-w-lg mx-auto z-[300] px-4 py-3 rounded-2xl font-black text-[10px] uppercase text-center shadow-xl ${msg.t === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          {msg.m}
        </div>
      )}
    </div>
  );
};

export default AdminEntregas;
