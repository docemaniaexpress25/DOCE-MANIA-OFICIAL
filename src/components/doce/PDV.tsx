"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, Client, Carga, Sale, SaleItem, PaymentMethod, Category, Subcategory } from '@/lib/types';
import Cupom from '@/components/doce/Cupom';
import { loadLocalState, saveLocalState } from '@/utils/persistence';
import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
import { wakeLockManager } from '@/utils/wakeLock';
import { clientService } from '@/services/clientService';
import { saleService } from '@/services/saleService';

interface PDVProps {
  client: Client;
  products: Product[];
  minhaCarga: Carga[];
  vendedorId: string;
  onCancel: () => void;
  onFinish: (sale: Sale) => void;
  processSale: (data: any) => Promise<Sale | null>;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
  sales: Sale[];
  onNavigateToCredit: () => void;
  categories: Category[];
  subcategories: Subcategory[];
}

type PDVView = 'CART' | 'RECEIPT_PREVIEW' | 'PAYMENT' | 'PRE_PEDIDO_PREVIEW';

// Tipo do item do carrinho
type CartItem = { quantidade: number; precoVenda: string };

const PDV: React.FC<PDVProps> = ({ client, products, minhaCarga, vendedorId, onCancel, onFinish, processSale, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, sales, onNavigateToCredit, categories, subcategories }) => {
  const [view, setView] = useState<PDVView>('CART');
  const [isPrePedido, setIsPrePedido] = useState(false);

  // Wake Lock: mantem tela acordada durante o PDV
  useEffect(() => {
    wakeLockManager.acquire();
    return () => { wakeLockManager.release(); };
  }, []);

  // ============================================================
  // MODAL: Venda finalizada com comissao
  // ============================================================
  const [saleResultModal, setSaleResultModal] = useState<{ total: number; comissao: number; troca: number; isPrazo: boolean; clientName: string; sale: Sale } | null>(null);

  // ============================================================
  // MODAL: Comprovante foto (venda a prazo)
  // ============================================================
  const [showComprovanteModal, setShowComprovanteModal] = useState(false);
  const [comprovanteSaleId, setComprovanteSaleId] = useState<string | null>(null);
  const [comprovanteFoto, setComprovanteFoto] = useState<string | null>(null);
  const [comprovanteUploading, setComprovanteUploading] = useState(false);
  const comprovanteInputRef = useRef<HTMLInputElement | null>(null);

  const handleCaptureComprovante = (file: File) => {
    setComprovanteUploading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = (h / w) * MAX; w = MAX; }
          else { w = (w / h) * MAX; h = MAX; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        const base64 = canvas.toDataURL('image/jpeg', 0.6);
        setComprovanteFoto(base64);
        setComprovanteUploading(false);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveComprovante = async () => {
    if (!comprovanteSaleId || !comprovanteFoto) return;
    setComprovanteUploading(true);
    const ok = await saleService.updateSale(comprovanteSaleId, { comprovanteFoto } as any);
    setComprovanteUploading(false);
    if (ok) {
      setAppModal({ title: 'Salvo!', message: 'Comprovante salvo com sucesso.', icon: 'fa-solid fa-check', iconColor: 'text-emerald-500', type: 'success' });
      setShowComprovanteModal(false);
    } else {
      setAppModal({ title: 'Erro', message: 'Falha ao salvar comprovante.', icon: 'fa-solid fa-triangle-exclamation', iconColor: 'text-rose-500', type: 'error' });
    }
  };

  const openComprovanteFlow = (sale: Sale) => {
    setComprovanteSaleId(sale.id);
    setComprovanteFoto(sale.comprovanteFoto || null);
    setShowComprovanteModal(true);
  };

  // ============================================================
  // MODAL: App-like genérico (substitui window.alert)
  // ============================================================
  const [appModal, setAppModal] = useState<{ title: string; message: string; icon?: string; iconColor?: string; type?: 'info' | 'error' | 'success' } | null>(null);

  // ============================================================
  // MODAL: Confirmação genérica (substitui window.confirm)
  // ============================================================
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void; icon?: string; iconColor?: string } | null>(null);

  // ============================================================
  // MODAL: Cliente incompleto (GPS + WhatsApp) — APENAS 1 MODAL
  // ============================================================
  const [showClientInfoModal, setShowClientInfoModal] = useState(false);
  const [clientWhatsapp, setClientWhatsapp] = useState('');
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'fetching' | 'saved' | 'error'>('idle');
  const [whatsappStatus, setWhatsappStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const whatsappTimerRef = useRef<NodeJS.Timeout | null>(null);
  const modalInitializedRef = useRef(false);

  // Mostra 1 vez: se falta GPS OU WhatsApp. Usa ref para nunca repetir.
  useEffect(() => {
    if (modalInitializedRef.current) return;
    modalInitializedRef.current = true;

    const hasGps = !!(client.pinLocalizacao && client.pinLocalizacao.length > 5);
    const hasWhatsapp = !!(client.telefone && client.telefone.replace(/\D/g, '').length >= 10);
    if (!hasGps || !hasWhatsapp) {
      setClientWhatsapp(client.telefone || '');
      if (!hasWhatsapp) setWhatsappStatus('idle');
      else setWhatsappStatus('saved');
      if (!hasGps) setGpsStatus('idle');
      else setGpsStatus('saved');
      setShowClientInfoModal(true);
    }
  }, [client.id]);

  // GPS: salva em pin_localizacao (mesmo formato do admin: "lat, lng") + endereco/bairro
  const handleDetectGPS = () => {
    if (!navigator.geolocation) { setGpsStatus('error'); return; }
    setGpsStatus('fetching');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        const pinStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        const updates: any = { pinLocalizacao: pinStr };
        try {
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'pt-BR' } });
          const data = await response.json();
          if (data?.address) {
            const addr = data.address;
            updates.endereco = `${addr.road || ''}${addr.house_number ? ', ' + addr.house_number : ''}` || undefined;
            updates.bairro = addr.suburb || addr.neighbourhood || undefined;
          }
        } catch (e) { /* salva pelo menos as coordenadas */ }
        const updated = await clientService.updateClient(client.id, updates);
        setGpsStatus(updated ? 'saved' : 'error');
      },
      () => { setGpsStatus('error'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // WhatsApp: salva automaticamente 1.5s após parar de digitar (min 10 dígitos)
  const handleWhatsappChange = (value: string) => {
    setClientWhatsapp(value);
    setWhatsappStatus('idle');
    if (whatsappTimerRef.current) clearTimeout(whatsappTimerRef.current);
    if (value.replace(/\D/g, '').length >= 10) {
      whatsappTimerRef.current = setTimeout(async () => {
        setWhatsappStatus('saving');
        const ok = await clientService.updateClient(client.id, { telefone: value });
        setWhatsappStatus(ok ? 'saved' : 'error');
      }, 1500);
    }
  };

  const cartKey = isPrePedido 
    ? `pdv_pre_pedido_cart_${vendedorId}_${client.id}`
    : `pdv_cart_${vendedorId}_${client.id}`;
  
  const [activeCategoryId, setActiveCategoryId] = useState<string>(() => {
    return categories.length > 0 ? categories[0].id : '';
  });

  const [visitedCategoryIds, setVisitedCategoryIds] = useState<string[]>(() => {
    return categories.length > 0 ? [categories[0].id] : [];
  });
  
  const [cart, setCart] = useState<Record<string, CartItem>>(() => 
    loadLocalState(cartKey, {})
  );

  const [metodo, setMetodo] = useState<PaymentMethod>('DINHEIRO');
  const [detalheMetodo, setDetalheMetodo] = useState<string>('Dinheiro');
  const [tipoPrazo, setTipoPrazo] = useState<'PRAZO_COMUM' | 'CHEQUE' | 'BOLETO'>('PRAZO_COMUM');
  const [prazoData, setPrazoData] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [valorRecebido, setValorRecebido] = useState<string>('');
  const [selectedPixSlot, setSelectedPixSlot] = useState<1 | 2>(1);
  const [isTrocaActive, setIsTrocaActive] = useState(false);
  const [valorTroca, setValorTroca] = useState('');
  const [printWidth, setPrintWidth] = useState<'56MM' | '80MM'>('56MM');

  useEffect(() => {
    if (activeCategoryId && !visitedCategoryIds.includes(activeCategoryId)) {
      setVisitedCategoryIds(prev => [...prev, activeCategoryId]);
    }
  }, [activeCategoryId, visitedCategoryIds]);

  useEffect(() => {
    if (activeCategoryId === '' && categories.length > 0) {
      setActiveCategoryId(categories[0].id);
    }
  }, [categories, activeCategoryId]);

  useEffect(() => {
    saveLocalState(cartKey, cart);
  }, [cart, cartKey]);

  const allCategoriesVisited = visitedCategoryIds.length >= categories.length;

  const soldProductIds = useMemo(() => {
    const clientSales = sales.filter(s => s.clientId === client.id);
    const ids = new Set<string>();
    clientSales.forEach(s => {
      s.itens?.forEach(item => {
        if (item.produtoId) {
          ids.add(item.produtoId);
        }
      });
    });
    return ids;
  }, [sales, client.id]);

  const formatCategoryName = (name: string) => {
    const n = name.toUpperCase();
    if (n.includes('ELMA')) return 'ELMA';
    if (n.includes('SALTY')) return 'SALTY';
    if (n.includes('DOCE')) return 'DOCES';
    if (n.includes('BEBIDA')) return 'BEBIDAS';
    return n.substring(0, 5);
  };

  const getOrderedItems = (): SaleItem[] => {
    return products
      .filter(p => cart[p.id] && cart[p.id].quantidade > 0)
      .map(p => ({
        produtoId: p.id,
        quantidade: cart[p.id].quantidade,
        precoVenda: parseFloat(cart[p.id].precoVenda) || 0
      }));
  };

  const clientDebt = useMemo(() => {
    const pendingSales = sales.filter(s => s.clientId === client.id && s.statusPagamento === 'PENDENTE');
    return pendingSales.reduce((acc, s) => acc + (s.valorTotal - s.valorPago), 0);
  }, [sales, client.id]);

  // ============================================================
  // FUNÇÃO DE VALIDAÇÃO DIRETA - CHAMA EM QUALQUER LUGAR
  // ============================================================
  const checkPrecoMinimoViolation = (): { hasViolation: boolean; violatingProducts: Array<{ nome: string; preco: number; minimo: number }> } => {
    if (!margemMinimaAtiva || isPrePedido) return { hasViolation: false, violatingProducts: [] };
    
    const violating: Array<{ nome: string; preco: number; minimo: number }> = [];
    
    (Object.entries(cart) as [string, CartItem][]).forEach(([pId, item]) => {
      if (item.quantidade <= 0) return;
      const p = products.find(prod => prod.id === pId);
      if (!p) return;
      
      const price = parseFloat(item.precoVenda) || 0;
      const minPrice = p.precoMinimo || 0;
      
      // Só valida se tem preço mínimo CADASTRADO (> 0)
      if (minPrice > 0 && price < minPrice) {
        violating.push({ 
          nome: p.nome, 
          preco: price, 
          minimo: minPrice 
        });
      }
    });
    
    return { hasViolation: violating.length > 0, violatingProducts: violating };
  };

  // Para compatibilidade com código existente
  const hasMarginViolation = checkPrecoMinimoViolation().hasViolation;

  const updateCart = (pId: string, delta: number, basePrice: number) => {
    setCart(prev => {
      const current = prev[pId] || { quantidade: 0, precoVenda: basePrice.toString() };
      const maxLimit = isPrePedido 
        ? (products.find(p => p.id === pId)?.estoquePrincipal || 0)
        : (minhaCarga.find(c => c.produtoId === pId)?.quantidade || 0);
      const novaQtd = Math.max(0, Math.min(maxLimit, (current.quantidade ?? 0) + delta)); 
      if (novaQtd === 0 && delta < 0) {
        const { [pId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [pId]: { ...current, quantidade: novaQtd } };
    });
  };

  // Validação no blur - corrige automaticamente se abaixo do mínimo
  const handlePriceBlur = (pId: string, value: string) => {
    if (!margemMinimaAtiva || isPrePedido) return;
    
    const sanitized = value.replace(',', '.');
    const p = products.find(prod => prod.id === pId);
    const minPrice = p?.precoMinimo || 0;
    
    if (sanitized && minPrice > 0) {
      const numValue = parseFloat(sanitized);
      if (!isNaN(numValue) && numValue < minPrice) {
        setCart(prev => {
          if (!prev[pId]) return prev;
          return { ...prev, [pId]: { ...prev[pId], precoVenda: minPrice.toFixed(2) } };
        });
      }
    }
  };

  // Mudança no input - apenas atualiza, não bloqueia digitação
  const handlePriceChange = (pId: string, value: string) => {
    const sanitized = value.replace(',', '.');
    setCart(prev => {
      if (!prev[pId]) return prev;
      return { ...prev, [pId]: { ...prev[pId], precoVenda: sanitized } };
    });
  };

  const subtotal = useMemo(() => {
    return Object.entries(cart).reduce((acc, [_, item]) => {
      const cartItem = item as CartItem;
      const price = parseFloat(cartItem.precoVenda) || 0;
      return acc + ((cartItem.quantidade ?? 0) * price); 
    }, 0);
  }, [cart]);

  const total = useMemo(() => {
    const vt = parseFloat(valorTroca) || 0;
    return Math.max(0, subtotal - (isTrocaActive ? vt : 0));
  }, [subtotal, isTrocaActive, valorTroca]);

  const troco = useMemo(() => {
    const rec = parseFloat(valorRecebido) || 0;
    return Math.max(0, rec - total);
  }, [valorRecebido, total]);

  const setPrazoDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setPrazoData(d.toISOString().split('T')[0]);
  };

  // ============================================================
  // BLOQUEIO INQUEBRÁVEL - CHAMADO ANTES DE QUALQUER FINALIZAÇÃO
  // ============================================================
  const validateAndBlockIfNeeded = (): boolean => {
    const { hasViolation, violatingProducts } = checkPrecoMinimoViolation();
    
    if (hasViolation) {
      const detalhes = violatingProducts
        .map(v => `• ${v.nome}: digitou R$ ${v.preco.toFixed(2)}, mínimo é R$ ${v.minimo.toFixed(2)}`)
        .join('\n');
      
      setAppModal({
        title: 'Venda Bloqueada',
        message: `Preço abaixo do mínimo!\n\n${detalhes}\n\nCorrija os preços antes de continuar.`,
        icon: 'fa-solid fa-circle-exclamation',
        iconColor: 'text-rose-500',
        type: 'error',
      });
      return false; // BLOQUEIA
    }
    return true; // LIBERA
  };

  const handleConfirmFinalize = async () => {
    if (total <= 0 && getOrderedItems().length === 0) return;
    
    // TRAVA ABSOLUTA - não passa daqui se houver violação
    if (!validateAndBlockIfNeeded()) return;

    const itens = getOrderedItems();
    const vt = parseFloat(valorTroca) || 0;
    const descontoInfo = isTrocaActive && vt > 0 ? ` (Troca: R$ ${vt.toFixed(2)})` : '';
    
    let finalDetalhe = '';
    if (metodo === 'PIX') {
      finalDetalhe = selectedPixSlot === 1 ? pix1Name : pix2Name;
    } else if (metodo === 'A_PRAZO') {
      const tipoLabel = tipoPrazo === 'PRAZO_COMUM' ? 'Prazo Comum' : tipoPrazo === 'CHEQUE' ? 'Cheque' : 'Boleto';
      finalDetalhe = tipoLabel;
    } else {
      finalDetalhe = detalheMetodo;
    }
    finalDetalhe += descontoInfo;
    
    const salePayload: any = { 
      vendedorId, 
      clientId: client.id, 
      valorTotal: total, 
      valorPago: metodo === 'A_PRAZO' ? 0 : total,
      metodoPagamento: metodo, 
      detalhePagamento: finalDetalhe, 
      itens,
      data: new Date() 
    };

    if (metodo === 'A_PRAZO') { 
      salePayload.statusPagamento = 'PENDENTE'; 
      salePayload.dataVencimento = new Date(prazoData); 
    } else { 
      salePayload.statusPagamento = 'PAGO'; 
    }
    
    const newSale = await processSale(salePayload);
    if (newSale) { 
      localStorage.removeItem(cartKey); 

      // Calcula comissao e abre modal bonito
      let comissaoTotal = 0;
      itens.forEach(item => {
        const prod = products.find(p => p.id === item.produtoId);
        if (prod) {
          comissaoTotal += (item.quantidade * item.precoVenda) * ((prod.comissaoPercentual || 0) / 100);
        }
      });

      setSaleResultModal({
        total,
        comissao: comissaoTotal,
        troca: isTrocaActive ? vt : 0,
        isPrazo: metodo === 'A_PRAZO',
        clientName: client.nomeFantasia,
        sale: newSale,
      });
    }
  };

  const productIdsInCarga = useMemo(() => new Set(minhaCarga.map(c => c.produtoId)), [minhaCarga]);
  
  const filteredProducts = useMemo(() => {
    if (isPrePedido) {
      const activeProds = products.filter(p => p.ativo);
      if (!activeCategoryId) return activeProds;
      return activeProds.filter(p => p.categoryId === activeCategoryId);
    }
    const productsInCarga = products.filter(p => productIdsInCarga.has(p.id));
    if (!activeCategoryId) return productsInCarga;
    return productsInCarga.filter(p => p.categoryId === activeCategoryId);
  }, [products, productIdsInCarga, activeCategoryId, isPrePedido]);

  const generatePrePedidoText = (width: '56MM' | '80MM') => {
    const totalWidth = width === '80MM' ? 48 : 32; 
    
    const padR = (str: string, len: number) => str.substring(0, len).padEnd(len);
    const padL = (str: string, len: number) => str.substring(0, len).padStart(len);
    const center = (str: string, len: number) => {
      const s = str.substring(0, len);
      const spaces = Math.max(0, Math.floor((len - s.length) / 2));
      return ' '.repeat(spaces) + s;
    };

    let t = '';
    
    t += '*'.repeat(totalWidth) + '\n';
    t += center('PRÉ-PEDIDO (RASCUNHO)', totalWidth) + '\n';
    t += '*'.repeat(totalWidth) + '\n';
    
    const clientName = client.nomeFantasia || 'Consumidor';
    t += `Cliente: ${clientName}\n`;
    t += `Data: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}\n`;
    t += '-'.repeat(totalWidth) + '\n';

    const qtyW = 4;
    const valW = width === '80MM' ? 13 : 8;
    const descW = totalWidth - qtyW - valW;

    t += padR('DESCRICAO', descW) + padL('QTD', qtyW) + padL('VALOR', valW) + '\n';
    t += '-'.repeat(totalWidth) + '\n';

    const items = getOrderedItems();
    items.forEach(item => {
      const p = products.find(prod => prod.id === item.produtoId);
      const productName = (p?.nome ?? 'Produto');
      
      const qtyStr = `${item.quantidade}x`;
      const valStr = `${(item.quantidade * item.precoVenda).toFixed(2)}`;

      t += padR(productName.substring(0, descW), descW) + padL(qtyStr, qtyW) + padL(valStr, valW) + '\n';

      let remaining = productName.substring(descW);
      while (remaining.length > 0) {
        t += padR(remaining.substring(0, totalWidth), totalWidth) + '\n';
        remaining = remaining.substring(totalWidth);
      }
    });

    t += '-'.repeat(totalWidth) + '\n';
    
    const totalLabel = 'TOTAL ESTIMADO:';
    const totalVal = `R$ ${total.toFixed(2)}`;
    t += padR(totalLabel, totalWidth - totalVal.length) + totalVal + '\n';

    t += '-'.repeat(totalWidth) + '\n';
    t += center('ATENÇÃO: ESTE DOCUMENTO', totalWidth) + '\n';
    t += center('NÃO É UMA VENDA REAL.', totalWidth) + '\n';
    t += center('APENAS RESERVA/PLANEJAMENTO', totalWidth) + '\n';
    t += '*'.repeat(totalWidth) + '\n';
    t += '\n\n\n\n\n';

    return t;
  };

  const handlePrintPrePedido = async () => {
    const rawText = generatePrePedidoText(printWidth);
    setConfirmModal({
      title: 'Imprimir Pré-Pedido',
      message: `Deseja imprimir este pré-pedido?\nModelo: ${printWidth === '80MM' ? '80mm (Largo)' : '56mm (Estreito)'}`,
      icon: 'fa-solid fa-print',
      iconColor: 'text-blue-600',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await bluetoothPrinter.print(rawText, printWidth);
          setAppModal({ title: 'Sucesso', message: 'Pré-pedido impresso com sucesso!', icon: 'fa-solid fa-check', iconColor: 'text-emerald-500', type: 'success' });
        } catch (error: any) {
          const msg = error?.message || 'Erro desconhecido';
          if (msg === 'BLUETOOTH_NAO_SUPORTADO') {
            setAppModal({ title: 'Bluetooth Indisponível', message: 'Para impressão via Bluetooth:\n1. Use o Chrome no Android\n2. Ative o Bluetooth do dispositivo', icon: 'fa-brands fa-bluetooth-b', iconColor: 'text-gray-400', type: 'error' });
          } else {
            setAppModal({ title: 'Erro na Impressão', message: `Falha ao imprimir pré-pedido: ${msg}`, icon: 'fa-solid fa-triangle-exclamation', iconColor: 'text-rose-500', type: 'error' });
          }
        }
      },
    });
  };

  const handleCopyPrePedido = () => {
    const rawText = generatePrePedidoText(printWidth);
    navigator.clipboard.writeText(rawText);
    setAppModal({ title: 'Copiado!', message: 'Texto do pré-pedido copiado para a área de transferência.', icon: 'fa-solid fa-clipboard-check', iconColor: 'text-emerald-500', type: 'success' });
  };

  if (view === 'RECEIPT_PREVIEW') {
    return (
      <div className="fixed inset-0 bg-gray-900 z-[100] flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Cupom 
            sale={{ 
              id: 'preview', 
              vendedorId, 
              clientId: client.id, 
              data: new Date(), 
              valorTotal: total, 
              valorPago: 0, 
              metodoPagamento: metodo, 
              statusPagamento: metodo === 'A_PRAZO' ? 'PENDENTE' : 'PAGO', 
              itens: getOrderedItems() 
            }} 
            client={client} 
            products={products} 
            onBack={() => setView('CART')} 
            onClose={() => setView('PAYMENT')} 
            allowDelete={false}
            closeLabel="IR PARA PAGAMENTO"
          />
        </div>
      </div>
    );
  }

  if (view === 'PRE_PEDIDO_PREVIEW') {
    return (
      <div className="fixed inset-0 bg-black/90 z-[150] flex flex-col items-center justify-center p-4 overflow-y-auto backdrop-blur-sm">
        <div className="bg-white w-full max-w-[340px] shadow-2xl flex flex-col animate-in zoom-in-95 duration-300 relative rounded-t-3xl overflow-hidden">
          
          <div className="p-6 bg-white overflow-hidden mt-4">
            <h3 className="text-center font-black text-xs text-indigo-600 uppercase mb-4 tracking-widest"><i className="fa-solid fa-file-invoice mr-2"></i> Pré-Pedido Rascunho</h3>
            <div className="font-mono text-[11px] leading-tight text-black bg-white whitespace-pre select-none border-l-2 border-indigo-100 pl-4">
              {generatePrePedidoText(printWidth)}
            </div>
          </div>

          <div className="bg-gray-100 p-5 flex flex-col gap-3 border-t border-gray-200">
            <div className="flex bg-gray-200 p-1 rounded-2xl mb-1">
              <button onClick={() => setPrintWidth('56MM')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '56MM' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}>56mm</button>
              <button onClick={() => setPrintWidth('80MM')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${printWidth === '80MM' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400'}`}>80mm</button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handlePrintPrePedido} className="bg-indigo-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg">
                <i className="fa-solid fa-print"></i> Imprimir
              </button>
              <button onClick={handleCopyPrePedido} className="bg-emerald-600 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 text-[10px] uppercase shadow-lg">
                <i className="fa-solid fa-copy"></i> Copiar
              </button>
            </div>

            <button 
              onClick={() => {
                setCart({});
                setView('CART');
                setIsPrePedido(false);
              }} 
              className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl active:scale-95 text-[10px] uppercase tracking-widest shadow-xl"
            >
              VOLTAR AO ATENDIMENTO
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="fixed inset-0 bg-gray-50 z-[60] flex flex-col">
      <header className="bg-white border-b border-gray-100 p-3 flex flex-col shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <button onClick={onCancel} className="w-9 h-9 bg-gray-50 text-gray-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>
          <div className="text-center px-4 truncate">
            <p className="text-[9px] text-gray-400 uppercase font-black tracking-tighter">
              {isPrePedido ? 'Pré-Pedido Rascunho' : 'Atendimento'}
            </p>
            <h2 className="font-black text-xs text-gray-800 uppercase truncate">{client.nomeFantasia}</h2> 
          </div>
          <button onClick={() => setConfirmModal({ title: 'Zerar Quantidades', message: 'Deseja realmente zerar todas as quantidades do carrinho?', icon: 'fa-solid fa-trash-can', iconColor: 'text-rose-500', onConfirm: () => { setConfirmModal(null); setCart({}); } })} className="w-9 h-9 bg-rose-50 text-rose-400 rounded-xl flex items-center justify-center active:scale-90 transition-transform"><i className="fa-solid fa-trash-can text-sm"></i></button>
        </div>

        <div className="grid grid-cols-4 gap-1 px-0.5">
          {categories.map(cat => {
            const isVisited = visitedCategoryIds.includes(cat.id);
            return (
              <button 
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`py-1.5 px-1 rounded-lg text-[8px] font-black uppercase transition-all truncate border relative ${activeCategoryId === cat.id ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-gray-50 text-gray-400 border-gray-100'}`}
              >
                {formatCategoryName(cat.name)}
                {isVisited && activeCategoryId !== cat.id && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white shadow-sm"></div>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {clientDebt > 0 && !isPrePedido && (
        <button onClick={() => { onCancel(); onNavigateToCredit(); }} className="w-full bg-rose-600 text-white p-3 flex items-center justify-center gap-3 shadow-md">
          <i className="fa-solid fa-triangle-exclamation text-sm"></i>
          <span className="text-[10px] font-black uppercase tracking-widest">DÍVIDA PENDENTE: R$ {clientDebt.toFixed(2)}</span>
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 pb-44">
        {filteredProducts.map(p => { 
          const item = cart[p.id];
          const cargaOriginal = isPrePedido ? (p.estoquePrincipal || 0) : (minhaCarga.find(c => c.produtoId === p.id)?.quantidade || 0);
          const minPrice = p.precoMinimo || 0;
          const itemPrice = item ? parseFloat(item.precoVenda) || 0 : p.precoVenda;
          // Só considera violação se tem preço mínimo cadastrado (> 0)
          const isBelowMin = margemMinimaAtiva && item && item.quantidade > 0 && minPrice > 0 && itemPrice < minPrice && !isPrePedido;
          const hasBeenSold = soldProductIds.has(p.id);

          return (
            <div key={p.id} className={`bg-white p-2.5 rounded-2xl border flex flex-col gap-1 ${item?.quantidade ? 'border-blue-200 bg-blue-50/30' : 'border-gray-100'}`}>
              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate flex items-center gap-1.5">
                    {hasBeenSold && (
                      <i 
                        className="fa-solid fa-check text-[11px] text-emerald-500 flex-shrink-0" 
                        title="Este produto já foi vendido para este cliente"
                      />
                    )}
                    {p.nome}
                  </h3> 
                  <div className="flex items-center gap-2 mt-1">
                     <div className={`flex items-center gap-1.5 bg-white border px-2 py-0.5 rounded-lg ${isBelowMin ? 'border-rose-500 bg-rose-50' : 'border-gray-100'}`}>
                        <span className={`text-[9px] font-black ${isBelowMin ? 'text-rose-500' : 'text-gray-300'}`}>R$</span>
                        <input 
                          type="text" 
                          value={item?.precoVenda ?? (p.precoVenda ?? 0).toFixed(2)} 
                          onChange={(e) => handlePriceChange(p.id, e.target.value)} 
                          onBlur={(e) => handlePriceBlur(p.id, e.target.value)}
                          className={`w-14 bg-transparent border-none p-0 text-[11px] font-black outline-none ${isBelowMin ? 'text-rose-600' : 'text-emerald-600'}`} 
                        />
                        {/* SÓ mostra preço mínimo se cadastrado (> 0) - NUNCA mostra 0 */}
                        {p.precoMinimo && p.precoMinimo > 0 && (
                          <span className="text-[8px] font-bold text-rose-600 ml-1">
                            {p.precoMinimo.toFixed(2)}
                          </span>
                        )}
                     </div>
                     {/* ICONE DE ESTOQUE CENTRAL NO PRÉ-PEDIDO - MAIS CLEAN */}
                     {isPrePedido && (
                       <div className="flex items-center gap-1.5 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100 shadow-inner whitespace-nowrap" title="Estoque Central">
                         <i className="fa-solid fa-warehouse text-indigo-400 text-[10px]"></i>
                         <span className="text-[10px] font-black text-indigo-600">{cargaOriginal - (item?.quantidade ?? 0)}</span>
                       </div>
                     )}
                     {!isPrePedido && (
                       <span className={`text-[9px] font-bold uppercase ${isPrePedido ? 'text-indigo-600' : 'text-blue-500'}`}>
                         {cargaOriginal - (item?.quantidade ?? 0)} UN
                       </span>
                     )}
                  </div>
                </div>
                <div className="flex items-center bg-white rounded-xl p-0.5 border border-gray-100 shadow-sm">
                  <button onClick={() => updateCart(p.id, -1, p.precoVenda)} className="w-8 h-8 text-gray-400 active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus text-[10px]"></i></button> 
                  <span className="font-black text-xs min-w-[22px] text-center">{item?.quantidade ?? 0}</span> 
                  <button onClick={() => updateCart(p.id, 1, p.precoVenda)} className="w-8 h-8 text-blue-600 active:scale-90 flex items-center justify-center"><i className="fa-solid fa-plus text-[10px]"></i></button> 
                </div>
              </div>
              {isBelowMin && (
                <p className="text-[8px] text-rose-600 font-black uppercase mt-1 animate-pulse">
                  <i className="fa-solid fa-circle-exclamation mr-1"></i> Mínimo: R$ {minPrice.toFixed(2)}
                </p>
              )}
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="py-20 text-center opacity-30 flex flex-col items-center gap-4">
            <i className="fa-solid fa-box-open text-5xl"></i>
            <p className="font-black uppercase tracking-widest text-[10px]">Nenhum produto desta categoria.</p>
          </div>
        )}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-8 space-y-3 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] max-w-lg mx-auto z-[70]">
        {!allCategoriesVisited && !isPrePedido && (
          <div className="bg-amber-100 text-amber-700 p-2 rounded-xl text-center font-black text-[8px] uppercase tracking-widest animate-in fade-in duration-300">
            <i className="fa-solid fa-eye mr-1"></i> Visualize todas as abas para liberar o cupom ({visitedCategoryIds.length}/{categories.length})
          </div>
        )}
        
        {/* Banner visual de violação */}
        {hasMarginViolation && (
          <div className="bg-rose-600 text-white p-3 rounded-xl text-center font-black text-[9px] uppercase tracking-widest animate-pulse flex items-center justify-center gap-2">
            <i className="fa-solid fa-circle-exclamation text-sm"></i>
            Venda Bloqueada: Preço abaixo do mínimo!
          </div>
        )}

        <div className="flex items-center justify-between gap-4 px-1 mb-1 bg-gray-50/50 p-2 rounded-xl">
          <div className="flex items-center gap-2">
            <button onClick={() => setIsTrocaActive(!isTrocaActive)} className={`w-10 h-6 rounded-full relative transition-colors ${isTrocaActive ? 'bg-orange-500' : 'bg-gray-300'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isTrocaActive ? 'left-5' : 'left-1'}`}></div>
            </button>
            <span className="text-[9px] font-black text-gray-400 uppercase">Troca/Desc.</span>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                setIsPrePedido(!isPrePedido);
                setCart({});
              }} 
              className={`w-10 h-6 rounded-full relative transition-colors ${isPrePedido ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isPrePedido ? 'left-5' : 'left-1'}`}></div>
            </button>
            <span className="text-[9px] font-black text-gray-400 uppercase">Pré-Pedido</span>
          </div>

          {isTrocaActive && <input type="number" value={valorTroca} onChange={e => setValorTroca(e.target.value)} placeholder="R$ 0.00" className="w-24 bg-white border border-orange-100 rounded-lg text-[11px] font-black text-orange-600 p-2 text-right outline-none" />}
        </div>

        <div className="flex justify-between items-end px-1">
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase mb-0.5">
              {isPrePedido ? 'Total Rascunho' : 'Total Líquido'}
            </p>
            <p className="text-xl font-black text-gray-800">R$ {total.toFixed(2)}</p>
          </div>
          <button 
            onClick={() => {
              if (isPrePedido) {
                setView('PRE_PEDIDO_PREVIEW');
              } else {
                setView('RECEIPT_PREVIEW');
              }
            }} 
            disabled={(total <= 0 && getOrderedItems().length === 0) || hasMarginViolation || (!allCategoriesVisited && !isPrePedido)} 
            className={`px-6 py-4 rounded-2xl font-black uppercase text-xs ${(total > 0 || getOrderedItems().length > 0) && !hasMarginViolation && (allCategoriesVisited || isPrePedido) ? (isPrePedido ? 'bg-indigo-600 text-white shadow-lg' : 'bg-blue-600 text-white shadow-lg') : 'bg-gray-200 text-gray-400'}`}
          >
            {isPrePedido ? 'Gerar Rascunho' : 'Gerar Cupom'}
          </button>
        </div>
      </footer>

      {view === 'PAYMENT' && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-end justify-center p-4">
           <div className="bg-white w-full max-sm rounded-[2.5rem] p-8 animate-in slide-in-from-bottom max-h-[95vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-lg mb-4 text-center uppercase tracking-tight">Finalizar Pagamento</h3>
              
              <div className="bg-gray-50 p-4 rounded-2xl mb-6 text-center border border-gray-100">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Valor Total Devido</p>
                <p className="text-3xl font-black text-blue-600">R$ {total.toFixed(2)}</p>
              </div>

              <div className="flex gap-1.5 mb-6 justify-center">
                {(['DINHEIRO', 'PIX', 'A_PRAZO'] as const).map(m => (
                  <button key={m} onClick={() => setMetodo(m)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${metodo === m ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-50 text-gray-400'}`}>{m === 'A_PRAZO' ? 'PRAZO' : m}</button>
                ))}
              </div>

              {metodo === 'DINHEIRO' && (
                <div className="mb-6 space-y-4 animate-in fade-in duration-300">
                   <div className="space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor Recebido R$</label>
                      <input 
                        type="number" 
                        value={valorRecebido} 
                        onChange={e => setValorRecebido(e.target.value)} 
                        placeholder="0.00" 
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-2xl font-black text-center outline-none" 
                        autoFocus
                      />
                   </div>
                   {parseFloat(valorRecebido) > total && (
                     <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center animate-in zoom-in-95">
                        <p className="text-[10px] font-black text-emerald-600 uppercase mb-1">Troco a Devolver</p>
                        <p className="text-2xl font-black text-emerald-700">R$ {troco.toFixed(2)}</p>
                     </div>
                   )}
                </div>
              )}

              {metodo === 'A_PRAZO' && (
                <div className="mb-6 space-y-4 animate-in fade-in duration-300">
                   <p className="text-[9px] font-black text-gray-400 uppercase text-center mb-1">Tipo de Prazo</p>
                   <div className="flex gap-1.5 mb-4 justify-center">
                     {(['PRAZO_COMUM', 'CHEQUE', 'BOLETO'] as const).map(t => (
                       <button 
                         key={t} 
                         onClick={() => setTipoPrazo(t)} 
                         className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all ${tipoPrazo === t ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-400'}`}
                       >
                         {t === 'PRAZO_COMUM' ? 'Prazo Comum' : t === 'CHEQUE' ? 'Cheque' : 'Boleto'}
                       </button>
                     ))}
                   </div>

                   <div className="grid grid-cols-4 gap-2">
                     {[7, 14, 21, 30].map(days => (
                       <button key={days} onClick={() => setPrazoDays(days)} className="py-3 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">{days}D</button>
                     ))}
                   </div>
                   <div className="space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Data de Vencimento</label>
                      <input type="date" value={prazoData} onChange={e => setPrazoData(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100" />
                   </div>
                </div>
              )}

              {metodo === 'PIX' && (
                <div className="mb-6 space-y-4 animate-in fade-in duration-300">
                   <p className="text-[9px] font-black text-gray-400 uppercase text-center">Selecione o Banco para Receber</p>
                   <div className="grid grid-cols-2 gap-2">
                     <button onClick={() => setSelectedPixSlot(1)} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${selectedPixSlot === 1 ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400'}`}>{pix1Name}</button>
                     <button onClick={() => setSelectedPixSlot(2)} className={`p-3 rounded-xl border text-[10px] font-black uppercase transition-all ${selectedPixSlot === 2 ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-gray-100 text-gray-400'}`}>{pix2Name}</button>
                   </div>
                   
                   <div className="bg-gray-50 p-4 rounded-2xl flex flex-col items-center border border-gray-100">
                     <p className="text-[8px] font-black text-gray-400 uppercase mb-3">QR CODE PARA PAGAMENTO</p>
                     <div className="w-32 h-32 bg-white rounded-xl flex items-center justify-center border border-gray-200 overflow-hidden shadow-inner">
                        {selectedPixSlot === 1 ? (
                          pix1Code ? <img src={pix1Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-3xl"></i>
                        ) : (
                          pix2Code ? <img src={pix2Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200 text-3xl"></i>
                        )}
                     </div>
                   </div>
                </div>
              )}

              <button 
                onClick={handleConfirmFinalize} 
                disabled={hasMarginViolation}
                className={`w-full bg-emerald-600 text-white py-5 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all mb-2 tracking-widest ${hasMarginViolation ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Concluir Venda
              </button>
              <button onClick={() => setView('RECEIPT_PREVIEW')} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase tracking-widest">Voltar ao Cupom</button>
           </div>
        </div>
      )}
    </div>

    {/* MODAL: Venda finalizada com comissao */}
    {saleResultModal && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="fa-solid fa-circle-check text-white text-3xl"></i>
            </div>
            <h3 className="font-black text-white text-lg uppercase tracking-tight">Venda Finalizada</h3>
            <p className="text-white/80 text-[10px] font-bold uppercase mt-1">{saleResultModal.clientName}</p>
          </div>

          <div className="p-6 space-y-3">
            <div className="bg-gray-50 p-4 rounded-2xl flex items-center justify-between">
              <span className="text-[10px] font-black text-gray-400 uppercase">Total da Venda</span>
              <span className="text-lg font-black text-gray-800">R$ {saleResultModal.total.toFixed(2)}</span>
            </div>

            {saleResultModal.troca > 0 && (
              <div className="bg-orange-50 p-3 rounded-2xl flex items-center justify-between border border-orange-100">
                <span className="text-[10px] font-black text-orange-400 uppercase">Desconto Troca</span>
                <span className="text-sm font-black text-orange-600">- R$ {saleResultModal.troca.toFixed(2)}</span>
              </div>
            )}

            {saleResultModal.isPrazo && (
              <div className="bg-amber-50 p-3 rounded-2xl flex items-center gap-3 border border-amber-100">
                <i className="fa-solid fa-clock text-amber-500"></i>
                <span className="text-[10px] font-black text-amber-700 uppercase">Aguardando Pagamento</span>
              </div>
            )}

            {saleResultModal.comissao > 0 && (
              <div className="bg-emerald-50 p-4 rounded-2xl border-2 border-emerald-200 text-center">
                <p className="text-[10px] font-black text-emerald-600 uppercase mb-1">Comissao Gerada</p>
                <p className="text-2xl font-black text-emerald-700">R$ {saleResultModal.comissao.toFixed(2)}</p>
              </div>
            )}
          </div>

          <div className="p-5 pt-0 space-y-2">
            {saleResultModal.isPrazo && !saleResultModal.sale.comprovanteFoto && (
              <button
                onClick={() => { const s = saleResultModal!.sale; setSaleResultModal(null); openComprovanteFlow(s); }}
                className="w-full bg-amber-500 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest"
              >
                <i className="fa-solid fa-camera mr-2"></i>Foto do Comprovante
              </button>
            )}
            <button
              onClick={() => { const s = saleResultModal.sale; setSaleResultModal(null); onFinish(s); }}
              className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest"
            >
              <i className="fa-solid fa-check mr-2"></i>{saleResultModal.isPrazo && !saleResultModal.sale.comprovanteFoto ? 'Depois' : 'OK'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ============================================================ */}
    {/* MODAL: Cliente incompleto - GPS + WhatsApp */}
    {/* ============================================================ */}
    {showClientInfoModal && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="fa-solid fa-user-pen text-white text-2xl"></i>
            </div>
            <h3 className="font-black text-white text-base uppercase tracking-tight">Dados do Cliente</h3>
            <p className="text-white/80 text-[10px] font-bold uppercase mt-1">{client.nomeFantasia}</p>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-center text-[11px] text-gray-500 font-semibold leading-relaxed">
              Este cliente não possui coordenadas GPS e WhatsApp cadastrados. Atualize para melhorar o atendimento.
            </p>

            {/* GPS Section */}
            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
              <div className="flex items-center gap-2 mb-2">
                <i className="fa-solid fa-location-dot text-blue-500 text-sm"></i>
                <span className="text-[10px] font-black text-blue-700 uppercase">Localização GPS</span>
              </div>
              {gpsStatus === 'idle' && (
                <button
                  onClick={handleDetectGPS}
                  className="w-full bg-blue-600 text-white font-black py-3 rounded-xl active:scale-95 transition-all text-[10px] uppercase tracking-widest shadow-sm"
                >
                  <i className="fa-solid fa-satellite-dish mr-2"></i>Obter Localização
                </button>
              )}
              {gpsStatus === 'fetching' && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <i className="fa-solid fa-spinner fa-spin text-blue-500"></i>
                  <span className="text-[10px] font-bold text-blue-600">Obtendo localização...</span>
                </div>
              )}
              {gpsStatus === 'saved' && (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                    <i className="fa-solid fa-check text-white text-[10px]"></i>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600">GPS salvo com sucesso!</span>
                </div>
              )}
              {gpsStatus === 'error' && (
                <div className="flex items-center gap-2 py-2">
                  <i className="fa-solid fa-triangle-exclamation text-rose-500 text-sm"></i>
                  <span className="text-[10px] font-bold text-rose-600">Não foi possível obter o GPS.</span>
                </div>
              )}
            </div>

            {/* WhatsApp Section */}
            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
              <div className="flex items-center gap-2 mb-2">
                <i className="fa-brands fa-whatsapp text-emerald-500 text-sm"></i>
                <span className="text-[10px] font-black text-emerald-700 uppercase">WhatsApp / Telefone</span>
              </div>
              {(whatsappStatus === 'idle' || whatsappStatus === 'saving') ? (
                <>
                  <input
                    type="tel"
                    value={clientWhatsapp}
                    onChange={e => handleWhatsappChange(e.target.value)}
                    placeholder="(00) 00000-0000"
                    className="w-full p-3 bg-white border border-emerald-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  {whatsappStatus === 'saving' && (
                    <div className="flex items-center gap-2 mt-2">
                      <i className="fa-solid fa-spinner fa-spin text-emerald-500 text-[10px]"></i>
                      <span className="text-[9px] font-bold text-emerald-600">Salvando automaticamente...</span>
                    </div>
                  )}
                  {whatsappStatus === 'idle' && clientWhatsapp.replace(/\D/g, '').length >= 10 && (
                    <p className="text-[9px] text-emerald-500 font-bold mt-1.5">
                      <i className="fa-solid fa-circle-check mr-1"></i>Será salvo automaticamente
                    </p>
                  )}
                  {whatsappStatus === 'idle' && clientWhatsapp.replace(/\D/g, '').length > 0 && clientWhatsapp.replace(/\D/g, '').length < 10 && (
                    <p className="text-[9px] text-gray-400 font-bold mt-1.5">
                      <i className="fa-solid fa-keyboard mr-1"></i>Digite pelo menos 10 dígitos
                    </p>
                  )}
                </>
              ) : whatsappStatus === 'error' ? (
                <>
                  <input
                    type="tel"
                    value={clientWhatsapp}
                    onChange={e => handleWhatsappChange(e.target.value)}
                    placeholder="(00) 00000-0000"
                    className="w-full p-3 bg-white border border-rose-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                  <p className="text-[9px] text-rose-500 font-bold mt-1.5">
                    <i className="fa-solid fa-circle-exclamation mr-1"></i>Erro ao salvar. Tente novamente.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 py-1">
                  <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                    <i className="fa-solid fa-check text-white text-[10px]"></i>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600">WhatsApp salvo!</span>
                </div>
              )}
            </div>
          </div>

          <div className="p-5 pt-0">
            <button
              onClick={() => setShowClientInfoModal(false)}
              className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl active:scale-95 uppercase text-xs tracking-widest"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ============================================================ */}
    {/* MODAL: App-like genérico (substitui window.alert) */}
    {/* ============================================================ */}
    {appModal && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className={`p-6 text-center ${appModal.type === 'error' ? 'bg-gradient-to-br from-rose-500 to-red-600' : appModal.type === 'success' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`}>
            <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className={`${appModal.icon || 'fa-solid fa-info'} text-white text-2xl`}></i>
            </div>
            <h3 className="font-black text-white text-sm uppercase tracking-tight">{appModal.title}</h3>
          </div>
          <div className="p-6">
            <p className="text-center text-[12px] text-gray-600 font-semibold leading-relaxed whitespace-pre-line">{appModal.message}</p>
          </div>
          <div className="p-5 pt-0">
            <button
              onClick={() => setAppModal(null)}
              className={`w-full font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest text-white ${appModal.type === 'error' ? 'bg-rose-600' : appModal.type === 'success' ? 'bg-emerald-600' : 'bg-blue-600'}`}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ============================================================ */}
    {/* MODAL: Confirmação genérica (substitui window.confirm) */}
    {/* ============================================================ */}
    {confirmModal && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="bg-gradient-to-br from-gray-600 to-gray-800 p-6 text-center">
            <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className={`${confirmModal.icon || 'fa-solid fa-question'} ${confirmModal.iconColor || 'text-white'} text-2xl`}></i>
            </div>
            <h3 className="font-black text-white text-sm uppercase tracking-tight">{confirmModal.title}</h3>
          </div>
          <div className="p-6">
            <p className="text-center text-[12px] text-gray-600 font-semibold leading-relaxed whitespace-pre-line">{confirmModal.message}</p>
          </div>
          <div className="p-5 pt-0 grid grid-cols-2 gap-2">
            <button
              onClick={() => setConfirmModal(null)}
              className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl active:scale-95 uppercase text-[10px] tracking-widest"
            >
              Cancelar
            </button>
            <button
              onClick={confirmModal.onConfirm}
              className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-[10px] tracking-widest"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )}
    {/* ============================================================ */}
    {/* MODAL: Comprovante de venda a prazo (foto) */}
    {/* ============================================================ */}
    {showComprovanteModal && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[350] flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
          <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-center">
            <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2">
              <i className="fa-solid fa-file-circle-check text-white text-2xl"></i>
            </div>
            <h3 className="font-black text-white text-sm uppercase tracking-tight">Comprovante de Venda</h3>
            <p className="text-white/70 text-[9px] font-bold mt-1">Tire foto do cupom assinado</p>
          </div>

          <div className="p-5">
            {comprovanteFoto ? (
              <div className="space-y-3">
                <img src={comprovanteFoto} className="w-full rounded-2xl border border-gray-100 shadow-inner" alt="Comprovante" />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => comprovanteInputRef.current?.click()}
                    className="bg-gray-100 text-gray-600 font-black py-3 rounded-xl active:scale-95 text-[10px] uppercase"
                  >
                    <i className="fa-solid fa-camera-rotate mr-1"></i>Refazer
                  </button>
                  <button
                    onClick={handleSaveComprovante}
                    disabled={comprovanteUploading}
                    className="bg-emerald-600 text-white font-black py-3 rounded-xl active:scale-95 text-[10px] uppercase shadow-sm"
                  >
                    {comprovanteUploading ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => comprovanteInputRef.current?.click()}
                disabled={comprovanteUploading}
                className="w-full bg-amber-100 border-2 border-dashed border-amber-300 rounded-2xl p-8 flex flex-col items-center gap-3 active:scale-95 transition-all"
              >
                {comprovanteUploading ? (
                  <i className="fa-solid fa-spinner fa-spin text-amber-500 text-2xl"></i>
                ) : (
                  <i className="fa-solid fa-camera text-amber-500 text-2xl"></i>
                )}
                <span className="text-[10px] font-black text-amber-700 uppercase">
                  {comprovanteUploading ? 'Processando...' : 'Tirar Foto'}
                </span>
              </button>
            )}
          </div>

          <div className="p-5 pt-0">
            <button
              onClick={() => setShowComprovanteModal(false)}
              className="w-full bg-gray-100 text-gray-500 font-black py-3 rounded-2xl active:scale-95 uppercase text-[10px]"
            >
              Fechar
            </button>
          </div>

          <input
            ref={comprovanteInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCaptureComprovante(f); e.target.value = ''; }}
          />
        </div>
      </div>
    )}
    </>
  );
};

export default PDV;