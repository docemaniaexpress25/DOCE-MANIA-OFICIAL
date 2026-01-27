import React, { useState } from 'react';
import { User } from '../types';

interface LoginProps {
  users: User[];
  onLogin: (user: User) => void;
  logo: string | null;
}

const Login: React.FC<LoginProps> = ({ users, onLogin, logo }) => {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

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

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    // --- Debug logs START ---
    console.log("PIN digitado:", pin, typeof pin);
    console.log("PIN do usuário:", selectedUser.pin, typeof selectedUser.pin);
    console.log("Usuário selecionado:", selectedUser);
    // --- Debug logs END ---

    // Login agora utiliza APENAS o PIN dinâmico do objeto do usuário,
    // que deve vir do Supabase no campo 'pin'.
    const correctPin = selectedUser.pin;

    if (!correctPin) {
      setError("Erro: PIN de login não configurado para este usuário. Por favor, contate o administrador.");
      setPin("");
      return;
    }

    if (pin === correctPin) {
      onLogin(selectedUser);
    } else {
      setError("PIN incorreto. Tente novamente.");
      setPin("");
    }
  };

  if (selectedUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-blue-600 p-6">
        <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md text-center animate-in zoom-in-95 duration-200">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <i className={`fa-solid ${selectedUser.role === 'ADMIN' ? 'fa-lock' : 'fa-user-shield'} text-blue-600 text-3xl`}></i>
          </div>
          
          <h1 className="text-xl font-black text-gray-800 mb-1">Acesso Restrito</h1>
          <p className="text-gray-400 text-sm mb-8 font-medium">
            Digite o PIN do {selectedUser.role === 'ADMIN' ? 'Administrador' : 'Vendedor'}
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
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-widest"
              >
                Entrar
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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-blue-600 p-6">
      <div className="bg-white p-8 pt-12 rounded-3xl shadow-2xl w-full max-w-md text-center">
        <div className="mb-12 flex justify-center">
          {logo ? (
            <img src={logo} alt="Empresa" className="max-h-48 max-w-full object-contain" />
          ) : (
            <div className="w-40 h-16 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex items-center justify-center opacity-30">
               <span className="text-[10px] font-black uppercase tracking-widest">Logo Empresa</span>
            </div>
          )}
        </div>
        
        <div className="space-y-3">
          {users.map(user => (
            <button
              key={user.id}
              onClick={() => handleSelectUser(user)}
              className="w-full bg-gray-50 hover:bg-blue-50 text-gray-800 font-bold py-4 px-6 rounded-2xl border border-gray-100 flex items-center justify-between transition-all active:scale-95 group"
            >
              <div className="flex flex-col items-start">
                <span className="text-sm">{user.nome}</span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${user.role === 'ADMIN' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                  {user.role}
                </span>
              </div>
              <i className="fa-solid fa-chevron-right text-gray-300 group-hover:text-blue-500 transition-colors"></i>
            </button>
          ))}
        </div>
      </div>
      <p className="text-white text-[10px] mt-8 opacity-50 font-bold uppercase tracking-widest">Base Operacional v1.0</p>
    </div>
  );
};

export default Login;