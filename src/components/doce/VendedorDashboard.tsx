"use client";
// @ts-nocheck
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense, Category, Subcategory } from '@/lib/types';
import { saleService } from '@/services/saleService';
import { DIAS_SEMANA } from '@/lib/constants';
import PDV from '@/components/doce/PDV';
import Cupom from '@/components/doce/Cupom';
import RelatorioFiscal from '@/components/doce/RelatorioFiscal';
import ClientHistory from '@/components/doce/ClientHistory';
import { DailyRouteState, loadLocalState, saveLocalState } from '@/utils/persistence';

interface VendedorDashboardProps {
  user: User;
  products: Product[];
  clients: Client[];
  cargas: Carga[];
  cargasPendentes: CargaPendente[];
  sales: Sale[];
  commissions: Commission[];
  payoutLogs: CommissionPaymentLog[];
  expenses: Expense[];
  messages: SystemMessage[];
  categories: Category[];
  subcategories: Subcategory[];
  markMessageAsRead: (id: string) => void;
  processSale: (data: any) => Promise<Sale | null>;
  addClient: (data: Omit<Client, 'id'>) => Promise<void>; 
  updateClient: (id: string, data: Partial<Client>) => void;
  deleteClient: (id: string) => void; 
  receivePayment: (id: string, method: PaymentMethod, amount?: number) => void;
  deleteSale: (id: string) => void;
  aceitarCarga: (id: string) => void;
  addExpense: (sellerId: string, descricao: string, valor: number) => Promise<boolean>;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
  dailyRouteState: DailyRouteState;
  updateDailyRoute: (clientIds: string[], skippedClientIds: string[]) => void;
  companyName: string;
  companyCnpj: string;
  clientOrder: string[];
  setClientOrder: (ids: string[]) => void;
}

type TabType = 'HOME' | 'ROTEIRO' | 'CARGA' | 'HISTORY' | 'FINANCE' | 'CREDIT' | 'CLIENTES' | 'WEEKLY' | 'STOCK_VIEW' | 'AVISOS';

// Helpers para comprovante
const compressImage = (file: File): Promise<string> => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) { if (w > h) { h = (h / w) * MAX; w = MAX; } else { w = (w / h) * MAX; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.src = e.target?.result as string;
  };
  reader.readAsDataURL(file);
});

