"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sale, Client, Product } from '@/lib/types';
import { gerarCupomTexto, cupomSegmentos, cupomSemMarcadores } from '@/lib/cupomTexto';
import { danfeMiniTexto } from '@/lib/danfeTexto';
import { bluetoothPrinter, PrintJob } from '@/services/bluetoothPrinterService';
import { notaService, NotaInfo, FocusStatusInfo } from '@/services/notaService';
import BoletoCard from '@/components/doce/BoletoCard';
import ConfirmModal from '@/components/doce/ConfirmModal';
import PrinterSelector from '@/components/doce/PrinterSelector';
// BLOCO 72: grava o contato via API server-side (service_role) — persistência garantida
import { authHeaders } from '@/services/userService';
// BLOCO 82: impressão no iPhone — Apple bloqueia Web Bluetooth no Safari/Chrome iOS;
// caminho que funciona: navegador Bluefy (App Store) com instruções passo a passo
import { isIOSDevice, TEXTO_IMPRESSAO_IOS, TITULO_IMPRESSAO_IOS } from '@/lib/iosPrint';
// BLOCO 111: impressão térmica USB do PC — canal BT x USB persistente por dispositivo
import { imprimirViaUsb, lerCanalImpressao, salvarCanalImpressao, CanalImpressao } from '@/lib/usbPrint';

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
}

