"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Sale, Client, Product } from '@/lib/types';
import { gerarCupomTexto } from '@/lib/cupomTexto';
import { bluetoothPrinter, PrintJob } from '@/services/bluetoothPrinterService';
import { notaService, NotaInfo } from '@/services/notaService';
import { boletoService, BoletoInfo } from '@/services/boletoService';
import ConfirmModal from '@/components/doce/ConfirmModal';
import PrinterSelector from '@/components/doce/PrinterSelector';

type PrinterWidth = '56MM' | '80MM';

interface CupomProps {
  sale: Sale;
  client: Client;
  products: Product[];
  onClose: () => void;
  onBack?: () => void;
  onDeleteSale?: (saleId: string) => void;
  allowDelete?: boolean;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  closeLabel?: string; 
  /** Bloco 10: habilita emissao de NF-e/NFC-e nesta tela (so em venda salva) */
  allowNota?: boolean;
}

const Cupom: React.FC<CupomProps> = ({ sale, client, products, onClose, onBack, onDeleteSale, allowDelete, showToast, closeLabel, allowNota }) => {
  const [printWidth, setPrintWidth] = useState<PrinterWidth>('56MM');
  const [printJob, setPrintJob] = useState<PrintJob>({ status: 'idle' });
  const [modal, setModal] = useState<{title:string;message:string;icon:string;iconColor?:string;onConfirm:()=>void;type?:string}|null>(null);
  const [isBluetoothAvailable] = useState(() => bluetoothPrinter.isAvailable());

  // ===== Bloco 10: nota fiscal da venda =====
  const isVendaSalva = allowNota && !!sale.id && sale.id !== 'preview';
  const [nota, setNota] = useState<NotaInfo>(() => ({
    status: sale.notaStatus || 'NAO_EMITIDA',
    numero: sale.notaNumero,
    pdfUrl: sale.notaPdfUrl,
    erro: sale.notaErro,
  }));
  const [notaBusy, setNotaBusy] = useState(false);

  const handleEmitirNota = async () => {
    if (notaBusy || !isVendaSalva) return;
    setNotaBusy(true);
    const r = await notaService.emitir(sale.id);
    setNotaBusy(false);
    if (r.erro && !r.nota) {
      showToast?.(r.erro, 'error');
      setModal({ title: 'Nota Fiscal', message: r.erro, icon: 'fa-solid fa-triangle-exclamation', type: 'danger', onConfirm: () => setModal(null) });
      return;
    }
    if (r.nota) setNota(r.nota);
    if (r.ok && r.nota?.status === 'AUTORIZADA') {
      showToast?.('Nota autorizada!', 'success');
    } else if (r.nota?.status === 'REJEITADA') {
      showToast?.(r.nota.erro || 'Nota rejeitada pela SEFAZ', 'error');
    }
  };

  const handleConsultarNota = async () => {
    if (notaBusy || !isVendaSalva) return;
    setNotaBusy(true);
    const r = await notaService.consultar(sale.id);
    setNotaBusy(false);
    if (r.erro && !r.nota) { showToast?.(r.erro, 'error'); return; }
    if (r.nota) setNota(r.nota);
  };

  const notaBadge = () => {
    switch (nota.status) {
      case 'AUTORIZADA': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `NF-e ${nota.numero || ''} AUTORIZADA` };
      case 'EMITINDO': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: 'Processando na SEFAZ...' };
      case 'REJEITADA': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark', txt: 'Rejeitada — toque para tentar de novo' };
      case 'CANCELADA': return { cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: 'fa-ban', txt: 'Nota cancelada' };
      default: return { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: 'fa-file-invoice', txt: 'Sem nota fiscal' };
    }
  };
  const nb = notaBadge();

  // ===== Bloco 25: boleto bancario Inter (boleto + pix) =====
  const [boleto, setBoleto] = useState<BoletoInfo | null>(null);
  const [boletoIndisponivel, setBoletoIndisponivel] = useState(false);
  const [boletoBusy, setBoletoBusy] = useState(false);
  const [boletoForm, setBoletoForm] = useState(false);
  const [boletoValor, setBoletoValor] = useState('');
  const [boletoVenc, setBoletoVenc] = useState('');
  const [boletoAtrelar, setBoletoAtrelar] = useState(true);
  const [boletoDoc, setBoletoDoc] = useState('');

  useEffect(() => {
    if (!isVendaSalva) return;
    let vivo = true;
    (async () => {
      const r = await boletoService.status(sale.id);
      if (!vivo) return;
      if (!r.ok) { setBoletoIndisponivel(true); return; } // SQL/Inter nao configurado: esconde a secao
      setBoleto(r.boleto || null);
      if (r.boleto?.status === 'NAO_GERADO') {
        const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        setBoletoVenc(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
        const saldo = Math.max(0, (sale.valorTotal || 0) - (sale.valorPago || 0));
        setBoletoValor(saldo > 0 ? saldo.toFixed(2) : (sale.valorTotal || 0).toFixed(2));
      }
    })();
    return () => { vivo = false; };
  }, [sale.id]);

  const dataBR = (iso?: string) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  };

  const handleGerarBoleto = async () => {
    if (boletoBusy || !isVendaSalva) return;
    setBoletoBusy(true);
    const r = await boletoService.gerar(sale.id, {
      vencimento: boletoVenc,
      valor: boletoValor || undefined,
      atrelarNFe: boletoAtrelar,
      docManual: boletoDoc || undefined,
    });
    setBoletoBusy(false);
    if (r.erro && !r.boleto) {
      showToast?.(r.erro, 'error');
      setModal({ title: 'Boleto', message: r.erro, icon: 'fa-solid fa-triangle-exclamation', type: 'danger', onConfirm: () => setModal(null) });
      return;
    }
    if (r.boleto) setBoleto(r.boleto);
    setBoletoForm(false);
    if (r.ok && r.boleto) {
      if (r.boleto.status === 'EM_PROCESSAMENTO') {
        showToast?.('Boleto gerado! O Inter esta processando...', 'success');
        setTimeout(async () => {
          const c = await boletoService.consultar(sale.id);
          if (c.ok && c.boleto) setBoleto(c.boleto);
        }, 4000);
      } else {
        showToast?.('Boleto gerado!', 'success');
      }
    }
  };

  const handleConsultarBoleto = async () => {
    if (boletoBusy || !isVendaSalva) return;
    setBoletoBusy(true);
    const r = await boletoService.consultar(sale.id);
    setBoletoBusy(false);
    if (r.erro && !r.boleto) { showToast?.(r.erro, 'error'); return; }
    if (r.boleto) setBoleto(r.boleto);
  };

  const handlePdfBoleto = async () => {
    if (boletoBusy || !isVendaSalva) return;
    setBoletoBusy(true);
    const r = await boletoService.abrirPdf(sale.id);
    setBoletoBusy(false);
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

  const handleWhatsBoleto = () => {
    if (!boleto) return;
    const linhas = [
      '*BOLETO DOCE MANIA*',
      boleto.valor ? `Valor: R$ ${Number(boleto.valor).toFixed(2)}` : '',
      boleto.vencimento ? `Vencimento: ${dataBR(boleto.vencimento)}` : '',
      boleto.linhaDigitavel ? `Linha digitavel:\n${boleto.linhaDigitavel}` : '',
      boleto.pixCopiaECola ? `PIX (copia e cola):\n${boleto.pixCopiaECola}` : '',
    ].filter(Boolean).join('\n\n');
    const phone = (client.telefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(linhas)}`, '_blank');
  };

  const boletoBadge = (): { cls: string; icon: string; txt: string } => {
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
  const bb = boletoBadge();
  const mostrarBoleto = isVendaSalva && !boletoIndisponivel && !!boleto;
  const clienteTemDoc = !!(client.cnpj || '').replace(/\D/g, '');

  // Subscribe to print job status
  useEffect(() => {
    const unsubscribe = bluetoothPrinter.onStatus(setPrintJob);
    return () => unsubscribe();
  }, []);

  // Check connection on mount
  useEffect(() => {
    if (isBluetoothAvailable) {
      bluetoothPrinter.reconnect();
    }
  }, [isBluetoothAvailable]);

  // BLOCO 13: texto do cupom vem do gerador COMPARTILHADO (cupomTexto.ts) —
  // vendedor, secretario, entregador e admin imprimem EXATAMENTE o mesmo cupom.
  const generateText = (width: PrinterWidth): string => {
    return gerarCupomTexto({
      sale: sale as any,
      client: client as any,
      products: products as any,
      width,
    });
  };

  const handlePrint = useCallback(async () => {
    const doPrint = async () => {
          const rawText = generateText(printWidth);

          try {
            // bluetoothPrinter.print() handles the full flow:
            // 1. Checks Bluetooth availability
            // 2. If no printer connected, asks to scan (native picker)
            // 3. Connects, confirms, and prints
            if (showToast) showToast('Preparando impressao...');
            const success = await bluetoothPrinter.print(rawText, printWidth, { skipConfirm: true });

            if (success) {
              setModal({title:'Impresso!', message:'Cupom impresso com sucesso!', icon:'fa-solid fa-circle-check', type:'success', onConfirm:()=>setModal(null)});
              if (showToast) showToast('Impresso com sucesso!', 'success');
            } else {
              // print() retornou false: seletor cancelado ou impressora nao conectada
              setModal({
                title:'Impressao nao realizada',
                message:'Nenhuma impressora foi conectada.\n\n1. Ligue a impressora Bluetooth\n2. Toque em Imprimir novamente\n3. Selecione o aparelho na janela do Chrome',
                icon:'fa-solid fa-bluetooth-b', type:'alert', onConfirm:()=>setModal(null)
              });
              if (showToast) showToast('Impressao nao realizada.', 'error');
            }
          } catch (error: any) {
            const msg = error?.message || 'Erro desconhecido';
      
            if (msg === 'BLUETOOTH_NAO_SUPORTADO') {
              setModal({title:'Bluetooth Indisponivel', message:'Para impressao via Bluetooth, use o Chrome do Android com Bluetooth ativado.', icon:'fa-solid fa-bluetooth-b', type:'alert', onConfirm:()=>setModal(null)});
            } else if (msg.includes('SERVICO_NAO_ENCONTRADO') || msg.includes('CARACTERISTICA')) {
              setModal({title:'Erro de Impressora', message:'Servico de impressao nao encontrado. Verifique se a impressora esta ligada e pareada.', icon:'fa-solid fa-triangle-exclamation', type:'alert', onConfirm:()=>setModal(null)});
              bluetoothPrinter.forgetPrinter();
            } else {
              setModal({title:'Falha na Impressao', message:'Falha: ' + msg, icon:'fa-solid fa-triangle-exclamation', type:'alert', onConfirm:()=>setModal(null)});
            }
            if (showToast) showToast('Erro na impressao.', 'error');
          }
    };
    const widthLabel = printWidth === '80MM' ? '80mm (Largo)' : '56mm (Estreito)';
    setModal({title:'Confirmar Impressao', message: `Modelo: ${widthLabel}
Itens: ${(sale.itens || []).length}
Total: R$ ${(sale.valorTotal || 0).toFixed(2)}`, icon:'fa-solid fa-print', onConfirm: doPrint});
  }, [printWidth, sale, showToast, generateText]);

  const handleCopy = async () => {
    const rawText = generateText(printWidth);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(rawText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = rawText; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (showToast) showToast('Copiado!', 'success');
    } catch (e) {
      if (showToast) showToast('Falha ao copiar.', 'error');
    }
  };

  const handleWhatsApp = () => {
    const rawText = generateText(printWidth);
    const phone = (client.telefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent('*CUPOM DOCE MANIA*\n' + rawText)}`, '_blank');
  };

  const handleDelete = () => {
    if (onDeleteSale) {
      setModal({title:'Excluir Venda', message:'Deseja EXCLUIR esta venda permanentemente? O estoque sera devolvido ao vendedor. Esta acao nao pode ser desfeita.', icon:'fa-solid fa-trash-can', type:'danger', onConfirm:()=>{setModal(null); onDeleteSale(sale.id); onClose();}});
    }
  };

  const isConnected = bluetoothPrinter.isConnected();
  const printerName = bluetoothPrinter.getConnectedPrinterName();

  // Status badge color & text
  const getStatusBadge = () => {
    switch (printJob.status) {
      case 'scanning':
        return { color: 'bg-amber-100 text-amber-700', icon: 'fa-magnifying-glass', text: 'Buscando impressora...' };
      case 'connecting':
        return { color: 'bg-amber-100 text-amber-700', icon: 'fa-link', text: `Conectando a ${printJob.printerName || 'impressora'}...` };
      case 'connected':
        return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-link', text: `${printJob.printerName || 'Impressora'} conectada` };
      case 'printing':
        return { color: 'bg-blue-100 text-blue-700', icon: 'fa-print', text: `Imprimindo... ${printJob.progress || 0}%` };
      case 'done':
        return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-check', text: 'Impresso!' };
      case 'error':
        return { color: 'bg-red-100 text-red-700', icon: 'fa-triangle-exclamation', text: printJob.error || 'Erro' };
      default:
        if (isConnected) {
          return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-bluetooth-b', text: printerName || 'Conectado' };
        }
        return { color: 'bg-gray-100 text-gray-500', icon: 'fa-bluetooth-b', text: isBluetoothAvailable ? 'Nenhuma impressora conectada' : 'Bluetooth indisponivel' };
    }
  };

  const badge = getStatusBadge();
  const isPrinting = printJob.status === 'printing' || printJob.status === 'scanning' || printJob.status === 'connecting';

  return (
    <div className="fixed inset-0 bg-black/90 z-[150] flex flex-col items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-300 relative rounded-t-3xl overflow-hidden">
        
        <button 
          onClick={onBack || onClose} 
          className="absolute top-4 right-4 w-10 h-10 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center active:scale-90 transition-transform z-20 shadow-md"
        >
          <i className="fa-solid fa-arrow-left"></i>
        </button>

        {/* Bluetooth Status Bar */}
        <div className={`mx-4 mt-4 px-3 py-2 rounded-xl flex items-center gap-2 text-[10px] font-bold ${badge.color}`}>
          <i className={`fa-solid ${badge.icon}`}></i>
          <span className="flex-1 truncate">{badge.text}</span>
          {isConnected && printJob.status === 'idle' && (
            <button 
              onClick={() => setModal({title:'Desconectar', message:'Desconectar a impressora?', icon:'fa-solid fa-bluetooth-b', type:'danger', onConfirm:()=>{setModal(null); bluetoothPrinter.forgetPrinter();}})}
              className="text-[9px] opacity-70 underline"
            >
              Desconectar
            </button>
          )}
        </div>

        {/* Print progress bar */}
        {printJob.status === 'printing' && (
          <div className="mx-4 mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${printJob.progress || 0}%` }}
            />
          </div>
        )}

        <div className="p-6 bg-white overflow-hidden">
          <div className="font-mono text-[11px] leading-tight text-black bg-white whitespace-pre select-none border-l-2 border-gray-100 pl-4">
            {generateText(printWidth)}
          </div>
        </div>

        <div className="bg-gray-100 p-5 flex flex-col gap-3 border-t border-gray-200">
          {/* ===== Bloco 10: Nota Fiscal (NF-e / NFC-e) ===== */}
          {isVendaSalva && (
            <div className={`rounded-2xl border p-3 space-y-2 ${nb.cls}`}>
              <div className="flex items-center gap-2">
                <i className={`fa-solid ${nb.icon}`}></i>
                <span className="text-[10px] font-black uppercase flex-1">{nb.txt}</span>
                {nota.status === 'EMITINDO' && (
                  <button onClick={handleConsultarNota} disabled={notaBusy} className="text-[9px] font-black underline disabled:opacity-50">
                    Atualizar
                  </button>
                )}
              </div>
              {nota.status === 'REJEITADA' && nota.erro && (
                <p className="text-[9px] leading-snug font-bold opacity-80 break-words">{nota.erro}</p>
              )}
              {nota.status === 'AUTORIZADA' && nota.pdfUrl && (
                <a href={nota.pdfUrl} target="_blank" rel="noopener noreferrer"
                  className="block w-full bg-emerald-600 text-white font-black py-3 rounded-xl text-center text-[10px] uppercase tracking-widest active:scale-95">
                  <i className="fa-solid fa-file-pdf mr-1"></i> Abrir DANFE (PDF)
                </a>
              )}
              {(nota.status === 'NAO_EMITIDA' || nota.status === 'REJEITADA' || nota.status === 'CANCELADA') && (
                <button onClick={handleEmitirNota} disabled={notaBusy}
                  className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                  <i className={`fa-solid ${notaBusy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>
                  {notaBusy ? 'Emitindo...' : nota.status === 'REJEITADA' ? 'Emitir Novamente' : 'Emitir Nota Fiscal'}
                </button>
              )}
            </div>
          )}

          {/* ===== Bloco 25: Boleto bancario Inter (boleto + pix) ===== */}
          {mostrarBoleto && (
            <div className={`rounded-2xl border p-3 space-y-2 ${bb.cls}`}>
              <div className="flex items-center gap-2">
                <i className={`fa-solid ${bb.icon}`}></i>
                <span className="text-[10px] font-black uppercase flex-1">{bb.txt}</span>
                {(boleto!.status === 'EM_PROCESSAMENTO' || ['A_RECEBER', 'ATRASADO'].includes(boleto!.status)) && (
                  <button onClick={handleConsultarBoleto} disabled={boletoBusy} className="text-[9px] font-black underline disabled:opacity-50">
                    Atualizar
                  </button>
                )}
              </div>
              {boleto!.erro && boleto!.status === 'FALHA_EMISSAO' && (
                <p className="text-[9px] leading-snug font-bold opacity-80 break-words">{boleto!.erro}</p>
              )}
              {['A_RECEBER', 'ATRASADO'].includes(boleto!.status) && boleto!.linhaDigitavel && (
                <div className="space-y-1.5">
                  <button onClick={() => handleCopiarTexto(boleto!.linhaDigitavel!, 'Linha digitavel')}
                    className="w-full text-left font-mono text-[9px] font-bold bg-white/70 rounded-lg px-2 py-1.5 break-all active:scale-95">
                    {boleto!.linhaDigitavel}
                  </button>
                  {boleto!.pixCopiaECola && (
                    <button onClick={() => handleCopiarTexto(boleto!.pixCopiaECola!, 'PIX copia e cola')}
                      className="w-full text-left text-[9px] font-black bg-white/70 rounded-lg px-2 py-1.5 break-all active:scale-95">
                      <i className="fa-solid fa-qrcode mr-1"></i>PIX COPIA E COLA — TOQUE PARA COPIAR
                    </button>
                  )}
                </div>
              )}
              {boleto!.status === 'EM_PROCESSAMENTO' && (
                <button onClick={handleGerarBoleto} disabled={boletoBusy}
                  className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                  <i className={`fa-solid ${boletoBusy ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>
                  Gerar Novamente
                </button>
              )}
              {['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO', 'NAO_GERADO'].includes(boleto!.status) && !boletoForm && (
                <button onClick={() => setBoletoForm(true)} disabled={boletoBusy}
                  className="block w-full bg-slate-800 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                  <i className={`fa-solid ${boletoBusy ? 'fa-spinner fa-spin' : 'fa-file-invoice-dollar'} mr-1`}></i>
                  {boleto!.status === 'NAO_GERADO' ? 'Gerar Boleto' : 'Gerar Novamente'}
                </button>
              )}
              {['A_RECEBER', 'ATRASADO', 'RECEBIDO', 'MARCADO_RECEBIDO'].includes(boleto!.status) && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handlePdfBoleto} disabled={boletoBusy}
                    className="bg-slate-800 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                    <i className={`fa-solid ${boletoBusy ? 'fa-spinner fa-spin' : 'fa-file-pdf'} mr-1`}></i> PDF
                  </button>
                  <button onClick={handleWhatsBoleto}
                    className="bg-green-600 text-white font-black py-2.5 rounded-xl text-[9px] uppercase tracking-widest active:scale-95">
                    <i className="fa-brands fa-whatsapp mr-1"></i> Enviar
                  </button>
                </div>
              )}
              {boletoForm && (
                <div className="space-y-2 bg-white/70 rounded-xl p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[8px] font-black uppercase text-gray-500">Valor (R$)</span>
                      <input type="number" step="0.01" min="2.5" value={boletoValor} onChange={e => setBoletoValor(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                    </label>
                    <label className="block">
                      <span className="text-[8px] font-black uppercase text-gray-500">Vencimento</span>
                      <input type="date" value={boletoVenc} onChange={e => setBoletoVenc(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                    </label>
                  </div>
                  {!clienteTemDoc && (
                    <label className="block">
                      <span className="text-[8px] font-black uppercase text-gray-500">CPF/CNPJ do pagador (cliente sem documento no cadastro)</span>
                      <input type="text" inputMode="numeric" value={boletoDoc} onChange={e => setBoletoDoc(e.target.value)}
                        placeholder="000.000.000-00"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-gray-400" />
                    </label>
                  )}
                  {nota.status === 'AUTORIZADA' && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={boletoAtrelar} onChange={e => setBoletoAtrelar(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                      <span className="text-[9px] font-black uppercase text-gray-600">Atrelar NF-e {nota.numero || ''} ao boleto</span>
                    </label>
                  )}
                  <button onClick={handleGerarBoleto} disabled={boletoBusy || !boletoVenc}
                    className="block w-full bg-emerald-600 text-white font-black py-2.5 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-50">
                    <i className={`fa-solid ${boletoBusy ? 'fa-spinner fa-spin' : 'fa-check'} mr-1`}></i>
                    Confirmar boleto
                  </button>
                </div>
              )}
            </div>
          )}

          <PrinterSelector accent="blue" />

          {/* Paper width selector */}
          <div className="flex bg-gray-200 p-1 rounded-2xl mb-1">
            <button 
              onClick={() => setPrintWidth('56MM')} 
              className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '56MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
            >
              <i className="fa-solid fa-receipt mr-1"></i>56mm
            </button>
            <button 
              onClick={() => setPrintWidth('80MM')} 
              className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '80MM' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400'}`}
            >
              <i className="fa-solid fa-receipt mr-1"></i>80mm
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={handlePrint} 
              disabled={isPrinting}
              className={`font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg transition-all ${
                isPrinting 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-600 text-white'
              }`}
            >
              <i className={`fa-solid ${isPrinting ? 'fa-spinner fa-spin' : 'fa-print'}`}></i> 
              {isPrinting ? 'Imprimindo...' : 'Imprimir'}
            </button>
            <button onClick={handleCopy} className="bg-emerald-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg">
              <i className="fa-solid fa-copy"></i> Copiar
            </button>
          </div>

          <button onClick={() => { setModal({title:'Enviar WhatsApp', message:'Deseja enviar este cupom pelo WhatsApp para o cliente?', icon:'fa-brands fa-whatsapp', iconColor:'text-white', onConfirm:()=>{setModal(null); handleWhatsApp();}}) }} className="w-full bg-green-50 text-green-600 border border-green-100 font-black py-2.5 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[9px] uppercase transition-colors hover:bg-green-100">
            <i className="fa-brands fa-whatsapp text-sm"></i> Enviar pelo WhatsApp
          </button>

          {allowDelete && onDeleteSale && (
            <button onClick={handleDelete} className="w-full bg-white text-rose-600 border border-rose-100 font-black py-4 rounded-2xl active:scale-95 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-rose-50 transition-colors">
              <i className="fa-solid fa-trash-can"></i> Estornar / Excluir Venda
            </button>
          )}
          
          <button onClick={onClose} className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl active:scale-95 text-[10px] uppercase tracking-widest shadow-xl">
            {closeLabel || "FECHAR"}
          </button>
        </div>
      </div>
          {modal && (
        <ConfirmModal title={modal.title} message={modal.message} icon={modal.icon} iconColor={modal.iconColor} type={(modal.type as any) || 'confirm'} onConfirm={modal.onConfirm} onCancel={() => setModal(null)} />
      )}
</div>
  );
};

export default Cupom;
