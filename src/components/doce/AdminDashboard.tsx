"use client";
// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CommissionPaymentLog, Expense, Category, Subcategory } from '@/lib/types';
import { DIAS_SEMANA } from '@/lib/constants';
import Cupom from '@/components/doce/Cupom';
import ClientHistory from '@/components/doce/ClientHistory';
import { loadLocalState, saveLocalState } from '@/utils/persistence';
import { locationService, notificationService, NOTIFICATION_TYPES, AppNotification, NotificationType } from '@/services/locationService';

interface AdminDashboardProps {
  products: Product[];
  users: User[];
  cargas: Carga[];
  clients: Client[];
  sales: Sale[];
  commissions: Commission[];
  payoutLogs: CommissionPaymentLog[];
  expenses: Expense[];
  categories: Category[];
  subcategories: Subcategory[];
  addProduct: (n: string, c: number, v: number, com: number, estoque?: number, categoryId?: string, subcategoryId?: string, precoMinimo?: number) => void;
  updateProduct: (id: string, data: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  registerStockEntry: (id: string, q: number, c: number) => void;
  adjustStockManual: (id: string, q: number, t: 'ADICAO' | 'SUBTRACAO') => void;
  syncVendedorCarga: (vId: string, itens: { produtoId: string, quantidade: number }[]) => void;
  applyCargaDirectly: (vId: string, itens: { produtoId: string, quantidade: number }[]) => void;
  addClient: (data: Omit<Client, 'id'>) => void;
  updateClient: (id: string, data: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  addUser: (nome: string, foto?: string, telefone?: string) => void;
  updateUser: (id: string, data: Partial<User>) => void;
  deleteUser: (id: string) => Promise<boolean>;
  payCommission: (vId: string, amount: number, type: 'TOTAL' | 'PARCIAL', adminId: string) => void;
  addCategory: (name: string) => void;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  deleteCategory: (id: string) => void;
  addSubcategory: (catId: string, name: string) => void;
  updateSubcategory: (id: string, updates: Partial<Subcategory>) => void;
  deleteSubcategory: (id: string) => void;
  setCommissions: any;
  updateEstoqueCentral: any;
  reinforceCarga: any;
  deleteSale: (id: string) => void;
  receiveAccount: (saleId: string, method: PaymentMethod, amount?: number) => void;
  logo: string | null;
  setLogo: (logo: string | null) => void;
  adminUser: User;
  margemGlobalAtiva: boolean;
  setMargemGlobalAtiva: (val: boolean) => void;
  margemGlobalValor: number;
  setMargemGlobalValor: (val: number) => void;
  margemMinima: number;
  setMargemMinima: (val: number) => void;
  margemMinimaAtiva: boolean;
  setMargemMinimaAtiva: (val: boolean) => void;
  pix1Name: string;
  setPix1Name: (val: string) => void;
  pix1Code: string | null;
  setPix1Code: (val: string | null) => void;
  pix2Name: string;
  setPix2Name: (val: string) => void;
  pix2Code: string | null;
  setPix2Code: (val: string | null) => void;
  adminNotification?: string | null;
  clearAdminNotification?: () => void;
  orderedProductIds: string[]; 
  setOrderedProductIds: (ids: string[]) => void; 
  companyName: string;
  setCompanyName: (val: string) => void;
  companyCnpj: string;
  setCompanyCnpj: (val: string) => void;
  activateAllProducts?: () => void;
  clientOrder: string[];
  setClientOrder: (ids: string[]) => void;
}

type TabType = 'HOME' | 'CATALOGO' | 'CATEGORIAS' | 'VENDEDORES' | 'CARGAS' | 'CLIENTES' | 'HISTORY' | 'CAIXA' | 'ROTEIRO' | 'REPORTS' | 'CONTAS_RECEBER' | 'SETTINGS';

type ReportType = 'RESUMO' | 'TOP_CLIENTES' | 'TOP_PRODUTOS' | 'CLIENTES_RISCO' | 'VENDAS_CATEGORIAS' | null;

const AdminDashboard: React.FC<AdminDashboardProps> = (props) => {
  const [activeTab, setActiveTab] = useState<TabType>(() => loadLocalState('admin_activeTab', 'HOME'));
  const [selectedSale, setSelectedSale] = useState<Sale | null>(() => loadLocalState('admin_selectedSale', null));
  const [viewingClientHistory, setViewingClientHistory] = useState<Client | null>(null);
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const [routeFilter, setRouteFilter] = useState<string>('TODOS');
  const [creditTypeFilter, setCreditTypeFilter] = useState<'TODOS' | 'COMUM' | 'CHEQUE' | 'BOLETO'>('TODOS');

  // Estado para relatórios individuais
  const [activeReport, setActiveReport] = useState<ReportType>(null);

  useEffect(() => { saveLocalState('admin_activeTab', activeTab); }, [activeTab]);
  useEffect(() => { saveLocalState('admin_selectedSale', selectedSale); }, [selectedSale]);

  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (props.adminNotification) {
      showToast(props.adminNotification);
      props.clearAdminNotification?.();
    }
  }, [props.adminNotification]);

  const [showProductModal, setShowProductModal] = useState<Product | 'NEW' | null>(null);
  const [showEntryModal, setShowEntryModal] = useState<Product | null>(null);
  const [entryForm, setEntryForm] = useState({ qtd: '', custo: '' }); 
  const [showClientModal, setShowClientModal] = useState<Client | 'NEW' | null>(null);
  const [showConfirmSync, setShowConfirmSync] = useState(false);
  const [showConfirmApply, setShowConfirmApply] = useState(false);
  const [filtroPeriodo, setFiltroPeriodo] = useState<'HOJE' | 'SEMANA' | 'MES' | 'GERAL'>('HOJE');
  const [showUserModal, setShowUserModal] = useState<User | 'NEW' | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [payoutVendedor, setPayoutVendedor] = useState<User | null>(null);
  const [payoutType, setPayoutType] = useState<'TOTAL' | 'PARCIAL'>('TOTAL');
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [periodoRelatorio, setPeriodoRelatorio] = useState<'HOJE' | 'SEMANA' | 'MES' | 'GERAL'>('MES');

  const [confirmDelete, setConfirmDelete] = useState<{ id: string, type: 'PRODUCT' | 'CLIENT' | 'USER' | 'CATEGORY' | 'SUBCATEGORY', name: string } | null>(null);

