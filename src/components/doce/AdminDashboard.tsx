"use client";
// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CommissionPaymentLog, Expense, Category, Subcategory } from '@/lib/types';
import ConfirmModal from '@/components/doce/ConfirmModal';
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

type TabType = 'HOME' | 'CATALOGO' | 'CATEGORIAS' | 'VENDEDORES' | 'CARGAS' | 'CLIENTES' | 'HISTORY' | 'CAIXA' | 'ROTEIRO' | 'REPORTS' | 'CONTAS_RECEBER' | 'BACKUP' | 'SETTINGS';

type ReportType = 'RESUMO' | 'TOP_CLIENTES' | 'TOP_PRODUTOS' | 'CLIENTES_RISCO' | 'VENDAS_CATEGORIAS' | 'PRODUTOS_RENTAVEIS' | null;
type ReportFilterType = 'RESUMO' | 'TOP_PRODUTOS' | 'TOP_CLIENTES' | 'CATEGORIAS' | 'VENDEDORES' | 'DIVIDAS' | 'PRODUTOS_RENTAVEIS';

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
  const [reportFilter, setReportFilter] = useState<ReportFilterType>('RESUMO');
  const [reportPeriodo, setReportPeriodo] = useState<'HOJE' | 'SEMANA' | 'MES' | 'GERAL'>('MES');

  const [backupFormat, setBackupFormat] = useState<'csv' | 'json'>('csv');
  const [confirmAction, setConfirmAction] = useState<{title:string;message:string;icon:string;iconColor?:string;onConfirm:()=>void;type?:string}|null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string, type: 'PRODUCT' | 'CLIENT' | 'USER' | 'CATEGORY' | 'SUBCATEGORY', name: string } | null>(null);

  const [pwUser, setPwUser] = useState<string>('');
  const [pwNew, setPwNew] = useState<string>('');
  const [newCatName, setNewCatName] = useState('');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  
  const [expandedCategorySub, setExpandedCategorySub] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [editingSub, setEditingSub] = useState<Subcategory | null>(null);

  const [pForm, setPForm] = useState({ nome: '', custo: '', venda: '', comissao: '', margem: '', ativo: true, estoquePrincipal: '', categoryId: '', subcategoryId: '', precoMinimo: '' });
  const [clientForm, setClientForm] = useState<Partial<Client>>({ nomeFantasia: '', nome: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0, rota: 'ROTA_01' });
  const [userForm, setUserForm] = useState<Partial<User>>({ nome: '', telefone: '', foto: '', pin: '', placaVeiculo: '', rota: 'ROTA_01' });
  const [selectedVendedorId, setSelectedVendedorId] = useState('');
  const [stagingCarga, setStagingCarga] = useState<{ [pId: string]: number }>({});

  const logoInputRef = useRef<HTMLInputElement>(null);
  const comprovanteFileInputRef = useRef<HTMLInputElement | null>(null);
  const [comprovanteModalSale, setComprovanteModalSale] = useState<Sale | null>(null);
  const [comprovantePreview, setComprovantePreview] = useState<string | null>(null);
  const [comprovanteUploading, setComprovanteUploading] = useState(false);
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

  const handleComprovanteCapture = async (saleId: string, file: File) => {
    setComprovanteUploading(true);
    try {
      const base64 = await compressImage(file);
      const { saleService } = await import('@/services/saleService');
      const ok = await saleService.updateSale(saleId, { comprovanteFoto: base64 } as any);
      if (ok) setComprovantePreview(base64);
      else showToast('Erro ao salvar foto', 'error');
    } catch (e) { showToast('Erro ao processar foto', 'error'); }
    setComprovanteUploading(false);
  };

  const handleComprovanteShare = (sale: Sale) => {
    if (sale.comprovanteFoto) shareImage(sale.comprovanteFoto, `comprovante_${sale.id}.jpg`);
  };

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

  // Relatório de Produtos mais Rentáveis (margem x volume)
  const produtosRentaveis = useMemo(() => {
    const salesInPeriod = props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio));
    const productMap = new Map(props.products.map(p => [p.id, p]));

    // Acumula quantidade vendida por produto no período
    const qtyMap: { [id: string]: number } = {};
    const revenueMap: { [id: string]: number } = {};
    salesInPeriod.forEach(s => {
      s.itens.forEach(item => {
        const pid = item.produtoId;
        qtyMap[pid] = (qtyMap[pid] || 0) + (item.quantidade || 0);
        revenueMap[pid] = (revenueMap[pid] || 0) + ((item.quantidade || 0) * (item.precoVenda || 0));
      });
    });

    // Calcula rentabilidade por produto
    const rentabilidade = Object.entries(qtyMap).map(([pid, qtd]) => {
      const prod = productMap.get(pid);
      if (!prod) return null;
      const custoUnit = prod.precoCusto || 0;
      const vendaUnit = prod.precoVenda || 0;
      const margemUnit = vendaUnit - custoUnit;
      const lucroTotal = margemUnit * qtd;
      const custoTotal = custoUnit * qtd;
      const faturamento = revenueMap[pid] || 0;
      const margemPercent = vendaUnit > 0 ? ((margemUnit / vendaUnit) * 100) : 0;
      return {
        id: pid,
        nome: prod.nome,
        qtd,
        custoUnit: Number(custoUnit.toFixed(2)),
        vendaUnit: Number(vendaUnit.toFixed(2)),
        margemUnit: Number(margemUnit.toFixed(2)),
        margemPercent: Number(margemPercent.toFixed(1)),
        faturamento: Number(faturamento.toFixed(2)),
        custoTotal: Number(custoTotal.toFixed(2)),
        lucroTotal: Number(lucroTotal.toFixed(2)),
      };
    }).filter(Boolean).sort((a, b) => (b?.lucroTotal || 0) - (a?.lucroTotal || 0));

    // Totais gerais
    const totalFaturamento = rentabilidade.reduce((acc, r) => acc + (r?.faturamento || 0), 0);
    const totalCusto = rentabilidade.reduce((acc, r) => acc + (r?.custoTotal || 0), 0);
    const totalLucro = rentabilidade.reduce((acc, r) => acc + (r?.lucroTotal || 0), 0);
    const totalQtd = rentabilidade.reduce((acc, r) => acc + (r?.qtd || 0), 0);

    return { produtos: rentabilidade, totalFaturamento, totalCusto, totalLucro, totalQtd };
  }, [props.sales, props.products, reportPeriodo]);

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
    setConfirmAction({title: 'Zerar Carga', message: 'Deseja realmente ZERAR toda a carga deste vendedor?', icon: 'fa-solid fa-triangle-exclamation', iconColor: 'text-amber-400', type: 'danger', onConfirm: () => { setConfirmAction(null);
      const zeroed = props.products.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {});
      setStagingCarga(zeroed);
      showToast("Carga zerada no rascunho. Clique em 'Aplicar Agora' para confirmar.");
    }});
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
    setConfirmAction({title: 'Ativar Produtos', message: 'Deseja marcar TODOS os produtos inativos como ATIVOS agora?', icon: 'fa-solid fa-check-double', onConfirm: () => { setConfirmAction(null); props.activateAllProducts?.(); }});
  };

  // Helper para renderizar cards de relatório
  const REPORT_COLOR_MAP: Record<string, { active: string; icon: string; inactive: string; chevron: string }> = {
    blue:    { active: 'border-blue-500 bg-blue-50 shadow-lg',   icon: 'bg-blue-600 text-white',   inactive: 'bg-blue-100 text-blue-600',   chevron: 'bg-blue-600 text-white' },
    emerald: { active: 'border-emerald-500 bg-emerald-50 shadow-lg', icon: 'bg-emerald-600 text-white', inactive: 'bg-emerald-100 text-emerald-600', chevron: 'bg-emerald-600 text-white' },
    purple:  { active: 'border-purple-500 bg-purple-50 shadow-lg',  icon: 'bg-purple-600 text-white',   inactive: 'bg-purple-100 text-purple-600',  chevron: 'bg-purple-600 text-white' },
    amber:   { active: 'border-amber-500 bg-amber-50 shadow-lg',   icon: 'bg-amber-600 text-white',   inactive: 'bg-amber-100 text-amber-600',   chevron: 'bg-amber-600 text-white' },
    rose:    { active: 'border-rose-500 bg-rose-50 shadow-lg',     icon: 'bg-rose-600 text-white',    inactive: 'bg-rose-100 text-rose-600',    chevron: 'bg-rose-600 text-white' },
    indigo:  { active: 'border-indigo-500 bg-indigo-50 shadow-lg', icon: 'bg-indigo-600 text-white',  inactive: 'bg-indigo-100 text-indigo-600',  chevron: 'bg-indigo-600 text-white' },
    cyan:    { active: 'border-cyan-500 bg-cyan-50 shadow-lg',     icon: 'bg-cyan-600 text-white',    inactive: 'bg-cyan-100 text-cyan-600',    chevron: 'bg-cyan-600 text-white' },
    orange:  { active: 'border-orange-500 bg-orange-50 shadow-lg', icon: 'bg-orange-600 text-white',  inactive: 'bg-orange-100 text-orange-600', chevron: 'bg-orange-600 text-white' },
    teal:    { active: 'border-teal-500 bg-teal-50 shadow-lg',     icon: 'bg-teal-600 text-white',    inactive: 'bg-teal-100 text-teal-600',    chevron: 'bg-teal-600 text-white' },
    red:     { active: 'border-red-500 bg-red-50 shadow-lg',      icon: 'bg-red-600 text-white',     inactive: 'bg-red-100 text-red-600',     chevron: 'bg-red-600 text-white' },
    green:   { active: 'border-green-500 bg-green-50 shadow-lg',   icon: 'bg-green-600 text-white',   inactive: 'bg-green-100 text-green-600',   chevron: 'bg-green-600 text-white' },
    gray:    { active: 'border-gray-500 bg-gray-50 shadow-lg',    icon: 'bg-gray-600 text-white',    inactive: 'bg-gray-100 text-gray-600',    chevron: 'bg-gray-600 text-white' },
  };

  const ReportCard = ({ icon, title, color, reportType, description }: { icon: string; title: string; color: string; reportType: ReportType; description: string }) => {
    const isActive = activeReport === reportType;
    const colorClasses = REPORT_COLOR_MAP[color] || REPORT_COLOR_MAP.blue;
    return (
      <button 
        onClick={() => setActiveReport(isActive ? null : reportType)}
        className={`w-full p-5 rounded-2xl border-2 transition-all text-left ${
          isActive 
            ? colorClasses.active
            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
        }`}
      >
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? colorClasses.icon : colorClasses.inactive}`}>
            <i className={`fa-solid ${icon} ${isActive ? 'text-xl' : 'text-lg'}`}></i>
          </div>
          <div className="flex-1">
            <h4 className={`font-black text-gray-800 ${isActive ? 'text-lg' : 'text-base'}`}>{title}</h4>
            <p className={`text-gray-500 text-sm mt-1 ${isActive ? 'font-medium' : ''}`}>{description}</p>
          </div>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${isActive ? `${colorClasses.chevron} rotate-180` : 'bg-gray-100 text-gray-400'}`}>
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

      case 'PRODUTOS_RENTAVEIS':
        return (
          <div className="space-y-5 animate-in fade-in duration-300">
            {/* KPIs de resumo */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-600 p-5 rounded-3xl shadow-lg text-white">
                <p className="text-[9px] font-black uppercase opacity-60 mb-1">Lucro Total</p>
                <h2 className="text-xl font-black">R$ {produtosRentaveis.totalLucro.toFixed(2)}</h2>
                <p className="text-[9px] font-bold opacity-50 mt-1">Receita - Custo</p>
              </div>
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Margem Geral</p>
                <h2 className="text-xl font-black text-emerald-600">{produtosRentaveis.totalFaturamento > 0 ? ((produtosRentaveis.totalLucro / produtosRentaveis.totalFaturamento) * 100).toFixed(1) : '0.0'}%</h2>
                <p className="text-[9px] font-bold text-gray-400 mt-1">Lucro / Faturamento</p>
              </div>
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Faturamento</p>
                <h2 className="text-xl font-black text-blue-600">R$ {produtosRentaveis.totalFaturamento.toFixed(2)}</h2>
                <p className="text-[9px] font-bold text-gray-400 mt-1">{produtosRentaveis.totalQtd} un vendidas</p>
              </div>
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                <p className="text-[9px] font-black uppercase text-gray-400 mb-1">Custo Total</p>
                <h2 className="text-xl font-black text-rose-500">R$ {produtosRentaveis.totalCusto.toFixed(2)}</h2>
                <p className="text-[9px] font-bold text-gray-400 mt-1">Investimento no período</p>
              </div>
            </div>

            {/* Lista de produtos */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="bg-emerald-50 px-5 py-4 border-b border-emerald-100">
                <h3 className="font-black text-emerald-800 uppercase text-xs tracking-wider flex items-center gap-2">
                  <i className="fa-solid fa-trophy text-emerald-600"></i> Ranking de Rentabilidade
                </h3>
                <p className="text-[10px] text-emerald-600/70 font-semibold mt-1">Ordenado por lucro total (margem unitária x unidades vendidas)</p>
              </div>

              {produtosRentaveis.produtos.length === 0 ? (
                <p className="text-center py-10 text-gray-400 text-sm">Nenhum produto vendido no período</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {produtosRentaveis.produtos.map((p, i) => {
                    const maxLucro = produtosRentaveis.produtos[0]?.lucroTotal || 1;
                    const barWidth = Math.max(8, ((p?.lucroTotal || 0) / maxLucro) * 100);
                    const rankColor = i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-gray-300';
                    return (
                      <div key={p?.id} className="px-5 py-4">
                        {/* Header do produto */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`text-sm font-black ${rankColor} w-6 text-center`}>#{i + 1}</span>
                            <span className="text-xs font-bold text-gray-800 uppercase truncate">{p?.nome}</span>
                          </div>
                          <span className="text-sm font-black text-emerald-600 whitespace-nowrap ml-3">R$ {p?.lucroTotal.toFixed(2)}</span>
                        </div>
                        {/* Barra de progresso visual */}
                        <div className="w-full h-2 bg-gray-100 rounded-full mb-3 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all" style={{ width: `${barWidth}%` }}></div>
                        </div>
                        {/* Métricas detalhadas */}
                        <div className="grid grid-cols-4 gap-2">
                          <div className="bg-gray-50 rounded-xl px-2.5 py-2 text-center">
                            <p className="text-[8px] font-black uppercase text-gray-400">Custo Un.</p>
                            <p className="text-[11px] font-black text-gray-700">R$ {p?.custoUnit}</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl px-2.5 py-2 text-center">
                            <p className="text-[8px] font-black uppercase text-gray-400">Venda Un.</p>
                            <p className="text-[11px] font-black text-blue-600">R$ {p?.vendaUnit}</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl px-2.5 py-2 text-center">
                            <p className="text-[8px] font-black uppercase text-gray-400">Margem</p>
                            <p className="text-[11px] font-black text-emerald-600">{p?.margemPercent}%</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl px-2.5 py-2 text-center">
                            <p className="text-[8px] font-black uppercase text-gray-400">Unid.</p>
                            <p className="text-[11px] font-black text-gray-700">{p?.qtd}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
            <MenuCard icon="fa-coins" title="Comissoes" tab="CAIXA" color="bg-yellow-50 text-yellow-600" />
            <MenuCard icon="fa-users-gear" title="Vendedores" tab="VENDEDORES" color="bg-purple-50 text-purple-600" />
            <MenuCard icon="fa-receipt" title="Vendas Realizadas" tab="HISTORY" color="bg-red-50 text-red-600" />
            <MenuCard icon="fa-calendar-days" title="Roteiro" tab="ROTEIRO" color="bg-indigo-50 text-indigo-600" />
            <MenuCard icon="fa-chart-line" title="Relatórios" tab="REPORTS" color="bg-emerald-50 text-emerald-600" />
            <MenuCard icon="fa-file-invoice-dollar" title="Contas a Receber" tab="CONTAS_RECEBER" color="bg-rose-50 text-rose-600" />
            <MenuCard icon="fa-database" title="Backup" tab="BACKUP" color="bg-gray-100 text-gray-600" />
            <MenuCard icon="fa-gear" title="Configurações" tab="SETTINGS" color="bg-slate-50 text-slate-600" />
          </div>
        </div>
      )}

      {activeTab === 'CATALOGO' && (
        <div className="space-y-4">
          <div className="px-2 flex justify-between items-center"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Estoque Central</h2><div className="flex gap-2"><button onClick={handleActivateAll} className="bg-emerald-100 text-emerald-600 px-4 py-2 rounded-xl font-black text-[9px] uppercase shadow-sm active:scale-95 transition-all"><i className="fa-solid fa-check-double mr-2"></i>Ativar Todos</button><button onClick={() => handleOpenProduct('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-plus text-lg"></i></button></div></div>
          <div className="px-1"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm focus:ring-2 focus:ring-blue-100 outline-none" /></div>
          <div className="grid gap-2">
            {filteredProducts.map(p => (
              <div key={p.id} className={`bg-white p-4 rounded-3xl border shadow-sm flex items-center gap-3 transition-all hover:border-blue-200 ${!p.ativo ? 'opacity-50 grayscale' : ''}`}>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button onClick={() => moveProduct(p.id, 'UP')} className="w-7 h-7 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center active:scale-90 border border-gray-100"><i className="fa-solid fa-chevron-up text-[9px]"></i></button>
                  <button onClick={() => moveProduct(p.id, 'DOWN')} className="w-7 h-7 bg-gray-50 text-gray-400 rounded-lg flex items-center justify-center active:scale-90 border border-gray-100"><i className="fa-solid fa-chevron-down text-[9px]"></i></button>
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleOpenProduct(p)}>
                  <h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{p.nome}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100 uppercase tracking-tighter">Estoque: {p.estoquePrincipal} un</span>
                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100 uppercase tracking-tighter">R$ {p.precoVenda.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
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

      {activeTab === 'CARGAS' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Cargas</h2></div>
          <div className="px-1 space-y-3">
            <select value={selectedVendedorId} onChange={e => setSelectedVendedorId(e.target.value)} className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-orange-100">
              <option value="">Selecione um Vendedor</option>
              {props.users.filter(u => u.role === 'VENDEDOR').map(u => (<option key={u.id} value={u.id}>{u.nome} - {formatRouteName(u.rota)}</option>))}
            </select>
          </div>
          {selectedVendedorId && (
            <>
              <div className="flex gap-2 px-1">
                <button onClick={() => setShowConfirmSync(true)} disabled={!hasCargaChanges} className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase shadow-sm active:scale-95 ${hasCargaChanges ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-300'}`}>
                  <i className="fa-solid fa-arrows-rotate mr-1"></i> Sincronizar
                </button>
                <button onClick={() => setShowConfirmApply(true)} className="flex-1 py-3 rounded-2xl text-[10px] font-black uppercase bg-blue-600 text-white shadow-sm active:scale-95">
                  <i className="fa-solid fa-bolt mr-1"></i> Aplicar Agora
                </button>
                <button onClick={handleZeroCarga} className="py-3 px-4 rounded-2xl text-[10px] font-black uppercase bg-rose-50 text-rose-600 shadow-sm active:scale-95 border border-rose-100">
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
              <div className="grid gap-2 px-1">
                {props.products.filter(p => p.ativo).map(p => {
                  const atual = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === p.id)?.quantidade ?? 0;
                  const staged = stagingCarga[p.id] ?? atual;
                  return (
                    <div key={p.id} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-gray-800 text-[11px] uppercase truncate">{p.nome}</h4>
                        <p className="text-[9px] text-gray-400 font-bold mt-0.5">Estoque: {p.estoquePrincipal} | No vendedor: {atual}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateStaging(p.id, -1)} className="w-8 h-8 bg-orange-50 text-orange-600 rounded-lg flex items-center justify-center active:scale-90 border border-orange-100"><i className="fa-solid fa-minus text-[9px]"></i></button>
                        <input type="number" value={staged} onChange={e => handleStagingInputChange(p.id, e.target.value)} className="w-14 text-center p-1.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-black outline-none" />
                        <button onClick={() => updateStaging(p.id, 1)} className="w-8 h-8 bg-orange-50 text-orange-600 rounded-lg flex items-center justify-center active:scale-90 border border-orange-100"><i className="fa-solid fa-plus text-[9px]"></i></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <div className="px-2 flex justify-between items-center">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Clientes</h2>
            <button onClick={() => handleOpenClient('NEW')} className="bg-green-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-md active:scale-95"><i className="fa-solid fa-user-plus mr-2"></i>Novo</button>
          </div>
          <div className="px-1 space-y-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm outline-none focus:ring-2 focus:ring-green-100" />
            <div className="flex bg-gray-100 p-1 rounded-2xl overflow-x-auto gap-1">
              <button onClick={() => setRouteFilter('TODOS')} className={`flex-1 min-w-[60px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${routeFilter === 'TODOS' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400'}`}>Todos</button>
              {availableRoutes.map(r => (
                <button key={r} onClick={() => setRouteFilter(r)} className={`flex-1 min-w-[60px] py-2 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${routeFilter === r ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400'}`}>{formatRouteName(r)}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 px-1">
            {filteredClients.map(c => {
              const totalDivida = props.sales.filter(s => s.clientId === c.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE').reduce((a, s) => a + ((s.valorTotal ?? 0) - (s.valorPago ?? 0)), 0);
              return (
                <div key={c.id} className={`bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-3 transition-all ${!c.ativo ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setViewingClientHistory(c)}>
                    <h4 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{c.nomeFantasia}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-lg border border-green-100 uppercase">{DIAS_SEMANA[c.diaRoteiro ?? 1]}</span>
                      <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100 uppercase">{formatRouteName(c.rota)}</span>
                      {totalDivida > 0 && <span className="text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-100">R$ {totalDivida.toFixed(2)}</span>}
                    </div>
                    {c.telefone && <p className="text-[9px] text-gray-400 font-semibold mt-1">{c.telefone}</p>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => handleOpenClient(c)} className="w-10 h-10 bg-green-50 text-green-600 rounded-xl border border-green-100 flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-pencil-alt text-xs"></i></button>
                    <button onClick={() => setConfirmDelete({ id: c.id, type: 'CLIENT', name: c.nomeFantasia || 'Cliente' })} className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl border border-rose-100 flex items-center justify-center active:scale-90 shadow-sm"><i className="fa-solid fa-trash-can text-xs"></i></button>
                  </div>
                </div>
              );
            })}
            {filteredClients.length === 0 && <p className="text-center py-8 text-gray-400 text-xs font-bold uppercase">Nenhum cliente encontrado</p>}
          </div>
        </div>
      )}

      {activeTab === 'CAIXA' && (() => {
        const totalComissoesGeradas = props.commissions.reduce((a, c) => a + (c.valor ?? 0), 0);
        const totalJaPago = props.payoutLogs.reduce((a, l) => a + (l.valorPago ?? 0), 0);
        const totalAPagar = Math.max(0, totalComissoesGeradas - totalJaPago);
        const totalAReceber = props.commissions.filter(c => c.status === 'A_RECEBER').reduce((a, c) => a + (c.valor ?? 0), 0);
        return (
          <div className="space-y-4">
            <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Comissoes</h2><p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Gestao de repasses e pagamentos</p></div>
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md mx-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center bg-amber-50 p-4 rounded-2xl"><p className="text-[8px] font-black text-amber-500 uppercase mb-1">Total Gerado</p><p className="text-lg font-black text-amber-700">R$ {totalComissoesGeradas.toFixed(2)}</p></div>
                <div className="text-center bg-emerald-50 p-4 rounded-2xl"><p className="text-[8px] font-black text-emerald-500 uppercase mb-1">Ja Pago</p><p className="text-lg font-black text-emerald-700">R$ {totalJaPago.toFixed(2)}</p></div>
                <div className="text-center bg-blue-50 p-4 rounded-2xl"><p className="text-[8px] font-black text-blue-500 uppercase mb-1">A Pagar</p><p className="text-lg font-black text-blue-700">R$ {totalAPagar.toFixed(2)}</p></div>
                <div className="text-center bg-rose-50 p-4 rounded-2xl"><p className="text-[8px] font-black text-rose-500 uppercase mb-1">A Receber (Vend.)</p><p className="text-lg font-black text-rose-700">R$ {totalAReceber.toFixed(2)}</p></div>
              </div>
            </div>

            <div className="px-1"><h3 className="font-black text-gray-800 uppercase text-xs tracking-wider px-1 mb-3"><i className="fa-solid fa-coins text-amber-500 mr-2"></i>Comissoes por Vendedor</h3>
              <div className="grid gap-3">
                {props.users.filter(u => u.role === 'VENDEDOR').map(v => {
                  const stats = getVendedorStats(v.id);
                  return (
                    <div key={v.id} className="bg-white rounded-3xl p-4 border border-gray-100 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">{v.foto ? <img src={v.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user text-gray-400"></i>}</div>
                          <div><h4 className="font-bold text-gray-800 text-[11px] uppercase">{v.nome}</h4><p className="text-[9px] text-gray-400 font-bold uppercase">{formatRouteName(v.rota)}</p></div>
                        </div>
                        <button onClick={() => handleOpenPayout(v)} disabled={stats.comissaoDisponivel <= 0} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase active:scale-95 shadow-sm ${stats.comissaoDisponivel > 0 ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-300'}`}>
                          <i className="fa-solid fa-money-bill-transfer mr-1"></i>Pagar
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center bg-blue-50 p-2 rounded-xl"><p className="text-[7px] font-black text-blue-500 uppercase">Vendas Hoje</p><p className="text-[11px] font-black text-blue-700">R$ {stats.vendasHoje.toFixed(2)}</p></div>
                        <div className="text-center bg-amber-50 p-2 rounded-xl"><p className="text-[7px] font-black text-amber-500 uppercase">Gerada Hoje</p><p className="text-[11px] font-black text-amber-700">R$ {stats.comissaoGerada.toFixed(2)}</p></div>
                        <div className="text-center bg-emerald-50 p-2 rounded-xl"><p className="text-[7px] font-black text-emerald-500 uppercase">Disponivel</p><p className="text-[11px] font-black text-emerald-700">R$ {stats.comissaoDisponivel.toFixed(2)}</p></div>
                      </div>
                      {stats.comissaoAReceber > 0 && <div className="mt-2 text-center bg-rose-50 p-2 rounded-xl"><p className="text-[7px] font-black text-rose-500 uppercase">A Receber</p><p className="text-[11px] font-black text-rose-700">R$ {stats.comissaoAReceber.toFixed(2)}</p></div>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="px-1 pt-2">
              <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider px-1 mb-3"><i className="fa-solid fa-receipt text-emerald-500 mr-2"></i>Historico de Repasses</h3>
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
                {props.payoutLogs.length === 0 && (
                  <div className="text-center py-8 opacity-30 text-[9px] uppercase font-bold tracking-widest">Nenhum repasse registrado.</div>
                )}
                {props.payoutLogs.sort((a, b) => new Date(b.dataPagamento).getTime() - new Date(a.dataPagamento).getTime()).slice(0, 30).map(p => {
                  const vendedor = props.users.find(u => u.id === p.vendedorId);
                  return (
                    <div key={p.id} className="p-4 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center"><i className="fa-solid fa-circle-check text-emerald-500 text-sm"></i></div>
                        <div>
                          <p className="text-[11px] font-black uppercase text-gray-700">{vendedor?.nome || 'Vendedor'} - {p.tipo === 'TOTAL' ? 'Pagamento Integral' : 'Repasse Parcial'}</p>
                          <p className="text-[9px] text-gray-400 font-semibold mt-0.5">{new Date(p.dataPagamento).toLocaleDateString()} {new Date(p.dataPagamento).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                        </div>
                      </div>
                      <p className="text-sm font-black text-emerald-600">R$ {p.valorPago.toFixed(2)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

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

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Roteiro Semanal</h2></div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 shadow-inner overflow-x-auto gap-1">
            {DIAS_SEMANA.map((dia, idx) => (
              <button key={idx} onClick={() => {}} className={`flex-1 min-w-[50px] py-2.5 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${true ? 'text-gray-400' : 'bg-white text-indigo-600 shadow-sm'}`}>{dia}</button>
            ))}
          </div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 overflow-x-auto gap-1">
            <button onClick={() => setRouteFilter('TODOS')} className={`flex-1 min-w-[60px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${routeFilter === 'TODOS' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}>Todos</button>
            {availableRoutes.map(r => (
              <button key={r} onClick={() => setRouteFilter(r)} className={`flex-1 min-w-[60px] py-2 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${routeFilter === r ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}>{formatRouteName(r)}</button>
            ))}
          </div>
          <div className="space-y-2 px-1">
            {[1,2,3,4,5,6,7].map(dia => {
              const clientsDia = props.clients.filter(c => {
                const matchDia = (c.diaRoteiro ?? 1) === dia && c.ativo;
                const matchRoute = routeFilter === 'TODOS' || c.rota === routeFilter;
                return matchDia && matchRoute;
              }).sort((a, b) => {
                const idxA = props.clientOrder.indexOf(a.id) >= 0 ? props.clientOrder.indexOf(a.id) : (a.ordem || 999);
                const idxB = props.clientOrder.indexOf(b.id) >= 0 ? props.clientOrder.indexOf(b.id) : (b.ordem || 999);
                return idxA - idxB;
              });
              if (clientsDia.length === 0) return null;
              return (
                <div key={dia} className="space-y-2">
                  <div className="flex items-center gap-2 px-1 pt-2"><div className="w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center text-[10px] font-black">{dia}</div><span className="font-black text-gray-800 text-xs uppercase">{DIAS_SEMANA[dia]} - {clientsDia.length} clientes</span></div>
                  {clientsDia.map((c, idx) => {
                    const totalDivida = props.sales.filter(s => s.clientId === c.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE').reduce((a, s) => a + ((s.valorTotal ?? 0) - (s.valorPago ?? 0)), 0);
                    return (
                      <div key={c.id} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                          <button onClick={() => moveClient(c.id, 'UP')} disabled={idx === 0} className="w-6 h-6 bg-gray-50 text-gray-400 rounded-md flex items-center justify-center active:scale-90 border border-gray-100 disabled:opacity-30"><i className="fa-solid fa-chevron-up text-[7px]"></i></button>
                          <button onClick={() => moveClient(c.id, 'DOWN')} disabled={idx === clientsDia.length - 1} className="w-6 h-6 bg-gray-50 text-gray-400 rounded-md flex items-center justify-center active:scale-90 border border-gray-100 disabled:opacity-30"><i className="fa-solid fa-chevron-down text-[7px]"></i></button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-gray-800 text-[11px] uppercase truncate">{c.nomeFantasia}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[8px] font-bold text-gray-400">{c.endereco || 'Sem endereco'}</span>
                            {totalDivida > 0 && <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">R$ {totalDivida.toFixed(2)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {c.pinLocalizacao && <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.pinLocalizacao}`} target="_blank" rel="noopener noreferrer" className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center active:scale-90 border border-emerald-100"><i className="fa-solid fa-diamond-turn-right text-[9px]"></i></a>}
                          <button onClick={() => handleOpenClient(c)} className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center active:scale-90 border border-indigo-100"><i className="fa-solid fa-pencil text-[8px]"></i></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {props.clients.filter(c => c.ativo && (routeFilter === 'TODOS' || c.rota === routeFilter)).length === 0 && <p className="text-center py-8 text-gray-400 text-xs font-bold uppercase">Nenhum cliente ativo</p>}
          </div>
        </div>
      )}

      {activeTab === 'REPORTS' && (
        <div className="space-y-4">
          <header className="px-1 flex justify-between items-center"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Relatorios</h2></header>
          
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 shadow-inner overflow-x-auto gap-1">
            {(['RESUMO', 'TOP_PRODUTOS', 'RENTAVEIS', 'TOP_CLIENTES', 'CATEGORIAS', 'VENDEDORES', 'DIVIDAS'] as const).map(r => (
              <button key={r} onClick={() => setReportFilter(r as any)} className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all whitespace-nowrap ${reportFilter === r ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{r === 'TOP_PRODUTOS' ? 'Top Produtos' : r === 'RENTAVEIS' ? 'Rentaveis' : r === 'TOP_CLIENTES' ? 'Top Clientes' : r === 'VENDEDORES' ? 'Vendedores' : r === 'CATEGORIAS' ? 'Categorias' : r === 'DIVIDAS' ? 'Dividas' : 'Resumo'}</button>
            ))}
          </div>

          {reportFilter !== 'DIVIDAS' && (
            <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 shadow-inner">{(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (<button key={p} onClick={() => setReportPeriodo(p)} className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase transition-all ${reportPeriodo === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>))}</div>
          )}

          {(() => {
            const salesInPeriod = reportFilter === 'DIVIDAS' ? props.sales : props.sales.filter(s => filterByPeriod(s.data, reportPeriodo));
            const sumV = (arr: any[]) => arr.reduce((a, s) => a + (s.valorTotal || 0), 0);
            const weekAgoDate = new Date(); weekAgoDate.setDate(weekAgoDate.getDate() - 7);
            const monthAgoDate = new Date(); monthAgoDate.setDate(monthAgoDate.getDate() - 30);
            const vendasHoje = props.sales.filter(s => s.data && new Date(s.data) >= new Date(new Date().toDateString()));
            const vendasSemana = props.sales.filter(s => s.data && new Date(s.data) >= weekAgoDate);
            const vendasMes = props.sales.filter(s => s.data && new Date(s.data) >= monthAgoDate);
            const recebidoMes = props.payoutLogs.filter(p => p.dataPagamento && new Date(p.dataPagamento) >= monthAgoDate).reduce((a, p) => a + (p.valorPago || 0), 0);
            const ticketMedio = salesInPeriod.length > 0 ? sumV(salesInPeriod) / salesInPeriod.length : 0;

            return (<>
            {reportFilter === 'RESUMO' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm"><p className="text-[9px] font-black text-gray-400 uppercase">Vendas no Periodo</p><p className="text-xl font-black text-gray-800 mt-1">R$ {sumV(salesInPeriod).toFixed(2)}</p><p className="text-[9px] text-gray-400 font-bold">{salesInPeriod.length} pedidos</p></div>
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 shadow-sm"><p className="text-[9px] font-black text-blue-400 uppercase">Ticket Medio</p><p className="text-xl font-black text-blue-700 mt-1">R$ {ticketMedio.toFixed(2)}</p></div>
                  <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 shadow-sm"><p className="text-[9px] font-black text-emerald-400 uppercase">Recebido (Comissoes)</p><p className="text-xl font-black text-emerald-700 mt-1">R$ {recebidoMes.toFixed(2)}</p></div>
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 shadow-sm"><p className="text-[9px] font-black text-amber-400 uppercase">A Receber Total</p><p className="text-xl font-black text-amber-700 mt-1">R$ {props.sales.filter(s => s.statusPagamento === 'PENDENTE').reduce((a, s) => a + ((s.valorTotal || 0) - (s.valorPago || 0)), 0).toFixed(2)}</p></div>
                  <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100 shadow-sm"><p className="text-[9px] font-black text-rose-400 uppercase">Vencidas</p><p className="text-xl font-black text-rose-700 mt-1">R$ {props.sales.filter(s => s.statusPagamento === 'PENDENTE' && s.dataVencimento && new Date(s.dataVencimento) <= new Date()).reduce((a, s) => a + ((s.valorTotal || 0) - (s.valorPago || 0)), 0).toFixed(2)}</p></div>
                  <div className="bg-purple-50 p-4 rounded-2xl border border-purple-100 shadow-sm"><p className="text-[9px] font-black text-purple-400 uppercase">Vendas Hoje</p><p className="text-xl font-black text-purple-700 mt-1">R$ {sumV(vendasHoje).toFixed(2)}</p><p className="text-[9px] text-purple-400 font-bold">{vendasHoje.length} pedidos</p></div>
                </div>
              </div>
            )}

            {reportFilter === 'TOP_PRODUTOS' && (() => {
              const prodMap = new Map<string, { nome: string; qtd: number; valor: number }>();
              salesInPeriod.forEach(s => { (s.itens || []).forEach((i: any) => {
                  const ex = prodMap.get(i.produtoId) || { nome: props.products.find(p => p.id === i.produtoId)?.nome || '?', qtd: 0, valor: 0 };
                  prodMap.set(i.produtoId, { nome: ex.nome, qtd: ex.qtd + (i.quantidade || 0), valor: ex.valor + (i.quantidade || 0) * (i.precoVenda || 0) });
                }); });
              const ranked = [...prodMap.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 15);
              const maxQtd = ranked.length > 0 ? ranked[0].qtd : 1;
              return (
                <div className="space-y-2">
                  <div className="bg-blue-50 p-3 rounded-2xl border border-blue-100 flex justify-between items-center"><p className="text-[10px] font-black text-blue-600 uppercase">Total em Faturamento</p><p className="text-sm font-black text-blue-800">R$ {[...prodMap.values()].reduce((a,p) => a + p.valor, 0).toFixed(2)}</p></div>
                  {ranked.map((p, i) => (
                    <div key={i} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="flex justify-between items-center mb-2"><span className="font-bold text-xs text-gray-800 uppercase">{i + 1}. {p.nome}</span><span className="text-xs font-black text-blue-600">{p.qtd} un</span></div>
                      <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${(p.qtd / maxQtd) * 100}%` }}></div></div>
                      <p className="text-[9px] text-gray-400 font-bold mt-1">R$ {p.valor.toFixed(2)} em faturamento</p>
                    </div>
                  ))}
                  {ranked.length === 0 && <p className="text-center text-gray-400 text-xs font-bold py-8">Nenhuma venda no periodo</p>}
                </div>
              );
            })()}

            {reportFilter === 'TOP_CLIENTES' && (() => {
              const cliMap = new Map<string, { nome: string; qtd: number; valor: number }>();
              salesInPeriod.forEach(s => {
                const ex = cliMap.get(s.clientId) || { nome: props.clients.find(c => c.id === s.clientId)?.nomeFantasia || '?', qtd: 0, valor: 0 };
                cliMap.set(s.clientId, { nome: ex.nome, qtd: ex.qtd + 1, valor: ex.valor + (s.valorTotal || 0) });
              });
              const ranked = [...cliMap.values()].sort((a, b) => b.valor - a.valor).slice(0, 15);
              const maxVal = ranked.length > 0 ? ranked[0].valor : 1;
              return (
                <div className="space-y-2">
                  <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100 flex justify-between items-center"><p className="text-[10px] font-black text-emerald-600 uppercase">Clientes Ativos no Periodo</p><p className="text-sm font-black text-emerald-800">{ranked.length}</p></div>
                  {ranked.map((c, i) => (
                    <div key={i} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="flex justify-between items-center mb-2"><span className="font-bold text-xs text-gray-800 uppercase">{i + 1}. {c.nome}</span><span className="text-xs font-black text-emerald-600">{c.qtd} pedidos</span></div>
                      <div className="w-full bg-gray-100 rounded-full h-2"><div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${(c.valor / maxVal) * 100}%` }}></div></div>
                      <p className="text-[9px] text-gray-400 font-bold mt-1">R$ {c.valor.toFixed(2)} em compras</p>
                    </div>
                  ))}
                  {ranked.length === 0 && <p className="text-center text-gray-400 text-xs font-bold py-8">Nenhuma venda no periodo</p>}
                </div>
              );
            })()}

            {reportFilter === 'CATEGORIAS' && (() => {
              const catMap = new Map<string, { nome: string; qtd: number; valor: number }>();
              salesInPeriod.forEach(s => {
                (s.itens || []).forEach((item: any) => {
                  const prod = props.products.find(p => p.id === item.produtoId);
                  const catId = prod?.categoryId || 'sem-categoria';
                  const catName = props.categories.find(c => c.id === catId)?.name || 'Sem Categoria';
                  const ex = catMap.get(catId) || { nome: catName, qtd: 0, valor: 0 };
                  catMap.set(catId, { nome: ex.nome, qtd: ex.qtd + (item.quantidade || 0), valor: ex.valor + (item.quantidade || 0) * (item.precoVenda || 0) });
                });
              });
              const ranked = [...catMap.values()].sort((a, b) => b.valor - a.valor);
              const totalValor = ranked.reduce((a, c) => a + c.valor, 0) || 1;
              const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-cyan-500'];
              return (
                <div className="space-y-2">
                  <div className="bg-indigo-50 p-3 rounded-2xl border border-indigo-100 flex justify-between items-center"><p className="text-[10px] font-black text-indigo-600 uppercase">Total por Categorias</p><p className="text-sm font-black text-indigo-800">R$ {ranked.reduce((a,c)=>a+c.valor,0).toFixed(2)}</p></div>
                  {ranked.map((c, i) => (
                    <div key={i} className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="flex justify-between items-center mb-2"><span className="font-bold text-xs text-gray-800 uppercase">{c.nome}</span><span className="text-xs font-black text-gray-500">{((c.valor / totalValor) * 100).toFixed(1)}%</span></div>
                      <div className="w-full bg-gray-100 rounded-full h-2"><div className={`${colors[i % colors.length]} h-2 rounded-full transition-all`} style={{ width: `${(c.valor / totalValor) * 100}%` }}></div></div>
                      <div className="flex justify-between mt-1"><p className="text-[9px] text-gray-400 font-bold">{c.qtd} unidades</p><p className="text-[9px] font-black text-gray-700">R$ {c.valor.toFixed(2)}</p></div>
                    </div>
                  ))}
                  {ranked.length === 0 && <p className="text-center text-gray-400 text-xs font-bold py-8">Nenhuma venda no periodo</p>}
                </div>
              );
            })()}

            {reportFilter === 'VENDEDORES' && (() => {
              const venMap = new Map<string, { nome: string; qtd: number; valor: number; comissao: number }>();
              salesInPeriod.forEach(s => {
                const nome = props.users.find(u => u.id === s.vendedorId)?.nome || '?';
                const ex = venMap.get(s.vendedorId) || { nome, qtd: 0, valor: 0, comissao: 0 };
                const comVal = props.commissions.filter(c => c.saleId === s.id).reduce((a, c) => a + (c.valor || 0), 0);
                venMap.set(s.vendedorId, { nome, qtd: ex.qtd + 1, valor: ex.valor + (s.valorTotal || 0), comissao: ex.comissao + comVal });
              });
              const ranked = [...venMap.values()].sort((a, b) => b.valor - a.valor);
              return (
                <div className="space-y-2">
                  <div className="bg-purple-50 p-3 rounded-2xl border border-purple-100 flex justify-between items-center"><p className="text-[10px] font-black text-purple-600 uppercase">Performance dos Vendedores</p><p className="text-sm font-black text-purple-800">{ranked.length} vendedores</p></div>
                  {ranked.map((v, i) => (
                    <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                      <div className="flex justify-between items-center mb-1"><span className="font-bold text-sm text-gray-800 uppercase">{i + 1}. {v.nome}</span><span className="text-xs font-black text-blue-600">R$ {v.valor.toFixed(2)}</span></div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="bg-gray-50 p-2 rounded-xl text-center"><p className="text-[8px] font-black text-gray-400 uppercase">Pedidos</p><p className="text-xs font-black text-gray-800">{v.qtd}</p></div>
                        <div className="bg-emerald-50 p-2 rounded-xl text-center"><p className="text-[8px] font-black text-emerald-400 uppercase">Comissao</p><p className="text-xs font-black text-emerald-700">R$ {v.comissao.toFixed(2)}</p></div>
                      </div>
                    </div>
                  ))}
                  {ranked.length === 0 && <p className="text-center text-gray-400 text-xs font-bold py-8">Nenhuma venda no periodo</p>}
                </div>
              );
            })()}

            {reportFilter === 'DIVIDAS' && (() => {
              const dividas = props.sales.filter(s => s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE');
              const totalDivida = dividas.reduce((a, s) => a + ((s.valorTotal || 0) - (s.valorPago || 0)), 0);
              const vencidas = dividas.filter(s => s.dataVencimento && new Date(s.dataVencimento) <= new Date());
              const totalVencido = vencidas.reduce((a, s) => a + ((s.valorTotal || 0) - (s.valorPago || 0)), 0);
              const porCliente = new Map<string, { nome: string; total: number; qtd: number; vencido: number }>();
              dividas.forEach(s => {
                const nome = props.clients.find(c => c.id === s.clientId)?.nomeFantasia || '?';
                const saldo = (s.valorTotal || 0) - (s.valorPago || 0);
                const isVencido = s.dataVencimento && new Date(s.dataVencimento) <= new Date();
                const ex = porCliente.get(s.clientId) || { nome, total: 0, qtd: 0, vencido: 0 };
                porCliente.set(s.clientId, { nome, total: ex.total + saldo, qtd: ex.qtd + 1, vencido: ex.vencido + (isVencido ? saldo : 0) });
              });
              const ranked = [...porCliente.values()].sort((a, b) => b.total - a.total);
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100 shadow-sm"><p className="text-[9px] font-black text-rose-400 uppercase">Total em Aberto</p><p className="text-xl font-black text-rose-700 mt-1">R$ {totalDivida.toFixed(2)}</p><p className="text-[9px] text-rose-400 font-bold">{dividas.length} dividas</p></div>
                    <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 shadow-sm"><p className="text-[9px] font-black text-orange-400 uppercase">Total Vencido</p><p className="text-xl font-black text-orange-700 mt-1">R$ {totalVencido.toFixed(2)}</p><p className="text-[9px] text-orange-400 font-bold">{vencidas.length} vencidas</p></div>
                  </div>
                  <div className="space-y-2">
                    {ranked.map((c, i) => (
                      <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex justify-between items-center mb-2"><span className="font-bold text-xs text-gray-800 uppercase">{i + 1}. {c.nome}</span><span className="text-xs font-black text-rose-600">{c.qtd} dividas</span></div>
                        <div className="flex justify-between items-center"><span className="text-[10px] font-black text-gray-800">Saldo: R$ {c.total.toFixed(2)}</span>{c.vencido > 0 && <span className="text-[9px] font-black text-orange-600 bg-orange-50 px-2 py-0.5 rounded">R$ {c.vencido.toFixed(2)} vencido</span>}</div>
                      </div>
                    ))}
                    {ranked.length === 0 && <p className="text-center text-gray-400 text-xs font-bold py-8">Nenhuma divida pendente</p>}
                  </div>
                </div>
              );
            })()}

            {reportFilter === 'PRODUTOS_RENTAVEIS' && (() => {
              const pr = produtosRentaveis;
              const maxLucro = pr.produtos.length > 0 ? (pr.produtos[0]?.lucroTotal || 1) : 1;
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-600 p-4 rounded-2xl shadow-lg text-white"><p className="text-[9px] font-black uppercase opacity-60">Lucro Total</p><p className="text-xl font-black mt-1">R$ {pr.totalLucro.toFixed(2)}</p><p className="text-[9px] font-bold opacity-50 mt-1">Receita - Custo</p></div>
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm"><p className="text-[9px] font-black text-gray-400 uppercase">Margem Geral</p><p className="text-xl font-black text-emerald-600 mt-1">{pr.totalFaturamento > 0 ? ((pr.totalLucro / pr.totalFaturamento) * 100).toFixed(1) : '0.0'}%</p><p className="text-[9px] font-bold text-gray-400 mt-1">Lucro / Faturamento</p></div>
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm"><p className="text-[9px] font-black text-gray-400 uppercase">Faturamento</p><p className="text-xl font-black text-blue-600 mt-1">R$ {pr.totalFaturamento.toFixed(2)}</p><p className="text-[9px] font-bold text-gray-400 mt-1">{pr.totalQtd} un vendidas</p></div>
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm"><p className="text-[9px] font-black text-gray-400 uppercase">Custo Total</p><p className="text-xl font-black text-rose-500 mt-1">R$ {pr.totalCusto.toFixed(2)}</p><p className="text-[9px] font-bold text-gray-400 mt-1">Investimento no periodo</p></div>
                  </div>
                  {pr.produtos.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs font-bold py-8">Nenhum produto vendido no periodo</p>
                  ) : (
                    <div className="space-y-2">
                      {pr.produtos.map((p, i) => {
                        const barW = Math.max(8, ((p?.lucroTotal || 0) / maxLucro) * 100);
                        const rankClr = i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-gray-300';
                        return (
                          <div key={p?.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2 min-w-0"><span className={`text-xs font-black ${rankClr} w-6 text-center`}>#{i + 1}</span><span className="font-bold text-xs text-gray-800 uppercase truncate">{p?.nome}</span></div>
                              <span className="text-xs font-black text-emerald-600 whitespace-nowrap ml-2">R$ {p?.lucroTotal.toFixed(2)}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 mb-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all" style={{ width: `${barW}%` }}></div></div>
                            <div className="grid grid-cols-4 gap-2">
                              <div className="bg-gray-50 rounded-xl px-2 py-1.5 text-center"><p className="text-[7px] font-black text-gray-400 uppercase">Custo Un.</p><p className="text-[10px] font-black text-gray-700">R$ {p?.custoUnit}</p></div>
                              <div className="bg-gray-50 rounded-xl px-2 py-1.5 text-center"><p className="text-[7px] font-black text-gray-400 uppercase">Venda Un.</p><p className="text-[10px] font-black text-blue-600">R$ {p?.vendaUnit}</p></div>
                              <div className="bg-gray-50 rounded-xl px-2 py-1.5 text-center"><p className="text-[7px] font-black text-gray-400 uppercase">Margem</p><p className="text-[10px] font-black text-emerald-600">{p?.margemPercent}%</p></div>
                              <div className="bg-gray-50 rounded-xl px-2 py-1.5 text-center"><p className="text-[7px] font-black text-gray-400 uppercase">Unid.</p><p className="text-[10px] font-black text-gray-700">{p?.qtd}</p></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            </>);
          })()}
        </div>
      )}

      {activeTab === 'CONTAS_RECEBER' && (
        <div className="space-y-4">
          <header className="px-1 flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">Contas a Receber</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vendas a prazo pendentes</p>
            </div>
            <button
              onClick={() => setFilterOverdueOnly(!filterOverdueOnly)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 shadow-sm ${filterOverdueOnly ? 'bg-rose-600 text-white' : 'bg-white text-gray-400 border border-gray-100'}`}
            >
              <i className={`fa-solid ${filterOverdueOnly ? 'fa-calendar-exclamation' : 'fa-calendar-days'}`}></i>
              {filterOverdueOnly ? 'Vencidas' : 'Todas'}
            </button>
          </header>

          <div className="flex bg-gray-100 p-1 rounded-2xl mx-1 shadow-inner overflow-x-auto gap-1">
            {(['TODOS', 'COMUM', 'CHEQUE', 'BOLETO'] as const).map(t => (
              <button
                key={t}
                onClick={() => setCreditTypeFilter(t)}
                className={`flex-1 min-w-[70px] py-2 rounded-xl text-[9px] font-black uppercase transition-all ${creditTypeFilter === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="px-1">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="w-full p-4 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm outline-none focus:ring-2 focus:ring-blue-100" />
          </div>

          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm mx-1">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-1">
              <span className="text-xs font-black text-gray-400 uppercase">Total Pendente</span>
              <span className="text-xl font-black text-rose-600">R$ {contasAReceber.reduce((a, s) => a + ((s.valorTotal ?? 0) - (s.valorPago ?? 0)), 0).toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center bg-rose-50 p-2 rounded-xl">
                <p className="text-[8px] font-black text-rose-500 uppercase">Vencidas</p>
                <p className="text-xs font-black text-rose-700">{contasAReceber.filter(s => { if (!s.dataVencimento) return false; const d = new Date(s.dataVencimento); d.setHours(0,0,0,0); return d <= new Date(); }).length}</p>
              </div>
              <div className="text-center bg-amber-50 p-2 rounded-xl">
                <p className="text-[8px] font-black text-amber-500 uppercase">Total Dividas</p>
                <p className="text-xs font-black text-amber-700">{contasAReceber.length}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            {contasAReceber.map(s => {
              const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2));
              const today = new Date(); today.setHours(0,0,0,0);
              const dueDate = s.dataVencimento ? new Date(s.dataVencimento) : null;
              if (dueDate) dueDate.setHours(0,0,0,0);
              const isOverdue = dueDate ? dueDate <= today : false;
              const clientName = props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente';
              const vendedorName = props.users.find(u => u.id === s.vendedorId)?.nome || 'N/D';

              return (
              <div key={s.id} className={`p-5 rounded-3xl border shadow-sm flex flex-col transition-all ${isOverdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100'}`}>
                <div className="flex justify-between items-start mb-2">
                   <div className="flex-1 pr-4">
                      <h4 className={`font-bold text-sm leading-tight uppercase ${isOverdue ? 'text-rose-900' : 'text-gray-800'}`}>{clientName}</h4>
                      <p className="text-[9px] font-bold text-blue-500 mt-0.5 uppercase"><i className="fa-solid fa-user-tag mr-1"></i>{vendedorName}</p>
                      <div className="flex flex-col mt-2">
                        <span className={`text-[9px] font-black uppercase ${isOverdue ? 'text-rose-600' : 'text-gray-400'}`}>Vencimento</span>
                        <span className={`text-xs font-black ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>{s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</span>
                        <span className="text-[8px] font-black uppercase text-blue-600 mt-1">{s.detalhePagamento || 'COMUM'}</span>
                      </div>
                      {s.detalhePagamento && (
                        <div className="mt-3 space-y-1">
                          <p className="text-[8px] font-black text-gray-400 uppercase">Historico de Recebimentos:</p>
                          <div className="bg-gray-50/50 p-2 rounded-xl border border-gray-100 max-h-24 overflow-y-auto">
                            {s.detalhePagamento.split('|').map((log, i) => (
                              <p key={i} className="text-[8px] font-bold text-gray-500 border-b border-gray-100 last:border-0 pb-1 mb-1">{log.trim()}</p>
                            ))}
                          </div>
                        </div>
                      )}
                   </div>
                   <div className="text-right">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${isOverdue ? 'bg-rose-600 text-white animate-pulse' : 'bg-orange-100 text-orange-600'}`}>{isOverdue ? 'VENCIDO' : 'PENDENTE'}</span>
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
          </div>
        </div>
      )}

      {activeTab === 'BACKUP' && (
        <div className="space-y-4">
          <header className="px-1">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Backup de Dados</h2>
            <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Exporte seus dados para seguranca</p>
          </header>

          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 mx-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center"><i className="fa-solid fa-circle-info text-blue-600"></i></div>
              <div>
                <p className="text-[10px] font-black text-blue-800 uppercase">Formato de Exportacao</p>
                <p className="text-[9px] text-blue-500 font-bold">CSV para planilhas, JSON para dados completos</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBackupFormat('csv')} className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${backupFormat === 'csv' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-100'}`}>CSV</button>
              <button onClick={() => setBackupFormat('json')} className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase transition-all ${backupFormat === 'json' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-100'}`}>JSON</button>
            </div>
          </div>

          <div className="grid gap-3">
            {[
              { key: 'clientes', label: 'Base de Clientes', icon: 'fa-users', color: 'bg-blue-50 text-blue-600 border-blue-100', desc: `${props.clients.length} clientes cadastrados` },
              { key: 'vendas', label: 'Historico de Vendas', icon: 'fa-receipt', color: 'bg-emerald-50 text-emerald-600 border-emerald-100', desc: `${props.sales.length} vendas registradas` },
              { key: 'comissoes', label: 'Comissoes', icon: 'fa-percent', color: 'bg-purple-50 text-purple-600 border-purple-100', desc: `${props.commissions.length} comissoes` },
              { key: 'produtos', label: 'Catalogo de Produtos', icon: 'fa-box', color: 'bg-amber-50 text-amber-600 border-amber-100', desc: `${props.products.length} produtos` },
              { key: 'vendedores', label: 'Vendedores', icon: 'fa-users-gear', color: 'bg-teal-50 text-teal-600 border-teal-100', desc: `${props.users.filter(u => u.role === 'VENDEDOR').length} vendedores` },
              { key: 'cargas', label: 'Cargas Atuais', icon: 'fa-truck-ramp-box', color: 'bg-orange-50 text-orange-600 border-orange-100', desc: `${props.cargas.length} registros de carga` },
              { key: 'despesas', label: 'Despesas', icon: 'fa-money-bill-trend-up', color: 'bg-red-50 text-red-600 border-red-100', desc: `${props.expenses.length} despesas registradas` },
              { key: 'financeiro', label: 'Financeiro Completo', icon: 'fa-coins', color: 'bg-rose-50 text-rose-600 border-rose-100', desc: 'Vendas + recebimentos + comissoes + despesas' },
              { key: 'tudo', label: 'Backup Completo', icon: 'fa-shield-halved', color: 'bg-gray-900 text-white border-gray-900', desc: 'Todos os dados do sistema' },
            ].map(item => (
              <div key={item.key} className={`p-4 rounded-2xl border shadow-sm flex items-center gap-4 ${item.color} transition-all active:scale-[0.98]`}>
                <div className="w-12 h-12 rounded-xl bg-white/60 flex items-center justify-center flex-shrink-0"><i className={`fa-solid ${item.icon} text-lg`}></i></div>
                <div className="flex-1 min-w-0"><h4 className="font-black text-sm uppercase">{item.label}</h4><p className="text-[9px] font-bold opacity-70 mt-0.5">{item.desc}</p></div>
                <button onClick={() => {
                  const fmt = backupFormat;
                  if (fmt === 'json') {
                    let data: any; let filename: string;
                    if (item.key === 'clientes') { data = props.clients; filename = 'clientes.json'; }
                    else if (item.key === 'vendas') { data = props.sales.map(s => ({ ...s, itens: s.itens, data: s.data?.toISOString?.() || s.data, dataVencimento: s.dataVencimento?.toISOString?.() || s.dataVencimento })); filename = 'vendas.json'; }
                    else if (item.key === 'comissoes') { data = { comissoes: props.commissions, pagamentos: props.payoutLogs }; filename = 'comissoes.json'; }
                    else if (item.key === 'produtos') { data = props.products; filename = 'produtos.json'; }
                    else if (item.key === 'vendedores') { data = props.users.filter(u => u.role === 'VENDEDOR'); filename = 'vendedores.json'; }
                    else if (item.key === 'cargas') { data = props.cargas; filename = 'cargas.json'; }
                    else if (item.key === 'despesas') { data = props.expenses; filename = 'despesas.json'; }
                    else if (item.key === 'financeiro') { data = { vendas: props.sales, recebimentos: props.payoutLogs, comissoes: props.commissions, despesas: props.expenses }; filename = 'financeiro.json'; }
                    else { data = { clientes: props.clients, vendas: props.sales, produtos: props.products, comissoes: props.commissions, pagamentos: props.payoutLogs, usuarios: props.users, despesas: props.expenses, categorias: props.categories, cargas: props.cargas }; filename = 'backup-completo.json'; }
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
                  } else {
                    let csv: string = ''; let filename: string;
                    const esc = (v: any) => String(v ?? '').replace(/"/g, '""');
                    const csvRow = (cols: string[]) => cols.map(c => `"${esc(c)}"`).join(',') + '\n';
                    if (item.key === 'clientes') {
                      csv = csvRow(['Nome Fantasia', 'Nome', 'Telefone', 'Endereco', 'Bairro', 'Dia Roteiro', 'Rota', 'Ativo']);
                      props.clients.forEach(c => { csv += csvRow([c.nomeFantasia, c.nome || '', c.telefone || '', c.endereco || '', c.bairro || '', String(c.diaRoteiro || ''), c.rota || '', String(c.ativo ?? true)]); });
                      filename = 'clientes.csv';
                    } else if (item.key === 'vendas') {
                      csv = csvRow(['ID', 'Data', 'Cliente', 'Vendedor', 'Valor Total', 'Valor Pago', 'Metodo', 'Status', 'Vencimento']);
                      props.sales.forEach(s => { csv += csvRow([s.id, s.data?.toLocaleDateString?.() || '', props.clients.find(c => c.id === s.clientId)?.nomeFantasia || '', props.users.find(u => u.id === s.vendedorId)?.nome || '', String(s.valorTotal || 0), String(s.valorPago || 0), s.metodoPagamento, s.statusPagamento, s.dataVencimento?.toLocaleDateString?.() || '']); });
                      filename = 'vendas.csv';
                    } else if (item.key === 'comissoes') {
                      csv = csvRow(['Vendedor', 'Valor', 'Status', 'Data Geracao']);
                      props.commissions.forEach(c => { csv += csvRow([props.users.find(u => u.id === c.vendedorId)?.nome || '', String(c.valor || 0), c.status, c.dataGeracao?.toLocaleDateString?.() || '']); });
                      filename = 'comissoes.csv';
                    } else if (item.key === 'produtos') {
                      csv = csvRow(['Nome', 'Custo', 'Venda', 'Comissao %', 'Estoque', 'Ativo', 'Categoria']);
                      props.products.forEach(p => { csv += csvRow([p.nome, String(p.precoCusto || 0), String(p.precoVenda || 0), String(p.comissaoPercentual || 0), String(p.estoquePrincipal || 0), String(p.ativo ?? true), props.categories.find(c => c.id === p.categoryId)?.name || '']); });
                      filename = 'produtos.csv';
                    } else if (item.key === 'vendedores') {
                      csv = csvRow(['Nome', 'Telefone', 'Rota', 'Placa Veiculo']);
                      props.users.filter(u => u.role === 'VENDEDOR').forEach(u => { csv += csvRow([u.nome, u.telefone || '', u.rota || '', u.placaVeiculo || '']); });
                      filename = 'vendedores.csv';
                    } else if (item.key === 'cargas') {
                      csv = csvRow(['Vendedor', 'Produto', 'Quantidade']);
                      props.cargas.forEach(c => { csv += csvRow([props.users.find(u => u.id === c.vendedorId)?.nome || '', props.products.find(p => p.id === c.produtoId)?.nome || '', String(c.quantidade || 0)]); });
                      filename = 'cargas.csv';
                    } else if (item.key === 'despesas') {
                      csv = csvRow(['Vendedor', 'Descricao', 'Valor', 'Data']);
                      props.expenses.forEach(e => { csv += csvRow([props.users.find(u => u.id === e.sellerId)?.nome || '', e.descricao || '', String(e.valor || 0), new Date(e.createdAt).toLocaleDateString()]); });
                      filename = 'despesas.csv';
                    } else if (item.key === 'financeiro') {
                      csv = '=== VENDAS ===\n' + csvRow(['Data', 'Cliente', 'Vendedor', 'Valor Total', 'Metodo', 'Status']);
                      props.sales.forEach(s => { csv += csvRow([s.data?.toLocaleDateString?.() || '', props.clients.find(c => c.id === s.clientId)?.nomeFantasia || '', props.users.find(u => u.id === s.vendedorId)?.nome || '', String(s.valorTotal || 0), s.metodoPagamento, s.statusPagamento]); });
                      csv += '\n=== COMISSOES ===\n' + csvRow(['Vendedor', 'Valor', 'Status']);
                      props.commissions.forEach(c => { csv += csvRow([props.users.find(u => u.id === c.vendedorId)?.nome || '', String(c.valor || 0), c.status]); });
                      csv += '\n=== PAGAMENTOS ===\n' + csvRow(['Vendedor', 'Valor Pago', 'Tipo', 'Data']);
                      props.payoutLogs.forEach(p => { csv += csvRow([props.users.find(u => u.id === p.vendedorId)?.nome || '', String(p.valorPago || 0), p.tipo, p.dataPagamento?.toLocaleDateString?.() || '']); });
                      csv += '\n=== DESPESAS ===\n' + csvRow(['Vendedor', 'Descricao', 'Valor', 'Data']);
                      props.expenses.forEach(e => { csv += csvRow([props.users.find(u => u.id === e.sellerId)?.nome || '', e.descricao || '', String(e.valor || 0), new Date(e.createdAt).toLocaleDateString()]); });
                      filename = 'financeiro.csv';
                    } else {
                      csv = '=== CLIENTES ===\n' + csvRow(['Nome Fantasia', 'Telefone', 'Endereco', 'Rota']);
                      props.clients.forEach(c => { csv += csvRow([c.nomeFantasia, c.telefone || '', c.endereco || '', c.rota || '']); });
                      csv += '\n=== VENDAS ===\n' + csvRow(['Data', 'Cliente', 'Valor', 'Metodo', 'Status']);
                      props.sales.forEach(s => { csv += csvRow([s.data?.toLocaleDateString?.() || '', props.clients.find(c => c.id === s.clientId)?.nomeFantasia || '', String(s.valorTotal || 0), s.metodoPagamento, s.statusPagamento]); });
                      csv += '\n=== PRODUTOS ===\n' + csvRow(['Nome', 'Custo', 'Venda', 'Estoque']);
                      props.products.forEach(p => { csv += csvRow([p.nome, String(p.precoCusto || 0), String(p.precoVenda || 0), String(p.estoquePrincipal || 0)]); });
                      csv += '\n=== COMISSOES ===\n' + csvRow(['Vendedor', 'Valor', 'Status']);
                      props.commissions.forEach(c => { csv += csvRow([props.users.find(u => u.id === c.vendedorId)?.nome || '', String(c.valor || 0), c.status]); });
                      csv += '\n=== USUARIOS ===\n' + csvRow(['Nome', 'Telefone', 'Funcao']);
                      props.users.forEach(u => { csv += csvRow([u.nome, u.telefone || '', u.role]); });
                      filename = 'backup-completo.csv';
                    }
                    const BOM = '﻿';
                    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
                  }
                  showToast(`${item.label} exportado!`);
                }} className="bg-white/80 px-4 py-2.5 rounded-xl font-black text-[10px] uppercase active:scale-90 shadow-sm flex items-center gap-2"><i className="fa-solid fa-download"></i> Exportar</button>
              </div>
            ))}
          </div>

          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mx-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-xl flex items-center justify-center"><i className="fa-solid fa-clock-rotate-left text-gray-500"></i></div>
              <div>
                <p className="text-[10px] font-black text-gray-700 uppercase">Ultimo Backup</p>
                <p className="text-[9px] text-gray-400 font-bold">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-sm rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh]"><h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showUserModal === 'NEW' ? 'Novo Vendedor' : 'Editar Vendedor'}</h3><div className="flex flex-col items-center mb-6"><div onClick={() => userPhotoInputRef.current?.click()} className="w-24 h-24 bg-purple-100 text-purple-600 rounded-[2rem] flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-xl cursor-pointer relative group transition-all hover:scale-105">{userForm.foto ? <img src={userForm.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-camera text-2xl"></i>}</div><input type="file" ref={userPhotoInputRef} className="hidden" accept="image/*" onChange={handleUserPhotoUpload} /></div><div className="space-y-4"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome do Vendedor</label><input value={userForm.nome ?? ''} onChange={e => setUserForm({...userForm, nome: e.target.value})} placeholder="Nome Completo" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label><input value={userForm.telefone ?? ''} onChange={e => setUserForm({...userForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Placa do Veículo</label><input value={userForm.placaVeiculo ?? ''} onChange={e => setUserForm({...userForm, placaVeiculo: e.target.value})} placeholder="Ex: ABC-1234" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>{showUserModal !== 'NEW' && (<div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Rota Responsável</label><select value={userForm.rota || 'ROTA_01'} onChange={e => setUserForm({...userForm, rota: e.target.value})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{Array.from({ length: 50 }).map((_, i) => { const r = `ROTA_${String(i + 1).padStart(2, '0')}`; return <option key={r} value={r}>Rota {String(i + 1).padStart(2, '0')}</option>; })}</select></div>)}<div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">PIN de Acesso (6 dígitos)</label><input type="password" value={userForm.pin ?? ''} onChange={e => setUserForm({...userForm, pin: e.target.value})} placeholder="123456" maxLength={6} className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-center text-xl tracking-[0.5em]" /></div><button onClick={handleSaveUser} className="w-full bg-purple-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4 tracking-widest">Salvar Vendedor</button><button onClick={() => setShowUserModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"><div className="bg-white w-full max-md rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh]"><h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showClientModal === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3><div className="space-y-4"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Fantasia (Estabelecimento)</label><input value={clientForm.nomeFantasia || ''} onChange={e => setClientForm({...clientForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome do Cliente</label><input value={clientForm.nome || ''} onChange={e => setClientForm({...clientForm, nome: e.target.value})} placeholder="Nome real do cliente" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone</label><input value={clientForm.telefone || ''} onChange={e => setClientForm({...clientForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Endereço</label><input value={clientForm.endereco || ''} onChange={e => setClientForm({...clientForm, endereco: e.target.value})} placeholder="Endereço" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Bairro</label><input value={clientForm.bairro || ''} onChange={e => setClientForm({...clientForm, bairro: e.target.value})} placeholder="Bairro" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dia de Atendimento</label><select value={clientForm.diaRoteiro ?? 1} onChange={e => setClientForm({...clientForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{[1, 2, 3, 4, 5, 6].map(d => (<option key={d} value={d}>{DIAS_SEMANA[d]}</option>))}</select></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Rota</label><select value={clientForm.rota || availableRoutes[0] || 'ROTA_01'} onChange={e => setClientForm({...clientForm, rota: e.target.value})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{availableRoutes.length > 0 ? availableRoutes.map(r => (<option key={r} value={r}>{formatRouteName(r)}</option>)) : <option value="ROTA_01">Sem rotas disponíveis</option>}</select></div><button onClick={handlePinLocation} className="w-full bg-indigo-50 text-indigo-600 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 mb-2"><i className="fa-solid fa-location-dot"></i> Localização Atual</button><button onClick={handleSaveClient} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4 tracking-widest">Salvar Cliente</button><button onClick={() => setShowClientModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button></div></div></div>
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

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center">
            <h3 className="font-black text-gray-800 uppercase text-sm mb-2">Receber Pagamento</h3>
            <p className="text-xs text-gray-400 font-bold uppercase mb-1">{props.clients.find(c => c.id === showReceiveModal.clientId)?.nomeFantasia || 'Cliente'}</p>
            <p className="text-xl font-black text-gray-800 mb-4">R$ {showReceiveModal.valorTotal?.toFixed(2)}</p>
            <div className="space-y-4 text-left">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor a Receber R$</label>
                <input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} placeholder="0.00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-center" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => handleConfirmReceive('DINHEIRO')} className="bg-emerald-600 text-white py-3 rounded-xl font-black text-[9px] uppercase active:scale-95">Dinheiro</button>
                <button onClick={() => handleConfirmReceive('PIX')} className="bg-blue-600 text-white py-3 rounded-xl font-black text-[9px] uppercase active:scale-95">Pix</button>
                <button onClick={() => handleConfirmReceive('DEPOSITO')} className="bg-purple-600 text-white py-3 rounded-xl font-black text-[9px] uppercase active:scale-95">Deposito</button>
              </div>
              <button onClick={() => setShowReceiveModal(null)} className="w-full py-2 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
            </div>
          </div>
        </div>
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

      {/* MODAL: Comprovante de Pagamento (Admin) */}
      {comprovanteModalSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-end sm:items-center justify-center p-4" onClick={() => setComprovanteModalSale(null)}>
          <div className="bg-white w-full max-sm rounded-t-[2rem] sm:rounded-[2rem] overflow-hidden flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-5 flex items-center justify-between">
              <div>
                <h3 className="font-black text-white text-sm uppercase">Comprovante</h3>
                <p className="text-white/70 text-[9px] font-bold mt-1">{props.clients.find(c => c.id === comprovanteModalSale.clientId)?.nomeFantasia || 'Cliente'}</p>
              </div>
              <button onClick={() => setComprovanteModalSale(null)} className="text-white/70 active:scale-90"><i className="fa-solid fa-xmark text-lg"></i></button>
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

      {activeTab === 'SETTINGS' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Configuracoes</h2></div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
            <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-building text-blue-600 mr-2"></i>Dados da Empresa</h3>
            <div className="space-y-3">
              <div><label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Nome da Empresa</label><input value={props.companyName} onChange={e => props.setCompanyName(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-blue-100" /></div>
              <div><label className="text-[9px] font-black text-gray-400 uppercase block mb-1">CNPJ</label><input value={props.companyCnpj} onChange={e => props.setCompanyCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-blue-100" /></div>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
            <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-image text-purple-600 mr-2"></i>Logo e Marca</h3>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-gray-100 rounded-2xl overflow-hidden flex items-center justify-center border-2 border-dashed border-gray-200 flex-shrink-0">{props.logo ? <img src={props.logo} className="w-full h-full object-cover" /> : <i className="fa-solid fa-image text-gray-300 text-2xl"></i>}</div>
              <div className="flex-1 space-y-2">
                <button onClick={() => logoInputRef.current?.click()} className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase bg-blue-50 text-blue-600 active:scale-95 flex items-center justify-center gap-1.5 border border-blue-100"><i className="fa-solid fa-upload"></i>Enviar Logo</button>
                {props.logo && <button onClick={() => { setConfirmAction({ title: 'Remover Logo', message: 'Deseja remover a logo atual?', icon: 'fa-solid fa-trash-can', iconColor: 'text-rose-400', type: 'danger', onConfirm: () => { setConfirmAction(null); props.setLogo(null); } }); }} className="w-full py-2 rounded-xl text-[9px] font-black uppercase bg-rose-50 text-rose-500 active:scale-95 border border-rose-100">Remover</button>}
              </div>
            </div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
            <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-qrcode text-teal-600 mr-2"></i>Pix / QR Code</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-400 uppercase">Chave Pix 1</label>
                <input value={props.pix1Name} onChange={e => props.setPix1Name(e.target.value)} placeholder="Nome" className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-[11px] font-bold uppercase outline-none" />
                <button onClick={() => pix1InputRef.current?.click()} className="w-full py-2 rounded-xl text-[9px] font-black uppercase bg-teal-50 text-teal-600 active:scale-95 border border-teal-100 flex items-center justify-center gap-1"><i className="fa-solid fa-camera"></i>QR Code</button>
                {props.pix1Code && <div className="w-full h-16 bg-gray-50 rounded-xl overflow-hidden border border-gray-100"><img src={props.pix1Code} className="w-full h-full object-contain" /></div>}
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-400 uppercase">Chave Pix 2</label>
                <input value={props.pix2Name} onChange={e => props.setPix2Name(e.target.value)} placeholder="Nome" className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-[11px] font-bold uppercase outline-none" />
                <button onClick={() => pix2InputRef.current?.click()} className="w-full py-2 rounded-xl text-[9px] font-black uppercase bg-teal-50 text-teal-600 active:scale-95 border border-teal-100 flex items-center justify-center gap-1"><i className="fa-solid fa-camera"></i>QR Code</button>
                {props.pix2Code && <div className="w-full h-16 bg-gray-50 rounded-xl overflow-hidden border border-gray-100"><img src={props.pix2Code} className="w-full h-full object-contain" /></div>}
              </div>
            </div>
            <input ref={pix1InputRef} type="file" accept="image/*" className="hidden" onChange={e => handlePixUpload(e, 1)} />
            <input ref={pix2InputRef} type="file" accept="image/*" className="hidden" onChange={e => handlePixUpload(e, 2)} />
          </div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
            <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-percent text-amber-600 mr-2"></i>Margem de Lucro Global</h3>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-600 uppercase">Ativar margem automatica</span>
              <button onClick={() => props.setMargemGlobalAtiva(!props.margemGlobalAtiva)} className={`w-12 h-7 rounded-full relative transition-colors ${props.margemGlobalAtiva ? 'bg-blue-600' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-all shadow-sm ${props.margemGlobalAtiva ? 'left-5.5' : 'left-0.5'}`}></div></button>
            </div>
            {props.margemGlobalAtiva && (
              <div><label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Margem Padrao (%)</label><input type="number" value={props.margemGlobalValor} onChange={e => props.setMargemGlobalValor(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-100" /></div>
            )}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-3"><span className="text-[11px] font-bold text-gray-600 uppercase">Preco minimo obrigatorio</span><button onClick={() => props.setMargemMinimaAtiva(!props.margemMinimaAtiva)} className={`w-12 h-7 rounded-full relative transition-colors ${props.margemMinimaAtiva ? 'bg-amber-600' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-all shadow-sm ${props.margemMinimaAtiva ? 'left-5.5' : 'left-0.5'}`}></div></button></div>
              {props.margemMinimaAtiva && (<div><label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Margem Minima (%)</label><input type="number" value={props.margemMinima} onChange={e => props.setMargemMinima(parseFloat(e.target.value) || 0)} className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-100" /></div>)}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
            <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-lock text-rose-600 mr-2"></i>Alterar PIN de Vendedor</h3>
            <div className="grid grid-cols-2 gap-2">
              <select value={pwUser} onChange={e => setPwUser(e.target.value)} className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-[11px] font-bold uppercase outline-none">
                <option value="">Selecione...</option>
                {props.users.filter(u => u.role === 'VENDEDOR').map(u => (<option key={u.id} value={u.id}>{u.nome}</option>))}
              </select>
              <input value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Novo PIN" type="text" className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-[11px] font-bold outline-none focus:ring-2 focus:ring-rose-100" />
            </div>
            <button onClick={handleUpdatePassword} disabled={!pwUser || !pwNew} className={`w-full py-3 rounded-2xl text-[10px] font-black uppercase shadow-sm active:scale-95 ${pwUser && pwNew ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-300'}`}>Atualizar PIN</button>
          </div>
        </div>
      )}

            {confirmAction && (
        <ConfirmModal title={confirmAction.title} message={confirmAction.message} icon={confirmAction.icon} iconColor={confirmAction.iconColor} type={(confirmAction.type as any) || 'confirm'} onConfirm={confirmAction.onConfirm} onCancel={() => setConfirmAction(null)} />
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