const shareImage = async (base64: string, fileName: string) => {
  const res = await fetch(base64);
  const blob = await res.blob();
  const file = new File([blob], fileName, { type: 'image/jpeg' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Comprovante de Venda' });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }
};

const VendedorDashboard: React.FC<VendedorDashboardProps> = ({ 
  user, products = [], clients = [], cargas = [], cargasPendentes = [], sales = [], commissions = [], payoutLogs = [], expenses = [], messages = [], categories = [], subcategories = [], markMessageAsRead, processSale, addClient, updateClient, deleteClient, receivePayment, deleteSale, aceitarCarga, addExpense, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, dailyRouteState, updateDailyRoute, companyName, companyCnpj, clientOrder, setClientOrder
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(() => loadLocalState('v_activeTab', 'HOME'));
  const [selectedClient, setSelectedClient] = useState<Client | null>(() => loadLocalState('v_selectedClient', null));
  const [viewingSale, setViewingSale] = useState<Sale | null>(() => loadLocalState('v_viewingSale', null));
  const [showFiscalization, setShowFiscalization] = useState(() => loadLocalState('v_showFiscalization', false));
  const [viewingClientHistory, setViewingClientHistory] = useState<Client | null>(null);
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const [creditTypeFilter, setCreditTypeFilter] = useState<'TODOS' | 'COMUM' | 'CHEQUE' | 'BOLETO'>('TODOS');
  const [creditSearch, setCreditSearch] = useState('');
  const [clientSearch, setClientSearch] = useState(''); // NOVO: busca na aba clientes

  // Comprovante: estado para modal de foto em contas a receber
  const [comprovanteModalSale, setComprovanteModalSale] = useState<Sale | null>(null);
  const [comprovantePreview, setComprovantePreview] = useState<string | null>(null);
  const comprovanteFileInputRef = useRef<HTMLInputElement | null>(null);
  const [comprovanteUploading, setComprovanteUploading] = useState(false);

  const handleComprovanteCapture = async (saleId: string, file: File) => {
    setComprovanteUploading(true);
    const base64 = await compressImage(file);
    const ok = await saleService.updateSale(saleId, { comprovanteFoto: base64 } as any);
    setComprovanteUploading(false);
    if (ok) setComprovantePreview(base64);
  };

  const handleComprovanteShare = (sale: Sale) => {
    if (sale.comprovanteFoto) shareImage(sale.comprovanteFoto, `comprovante_${sale.id}.jpg`);
  };
  
  const [dismissedClientRiskIds, setDismissedClientRiskIds] = useState<string[]>(() => 
    loadLocalState(`v_dismissed_risk_${user.id}`, [])
  );

  useEffect(() => { saveLocalState('v_activeTab', activeTab); }, [activeTab]);
  useEffect(() => { saveLocalState('v_selectedClient', selectedClient); }, [selectedClient]);
  useEffect(() => { saveLocalState('v_viewingSale', viewingSale); }, [viewingSale]);
  useEffect(() => { saveLocalState('v_showFiscalization', showFiscalization); }, [showFiscalization]);
  useEffect(() => { saveLocalState(`v_dismissed_risk_${user.id}`, dismissedClientRiskIds); }, [dismissedClientRiskIds, user.id]);

  const [reopenedClientIds, setReopenedClientIds] = useState<string[]>([]);
  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [editingClient, setEditingClient] = useState<Client | 'NEW' | null>(null); 
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [financeFilter, setFinanceFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [weeklySearch, setWeeklySearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [cForm, setCForm] = useState<Partial<Client>>({});
  const [confirmSkipId, setConfirmSkipId] = useState<string | null>(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseVal, setExpenseVal] = useState('');

  // ============================================================
  // MODAL: Cliente incompleto (GPS + WhatsApp)
  // ============================================================
  const [clientInfoModal, setClientInfoModal] = useState<Client | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsPinStr, setGpsPinStr] = useState<string>('');
  const [gpsEndereco, setGpsEndereco] = useState<string>('');
  const [gpsBairro, setGpsBairro] = useState<string>('');
  const [modalWhatsapp, setModalWhatsapp] = useState('');

  const isEmptyField = (val: any): boolean => {
    if (val === null || val === undefined) return true;
    const s = String(val).trim();
    if (s === '') return true;
    const placeholders = ['-', '.', '..', '0', 'n/a', 'nao informado', 'nao tem', 'sem endereco', 'sem telefone', 'informar', 's/n', 'n/i'];
    if (placeholders.includes(s.toLowerCase())) return true;
    if (s.replace(/[^a-zA-Z0-9]/g, '').length < 3) return true;
    return false;
  };

  const clientNeedsInfo = (c: Client) => {
    const needsGPS = !c.pinLocalizacao || c.pinLocalizacao.length < 5;
    const needsWhatsapp = isEmptyField(c.telefone);
    return needsGPS || needsWhatsapp;
  };

  const handleAtenderClient = (client: Client) => {
    if (clientNeedsInfo(client)) {
      setModalWhatsapp(client.telefone || '');
      setGpsCoords(null);
      setGpsPinStr(client.pinLocalizacao || '');
      setGpsStatus(client.pinLocalizacao && client.pinLocalizacao.length >= 5 ? 'done' : 'idle');
      setClientInfoModal(client);
    } else {
      setSelectedClient(client);
    }
  };

  const handleGetGPS = () => {
    if (!('geolocation' in navigator)) return;
    setGpsStatus('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const pinStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        setGpsCoords({ lat, lng });
        setGpsPinStr(pinStr);
        // Reverse geocoding para endereco e bairro
        try {
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
            headers: { 'Accept-Language': 'pt-BR' }
          });
          const data = await response.json();
          if (data?.address) {
            const addr = data.address;
            const rua = addr.road || addr.pedestrian || addr.street || '';
            const numero = addr.house_number || '';
            const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.village || '';
            setGpsEndereco(`${rua}${numero ? ', ' + numero : ''}`);
            setGpsBairro(bairro);
          }
        } catch (e) { /* falha silenciosa - salva pelo menos coordenadas */ }
        setGpsStatus('done');
      },
      () => setGpsStatus('error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSaveClientInfo = async () => {
    if (!clientInfoModal) return;
    const updates: any = {};
    if (gpsPinStr && gpsPinStr.length >= 5) updates.pinLocalizacao = gpsPinStr;
    if (gpsEndereco) updates.endereco = gpsEndereco;
    if (gpsBairro) updates.bairro = gpsBairro;
    if (modalWhatsapp && modalWhatsapp.trim().length >= 10) updates.telefone = modalWhatsapp.trim();
    if (Object.keys(updates).length > 0) {
      updateClient(clientInfoModal.id, updates);
    }
    setClientInfoModal(null);
    setSelectedClient(clientInfoModal);
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Memo para última venda de cada cliente (mantido para uso em outras abas)
  const lastSaleByClient = useMemo(() => {
    const map = new Map<string, Date>();
    sales.forEach(s => {
      const existing = map.get(s.clientId);
      const saleDate = new Date(s.data);
      if (!existing || saleDate > existing) {
        map.set(s.clientId, saleDate);
      }
    });
    return map;
  }, [sales]);

  const formatLastSaleDate = (clientId: string) => {
    const date = lastSaleByClient.get(clientId);
    if (!date) return '';
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  const atRiskClients = useMemo(() => {
    const today = new Date();
    return clients.filter(c => {
      if (!c.ativo) return false;
      if (dismissedClientRiskIds.includes(c.id)) return false;

      const cSales = sales.filter(s => s.clientId === c.id);
      if (cSales.length === 0) return false;
      const lastSale = cSales.reduce((latest, s) => {
        const d = new Date(s.data);
        return d > latest ? d : latest;
      }, new Date(0));
      const diffDays = Math.ceil(Math.abs(today.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 25; 
    }).map(c => {
      const cSales = sales.filter(s => s.clientId === c.id);
      const lastSale = cSales.reduce((latest, s) => {
        const d = new Date(s.data);
        return d > latest ? d : latest;
      }, new Date(0));
      const diffDays = Math.ceil(Math.abs(today.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24));
      return { ...c, diasSemCompra: diffDays, dataUltimaVenda: lastSale };
    }).sort((a, b) => b.diasSemCompra - a.diasSemCompra);
  }, [clients, sales, dismissedClientRiskIds]);

  const handleDismissRisk = (clientId: string) => {
    setDismissedClientRiskIds(prev => [...prev, clientId]);
    showToast("Aviso arquivado.");
  };

  const handleMarkMessageAsRead = (msgId: string) => {
    markMessageAsRead(msgId);
    showToast("Mensagem marcada como lida.");
  };

  const filterByPeriod = (date: any, period: string) => {
    if (!date) return false;
    const d = new Date(date);
    const today = new Date();
    if (period === 'DIA') return d.toDateString() === today.toDateString();
    if (period === 'SEMANA') {
      const weekAgo = new Date();
      weekAgo.setDate(today.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === 'MES') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    return true;
  };

  const isSameDay = (date: Date | undefined) => {
    if (!date) return false;
    const d = new Date(date);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  };

  const diaAtual = new Date().getDay();
  const minhaCarga = useMemo(() => (cargas || []).filter(c => c.vendedorId === user.id), [cargas, user.id]);
  
  const orderedCargaProducts = useMemo(() => {
    const cargaMap = new Map(minhaCarga.map(c => [c.produtoId, c]));
    return (products || [])
      .filter(p => cargaMap.has(p.id))
      .map(p => ({
        product: p,
        carga: cargaMap.get(p.id)!
      }));
  }, [products, minhaCarga]);

  const rotaDeHoje = useMemo(() => {
    const clientMap = new Map((clients || []).map(c => [c.id, c]));
    const clientIds = dailyRouteState?.clientIds || [];
    const clientsInRoute = clientIds
      .map(id => clientMap.get(id))
      .filter((c): c is Client => !!c && (c.ativo ?? false));
    return clientsInRoute.sort((a, b) => {
      const orderMap = new Map(clientOrder.map((id, idx) => [id, idx]));
      const idxA = orderMap.get(a.id) ?? (a.ordem || 0);
      const idxB = orderMap.get(b.id) ?? (b.ordem || 0);
      return idxA - idxB;
    }) || []; 
  }, [clients, dailyRouteState, clientOrder]); 

  // NOVO: Clientes filtrados pela busca
  const filteredClients = useMemo(() => {
    let result = clients
      .filter(c => c.rota === (user.rota || 'ROTA_01'))
      .sort((a, b) => {
        const orderMap = new Map(clientOrder.map((id, idx) => [id, idx]));
        const idxA = orderMap.get(a.id) ?? (a.ordem || 0);
        const idxB = orderMap.get(b.id) ?? (b.ordem || 0);
        return idxA - idxB;
      });
    
    if (clientSearch.trim()) {
      const search = clientSearch.toLowerCase();
      result = result.filter(c => 
        c.nomeFantasia.toLowerCase().includes(search) ||
        c.telefone?.includes(search) ||
        c.bairro?.toLowerCase().includes(search)
      );
    }
    return result;
  }, [clients, user.rota, clientOrder, clientSearch]);

  const handleSkipClient = () => { 
    if (!confirmSkipId) return;
    const newSkipped = [...(dailyRouteState?.skippedClientIds || []), confirmSkipId];
    updateDailyRoute(dailyRouteState.clientIds, newSkipped);
    setConfirmSkipId(null);
    showToast("Visita pulada.");
  };

  const handleReopenClient = (clientId: string) => {
    const newSkipped = (dailyRouteState?.skippedClientIds || []).filter(id => id !== clientId);
    updateDailyRoute(dailyRouteState.clientIds, newSkipped);
    setReopenedClientIds(prev => [...prev, clientId]);
  };

  const handleAddToTodayRoute = (clientId: string) => { 
    if (!(dailyRouteState?.clientIds || []).includes(clientId)) { 
      const newRoute = [...(dailyRouteState?.clientIds || []), clientId];
      updateDailyRoute(newRoute, dailyRouteState?.skippedClientIds || []);
      setDismissedClientRiskIds(prev => [...prev, clientId]);
      showToast("Adicionado à rota e aviso removido!"); 
    } 
  };

  const handleOpenEditClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setCForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: diaAtual, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0, rota: user.rota });
    else setCForm({ ...c, endereco: (c.endereco && c.endereco !== '0') ? c.endereco : '', bairro: (c.bairro && c.bairro !== '0') ? c.bairro : '' });
    setEditingClient(c);
  };

  const handlePinLocation = async () => {
    if (!navigator.geolocation) { showToast("GPS não suportado neste navegador.", "error"); return; }
    showToast("Aguardando GPS...");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        const pinStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        setCForm(prev => ({ ...prev, pinLocalizacao: pinStr }));
        try {
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
            headers: { 'Accept-Language': 'pt-BR' }
          });
          const data = await response.json();
          if (data && data.address) {
            const addr = data.address;
            const rua = addr.road || addr.pedestrian || addr.street || '';
            const numero = addr.house_number || '';
            const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.village || '';
            const fullAddr = `${rua}${numero ? ', ' + numero : ''}`;
            setCForm(prev => ({
              ...prev,
              pinLocalizacao: pinStr,
              endereco: fullAddr || '',
              bairro: bairro || ''
            }));
            if (fullAddr || bairro) showToast("Localização e endereço capturados!");
            else showToast("Coordenadas capturadas!");
          } else {
            showToast("Coordenadas capturadas!");
          }
        } catch (error) {
          showToast("Coordenadas capturadas, sem endereço.", "error");
        }
      },
      (error) => {
        let msg = "Erro ao acessar GPS.";
        if (error.code === 1) msg = "Permissão de localização negada.";
        if (error.code === 2) msg = "Sinal de GPS indisponível.";
        if (error.code === 3) msg = "Tempo esgotado ao buscar GPS.";
        showToast(msg, "error");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSaveClientBasic = () => {
    if (!cForm.nomeFantasia || !cForm.telefone) { showToast("Preencha ao menos Nome e Telefone.", 'error'); return; }
    
    const clientData: Omit<Client, 'id'> = { 
      nomeFantasia: cForm.nomeFantasia!, 
      telefone: cForm.telefone!, 
      endereco: cForm.endereco || '', 
      bairro: cForm.bairro || '', 
      diaRoteiro: cForm.diaRoteiro ?? diaAtual, 
      ordem: cForm.ordem ?? 0, 
      ativo: cForm.ativo ?? true, 
      ativarCnpj: cForm.ativarCnpj ?? false, 
      cnpj: cForm.cnpj, 
      pinLocalizacao: cForm.pinLocalizacao, 
      nome: cForm.nome, 
      observacoes: cForm.observacoes,
      rota: user.rota 
    };

    if (editingClient === 'NEW') addClient(clientData);
    else if (typeof editingClient === 'object') updateClient(editingClient.id, clientData); 
    setEditingClient(null);
  };

  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    const saldoEmAberto = Number(((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)); 
    if (isNaN(valor) || valor <= 0 || valor > saldoEmAberto) {
      showToast("Valor inválido.", "error");
      return;
    }
    receivePayment(showReceiveModal.id, method, valor);
    setShowReceiveModal(null);
    setValorRecebidoParcial('');
  };

  const handleLaunchExpense = async () => {
    const val = parseFloat(expenseVal);
    if (!expenseDesc || isNaN(val) || val <= 0) {
      showToast("Preencha descrição e valor.", "error");
      return;
    }
    const success = await addExpense(user.id, expenseDesc, val);
    if (success) {
      showToast("Despesa lançada!");
      setExpenseDesc('');
      setExpenseVal('');
      setShowExpenseForm(false);
    }
  };

  // Mover cliente na ordem GLOBAL (para aba CLIENTES) - função mantida para compatibilidade mas não usada na UI
  const moveClient = (id: string, dir: 'UP' | 'DOWN') => {
    const currentOrder = clientOrder.length > 0 ? clientOrder : clients.map(c => c.id);
    const idx = currentOrder.indexOf(id);
    if (idx === -1) return;
    const newOrder = [...currentOrder];
    if (dir === 'UP' && idx > 0) [newOrder[idx], newOrder[idx-1]] = [newOrder[idx-1], newOrder[idx]];
    else if (dir === 'DOWN' && idx < newOrder.length - 1) [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]];
    setClientOrder(newOrder);
    showToast("Ordem do cliente atualizada!");
  };

  // NOVO: Mover cliente DENTRO DO DIA (para aba ROTEIRO SEMANAL) - PERSISTE NO SUPABASE
  const moveClientInDay = (clientId: string, dir: 'UP' | 'DOWN', day: number) => {
    // 1. Pega todos os clientes ativos da rota do vendedor, ordenados pela ordem global atual (clientOrder)
    const allClientsSorted = [...clients]
      .filter(c => c.ativo && c.rota === (user.rota || 'ROTA_01'))
      .sort((a, b) => {
        const orderMap = new Map(clientOrder.map((id, idx) => [id, idx]));
        const idxA = orderMap.get(a.id) ?? (a.ordem || 0);
        const idxB = orderMap.get(b.id) ?? (b.ordem || 0);
        return idxA - idxB;
      });

    // 2. Separa os clientes do dia alvo e dos outros dias
    const dayClients = allClientsSorted.filter(c => c.diaRoteiro === day);
    const otherDayClients = allClientsSorted.filter(c => c.diaRoteiro !== day);
    
    const dayClientIds = dayClients.map(c => c.id);
    const idx = dayClientIds.indexOf(clientId);
    if (idx === -1) return;

    // 3. Reordena apenas dentro do dia
    const newDayOrder = [...dayClientIds];
    if (dir === 'UP' && idx > 0) {
      [newDayOrder[idx], newDayOrder[idx-1]] = [newDayOrder[idx-1], newDayOrder[idx]];
    } else if (dir === 'DOWN' && idx < newDayOrder.length - 1) {
      [newDayOrder[idx], newDayOrder[idx+1]] = [newDayOrder[idx+1], newDayOrder[idx]];
    }

    // 4. Reconstrói a ordem global mantendo a ordem relativa dos outros dias
    const otherDayIds = otherDayClients.map(c => c.id);
    
    // Encontra onde o primeiro cliente desse dia estava na ordem global original
    const firstDayClientGlobalIdx = allClientsSorted.findIndex(c => c.diaRoteiro === day);
    
    let newGlobalOrder: string[];
    if (firstDayClientGlobalIdx === -1) {
      // Se não tinha clientes nesse dia, adiciona no final
      newGlobalOrder = [...otherDayIds, ...newDayOrder];
    } else {
      // Insere o dia reordenado na posição correta
      newGlobalOrder = [
        ...otherDayIds.slice(0, firstDayClientGlobalIdx),
        ...newDayOrder,
        ...otherDayIds.slice(firstDayClientGlobalIdx)
      ];
    }

    // 5. Salva no Supabase via App.tsx -> appSettingsService
    setClientOrder(newGlobalOrder);
    showToast("Ordem do dia atualizada e salva!");
  };

  // NOVO: Mover cliente para outro dia
  const moveClientToDay = (clientId: string, newDay: number) => {
    updateClient(clientId, { diaRoteiro: newDay });
    showToast(`Cliente movido para ${DIAS_SEMANA[newDay]}`);
  };

  const MenuCard = ({ icon, title, tab, color, badge }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center relative">
      {badge && <div className="absolute top-4 right-4 bg-red-600 text-white text-[8px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white animate-bounce">{badge === true ? '' : badge}</div>}
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700">{title}</span>
    </button>
  );

  const filteredHistory = useMemo(() => (sales || []).filter(s => s.vendedorId === user.id && filterByPeriod(s.data, historyFilter)).sort((a, b) => (new Date(b.data).getTime() ?? 0) - (new Date(a.data).getTime() ?? 0)), [sales, user.id, historyFilter]); 
  
  const financeStats = useMemo(() => {
    const vCommsAll = (commissions || []).filter(c => c.vendedorId === user.id);
    const vCommsFiltered = vCommsAll.filter(c => filterByPeriod(c.dataGeracao, financeFilter));

    const totalGerado = vCommsFiltered.reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const aReceber = vCommsAll.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const liberadas = vCommsAll.filter(c => c.status === 'DISPONIVEL').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const pagas = vCommsAll.filter(c => c.status === 'PAGO').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    
    return { 
      totalGerado: Number(totalGerado.toFixed(2)),
      aReceber: Number(aReceber.toFixed(2)),
      liberadas: Number(liberadas.toFixed(2)), 
      pagas: Number(pagas.toFixed(2)) 
    };
  }, [commissions, user.id, financeFilter]);

  const historySummary = useMemo(() => filteredHistory.reduce((acc, sale) => {
    acc.total += (sale.valorTotal ?? 0); 
    if (sale.metodoPagamento === 'DINHEIRO') acc.dinheiro += (sale.valorTotal ?? 0);
    if (sale.metodoPagamento === 'PIX') acc.pix += (sale.valorTotal ?? 0);
    if (sale.metodoPagamento === 'A_PRAZO') acc.prazo += (sale.valorTotal ?? 0);
    return acc;
  }, { total: 0, dinheiro: 0, pix: 0, prazo: 0 }), [filteredHistory]);

  const contasAReceber = useMemo(() => {
    let filtered = (sales || []).filter(s => s.vendedorId === user.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE');
    if (filterOverdueOnly) {
      const today = new Date();
      today.setHours(0,0,0,0);
      filtered = filtered.filter(s => {
        if (!s.dataVencimento) return false;
        const dueDate = new Date(s.dataVencimento);
        dueDate.setHours(0,0,0,0);
        return dueDate <= today;
      });
    }

    if (creditTypeFilter !== 'TODOS') {
      filtered = filtered.filter(s => {
        const desc = s.detalhePagamento?.toUpperCase() || '';
        if (creditTypeFilter === 'CHEQUE') return desc.includes('CHEQUE');
        if (creditTypeFilter === 'BOLETO') return desc.includes('BOLETO');
        if (creditTypeFilter === 'COMUM') return desc.includes('COMUM') || (!desc.includes('CHEQUE') && !desc.includes('BOLETO'));
        return true;
      });
    }

    if (creditSearch) {
      filtered = filtered.filter(s => {
        const client = clients.find(c => c.id === s.clientId);
        return client?.nomeFantasia.toLowerCase().includes(creditSearch.toLowerCase());
      });
    }

    return filtered;
  }, [sales, user.id, filterOverdueOnly, creditTypeFilter, creditSearch, clients]);

  const valorTotalCarga = useMemo(() => minhaCarga.reduce((acc, curr) => {
    const p = products.find(prod => prod.id === curr.produtoId);
    return acc + ((curr.quantidade ?? 0) * (p?.precoVenda ?? 0)); 
  }, 0), [minhaCarga, products]);

  const totalUnidadesCarga = useMemo(() => minhaCarga.reduce((acc, curr) => acc + (curr.quantidade ?? 0), 0), [minhaCarga]);

  const unifiedHistory = useMemo(() => {
    const combined = [
      ...(payoutLogs || []).map(p => ({ 
        id: p.id, 
        data: new Date(p.dataPagamento), 
        desc: p.tipo === 'TOTAL' ? 'Pagamento Integral' : 'Repasse Parcial', 
        valor: p.valorPago, 
        tipo: 'REPASSE' as const 
      })),
      ...(expenses || []).map(e => ({ 
        id: e.id, 
        data: new Date(e.createdAt), 
        desc: e.descricao, 
        valor: e.valor, 
        tipo: 'DESPESA' as const 
      }))
    ];
    return combined.sort((a, b) => b.data.getTime() - a.data.getTime());
  }, [payoutLogs, expenses]);

  const handleNavigateToCredit = () => {
    setSelectedClient(null);
    setActiveTab('CREDIT');
  };

  if (selectedClient) {
    const pdvClient = clients.find(c => c.id === selectedClient.id);
    if (!pdvClient) { setSelectedClient(null); return null; }
    return (
      <PDV
        client={pdvClient} products={products} minhaCarga={minhaCarga} vendedorId={user.id} onCancel={() => setSelectedClient(null)}
        onFinish={() => { 
          setSelectedClient(null); 
          setActiveTab('ROTEIRO'); 
          showToast("Venda realizada com sucesso!", 'success'); 
        }}
        processSale={processSale} margemMinima={margemMinima} margemMinimaAtiva={margemMinimaAtiva} pix1Name={pix1Name} pix1Code={pix1Code} pix2Name={pix2Name} pix2Code={pix2Code}
        sales={sales} 
        onNavigateToCredit={handleNavigateToCredit}
        categories={categories}
        subcategories={subcategories}
      />
    );
  }

  if (viewingSale) {
    const cupomClient = clients.find(c => c.id === viewingSale.clientId);
    if (!cupomClient) { setViewingSale(null); return null; }
    const canDeleteSale = (() => {
      const saleDate = new Date(viewingSale.data);
      const now = new Date();
      const sameDay = saleDate.getFullYear() === now.getFullYear()
        && saleDate.getMonth() === now.getMonth()
        && saleDate.getDate() === now.getDate();
      return sameDay;
    })();
    return ( <Cupom sale={viewingSale} client={cupomClient} products={products} onClose={() => setViewingSale(null)} onDeleteSale={deleteSale} allowDelete={canDeleteSale} showToast={showToast} /> );
  }

  if (showFiscalization) {
    return (
      <RelatorioFiscal 
        user={user} carga={minhaCarga} products={products} 
        companyName={companyName} companyCnpj={companyCnpj} 
        onClose={() => setShowFiscalization(false)} 
      />
    );
  }

  return (
    <div className="space-y-4 pb-20">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center pointer-events-none">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3 animate-in slide-in-from-top`}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>{toast.message}
          </div>
        </div>
      )}

      {activeTab !== 'HOME' && <button onClick={() => { setActiveTab('HOME'); setCreditSearch(''); }} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2 active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="py-4 grid grid-cols-2 gap-4">
          <MenuCard icon="fa-route" title="Rota do Dia" tab="ROTEIRO" color="bg-blue-50 text-blue-600" />
          <MenuCard icon="fa-bell" title="Avisos" tab="AVISOS" color="bg-rose-50 text-rose-600" badge={atRiskClients.length > 0 ? atRiskClients.length : false} />
          <MenuCard icon="fa-truck-fast" title="Minha Carga" tab="CARGA" color="bg-purple-50 text-purple-600" badge={(cargasPendentes || []).length > 0} />
          <MenuCard icon="fa-receipt" title="Vendas" tab="HISTORY" color="bg-blue-50 text-[#1E3A5F]" />
          <MenuCard icon="fa-wallet" title="Financeiro" tab="FINANCE" color="bg-emerald-50 text-[#1F7A4D]" badge={(messages || []).some(m => !m.lida && m.type === 'COMMISSION_CONFIRMATION')} />
          <MenuCard icon="fa-file-invoice-dollar" title="Contas a Receber" tab="CREDIT" color="bg-rose-50 text-rose-600" />
          <MenuCard icon="fa-users" title="Clientes" tab="CLIENTES" color="bg-green-50 text-green-600" />
          <MenuCard icon="fa-calendar-days" title="Roteiro Semanal" tab="WEEKLY" color="bg-indigo-50 text-indigo-600" />
          <MenuCard icon="fa-boxes-stacked" title="Estoque" tab="STOCK_VIEW" color="bg-yellow-50 text-yellow-600" />
        </div>
      )}

      {activeTab === 'AVISOS' && (
        <div className="space-y-4">
          <header className="px-1 flex flex-col gap-1">
            <h2 className="text-xl font-black text-gray-800 tracking-tight leading-none">Avisos</h2>
            <p className="text-[10px] font-black uppercase text-gray-400">Clientes ausentes há mais de 25 dias</p>
          </header>
          <div className="grid gap-2">
            {atRiskClients.map(c => {
              const lastDate = formatLastSaleDate(c.id);
              return (
                <div key={c.id} className="bg-white p-4 rounded-3xl border border-rose-50 shadow-sm flex items-center justify-between transition-all group">
                  <div className="flex-1 min-w-0 pr-3">
                    <h4 className="font-black text-gray-800 text-xs uppercase truncate">{c.nomeFantasia}</h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[9px] font-black text-rose-600 uppercase bg-rose-50 px-2 py-0.5 rounded-lg">{c.diasSemCompra} dias</span>
                      <span className="text-[9px] text-gray-400 font-bold uppercase truncate">Ult: {new Date(c.dataUltimaVenda).toLocaleDateString()}</span>
                      {lastDate && (
                        <span className="text-[9px] text-indigo-600 font-black uppercase bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                          <i className="fa-solid fa-clock mr-1 text-[7px]"></i>Últ: {lastDate}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDismissRisk(c.id)}
                      className="bg-emerald-50 text-emerald-600 w-10 h-10 rounded-2xl flex items-center justify-center border border-emerald-100 active:scale-90 transition-all"
                      title="Marcar como visto"
                    >
                      <i className="fa-solid fa-check"></i>
                    </button>
                    <button 
                      onClick={() => handleAddToTodayRoute(c.id)}
                      className="bg-blue-600 text-white w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-all"
                      title="Puxar p/ hoje"
                    >
                      <i className="fa-solid fa-plus"></i>
                    </button>
                  </div>
                </div>
              );
            })}
            {atRiskClients.length === 0 && (
              <div className="text-center py-20 opacity-30 flex flex-col items-center gap-4">
                <i className="fa-solid fa-circle-check text-5xl"></i>
                <p className="font-black uppercase tracking-widest text-[10px]">Tudo em dia!</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-4">
          <header className="flex justify-between items-center px-1">
            <div className="flex flex-col items-start"><h2 className="text-xl font-black text-gray-800 tracking-tight leading-none">{DIAS_SEMANA[diaAtual] ?? 'N/D'}</h2><span className="text-[10px] font-black uppercase text-gray-400 mt-1">{new Date().toLocaleDateString()}</span></div>
            <span className="bg-blue-100 text-blue-600 text-[10px] px-2 py-1 rounded-lg font-black uppercase">{rotaDeHoje.length} VISITAS</span>
          </header>
          {rotaDeHoje.map(c => {
            const isSold = (sales || []).some(s => s.clientId === c.id && isSameDay(s.data));
            const isSkipped = (dailyRouteState?.skippedClientIds || []).includes(c.id);
            const isVisited = (isSold || isSkipped) && !reopenedClientIds.includes(c.id);
            return (
              <div key={c.id} className={`p-4 rounded-3xl border flex items-center justify-between transition-all ${isVisited ? 'bg-gray-100 border-gray-200 grayscale opacity-60' : 'bg-white border-gray-100 shadow-sm'}`}>
                {/* LADO ESQUERDO: NOME COMPLETO (SEM TRUNCATE) + BAIRRO */}
                <div className="flex-1 min-w-0 cursor-pointer pr-4" onClick={() => setViewingClientHistory(c)}>
                  <p className="font-bold text-gray-800 leading-tight uppercase">{c.nomeFantasia ?? 'Cliente'}</p>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold mt-1">
                    <i className="fa-solid fa-location-dot mr-1"></i> {(c.bairro || 'S/B')}
                  </p>
                </div>
                
                {/* LADO DIREITO: BOTÕES ALINHADOS À DIREITA */}
                {!isVisited ? (
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <button onClick={() => setConfirmSkipId(c.id)} className="w-10 h-10 bg-gray-50 text-gray-400 rounded-2xl flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-forward"></i></button>
                    <button onClick={() => handleAtenderClient(c)} className="bg-blue-600 text-white px-4 py-2 rounded-2xl font-black text-xs uppercase shadow-lg flex-shrink-0 whitespace-nowrap">Atender</button>
                  </div>
                ) : (
                  <button onClick={() => handleReopenClient(c.id)} className="bg-white text-blue-600 border border-blue-200 px-4 py-2 rounded-xl text-[9px] font-black uppercase ml-4 flex-shrink-0 whitespace-nowrap">Reabrir</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <header className="px-1 flex justify-between items-center">
            <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Meus Clientes</h2>
            <button onClick={() => handleOpenEditClient('NEW')} className="bg-green-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-md active:scale-95">
              <i className="fa-solid fa-user-plus mr-2"></i>Novo
            </button>
          </header>
          
          {/* NOVO: Campo de busca com lupa */}
          <div className="px-1 relative">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg"></i>
              <input
                type="text"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar por nome, telefone ou bairro..."
                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl shadow-sm text-sm outline-none focus:ring-2 focus:ring-green-100"
              />
              {clientSearch && (
                <button
                  onClick={() => setClientSearch('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 active:text-gray-600"
                >
                  <i className="fa-solid fa-xmark text-lg"></i>
                </button>
              )}
            </div>
            {clientSearch && (
              <p className="text-[10px] text-green-600 font-black uppercase mt-2 ml-1">
                {filteredClients.length} cliente(s) encontrado(s)
              </p>
            )}
          </div>

          <div className="grid gap-3 px-1">
            {filteredClients.map(c => (
              <div key={c.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between transition-all active:scale-95 group">
                {/* SEM SETAS DE ORDENAÇÃO - REMOVIDAS CONFORME SOLICITADO */}
                <div className="flex-1 cursor-pointer" onClick={() => setViewingClientHistory(c)}>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-gray-800 text-sm leading-tight uppercase">{c.nomeFantasia ?? 'Cliente'}</h4>
                    {c.telefone && (
                      <a 
                        href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}`} 
                        target="_blank" 
                        className="text-emerald-500" 
                        onClick={(e) => e.stopPropagation()}
                      >
                        <i className="fa-brands fa-whatsapp text-lg"></i>
                      </a>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase mt-1">{c.telefone} • {DIAS_SEMANA[c.diaRoteiro]}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={(e) => { e.stopPropagation(); handleOpenEditClient(c); }} className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center active:scale-95"><i className="fa-solid fa-pencil-alt text-xs"></i></button>
                </div>
              </div>
            ))}
            {filteredClients.length === 0 && clientSearch && (
              <div className="text-center py-12 opacity-30 flex flex-col items-center gap-4">
                <i className="fa-solid fa-magnifying-glass text-4xl text-gray-300"></i>
                <p className="font-black uppercase tracking-widest text-[10px]">Nenhum cliente encontrado</p>
                <p className="text-[9px] text-gray-400">Tente outra busca</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'WEEKLY' && (
        <div className="space-y-6 py-4">
          <div className="px-1 flex justify-between items-center"><h2 className="text-xl font-black text-gray-800 tracking-tight">Roteiro Semanal</h2></div>
          <div className="px-1"><input value={weeklySearch} onChange={e => setWeeklySearch(e.target.value)} placeholder="Filtrar por nome..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm outline-none focus:ring-2 focus:ring-indigo-100" /></div>
          <div className="space-y-3 px-1">
            {[1, 2, 3, 4, 5, 6].map(dia => {
              const isOpen = expandedDay === dia;
              const clientsInDay = (clients || [])
                .filter(c => c.diaRoteiro === dia && c.ativo && c.rota === (user.rota || 'ROTA_01') && (weeklySearch === '' || (c.nomeFantasia || '').toLowerCase().includes(weeklySearch.toLowerCase())))
                .sort((a, b) => {
                  const orderMap = new Map(clientOrder.map((id, idx) => [id, idx]));
                  const idxA = orderMap.get(a.id) ?? (a.ordem || 0);
                  const idxB = orderMap.get(b.id) ?? (b.ordem || 0);
                  return idxA - idxB;
                }); 
              return (
                <div key={dia} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <button onClick={() => setExpandedDay(isOpen ? null : dia)} className={`w-full flex items-center justify-between p-5 text-left ${isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-700'}`}>
                    <div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${isOpen ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{dia}</div><span className="font-black uppercase text-xs tracking-tight">{DIAS_SEMANA[dia]}</span></div>
                    <div className="flex items-center gap-2"><span className="text-[9px] font-black uppercase opacity-40">{clientsInDay.length} clients</span><i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`}></i></div>
                  </button>
                  {isOpen && (
                    <div className="p-4 bg-white space-y-2 border-t border-indigo-50">
                      {clientsInDay.map(c => (
                        <div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex items-center justify-between group">
                          <div className="flex flex-col gap-1 mr-3">
                            <button onClick={(e)=>{e.stopPropagation(); moveClientInDay(c.id, 'UP', dia);}} className="w-7 h-7 bg-white border text-gray-400 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                            <button onClick={(e)=>{e.stopPropagation(); moveClientInDay(c.id, 'DOWN', dia);}} className="w-7 h-7 bg-white border text-gray-400 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                          </div>
                          <div className="flex-1 cursor-pointer min-w-0" onClick={() => setViewingClientHistory(c)}>
                            <p className="font-bold text-gray-800 text-xs uppercase truncate">{c.nomeFantasia}</p>
                            <p className="text-[9px] text-gray-400 font-bold mt-0.5">{c.bairro || 'Sem Bairro'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleAddToTodayRoute(c.id)} className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-plus text-xs"></i></button>
                            <button onClick={(e)=>{e.stopPropagation(); handleOpenEditClient(c);}} className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-pencil-alt text-xs"></i></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'CARGA' && (
        <div className="space-y-4">
          {(cargasPendentes || []).length > 0 ? (
            <div className="bg-orange-50 p-6 rounded-3xl shadow-xl flex flex-col gap-4 items-center text-center">
              <i className="fa-solid fa-truck-loading text-orange-600 text-4xl mb-2"></i>
              <h3 className="text-xl font-black text-orange-800 uppercase">Nova Carga Disponível!</h3>
              <button onClick={() => aceitarCarga(cargasPendentes[0].id)} className="w-full bg-orange-600 text-white font-black py-5 rounded-2xl shadow-lg active:scale-95 text-sm uppercase">ACEITAR CARGA</button>
            </div>
          ) : (
            <>
              <div className="bg-purple-600 text-white p-6 rounded-3xl shadow-xl flex justify-between items-center">
                 <div><p className="text-[10px] font-black uppercase opacity-60">Valor Total Carga</p><h3 className="text-2xl font-black">R$ {valorTotalCarga.toFixed(2)}</h3></div>
                 <div className="text-right"><p className="text-[10px] font-black uppercase opacity-60">Volume Total</p><h3 className="text-2xl font-black">{totalUnidadesCarga}</h3></div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50"><tr><th className="p-4 text-[10px] font-black text-gray-400 uppercase">Item</th><th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase">Preço</th><th className="p-4 text-right text-[10px] font-black text-gray-400 uppercase">Qtd</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {orderedCargaProducts.map(({ product: p, carga: c }) => (
                      <tr key={c.produtoId}>
                        <td className="p-4 text-xs font-semibold uppercase">{p.nome ?? 'Desc.'}</td>
                        <td className="p-4 text-center text-xs text-gray-400">R$ {(p.precoVenda ?? 0).toFixed(2)}</td>
                        <td className="p-4 text-right font-black text-lg text-blue-600">{c.quantidade}</td>
                      </tr>
                    ))}
                  </tbody> 
                </table>
              </div>

              <button 
                onClick={() => setShowFiscalization(true)}
                className="w-full bg-slate-800 text-white font-black py-5 rounded-[2rem] shadow-xl active:scale-95 transition-all uppercase text-[11px] tracking-[0.2em] flex items-center justify-center gap-3"
              >
                <i className="fa-solid fa-shield-halved text-lg"></i> Modo Fiscalização
              </button>
            </>
          )}
        </div>
      )}

      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow_inner">{(['DIA', 'SEMANA', 'MES', 'GERAL'] as const).map(f => (<button key={f} onClick={() => setHistoryFilter(f)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase ${historyFilter === f ? 'bg-white text-[#1E3A5F] shadow-sm' : 'text-gray-400'}`}>{f}</button>))}</div>
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex flex-col gap-4">
             <div className="flex justify-between items-center border-b border-gray-100 pb-3"><span className="text-xs font-black text-gray-400 uppercase">Total Geral</span><span className="text-2xl font-black text-gray-900">R$ {historySummary.total.toFixed(2)}</span></div>
             <div className="grid grid-cols-3 gap-3">
                <div className="text-center bg-emerald-50 p-3 rounded-xl"><p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Dinheiro</p><p className="text-sm font-black text-emerald-700">R$ {historySummary.dinheiro.toFixed(2)}</p></div>
                <div className="text-center bg-blue-50 p-3 rounded-xl"><p className="text-[9px] font-black text-blue-600 uppercase mb-1">Pix</p><p className="text-sm font-black text-blue-700">R$ {historySummary.pix.toFixed(2)}</p></div>
                <div className="text-center bg-orange-50 p-3 rounded-xl"><p className="text-[9px] font-black text-orange-600 uppercase mb-1">A Prazo</p><p className="text-sm font-black text-orange-700">R$ {historySummary.prazo.toFixed(2)}</p></div>
             </div>
          </div>
          <div className="grid gap-3 px-1">
            {filteredHistory.map(s => {
              const client = clients.find(c => c.id === s.clientId);
              const isCheque = s.metodoPagamento === 'A_PRAZO' && s.detalhePagamento?.toUpperCase().includes('CHEQUE');
              
              return (
                <div key={s.id} className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between transition-all active:scale-[0.98] hover:border-blue-200 group">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${
                        s.metodoPagamento === 'DINHEIRO' ? 'bg-emerald-50 text-emerald-600' : 
                        s.metodoPagamento === 'PIX' ? 'bg-blue-50 text-blue-600' : 
                        isCheque ? 'bg-purple-50 text-purple-600' :
                        'bg-orange-50 text-orange-600'
                      }`}>
                        {isCheque ? 'CHEQUE' : s.metodoPagamento === 'A_PRAZO' ? 'PRAZO' : s.metodoPagamento}
                      </span>
                      <span className="text-[9px] text-gray-300 font-bold">{new Date(s.data).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    </div>
                    <h4 className="font-black text-gray-800 text-[13px] leading-tight uppercase truncate cursor-pointer hover:text-blue-600" onClick={() => setViewingClientHistory(client!)}>
                      {client?.nomeFantasia ?? 'Cliente'}
                    </h4>
                  </div>
                  <div className="text-right flex items-center gap-4">
                    <div>
                      <p className="text-sm font-black text-gray-800 leading-none">R$ {s.valorTotal.toFixed(2)}</p>
                      <p className="text-[9px] text-gray-400 font-bold uppercase mt-1">Total</p>
                    </div>
                    <button onClick={() => setViewingSale(s)} className="w-10 h-10 bg-gray-50 text-gray-400 group-hover:bg-blue-600 group-hover:text-white rounded-2xl flex items-center justify-center transition-all">
                      <i className="fa-solid fa-file-invoice text-sm"></i>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'FINANCE' && (
        <div className="space-y-6">
           <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow_inner">{(['DIA', 'SEMANA', 'MES', 'GERAL'] as const).map(f => (<button key={f} onClick={() => setFinanceFilter(f)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase ${financeFilter === f ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'}`}>{f}</button>))}</div>
           
           <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col text-center">
              <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Comissões Geradas no Período</p>
              <h2 className="text-2xl font-black text-blue-600">R$ {financeStats.totalGerado.toFixed(2)}</h2>
           </div>

           <div className="grid grid-cols-2 gap-4">
              <div className="bg-orange-50 p-5 rounded-3xl shadow-sm border border-orange-100">
                <p className={`text-[9px] font-black text-orange-600 uppercase mb-1`}>A receber</p>
                <p className="text-xl font-black text-orange-700">R$ {financeStats.aReceber.toFixed(2)}</p>
                <p className={`text-[8px] font-bold text-orange-400 uppercase mt-1`}>Vendas a prazo</p>
              </div>
              <div className={`${financeStats.liberadas < 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'} p-5 rounded-3xl shadow-md border`}>
                <p className={`text-[9px] font-black ${financeStats.liberadas < 0 ? 'text-rose-600' : 'text-emerald-600'} uppercase mb-1`}>Liberadas</p>
                <p className={`text-xl font-black ${financeStats.liberadas < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>R$ {financeStats.liberadas.toFixed(2)}</p>
                <p className={`text-[8px] font-bold ${financeStats.liberadas < 0 ? 'text-rose-400' : 'text-emerald-400'} uppercase mt-1`}>Disponível para saque</p>
              </div>
           </div>

           <div className="bg-gray-900 text-white p-6 rounded-[2.5rem] shadow-xl flex justify-between items-center">
              <div>
                 <p className="text-[10px] font-black uppercase opacity-60 mb-1">Total Já Pago pelo Admin</p>
                 <h3 className="text-2xl font-black text-emerald-400">R$ {financeStats.pagas.toFixed(2)}</h3>
              </div>
              <i className="fa-solid fa-circle-check text-emerald-400 text-3xl opacity-30"></i>
           </div>

           <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">Lançar Despesa</h3>
                <button 
                  onClick={() => setShowExpenseForm(!showExpenseForm)} 
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${showExpenseForm ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'}`}
                >
                  <i className={`fa-solid ${showExpenseForm ? 'fa-xmark' : 'fa-plus'}`}></i>
                </button>
              </div>
              
              {showExpenseForm && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Descrição do Gasto</label>
                    <input 
                      value={expenseDesc} 
                      onChange={e => setExpenseDesc(e.target.value)} 
                      placeholder="Ex: Combustível, Almoço..." 
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-semibold outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor R$</label>
                    <input 
                      type="number" 
                      value={expenseVal} 
                      onChange={e => setExpenseVal(e.target.value)} 
                      placeholder="0.00" 
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-lg font-black outline-none"
                    />
                  </div>
                  <button 
                    onClick={handleLaunchExpense}
                    className="w-full bg-rose-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest"
                  >
                    Confirmar Despesa
                  </button>
                </div>
              )}
           </div>

           <div className="space-y-2 pt-4">
             <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Notificações</h3>
             <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
                {messages.filter(m => m.vendedorId === user.id).sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).map(m => (
                    <div key={m.id} className={`p-4 flex justify-between items-center transition-colors ${!m.lida ? 'bg-blue-50/50' : 'bg-white'}`}>
                        <div className="flex-1 pr-3">
                            <p className={`text-[11px] font-black uppercase leading-none mb-1 ${!m.lida ? 'text-blue-700' : 'text-gray-700'}`}>{m.titulo}</p>
                            <p className="text-[10px] font-semibold text-gray-500 mt-1">{m.mensagem}</p>
                            <p className="text-[8px] text-gray-400 mt-1">{new Date(m.data).toLocaleDateString()} {new Date(m.data).toLocaleTimeString()}</p>
                        </div>
                        {!m.lida && m.type === 'COMMISSION_CONFIRMATION' && (
                            <button 
                                onClick={() => handleMarkMessageAsRead(m.id)} 
                                className="bg-emerald-600 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase active:scale-95 shadow-md"
                            >
                                Confirmar
                            </button>
                        )}
                        {m.lida && <i className="fa-solid fa-check-circle text-emerald-500 text-lg"></i>}
                    </div>
                ))}
                {messages.filter(m => m.vendedorId === user.id).length === 0 && (
                    <div className="text-center py-8 opacity-30 italic text-[9px] uppercase font-bold tracking-widest">Nenhuma notificação.</div>
                )}
             </div>
           </div>
        </div>
      )}

      {activeTab === 'CREDIT' && (
        <div className="space-y-4">
          <header className="px-1 flex justify-between items-center">
            <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Contas a Receber</h2>
            <button 
              onClick={() => setFilterOverdueOnly(!filterOverdueOnly)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 shadow-sm ${filterOverdueOnly ? 'bg-rose-600 text-white' : 'bg-white text-gray-400 border border-gray-100'}`}
            >
              <i className={`fa-solid ${filterOverdueOnly ? 'fa-calendar-exclamation' : 'fa-calendar-days'}`}></i>
              {filterOverdueOnly ? 'Vencidas/Hoje' : 'Todas'}
            </button>
          </header>

          <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 shadow-inner overflow-x-auto gap-1">
            {(['TODOS', 'COMUM', 'CHEQUE', 'BOLETO'] as const).map(t => (
              <button 
                key={t} 
                onClick={() => setCreditTypeFilter(t)} 
                className={`flex-1 min-w-[70px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${creditTypeFilter === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}
              >
                {t === 'COMUM' ? 'Comum' : t}
              </button>
            ))}
          </div>

          <div className="px-1">
            <input value={creditSearch} onChange={e => setCreditSearch(e.target.value)} placeholder="Buscar cliente..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm outline-none focus:ring-2 focus:ring-blue-100" />
          </div>

          <div className="grid gap-3">
            {contasAReceber.map(s => {
              const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2)); 
              const today = new Date();
              today.setHours(0,0,0,0);
              const dueDate = s.dataVencimento ? new Date(s.dataVencimento) : null;
              if (dueDate) dueDate.setHours(0,0,0,0);
              const isOverdue = dueDate ? dueDate <= today : false;

              return (
              <div key={s.id} className={`p-5 rounded-3xl border shadow-sm flex flex-col transition-all ${isOverdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100'}`}>
                <div className="flex justify-between items-start mb-2">
                   <div className="flex-1 pr-4">
                      <h4 className={`font-bold text-sm leading-tight uppercase cursor-pointer ${isOverdue ? 'text-rose-900' : 'text-gray-800'}`} onClick={() => setViewingClientHistory(clients.find(c => c.id === s.clientId)!)}>{clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4>
                      <div className="flex flex-col mt-2">
                        <span className={`text-[9px] font-black uppercase ${isOverdue ? 'text-rose-600' : 'text-gray-400'}`}>Vencimento</span>
                        <span className={`text-xs font-black ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>{s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</span>
                        <span className="text-[8px] font-black uppercase text-blue-600 mt-1">{s.detalhePagamento || 'COMUM'}</span>
                      </div>
                      
                      {s.detalhePagamento && (
                        <div className="mt-3 space-y-1">
                          <p className="text-[8px] font-black text-gray-400 uppercase">Histórico de Recebimentos:</p>
                          <div className="bg-gray-50/50 p-2 rounded-xl border border-gray-100 max-h-24 overflow-y-auto">
                            {s.detalhePagamento.split('|').map((log, i) => (
                              <p key={i} className="text-[8px] font-bold text-gray-500 border-b border-gray-100 last:border-0 pb-1 mb-1">{log.trim()}</p>
                            ))}
                          </div>
                        </div>
                      )}
                   </div>
                   <div className="text-right">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${isOverdue ? 'bg-rose-600 text-white animate-pulse' : 'bg-orange-100 text-orange-600'}`}>
                        {isOverdue ? 'VENCIDO / HOJE' : 'PENDENTE'}
                      </span>
                      <p className="text-lg font-black mt-2 text-rose-600">Saldo: R$ {saldo.toFixed(2)}</p>
                   </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className={`w-full py-3 rounded-2xl text-[10px] font-black uppercase mt-3 shadow-lg active:scale-95 ${isOverdue ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>Receber Agora</button>
                <div className="flex gap-2 mt-2">
                  {s.comprovanteFoto ? (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); setComprovanteModalSale(s); setComprovantePreview(s.comprovanteFoto || null); }} className="flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase bg-blue-50 text-blue-600 active:scale-95 flex items-center justify-center gap-1.5 border border-blue-100">
                        <i className="fa-solid fa-image"></i>Ver Foto
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleComprovanteShare(s); }} className="flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase bg-emerald-50 text-emerald-600 active:scale-95 flex items-center justify-center gap-1.5 border border-emerald-100">
                        <i className="fa-brands fa-whatsapp"></i>Compartilhar
                      </button>
                    </>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setComprovanteModalSale(s); setComprovantePreview(null); setTimeout(() => comprovanteFileInputRef.current?.click(), 100); }} className="w-full py-2.5 rounded-xl text-[9px] font-black uppercase bg-amber-50 text-amber-600 active:scale-95 flex items-center justify-center gap-1.5 border border-amber-100">
                      <i className="fa-solid fa-camera"></i>Tirar Foto do Comprovante
                    </button>
                  )}
                </div>
              </div>
            )})}
            {contasAReceber.length === 0 && (
               <div className="text-center py-20 opacity-20 italic font-black uppercase tracking-widest text-[10px]">Nenhuma conta pendente</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'STOCK_VIEW' && (
        <div className="space-y-4">
          <header className="px-1"><h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Estoque Central</h2></header>
          <div className="grid gap-3">
            {products.map(p => ( 
              <div key={p.id} className="bg-white px-4 py-3 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div className="flex-1"><h3 className="font-bold text-gray-800 text-sm leading-tight uppercase">{p.nome}</h3><div className="flex items-center gap-2 mt-1"><span className="text-[10px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded tracking-tighter"><i className="fa-solid fa-house mr-1 text-[8px]"></i>{p.estoquePrincipal} un</span></div></div>
                <div className="text-right"><p className="text-sm font-black text-emerald-600">R$ {p.precoVenda.toFixed(2)}</p></div> 
              </div>
            ))}
          </div>
        </div>
      )}

      {clientInfoModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[320] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-6 text-center">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <i className="fa-solid fa-circle-exclamation text-white text-2xl"></i>
              </div>
              <h3 className="font-black text-white text-base uppercase tracking-tight">Cadastro Incompleto</h3>
              <p className="text-white/80 text-[10px] font-bold uppercase mt-1">{clientInfoModal.nomeFantasia}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className={`p-4 rounded-2xl border-2 border-dashed flex items-center gap-3 transition-all ${gpsStatus === 'done' ? 'bg-emerald-50 border-emerald-300' : gpsStatus === 'loading' ? 'bg-blue-50 border-blue-300 animate-pulse' : 'bg-amber-50 border-amber-200'}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${gpsStatus === 'done' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  <i className={`fa-solid ${gpsStatus === 'done' ? 'fa-check text-emerald-600' : gpsStatus === 'loading' ? 'fa-spinner fa-spin text-blue-600' : 'fa-location-crosshairs text-amber-500'}`}></i>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-black text-gray-800 uppercase">Localizacao GPS</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">
                    {gpsStatus === 'done' && gpsPinStr ? gpsPinStr : gpsStatus === 'loading' ? 'Obtendo localizacao...' : 'Nao capturada'}
                  </p>
                  {gpsStatus === 'done' && (gpsEndereco || gpsBairro) && (
                    <p className="text-[8px] text-emerald-600 font-bold mt-0.5">
                      {gpsEndereco}{gpsEndereco && gpsBairro ? ' - ' : ''}{gpsBairro}
                    </p>
                  )}
                </div>
                {gpsStatus !== 'done' && (
                  <button onClick={handleGetGPS} disabled={gpsStatus === 'loading'} className="bg-amber-500 text-white text-[8px] font-black uppercase px-3 py-2 rounded-xl active:scale-95 transition-transform whitespace-nowrap disabled:opacity-50">
                    <i className="fa-solid fa-crosshairs mr-1"></i>Capturar
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">WhatsApp do Cliente</label>
                <div className="relative">
                  <i className="fa-brands fa-whatsapp absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 text-lg"></i>
                  <input
                    type="tel"
                    value={modalWhatsapp}
                    onChange={e => setModalWhatsapp(e.target.value)}
                    placeholder="Ex: 11999999999"
                    className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl font-black text-sm outline-none focus:ring-2 focus:ring-emerald-100 border-2 border-transparent focus:border-emerald-200 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="p-5 pt-0 flex flex-col gap-2">
              <button
                onClick={handleSaveClientInfo}
                className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-floppy-disk"></i> Salvar e Atender
              </button>
              <button
                onClick={() => { setClientInfoModal(null); setSelectedClient(clientInfoModal); }}
                className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest text-center"
              >
                Atender sem preencher
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSkipId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-gray-800 text-lg mb-4">Pular Cliente?</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium uppercase">Deseja realmente pular o atendimento deste cliente hoje?</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleSkipClient} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Pular</button>
              <button onClick={() => setConfirmSkipId(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar</button>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-xs rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 text-center tracking-tight">Confirmar Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-4"><p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo Devedor</p><p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p></div>
              
              {showReceiveModal.detalhePagamento && (
                <div className="mb-6 text-left">
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-2 ml-1">Histórico de Recebimentos</p>
                  <div className="bg-gray-50 p-3 rounded-xl space-y-1 max-h-32 overflow-y-auto border border-gray-100">
                    {showReceiveModal.detalhePagamento.split('|').map((log, i) => (
                      <p key={i} className="text-[10px] font-bold text-gray-600 border-b border-gray-200 pb-1 last:border-0">{log.trim()}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4 mb-6"><p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p><input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none" /></div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                 <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs tracking-widest">DINHEIRO</button>
                 <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs tracking-widest">PIX</button>
              </div>
              <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-semibold uppercase text-[9px] tracking-widest text-center">Cancelar</button>
           </div>
        </div>
      )}

      {editingClient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[310] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl p-8 animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-6"><h3 className="font-black text-gray-800 uppercase text-sm tracking-tight">{editingClient === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3></div>
             <div className="space-y-4 pb-6">
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Nome Fantasia</label><input value={cForm.nomeFantasia || ''} onChange={e => setCForm({...cForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 uppercase" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label><input value={cForm.telefone || ''} onChange={e => setCForm({...cForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Endereço</label><input value={cForm.endereco || ''} onChange={e => setCForm({...cForm, endereco: e.target.value})} placeholder="Endereço" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 uppercase" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Bairro</label><input value={cForm.bairro || ''} onChange={e => setCForm({...cForm, bairro: e.target.value})} placeholder="Bairro" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 uppercase" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Dia de Atendimento</label><select value={cForm.diaRoteiro ?? 1} onChange={e => setCForm({...cForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100">{[1, 2, 3, 4, 5, 6].map(d => (<option key={d} value={d}>{DIAS_SEMANA[d] ?? 'N/D'}</option>))}</select></div> 
                
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Rota de Atendimento</label>
                  <div className="w-full p-4 bg-gray-100 rounded-2xl font-black text-blue-600 text-xs uppercase shadow-inner border border-blue-50 flex justify-between items-center">
                    <span>{user.rota ? `Rota ${user.rota.replace('ROTA_', '')}` : 'Sem Rota'}</span>
                    <i className="fa-solid fa-lock text-[10px] opacity-30"></i>
                  </div>
                </div>

                <button onClick={handlePinLocation} className="w-full bg-indigo-50 text-indigo-600 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 mb-2"><i className="fa-solid fa-location-dot"></i> Capturar Localização Atual</button>
                <div className="flex flex-col gap-2 mt-4"><button onClick={handleSaveClientBasic} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs">Salvar Alterações</button><button onClick={() => setEditingClient(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button></div>
             </div>
          </div>
        </div>
      )}

      {viewingClientHistory && (
        <ClientHistory 
          client={viewingClientHistory} 
          sales={sales} 
          products={products} 
          onClose={() => setViewingClientHistory(null)} 
        />
      )}

      {/* MODAL: Visualizar comprovante */}
      {comprovanteModalSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <i className="fa-solid fa-file-circle-check text-white text-xl"></i>
              </div>
              <h3 className="font-black text-white text-sm uppercase">Comprovante</h3>
              <p className="text-white/70 text-[9px] font-bold mt-1">{clients.find(c => c.id === comprovanteModalSale.clientId)?.nomeFantasia || 'Cliente'}</p>
            </div>
            <div className="p-5">
              {comprovantePreview ? (
                <img src={comprovantePreview} className="w-full rounded-2xl border border-gray-100" alt="Comprovante" />
              ) : (
                <button
                  onClick={() => comprovanteFileInputRef.current?.click()}
                  disabled={comprovanteUploading}
                  className="w-full bg-amber-50 border-2 border-dashed border-amber-300 rounded-2xl p-10 flex flex-col items-center gap-3 active:scale-95"
                >
                  {comprovanteUploading ? <i className="fa-solid fa-spinner fa-spin text-amber-500 text-2xl"></i> : <i className="fa-solid fa-camera text-amber-500 text-2xl"></i>}
                  <span className="text-[10px] font-black text-amber-700 uppercase">{comprovanteUploading ? 'Processando...' : 'Tirar Foto'}</span>
                </button>
              )}
              {comprovantePreview && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => handleComprovanteShare(comprovanteModalSale)} className="py-3 rounded-xl text-[9px] font-black uppercase bg-emerald-50 text-emerald-600 active:scale-95 flex items-center justify-center gap-1.5 border border-emerald-100">
                    <i className="fa-brands fa-whatsapp"></i>Compartilhar
                  </button>
                  <button onClick={() => { setComprovantePreview(null); setTimeout(() => comprovanteFileInputRef.current?.click(), 100); }} className="py-3 rounded-xl text-[9px] font-black uppercase bg-gray-100 text-gray-600 active:scale-95 flex items-center justify-center gap-1.5">
                    <i className="fa-solid fa-camera-rotate"></i>Refazer
                  </button>
                </div>
              )}
            </div>
            <div className="p-5 pt-0">
              <button onClick={() => setComprovanteModalSale(null)} className="w-full bg-gray-100 text-gray-500 font-black py-3 rounded-2xl active:scale-95 uppercase text-[10px]">Fechar</button>
            </div>
          </div>
          <input
            ref={comprovanteFileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f && comprovanteModalSale) handleComprovanteCapture(comprovanteModalSale.id, f);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
};

export default VendedorDashboard;