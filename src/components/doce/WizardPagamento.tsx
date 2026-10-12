"use client";
import React, { useMemo, useState } from 'react';

/**
 * BLOCO 27 — ROTA 2: wizard guiado de fechamento da venda (teste).
 * Regra do dono: DINHEIRO na entrega e SOMENTE A VISTA (a vista = cliente ja
 * pagou na visita); A PRAZO NAO tem dinheiro na entrega — quem cobra e o
 * VENDEDOR na hora da venda (para ter capital e fazer nova venda).
 * So aparece para vendedores com a flag rota2 ligada; demais perfis usam a
 * tela de pagamento antiga intocada.
 */

export interface WizardPayload {
  condicao: 'AVISTA' | 'APRAZO';
  forma: 'DINHEIRO' | 'PIX' | 'MISTO' | 'BOLETO' | 'CHEQUE' | 'PIX_DATA';
  /** A vista dinheiro: quanto o cliente entregou agora (gera troco) */
  valorRecebido?: number;
  pixSlot?: 1 | 2;
  mistoDinheiro?: number;
  mistoPix?: number;
  /** A prazo: vencimento combinado (boleto, pix na data) */
  vencimento?: string;
  chequeNumero?: string;
  chequeBomPara?: string;
  notaIntencao: 'NENHUMA' | 'NFE' | 'NFCE';
  nfcCpf?: string;
}

interface WizardPagamentoProps {
  total: number;
  isPreVenda: boolean;
  clienteAptoNfe: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
  /** Mascarador de CPF importado do PDV para nao duplicar util */
  mascararCpf?: (v: string) => string;
  onConfirm: (payload: WizardPayload) => void;
  onVoltar: () => void;
  /** Mensagem de erro vinda do PDV (falha ao salvar etc.) — mostra no resumo */
  erro?: string | null;
}

