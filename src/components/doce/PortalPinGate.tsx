"use client";

/**
 * BLOCO 206 (regra do dono) — TELA DE LOGIN ÚNICA DOS PORTAIS.
 *
 * "todos os portais devem ter a mesma tela de login! facil de digitar"
 *
 * Um só visual para TODOS os portais (fiscal, entradas, produtos fiscais,
 * clientes fiscais, notas especiais, produtos/balanço, financeiro, cobranças):
 * bolinhas do PIN + TECLADO NUMÉRICO grande (dedo grande digita sem erro) +
 * shake quando o PIN erra + botão Entrar. Mesma sessão dm_notas_admin_token.
 *
 * Componente CONTROLADO: o portal mantém os estados (pin/pinErro/pinBusy) e
 * passa os handlers — só o VISUAL é padronizado aqui.
 */

interface Props {
  titulo: string;
  subtitulo?: string;
  icone?: string;                       // classe fa (ex.: 'fa-file-invoice-dollar')
  accent?: string;                      // classe bg-* do accent (bolinhas cheias + botão entrar)
  pin: string;
  pinErro?: string;
  pinBusy?: boolean;
  pinShake?: boolean;
  pinLen?: number;                      // default 6 bolinhas
  onDigito: (d: string) => void;
  onApagar: () => void;
  onEntrar: () => void;
}

export default function PortalPinGate({
  titulo,
  subtitulo,
  icone = 'fa-shield-halved',
  accent = 'bg-blue-600',
  pin,
  pinErro,
  pinBusy,
  pinShake,
  pinLen = 6,
  onDigito,
  onApagar,
  onEntrar,
}: Props) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950 p-6">
      <div className={`bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-sm text-center ${pinShake ? 'animate-shake' : ''}`}>
        <div className={`w-20 h-20 ${accent} rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg`}>
          <i className={`fa-solid ${icone} text-white text-3xl`}></i>
        </div>
        <h1 className="text-lg font-black text-gray-800 tracking-tight leading-tight">{titulo}</h1>
        <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mt-1 mb-7">{subtitulo || 'Acesso restrito — mesmo PIN do admin'}</p>

        {/* bolinhas do PIN */}
        <div className="flex justify-center gap-2.5 mb-5" aria-label="PIN digitado">
          {Array.from({ length: pinLen }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${pin.length > i ? `${accent} border-transparent` : 'border-gray-200'}`}
            />
          ))}
        </div>
        {pinErro && <p className="text-rose-500 text-xs font-bold mb-3">{pinErro}</p>}

        {/* teclado numérico — fácil de digitar */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" onClick={() => onDigito(d)} disabled={pinBusy} className="h-14 rounded-2xl bg-gray-50 text-lg font-black text-gray-700 active:scale-95 transition-transform disabled:opacity-50" aria-label={`Digitar ${d}`}>{d}</button>
          ))}
          <button type="button" onClick={onApagar} disabled={pinBusy} className="h-14 rounded-2xl bg-rose-50 text-rose-500 active:scale-95 transition-transform disabled:opacity-50" aria-label="Apagar dígito">
            <i className="fa-solid fa-delete-left"></i>
          </button>
          <button type="button" onClick={() => onDigito('0')} disabled={pinBusy} className="h-14 rounded-2xl bg-gray-50 text-lg font-black text-gray-700 active:scale-95 transition-transform disabled:opacity-50" aria-label="Digitar 0">0</button>
          <button type="button" onClick={onEntrar} disabled={pinBusy || pin.length === 0} className={`h-14 ${accent} text-white text-[11px] font-black uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-50`}>
            {pinBusy ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Entrar'}
          </button>
        </div>
        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">DOCE MANIA · mesmo PIN em todos os portais</p>
      </div>
      <style>{`@keyframes shake { 10%, 90% { transform: translateX(-1px);} 20%, 80% { transform: translateX(2px);} 30%, 50%, 70% { transform: translateX(-4px);} 40%, 60% { transform: translateX(4px);} } .animate-shake { animation: shake 0.5s; }`}</style>
    </div>
  );
}