const Cupom: React.FC<CupomProps> = ({ sale, client, products, onClose, onBack, onDeleteSale, allowDelete, showToast, closeLabel, allowNota, conferencia, onFinalizar, finalizando, labelFinalizar, conferenciaTitulo }) => {
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
  const [notaBusy, setNotaBusy] = useState(false);
  // BLOCO 85: status da integracao Focus (env da Vercel) — o painel AVISA
  // quando o token nao esta configurado em vez de falhar generico no clique.
  const [focus, setFocus] = useState<FocusStatusInfo | null>(null);
  // BLOCO 67: bloco da NF-e DOBRAVEL (linha de status sempre visivel, acoes
  // atras do toque) — junto com o boleto, empurrava o cupom pra fora da tela.
  // Rejeitada abre expandido de cara (o erro precisa ser lido).
  const [notaAberta, setNotaAberta] = useState<boolean>(() => sale.notaStatus === 'REJEITADA');

  // BLOCO 108 — MODO CUPOM: cliente "somente cupom" -> NFC-e ANONIMA com os
  // produtos no PREÇO CUPOM (custo). O cliente paga o cupom normal; a fiscal
  // sai sem identificacao e com o preço da caixa. Requer cupomDuploNfc ON.
  const [modoCupomNfc, setModoCupomNfc] = useState<boolean>(false);

  // BLOCO 109 (regra do dono: "na pronta entrega os botões de nota/boleto
  // devem aparecer depois de imprimir o cupom, na mesma tela SEM RODAR PARA
  // BAIXO"): após a 1ª impressão OK o PASSO 1 COLAPSA numa linha compacta
  // (reimprimir/copiar/opções) e a tela desliza suavemente até o PASSO 2 —
  // nota, boleto e Pix ficam visíveis sem o usuário rolar nada.
  const [passo1Aberto, setPasso1Aberto] = useState<boolean>(true);
  const passo2Ref = useRef<HTMLDivElement | null>(null);
  const descerParaPasso2 = () => {
    setTimeout(() => passo2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320);
  };

  const handleEmitirNota = async () => {
    if (notaBusy || !isVendaSalva) return;
    // BLOCO 85: sem token Focus o clique so frustra — avisa com o que falta
    if (focus && !focus.configurado) {
      const msg = 'NF-e temporariamente indisponível: o token da Focus NFe não está configurado no servidor (env FOCUS_NFE_TOKEN na Vercel). Avise o admin.';
      showToast?.(msg, 'error');
      setModal({ title: 'Nota Fiscal', message: msg, icon: 'fa-solid fa-triangle-exclamation', type: 'danger', onConfirm: () => setModal(null) });
      return;
    }
    setNotaBusy(true);
    const r = await notaService.emitir(sale.id, undefined, undefined, modoCupomNfc);
    setNotaBusy(false);
    if (r.erro && !r.nota) {
      showToast?.(r.erro, 'error');
      setModal({ title: 'Nota Fiscal', message: r.erro, icon: 'fa-solid fa-triangle-exclamation', type: 'danger', onConfirm: () => setModal(null) });
      return;
    }
    if (r.nota) setNota(n => ({ ...n, ...r.nota }));
    if (r.ok && r.nota?.status === 'AUTORIZADA') {
      showToast?.('Nota autorizada!', 'success');
    } else if (r.nota?.status === 'REJEITADA') {
      showToast?.(r.nota.erro || 'Nota rejeitada pela SEFAZ', 'error');
    }
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

  const handleConsultarNota = async () => {
    if (notaBusy || !isVendaSalva) return;
    setNotaBusy(true);
    const r = await notaService.consultar(sale.id);
    setNotaBusy(false);
    if (r.erro && !r.nota) { showToast?.(r.erro, 'error'); return; }
    if (r.nota) setNota(n => ({ ...n, ...r.nota }));
  };

  // ==================================================================
  // BLOCO 82: MINI DANFE 80mm — imprime o DANFE simplificado na térmica
  // (chave de acesso com código de barras + QR de consulta NFC-e).
  // Se a chave/emitente não estão em memória, consulta a SEFAZ 1x antes.
  // ==================================================================
  const handleImprimirDanfe = async () => {
    if (notaBusy || !isVendaSalva) return;
    setNotaBusy(true);
    try {
      let d = {
        chave: nota.chave || '',
        numero: nota.numero || '',
        serie: nota.serie || '',
        protocolo: nota.protocolo || '',
        dataAutorizacao: nota.dataAutorizacao || '',
        qrCode: nota.qrCode || '',
        emitente: nota.emitente,
      };
      if (!d.chave || !d.emitente?.cnpj) {
        const r = await notaService.consultar(sale.id);
        if (r.ok && r.nota) {
          setNota(n => ({ ...n, ...r.nota }));
          d = {
            chave: r.nota.chave || d.chave,
            numero: r.nota.numero || d.numero,
            serie: r.nota.serie || d.serie,
            protocolo: r.nota.protocolo || d.protocolo,
            dataAutorizacao: r.nota.dataAutorizacao || d.dataAutorizacao,
            qrCode: r.nota.qrCode || d.qrCode,
            emitente: r.nota.emitente || d.emitente,
          };
        }
      }
      if (!d.chave) {
        showToast?.('Nota sem chave de acesso — toque em “Atualizar situação na SEFAZ” e tente de novo.', 'error');
        return;
      }
      const prods = new Map(products.map(p => [p.id, p.nome] as const));
      const itens = (sale.itens || []).map(i => ({
        descricao: prods.get(i.produtoId) || 'ITEM',
        quantidade: Number(i.quantidade) || 0,
        valorUnitario: Number(i.precoVenda) || 0,
      }));
      const texto = danfeMiniTexto({
        tipo: sale.modoNota === 'NFCE' ? 'NFCE' : 'NFE',
        chave: d.chave,
        numero: d.numero,
        serie: d.serie,
        protocolo: d.protocolo,
        dataAutorizacao: d.dataAutorizacao,
        emitente: d.emitente,
        qrCode: d.qrCode,
        dataVenda: sale.data,
        cliente: { nome: clientLocal?.nomeFantasia || clientLocal?.nome || '', doc: clientLocal?.cnpj || '' },
        itens,
        valorTotal: Number(sale.valorTotal) || 0,
        metodoPagamento: sale.metodoPagamento,
        detalhePagamento: sale.detalhePagamento,
        statusPagamento: sale.statusPagamento,
        dataVencimento: sale.dataVencimento,
        entregaStatus: sale.entregaStatus,
        tipoVenda: sale.tipoVenda,
      });
      showToast?.('Enviando DANFE à impressora...', 'success');
      const ok = await bluetoothPrinter.print(texto, '80MM', { skipConfirm: true });
      if (ok) showToast?.('DANFE enviado à impressora!', 'success');
      else showToast?.('Impressão não realizada — conecte a impressora.', 'error');
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg === 'BLUETOOTH_NAO_SUPORTADO') showToast?.('Bluetooth não disponível neste aparelho (use o Chrome do Android).', 'error');
      else showToast?.(`Erro na impressão do DANFE: ${msg}`, 'error');
    } finally {
      setNotaBusy(false);
    }
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

          // ===== BLOCO 111: canal USB do PC — folha 58/80mm no diálogo de impressão =====
          if (canalImpr === 'USB') {
            imprimirViaUsb(rawText, printWidth, (m) => {
              setModal({title:'Falha na Impressão', message:'Não consegui abrir a janela de impressão: ' + m, icon:'fa-solid fa-triangle-exclamation', type:'alert', onConfirm:()=>setModal(null)});
              if (showToast) showToast('Erro na impressão.', 'error');
            });
            setModal({title:'Janela de impressão aberta', message:'Escolha a impressora térmica USB do computador e confirme.\n\nDica: o navegador memoriza a última impressora usada — nas próximas impressões sai com 1 clique.', icon:'fa-solid fa-desktop', type:'success', onConfirm:()=>setModal(null)});
            if (showToast) showToast('Cupom enviado à janela de impressão!', 'success');
            // Mesmo contrato do Bluetooth: impresso = passo 1 colapsa e o
            // fiscal sobe na mesma tela (BLOCO 109).
            if (isVendaSalva) {
              setPasso1Aberto(false);
              descerParaPasso2();
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
              // BLOCO 109: cupom na mao = hora da parte fiscal. O PASSO 1
              // colapsa e a tela desce suave até os botões de nota/boleto —
              // tudo na MESMA tela, sem rodar para baixo manualmente.
              if (isVendaSalva) {
                setPasso1Aberto(false);
                descerParaPasso2();
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
              BLOCO 108 — FLUXO FECHADO (regra do dono): PRIMEIRO imprime o
              cupom (conferencia/entrega), SO DEPOIS sai a parte fiscal.
              PASSO 1 = imprimir/copiar/WhatsApp · PASSO 2 = NF/NFC-e,
              boleto e Pix. Mesmos botoes, agora na ordem certa.
              BLOCO 109: após a 1ª impressão o PASSO 1 COLAPSA numa linha
              compacta — o PASSO 2 (nota/boleto) sobe e fica visível SEM o
              usuário rodar para baixo. Toque no ⚙ reabre todas as opções. */}
          {isVendaSalva && !passo1Aberto ? (
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-2xl px-3 py-2">
              <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-[10px] flex items-center justify-center shadow-sm shrink-0" title="Cupom impresso"><i className="fa-solid fa-check"></i></span>
              <p className="text-[9px] font-black text-blue-600 uppercase tracking-wider flex-1 min-w-0 truncate">Cupom impresso</p>
              <button onClick={handlePrint} disabled={isPrinting} title="Imprimir de novo"
                className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center active:scale-90 disabled:opacity-60">
                <i className={`fa-solid ${isPrinting ? 'fa-spinner fa-spin' : 'fa-print'}`}></i>
              </button>
              <button onClick={handleCopy} title="Copiar o cupom"
                className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center active:scale-90">
                <i className="fa-solid fa-copy"></i>
              </button>
              <button onClick={() => setPasso1Aberto(true)} title="Imprimir de novo em outro papel, outra impressora, WhatsApp"
                className="w-10 h-10 rounded-xl bg-white border border-blue-200 text-blue-600 flex items-center justify-center active:scale-90">
                <i className="fa-solid fa-sliders"></i>
              </button>
            </div>
          ) : (
            <>
              {isVendaSalva && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-7 h-7 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center shadow-sm shrink-0">1</span>
                  <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Imprima o cupom</p>
                  <span className="flex-1 h-px bg-gray-200"></span>
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
            </>
          )}

          {/* PASSO 2 — fiscal e recebimento so DEPOIS do cupom impresso */}
          {isVendaSalva && (
            <div ref={passo2Ref} className="flex items-center gap-2 pt-2 scroll-mt-4">
              <span className="w-7 h-7 rounded-full bg-violet-600 text-white font-black text-xs flex items-center justify-center shadow-sm shrink-0">2</span>
              <p className="text-[9px] font-black text-violet-600 uppercase tracking-widest">Depois de imprimir — nota, boleto e Pix</p>
              <span className="flex-1 h-px bg-gray-200"></span>
            </div>
          )}

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
                  {/* BLOCO 85: env Focus faltando no servidor — aviso claro no
                      lugar de falha generica ao emitir */}
                  {focus && !focus.configurado && (
                    <p className="text-[9px] leading-snug font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-2 py-1.5">
                      <i className="fa-solid fa-plug-circle-xmark mr-1"></i>
                      NF-e temporariamente indisponível: token da Focus NFe ausente no servidor. O admin precisa definir FOCUS_NFE_TOKEN (e FOCUS_NFE_AMBIENTE) nas variáveis da Vercel.
                    </p>
                  )}
                  {nota.status === 'EMITINDO' && (
                    <button onClick={handleConsultarNota} disabled={notaBusy} className="text-[9px] font-black underline disabled:opacity-50">
                      Atualizar situação na SEFAZ
                    </button>
                  )}
                  {nota.status === 'REJEITADA' && nota.erro && (
                    <p className="text-[9px] leading-snug font-bold opacity-80 break-words">{nota.erro}</p>
                  )}
                  {nota.status === 'AUTORIZADA' && (
                    <>
                      {nota.pdfUrl && (
                        <a href={nota.pdfUrl} target="_blank" rel="noopener noreferrer"
                          className="block w-full bg-emerald-600 text-white font-black py-3 rounded-xl text-center text-[10px] uppercase tracking-widest active:scale-95">
                          <i className="fa-solid fa-file-pdf mr-1"></i> Abrir DANFE (PDF)
                        </a>
                      )}
                      {/* BLOCO 82: mini DANFE na térmica 80mm */}
                      <button onClick={handleImprimirDanfe} disabled={notaBusy}
                        className="block w-full bg-blue-600 text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest active:scale-95 disabled:opacity-60">
                        <i className={`fa-solid ${notaBusy ? 'fa-spinner fa-spin' : 'fa-print'} mr-1`}></i>
                        Imprimir DANFE (80mm)
                      </button>
                    </>
                  )}
                  {/* BLOCO 108: MODO CUPOM — NFC anonima com preço cupom (antes de emitir) */}
                  {/* BLOCO 109: cliente SEM documento é emitível — NFC-e de
                      consumidor não precisa de CPF/CNPJ. O aviso deixa claro
                      para o vendedor o que vai sair e como melhorar depois. */}
                  {(nota.status === 'NAO_EMITIDA' || nota.status === 'REJEITADA' || nota.status === 'CANCELADA') && !String(clientLocal?.cnpj || '').trim() && (
                    <p className="text-[9px] leading-snug font-bold bg-teal-50 text-teal-700 border border-teal-200 rounded-lg px-2 py-1.5">
                      <i className="fa-solid fa-circle-info mr-1"></i>
                      Cliente sem CPF/CNPJ no cadastro — a nota sai como NFC-e de consumidor (sem destinatário), emitível agora. Para NF-e completa, cadastre o documento e emita de novo.
                    </p>
                  )}
                  {(nota.status === 'NAO_EMITIDA' || nota.status === 'REJEITADA' || nota.status === 'CANCELADA') && (
                    <button onClick={() => setModoCupomNfc(!modoCupomNfc)} aria-pressed={modoCupomNfc}
                      className={`w-full flex items-center gap-2 p-3 rounded-xl border transition-all ${modoCupomNfc ? 'bg-violet-50 border-violet-300' : 'bg-gray-50 border-gray-100'}`}>
                      <i className={`fa-solid ${modoCupomNfc ? 'fa-square-check text-violet-600' : 'fa-regular fa-square text-gray-300'} text-base`}></i>
                      <span className="flex-1 text-left min-w-0">
                        <span className="block text-[9px] font-black uppercase text-violet-700">Só cupom — NFC anônima (preço cupom)</span>
                        <span className="block text-[8px] font-bold text-gray-400 leading-snug">Cliente sem nota identificada: a NFC sai com os produtos no preço cupom/custo. Requer o modo ligado nas Configurações ERP.</span>
                      </span>
                    </button>
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
              clienteNome={clientLocal.nomeFantasia || clientLocal.nome}
              showToast={showToast}
            />
          )}

          {/* BLOCO 108: os botoes de impressao subiram para o PASSO 1 (acima da
              nota) — fluxo fechado: cupom impresso ANTES da parte fiscal. */}

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