  const [pwUser, setPwUser] = useState<string>('');
  const [pwNew, setPwNew] = useState<string>('');
  const [newCatName, setNewCatName] = useState('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  
  const [expandedCategorySub, setExpandedCategorySub] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [editingSub, setEditingSub] = useState<Subcategory | null>(null);

  const [pForm, setPForm] = useState({ nome: '', custo: '', venda: '', comissao: '', margem: '', ativo: true, estoquePrincipal: '', categoryId: '', subcategoryId: '', precoMinimo: '' });
  const [clientForm, setClientForm] = useState<Partial<Client>>({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0, rota: 'ROTA_01' });
  const [userForm, setUserForm] = useState<Partial<User>>({ nome: '', telefone: '', foto: '', pin: '', placaVeiculo: '', rota: 'ROTA_01' });
  const [selectedVendedorId, setSelectedVendedorId] = useState('');
  const [stagingCarga, setStagingCarga] = useState<{ [pId: string]: number }>({});

  const logoInputRef = useRef<HTMLInputElement>(null);
  const pix1InputRef = useRef<HTMLInputElement>(null);
  const pix2InputRef = useRef<HTMLInputElement>(null);
  const userPhotoInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // NOTIFICAÇÕES REALTIME
  // ============================================================
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showNotifPrefs, setShowNotifPrefs] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationType[]>(() => notificationService.getPreferences());
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  // Som de notificação
  const playNotifSound = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'sine';
      gain.gain.value = 0.3;
      osc.start(); osc.stop(ctx.currentTime + 0.15);
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.frequency.value = 1100; osc2.type = 'sine';
        gain2.gain.value = 0.2;
        osc2.start(); osc2.stop(ctx.currentTime + 0.1);
      }, 150);
    } catch (e) {}
  };

  useEffect(() => {
    console.log('[NOTIF] Inscrito no realtime. Tipos ativos:', notifPrefs);
    const cleanup = notificationService.subscribeToRealtime((notif) => {
      console.log('[NOTIF] Notificação recebida:', notif.title, notif.body);
      playNotifSound();
      setNotifications(prev => [notif, ...prev].slice(0, 50));
      // Vibração se disponível
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }, notifPrefs);
    return () => {
      console.log('[NOTIF] Cleanup da inscrição realtime');
      cleanup();
    };
  }, [notifPrefs]);

  const toggleNotifPref = (type: NotificationType) => {
    setNotifPrefs(prev => {
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
      notificationService.savePreferences(next);
      return next;
    });
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  // ============================================================
  // LOCALIZAÇÃO DE VENDEDORES
  // ============================================================
  const [locationMap, setLocationMap] = useState<Record<string, { lat: number; lng: number; updated_at: string } | null>>({});
  const [showLocationModal, setShowLocationModal] = useState<{ userId: string; userName: string } | null>(null);
  const [locationLoading, setLocationLoading] = useState<string | null>(null);

  const handleViewLocation = async (userId: string, userName: string) => {
    setLocationLoading(userId);
    const loc = await locationService.getLocation(userId);
    if (loc) {
      setLocationMap(prev => ({ ...prev, [userId]: { lat: loc.latitude, lng: loc.longitude, updated_at: loc.updated_at } }));
      setShowLocationModal({ userId, userName });
    } else {
      setLocationMap(prev => ({ ...prev, [userId]: null }));
      showToast('Localização indisponível. O vendedor pode estar offline.', 'error');
    }
    setLocationLoading(null);
  };

  const formatRouteName = (rota: string | undefined) => {
    if (!rota) return "Sem Rota";
    const num = rota.replace('ROTA_', '');
    return `Rota ${num}`;
  };

  const availableRoutes = useMemo(() => {
    const routes = new Set(props.users.filter(u => u.role === 'VENDEDOR').map(u => u.rota).filter(Boolean));
    return Array.from(routes).sort() as string[];
  }, [props.users]);

  const getClientAvgRevenue = (id: string) => {
    const last25Sales = props.sales
      .filter(s => s.clientId === id)
      .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
      .slice(0, 25);
    if (last25Sales.length === 0) return "0.00";
    const totalRevenue = last25Sales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0);
    return (totalRevenue / last25Sales.length).toFixed(2);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => props.setLogo(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handlePixUpload = (e: React.ChangeEvent<HTMLInputElement>, slot: 1 | 2) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (slot === 1) props.setPix1Code(reader.result as string);
        else props.setPix2Code(reader.result as string);
        showToast(`QR Code Pix ${slot} atualizado!`);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (selectedVendedorId) {
      const atual = props.cargas
        .filter(c => c.vendedorId === selectedVendedorId)
        .reduce((acc, curr) => ({ ...acc, [curr.produtoId]: curr.quantidade ?? 0 }), {}); 
      setStagingCarga(atual);
    } else {
      setStagingCarga({});
    }
  }, [selectedVendedorId]);

  const hasCargaChanges = useMemo(() => {
    if (!selectedVendedorId) return false;
    const cargaAtualMap = props.cargas
      .filter(c => c.vendedorId === selectedVendedorId)
      .reduce((acc, curr) => ({ ...acc, [curr.produtoId]: curr.quantidade ?? 0 }), {} as { [id: string]: number }); 
    return props.products.some(p => (cargaAtualMap[p.id] ?? 0) !== (stagingCarga[p.id] ?? 0));
  }, [stagingCarga, props.cargas, selectedVendedorId, props.products]);

  const filterByPeriod = (date: Date, period: string) => {
    const d = new Date(date);
    const today = new Date();
    if (period === 'HOJE') return d.toDateString() === today.toDateString();
    if (period === 'SEMANA') {
      const weekAgo = new Date();
      weekAgo.setDate(today.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === 'MES') return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
    return true;
  };

  const getVendedorStats = (vId: string) => {
    const vSales = props.sales.filter(s => s.vendedorId === vId && filterByPeriod(s.data, 'HOJE'));
    const sellerComms = props.commissions.filter(c => c.vendedorId === vId);
    const sellerLogs = props.payoutLogs.filter(l => l.vendedorId === vId);
    const sellerExps = props.expenses.filter(e => e.sellerId === vId);
    const totalCommsEligible = sellerComms.filter(c => c.status !== 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const jaPago = sellerLogs.reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0);
    const totalDespesas = sellerExps.reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const disponivel = totalCommsEligible - jaPago - totalDespesas;
    const aReceber = sellerComms.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
    const vendasHoje = vSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0);
    const comissaoGerada = sellerComms.filter(c => filterByPeriod(c.dataGeracao, 'HOJE')).reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    return { vendasHoje: Number(vendasHoje.toFixed(2)), comissaoGerada: Number(comissaoGerada.toFixed(2)), comissaoDisponivel: Number(disponivel.toFixed(2)), comissaoAReceber: Number(aReceber.toFixed(2)) };
  };

  // ============================================================
  // RELATÓRIOS MEMOIZADOS
  // ============================================================
  const reportStats = useMemo(() => {
    const salesInPeriod = props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio));
    const totalVendas = salesInPeriod.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0);
    const paidCommissions = props.payoutLogs.filter(l => filterByPeriod(l.dataPagamento, periodoRelatorio)).reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0);
    const clientMap: { [id: string]: number } = {};
    const prodQtyMap: { [id: string]: number } = {};

    salesInPeriod.forEach(s => { 
      clientMap[s.clientId] = (clientMap[s.clientId] || 0) + (s.valorTotal || 0); 
      s.itens.forEach(i => {
        const qty = i.quantidade || 0;
        prodQtyMap[i.produtoId] = (prodQtyMap[i.produtoId] || 0) + qty;
      });
    });

    const topClients = Object.entries(clientMap).map(([id, total]) => ({ id, nome: props.clients.find(c => c.id === id)?.nomeFantasia || 'Cliente Desconhecido', total: Number(total.toFixed(2)) })).sort((a, b) => b.total - a.total).slice(0, 10);
    const topProducts = Object.entries(prodQtyMap).map(([id, qtd]) => ({ id, nome: props.products.find(p => p.id === id)?.nome || 'Produto Desconhecido', qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 10);

    const today = new Date();
    const atRisk = props.clients.filter(c => {
      if (!c.ativo) return false;
      const cSales = props.sales.filter(s => s.clientId === c.id);
      if (cSales.length === 0) return false;
      const lastSale = cSales.reduce((latest, s) => {
        const d = new Date(s.data);
        return d > latest ? d : latest;
      }, new Date(0));
      const diffDays = Math.ceil(Math.abs(today.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays >= 25; 
    }).map(c => {
      const cSales = props.sales.filter(s => s.clientId === c.id);
      const lastSale = cSales.reduce((latest, s) => {
        const d = new Date(s.data);
        return d > latest ? d : latest;
      }, new Date(0));
      const diffDays = Math.ceil(Math.abs(today.getTime() - lastSale.getTime()) / (1000 * 60 * 60 * 24));
      const seller = props.users.find(u => u.id === (cSales[0]?.vendedorId))?.nome || 'N/A';
      return { id: c.id, nome: c.nomeFantasia, dias: diffDays, seller };
    }).sort((a, b) => b.dias - a.dias);

    return { totalVendas: Number(totalVendas.toFixed(2)), totalComissaoPaga: Number(paidCommissions.toFixed(2)), topClients, topProducts, atRisk };
  }, [props.sales, props.payoutLogs, props.clients, props.products, props.users, periodoRelatorio]);

  // NOVO: Relatório de Vendas por Categorias/Subcategorias
  const vendasPorCategoria = useMemo(() => {
    const salesInPeriod = props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio));
    
    const catMap: { [catId: string]: { 
      categoria: string; 
      total: number; 
      qtd: number; 
      subcategorias: { [subId: string]: { subcategoria: string; total: number; qtd: number } } 
    } } = {};

    salesInPeriod.forEach(sale => {
      sale.itens.forEach(item => {
        const product = props.products.find(p => p.id === item.produtoId);
        if (!product) return;

        const catId = product.categoryId || 'SEM_CATEGORIA';
        const catName = catId === 'SEM_CATEGORIA' ? 'Sem Categoria' : (props.categories.find(c => c.id === catId)?.name || 'Desconhecida');
        
        const subId = product.subcategoryId || 'SEM_SUBCATEGORIA';
        const subName = subId === 'SEM_SUBCATEGORIA' ? 'Sem Subcategoria' : (props.subcategories.find(s => s.id === subId)?.name || 'Desconhecida');

        const itemTotal = (item.quantidade || 0) * (item.precoVenda || 0);
        const itemQty = item.quantidade || 0;

        if (!catMap[catId]) {
          catMap[catId] = { categoria: catName, total: 0, qtd: 0, subcategorias: {} };
        }
        catMap[catId].total += itemTotal;
        catMap[catId].qtd += itemQty;

        if (!catMap[catId].subcategorias[subId]) {
          catMap[catId].subcategorias[subId] = { subcategoria: subName, total: 0, qtd: 0 };
        }
        catMap[catId].subcategorias[subId].total += itemTotal;
        catMap[catId].subcategorias[subId].qtd += itemQty;
      });
    });

    return Object.values(catMap)
      .map(cat => ({
        ...cat,
        subcategorias: Object.values(cat.subcategorias)
          .sort((a, b) => b.total - a.total)
      }))
      .sort((a, b) => b.total - a.total);
  }, [props.sales, props.products, props.categories, props.subcategories, periodoRelatorio]);

  const handleOpenPayout = (v: User) => {
    setPayoutVendedor(v);
    setPayoutType('TOTAL');
    setPartialAmount('');
  };

  const handleConfirmPayout = () => {
    if (!payoutVendedor) return;
    const stats = getVendedorStats(payoutVendedor.id);
    const amount = payoutType === 'TOTAL' ? stats.comissaoDisponivel : parseFloat(partialAmount);
    if (isNaN(amount) || amount <= 0) { showToast("Valor inválido", "error"); return; }
    props.payCommission(payoutVendedor.id, amount, payoutType, props.adminUser.id);
    setPayoutVendedor(null);
    showToast("Pagamento registrado!");
  };

  const handleSync = () => {
    if (!selectedVendedorId) return;
    const itens = props.products.map(p => ({ produtoId: p.id, quantidade: stagingCarga[p.id] || 0 })); 
    props.syncVendedorCarga(selectedVendedorId, itens);
    setShowConfirmSync(false);
  };

  const handleApply = () => {
    if (!selectedVendedorId) return;
    const itens = props.products.map(p => ({ produtoId: p.id, quantidade: stagingCarga[p.id] || 0 })); 
    props.applyCargaDirectly(selectedVendedorId, itens);
    setShowConfirmApply(false);
  };

  const handleZeroCarga = () => {
    if (!selectedVendedorId) return;
    if (window.confirm("Deseja realmente ZERAR toda a carga deste vendedor?")) {
      const zeroed = props.products.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {});
      setStagingCarga(zeroed);
      showToast("Carga zerada no rascunho. Clique em 'Aplicar Agora' para confirmar.");
    }
  };

  const moveProduct = (id: string, dir: 'UP' | 'DOWN') => {
    const currentOrder = props.orderedProductIds.length > 0 ? props.orderedProductIds : props.products.map(p => p.id);
    const idx = currentOrder.indexOf(id);
    if (idx === -1) return;
    const newOrder = [...currentOrder];
    if (dir === 'UP' && idx > 0) [newOrder[idx], newOrder[idx-1]] = [newOrder[idx-1], newOrder[idx]];
    else if (dir === 'DOWN' && idx < newOrder.length - 1) [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]];
    props.setOrderedProductIds(newOrder); 
    showToast("Ordem atualizada!");
  };

  const moveCategory = (id: string, dir: 'UP' | 'DOWN') => {
    const idx = props.categories.findIndex(c => c.id === id);
    if (idx === -1) return;
    const targetIdx = dir === 'UP' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= props.categories.length) return;
    
    const current = props.categories[idx];
    const target = props.categories[targetIdx];
    
    props.updateCategory(current.id, { display_order: target.display_order || 0 });
    props.updateCategory(target.id, { display_order: current.display_order || 0 });
    showToast("Ordem atualizada!");
  };

  const moveClient = (id: string, dir: 'UP' | 'DOWN') => {
    const currentOrder = props.clientOrder.length > 0 ? props.clientOrder : props.clients.map(c => c.id);
    const idx = currentOrder.indexOf(id);
    if (idx === -1) return;
    const newOrder = [...currentOrder];
    if (dir === 'UP' && idx > 0) [newOrder[idx], newOrder[idx-1]] = [newOrder[idx-1], newOrder[idx]];
    else if (dir === 'DOWN' && idx < newOrder.length - 1) [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]];
    props.setClientOrder(newOrder);
    showToast("Ordem do cliente atualizada!");
  };

  const moveClientToDay = (clientId: string, newDay: number) => {
    const client = props.clients.find(c => c.id === clientId);
    if (!client) return;
    props.updateClient(clientId, { diaRoteiro: newDay });
    showToast(`Cliente movido para ${DIAS_SEMANA[newDay]}`);
  };

  const updatePriceFromMargin = (custo: number, margemPercent: number) => {
    const c = Number(custo) || 0;
    const m = Number(margemPercent) || 0;
    return m >= 100 ? c : c / (1 - m / 100);
  };
  const updateMarginFromPrice = (custo: number, venda: number) => {
    const c = Number(custo) || 0;
    const v = Number(venda) || 0;
    return v <= 0 ? 0 : ((v - c) / v) * 100;
  };

  const handleOpenProduct = (p: Product | 'NEW') => {
    const elmaChipsCat = props.categories.find(c => c.name === 'Elma Chips');
    if (p === 'NEW') {
      setPForm({ 
        nome: '', 
        custo: '0.00', 
        venda: props.margemGlobalAtiva ? updatePriceFromMargin(0, props.margemGlobalValor).toFixed(2) : '0.00', 
        comissao: '0.00', 
        margem: props.margemGlobalAtiva ? props.margemGlobalValor.toFixed(2) : '0.00', 
        ativo: true, 
        estoquePrincipal: '0', 
        categoryId: elmaChipsCat?.id || '', 
        subcategoryId: '',
        precoMinimo: '0.00'
      });
    } else {
      const precoVenda = Number(p.precoVenda) || 0;
      const precoCusto = Number(p.precoCusto) || 0;
      const margemCalculada = updateMarginFromPrice(precoCusto, precoVenda);
      setPForm({ 
        nome: p.nome ?? '', 
        custo: precoCusto.toFixed(2), 
        venda: precoVenda.toFixed(2), 
        comissao: (p.comissaoPercentual ?? 0).toFixed(2), 
        margem: margemCalculada.toFixed(2), 
        ativo: p.ativo ?? true, 
        estoquePrincipal: (p.estoquePrincipal ?? 0).toString(), 
        categoryId: p.categoryId || elmaChipsCat?.id || '', 
        subcategoryId: p.subcategoryId || '',
        precoMinimo: (p.precoMinimo ?? 0).toFixed(2)
      });
    }
    setShowProductModal(p);
  };

  const handleSaveProduct = () => {
    if (!pForm.nome || pForm.custo === '' || pForm.venda === '' || pForm.comissao === '' || pForm.precoMinimo === '') { showToast("Preencha todos os campos.", 'error'); return; }
    const data: Partial<Product> = { 
      nome: pForm.nome, 
      precoCusto: parseFloat(pForm.custo), 
      precoVenda: parseFloat(pForm.venda), 
      precoMinimo: parseFloat(pForm.precoMinimo),
      comissaoPercentual: parseFloat(pForm.comissao), 
      ativo: pForm.ativo ?? true, 
      estoquePrincipal: parseInt(pForm.estoquePrincipal) || 0, 
      categoryId: pForm.categoryId || undefined, 
      subcategoryId: pForm.subcategoryId || undefined 
    };
    if (showProductModal === 'NEW') props.addProduct(data.nome!, data.precoCusto!, data.precoVenda!, data.comissaoPercentual!, data.estoquePrincipal, data.categoryId, data.subcategoryId, data.precoMinimo);
    else if (typeof showProductModal === 'object') props.updateProduct(showProductModal.id, data);
    setShowProductModal(null);
    showToast("Produto salvo!");
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'PRODUCT') props.deleteProduct(confirmDelete.id);
    else if (confirmDelete.type === 'CLIENT') props.deleteClient(confirmDelete.id);
    else if (confirmDelete.type === 'USER') await props.deleteUser(confirmDelete.id);
    else if (confirmDelete.type === 'CATEGORY') props.deleteCategory(confirmDelete.id);
    else if (confirmDelete.type === 'SUBCATEGORY') props.deleteSubcategory(confirmDelete.id);
    setConfirmDelete(null);
    showToast(`Removido com sucesso`);
  };

  const handleOpenClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setClientForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0, rota: availableRoutes[0] || 'ROTA_01' });
    else setClientForm({ ...c, rota: c.rota || availableRoutes[0] || 'ROTA_01' });
    setShowClientModal(c);
  };

  const handlePinLocation = async () => {
    if (navigator.geolocation) {
      showToast("Aguardando GPS...");
      navigator.geolocation.getCurrentPosition(
        async (p) => {
          const lat = p.coords.latitude;
          const lng = p.coords.longitude;
          setClientForm(prev => ({ ...prev, pinLocalizacao: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }));
          try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'pt-BR' } });
            const data = await response.json();
            if (data && data.address) {
              const addr = data.address;
              const fullAddr = `${addr.road || ''}${addr.house_number ? ', ' + addr.house_number : ''}`;
              setClientForm(prev => ({ ...prev, endereco: fullAddr || prev.endereco, bairro: addr.suburb || addr.neighbourhood || prev.bairro }));
              showToast("Localização capturada!");
            } else { showToast("Coordenadas capturadas!"); }
          } catch (error) { showToast("GPS capturado, erro no endereço.", "error"); }
        }, 
        (error) => showToast("Erro ao acessar GPS.", "error"),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    } else { showToast("GPS não suportado.", "error"); }
  };

  const handleSaveClient = () => {
    if (!clientForm.nomeFantasia || !clientForm.telefone) { showToast("Preencha Nome e Telefone.", 'error'); return; }
    const payload: Omit<Client, 'id'> = { nomeFantasia: clientForm.nomeFantasia!, telefone: clientForm.telefone!, endereco: clientForm.endereco || '', bairro: clientForm.bairro || '', diaRoteiro: clientForm.diaRoteiro ?? 1, ativo: clientForm.ativo ?? true, ativarCnpj: clientForm.ativarCnpj ?? false, cnpj: clientForm.cnpj, pinLocalizacao: clientForm.pinLocalizacao, ordem: clientForm.ordem ?? 0, nome: clientForm.nome, observacoes: clientForm.observacoes, rota: clientForm.rota || availableRoutes[0] || 'ROTA_01' };
    if (showClientModal === 'NEW') props.addClient(payload);
    else if (typeof showClientModal === 'object') props.updateClient(showClientModal.id, payload);
    setShowClientModal(null);
    showToast("Cliente salvo!");
  };

  const handleOpenUserModal = (u: User | 'NEW') => {
    if (u === 'NEW') setUserForm({ nome: '', telefone: '', foto: '', pin: '123456', placaVeiculo: '', rota: 'AUTO' });
    else setUserForm({ nome: u.nome ?? '', telefone: u.telefone ?? '', foto: u.foto ?? '', pin: u.pin ?? '', placaVeiculo: u.placaVeiculo ?? '', rota: u.rota || 'ROTA_01' }); 
    setShowUserModal(u);
  };

  const handleUserPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setUserForm(prev => ({ ...prev, foto: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const handleSaveUser = () => {
    if (!userForm.nome) return;
    if (showUserModal === 'NEW') props.addUser(userForm.nome, userForm.foto, userForm.telefone);
    else if (typeof showUserModal === 'object') props.updateUser(showUserModal.id, userForm);
    setShowUserModal(null);
    showToast("Vendedor salvo!");
  };

  const handleUpdatePassword = () => {
    if (!pwUser || !pwNew) return;
    props.updateUser(pwUser, { pin: pwNew });
    setPwNew('');
    showToast("PIN atualizado!");
  };

  const handleAddCategory = () => {
    if (!newCatName) return;
    props.addCategory(newCatName);
    setNewCatName('');
    showToast("Categoria adicionada!");
  };

  const handleUpdateCategoryName = () => {
    if (!editingCategory || !newCatName) return;
    props.updateCategory(editingCategory.id, { name: newCatName });
    setEditingCategory(null);
    setNewCatName('');
    showToast("Categoria atualizada!");
  };
  
  const handleAddSubcategory = (catId: string) => {
    if (!newSubName) return;
    props.addSubcategory(catId, newSubName);
    setNewSubName('');
    showToast("Subcategoria adicionada!");
  };

  const handleUpdateSubName = () => {
    if (!editingSub || !newSubName) return;
    props.updateSubcategory(editingSub.id, { name: newSubName });
    setEditingSub(null);
    setNewSubName('');
    showToast("Subcategoria atualizada!");
  };

  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    props.receiveAccount(showReceiveModal.id, method, valor);
    setShowReceiveModal(null);
    showToast("Recebimento registrado!");
  };

  const updateStaging = (pId: string, delta: number) => {
    const p = props.products.find(prod => prod.id === pId);
    if (!p) return;
    const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === pId)?.quantidade ?? 0; 
    const totalDisp = (p.estoquePrincipal ?? 0) + noV; 
    const novaQ = Math.max(0, Math.min(totalDisp, (stagingCarga[pId] ?? 0) + delta));
    setStagingCarga(prev => ({ ...prev, [pId]: novaQ }));
  };

  const handleStagingInputChange = (pId: string, value: string) => {
    const p = props.products.find(prod => prod.id === pId);
    if (!p) return;
    const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === pId)?.quantidade ?? 0;
    const totalDisp = (p.estoquePrincipal ?? 0) + noV;
    let novaQ = parseInt(value) || 0;
    if (novaQ < 0) novaQ = 0;
    if (novaQ > totalDisp) novaQ = totalDisp;
    setStagingCarga(prev => ({ ...prev, [pId]: novaQ }));
  };

  const contasAReceber = useMemo(() => {
    let filtered = props.sales.filter(s => s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE');
    if (filterOverdueOnly) {
      const today = new Date(); today.setHours(0,0,0,0);
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

    if (search && activeTab === 'CONTAS_RECEBER') {
      filtered = filtered.filter(s => {
        const client = props.clients.find(c => c.id === s.clientId);
        return client?.nomeFantasia.toLowerCase().includes(search.toLowerCase());
      });
    }

    return filtered;
  }, [props.sales, filterOverdueOnly, creditTypeFilter, search, activeTab, props.clients]);

  const MenuCard = ({ icon, title, tab, color }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 active:scale-95 transition-all text-center group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700 tracking-tight">{title}</span>
    </button>
  );

  const filteredProducts = useMemo(() => {
    return props.products.filter(p => (p.nome ?? '').toLowerCase().includes(search.toLowerCase()));
  }, [props.products, search]);

  const filteredHistory = useMemo(() => {
    return props.sales.filter(s => filterByPeriod(s.data, filtroPeriodo)).sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)); 
  }, [props.sales, filtroPeriodo]);

  const historySummary = useMemo(() => filteredHistory.reduce((acc, sale) => {
    acc.total += (sale.valorTotal ?? 0); 
    if (sale.metodoPagamento === 'DINHEIRO') acc.dinheiro += (sale.valorTotal ?? 0);
    if (sale.metodoPagamento === 'PIX') acc.pix += (sale.valorTotal ?? 0);
    if (sale.metodoPagamento === 'A_PRAZO') acc.prazo += (sale.valorTotal ?? 0);
    return acc;
  }, { total: 0, dinheiro: 0, pix: 0, prazo: 0 }), [filteredHistory]);

  const filteredClients = useMemo(() => {
    let clients = props.clients.filter(c => {
      const matchesSearch = c.nomeFantasia.toLowerCase().includes(search.toLowerCase());
      const matchesRoute = routeFilter === 'TODOS' || c.rota === routeFilter;
      return matchesSearch && matchesRoute;
    });
    
    if (props.clientOrder.length > 0) {
      const orderMap = new Map(props.clientOrder.map((id, idx) => [id, idx]));
      clients.sort((a, b) => {
        const idxA = orderMap.get(a.id) ?? 999999;
        const idxB = orderMap.get(b.id) ?? 999999;
        return idxA - idxB;
      });
    } else {
      clients.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    }
    
    return clients;
  }, [props.clients, search, routeFilter, props.clientOrder]);

  const handleActivateAll = () => {
    if (window.confirm("Deseja marcar TODOS os produtos inativos como ATIVOS agora?")) props.activateAllProducts?.();
  };

  // Helper para renderizar cards de relatório
  const ReportCard = ({ icon, title, color, reportType, description }: { icon: string; title: string; color: string; reportType: ReportType; description: string }) => {
    const isActive = activeReport === reportType;
    return (
      <button 
        onClick={() => setActiveReport(isActive ? null : reportType)}
        className={`w-full p-5 rounded-2xl border-2 transition-all text-left ${
          isActive 
            ? `border-${color}-500 bg-${color}-50 shadow-lg` 
            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
        }`}
      >
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? `bg-${color}-600 text-white` : `bg-${color}-100 text-${color}-600`}`}>
            <i className={`fa-solid ${icon} ${isActive ? 'text-xl' : 'text-lg'}`}></i>
          </div>
          <div className="flex-1">
            <h4 className={`font-black text-gray-800 ${isActive ? 'text-lg' : 'text-base'}`}>{title}</h4>
            <p className={`text-gray-500 text-sm mt-1 ${isActive ? 'font-medium' : ''}`}>{description}</p>
          </div>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${isActive ? `bg-${color}-600 text-white rotate-180` : 'bg-gray-100 text-gray-400'}`}>
            <i className="fa-solid fa-chevron-down text-xs"></i>
          </div>
        </div>
      </button>
    );
  };

  // Render do conteúdo do relatório ativo
  const renderActiveReport = () => {
    switch (activeReport) {
      case 'RESUMO':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Faturamento no Período</p>
                <h2 className="text-2xl font-black text-blue-600">R$ {reportStats.totalVendas.toFixed(2)}</h2>
                <p className="text-[10px] text-gray-400 mt-1">Período: {periodoRelatorio}</p>
              </div>
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Comissões Pagas</p>
                <h2 className="text-2xl font-black text-emerald-600">R$ {reportStats.totalComissaoPaga.toFixed(2)}</h2>
                <p className="text-[10px] text-gray-400 mt-1">Período: {periodoRelatorio}</p>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                <i className="fa-solid fa-boxes-stacked text-blue-600"></i> Produtos Mais Vendidos
              </h3>
              <div className="divide-y divide-gray-50">
                {reportStats.topProducts.map((p, i) => (
                  <div key={p.id} className="py-3 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-gray-300">#{i+1}</span>
                      <span className="text-xs font-bold text-gray-700 uppercase truncate max-w-[150px]">{p.nome}</span>
                    </div>
                    <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">{p.qtd} un</span>
                  </div>
                ))}
                {reportStats.topProducts.length === 0 && <p className="text-center py-4 text-gray-400 text-sm">Nenhum produto vendido no período</p>}
              </div>
            </div>
          </div>
        );

      case 'TOP_CLIENTES':
        return (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                <i className="fa-solid fa-star text-yellow-500"></i> Top 10 Clientes (Volume R$)
              </h3>
              <div className="divide-y divide-gray-50">
                {reportStats.topClients.map((c, i) => (
                  <div key={c.id} className="py-3 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-gray-300">#{i+1}</span>
                      <span className="text-xs font-bold text-gray-700 uppercase truncate max-w-[150px]">{c.nome}</span>
                    </div>
                    <span className="text-xs font-black text-gray-900">R$ {c.total.toFixed(2)}</span>
                  </div>
                ))}
                {reportStats.topClients.length === 0 && <p className="text-center py-4 text-gray-400 text-sm">Nenhum cliente no período</p>}
              </div>
            </div>
          </div>
        );

      case 'CLIENTES_RISCO':
        return (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="bg-rose-600 p-6 rounded-[2.5rem] shadow-xl text-white">
              <h3 className="font-black uppercase text-xs tracking-widest mb-4 flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation text-yellow-400"></i> Clientes em Risco (Ausentes 25d+)
              </h3>
              <div className="space-y-3">
                {reportStats.atRisk.map((c, i) => (
                  <div key={c.id} className="flex justify-between items-center bg-white/10 p-4 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <div className="flex-1 pr-3">
                      <p className="text-[11px] font-black uppercase leading-tight">{c.nome}</p>
                      <p className="text-[9px] font-bold opacity-60 mt-1 uppercase">Vendedor: {c.seller}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-yellow-400">{c.dias} dias</p>
                      <p className="text-[8px] font-bold opacity-40 uppercase">Sem compra</p>
                    </div>
                  </div>
                ))}
                {reportStats.atRisk.length === 0 && (
                  <p className="text-center py-4 text-[10px] font-black opacity-40 uppercase">Nenhum cliente em alerta no momento.</p>
                )}
              </div>
            </div>
          </div>
        );

      case 'VENDAS_CATEGORIAS':
        return (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                <i className="fa-solid fa-layer-group text-indigo-600"></i> Vendas por Categorias e Subcategorias
              </h3>
              <p className="text-[10px] text-gray-400 mb-4">Período: {periodoRelatorio}</p>
              
              {vendasPorCategoria.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">Nenhuma venda no período selecionado</p>
              ) : (
                <div className="space-y-4">
                  {vendasPorCategoria.map((cat, catIndex) => (
                    <div key={cat.categoria} className="border border-gray-100 rounded-2xl overflow-hidden">
                      {/* Header da Categoria */}
                      <div className="bg-indigo-50 px-4 py-3 flex justify-between items-center border-b border-gray-100">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-black">{catIndex + 1}</span>
                          <span className="font-black text-indigo-700 uppercase text-sm">{cat.categoria}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-indigo-700">R$ {cat.total.toFixed(2)}</p>
                          <p className="text-[9px] font-bold text-indigo-400 uppercase">{cat.qtd} un</p>
                        </div>
                      </div>
                      
                      {/* Subcategorias */}
                      <div className="p-2 space-y-2">
                        {Object.entries(cat.subcategorias).map(([subId, sub]) => (
                          <div key={subId} className="bg-white p-3 rounded-xl border border-gray-50 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <i className="fa-solid fa-circle text-[6px] text-gray-300"></i>
                              <span className="text-xs font-semibold text-gray-600 uppercase">{sub.subcategoria}</span>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-black text-gray-800">R$ {sub.total.toFixed(2)}</p>
                              <p className="text-[8px] font-bold text-gray-400 uppercase">{sub.qtd} un</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center animate-in slide-in-from-top duration-300 pointer-events-none">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3`}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>{toast.message}
          </div>
        </div>
      )}

      {activeTab !== 'HOME' && <button onClick={() => { setActiveTab('HOME'); setSearch(''); setActiveReport(null); }} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2 active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="space-y-6 py-4">
          <div className="px-2 flex items-center justify-between"><div><h2 className="text-2xl font-black text-gray-800 tracking-tight">Painel Administrativo</h2><p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Gestão e Controle Total</p></div><div className="flex items-center gap-2"><button onClick={() => setShowNotifPrefs(true)} className="w-10 h-10 bg-white text-gray-400 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90"><i className="fa-solid fa-sliders text-xs"></i></button><button onClick={() => { setShowNotifPanel(!showNotifPanel); if (showNotifPanel) markAllRead(); }} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90 relative"><i className="fa-solid fa-bell text-sm"></i>{unreadCount > 0 && (<span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center animate-pulse">{unreadCount > 9 ? '9+' : unreadCount}</span>)}</button></div></div>
          <div className="grid grid-cols-2 gap-4">
            <MenuCard icon="fa-boxes-stacked" title="Estoque" tab="CATALOGO" color="bg-blue-50 text-blue-600" />
            <MenuCard icon="fa-tags" title="Categorias" tab="CATEGORIAS" color="bg-indigo-50 text-indigo-600" />
            <MenuCard icon="fa-truck-ramp-box" title="Cargas" tab="CARGAS" color="bg-orange-50 text-orange-600" />
            <MenuCard icon="fa-users" title="Clientes" tab="CLIENTES" color="bg-green-50 text-green-600" />
            <MenuCard icon="fa-wallet" title="Caixa" tab="CAIXA" color="bg-yellow-50 text-yellow-600" />
            <MenuCard icon="fa-users-gear" title="Vendedores" tab="VENDEDORES" color="bg-purple-50 text-purple-600" />
            <MenuCard icon="fa-receipt" title="Vendas Realizadas" tab="HISTORY" color="bg-red-50 text-red-600" />
            <MenuCard icon="fa-calendar-days" title="Roteiro" tab="ROTEIRO" color="bg-indigo-50 text-indigo-600" />
            <MenuCard icon="fa-chart-line" title="Relatórios" tab="REPORTS" color="bg-emerald-50 text-emerald-600" />
            <MenuCard icon="fa-file-invoice-dollar" title="Contas a Receber" tab="CONTAS_RECEBER" color="bg-rose-50 text-rose-600" />
            <MenuCard icon="fa-gear" title="Configurações" tab="SETTINGS" color="bg-slate-50 text-slate-600" />
          </div>
        </div>
      )}

      {activeTab === 'CATALOGO' && (
        <div className="space-y-4">
          <div className="px-2 flex justify-between items-center"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Estoque Central</h2><div className="flex gap-2"><button onClick={handleActivateAll} className="bg-emerald-100 text-emerald-600 px-4 py-2 rounded-xl font-black text-[9px] uppercase shadow-sm active:scale-95 transition-all"><i className="fa-solid fa-check-double mr-2"></i>Ativar Todos</button><button onClick={() => handleOpenProduct('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-plus text-lg"></i></button></div></div>
          <div className="px-1"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm focus:ring-2 focus:ring-blue-100 outline-none" /></div>
          <div className="grid gap-2 px-1">
            {filteredProducts.map(p => (
              <div key={p.id} className={`bg-white p-4 rounded-3xl border shadow-sm flex items-center justify-between transition-all hover:border-blue-200 ${!p.ativo ? 'opacity-50 grayscale' : ''}`}>
                <div className="flex flex-col gap-1 mr-4">
                  <button onClick={() => moveProduct(p.id, 'UP')} className="w-8 h-8 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center active:scale-90 border border-gray-100"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                  <button onClick={() => moveProduct(p.id, 'DOWN')} className="w-8 h-8 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center active:scale-90 border border-gray-100"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                </div>
                <div className="flex-1 min-w-0 pr-3 cursor-pointer" onClick={() => handleOpenProduct(p)}>
                  <h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{p.nome}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100 uppercase tracking-tighter">Estoque: {p.estoquePrincipal} un</span>
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100 uppercase tracking-tighter">R$ {p.precoVenda.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowEntryModal(p)} className="bg-emerald-50 text-emerald-600 w-10 h-10 rounded-xl border border-emerald-100 flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-plus-circle text-lg"></i></button>
                  <button onClick={() => handleOpenProduct(p)} className="bg-blue-50 text-blue-600 w-10 h-10 rounded-xl border border-blue-100 flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-pencil-alt text-sm"></i></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'CATEGORIAS' && (
        <div className="space-y-6 py-4">
          <div className="px-2 flex justify-between items-center"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Categorias & Subs</h2></div>
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-6">
            <div className="flex gap-2">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={editingCategory ? "Editar nome..." : "Nome da Categoria"} className="flex-1 p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-100" />
              {editingCategory ? (
                <div className="flex gap-2">
                   <button onClick={handleUpdateCategoryName} className="bg-emerald-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg active:scale-95 transition-all"><i className="fa-solid fa-check"></i></button>
                   <button onClick={() => { setEditingCategory(null); setNewCatName(''); }} className="bg-gray-400 text-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg active:scale-95 transition-all"><i className="fa-solid fa-xmark"></i></button>
                </div>
              ) : (
                <button onClick={handleAddCategory} className="bg-blue-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg active:scale-95 transition-all"><i className="fa-solid fa-plus"></i></button>
              )}
            </div>
            <div className="grid gap-3">
              {props.categories.map(cat => (
                <div key={cat.id} className="space-y-2">
                  <div className="flex items-center bg-gray-50 p-4 rounded-3xl border border-gray-100">
                    <div className="flex flex-col gap-1 mr-4">
                      <button onClick={() => moveCategory(cat.id, 'UP')} className="w-8 h-8 bg-white border text-gray-400 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                      <button onClick={() => moveCategory(cat.id, 'DOWN')} className="w-8 h-8 bg-white border text-gray-400 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                    </div>
                    <span className="flex-1 font-black text-sm uppercase text-gray-700 cursor-pointer" onClick={() => setExpandedCategorySub(expandedCategorySub === cat.id ? null : cat.id)}>
                      {cat.name} 
                      <span className="ml-2 text-[10px] text-indigo-400 font-bold">({props.subcategories.filter(s => s.categoryId === cat.id).length})</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setExpandedCategorySub(expandedCategorySub === cat.id ? null : cat.id)} className={`w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 border shadow-sm ${expandedCategorySub === cat.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-400 border-gray-100'}`}><i className="fa-solid fa-list-ul text-xs"></i></button>
                      <button onClick={() => { setEditingCategory(cat); setNewCatName(cat.name); }} className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center active:scale-90 border border-blue-100 shadow-sm"><i className="fa-solid fa-pencil text-xs"></i></button>
                      {cat.name !== 'Elma Chips' && (
                        <button onClick={() => setConfirmDelete({ id: cat.id, type: 'CATEGORY', name: cat.name })} className="w-10 h-10 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center active:scale-90 border border-rose-100 shadow-sm"><i className="fa-solid fa-trash-can text-xs"></i></button>
                      )}
                    </div>
                  </div>
                  
                  {expandedCategorySub === cat.id && (
                    <div className="ml-8 p-4 bg-indigo-50/30 rounded-2xl space-y-3 animate-in slide-in-from-top-2 duration-300">
                      <div className="flex gap-2">
                        <input value={newSubName} onChange={e => setNewSubName(e.target.value)} placeholder={editingSub ? "Editar sub..." : "Nova Subcategoria"} className="flex-1 p-3 bg-white border border-indigo-100 rounded-xl font-bold uppercase text-[10px] outline-none" />
                        {editingSub ? (
                          <div className="flex gap-1">
                             <button onClick={handleUpdateSubName} className="bg-emerald-600 text-white w-10 h-10 rounded-xl flex items-center justify-center active:scale-95"><i className="fa-solid fa-check text-xs"></i></button>
                             <button onClick={() => { setEditingSub(null); setNewSubName(''); }} className="bg-gray-400 text-white w-10 h-10 rounded-xl flex items-center justify-center active:scale-95"><i className="fa-solid fa-xmark text-xs"></i></button>
                          </div>
                        ) : (
                          <button onClick={() => handleAddSubcategory(cat.id)} className="bg-indigo-600 text-white w-10 h-10 rounded-xl flex items-center justify-center active:scale-95"><i className="fa-solid fa-plus text-xs"></i></button>
                        )}
                      </div>
                      <div className="grid gap-2">
                        {props.subcategories.filter(s => s.categoryId === cat.id).map(sub => (
                          <div key={sub.id} className="flex items-center bg-white p-3 rounded-xl border border-indigo-100">
                            <span className="flex-1 font-bold text-[10px] uppercase text-gray-600">{sub.name}</span>
                            <div className="flex gap-1">
                              <button onClick={() => { setEditingSub(sub); setNewSubName(sub.name); }} className="w-8 h-8 text-blue-400 hover:text-blue-600"><i className="fa-solid fa-pencil text-[10px]"></i></button>
                              <button onClick={() => setConfirmDelete({ id: sub.id, type: 'SUBCATEGORY', name: sub.name })} className="w-8 h-8 text-rose-400 hover:text-rose-600"><i className="fa-solid fa-trash-can text-[10px]"></i></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'VENDEDORES' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Vendedores</h2></div>
          <div className="flex justify-end px-1"><button onClick={() => handleOpenUserModal('NEW')} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-md active:scale-95"><i className="fa-solid fa-user-plus mr-2"></i>Novo Vendedor</button></div>
          <div className="grid gap-3 px-1">
            {props.users.filter(u => u.role === 'VENDEDOR').sort((a, b) => (a.rota || '').localeCompare(b.rota || '')).map(u => (
              <div key={u.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3"><div className="w-12 h-12 bg-gray-100 rounded-2xl overflow-hidden flex items-center justify-center">{u.foto ? <img src={u.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user text-gray-400 text-xl"></i>}</div><div><h4 className="font-bold text-gray-800 text-sm uppercase">{u.nome}</h4><p className="text-[10px] text-gray-400 font-semibold uppercase mt-0.5">{u.telefone || 'Sem Telefone'}</p><span className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase bg-blue-100 text-blue-600">{formatRouteName(u.rota)}</span></div></div>
                <div className="flex gap-2"><button onClick={() => handleViewLocation(u.id, u.nome)} disabled={locationLoading === u.id} className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center active:scale-95"><i className={`fa-solid ${locationLoading === u.id ? 'fa-spinner fa-spin' : 'fa-location-dot'} text-xs`}></i></button><button onClick={() => handleOpenUserModal(u)} className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center active:scale-95"><i className="fa-solid fa-pencil-alt text-xs"></i></button><button onClick={() => setConfirmDelete({ id: u.id, type: 'USER', name: u.nome })} className="bg-rose-50 text-rose-600 w-10 h-10 rounded-2xl border border-rose-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-trash-can text-sm"></i></button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'HISTORY' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Vendas Realizadas</h2></div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">{(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (<button key={p} onClick={() => setFiltroPeriodo(p)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${filtroPeriodo === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>))}</div>
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex flex-col gap-4 mx-2">
             <div className="flex justify-between items-center border-b border-gray-100 pb-3"><span className="text-xs font-black text-gray-400 uppercase">Total Geral</span><span className="text-2xl font-black text-gray-900">R$ {historySummary.total.toFixed(2)}</span></div>
             <div className="grid grid-cols-3 gap-3">
                <div className="text-center bg-emerald-50 p-3 rounded-xl"><p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Dinheiro</p><p className="text-sm font-black text-emerald-700">R$ {historySummary.dinheiro.toFixed(2)}</p></div>
                <div className="text-center bg-blue-50 p-3 rounded-xl"><p className="text-[9px] font-black text-blue-600 uppercase mb-1">Pix</p><p className="text-sm font-black text-[#1E3A5F]">R$ {historySummary.pix.toFixed(2)}</p></div>
                <div className="text-center bg-orange-50 p-3 rounded-xl"><p className="text-[9px] font-black text-orange-600 uppercase mb-1">A Prazo</p><p className="text-sm font-black text-orange-700">R$ {historySummary.prazo.toFixed(2)}</p></div>
             </div>
          </div>
          <div className="grid gap-3 px-1">
            {filteredHistory.map(s => (
              <button key={s.id} onClick={() => setSelectedSale(s)} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col text-left transition-all hover:border-blue-200">
                <div className="flex justify-between items-start mb-2"><span className="text-[9px] font-black text-gray-400 uppercase">{s.data.toLocaleDateString()} {s.data.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span><span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${s.statusPagamento === 'PAGO' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{s.statusPagamento === 'PAGO' ? 'RECEBIDA' : 'EM ABERTO'}</span></div>
                <div className="flex justify-between items-end"><div><h4 className="font-bold text-gray-800 text-sm leading-tight">{props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4><p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vend: {props.users.find(u => u.id === s.vendedorId)?.nome ?? 'Desc.'}</p></div><p className="text-sm font-black text-gray-800">R$ {s.valorTotal.toFixed(2)}</p></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'REPORTS' && (
        <div className="space-y-6 py-4">
          <div className="px-2 flex justify-between items-center">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Relatórios</h2>
            <div className="flex bg-gray-100 p-1 rounded-2xl shadow-inner">
              {(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (
                <button key={p} onClick={() => { setPeriodoRelatorio(p); setActiveReport(null); }} className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${periodoRelatorio === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>
              ))}
            </div>
          </div>

          {/* Grid de botões de relatórios */}
          <div className="grid gap-3 px-1">
            <ReportCard 
              icon="fa-chart-pie" 
              title="Resumo Geral" 
              color="blue" 
              reportType="RESUMO" 
              description="Faturamento total, comissões pagas e produtos mais vendidos no período"
            />
            <ReportCard 
              icon="fa-star" 
              title="Top Clientes" 
              color="yellow" 
              reportType="TOP_CLIENTES" 
              description="Ranking dos 10 clientes que mais compraram em valor no período"
            />
            <ReportCard 
              icon="fa-triangle-exclamation" 
              title="Clientes em Risco" 
              color="rose" 
              reportType="CLIENTES_RISCO" 
              description="Clientes sem compra há 25+ dias, ordenados por maior tempo de ausência"
            />
            <ReportCard 
              icon="fa-layer-group" 
              title="Vendas por Categorias" 
              color="indigo" 
              reportType="VENDAS_CATEGORIAS" 
              description="Detalhamento de vendas agrupado por Categoria → Subcategoria com valores e quantidades"
            />
          </div>

          {/* Conteúdo do relatório ativo */}
          {activeReport && (
            <div className="px-1">
              {renderActiveReport()}
            </div>
          )}

          {activeReport === null && (
            <div className="text-center py-16 px-4 bg-gray-50 rounded-[2rem] border border-dashed border-gray-200">
              <i className="fa-solid fa-chart-bar text-6xl text-gray-200 mb-4"></i>
              <h3 className="font-black text-gray-600 text-lg mb-2">Selecione um relatório acima</h3>
              <p className="text-gray-400 text-sm">Clique em um dos cards para visualizar o relatório detalhado</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'SETTINGS' && (
        <div className="space-y-8 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Configurações</h2></div>
          
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col items-center gap-6"><h3 className="font-black text-gray-800 uppercase text-xs tracking-widest">Logo da Empresa</h3><div onClick={() => logoInputRef.current?.click()} className="w-full aspect-[2/1] bg-gray-50 border-4 border-dashed border-gray-200 rounded-3xl flex items-center justify-center cursor-pointer overflow-hidden group transition-all hover:bg-gray-100">{props.logo ? <img src={props.logo} className="w-full h-full object-contain" /> : <div className="text-center"><i className="fa-solid fa-cloud-arrow-up text-3xl text-gray-300 mb-2"></i><p className="text-[10px] font-black text-gray-400 uppercase">Fazer Upload</p></div>}</div><input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} /></div>
          
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-6"><h3 className="font-black text-gray-800 uppercase text-xs tracking-widest mb-4">Regras de Margem</h3>
            <div className="bg-blue-50 p-4 rounded-2xl"><div className="flex items-center justify-between mb-4"><span className="text-xs font-black text-blue-700 uppercase">Margem Global Ativa</span><button onClick={() => props.setMargemGlobalAtiva(!props.margemGlobalAtiva)} className={`w-14 h-8 rounded-full relative transition-colors ${props.margemGlobalAtiva ? 'bg-blue-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${props.margemGlobalAtiva ? 'left-7' : 'left-1'}`}></div></button></div>{props.margemGlobalAtiva && (<div className="space-y-2"><label className="text-[9px] font-black text-blue-400 uppercase">Valor Margem Global (%)</label><input type="number" value={props.margemGlobalValor} onChange={e => props.setMargemGlobalValor(parseFloat(e.target.value))} className="w-full p-4 bg-white border border-blue-200 rounded-xl font-black text-blue-600 outline-none" /></div>)}</div>
            <div className="bg-rose-50 p-4 rounded-2xl"><div className="flex items-center justify-between mb-4"><span className="text-xs font-black text-rose-700 uppercase">Trava Margem Mínima</span><button onClick={() => props.setMargemMinimaAtiva(!props.margemMinimaAtiva)} className={`w-14 h-8 rounded-full relative transition-colors ${props.margemMinimaAtiva ? 'bg-rose-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${props.margemMinimaAtiva ? 'left-7' : 'left-1'}`}></div></button></div>{props.margemMinimaAtiva && (<div className="space-y-2"><label className="text-[9px] font-black text-rose-400 uppercase">Valor Margem Mínima (%)</label><input type="number" value={props.margemMinima} onChange={e => props.setMargemMinima(parseFloat(e.target.value))} className="w-full p-4 bg-white border border-rose-200 rounded-xl font-black text-rose-600 outline-none" /></div>)}</div>
          </div>

          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-6"><h3 className="font-black text-gray-800 uppercase text-xs tracking-widest mb-4">Contas Pix</h3>
            <div className="p-4 bg-gray-50 rounded-3xl border border-gray-100 space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase">Nome Banco 1</label>
                <input value={props.pix1Name} onChange={e => props.setPix1Name(e.target.value)} className="w-full p-3 bg-white border rounded-xl font-bold" />
              </div>
              <div className="flex items-center gap-4">
                <div onClick={() => pix1InputRef.current?.click()} className="w-16 h-16 bg-white border rounded-2xl flex items-center justify-center cursor-pointer overflow-hidden">
                  {props.pix1Code ? <img src={props.pix1Code} className="w-full h-full object-cover" /> : <i className="fa-solid fa-qrcode text-gray-200"></i>}
                </div>
                <button onClick={() => pix1InputRef.current?.click()} className="flex-1 bg-white border border-gray-200 p-3 rounded-2xl text-[9px] font-black uppercase text-gray-400">Alterar QR Code</button>
              </div>
              <input type="file" ref={pix1InputRef} className="hidden" accept="image/*" onChange={e => handlePixUpload(e, 1)} />
            </div>

            <div className="p-4 bg-gray-50 rounded-3xl border border-gray-100 space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase">Nome Banco 2</label>
                <input value={props.pix2Name} onChange={e => props.setPix2Name(e.target.value)} className="w-full p-3 bg-white border rounded-xl font-bold" />
              </div>
              <div className="flex items-center gap-4">
                <div onClick={() => pix2InputRef.current?.click()} className="w-16 h-16 bg-white border rounded-2xl flex items-center justify-center cursor-pointer overflow-hidden">
                  {props.pix2Code ? <img src={props.pix2Code} className="w-full h-full object-cover" /> : <i className="fa-solid fa-qrcode text-gray-200"></i>}
                </div>
                <button onClick={() => pix2InputRef.current?.click()} className="flex-1 bg-white border border-gray-200 p-3 rounded-2xl text-[9px] font-black uppercase text-gray-400">Alterar QR Code</button>
              </div>
              <input type="file" ref={pix2InputRef} className="hidden" accept="image/*" onChange={e => handlePixUpload(e, 2)} />
            </div>
          </div>

          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-4"><h3 className="font-black text-gray-800 uppercase text-xs tracking-widest mb-4">Alterar Senhas (PIN)</h3><select value={pwUser} onChange={e => setPwUser(e.target.value)} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase"><option value="">Selecionar Usuário</option>{props.users.map(u => (<option key={u.id} value={u.id}>{u.nome} ({u.role})</option>))}</select><input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Novo PIN (6 dígitos)" maxLength={6} className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-center text-xl tracking-[0.5em]" /><button onClick={handleUpdatePassword} className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all">Atualizar PIN</button></div>
          
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-4"><h3 className="font-black text-gray-800 uppercase text-xs tracking-widest mb-4">Dados da Empresa</h3>
            <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Razão Social / Nome</label><input value={props.companyName} onChange={e => props.setCompanyName(e.target.value)} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div>
            <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">CNPJ</label><input value={props.companyCnpj} onChange={e => props.setCompanyCnpj(e.target.value)} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div>
          </div>
        </div>
      )}

      {activeTab === 'CARGAS' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Cargas</h2></div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"><div className="flex justify-between items-center mb-4"><h3 className="font-black text-gray-800 uppercase text-[10px]">Vendedor Responsável</h3>{selectedVendedorId && <button onClick={handleZeroCarga} className="text-[9px] font-black text-rose-500 uppercase flex items-center gap-1"><i className="fa-solid fa-rotate-left"></i> Zerar Carga</button>}</div><select value={selectedVendedorId} onChange={e => setSelectedVendedorId(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-semibold text-sm"><option value="">Selecione um vendedor...</option>{props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(u => <option key={u.id} value={u.id}>{u.nome} ({formatRouteName(u.rota)})</option>)}</select></div>
          {selectedVendedorId && (<div className="pb-40"><div className="grid gap-1.5 px-1">{props.products.map(p => { const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === p.id)?.quantidade ?? 0; return (<div key={p.id} className="bg-white px-3 py-2 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between"><div className="flex-1 min-w-0 pr-3"><h4 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h4><p className="text-[9px] text-gray-400 font-semibold mt-0.5">C: {(p.estoquePrincipal ?? 0)} | V: {noV}</p></div><div className="flex items-center bg-gray-50 rounded-xl p-1 gap-1"><button onClick={() => updateStaging(p.id, -1)} className="w-8 h-8 bg-white border border-gray-200 text-gray-400 rounded-lg active:scale-90 flex items-center justify-center"><i className="fa-solid fa-plus text-[10px]"></i></button><input type="number" inputMode="numeric" value={stagingCarga[p.id] === undefined ? '' : stagingCarga[p.id]} onChange={(e) => handleStagingInputChange(p.id, e.target.value)} onFocus={(e) => e.target.select()} className="w-10 bg-transparent text-center font-black text-xs outline-none border-none" /><button onClick={() => updateStaging(p.id, 1)} className="w-8 h-8 bg-blue-600 text-white rounded-lg active:scale-90 shadow-sm flex items-center justify-center"><i className="fa-solid fa-plus text-[10px]"></i></button></div></div>); })}</div></div>)}
          {selectedVendedorId && (<div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] z-50 max-w-lg mx-auto safe-bottom"><div className="flex flex-row gap-2"><button onClick={() => setShowConfirmApply(true)} disabled={!hasCargaChanges} className={`flex-1 font-black py-4 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1 transition-all text-[9px] uppercase tracking-tighter ${hasCargaChanges ? 'bg-emerald-600 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><i className="fa-solid fa-check-circle text-sm"></i> Aplicar Agora</button><button onClick={() => setShowConfirmSync(true)} disabled={!hasCargaChanges} className={`flex-1 font-black py-4 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1 transition-all text-[9px] uppercase tracking-tighter ${hasCargaChanges ? 'bg-gray-900 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><i className="fa-solid fa-truck-loading text-sm"></i> Enviar Pendente</button></div></div>)}
        </div>
      )}

      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Clientes</h2></div>
          <div className="flex flex-wrap bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner gap-1"><button onClick={() => setRouteFilter('TODOS')} className={`flex-1 min-w-[70px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${routeFilter === 'TODOS' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>Todos</button>{availableRoutes.map(r => (<button key={r} onClick={() => setRouteFilter(r)} className={`flex-1 min-w-[70px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${routeFilter === r ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{formatRouteName(r)}</button>))}</div>
          <div className="flex gap-2"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm" /><button onClick={() => handleOpenClient('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-user-plus"></i></button></div>
          <div className="grid gap-2 px-1">{filteredClients.map(c => (<div key={c.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between transition-all hover:border-blue-200"><div className="flex-1 min-w-0 pr-2 cursor-pointer" onClick={() => setViewingClientHistory(c)}><div className="flex items-center gap-2"><h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{c.nomeFantasia}</h3>{c.telefone && <a href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}`} target="_blank" className="text-emerald-500" onClick={(e) => e.stopPropagation()}><i className="fa-brands fa-whatsapp text-lg"></i></a>}</div><div className="flex items-center gap-3 mt-1.5"><p className="text-[10px] text-gray-400 font-black uppercase truncate">{DIAS_SEMANA[c.diaRoteiro]}</p><span className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase bg-blue-100 text-blue-600">{formatRouteName(c.rota)}</span><div className="flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 shadow-inner whitespace-nowrap"><i className="fa-solid fa-chart-line text-blue-400 text-[10px]"></i><span className="text-[11px] font-black text-blue-600">R$ {getClientAvgRevenue(c.id)}</span></div></div></div><div className="flex flex-col gap-1"><div className="flex gap-2"><button onClick={(e) => { e.stopPropagation(); handleOpenClient(c); }} className="bg-blue-50 text-blue-600 w-9 h-9 rounded-lg border border-blue-100 flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-pencil-alt text-sm"></i></button><button onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: c.id, type: 'CLIENT', name: c.nomeFantasia }); }} className="bg-rose-50 text-rose-600 w-9 h-9 rounded-lg border border-rose-100 flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-trash-can text-sm"></i></button></div></div></div>))}</div>
        </div>
      )}

      {activeTab === 'CAIXA' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Caixa</h2></div>
          <div className="grid gap-4 px-1">{props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(v => { const stats = getVendedorStats(v.id); return (<div key={v.id} className="bg-white rounded-[2.5rem] shadow-xl border-t-4 border-blue-500 p-8 flex flex-col gap-6"><div className="flex items-center gap-4"><div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-md">{v.foto ? <img src={v.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user text-2xl"></i>}</div><div><h3 className="font-black text-gray-800 text-lg leading-none mb-1 uppercase truncate max-w-[150px]">{v.nome}</h3><p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{formatRouteName(v.rota)}</p></div></div><div className="space-y-4"><div className="grid grid-cols-2 gap-4"><div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 flex flex-col items-center"><p className="text-[9px] text-gray-400 font-black uppercase mb-2 text-center leading-none">Vendas Hoje</p><p className="text-lg font-black text-gray-800">R$ {stats.vendasHoje.toFixed(2)}</p></div><div className={`${stats.comissaoDisponivel < 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'} p-5 rounded-[2rem] border flex flex-col items-center`}><p className={`text-[9px] ${stats.comissaoDisponivel < 0 ? 'text-rose-600' : 'text-emerald-600'} font-black uppercase mb-2 text-center leading-none`}>Disponível</p><p className={`text-lg font-black ${stats.comissaoDisponivel < 0 ? 'text-rose-700' : 'text-gray-800'}`}>R$ {stats.comissaoDisponivel.toFixed(2)}</p></div></div><div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 flex justify-between items-center"><span className="text-[9px] font-black text-orange-600 uppercase">Comissão a Receber</span><span className="text-sm font-black text-orange-700">R$ {stats.comissaoAReceber.toFixed(2)}</span></div></div><button onClick={() => handleOpenPayout(v)} className="w-full bg-emerald-600 text-white py-5 rounded-3xl font-black text-xs uppercase shadow-xl active:scale-95 transition-all tracking-widest">Pagar Comissão</button></div>); })}</div>
        </div>
      )}

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Roteiro Semanal</h2></div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner overflow-x-auto"><button onClick={() => setRouteFilter('TODOS')} className={`flex-shrink-0 px-6 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${routeFilter === 'TODOS' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>Todos</button>{availableRoutes.map(r => (<button key={r} onClick={() => setRouteFilter(r)} className={`flex-shrink-0 px-6 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${routeFilter === r ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{formatRouteName(r)}</button>))}</div>
          <div className="space-y-3 px-1">{[1, 2, 3, 4, 5, 6].map(dia => { const isOpen = expandedDay === dia; const clientsInDay = props.clients.filter(c => c.diaRoteiro === dia && c.ativo && (routeFilter === 'TODOS' || c.rota === routeFilter)).sort((a, b) => { const orderMap = new Map(props.clientOrder.map((id, idx) => [id, idx])); const idxA = orderMap.get(a.id) ?? (a.ordem || 0); const idxB = orderMap.get(b.id) ?? (b.ordem || 0); return idxA - idxB; }); return (<div key={dia} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden"><button onClick={() => setExpandedDay(isOpen ? null : dia)} className={`w-full flex items-center justify-between p-5 text-left ${isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-700'}`}><div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${isOpen ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{dia}</div><span className="font-black uppercase text-xs tracking-tight">{DIAS_SEMANA[dia] ?? 'N/D'}</span></div><div className="flex items-center gap-2"><span className="text-[9px] font-black uppercase opacity-40">{clientsInDay.length} clientes</span><i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`}></i></div></button>{isOpen && (<div className="p-4 bg-white space-y-2 border-t border-indigo-50 animate-in slide-in-from-top duration-300">{clientsInDay.map((c, index) => (<div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex items-center justify-between group"><div className="flex flex-col gap-1 mr-3"><button onClick={(e)=>{e.stopPropagation(); moveClient(c.id, 'UP');}} className="w-7 h-7 bg-white border text-gray-400 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-chevron-up text-[10px]"></i></button><button onClick={(e)=>{e.stopPropagation(); moveClient(c.id, 'DOWN');}} className="w-7 h-7 bg-white border text-gray-400 rounded-lg flex items-center justify-center active:scale-90"><i className="fa-solid fa-chevron-down text-[10px]"></i></button></div><div className="flex-1 cursor-pointer" onClick={() => setViewingClientHistory(c)}><p className="font-bold text-gray-800 text-xs uppercase">{c.nomeFantasia}</p><p className="text-[9px] text-gray-400 font-bold mt-0.5">{c.bairro || 'Sem Bairro'}</p></div><div className="flex items-center gap-2"><span className="text-[8px] font-black px-1.5 py-0.5 rounded uppercase bg-blue-100 text-blue-600">{formatRouteName(c.rota)}</span><button onClick={(e)=>{e.stopPropagation(); handleOpenClient(c);}} className="w-8 h-8 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-pencil-alt text-xs"></i></button></div></div>))}</div>)}</div>); })}</div>
        </div>
      )}

      {activeTab === 'CONTAS_RECEBER' && (
        <div className="space-y-4">
          <header className="px-1 flex justify-between items-center"><h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Contas a Receber</h2><button onClick={() => setFilterOverdueOnly(!filterOverdueOnly)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 shadow-sm ${filterOverdueOnly ? 'bg-rose-600 text-white' : 'bg-white text-gray-400 border border-gray-100'}`}><i className={`fa-solid ${filterOverdueOnly ? 'fa-calendar-exclamation' : 'fa-calendar-days'}`}></i>{filterOverdueOnly ? 'Vencidas/Hoje' : 'Todas'}</button></header>
          
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 shadow-inner overflow-x-auto gap-1">
            {(['TODOS', 'COMUM', 'CHEQUE', 'BOLETO'] as const).map(t => (
              <button 
                key={t} 
                onClick={() => setCreditTypeFilter(t)} 
                className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${creditTypeFilter === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}
              >
                {t === 'COMUM' ? 'Comum' : t}
              </button>
            ))}
          </div>

          <div className="px-1">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm outline-none focus:ring-2 focus:ring-blue-100" />
          </div>

          <div className="grid gap-3 px-1">{contasAReceber.map(s => { const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2)); const today = new Date(); today.setHours(0,0,0,0); const dueDate = s.dataVencimento ? new Date(s.dataVencimento) : null; if (dueDate) dueDate.setHours(0,0,0,0); const isOverdue = dueDate ? dueDate <= today : false; return (<div key={s.id} className={`p-5 rounded-3xl border shadow-sm flex flex-col transition-all ${isOverdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100'}`}><div className="flex justify-between items-start mb-2"><div className="flex-1 pr-4"><h4 className={`font-bold text-sm leading-tight uppercase cursor-pointer ${isOverdue ? 'text-rose-900' : 'text-gray-800'}`} onClick={() => setViewingClientHistory(props.clients.find(c => c.id === s.clientId)!)}>{props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4><div className="flex flex-col mt-2"><span className="text-[9px] font-black uppercase text-gray-400">Vencimento</span><span className="text-xs font-black text-gray-800">{s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</span><span className="text-[8px] font-black uppercase text-blue-600 mt-1">{s.detalhePagamento || 'COMUM'}</span></div></div><div className="text-right flex items-center gap-4"><div><p className="text-sm font-black text-gray-800 leading-none">R$ {saldo.toFixed(2)}</p><p className="text-[9px] text-gray-400 font-bold uppercase mt-1">Saldo</p></div></div></div><button onClick={() => { setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className={`w-full py-3 rounded-2xl text-[10px] font-black uppercase mt-3 shadow-lg active:scale-95 ${isOverdue ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>RECEBER</button></div>)})}</div>
        </div>
      )}

      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-sm rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh]"><h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showUserModal === 'NEW' ? 'Novo Vendedor' : 'Editar Vendedor'}</h3><div className="flex flex-col items-center mb-6"><div onClick={() => userPhotoInputRef.current?.click()} className="w-24 h-24 bg-purple-100 text-purple-600 rounded-[2rem] flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-xl cursor-pointer relative group transition-all hover:scale-105">{userForm.foto ? <img src={userForm.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-camera text-2xl"></i>}</div><input type="file" ref={userPhotoInputRef} className="hidden" accept="image/*" onChange={handleUserPhotoUpload} /></div><div className="space-y-4"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome do Vendedor</label><input value={userForm.nome ?? ''} onChange={e => setUserForm({...userForm, nome: e.target.value})} placeholder="Nome Completo" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label><input value={userForm.telefone ?? ''} onChange={e => setUserForm({...userForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Placa do Veículo</label><input value={userForm.placaVeiculo ?? ''} onChange={e => setUserForm({...userForm, placaVeiculo: e.target.value})} placeholder="Ex: ABC-1234" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>{showUserModal !== 'NEW' && (<div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Rota Responsável</label><select value={userForm.rota || 'ROTA_01'} onChange={e => setUserForm({...userForm, rota: e.target.value})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{Array.from({ length: 50 }).map((_, i) => { const r = `ROTA_${String(i + 1).padStart(2, '0')}`; return <option key={r} value={r}>Rota {String(i + 1).padStart(2, '0')}</option>; })}</select></div>)}<div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">PIN de Acesso (6 dígitos)</label><input type="password" value={userForm.pin ?? ''} onChange={e => setUserForm({...userForm, pin: e.target.value})} placeholder="123456" maxLength={6} className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-center text-xl tracking-[0.5em]" /></div><button onClick={handleSaveUser} className="w-full bg-purple-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4 tracking-widest">Salvar Vendedor</button><button onClick={() => setShowUserModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-md rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh]"><h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showClientModal === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3><div className="space-y-4"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Fantasia</label><input value={clientForm.nomeFantasia || ''} onChange={e => setClientForm({...clientForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone</label><input value={clientForm.telefone || ''} onChange={e => setClientForm({...clientForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Endereço</label><input value={clientForm.endereco || ''} onChange={e => setClientForm({...clientForm, endereco: e.target.value})} placeholder="Endereço" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Bairro</label><input value={clientForm.bairro || ''} onChange={e => setClientForm({...clientForm, bairro: e.target.value})} placeholder="Bairro" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dia de Atendimento</label><select value={clientForm.diaRoteiro ?? 1} onChange={e => setClientForm({...clientForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{[1, 2, 3, 4, 5, 6].map(d => (<option key={d} value={d}>{DIAS_SEMANA[d]}</option>))}</select></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Rota</label><select value={clientForm.rota || availableRoutes[0] || 'ROTA_01'} onChange={e => setClientForm({...clientForm, rota: e.target.value})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{availableRoutes.length > 0 ? availableRoutes.map(r => (<option key={r} value={r}>{formatRouteName(r)}</option>)) : <option value="ROTA_01">Sem rotas disponíveis</option>}</select></div><button onClick={handlePinLocation} className="w-full bg-indigo-50 text-indigo-600 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 mb-2"><i className="fa-solid fa-location-dot"></i> Localização Atual</button><button onClick={handleSaveClient} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4 tracking-widest">Salvar Cliente</button><button onClick={() => setShowClientModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-md rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh]"><h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showProductModal === 'NEW' ? 'Novo Produto' : 'Editar Produto'}</h3><div className="space-y-4"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome do Produto</label><input value={pForm.nome} onChange={e => setPForm({...pForm, nome: e.target.value})} placeholder="Nome do Produto" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>
        <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Categoria</label><select value={pForm.categoryId} onChange={e => setPForm({...pForm, categoryId: e.target.value, subcategoryId: ''})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase">{props.categories.map(cat => (<option key={cat.id} value={cat.id}>{cat.name}</option>))}</select></div>
        {pForm.categoryId && props.subcategories.filter(s => s.categoryId === pForm.categoryId).length > 0 && (
          <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Subcategoria</label><select value={pForm.subcategoryId} onChange={e => setPForm({...pForm, subcategoryId: e.target.value})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase"><option value="">Nenhuma</option>{props.subcategories.filter(s => s.categoryId === pForm.categoryId).map(sub => (<option key={sub.id} value={sub.id}>{sub.name}</option>))}</select></div>
        )}
        <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Custo R$</label><input type="number" value={pForm.custo} onChange={e => { const val = parseFloat(e.target.value) || 0; const venda = props.margemGlobalAtiva ? updatePriceFromMargin(val, props.margemGlobalValor) : parseFloat(pForm.venda) || 0; const margem = props.margemGlobalAtiva ? props.margemGlobalValor : updateMarginFromPrice(val, venda); setPForm({...pForm, custo: e.target.value, venda: venda.toFixed(2), margem: margem.toFixed(2)}); }} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Venda R$</label><input type="number" value={pForm.venda} onChange={e => { const val = parseFloat(e.target.value) || 0; const margem = updateMarginFromPrice(parseFloat(pForm.custo) || 0, val); setPForm({...pForm, margem: margem.toFixed(2), venda: e.target.value}); }} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Margem %</label><input type="number" value={pForm.margem} onChange={e => { const val = parseFloat(e.target.value) || 0; const venda = updatePriceFromMargin(parseFloat(pForm.custo) || 0, val); setPForm({...pForm, margem: e.target.value, venda: venda.toFixed(2)}); }} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Preço Mínimo R$</label><input type="number" value={pForm.precoMinimo} onChange={e => setPForm({...pForm, precoMinimo: e.target.value})} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Comissão %</label><input type="number" value={pForm.comissao} onChange={e => setPForm({...pForm, comissao: e.target.value})} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Estoque Central</label><input type="number" value={pForm.estoquePrincipal} onChange={e => setPForm({...pForm, estoquePrincipal: e.target.value})} placeholder="0" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="flex items-center gap-2 py-2"><input type="checkbox" id="prod_ativo" checked={pForm.ativo} onChange={e => setPForm({...pForm, ativo: e.target.checked})} className="w-5 h-5" /><label htmlFor="prod_ativo" className="text-xs font-bold text-gray-700 uppercase">Produto Ativo</label></div><button onClick={handleSaveProduct} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4 tracking-widest">Salvar Produto</button><button onClick={() => setShowProductModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
      )}

      {showEntryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center"><h3 className="font-black text-gray-800 uppercase text-sm mb-4">Entrada de Estoque</h3><p className="text-xs text-gray-400 font-bold uppercase mb-4">{showEntryModal.nome}</p><div className="space-y-4 text-left"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Quantidade</label><input type="number" value={entryForm.qtd} onChange={e => setEntryForm({...entryForm, qtd: e.target.value})} placeholder="0" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-center" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Custo Unitário R$</label><input type="number" value={entryForm.custo} onChange={e => setEntryForm({...entryForm, custo: e.target.value})} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-center" /></div><button onClick={() => { const q = parseInt(entryForm.qtd) || 0; const c = parseFloat(entryForm.custo) || 0; if (q <= 0 || c <= 0) { showToast("Valores inválidos", "error"); return; } const estA = showEntryModal.estoquePrincipal || 0; const cusA = showEntryModal.precoCusto || 0; const nEst = estA + q; const nCus = ((estA * cusA) + (q * c)) / nEst; const nVen = props.margemGlobalAtiva ? updatePriceFromMargin(nCus, props.margemGlobalValor) : showEntryModal.precoVenda; props.updateProduct(showEntryModal.id, { estoquePrincipal: nEst, precoCusto: Number(nCus.toFixed(2)), precoVenda: Number(nVen.toFixed(2)) }); setShowEntryModal(null); setEntryForm({ qtd: '', custo: '' }); showToast("Entrada registrada!"); }} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Confirmar Entrada</button><button onClick={() => { setShowEntryModal(null); setEntryForm({ qtd: '', custo: '' }); }} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
      )}

      {showConfirmSync && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl"><h3 className="font-black text-gray-800 text-lg mb-4">Enviar Pendente?</h3><p className="text-sm text-gray-500 mb-6 font-medium uppercase">Deseja enviar esta carga como pendente?</p><div className="flex flex-col gap-2"><button onClick={handleSync} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Enviar</button><button onClick={() => setShowConfirmSync(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button></div></div></div>
      )}

      {showConfirmApply && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl"><h3 className="font-black text-gray-800 text-lg mb-4">Aplicar Carga?</h3><p className="text-sm text-gray-500 mb-6 font-medium uppercase">Isso atualizará o estoque imediatamente.</p><div className="flex flex-col gap-2"><button onClick={handleApply} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Aplicar</button><button onClick={() => setShowConfirmApply(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button></div></div></div>
      )}

      {payoutVendedor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center"><h3 className="font-black text-gray-800 uppercase text-sm mb-4">Pagar Comissão</h3><p className="text-xs text-gray-400 font-bold uppercase mb-4">{payoutVendedor.nome}</p><div className="space-y-4 text-left"><div className="flex gap-2 mb-4"><button onClick={() => setPayoutType('TOTAL')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase ${payoutType === 'TOTAL' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>Total</button><button onClick={() => setPayoutType('PARCIAL')} className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase ${payoutType === 'PARCIAL' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>Parcial</button></div>{payoutType === 'PARCIAL' && (<div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor R$</label><input type="number" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-center" /></div>)}<button onClick={handleConfirmPayout} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Confirmar Pagamento</button><button onClick={() => setPayoutVendedor(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl"><h3 className="font-black text-gray-800 text-lg mb-4">Excluir Item?</h3><p className="text-sm text-gray-500 mb-6 font-medium uppercase">Deseja realmente excluir "{confirmDelete.name}"?</p><div className="flex flex-col gap-2"><button onClick={handleConfirmDelete} className="w-full bg-rose-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Excluir</button><button onClick={() => setConfirmDelete(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button></div></div></div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4"><div className="bg-white w-full max-sm rounded-[2rem] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300 max-h-[90vh]"><div className="flex-1 overflow-y-auto p-2"><Cupom sale={selectedSale} client={props.clients.find(c => c.id === selectedSale.clientId) || {} as Client} products={props.products} onClose={() => setSelectedSale(null)} onDeleteSale={props.deleteSale} allowDelete={true} /></div><div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-2"><button onClick={() => setSelectedSale(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar</button></div></div></div>
      )}

      {viewingClientHistory && <ClientHistory client={viewingClientHistory} sales={props.sales} products={props.products} onClose={() => setViewingClientHistory(null)} />}

      {/* ============================================================ */}
      {/* PAINEL DE NOTIFICAÇÕES (WhatsApp-style) */}
      {/* ============================================================ */}
      {showNotifPanel && (
        <div className="fixed inset-0 z-[500]" onClick={() => { setShowNotifPanel(false); markAllRead(); }}>
          <div className="absolute top-2 right-2 w-80 max-h-[80vh] bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden animate-in slide-in-from-top-right duration-300" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-4 flex items-center justify-between">
              <h3 className="font-black text-white text-sm uppercase">Notificacoes</h3>
              <div className="flex gap-2">
                {unreadCount > 0 && <button onClick={markAllRead} className="text-white/70 text-[9px] font-bold uppercase active:scale-95">Marcar lidas</button>}
                <button onClick={() => setShowNotifPanel(false)} className="text-white/70 active:scale-95"><i className="fa-solid fa-xmark"></i></button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              {notifications.length === 0 && (
                <div className="p-8 text-center"><i className="fa-solid fa-bell-slash text-3xl text-gray-200 mb-3"></i><p className="text-[10px] text-gray-400 font-bold uppercase">Nenhuma notificacao</p></div>
              )}
              {notifications.map((n, i) => {
                const typeInfo = NOTIFICATION_TYPES.find(t => t.type === n.type);
                return (
                  <div key={n.id + i} className={`px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-all ${!n.read ? 'bg-blue-50/50' : ''}`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${n.type === 'NOVA_VENDA' ? 'bg-emerald-100' : n.type === 'RECEBIMENTO' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <i className={`${typeInfo?.icon || 'fa-solid fa-bell'} ${typeInfo?.color || 'text-gray-400'} text-sm`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black text-gray-800 uppercase leading-tight">{n.title}</p>
                      <p className="text-[9px] text-gray-500 font-semibold mt-0.5">{n.body}</p>
                      <p className="text-[8px] text-gray-300 mt-1">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1.5"></div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL DE LOCALIZAÇÃO DO VENDEDOR */}
      {/* ============================================================ */}
      {showLocationModal && (() => {
        const loc = locationMap[showLocationModal.userId];
        // loc pode ser null - tratado no JSX abaixo
        const timeAgo = loc ? Math.floor((Date.now() - new Date(loc.updated_at).getTime()) / 60000) : null;
        const timeStr = timeAgo === null ? 'N/A' : timeAgo < 1 ? 'Agora mesmo' : timeAgo < 60 ? `${timeAgo} min atrás` : `${Math.floor(timeAgo / 60)}h ${timeAgo % 60}min atrás`;
        const isStale = timeAgo !== null && timeAgo > 10;
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[500] flex items-end sm:items-center justify-center" onClick={() => setShowLocationModal(null)}>
            <div className="bg-white w-full sm:max-w-sm rounded-t-[2rem] sm:rounded-[2rem] overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
              <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i className="fa-solid fa-location-dot text-white text-lg"></i></div>
                  <div><h3 className="font-black text-white text-sm uppercase">Localizacao</h3><p className="text-white/70 text-[9px] font-bold uppercase">{showLocationModal.userName}</p></div>
                </div>
                <button onClick={() => setShowLocationModal(null)} className="text-white/70 active:scale-90"><i className="fa-solid fa-xmark text-lg"></i></button>
              </div>
              {loc ? (<>
              <div className="relative">
                <iframe width="100%" height="220" style={{ border: 0 }} loading="lazy" src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${loc.lat},${loc.lng}&zoom=16`} className="w-full" />
                {isStale && <div className="absolute top-2 right-2 bg-orange-500 text-white text-[8px] font-black px-2 py-1 rounded-lg uppercase shadow">Desatualizada</div>}
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-2xl">
                  <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center"><i className="fa-solid fa-crosshairs text-blue-600 text-xs"></i></div>
                  <div><p className="text-[9px] font-black text-gray-400 uppercase">Coordenadas</p><p className="text-[11px] font-bold text-gray-700">{loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}</p></div>
                </div>
                <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-2xl">
                  <div className={`w-8 h-8 ${isStale ? 'bg-orange-100' : 'bg-emerald-100'} rounded-xl flex items-center justify-center`}><i className={`fa-solid fa-clock ${isStale ? 'text-orange-600' : 'text-emerald-600'} text-xs`}></i></div>
                  <div><p className="text-[9px] font-black text-gray-400 uppercase">Ultima atualizacao</p><p className={`text-[11px] font-bold ${isStale ? 'text-orange-600' : 'text-emerald-600'}`}>{timeStr}</p></div>
                </div>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`} target="_blank" rel="noopener noreferrer" className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest flex items-center justify-center gap-2">
                  <i className="fa-solid fa-diamond-turn-right"></i> Abrir no Google Maps
                </a>
              </div>
              </>) : (
                <div className="p-8 text-center space-y-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                    <i className="fa-solid fa-location-crosshairs text-gray-300 text-2xl"></i>
                  </div>
                  <div>
                    <p className="font-black text-gray-800 text-sm uppercase">Sem Localizacao</p>
                    <p className="text-[10px] text-gray-400 font-semibold mt-2">O vendedor ainda nao enviou sua localizacao. Verifique se o app esta aberto e o GPS esta ativo.</p>
                  </div>
                  <button onClick={() => handleViewLocation(showLocationModal.userId, showLocationModal.userName)} disabled={locationLoading === showLocationModal.userId} className="bg-blue-50 text-blue-600 font-black py-3 px-6 rounded-2xl uppercase text-[10px] tracking-widest inline-flex items-center gap-2 active:scale-95">
                    <i className={`fa-solid ${locationLoading === showLocationModal.userId ? "fa-spinner fa-spin" : "fa-rotate"}`}></i>
                    {locationLoading === showLocationModal.userId ? "Buscando..." : "Tentar Novamente"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ============================================================ */}
      {/* MODAL DE PREFERÊNCIAS DE NOTIFICAÇÃO */}
      {/* ============================================================ */}
      {showNotifPrefs && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[500] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-center">
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-sliders text-white text-2xl"></i></div>
              <h3 className="font-black text-white text-sm uppercase tracking-tight">Preferencias de Notificacao</h3>
              <p className="text-white/70 text-[9px] font-bold mt-1">Selecione quais notificacoes deseja receber</p>
            </div>
            <div className="p-6 space-y-3">
              {NOTIFICATION_TYPES.map(nt => (
                <div key={nt.type} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm"><i className={`${nt.icon} ${nt.color} text-sm`}></i></div>
                    <span className="text-[11px] font-black text-gray-700 uppercase">{nt.label}</span>
                  </div>
                  <button onClick={() => toggleNotifPref(nt.type)} className={`w-12 h-7 rounded-full relative transition-colors ${notifPrefs.includes(nt.type) ? 'bg-blue-600' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-all shadow-sm ${notifPrefs.includes(nt.type) ? 'left-5.5' : 'left-0.5'}`}></div></button>
                </div>
              ))}
            </div>
            <div className="p-5 pt-0"><button onClick={() => setShowNotifPrefs(false)} className="w-full bg-gray-100 text-gray-600 font-black py-4 rounded-2xl active:scale-95 uppercase text-xs tracking-widest">Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;