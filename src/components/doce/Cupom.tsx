"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Sale, Client, Product } from '@/lib/types';
import { gerarCupomTexto } from '@/lib/cupomTexto';
import { bluetoothPrinter, PrintJob } from '@/services/bluetoothPrinterService';
import { notaService, NotaInfo } from '@/services/notaService';
import BoletoCard from '@/components/doce/BoletoCard';
import ConfirmModal from '@/components/doce/ConfirmModal';
import PrinterSelector from '@/components/doce/PrinterSelector';
// BLOCO 72: grava o contato via API server-side (service_role) — persistência garantida
import { authHeaders } from '@/services/userService';

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
  // BLOCO 67: bloco da NF-e DOBRAVEL (linha de status sempre visivel, acoes
  // atras do toque) — junto com o boleto, empurrava o cupom pra fora da tela.
  // Rejeitada abre expandido de cara (o erro precisa ser lido).
  const [notaAberta, setNotaAberta] = useState<boolean>(() => sale.notaStatus === 'REJEITADA');

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

  // ============================================================
  // BLOCO 72: ATUALIZAR WHATSAPP / LOCALIZAÇÃO DO CLIENTE NO CUPOM
  // Regra nova do dono: a tela de dados NÃO trava mais a venda — e na tela do
  // cupom (NF-e/NFC-e/cupom) dá pra corrigir o número e o GPS quando precisar.
  // Gravação GARANTIDA: /api/clientes/contato roda no servidor com service_role
  // e devolve a linha gravada — o vendedor vê 'Gravado no banco ✓'.
  // ============================================================
  const [clientLocal, setClientLocal] = useState<Client>(client);
  useEffect(() => { setClientLocal(client); }, [client]);

  const [contatoAberto, setContatoAberto] = useState(false);
  const [zapStr, setZapStr] = useState('');
  const [gpsSt, setGpsSt] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [gpsPin, setGpsPin] = useState('');
  const [gpsEnd, setGpsEnd] = useState('');
  const [gpsBai, setGpsBai] = useState('');
  const [zapSaving, setZapSaving] = useState(false);

  // mascara progressiva de telefone BR — igual ao modal do vendedor
  const formatarZapCupom = (v: string): string => {
    const d = (v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };
  // telefone lixo ('0', '-', vazio) = campo nasce limpo pra digitar
  const zapVazio = (val: any): boolean => {
    const s = String(val ?? '').trim();
    if (!s) return true;
    return s.replace(/[^a-zA-Z0-9]/g, '').length < 3;
  };

  const presetContato = () => {
    setZapStr(zapVazio(clientLocal.telefone) ? '' : (clientLocal.telefone || ''));
    const pin = clientLocal.pinLocalizacao || '';
    setGpsPin(pin);
    setGpsSt(pin.length >= 5 ? 'done' : 'idle');
    setGpsEnd('');
    setGpsBai('');
  };

  const capturarGPSCupom = () => {
    if (!('geolocation' in navigator)) { avisar('GPS não suportado neste aparelho.'); return; }
    setGpsSt('loading');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setGpsPin(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      setGpsEnd('');
      setGpsBai('');
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'pt-BR' } });
        const d = await r.json();
        if (d?.address) {
          const a = d.address;
          const rua = a.road || a.pedestrian || a.street || '';
          const num = a.house_number || '';
          setGpsEnd(`${rua}${num ? ', ' + num : ''}`);
          setGpsBai(a.suburb || a.neighbourhood || a.city_district || a.village || '');
        }
      } catch { /* salva só as coordenadas */ }
      setGpsSt('done');
    }, () => setGpsSt('error'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  // BLOCO 72: o Cupom de preview nem sempre recebe showToast — quando falta,
  // usa o modal interno (a validação NUNCA fica muda).
  const avisar = (msg: string, tipo: 'success' | 'error' = 'error') => {
    if (showToast) { showToast(msg, tipo); return; }
    setModal({ title: tipo === 'error' ? 'Atenção' : 'Pronto!', message: msg, icon: tipo === 'error' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check', type: 'alert', onConfirm: () => setModal(null) });
  };

  const salvarContatoCupom = async () => {
    if (zapSaving || !clientLocal?.id) return;
    const zapDigitado = !!zapStr.trim();
    if (zapDigitado && zapStr.replace(/\D/g, '').length < 10) {
      avisar('WhatsApp incompleto — digite DDD + número (ex: 54 99999-9999).');
      return;
    }
    const body: any = { clientId: clientLocal.id };
    if (zapDigitado) body.telefone = zapStr.trim();
    if (gpsPin && gpsPin.length >= 5) {
      body.pinLocalizacao = gpsPin;
      if (gpsEnd) body.endereco = gpsEnd;
      if (gpsBai) body.bairro = gpsBai;
    }
    if (!body.telefone && !body.pinLocalizacao) {
      avisar('Nada para salvar — capture a localização ou digite o WhatsApp.');
      return;
    }
    setZapSaving(true);
    try {
      const res = await fetch('/api/clientes/contato', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        avisar(data.erro || 'Não gravou no banco — tente de novo.');
      } else {
        // o servidor devolveu a LINHA gravada — persistência provada
        const row = data.cliente || {};
        setClientLocal((c: Client) => ({
          ...c,
          telefone: row.telefone ?? (body.telefone || c.telefone),
          pinLocalizacao: row.pin_localizacao ?? body.pinLocalizacao ?? c.pinLocalizacao,
          endereco: body.endereco ? (row.endereco ?? body.endereco) : c.endereco,
          bairro: body.bairro ? (row.bairro ?? body.bairro) : c.bairro,
        }));
        avisar('Gravado no banco ✓', 'success');
        setContatoAberto(false);
      }
    } catch {
      avisar('Falha de conexão ao gravar.');
    }
    setZapSaving(false);
  };

  // BLOCO 13: texto do cupom vem do gerador COMPARTILHADO (cupomTexto.ts) —
  // vendedor, secretario, entregador e admin imprimem EXATAMENTE o mesmo cupom.
  const generateText = (width: PrinterWidth): string => {
    return gerarCupomTexto({
      sale: sale as any,
      client: clientLocal as any,
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
    const phone = (clientLocal.telefone || '').replace(/\D/g, '');
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
    <div className="fixed inset-0 bg-black/90 z-[150] flex flex-col items-center p-4 overflow-y-auto backdrop-blur-sm">
      {/* BLOCO 67: my-auto no lugar do justify-center — com cupom longo, o
          justify-center cortava o TOPO do card e a rolagem nao subia. */}
      <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-300 relative rounded-t-3xl overflow-hidden my-auto">
        
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

        {/* BLOCO 67: o texto do cupom agora ROLA (max 38% da tela) com barra
            de rolagem visivel (.cupom-scroll) — cupom com muitos itens nao
            empurra mais os botoes para fora da tela. */}
        <div className="px-4 pt-4 pb-3 bg-white">
          <div className="font-mono text-[11px] leading-tight text-black bg-gray-50 rounded-xl border border-gray-100 pl-4 pr-3 py-2.5 whitespace-pre select-none max-h-[38vh] overflow-y-auto cupom-scroll">
            {generateText(printWidth)}
          </div>
          {(sale.itens || []).length > 5 && (
            <p className="text-[8px] text-gray-300 text-center mt-1.5 uppercase font-black tracking-widest">
              <i className="fa-solid fa-arrows-up-down mr-1"></i>role para ver todos os itens
            </p>
          )}
        </div>

        <div className="bg-gray-100 p-5 flex flex-col gap-3 border-t border-gray-200">
          {/* ===== Bloco 10: Nota Fiscal (NF-e / NFC-e) — BLOCO 67: dobravel ===== */}
          {isVendaSalva && (
            <div className={`rounded-2xl border ${nb.cls}`}>
              <button onClick={() => setNotaAberta(!notaAberta)} className="w-full flex items-center gap-2 p-3 text-left" aria-expanded={notaAberta}>
                <i className={`fa-solid ${nb.icon}`}></i>
                <span className="text-[10px] font-black uppercase flex-1">{nb.txt}</span>
                <i className={`fa-solid fa-chevron-${notaAberta ? 'up' : 'down'} text-[9px] opacity-60`}></i>
              </button>
              {notaAberta && (
                <div className="px-3 pb-3 space-y-2">
                  {nota.status === 'EMITINDO' && (
                    <button onClick={handleConsultarNota} disabled={notaBusy} className="text-[9px] font-black underline disabled:opacity-50">
                      Atualizar situação na SEFAZ
                    </button>
                  )}
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
            </div>
          )}

          {/* ===== Bloco 25: Boleto bancario Inter (boleto + pix) ===== */}
          {isVendaSalva && (
            <BoletoCard
              saleId={String(sale.id)}
              valorTotal={Number(sale.valorTotal) || 0}
              valorPago={Number(sale.valorPago) || 0}
              notaStatus={nota.status}
              notaNumero={nota.numero}
              clienteDoc={clientLocal.cnpj}
              clienteCep={clientLocal.enderecoCep}
              clienteTelefone={clientLocal.telefone}
              showToast={showToast}
            />
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

          {/* ===== BLOCO 72: atualizar WhatsApp/Localização do cliente (opcional) ===== */}
          {clientLocal?.id && (
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <button onClick={() => { if (!contatoAberto) presetContato(); setContatoAberto(!contatoAberto); }} className="w-full flex items-center gap-2 p-3 text-left" aria-expanded={contatoAberto}>
                <i className="fa-solid fa-user-pen text-gray-400 text-xs"></i>
                <span className="text-[9px] font-black uppercase text-gray-500 flex-1">Atualizar WhatsApp / Localização</span>
                <i className={`fa-solid fa-chevron-${contatoAberto ? 'up' : 'down'} text-[9px] text-gray-300`}></i>
              </button>
              {contatoAberto && (
                <div className="px-3 pb-3 space-y-2.5">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-gray-400 uppercase ml-1">WhatsApp do cliente</label>
                    <div className="relative">
                      <i className="fa-brands fa-whatsapp absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500"></i>
                      <input type="tel" value={zapStr} onChange={e => setZapStr(formatarZapCupom(e.target.value))} placeholder="(54) 99999-9999" inputMode="tel" className="w-full pl-9 pr-3 py-3 bg-gray-50 rounded-xl font-black text-xs outline-none border-2 border-transparent focus:border-emerald-200" />
                    </div>
                  </div>
                  <div className={`p-3 rounded-xl border-2 border-dashed flex items-center gap-2 ${gpsSt === 'done' ? 'bg-emerald-50 border-emerald-200' : gpsSt === 'loading' ? 'bg-blue-50 border-blue-200 animate-pulse' : 'bg-amber-50 border-amber-200'}`}>
                    <i className={`fa-solid ${gpsSt === 'done' ? 'fa-check text-emerald-600' : gpsSt === 'loading' ? 'fa-spinner fa-spin text-blue-500' : 'fa-location-crosshairs text-amber-500'}`}></i>
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-black text-gray-700 uppercase leading-tight">Localização</p>
                      <p className="text-[8px] text-gray-400 leading-snug">
                        {gpsSt === 'done' ? ((gpsEnd || gpsBai) ? `${gpsEnd}${gpsEnd && gpsBai ? ' — ' : ''}${gpsBai}` : 'Capturada') : gpsSt === 'loading' ? 'Obtendo...' : gpsSt === 'error' ? 'GPS negado — tente de novo' : 'Toque em capturar'}
                      </p>
                    </div>
                    {gpsSt !== 'done' && (
                      <button onClick={capturarGPSCupom} disabled={gpsSt === 'loading'} className="bg-amber-500 text-white text-[8px] font-black uppercase px-2.5 py-2 rounded-lg active:scale-95 disabled:opacity-50 flex-shrink-0">Capturar</button>
                    )}
                  </div>
                  <button onClick={salvarContatoCupom} disabled={zapSaving} className="w-full bg-emerald-600 text-white font-black py-3 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5">
                    <i className={`fa-solid ${zapSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>{zapSaving ? 'Gravando...' : 'Salvar no banco'}
                  </button>
                </div>
              )}
            </div>
          )}

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
