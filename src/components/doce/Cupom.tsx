"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Sale, Client, Product } from '@/lib/types';
import { gerarCupomTexto, cupomSegmentos, cupomSemMarcadores } from '@/lib/cupomTexto';
// BLOCO 134: cupom fiscal PERFEITO 80mm e emissão agora vivem na JanelaFiscal
import { bluetoothPrinter, PrintJob } from '@/services/bluetoothPrinterService';
import { notaService, NotaInfo, FocusStatusInfo } from '@/services/notaService';
import BoletoCard from '@/components/doce/BoletoCard';
import ConfirmModal from '@/components/doce/ConfirmModal';
import PrinterSelector from '@/components/doce/PrinterSelector';
// BLOCO 134: JANELA FISCAL — o botão FISCAL abre esta janela dedicada (NF-e /
// NFC-e identificada / NFC-e anônima) e a tela do cupom fica limpa
import JanelaFiscal from '@/components/doce/JanelaFiscal';
// BLOCO 134: venda pode fechar SEM nota — mas o app não deixa esquecer
// BLOCO 145: os avisos de "NOTA PENDENTE" saíram — as notas de saída que
// estavam em outros sistemas JÁ FORAM BATIDAS lá (sem aviso vermelho no app).
// BLOCO 72: grava o contato via API server-side (service_role) — persistência garantida
import { authHeaders } from '@/services/userService';
// BLOCO 139: confirmação do RECEBIMENTO REAL na janela de impressão — grava valor_pago/status no banco
import { saleService } from '@/services/saleService';
// BLOCO 82: impressão no iPhone — Apple bloqueia Web Bluetooth no Safari/Chrome iOS;
// caminho que funciona: navegador Bluefy (App Store) com instruções passo a passo
import { isIOSDevice, TEXTO_IMPRESSAO_IOS, TITULO_IMPRESSAO_IOS } from '@/lib/iosPrint';
// BLOCO 111: impressão térmica USB do PC — canal BT x USB persistente por dispositivo
import { imprimirViaUsb, lerCanalImpressao, salvarCanalImpressao, CanalImpressao } from '@/lib/usbPrint';
// BLOCO 125: QR do CATÁLOGO do cliente no cupom (flag do admin no hub ERP Fiscal)
import QRCode from 'qrcode';
import { lerQrCatalogoCupom, urlCatalogoCliente } from '@/lib/qrCatalogo';
import { CUPOM_QR_LEGENDA } from '@/lib/cupomTexto';

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
  /** BLOCO 100 (regra do dono): modo CONFERÊNCIA da pronta entrega — o
   *  vendedor imprime o cupom (com cliente/pagamento) ANTES de finalizar.
   *  Mostra o banner + o botao grande FINALIZAR VENDA. */
  conferencia?: boolean;
  onFinalizar?: () => void;
  finalizando?: boolean;
  /** BLOCO 122 (fluxo de 8 telas): rótulo do botão da conferência —
   *  "Continuar" (tela 7 do fluxo novo, finaliza na tela seguinte) ou
   *  "Finalizar venda" (fluxo legado). */
  labelFinalizar?: string;
  /** BLOCO 122: título do banner da conferência — "Resumo do pedido" na
   *  pré-venda (a venda ainda não existe, é conferência do pedido). */
  conferenciaTitulo?: string;
  /** BLOCO 142: ADMIN pode cancelar a nota (Janela Fiscal) dentro do prazo SEFAZ */
  podeCancelarNota?: boolean;
  /** BLOCO 142: disparado após cancelar a nota — o admin recarrega a lista de vendas */
  onNotaCancelada?: () => void;
}