const fmt = (v: number) => `R$ ${v.toFixed(2)}`;
const dataBr = (iso?: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const somaDias = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const PASSOS = ['CONDIÇÃO', 'FORMA', 'NOTA', 'RESUMO'];

const WizardPagamento: React.FC<WizardPagamentoProps> = ({
  total, isPreVenda, clienteAptoNfe,
  pix1Name, pix1Code, pix2Name, pix2Code,
  mascararCpf,
  onConfirm, onVoltar, erro,
}) => {
  const [passo, setPasso] = useState(0);
  const [condicao, setCondicao] = useState<'AVISTA' | 'APRAZO'>('AVISTA');
  const [forma, setForma] = useState<'DINHEIRO' | 'PIX' | 'MISTO' | 'BOLETO' | 'CHEQUE' | 'PIX_DATA'>('DINHEIRO');
  const [valorRecebido, setValorRecebido] = useState('');
  const [pixSlot, setPixSlot] = useState<1 | 2>(1);
  const [mistoDinheiro, setMistoDinheiro] = useState('');
  const [mistoPix, setMistoPix] = useState('');
  const [vencimento, setVencimento] = useState(somaDias(7));
  const [vencAtalho, setVencAtalho] = useState<number | null>(7);
  const [chequeNumero, setChequeNumero] = useState('');
  const [chequeBomPara, setChequeBomPara] = useState(somaDias(7));
  const [notaIntencao, setNotaIntencao] = useState<'NENHUMA' | 'NFE' | 'NFCE'>('NENHUMA');
  const [nfcCpf, setNfcCpf] = useState('');
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const troco = useMemo(() => Math.max(0, (parseFloat(valorRecebido) || 0) - total), [valorRecebido, total]);
  const md = parseFloat(mistoDinheiro) || 0;
  const mp = parseFloat(mistoPix) || 0;
  const mistoFalta = Math.round((total - md - mp) * 100) / 100;

  const formaLabel = condicao === 'AVISTA'
    ? (forma === 'DINHEIRO' ? 'Dinheiro' : forma === 'PIX' ? 'Pix' : 'Misto (dinheiro + Pix)')
    : (forma === 'BOLETO' ? 'Boleto' : forma === 'CHEQUE' ? 'Cheque' : 'Pix na data');

  const avisoChave = condicao === 'AVISTA'
    ? (isPreVenda
      ? { icon: 'fa-circle-check', cor: 'emerald', titulo: 'CLIENTE JÁ PAGOU NA VISITA', texto: `Recebeu ${formaLabel} agora. O entregador SÓ ENTREGA — nada a cobrar na entrega.` }
      : { icon: 'fa-money-bill-wave', cor: 'emerald', titulo: 'RECEBIMENTO NA VISITA', texto: `Dinheiro na entrega é somente À VISTA — o cliente paga agora, com você.` })
    : { icon: 'fa-user-clock', cor: 'amber', titulo: 'QUEM COBRA É VOCÊ, VENDEDOR', texto: `Sem dinheiro na entrega. Você cobra ${formaLabel} no vencimento ${dataBr(vencimento)} para ter capital e fazer nova venda.` };

  const proximo = () => {
    setErroLocal(null);
    if (passo === 0) {
      setPasso(1);
      return;
    }
    if (passo === 1) {
      if (condicao === 'AVISTA') {
        if (forma === 'DINHEIRO') {
          const rec = parseFloat(valorRecebido) || 0;
          if (rec <= 0) return setErroLocal('Digite o valor recebido do cliente.');
          if (rec + 0.001 < total) return setErroLocal(`Valor recebido (${fmt(rec)}) é menor que o total (${fmt(total)}).`);
        }
        if (forma === 'MISTO' && Math.abs(mistoFalta) > 0.009) {
          return setErroLocal(`Dinheiro + Pix precisa fechar o total: falta ${fmt(Math.abs(mistoFalta))} (ou passou).`);
        }
      }
      setPasso(2);
      return;
    }
    if (passo === 2) {
      if (notaIntencao === 'NFE' && !clienteAptoNfe) {
        return setErroLocal('NF-e exige CNPJ completo no cadastro do cliente. Escolha SÓ CUPOM ou NFC-e.');
      }
      setPasso(3);
      return;
    }
  };

  const confirmar = () => {
    setErroLocal(null);
    const payload: WizardPayload = {
      condicao,
      forma: condicao === 'AVISTA' ? forma : (forma === 'PIX' ? 'PIX_DATA' : forma),
      notaIntencao,
    };
    if (condicao === 'AVISTA') {
      if (forma === 'DINHEIRO') payload.valorRecebido = parseFloat(valorRecebido) || 0;
      if (forma === 'PIX') payload.pixSlot = pixSlot;
      if (forma === 'MISTO') { payload.mistoDinheiro = md; payload.mistoPix = mp; payload.valorRecebido = md; }
    } else {
      payload.vencimento = vencimento;
      if (forma === 'CHEQUE') {
        payload.chequeNumero = chequeNumero.trim();
        payload.chequeBomPara = chequeBomPara;
      }
    }
    if (notaIntencao === 'NFCE' && nfcCpf.trim()) {
      payload.nfcCpf = nfcCpf.replace(/\D/g, '');
    }
    onConfirm(payload);
  };

  const erroMostrar = erro || erroLocal;

  return (
    <div className="animate-in fade-in duration-300">
      {/* ===== STEPPER ===== */}
      <div className="flex items-center justify-center gap-1 mb-5">
        {PASSOS.map((label, i) => (
          <React.Fragment key={label}>
            <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[8px] font-black uppercase tracking-wide transition-all ${i === passo ? 'bg-violet-600 text-white shadow-md' : i < passo ? 'bg-violet-50 text-violet-500' : 'bg-gray-50 text-gray-300'}`}>
              {i < passo ? <i className="fa-solid fa-check text-[7px]"></i> : <span className="font-black">{i + 1}</span>}
              <span className="hidden sm:inline">{label}</span>
            </div>
            {i < PASSOS.length - 1 && <div className={`w-2 h-0.5 rounded ${i < passo ? 'bg-violet-300' : 'bg-gray-100'}`}></div>}
          </React.Fragment>
        ))}
      </div>

      {/* ===== PASSO 1: CONDICAO ===== */}
      {passo === 0 && (
        <div className="space-y-3 mb-5">
          <p className="text-[9px] font-black text-gray-400 uppercase text-center">1. Como o cliente vai pagar?</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setCondicao('AVISTA'); setForma('DINHEIRO'); }}
              className={`p-4 rounded-2xl border-2 text-left transition-all ${condicao === 'AVISTA' ? 'border-emerald-500 bg-emerald-50 shadow-md' : 'border-gray-100 bg-gray-50'}`}>
              <i className={`fa-solid fa-money-bill-wave text-lg ${condicao === 'AVISTA' ? 'text-emerald-600' : 'text-gray-300'}`}></i>
              <p className={`text-[11px] font-black uppercase mt-1 ${condicao === 'AVISTA' ? 'text-emerald-700' : 'text-gray-400'}`}>À vista</p>
              <p className="text-[8px] font-bold text-gray-400 leading-snug mt-0.5">Cliente paga AGORA com você</p>
            </button>
            <button onClick={() => { setCondicao('APRAZO'); setForma('BOLETO'); }}
              className={`p-4 rounded-2xl border-2 text-left transition-all ${condicao === 'APRAZO' ? 'border-amber-500 bg-amber-50 shadow-md' : 'border-gray-100 bg-gray-50'}`}>
              <i className={`fa-regular fa-calendar text-lg ${condicao === 'APRAZO' ? 'text-amber-600' : 'text-gray-300'}`}></i>
              <p className={`text-[11px] font-black uppercase mt-1 ${condicao === 'APRAZO' ? 'text-amber-700' : 'text-gray-400'}`}>A prazo</p>
              <p className="text-[8px] font-bold text-gray-400 leading-snug mt-0.5">Você cobra na data combinada</p>
            </button>
          </div>
          <div className={`rounded-2xl p-3.5 text-center border ${condicao === 'APRAZO' ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <p className={`text-[9px] font-black uppercase ${condicao === 'APRAZO' ? 'text-amber-700' : 'text-emerald-700'}`}>
              <i className={`fa-solid ${condicao === 'APRAZO' ? 'fa-user-clock' : 'fa-circle-check'} mr-1`}></i>
              {condicao === 'APRAZO' ? 'SEM DINHEIRO NA ENTREGA' : 'DINHEIRO SÓ NA VISITA'}
            </p>
            <p className={`text-[8px] font-semibold mt-0.5 ${condicao === 'APRAZO' ? 'text-amber-600/80' : 'text-emerald-600/70'}`}>
              {condicao === 'APRAZO' ? 'Regra: quem cobra é o VENDEDOR na hora — para ter capital e fazer nova venda.' : 'Na entrega não há cobrança: cliente já pagou (ou paga) na visita.'}
            </p>
          </div>
        </div>
      )}

      {/* ===== PASSO 2: FORMA ===== */}
      {passo === 1 && condicao === 'AVISTA' && (
        <div className="space-y-3 mb-5">
          <p className="text-[9px] font-black text-gray-400 uppercase text-center">2. Forma do pagamento agora</p>
          <div className="grid grid-cols-3 gap-2">
            {(['DINHEIRO', 'PIX', 'MISTO'] as const).map(f => (
              <button key={f} onClick={() => setForma(f)}
                className={`py-3 rounded-xl text-[9px] font-black uppercase transition-all border-2 ${forma === f ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                {f === 'DINHEIRO' ? 'Dinheiro' : f === 'PIX' ? 'Pix' : 'Misto'}
              </button>
            ))}
          </div>

          {forma === 'DINHEIRO' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor recebido</label>
              <input type="number" inputMode="decimal" value={valorRecebido} onChange={e => setValorRecebido(e.target.value)} placeholder="0.00" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black text-center outline-none" autoFocus />
              {troco > 0 && (
                <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100 text-center">
                  <p className="text-[9px] font-black text-emerald-600 uppercase">Troco a devolver</p>
                  <p className="text-xl font-black text-emerald-700">{fmt(troco)}</p>
                </div>
              )}
            </div>
          )}

          {forma === 'PIX' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <p className="text-[9px] font-black text-gray-400 uppercase text-center">Chave Pix que recebe</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setPixSlot(1)} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${pixSlot === 1 ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-100 text-gray-400'}`}>{pix1Name}</button>
                <button onClick={() => setPixSlot(2)} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${pixSlot === 2 ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-100 text-gray-400'}`}>{pix2Name}</button>
              </div>
              <div className="bg-gray-50 p-3 rounded-2xl flex items-center justify-center border border-gray-100">
                <div className="w-28 h-28 bg-white rounded-xl flex items-center justify-center border border-gray-200 overflow-hidden">
                  {pixSlot === 1 ? (pix1Code ? <img src={pix1Code} alt="QR Pix" className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-3xl"></i>) : (pix2Code ? <img src={pix2Code} alt="QR Pix" className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-3xl"></i>)}
                </div>
              </div>
            </div>
          )}

          {forma === 'MISTO' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <p className="text-[9px] font-black text-gray-400 uppercase text-center">Parte em dinheiro + parte em Pix (soma = total)</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase ml-1">Dinheiro</label>
                  <input type="number" inputMode="decimal" value={mistoDinheiro} onChange={e => setMistoDinheiro(e.target.value)} placeholder="0.00" className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-base font-black text-center outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-gray-400 uppercase ml-1">Pix</label>
                  <input type="number" inputMode="decimal" value={mistoPix} onChange={e => setMistoPix(e.target.value)} placeholder="0.00" className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-base font-black text-center outline-none" />
                </div>
              </div>
              <div className={`p-3 rounded-2xl text-center border text-[10px] font-black ${Math.abs(mistoFalta) < 0.01 ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                {Math.abs(mistoFalta) < 0.01 ? 'FECHA O TOTAL ✓' : `Falta: ${fmt(Math.abs(mistoFalta))}`}
              </div>
            </div>
          )}
        </div>
      )}

      {passo === 1 && condicao === 'APRAZO' && (
        <div className="space-y-3 mb-5">
          <p className="text-[9px] font-black text-gray-400 uppercase text-center">2. Como você vai cobrar depois?</p>
          <div className="grid grid-cols-3 gap-2">
            {(['BOLETO', 'CHEQUE', 'PIX'] as const).map(f => (
              <button key={f} onClick={() => setForma(f)}
                className={`py-3 rounded-xl text-[9px] font-black uppercase transition-all border-2 ${forma === f ? 'bg-amber-500 text-white border-amber-500 shadow-md' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                {f === 'BOLETO' ? 'Boleto' : f === 'CHEQUE' ? 'Cheque' : 'Pix na data'}
              </button>
            ))}
          </div>
          <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 text-center">
            <p className="text-[9px] font-black text-rose-700 uppercase"><i className="fa-solid fa-ban mr-1"></i>Sem dinheiro no a prazo</p>
            <p className="text-[8px] text-rose-500 font-semibold mt-0.5">Regra do dono: o dinheiro do prazo você cobra na data — nunca na entrega.</p>
          </div>

          {forma === 'CHEQUE' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Número do cheque</label>
              <input value={chequeNumero} onChange={e => setChequeNumero(e.target.value)} placeholder="Ex: 000123" inputMode="numeric" className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black text-center outline-none" />
              <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Bom para</label>
              <input type="date" value={chequeBomPara} onChange={e => { setChequeBomPara(e.target.value); setVencimento(e.target.value); setVencAtalho(null); }} className="w-full p-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-center outline-none" />
            </div>
          )}

          {forma === 'BOLETO' && (
            <div className="space-y-2 animate-in fade-in duration-200">
              <p className="text-[9px] font-black text-gray-400 uppercase text-center">Vencimento do boleto</p>
              <div className="grid grid-cols-4 gap-2">
                {[7, 14, 21, 30].map(d => (
                  <button key={d} onClick={() => { setVencAtalho(d); setVencimento(somaDias(d)); }} className={`py-2.5 rounded-xl text-[10px] font-black transition-all ${vencAtalho === d ? 'bg-amber-500 text-white shadow-md scale-105' : 'bg-gray-50 border-2 border-gray-100 text-gray-500'}`}>{d}D</button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Data de vencimento</label>
            <input type="date" value={vencimento} onChange={e => { setVencimento(e.target.value); setVencAtalho(null); }} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black text-center outline-none" />
          </div>
        </div>
      )}

      {/* ===== PASSO 3: NOTA ===== */}
      {passo === 2 && (
        <div className="space-y-3 mb-5">
          <p className="text-[9px] font-black text-gray-400 uppercase text-center">3. Quer nota fiscal nesta venda?</p>
          <div className="space-y-2">
            <button onClick={() => setNotaIntencao('NENHUMA')}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${notaIntencao === 'NENHUMA' ? 'border-violet-500 bg-violet-50 shadow-md' : 'border-gray-100 bg-gray-50'}`}>
              <p className={`text-[11px] font-black uppercase ${notaIntencao === 'NENHUMA' ? 'text-violet-700' : 'text-gray-400'}`}><i className="fa-solid fa-receipt mr-1"></i>Só cupom (sem nota)</p>
              <p className="text-[8px] font-bold text-gray-400 mt-0.5">Fluxo comum — cupom não fiscal</p>
            </button>
            <button onClick={() => setNotaIntencao(clienteAptoNfe ? 'NFE' : notaIntencao)}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${notaIntencao === 'NFE' ? 'border-slate-700 bg-slate-50 shadow-md' : 'border-gray-100 bg-gray-50'} ${!clienteAptoNfe ? 'opacity-50' : ''}`}
              disabled={!clienteAptoNfe}>
              <p className={`text-[11px] font-black uppercase ${notaIntencao === 'NFE' ? 'text-slate-800' : 'text-gray-400'}`}><i className="fa-solid fa-file-invoice-dollar mr-1"></i>Com NF-e {clienteAptoNfe ? '' : '(cliente sem CNPJ completo)'}</p>
              <p className="text-[8px] font-bold text-gray-400 mt-0.5">Nota eletrônica para o CNPJ do cadastro</p>
            </button>
            <button onClick={() => setNotaIntencao('NFCE')}
              className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${notaIntencao === 'NFCE' ? 'border-blue-600 bg-blue-50 shadow-md' : 'border-gray-100 bg-gray-50'}`}>
              <p className={`text-[11px] font-black uppercase ${notaIntencao === 'NFCE' ? 'text-blue-700' : 'text-gray-400'}`}><i className="fa-solid fa-file-lines mr-1"></i>Com NFC-e</p>
              <p className="text-[8px] font-bold text-gray-400 mt-0.5">Cupom fiscal — CPF do consumidor (opcional)</p>
            </button>
            {notaIntencao === 'NFCE' && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 space-y-2 animate-in fade-in duration-200">
                <p className="text-[9px] font-black text-blue-600 uppercase">Cliente quer CPF na nota? (opcional)</p>
                <input value={nfcCpf} onChange={e => setNfcCpf(mascararCpf ? mascararCpf(e.target.value) : e.target.value)} placeholder="000.000.000-00" inputMode="numeric" className="w-full p-3 bg-white border rounded-xl font-bold text-sm" />
              </div>
            )}
          </div>
          <p className="text-[8px] font-bold text-gray-300 text-center leading-snug">A nota é emitida ao final da venda (mesmo fluxo de sempre). Sem escolha = cupom não fiscal.</p>
        </div>
      )}

      {/* ===== PASSO 4: RESUMO ===== */}
      {passo === 3 && (
        <div className="space-y-3 mb-5">
          <p className="text-[9px] font-black text-gray-400 uppercase text-center">4. Confira e confirme</p>
          <div className="bg-gray-50 border border-gray-100 rounded-2xl divide-y divide-gray-100">
            <div className="p-3.5 flex items-center justify-between">
              <span className="text-[9px] font-black text-gray-400 uppercase">Condição</span>
              <span className="text-[11px] font-black text-gray-700 uppercase">{condicao === 'AVISTA' ? 'À vista' : 'A prazo'}</span>
            </div>
            <div className="p-3.5 flex items-center justify-between">
              <span className="text-[9px] font-black text-gray-400 uppercase">Forma</span>
              <span className="text-[11px] font-black text-gray-700 uppercase">{formaLabel}</span>
            </div>
            {condicao === 'AVISTA' && forma === 'DINHEIRO' && (
              <div className="p-3.5 flex items-center justify-between">
                <span className="text-[9px] font-black text-gray-400 uppercase">Recebido / troco</span>
                <span className="text-[11px] font-black text-gray-700">{fmt(parseFloat(valorRecebido) || 0)} {troco > 0 ? <span className="text-emerald-600">(troco {fmt(troco)})</span> : null}</span>
              </div>
            )}
            {condicao === 'AVISTA' && forma === 'MISTO' && (
              <div className="p-3.5 flex items-center justify-between">
                <span className="text-[9px] font-black text-gray-400 uppercase">Misto</span>
                <span className="text-[11px] font-black text-gray-700">{fmt(md)} + Pix {fmt(mp)}</span>
              </div>
            )}
            {condicao === 'APRAZO' && (
              <div className="p-3.5 flex items-center justify-between">
                <span className="text-[9px] font-black text-gray-400 uppercase">Vencimento</span>
                <span className="text-[11px] font-black text-gray-700">{dataBr(vencimento)}</span>
              </div>
            )}
            {condicao === 'APRAZO' && forma === 'CHEQUE' && (
              <div className="p-3.5 flex items-center justify-between">
                <span className="text-[9px] font-black text-gray-400 uppercase">Cheque nº</span>
                <span className="text-[11px] font-black text-gray-700">{chequeNumero.trim() || '—'}</span>
              </div>
            )}
            <div className="p-3.5 flex items-center justify-between">
              <span className="text-[9px] font-black text-gray-400 uppercase">Nota</span>
              <span className="text-[11px] font-black text-gray-700 uppercase">{notaIntencao === 'NENHUMA' ? 'Só cupom' : notaIntencao === 'NFE' ? 'NF-e' : 'NFC-e'}</span>
            </div>
            <div className="p-3.5 flex items-center justify-between bg-white">
              <span className="text-[10px] font-black text-gray-400 uppercase">Total</span>
              <span className="text-lg font-black text-gray-800">{fmt(total)}</span>
            </div>
          </div>

          <div className={`rounded-2xl p-3.5 text-center border ${avisoChave.cor === 'emerald' ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
            <p className={`text-[10px] font-black uppercase ${avisoChave.cor === 'emerald' ? 'text-emerald-700' : 'text-amber-700'}`}>
              <i className={`fa-solid ${avisoChave.icon} mr-1`}></i>{avisoChave.titulo}
            </p>
            <p className={`text-[9px] font-semibold mt-1 leading-snug ${avisoChave.cor === 'emerald' ? 'text-emerald-600/80' : 'text-amber-600/80'}`}>{avisoChave.texto}</p>
          </div>
        </div>
      )}

      {/* ===== ERRO ===== */}
      {erroMostrar && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 mb-4 animate-in fade-in duration-200">
          <p className="text-[10px] font-black text-rose-700 uppercase leading-snug"><i className="fa-solid fa-circle-exclamation mr-1"></i>{erroMostrar}</p>
        </div>
      )}

      {/* ===== NAVEGACAO ===== */}
      <div className="flex gap-2">
        {passo > 0 && (
          <button onClick={() => { setErroLocal(null); setPasso(p => p - 1); }} className="px-5 py-4 rounded-2xl bg-gray-100 text-gray-500 font-black uppercase text-[10px] tracking-widest active:scale-95 transition-all">
            <i className="fa-solid fa-arrow-left mr-1"></i>Voltar
          </button>
        )}
        {passo < 3 ? (
          <button onClick={proximo} className="flex-1 py-4 rounded-2xl bg-violet-600 text-white font-black uppercase text-xs tracking-widest shadow-lg active:scale-95 transition-all">
            {passo === 0 ? 'Começar' : 'Continuar'}<i className="fa-solid fa-arrow-right ml-2"></i>
          </button>
        ) : (
          <button onClick={confirmar} className="flex-1 py-4 rounded-2xl bg-emerald-600 text-white font-black uppercase text-xs tracking-widest shadow-lg active:scale-95 transition-all">
            {isPreVenda ? 'Registrar Pedido' : 'Concluir Venda'}<i className="fa-solid fa-check ml-2"></i>
          </button>
        )}
      </div>
      <button onClick={onVoltar} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Voltar ao Cupom</button>
    </div>
  );
};

export default WizardPagamento;
