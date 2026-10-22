'use client';

import { useState, useEffect } from 'react';
import { boletoService, BoletoInfo } from '@/services/boletoService';
import { validaCpfCnpj } from '@/lib/validaDoc';

/**
 * BLOCO 25 (ajuste "o dono nao achou o botao"): card do BOLETO BANCARIO INTER
 * (boleto + pix) extraido do Cupom para aparecer em DUAS telas:
 *  1. Modal "Venda Finalizada / Pedido Registrado!" do PDV — logo apos salvar
 *     a venda (era aqui que o dono procurava e nao achava);
 *  2. Cupom da venda salva (reaberto pelo historico / "Ver / Imprimir cupom").
 *
 * Comportamento identico ao original do Cupom: badge por situacao, form de
 * geracao (valor pre-preenchido com o saldo em aberto, vencimento +7d, campo
 * CPF/CNPJ do pagador quando o cliente nao tem documento no cadastro, checkbox
 * ATRELAR NF-e quando a nota esta AUTORIZADA), linha digitavel e PIX copia-e-
 * cola tocaveis, PDF (blob) e WhatsApp. Renderiza NULL quando o SQL do Bloco
 * 25 / credenciais do Inter nao estao configurados (API responde 503).
 */

interface BoletoCardProps {
  saleId: string;
  valorTotal: number;
  valorPago: number;
  notaStatus?: string;        // 'AUTORIZADA' habilita o "Atrelar NF-e"
  notaNumero?: number | string;
  clienteDoc?: string;        // CPF/CNPJ do cliente no cadastro
  clienteCep?: string;        // CEP do cliente no cadastro (Inter exige)
  clienteTelefone?: string;   // para o WhatsApp
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

const dataBR = (iso?: string) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const BoletoCard: React.FC<BoletoCardProps> = ({ saleId, valorTotal, valorPago, notaStatus, notaNumero, clienteDoc, clienteCep, clienteTelefone, showToast }) => {
  const [boleto, setBoleto] = useState<BoletoInfo | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(false);
  const [valor, setValor] = useState('');
  const [venc, setVenc] = useState('');
  const [atrelar, setAtrelar] = useState(true);
  const [doc, setDoc] = useState('');
  const [cep, setCep] = useState('');
  const [erroLocal, setErroLocal] = useState('');

  useEffect(() => {
    if (!saleId) return;
    let vivo = true;
    (async () => {
      const r = await boletoService.status(saleId);
      if (!vivo) return;
      if (!r.ok) { setIndisponivel(true); return; } // SQL/Inter nao configurado: esconde a secao
      setBoleto(r.boleto || null);
      if (r.boleto?.status === 'NAO_GERADO') {
        const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        setVenc(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
        const saldo = Math.max(0, (valorTotal || 0) - (valorPago || 0));
        setValor(saldo > 0 ? saldo.toFixed(2) : (valorTotal || 0).toFixed(2));
      }
    })();
    return () => { vivo = false; };
  }, [saleId]);

  const handleGerar = async () => {
    if (busy || !saleId) return;
    setErroLocal('');
    // Validacao local (evita a mensagem generica do Inter e poupa a chamada):
    const docFinal = doc.replace(/\D/g, '') || (clienteDoc || '').replace(/\D/g, '');
    if (!docFinal) {
      setErroLocal('Informe o CPF/CNPJ do pagador.');
      showToast?.('Informe o CPF/CNPJ do pagador.', 'error');
      return;
    }
    if (!validaCpfCnpj(docFinal)) {
      setErroLocal('CPF/CNPJ inválido — confira os números (CPF tem 11 dígitos, CNPJ tem 14).');
      showToast?.('CPF/CNPJ do pagador inválido.', 'error');
      return;
    }
    const cepFinal = cep.replace(/\D/g, '') || (clienteCep || '').replace(/\D/g, '');
    if (cepFinal.length !== 8) {
      setErroLocal('O boleto do Inter precisa do CEP do pagador (8 dígitos). Informe abaixo ou complete no cadastro do cliente.');
      showToast?.('Informe o CEP do pagador (8 dígitos).', 'error');
      return;
    }
    setBusy(true);
    const r = await boletoService.gerar(saleId, {
      vencimento: venc,
      valor: valor || undefined,
      atrelarNFe: atrelar,
      docManual: doc || undefined,
      cepManual: cep || undefined,
    });
    setBusy(false);
    if (r.erro && !r.boleto) {
      setErroLocal(r.erro);
      showToast?.(r.erro, 'error');
      return;
    }
    if (r.boleto) setBoleto(r.boleto);
    setForm(false);
    if (r.ok && r.boleto) {
      if (r.boleto.status === 'EM_PROCESSAMENTO') {
        showToast?.('Boleto gerado! O Inter esta processando...', 'success');
        setTimeout(async () => {
          const c = await boletoService.consultar(saleId);
          if (c.ok && c.boleto) setBoleto(c.boleto);
        }, 4000);
      } else {
        showToast?.('Boleto gerado!', 'success');
      }
    }
  };

  const handleConsultar = async () => {
    if (busy || !saleId) return;
    setBusy(true);
    const r = await boletoService.consultar(saleId);
    setBusy(false);
    if (r.erro && !r.boleto) { showToast?.(r.erro, 'error'); return; }
    if (r.boleto) setBoleto(r.boleto);
  };

  const handlePdf = async () => {
    if (busy || !saleId) return;
    setBusy(true);
    const r = await boletoService.abrirPdf(saleId);
    setBusy(false);
    if (!r.ok && r.erro) showToast?.(r.erro, 'error');
  };

  const handleCopiarTexto = async (txt: string, rotulo: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast?.(`${rotulo} copiado!`, 'success');
    } catch { showToast?.('Falha ao copiar.', 'error'); }
  };

  const handleWhats = () => {
    if (!boleto) return;
    const linhas = [
      '*BOLETO DOCE MANIA*',
      boleto.valor ? `Valor: R$ ${Number(boleto.valor).toFixed(2)}` : '',
      boleto.vencimento ? `Vencimento: ${dataBR(boleto.vencimento)}` : '',
      boleto.linhaDigitavel ? `Linha digitavel:\n${boleto.linhaDigitavel}` : '',
      boleto.pixCopiaECola ? `PIX (copia e cola):\n${boleto.pixCopiaECola}` : '',
    ].filter(Boolean).join('\n\n');
    const phone = (clienteTelefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(linhas)}`, '_blank');
  };

  const badge = (): { cls: string; icon: string; txt: string } => {
    const s = boleto?.status || 'NAO_GERADO';
    switch (s) {
      case 'A_RECEBER': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-barcode', txt: `BOLETO A RECEBER — venc. ${dataBR(boleto?.vencimento)}` };
      case 'RECEBIDO': case 'MARCADO_RECEBIDO': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `BOLETO PAGO${boleto?.valorRecebido ? ` — R$ ${Number(boleto.valorRecebido).toFixed(2)}` : ''}` };
      case 'EM_PROCESSAMENTO': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: 'Gerando boleto no Inter...' };
      case 'ATRASADO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-triangle-exclamation', txt: `BOLETO ATRASADO — venc. ${dataBR(boleto?.vencimento)}` };
      case 'PROTESTO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-gavel', txt: 'Boleto em protesto' };
      case 'CANCELADO': case 'EXPIRADO': return { cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: 'fa-ban', txt: 'Boleto cancelado' };
      case 'FALHA_EMISSAO': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark', txt: 'Falha ao gerar — toque em tentar de novo' };
      default: return { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: 'fa-file-invoice-dollar', txt: 'Sem boleto' };
    }
  };

  if (indisponivel || !boleto) return null;
  const bb = badge();
  const clienteTemDoc = !!(clienteDoc || '').replace(/\D/g, '');
  const clienteTemCep = (clienteCep || '').replace(/\D/g, '').length === 8;

  return (
    <div className={`rounded-2xl border p-3 space-y-2 ${bb.cls}`}>
      <div className="flex items-center gap-2">
        <i className={`fa-solid ${bb.icon}`}></i>
        <span className="text-[10px] font-black uppercase flex-1">{bb.txt}</span>
        {(boleto.status === 'EM_PROCESSAMENTO' || ['A_RECEBER', 'ATRASADO'].includes(boleto.status)) && (
          <button onClick={handleConsultar} disabled={busy} className="text-[9px] font-black underline disabled:opacity-50">
            Atualizar
          </button>
        )}
      </div>
      {(erroLocal || (boleto.erro && boleto.status === 'FALHA_EMISSAO')) && (
        <p className="text-[9px] leading-snug font-bold opacity-80 break-words">{erroLocal || boleto.erro}</p>
      )}
      {['A_RECEBER', 'ATRASADO'].includes(boleto.status) && boleto.linhaDigitavel && (
        <div className="space-y-1.5">
          <button onClick={() => handleCopiarTexto(boleto.linhaDigitavel!, 'Linha digitavel')}
            className="w-full text-left font-mono text-[9px] font-bold bg-white/70 rounded-lg px-2 py-1.5 break-all active:scale-95">
            {boleto.linhaDigitavel}
          </button>
          {boleto.pixCopiaECola && (
            <button onClick={() => handleCopiarTexto(boleto.pixCopiaECola!, 'PIX copia e cola')}
              className="w-full text-left text-[9px] font-black bg-white/70 rounded-lg px-2 py-1.5 break-all active:scale-95">
              <i className="fa-solid fa-qrcode mr-1"></i>PIX COPIA E COLA — TOQUE PARA COPIAR
            </button>
          )}
        </div>
      )}
      {boleto.status === 'EM_PROCESSAMENTO' && (
        <button onClick={handleGerar} disabled={busy}
          className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
          <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>
          Gerar Novamente
        </button>
      )}
      {['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO'].includes(boleto.status) && !form && (
        <button onClick={() => { setErroLocal(''); setForm(true); }} disabled={busy}
          className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
          <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>
          {boleto.status === 'NAO_GERADO' ? 'Gerar Boleto' : 'Gerar Novamente'}
        </button>
      )}
      {['A_RECEBER', 'ATRASADO', 'RECEBIDO', 'MARCADO_RECEBIDO'].includes(boleto.status) && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handlePdf} disabled={busy}
            className="bg-slate-800 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
            <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-file-pdf'} mr-1`}></i> PDF
          </button>
          <button onClick={handleWhats}
            className="bg-green-600 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95">
            <i className="fa-brands fa-whatsapp mr-1"></i> Enviar
          </button>
        </div>
      )}
      {form && (
        <div className="space-y-2 bg-white/70 rounded-xl p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[8px] font-black uppercase text-gray-500">Valor (R$)</span>
              <input type="number" step="0.01" min="2.5" value={valor} onChange={e => setValor(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
            </label>
            <label className="block">
              <span className="text-[8px] font-black uppercase text-gray-500">Vencimento</span>
              <input type="date" value={venc} onChange={e => setVenc(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
            </label>
          </div>
          {!clienteTemDoc && (
            <label className="block">
              <span className="text-[8px] font-black uppercase text-gray-500">CPF/CNPJ do pagador (cliente sem documento no cadastro)</span>
              <input type="text" inputMode="numeric" value={doc} onChange={e => setDoc(e.target.value)}
                placeholder="000.000.000-00"
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
            </label>
          )}
          {!clienteTemCep && (
            <label className="block">
              <span className="text-[8px] font-black uppercase text-gray-500">CEP do pagador (obrigatório no Inter — cliente sem CEP no cadastro)</span>
              <input type="text" inputMode="numeric" value={cep} onChange={e => setCep(e.target.value)}
                placeholder="89500000"
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
            </label>
          )}
          {notaStatus === 'AUTORIZADA' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={atrelar} onChange={e => setAtrelar(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
              <span className="text-[9px] font-black uppercase text-gray-600">Atrelar NF-e {notaNumero || ''} ao boleto</span>
            </label>
          )}
          <button onClick={handleGerar} disabled={busy || !venc}
            className="block w-full bg-emerald-600 text-white font-black py-2.5 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
            <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-check'} mr-1`}></i>
            Confirmar boleto
          </button>
        </div>
      )}
    </div>
  );
};

export default BoletoCard;