const Cupom: React.FC<CupomProps> = ({ sale, client, products, onClose, onBack, onDeleteSale, allowDelete, showToast, closeLabel, allowNota, conferencia, onFinalizar, finalizando, labelFinalizar, conferenciaTitulo, podeCancelarNota, onNotaCancelada }) => {
  const [printWidth, setPrintWidth] = useState<PrinterWidth>('56MM');
  // BLOCO 111: canal de impressão do dispositivo (Bluetooth térmica x USB do PC).
  // Default inteligente: desktop sem Web Bluetooth começa no USB.
  const [canalImpr, setCanalImprState] = useState<CanalImpressao>(() => lerCanalImpressao());
  const trocarCanal = (c: CanalImpressao) => { setCanalImprState(c); salvarCanalImpressao(c); };
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
    // BLOCO 82: chave de acesso vem do banco (saleService) — fonte do mini DANFE
    chave: sale.notaChave,
  }));
  // BLOCO 85: status da integracao Focus (env da Vercel) — a JanelaFiscal AVISA
  // quando o token nao esta configurado em vez de falhar generico no clique.
  const [focus, setFocus] = useState<FocusStatusInfo | null>(null);
  // BLOCO 134: JANELA FISCAL — um só botão FISCAL abre a janela dedicada;
  // nada mais de nota aparece solto nesta tela
  const [fiscalAberto, setFiscalAberto] = useState<boolean>(false);
  // BLOCO 136 (regra do dono): JANELA DE IMPRESSÃO — canal BT/USB, papel
  // 56/80mm, imprimir/copiar/WhatsApp moram atrás de UM botão "Imprimir cupom"
  // (com botão VOLTAR), igual à Janela Fiscal. A tela do cupom fica limpa.
  const [imprAberto, setImprAberto] = useState<boolean>(false);
  // BLOCO 136: selo "impresso ✓" no botão (troca o colapso do BLOCO 109)
  const [cupomImpresso, setCupomImpresso] = useState<boolean>(false);
  // BLOCO 134: "MAIS OPÇÕES" — WhatsApp/GPS e Estornar saem da cara da tela
  const [maisAberto, setMaisAberto] = useState<boolean>(false);

  // ============================================================
  // BLOCO 139 -> BLOCO 152: RECEBIMENTO REAL na janela de impressão.
  // DESDE O BLOCO 152 a venda À VISTA na pronta entrega NASCE PAGO (o cliente
  // pagou na entrega — cai direto no caixa à vista). Esta janela de confirmação
  // fica agora para as vendas à vista LEGADAS que ficaram com saldo em aberto
  // (o vendedor esquecia o CONFIRMO e a venda ficava "em aberto"): Confirmo
  // fecha o saldo (PAGO); NÃO RECEBI deixa em aberto (Contas a Receber).
  // ============================================================
  const [saleLocal, setSaleLocal] = useState<Sale>(sale);
  useEffect(() => { setSaleLocal(sale); }, [sale]);
  const [respRecebimento, setRespRecebimento] = useState<'CONFIRMADO' | 'NAO' | null>(null);
  useEffect(() => { setRespRecebimento(null); }, [sale.id]);
  const saldoCupom = Math.max(0, (Number(saleLocal.valorTotal) || 0) - (Number(saleLocal.valorPago) || 0));
  const aPrazoCupom = (saleLocal.metodoPagamento || '') === 'A_PRAZO';
  const ePreVendaCupom = saleLocal.tipoVenda === 'PRE_VENDA';
  // Pergunta aparece para pronta-entrega À VISTA com saldo em aberto (ou já respondida nesta sessão)
  const mostraRecebimento = isVendaSalva && !conferencia && !aPrazoCupom && !ePreVendaCupom && (saldoCupom > 0.005 || respRecebimento !== null);

  const confirmarRecebimentoCupom = async () => {
    if (!isVendaSalva || !saleLocal.id || saleLocal.id === 'preview') { setRespRecebimento('CONFIRMADO'); return; }
    const totalVenda = Number(saleLocal.valorTotal) || 0;
    const ok = await saleService.updateSale(String(saleLocal.id), { valorPago: totalVenda, statusPagamento: 'PAGO' });
    if (ok) {
      setSaleLocal((s) => ({ ...s, valorPago: totalVenda, statusPagamento: 'PAGO' }));
      setRespRecebimento('CONFIRMADO');
      if (showToast) showToast('Recebimento confirmado — R$ ' + totalVenda.toFixed(2) + ' ✓', 'success');
    } else {
      avisar('Não gravou no banco — verifique a conexão e tente de novo.');
    }
  };

  const naoRecebiCupom = async () => {
    setRespRecebimento('NAO');
    if (!isVendaSalva || !saleLocal.id || saleLocal.id === 'preview') return;
    try {
      const detalhe = [saleLocal.detalhePagamento, 'NAO RECEBI na hora — fica a cobrar'].filter(Boolean).join(' | ');
      const ok = await saleService.updateSale(String(saleLocal.id), { detalhePagamento: detalhe });
      if (ok) setSaleLocal((s) => ({ ...s, detalhePagamento: detalhe }));
    } catch { /* o saldo já está em aberto — rastro best-effort */ }
    if (showToast) showToast('Venda em aberto — cobre pelo Contas a Receber.', 'error');
  };

  // BLOCO 85: busca o status da integracao (barato, sem tocar a Focus) e
  // sincroniza a nota com o banco (ex.: venda registrada como NF no wizard)
  useEffect(() => {
    if (!isVendaSalva || !sale.id) return;
    let vivo = true;
    (async () => {
      const r = await notaService.statusIntegracao(String(sale.id));
      if (!vivo) return;
      if (r.ok && r.focus) setFocus(r.focus);
      if (r.ok && r.nota) setNota(n => ({ ...n, ...r.nota! }));
    })();
    return () => { vivo = false; };
  }, [isVendaSalva, sale.id]);

  // ==================================================================
  // BLOCO 134: a impressão do CUPOM FISCAL 80mm PERFEITO (danfe80) e toda
  // a emissão de NF-e/NFC-e agora vivem na JANELA FISCAL (JanelaFiscal.tsx)
  // — aberta pelo botão FISCAL lá embaixo. Esta tela fica limpa.
  // ==================================================================

  const notaBadge = () => {
    switch (nota.status) {
      case 'AUTORIZADA': return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'fa-circle-check', txt: `${nota.tipo === 'NFCE' ? 'NFC-e' : 'NF-e'} ${nota.numero || ''} AUTORIZADA` };
      case 'EMITINDO': return { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-hourglass-half', txt: 'Processando na SEFAZ...' };
      case 'REJEITADA': return { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'fa-circle-xmark', txt: 'Rejeitada — abrir janela fiscal' };
      case 'CANCELADA': return { cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: 'fa-ban', txt: 'Nota cancelada' };
      default: {
        // BLOCO 145: sem aviso de pendência — a intenção de documento vira
        // badge NEUTRO (as notas de terceiros foram batidas fora do sistema).
        const intencao = sale.modoNota === 'NFE' || String(sale.detalhePagamento || '').toUpperCase().includes('COM NOTA: NF-E')
          ? 'NFE'
          : sale.modoNota === 'NFCE' || String(sale.detalhePagamento || '').toUpperCase().includes('COM NOTA: NFC') ? 'NFCE' : null;
        if (intencao === 'NFE') return { cls: 'bg-gray-50 text-gray-600 border-gray-200', icon: 'fa-file-invoice', txt: 'NF-e escolhida — acompanhamento no Portal Fiscal' };
        if (intencao === 'NFCE') return { cls: 'bg-gray-50 text-gray-600 border-gray-200', icon: 'fa-file-invoice', txt: 'NFC-e escolhida — acompanhamento no Portal Fiscal' };
        return { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: 'fa-file-invoice', txt: 'Cupom simples — sem nota fiscal' };
      }
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

  // ============================================================
  // BLOCO 125 — QR DO CATALOGO DO CLIENTE NO CUPOM.
  // O admin liga/desliga no hub ERP Fiscal (erp_config). Com o flag ON e o
  // cliente com portal_code, o papel ganha o QR que abre o portal do cliente
  // (extrato, catálogo, pedido) — Bluetooth imprime QR nativo ESC/POS, USB
  // imprime imagem, copiar/WhatsApp levam o link clicável.
  // ============================================================
  const [qrCatalogoAtivo, setQrCatalogoAtivo] = useState<boolean>(false);
  useEffect(() => {
    let vivo = true;
    lerQrCatalogoCupom().then((v) => { if (vivo) setQrCatalogoAtivo(v); }).catch(() => { /* default OFF no erro */ });
    return () => { vivo = false; };
  }, []);
  const qrUrl = urlCatalogoCliente(clientLocal?.portalCodigo);
  const [qrImg, setQrImg] = useState<string>('');
  useEffect(() => {
    if (!qrUrl) { setQrImg(''); return; }
    let vivo = true;
    QRCode.toDataURL(qrUrl, { margin: 1, errorCorrectionLevel: 'M', width: 320 })
      .then((d) => { if (vivo) setQrImg(d); })
      .catch(() => { if (vivo) setQrImg(''); });
    return () => { vivo = false; };
  }, [qrUrl]);
  const qrLigado = qrCatalogoAtivo && !!qrUrl && !!qrImg;

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
  // BLOCO 125: com o flag do admin ON + portal_code, o papel sai com o QR do
  // catálogo do cliente (BT = QR nativo, USB = imagem, copiar/WhatsApp = URL).
  const generateText = (width: PrinterWidth): string => {
    return gerarCupomTexto({
      sale: sale as any,
      client: clientLocal as any,
      products: products as any,
      width,
      qrCatalogo: qrLigado ? qrUrl : undefined,
    });
  };

  // ============================================================
  // BLOCO 139: IMAGEM do cupom (emula o papel térmico impresso) — desenhada
  // no canvas com o MESMO texto que vai para a impressora (56mm = 384px,
  // 80mm = 576px @203dpi). O vendedor VÊ O QUE FOI PEDIDO antes de imprimir.
  // ============================================================
  const [cupomImg, setCupomImg] = useState<string>('');
  useEffect(() => {
    if (!imprAberto) return;
    const texto = cupomSemMarcadores(gerarCupomTexto({ sale: saleLocal as any, client: clientLocal as any, products: products as any, width: printWidth, qrCatalogo: qrLigado ? qrUrl : undefined }));
    const linhas = texto.split('\n').filter((l) => !l.includes('[['));
    const largura = printWidth === '80MM' ? 576 : 384;
    const fs = printWidth === '80MM' ? 15 : 14;
    const linhaH = Math.round(fs * 1.35);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = linhas.length * linhaH + 56;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#141414';
    ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
    ctx.textBaseline = 'top';
    linhas.forEach((l, i) => ctx.fillText(l, 14, 20 + i * linhaH));
    setCupomImg(canvas.toDataURL('image/png'));
  }, [imprAberto, printWidth, saleLocal, clientLocal, products, qrLigado, qrUrl]);

  const handlePrint = useCallback(async () => {
    const doPrint = async () => {
          const rawText = generateText(printWidth);

          // ===== BLOCO 111: canal USB do PC — folha 58/80mm no diálogo de impressão =====
          if (canalImpr === 'USB') {
            imprimirViaUsb(rawText, printWidth, (m) => {
              setModal({title:'Falha na Impressão', message:'Não consegui abrir a janela de impressão: ' + m, icon:'fa-solid fa-triangle-exclamation', type:'alert', onConfirm:()=>setModal(null)});
              if (showToast) showToast('Erro na impressão.', 'error');
            });
            setModal({title:'Janela de impressão aberta', message:'Escolha a impressora térmica USB do computador e confirme.\n\nDica: o navegador memoriza a última impressora usada — nas próximas impressões sai com 1 clique.', icon:'fa-solid fa-desktop', type:'success', onConfirm:()=>setModal(null)});
            if (showToast) showToast('Cupom enviado à janela de impressão!', 'success');
            // BLOCO 136: impresso = selo ✓ no botão e a janela fecha sozinha
            // (voltando para o cupom, onde ficam FISCAL e Boleto)
            if (isVendaSalva) {
              setCupomImpresso(true);
              setImprAberto(false);
            }
            return;
          }

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
              // BLOCO 136: impresso = selo ✓ no botão e a janela fecha sozinha
              if (isVendaSalva) {
                setCupomImpresso(true);
                setImprAberto(false);
              }
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
              // BLOCO 82: no iPhone a Apple bloqueia Web Bluetooth — em vez do "use o Chrome do
              // Android" (que não ajuda quem está no iPhone), mostra o caminho que funciona: app Bluefy.
              if (isIOSDevice()) {
                setModal({title:TITULO_IMPRESSAO_IOS, message:TEXTO_IMPRESSAO_IOS, icon:'fa-brands fa-apple', type:'alert', onConfirm:()=>setModal(null)});
              } else {
                // BLOCO 111: desktop/Firefox sem Web Bluetooth — direciona pro canal USB que agora existe.
                setModal({title:'Bluetooth Indisponivel', message:'Neste aparelho não há Bluetooth para sites.\n\nToque em “USB do PC” (canal de impressão) para imprimir na térmica conectada ao computador.', icon:'fa-solid fa-desktop', type:'alert', onConfirm:()=>setModal(null)});
              }
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
  }, [printWidth, sale, showToast, generateText, canalImpr, isVendaSalva]);

  const handleCopy = async () => {
    // BLOCO 100: copia SEM os marcadores [[PEQ]] (texto limpo)
    const rawText = cupomSemMarcadores(generateText(printWidth));
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
    // BLOCO 100: WhatsApp sem os marcadores [[PEQ]] (texto limpo)
    const rawText = cupomSemMarcadores(generateText(printWidth));
    const phone = (clientLocal.telefone || '').replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent('*CUPOM DOCE MANIA*\n' + rawText)}`, '_blank');
  };

  const handleDelete = () => {
    if (onDeleteSale) {
      // BLOCO 154: a nota fiscal (NF-e/NFC-e) NÃO é apagada — ela é congelada
      // no Portal Fiscal antes da venda ser excluída (regra do dono).
      setModal({title:'Excluir Venda', message:'Deseja EXCLUIR esta venda permanentemente? O estoque sera devolvido ao vendedor. A NOTA FISCAL (se houver) fica arquivada no Portal Fiscal. Esta acao nao pode ser desfeita.', icon:'fa-solid fa-trash-can', type:'danger', onConfirm:()=>{setModal(null); onDeleteSale(sale.id); onClose();}});
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
        // BLOCO 111: canal USB — a impressora “vive” no diálogo de impressão do PC
        if (canalImpr === 'USB') {
          return { color: 'bg-violet-100 text-violet-700', icon: 'fa-desktop', text: 'Impressora do PC (USB) — janela de impressão' };
        }
        if (isConnected) {
          return { color: 'bg-emerald-100 text-emerald-700', icon: 'fa-bluetooth-b', text: printerName || 'Conectado' };
        }
        // BLOCO 82: no iPhone sem suporte, o badge já ensina o caminho (Bluefy)
        return { color: 'bg-gray-100 text-gray-500', icon: 'fa-bluetooth-b', text: isBluetoothAvailable ? 'Nenhuma impressora conectada' : (isIOSDevice() ? 'No iPhone: use o app Bluefy' : 'Bluetooth indisponivel') };
    }
  };

  const badge = getStatusBadge();
  const isPrinting = printJob.status === 'printing' || printJob.status === 'scanning' || printJob.status === 'connecting';

  return (
    // BLOCO 78 (responsividade): o container rola SEMPRE que o card for maior
    // que a tela. pb com env(safe-area-inset-bottom) para o iPhone (borda
    // inferior) — o FECHAR nunca fica colado na barra do aparelho.
    <div className="fixed inset-0 bg-black/90 z-[150] flex flex-col items-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-y-auto backdrop-blur-sm">
      {/* BLOCO 67: my-auto no lugar do justify-center — com cupom longo, o
          justify-center cortava o TOPO do card e a rolagem nao subia.
          BLOCO 78: shrink-0 OBRIGATORIO — sem ele o flex esmagava o card para
          caber na tela e o overflow-hidden cortava IMPRIMIR/COPIAR/FECHAR
          (invisiveis e intocaveis quando os paineis NF/Boleto/contato estavam
          abertos); com shrink-0 o container passa a rolar de verdade.
          Papel 80MM = card mais largo (420px), papel de verdade mais largo. */}
      <div className={`bg-white w-full shadow-2xl flex flex-col shrink-0 animate-in zoom-in-95 duration-300 relative rounded-t-3xl overflow-hidden my-auto ${printWidth === '80MM' ? 'max-w-[420px]' : 'max-w-[340px]'}`}>
        
        <button 
          onClick={onBack || onClose} 
          className="absolute top-4 right-4 w-10 h-10 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center active:scale-90 transition-transform z-20 shadow-md"
        >
          <i className="fa-solid fa-arrow-left"></i>
        </button>

        {/* Bluetooth Status Bar — BLOCO 136: foi para DENTRO da Janela de Impressão */}

        {/* BLOCO 100: banner da CONFERÊNCIA — imprima antes de finalizar */}
        {/* BLOCO 122: título/rótulo configuráveis (pré-venda = "Resumo do pedido") */}
        {conferencia && (
          <div className="mx-4 mt-3 bg-amber-50 border border-amber-300 rounded-2xl px-3.5 py-3">
            <p className="text-[10px] font-black text-amber-700 uppercase tracking-wide"><i className="fa-solid fa-clipboard-check mr-1"></i>{conferenciaTitulo || 'Conferência da venda'}</p>
            <p className="text-[9px] font-semibold text-amber-600 leading-snug mt-1">Confira os itens, IMPRIMA se quiser e toque em {labelFinalizar ? labelFinalizar.toUpperCase() : 'FINALIZAR VENDA'}. O cupom já sai com cliente, forma de pagamento e total — antes de fechar a venda.</p>
          </div>
        )}

        {/* BLOCO 67: o texto do cupom agora ROLA (max 38% da tela) com barra
            de rolagem visivel (.cupom-scroll) — cupom com muitos itens nao
            empurra mais os botoes para fora da tela.
            BLOCO 78: overflow-auto (y E x) — em aparelho pequeno (320px) o
            papel 80mm (48 colunas) nao cabe e passa a rolar em vez de cortar. */}
        <div className="px-4 pt-4 pb-3 bg-white">
          {/* BLOCO 100/101: os marcadores [[PEQ]]/[[FIMPEQ]] viram trecho em
              fonte MUITO MENOR no preview (na impressora vira font B ESC/POS de
              verdade — a menor que existe) — as TROCAS saem com bem menos
              ênfase, abaixo do total, em letra MENOR que a descrição dos
              produtos (regra do dono: "pequeno mesmo"). */}
          <div className={`font-mono text-[11px] leading-tight text-black bg-gray-50 rounded-xl border border-gray-100 pl-4 pr-3 py-2.5 whitespace-pre select-none overflow-auto cupom-scroll ${isVendaSalva ? 'max-h-[24vh]' : 'max-h-[38vh]'}`}>
            {cupomSegmentos(generateText(printWidth)).map((seg, i) => seg.pequeno ? (
              <span key={i} className="text-[8px] leading-[1.15] text-gray-400">{seg.txt}</span>
            ) : (
              <React.Fragment key={i}>{seg.txt}</React.Fragment>
            ))}
            {/* BLOCO 125: QR do catálogo — no papel sai depois do pagamento; no
                preview a imagem entra aqui (as linhas [[QR]]/legenda são
                puladas no texto para não duplicar). */}
            {qrLigado && (
              <span className="block text-center pt-1">
                <img src={qrImg} alt="QR Code do catálogo do cliente" className="w-24 h-24 mx-auto" />
                <span className="block text-[8px] font-black tracking-widest text-gray-500 uppercase mt-1">{CUPOM_QR_LEGENDA}</span>
              </span>
            )}
          </div>
          {(sale.itens || []).length > 5 && (
            <p className="text-[8px] text-gray-300 text-center mt-1.5 uppercase font-black tracking-widest">
              <i className="fa-solid fa-arrows-up-down mr-1"></i>role para ver todos os itens
            </p>
          )}
        </div>

        <div className="bg-gray-100 p-5 flex flex-col gap-3 border-t border-gray-200">
          {/* BLOCO 100 (regra do dono): na CONFERÊNCIA o botao principal é
              FINALIZAR VENDA — a impressao fica em cima, o fechamento aqui. */}
          {conferencia && onFinalizar && (
            <button
              onClick={onFinalizar}
              disabled={finalizando}
              className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest flex items-center justify-center disabled:opacity-60"
            >
              <i className={`fa-solid ${finalizando ? 'fa-spinner fa-spin' : 'fa-arrow-right'} mr-2`}></i>
              {finalizando ? 'Preparando...' : (labelFinalizar || 'Finalizar venda')}
            </button>
          )}
          {/* ================================================================
              BLOCO 136 (regra do dono): TELA DO CUPOM LIMPA — a imagem do
              PASSO 1 tinha "um monte de informação". Agora UM botão abre a
              JANELA DE IMPRESSÃO (canal BT/USB, papel 56/80mm, imprimir,
              copiar, WhatsApp) e o "número 2" continua sendo UM botão FISCAL
              que abre a JANELA FISCAL. As duas janelas têm botão VOLTAR.
              ================================================================ */}
          <button onClick={() => setImprAberto(true)} aria-expanded={imprAberto}
            className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 shadow-lg flex items-center justify-center gap-2">
            <i className="fa-solid fa-print"></i>
            {cupomImpresso ? 'Reimprimir cupom' : 'Imprimir cupom'}
            {cupomImpresso && (
              <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center" title="Já impresso nesta sessão"><i className="fa-solid fa-check text-[9px]"></i></span>
            )}
          </button>

          {/* ============================================================
              BLOCO 145: o BANNER VERMELHO de "NOTA PENDENTE" foi EXCLUÍDO
              (regra do dono — as notas de saída de terceiros já foram
              batidas em outro sistema). O botão FISCAL único abaixo segue
              abrindo a Janela Fiscal (NF-e / NFC-e / NFC anônima).
              ============================================================ */}
          {isVendaSalva && (
            <button onClick={() => setFiscalAberto(true)} aria-expanded={fiscalAberto}
              className={`w-full rounded-2xl border-2 px-3 py-3.5 flex items-center gap-2.5 active:scale-[0.98] transition-all text-left ${nb.cls}`}>
              <i className={`fa-solid ${nb.icon} text-base`}></i>
              <span className="flex-1 min-w-0">
                <span className="block text-[10px] font-black uppercase">{nb.txt}</span>
                <span className="block text-[8px] font-bold opacity-70 leading-snug">Toque para abrir a Janela Fiscal (NF-e · NFC-e · NFC anônima)</span>
              </span>
              <i className="fa-solid fa-chevron-right text-[10px] opacity-50"></i>
            </button>
          )}

          {/* ===== Bloco 25: Boleto bancario Inter (boleto + pix) ===== */}
          {/* BLOCO 139: boleto só para venda A PRAZO — à vista o recebimento é confirmado na janela de impressão */}
          {isVendaSalva && aPrazoCupom && (
            <BoletoCard
              saleId={String(saleLocal.id)}
              valorTotal={Number(saleLocal.valorTotal) || 0}
              valorPago={Number(saleLocal.valorPago) || 0}
              notaStatus={nota.status}
              notaNumero={nota.numero}
              clienteDoc={clientLocal.cnpj}
              clienteCep={clientLocal.enderecoCep}
              clienteTelefone={clientLocal.telefone}
              clienteNome={clientLocal.nomeFantasia || clientLocal.nome}
              vencimentoVenda={(() => {
                // BLOCO 153: prazo correto — vencimento combinado da venda
                const v = saleLocal.dataVencimento as Date | string | undefined | null;
                if (!v) return undefined;
                const s = v instanceof Date ? v.toISOString() : String(v);
                return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
              })()}
              showToast={showToast}
            />
          )}

          {/* ============================================================
              BLOCO 134: MAIS OPÇÕES — WhatsApp/Localização e Estornar
              saem da cara da tela (o dono reclamou de botões demais);
              ficam atrás de UM toque, sem competir com FISCAL/BOLETO.
              ============================================================ */}
          {(clientLocal?.id || (allowDelete && onDeleteSale)) && (
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <button onClick={() => setMaisAberto(!maisAberto)} className="w-full flex items-center gap-2 p-3 text-left" aria-expanded={maisAberto}>
                <i className="fa-solid fa-sliders text-gray-400 text-xs"></i>
                <span className="text-[9px] font-black uppercase text-gray-500 flex-1">Mais opções</span>
                <i className={`fa-solid fa-chevron-${maisAberto ? 'up' : 'down'} text-[9px] text-gray-300`}></i>
              </button>
              {maisAberto && (
                <div className="px-3 pb-3 space-y-3">
                  {/* ===== BLOCO 72: atualizar WhatsApp/Localização do cliente ===== */}
                  {clientLocal?.id && (
                    <div>
                      <button onClick={() => { if (!contatoAberto) presetContato(); setContatoAberto(!contatoAberto); }} className="w-full flex items-center gap-2 p-2.5 text-left" aria-expanded={contatoAberto}>
                        <i className="fa-solid fa-user-pen text-gray-400 text-xs"></i>
                        <span className="text-[9px] font-black uppercase text-gray-500 flex-1">Atualizar WhatsApp / Localização</span>
                        <i className={`fa-solid fa-chevron-${contatoAberto ? 'up' : 'down'} text-[9px] text-gray-300`}></i>
                      </button>
                      {contatoAberto && (
                        <div className="pb-1 space-y-2.5">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-gray-400 uppercase ml-1">WhatsApp do cliente</label>
                            <div className="relative">
                              <i className="fa-brands fa-whatsapp absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500"></i>
                              <input type="tel" value={zapStr} onChange={e => setZapStr(formatarZapCupom(e.target.value))} placeholder="(54) 99999-9999" inputMode="tel" className="w-full pl-9 pr-3 py-3 bg-gray-50 rounded-xl font-black text-base outline-none border-2 border-transparent focus:border-emerald-200" />
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
                              <button onClick={capturarGPSCupom} disabled={gpsSt === 'loading'} className="bg-amber-500 text-white text-[9px] font-black uppercase px-3 py-2.5 rounded-lg active:scale-95 disabled:opacity-50 flex-shrink-0">Capturar</button>
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
                    <button onClick={handleDelete} className="w-full bg-white text-rose-600 border border-rose-100 font-black py-3.5 rounded-2xl active:scale-95 text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-rose-50 transition-colors">
                      <i className="fa-solid fa-trash-can"></i> Estornar / Excluir Venda
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          
          <button onClick={onClose} className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl active:scale-95 text-[10px] uppercase tracking-widest shadow-xl">
            {closeLabel || "FECHAR"}
          </button>
        </div>
      </div>
          {modal && (
        <ConfirmModal title={modal.title} message={modal.message} icon={modal.icon} iconColor={modal.iconColor} type={(modal.type as any) || 'confirm'} onConfirm={modal.onConfirm} onCancel={() => setModal(null)} />
      )}
      {/* BLOCO 134: JANELA FISCAL — NF-e / NFC-e identificada / NFC anônima,
          cupom fiscal 80mm e situação na SEFAZ, tudo em UMA janela. A nota
          atualizada volta para cá (banner pendente apaga ao autorizar).
          BLOCO 136: a parte fiscal é o "número 2" — botão FISCAL abre a
          janela com botão VOLTAR no cabeçalho. */}
      {fiscalAberto && (
        <JanelaFiscal
          sale={sale}
          client={clientLocal}
          nota={nota}
          focus={focus}
          showToast={showToast}
          onNotaChange={(n) => setNota(n)}
          onClose={() => setFiscalAberto(false)}
          podeCancelar={podeCancelarNota}
          onNotaCancelada={onNotaCancelada}
        />
      )}

      {/* ================================================================
          BLOCO 136: JANELA DE IMPRESSÃO (o "número 1") — aberta pelo botão
          IMPRIMIR CUPOM. Todo o "monte de informação" da imagem do dono
          (canal Bluetooth x USB do PC, térmica, papel 56/80mm, imprimir,
          copiar, WhatsApp) mora AQUI, com botão VOLTAR no cabeçalho.
          Ao imprimir com sucesso a janela fecha sozinha (voltando ao cupom).
          ================================================================ */}
      {imprAberto && (
        <div className="fixed inset-0 bg-black/90 z-[165] flex flex-col items-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] overflow-y-auto backdrop-blur-sm">
          <div className="bg-white w-full max-w-[420px] shadow-2xl flex flex-col shrink-0 rounded-t-3xl overflow-hidden my-auto animate-in zoom-in-95 duration-300">
            {/* HEADER com VOLTAR */}
            <div className="bg-blue-600 text-white px-4 py-3 flex items-center gap-2">
              <button onClick={() => setImprAberto(false)} className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:scale-90" aria-label="Voltar">
                <i className="fa-solid fa-arrow-left"></i>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest">Imprimir cupom</p>
                <p className="text-[9px] font-bold text-white/70 truncate">{clientLocal?.nomeFantasia || clientLocal?.nome || 'Cliente'} · R$ {(Number(sale.valorTotal) || 0).toFixed(2)}</p>
              </div>
            </div>

            <div className="p-4 space-y-3 bg-gray-100">
              {/* BLOCO 139: IMAGEM DO CUPOM — o vendedor confere O QUE FOI PEDIDO emulando o papel impresso */}
              {cupomImg && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center"><i className="fa-solid fa-receipt mr-1"></i>Imagem do cupom — o que sai impresso</p>
                  <img src={cupomImg} alt="Imagem do cupom emulado — como sai na térmica" className="w-full rounded-lg border border-gray-100" />
                </div>
              )}

              {/* Status da impressora (movido do topo do cupom — BLOCO 136) */}
              <div className={`px-3 py-2 rounded-xl flex items-center gap-2 text-[10px] font-bold ${badge.color}`}>
                <i className={`fa-solid ${badge.icon}`}></i>
                <span className="flex-1 break-words">{badge.text}</span>
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
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{ width: `${printJob.progress || 0}%` }}
                  />
                </div>
              )}

              {/* BLOCO 111: canal de impressão — Bluetooth (celular) x USB do PC.
                  A escolha fica gravada no aparelho e vale para todo o sistema. */}
              <div className="flex bg-gray-200 p-1 rounded-2xl">
                <button
                  onClick={() => trocarCanal('BT')}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${canalImpr === 'BT' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
                >
                  <i className="fa-brands fa-bluetooth-b mr-1"></i>Bluetooth
                </button>
                <button
                  onClick={() => trocarCanal('USB')}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${canalImpr === 'USB' ? 'bg-white shadow-sm text-violet-600' : 'text-gray-500'}`}
                >
                  <i className="fa-solid fa-desktop mr-1"></i>USB do PC
                </button>
              </div>

              {canalImpr === 'BT' ? (
                <PrinterSelector accent="blue" />
              ) : (
                <p className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2 leading-snug">
                  <i className="fa-solid fa-circle-info mr-1"></i>A janela de impressão do computador vai abrir — escolha a térmica USB. O navegador memoriza a escolhida.
                </p>
              )}

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
                      : canalImpr === 'USB' ? 'bg-violet-600 text-white' : 'bg-blue-600 text-white'
                  }`}
                >
                  <i className={`fa-solid ${isPrinting ? 'fa-spinner fa-spin' : canalImpr === 'USB' ? 'fa-desktop' : 'fa-print'}`}></i>
                  {isPrinting ? 'Imprimindo...' : canalImpr === 'USB' ? 'Imprimir (USB)' : 'Imprimir'}
                </button>
                <button onClick={handleCopy} className="bg-emerald-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg">
                  <i className="fa-solid fa-copy"></i> Copiar
                </button>
              </div>

              <button onClick={() => { setModal({title:'Enviar WhatsApp', message:'Deseja enviar este cupom pelo WhatsApp para o cliente?', icon:'fa-brands fa-whatsapp', iconColor:'text-white', onConfirm:()=>{setModal(null); handleWhatsApp();}}) }} className="w-full bg-green-50 text-green-600 border border-green-100 font-black py-2.5 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[9px] uppercase transition-colors hover:bg-green-100">
                <i className="fa-brands fa-whatsapp text-sm"></i> Enviar pelo WhatsApp
              </button>

              {/* ================================================================
                  BLOCO 139 -> 152: RECEBIMENTO REAL — desde o 152 a venda à vista
                  nasce PAGO (recebido na entrega). Este card só aparece para as
                  vendas à vista LEGADAS com saldo em aberto: "Essa venda foi à
                  vista — você recebeu R$ X? [CONFIRMO] / [NÃO RECEBI]". CONFIRMO
                  fecha o saldo no banco (caixa à vista); NÃO RECEBI deixa em
                  aberto (Contas a Receber).
                  ================================================================ */}
              {mostraRecebimento && (
                <div className="rounded-2xl border-2 border-emerald-300 bg-white p-3.5 space-y-2.5">
                  <p className="text-[10px] font-black text-emerald-700 uppercase flex items-center gap-1.5"><i className="fa-solid fa-hand-holding-dollar"></i>Recebimento real</p>
                  {respRecebimento === null && (
                    <>
                      <p className="text-[10px] font-black text-gray-700 leading-snug">Essa venda foi à vista — você recebeu os R$ {saldoCupom.toFixed(2)} da venda?</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={confirmarRecebimentoCupom} className="py-3.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest active:scale-95 shadow">Confirmo</button>
                        <button onClick={naoRecebiCupom} className="py-3.5 rounded-xl bg-white border-2 border-rose-200 text-rose-600 text-[10px] font-black uppercase tracking-widest active:scale-95">Não recebi</button>
                      </div>
                      <p className="text-[8px] font-bold text-gray-400 leading-snug">NÃO RECEBI fica em Contas a Receber — cobra depois.</p>
                    </>
                  )}
                  {respRecebimento === 'CONFIRMADO' && (
                    <p className="text-[10px] font-black text-emerald-700 leading-snug bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5"><i className="fa-solid fa-circle-check mr-1"></i>Recebido — R$ {(Number(saleLocal.valorTotal) || 0).toFixed(2)} no caixa à vista.</p>
                  )}
                  {respRecebimento === 'NAO' && (
                    <p className="text-[10px] font-black text-amber-700 leading-snug bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5"><i className="fa-solid fa-user-clock mr-1"></i>Registrado: fica em aberto — cobre depois no Contas a Receber.</p>
                  )}
                </div>
              )}
              {isVendaSalva && aPrazoCupom && saldoCupom > 0.005 && (
                <p className="text-[9px] font-bold text-gray-500 bg-white border border-gray-200 rounded-xl px-3 py-2.5 leading-snug"><i className="fa-solid fa-user-clock mr-1 text-amber-500"></i>Venda a prazo — o recebimento real entra na data combinada (Contas a Receber).</p>
              )}
              {isVendaSalva && ePreVendaCupom && saldoCupom > 0.005 && (
                <p className="text-[9px] font-bold text-gray-500 bg-white border border-gray-200 rounded-xl px-3 py-2.5 leading-snug"><i className="fa-solid fa-truck mr-1 text-emerald-500"></i>Pré-venda — o entregador recebe na entrega.</p>
              )}

              <button onClick={() => setImprAberto(false)} className="w-full py-3.5 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar ao cupom</button>
            </div>
          </div>
        </div>
      )}
</div>
  );
};

export default Cupom;
