"use client";
import React, { useState } from 'react';
import { User } from '@/lib/types';
import { saveSessionToken } from '@/services/userService';

interface LoginProps {
  users: User[];
  onLogin: (user: User) => void;
  logo: string | null;
}

// Acesso oculto do ENTREGADOR (revelado junto ao admin pelos 5 toques no logo).
// Nao consta na lista de usuarios; o PIN e validado no servidor (1234).
const ENTREGADOR_USER: User = {
  id: 'ENTREGADOR',
  nome: 'Entregador',
  email: '',
  role: 'ENTREGADOR',
  ativo: true,
};

const roleLabel = (role: string) =>
  role === 'ADMIN' ? 'Administrador' : role === 'ENTREGADOR' ? 'Entregador' : 'Vendedor';

const roleIcon = (role: string) =>
  role === 'ADMIN' ? 'fa-lock' : role === 'ENTREGADOR' ? 'fa-truck-fast' : 'fa-user-shield';

const Login: React.FC<LoginProps> = ({ users, onLogin, logo }) => {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoClicks, setLogoClicks] = useState(0);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

  const handleSelectUser = (user: User) => {
    setSelectedUser(user);
    setPin("");
    setError("");
  };

  const handleBack = () => {
    setSelectedUser(null);
    setPin("");
    setError("");
  };

  const handleLogoClick = () => {
    const newClicks = logoClicks + 1;
    if (newClicks >= 5) {
      setIsAdminUnlocked(true);
      setLogoClicks(0);
    } else {
      setLogoClicks(newClicks);
    }
    
    // Opcional: Resetar cliques após 3 segundos de inatividade
    setTimeout(() => {
      setLogoClicks(0);
    }, 3000);
  };

  // A validacao do PIN agora acontece NO SERVIDOR (via /api/login).
  // O visual e o fluxo permanecem identicos.
  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || busy) return;

    if (!pin) {
      setError("Digite o PIN.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id, pin }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok && data.user) {
        if (data.token) saveSessionToken(data.token);
        onLogin(data.user);
      } else {
        setError(data.error || "PIN incorreto. Tente novamente.");
        setPin("");
      }
    } catch {
      setError("Falha de conexao. Tente novamente.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (selectedUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-blue-600 p-6">
        <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md text-center animate-in zoom-in-95 duration-200">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <i className={`fa-solid ${roleIcon(selectedUser.role)} text-blue-600 text-3xl`}></i>
          </div>
          
          <h1 className="text-xl font-black text-gray-800 mb-1">Acesso Restrito</h1>
          <p className="text-gray-400 text-sm mb-8 font-medium">
            Digite o PIN do {roleLabel(selectedUser.role)}
          </p>

          <form onSubmit={handleConfirm} className="space-y-6">
            <div className="space-y-2 text-left">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => {
                  setError("");
                  setPin(e.target.value);
                }}
                placeholder="••••••"
                className={`w-full p-5 bg-gray-50 border-2 ${error ? 'border-rose-200 focus:border-rose-500' : 'border-gray-100 focus:border-blue-500'} rounded-2xl text-center text-3xl font-black tracking-[1em] outline-none transition-all shadow-sm`}
                autoFocus
              />
              {error && (
                <p className="text-rose-600 text-[10px] font-black uppercase text-center animate-in fade-in duration-300">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-widest disabled:opacity-60"
              >
                {busy ? 'Verificando...' : 'Entrar'}
              </button>
              <button
                type="button"
                onClick={handleBack}
                className="w-full py-4 text-gray-400 font-black uppercase text-[10px] tracking-[0.2em] hover:text-gray-600"
              >
                Voltar
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Filtra os usuários: se não estiver desbloqueado, remove os administradores da lista
  const visibleUsers = isAdminUnlocked 
    ? users 
    : users.filter(u => u.role !== 'ADMIN');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-blue-600 p-6">
      <div className="bg-white p-8 pt-12 rounded-3xl shadow-2xl w-full max-w-md text-center">
        <div className="mb-12 flex justify-center cursor-pointer active:scale-95 transition-transform" onClick={handleLogoClick}>
          {logo ? (
            <img src={logo} alt="Empresa" className="max-h-48 max-w-full object-contain" />
          ) : (
            <div className="w-40 h-16 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex items-center justify-center opacity-30">
               <span className="text-[10px] font-black uppercase tracking-widest">Logo Empresa</span>
            </div>
          )}
        </div>
        
        <div className="space-y-3">
          {visibleUsers.map(user => (
            <button
              key={user.id}
              onClick={() => handleSelectUser(user)}
              className="w-full bg-gray-50 hover:bg-blue-50 text-gray-800 font-bold py-4 px-6 rounded-2xl border border-gray-100 flex items-center justify-between transition-all active:scale-95 group"
            >
              <div className="flex flex-col items-start">
                <span className="text-sm">{user.nome}</span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${user.role === 'ADMIN' ? 'bg-orange-100 text-orange-600' : user.role === 'ENTREGADOR' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                  {user.role}
                </span>
              </div>
              <i className="fa-solid fa-chevron-right text-gray-300 group-hover:text-blue-500 transition-colors"></i>
            </button>
          ))}
          {/* ENTREGADOR: liberado junto com o admin (5 toques no logo) */}
          {isAdminUnlocked && (
            <button
              onClick={() => handleSelectUser(ENTREGADOR_USER)}
              className="w-full bg-emerald-50 hover:bg-emerald-100 text-gray-800 font-bold py-4 px-6 rounded-2xl border border-emerald-100 flex items-center justify-between transition-all active:scale-95 group"
            >
              <div className="flex flex-col items-start">
                <span className="text-sm">Entregador</span>
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-600">
                  Rota de entrega
                </span>
              </div>
              <i className="fa-solid fa-truck-fast text-emerald-400 group-hover:text-emerald-500 transition-colors"></i>
            </button>
          )}
          {!isAdminUnlocked && users.some(u => u.role === 'ADMIN') && (
             <div className="pt-2">
                <div className="w-full h-1 bg-gray-50 rounded-full overflow-hidden opacity-20">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-300" 
                    style={{ width: `${(logoClicks / 5) * 100}%` }}
                  ></div>
                </div>
             </div>
          )}
        </div>
      </div>
      <p className="text-white text-[10px] mt-8 opacity-50 font-bold uppercase tracking-widest">Base Operacional v1.0</p>
    </div>
  );
};

export default Login;