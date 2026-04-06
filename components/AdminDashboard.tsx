import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CommissionPaymentLog, Expense } from '../types';
import { DIAS_SEMANA } from '../constants';
import Cupom from './Cupom';
import ClientHistory from './ClientHistory';
import { loadLocalState, saveLocalState } from '../utils/persistence';

interface AdminDashboardProps {
  products: Product[];
  users: User[];
  cargas: Carga[];
  clients: Client[];
  sales: Sale[];
  commissions: Commission[];
  payoutLogs: CommissionPaymentLog[];
  expenses: Expense[];
  addProduct: (n: string, c: number, v: number, com: number, estoque?: number) => void;
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
  payCommission: (vId: string, amount: number, type: 'TOTAL' | 'PARCIAL', adminId: string) => void;
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
}

type TabType = 'HOME' | 'CATALOGO' | 'VENDEDORES' | 'CARGAS' | 'CLIENTES' | 'HISTORY' | 'CAIXA' | 'ROTEIRO' | 'REPORTS' | 'CONTAS_RECEBER' | 'SETTINGS';

const AdminDashboard: React.FC<AdminDashboardProps> = (props) => {
  const [activeTab, setActiveTab] = useState<TabType>(() => loadLocalState('admin_activeTab', 'HOME'));
  const [selectedSale, setSelectedSale] = useState<Sale | null>(() => loadLocalState('admin_selectedSale', null));
  const [viewingClientHistory, setViewingClientHistory] = useState<Client | null>(null);

  useEffect(() => {
    saveLocalState('admin_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    saveLocalState('admin_selectedSale', selectedSale);
  }, [selectedSale]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state) {
        if (state.tab) setActiveTab(state.tab);
        setSelectedSale(state.sale || null);
      } else {
        setActiveTab('HOME');
        setSelectedSale(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    if (!window.history.state) {
      window.history.replaceState({ tab: activeTab, sale: selectedSale }, '');
    }
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const currentState = window.history.state;
    const isDifferent = !currentState || 
                        currentState.tab !== activeTab || 
                        currentState.sale?.id !== selectedSale?.id;
    
    if (isDifferent) {
      window.history.pushState({ tab: activeTab, sale: selectedSale }, '');
    }
  }, [activeTab, selectedSale]);

  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [localOrderedProductIds, setLocalOrderedProductIds] = useState<string[]>(props.orderedProductIds);

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

  useEffect(() => {
    const currentIds = props.products.map(p => p.id);
    const validOrder = props.orderedProductIds.filter(id => currentIds.includes(id));
    const newIds = currentIds.filter(id => !validOrder.includes(id));
    const finalOrder = [...validOrder, ...newIds];
    setLocalOrderedProductIds(finalOrder);
  }, [props.products, props.orderedProductIds]);


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

  const [confirmDelete, setConfirmDelete] = useState<{ id: string, type: 'PRODUCT' | 'CLIENT', name: string } | null>(null);

  const [pwUser, setPwUser] = useState<string>('');
  const [pwNew, setPwNew] = useState<string>('');

  const [pForm, setPForm] = useState({ nome: '', custo: '', venda: '', comissao: '', margem: '', ativo: true, estoquePrincipal: '' });
  const [clientForm, setClientForm] = useState<Partial<Client>>({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0 });
  const [userForm, setUserForm] = useState<Partial<User>>({ nome: '', foto: '', telefone: '', pin: '', placaVeiculo: '' });
  const [selectedVendedorId, setSelectedVendedorId] = useState('');
  const [stagingCarga, setStagingCarga] = useState<{ [pId: string]: number }>({});

  const logoInputRef = useRef<HTMLInputElement>(null);
  const pix1InputRef = useRef<HTMLInputElement>(null);
  const pix2InputRef = useRef<HTMLInputElement>(null);
  const userPhotoInputRef = useRef<HTMLInputElement>(null);

  const getClientAvgRevenue = (id: string) => {
    const cSales = props.sales.filter(s => s.clientId === id);
    if (cSales.length === 0) return "0.00";
    return (cSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0) / cSales.length).toFixed(2);
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
  }, [selectedVendedorId, props.cargas]);

  const hasCargaChanges = useMemo(() => {
    if (!selectedVendedorId) return false;
    const cargaAtualMap = props.cargas
      .filter(c => c.vendedorId === selectedVendedorId)
      .reduce((acc, curr) => ({ ...acc, [curr.produtoId]: curr.quantidade ?? 0 }), {} as { [id: string]: number }); 
    const allProdIds = new Set([...Object.keys(cargaAtualMap), ...Object.keys(stagingCarga)]);
    for (const pId of allProdIds) {
      if ((cargaAtualMap[pId] ?? 0) !== (stagingCarga[pId] ?? 0)) return true;
    }
    return false;
  }, [stagingCarga, props.cargas, selectedVendedorId]);

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

    const totalCommsEligible = sellerComms
      .filter(c => c.status !== 'A_RECEBER')
      .reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    
    const jaPago = sellerLogs.reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0);
    const totalDespesas = sellerExps.reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const disponivel = totalCommsEligible - jaPago - totalDespesas;
    const aReceber = sellerComms
      .filter(c => c.status === 'A_RECEBER')
      .reduce((acc, curr) => acc + (curr.valor ?? 0), 0);

    return {
      vendasHoje: Number(vSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), 
      comissaoDisponivel: Number(disponivel.toFixed(2)),
      comissaoAReceber: Number(aReceber.toFixed(2))
    };
  };

  const reportStats = useMemo(() => {
    const salesInPeriod = props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio));
    const totalVendas = salesInPeriod.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0);
    const paidCommissions = props.payoutLogs.filter(l => filterByPeriod(l.dataPagamento, periodoRelatorio)).reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0);
    const clientMap: { [id: string]: number } = {};
    salesInPeriod.forEach(s => { clientMap[s.clientId] = (clientMap[s.clientId] || 0) + (s.valorTotal || 0); });
    const topClients = Object.entries(clientMap).map(([id, total]) => ({ id, nome: props.clients.find(c => c.id === id)?.nomeFantasia || 'Cliente Desconhecido', total: Number(total.toFixed(2)) })).sort((a, b) => b.total - a.total).slice(0, 10);
    const prodMap: { [id: string]: number } = {};
    salesInPeriod.forEach(s => { s.itens.forEach(i => { prodMap[i.produtoId] = (prodMap[i.produtoId] || 0) + (i.quantidade || 0); }); });
    const topProducts = Object.entries(prodMap).map(([id, qtd]) => ({ id, nome: props.products.find(p => p.id === id)?.nome || 'Produto Desconhecido', qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 10);
    return { totalVendas: Number(totalVendas.toFixed(2)), totalComissaoPaga: Number(paidCommissions.toFixed(2)), topClients, topProducts };
  }, [props.sales, props.payoutLogs, props.clients, props.products, periodoRelatorio]);

  const handleOpenPayout = (v: User) => {
    setPayoutVendedor(v);
    setPayoutType('TOTAL');
    setPartialAmount('');
  };

  const handleConfirmPayout = () => {
    if (!payoutVendedor) return;
    const stats = getVendedorStats(payoutVendedor.id);
    const amount = payoutType === 'TOTAL' ? stats.comissaoDisponivel : parseFloat(partialAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast("Valor inválido", "error");
      return;
    }
    props.payCommission(payoutVendedor.id, amount, payoutType, props.adminUser.id);
    setPayoutVendedor(null);
    showToast("Pagamento registrado!");
  };

  const handleSync = () => {
    if (!selectedVendedorId) return;
    const itens = Object.entries(stagingCarga).map(([produtoId, quantidade]) => ({ produtoId, quantidade: quantidade ?? 0 })); 
    props.syncVendedorCarga(selectedVendedorId, itens);
    setShowConfirmSync(false);
  };

  const handleApply = () => {
    if (!selectedVendedorId) return;
    const itens = Object.entries(stagingCarga).map(([produtoId, quantidade]) => ({ produtoId, quantidade: quantidade ?? 0 })); 
    props.applyCargaDirectly(selectedVendedorId, itens);
    setShowConfirmApply(false);
  };

  const moveProduct = (id: string, dir: 'UP' | 'DOWN') => {
    const idx = localOrderedProductIds.indexOf(id);
    const newOrder = [...localOrderedProductIds];
    if (dir === 'UP' && idx > 0) [newOrder[idx], newOrder[idx-1]] = [newOrder[idx-1], newOrder[idx]];
    else if (dir === 'DOWN' && idx < newOrder.length - 1) [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]];
    setLocalOrderedProductIds(newOrder);
    props.setOrderedProductIds(newOrder); 
  };

  const moveClient = async (id: string, direction: 'UP' | 'DOWN', day: number) => {
    const clientsInDay = props.clients.filter(c => c.diaRoteiro === day && c.ativo).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const currentIndex = clientsInDay.findIndex(c => c.id === id);
    if (currentIndex === -1) return;
    let targetIndex = -1;
    if (direction === 'UP' && currentIndex > 0) targetIndex = currentIndex - 1;
    if (direction === 'DOWN' && currentIndex < clientsInDay.length - 1) targetIndex = currentIndex + 1;
    if (targetIndex !== -1) {
      const currentClient = clientsInDay[currentIndex];
      const targetClient = clientsInDay[targetIndex];
      const oldOrdem = currentClient.ordem || 0;
      const newOrdem = targetClient.ordem || 0;
      const finalTargetOrdem = oldOrdem === newOrdem ? (direction === 'UP' ? newOrdem - 1 : newOrdem + 1) : newOrdem;
      props.updateClient(currentClient.id, { ordem: finalTargetOrdem });
      props.updateClient(targetClient.id, { ordem: oldOrdem });
      showToast("Ordem atualizada!");
    }
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
    if (p === 'NEW') {
      setPForm({ nome: '', custo: '0.00', venda: props.margemGlobalAtiva ? updatePriceFromMargin(0, props.margemGlobalValor).toFixed(2) : '0.00', comissao: '0.00', margem: props.margemGlobalAtiva ? props.margemGlobalValor.toFixed(2) : '0.00', ativo: true, estoquePrincipal: '0' });
    } else {
      const precoVenda = Number(p.precoVenda) || 0;
      const precoCusto = Number(p.precoCusto) || 0;
      const margemCalculada = updateMarginFromPrice(precoCusto, precoVenda);
      setPForm({ nome: p.nome ?? '', custo: precoCusto.toFixed(2), venda: precoVenda.toFixed(2), comissao: (p.comissaoPercentual ?? 0).toFixed(2), margem: margemCalculada.toFixed(2), ativo: p.ativo ?? true, estoquePrincipal: (p.estoquePrincipal ?? 0).toString() });
    }
    setShowProductModal(p);
  };

  const handleSaveProduct = () => {
    if (!pForm.nome || pForm.custo === '' || pForm.venda === '' || pForm.comissao === '') { showToast("Preencha todos os campos obrigatórios.", 'error'); return; }
    const data: Partial<Product> = { nome: pForm.nome, precoCusto: parseFloat(pForm.custo), precoVenda: parseFloat(pForm.venda), comissaoPercentual: parseFloat(pForm.comissao), ativo: pForm.ativo ?? true, estoquePrincipal: parseInt(pForm.estoquePrincipal) || 0 };
    if (showProductModal === 'NEW') props.addProduct(data.nome!, data.precoCusto!, data.precoVenda!, data.comissaoPercentual!, data.estoquePrincipal);
    else if (typeof showProductModal === 'object') props.updateProduct(showProductModal.id, data);
    setShowProductModal(null);
    showToast("Produto salvo!");
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'PRODUCT') props.deleteProduct(confirmDelete.id);
    else if (confirmDelete.type === 'CLIENT') props.deleteClient(confirmDelete.id);
    setConfirmDelete(null);
    showToast(confirmDelete.type === 'PRODUCT' ? "Produto removido" : "Cliente removido");
  };

  const handleOpenClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setClientForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0 });
    else setClientForm({ ...c });
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
              
              setClientForm(prev => ({ 
                ...prev, 
                endereco: fullAddr || prev.endereco,
                bairro: bairro || prev.bairro
              }));
              showToast("Localização e endereço capturados!");
            } else {
              showToast("Coordenadas capturadas!");
            }
          } catch (error) {
            showToast("Coordenadas capturadas, erro ao obter endereço.", "error");
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
    } else {
      showToast("GPS não suportado neste navegador.", "error");
    }
  };

  const handleSaveClient = () => {
    if (!clientForm.nomeFantasia || !clientForm.telefone || !clientForm.endereco || !clientForm.bairro) { showToast("Preencha Nome Fantasia, Telefone, Endereço e Bairro.", 'error'); return; }
    const clientPayload: Omit<Client, 'id'> = { nomeFantasia: clientForm.nomeFantasia, telefone: clientForm.telefone, endereco: clientForm.endereco, bairro: clientForm.bairro, diaRoteiro: clientForm.diaRoteiro ?? 1, ativo: clientForm.ativo ?? true, ativarCnpj: clientForm.ativarCnpj ?? false, cnpj: clientForm.cnpj, pinLocalizacao: clientForm.pinLocalizacao, ordem: clientForm.ordem ?? 0, nome: clientForm.nome, observacoes: clientForm.observacoes };
    if (showClientModal === 'NEW') props.addClient(clientPayload);
    else if (typeof showClientModal === 'object') props.updateClient(showClientModal.id, clientPayload);
    setShowClientModal(null);
    showToast("Cliente salvo!");
  };

  const handleOpenUserModal = (u: User | 'NEW') => {
    if (u === 'NEW') setUserForm({ nome: '', telefone: '', foto: '', pin: '123456', placaVeiculo: '' });
    else setUserForm({ nome: u.nome ?? '', telefone: u.telefone ?? '', foto: u.foto ?? '', pin: u.pin ?? '', placaVeiculo: u.placaVeiculo ?? '' }); 
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
    showToast("Senha atualizada!");
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

  const contasAReceber = useMemo(() => props.sales.filter(s => s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [props.sales]);

  const MenuCard = ({ icon, title, tab, color }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 active:scale-95 transition-all text-center group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700 tracking-tight">{title}</span>
    </button>
  );

  const filteredProducts = useMemo(() => {
    const filtered = props.products.filter(p => (p.nome ?? '').toLowerCase().includes(search.toLowerCase()));
    if (search) return filtered;
    const productMap = new Map(filtered.map(p => [p.id, p]));
    return localOrderedProductIds.map(id => productMap.get(id)).filter((p): p is Product => !!p);
  }, [props.products, localOrderedProductIds, search]);

  const filteredHistory = useMemo(() => {
    return props.sales.filter(s => filterByPeriod(s.data, filtroPeriodo)).sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)); 
  }, [props.sales, filtroPeriodo]);

  return (
    <div className="space-y-6 pb-10">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center animate-in slide-in-from-top duration-300 pointer-events-none">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3`}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>{toast.message}
          </div>
        </div>
      )}

      {activeTab !== 'HOME' && <button onClick={() => setActiveTab('HOME')} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2 active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="space-y-6 py-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Painel Administrativo</h2>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Gestão e Controle Total</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <MenuCard icon="fa-boxes-stacked" title="Estoque" tab="CATALOGO" color="bg-blue-50 text-blue-600" />
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

      {activeTab === 'HISTORY' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Vendas Realizadas</h2></div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">{(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (<button key={p} onClick={() => setFiltroPeriodo(p)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${filtroPeriodo === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>))}</div>
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

      {activeTab === 'CARGAS' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Cargas</h2></div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="font-black text-gray-800 mb-4 uppercase text-[10px]">Vendedor Responsável</h3>
            <select value={selectedVendedorId} onChange={e => setSelectedVendedorId(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-semibold text-sm">
              <option value="">Selecione um vendedor...</option>
              {props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)} 
            </select>
          </div>
          {selectedVendedorId && (
            <div className="pb-40">
              <div className="grid gap-1.5 px-1">
                {props.products.map(p => { 
                  const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === p.id)?.quantidade ?? 0; 
                  return (
                    <div key={p.id} className="bg-white px-3 py-2 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                      <div className="flex-1 min-w-0 pr-3">
                        <h4 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h4> 
                        <p className="text-[9px] text-gray-400 font-semibold mt-0.5">C: {(p.estoquePrincipal ?? 0)} | V: {noV}</p> 
                      </div>
                      <div className="flex items-center bg-gray-50 rounded-xl p-1 gap-1 flex-shrink-0">
                        <button onClick={() => updateStaging(p.id, -1)} className="w-8 h-8 bg-white border border-gray-200 text-gray-400 rounded-lg active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus text-[10px]"></i></button>
                        <input 
                          type="number"
                          inputMode="numeric"
                          value={stagingCarga[p.id] === undefined ? '' : stagingCarga[p.id]}
                          onChange={(e) => handleStagingInputChange(p.id, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-10 bg-transparent text-center font-black text-xs outline-none border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button onClick={() => updateStaging(p.id, 1)} className="w-8 h-8 bg-blue-600 text-white rounded-lg active:scale-90 shadow-sm flex items-center justify-center"><i className="fa-solid fa-plus text-[10px]"></i></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {selectedVendedorId && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] z-50 max-w-lg mx-auto safe-bottom">
              <div className="flex flex-row gap-2">
                <button onClick={() => setShowConfirmApply(true)} disabled={!hasCargaChanges} className={`flex-1 font-black py-4 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1 transition-all text-[9px] uppercase tracking-tighter ${hasCargaChanges ? 'bg-emerald-600 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><i className="fa-solid fa-check-circle text-sm"></i> Aplicar Agora</button>
                <button onClick={() => setShowConfirmSync(true)} disabled={!hasCargaChanges} className={`flex-1 font-black py-4 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1 transition-all text-[9px] uppercase tracking-tighter ${hasCargaChanges ? 'bg-gray-900 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><i className="fa-solid fa-truck-loading text-sm"></i> Enviar Pendente</button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Clientes</h2></div>
          <div className="flex gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm" />
            <button onClick={() => handleOpenClient('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-user-plus"></i></button>
          </div>
          <div className="grid gap-2 px-1">
            {props.clients.filter(c => c.nomeFantasia.toLowerCase().includes(search.toLowerCase())).sort((a,b) => (a.nomeFantasia||'').toLowerCase().localeCompare((b.nomeFantasia||'').toLowerCase())).map(c => ( 
              <div key={c.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between transition-all hover:border-blue-200">
                <div className="flex-1 min-w-0 pr-2 cursor-pointer" onClick={() => setViewingClientHistory(c)}>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{c.nomeFantasia}</h3>
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
                  <div className="flex items-center gap-3 mt-1.5"><p className="text-[10px] text-gray-400 font-black uppercase truncate">{DIAS_SEMANA[c.diaRoteiro]}</p><div className="flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 shadow-inner whitespace-nowrap"><i className="fa-solid fa-chart-line text-blue-400 text-[10px]"></i><span className="text-[11px] font-black text-blue-600">R$ {getClientAvgRevenue(c.id)}</span></div></div>
                </div>
                <div className="flex gap-2"><button onClick={(e) => { e.stopPropagation(); handleOpenClient(c); }} className="bg-blue-50 text-blue-600 w-9 h-9 rounded-lg border border-blue-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-pencil-alt text-sm"></i></button><button onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: c.id, type: 'CLIENT', name: c.nomeFantasia }); }} className="bg-rose-50 text-rose-600 w-9 h-9 rounded-lg border border-rose-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-trash-can text-sm"></i></button></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'CAIXA' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Caixa</h2></div>
          <div className="grid gap-4 px-1">
            {props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(v => { 
              const stats = getVendedorStats(v.id);
              return (
                <div key={v.id} className="bg-white rounded-[2.5rem] shadow-xl border-t-4 border-blue-500 p-8 flex flex-col gap-6">
                  <div className="flex items-center gap-4"><div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-md">{v.foto ? <img src={v.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user text-2xl"></i>}</div><div><h3 className="font-black text-gray-800 text-lg leading-none mb-1 uppercase truncate max-w-[150px]">{v.nome}</h3><p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Performance Hoje</p></div></div>
                  <div className="space-y-4"><div className="grid grid-cols-2 gap-4"><div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 flex flex-col items-center"><p className="text-[9px] text-gray-400 font-black uppercase mb-2 text-center leading-none">Vendas Hoje</p><p className="text-lg font-black text-gray-800">R$ {stats.vendasHoje.toFixed(2)}</p></div><div className={`${stats.comissaoDisponivel < 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'} p-5 rounded-[2rem] border flex flex-col items-center`}><p className={`text-[9px] ${stats.comissaoDisponivel < 0 ? 'text-rose-600' : 'text-emerald-600'} font-black uppercase mb-2 text-center leading-none`}>Disponível</p><p className={`text-lg font-black ${stats.comissaoDisponivel < 0 ? 'text-rose-700' : 'text-gray-800'}`}>R$ {stats.comissaoDisponivel.toFixed(2)}</p></div></div><div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 flex justify-between items-center"><span className="text-[9px] font-black text-orange-600 uppercase">Comissão a Receber (Prazo)</span><span className="text-sm font-black text-orange-700">R$ {stats.comissaoAReceber.toFixed(2)}</span></div></div>
                  <button onClick={() => handleOpenPayout(v)} className="w-full bg-emerald-600 text-white py-5 rounded-3xl font-black text-xs uppercase shadow-xl active:scale-95 transition-all tracking-widest">Pagar Comissão</button>
                </div>
              );
            })}
          </div>
          <div className="space-y-4 pt-6">
             <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider px-2">Histórico de Repasses (Log)</h3>
             <div className="grid gap-3 px-1">
                {props.payoutLogs.sort((a, b) => b.dataPagamento.getTime() - a.dataPagamento.getTime()).map(log => (
                  <div key={log.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex justify-between items-center">
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{log.vendedorNome}</p>
                      <p className="text-[9px] text-gray-400 font-semibold uppercase mt-0.5">{log.dataPagamento.toLocaleDateString()} {log.dataPagamento.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} • {log.tipo}</p>
                    </div>
                    <p className="text-xs font-black text-emerald-600 whitespace-nowrap">R$ {log.valorPago.toFixed(2)}</p>
                  </div>
                ))}
                {props.payoutLogs.length === 0 && <div className="text-center py-10 opacity-30 italic text-[10px] uppercase font-bold">Nenhum pagamento registrado.</div>}
             </div>
          </div>
        </div>
      )}

      {activeTab === 'VENDEDORES' && (
        <div className="space-y-4">
          <div className="px-2 flex justify-between items-center"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Vendedores</h2><button onClick={() => handleOpenUserModal('NEW')} className="bg-purple-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-md active:scale-95"><i className="fa-solid fa-plus mr-2"></i>Novo</button></div>
          <div className="grid gap-3 px-1">
            {props.users.filter(u => u.role === 'VENDEDOR').map(u => (
              <div key={u.id} className={`bg-white p-4 rounded-3xl border transition-all shadow-sm flex items-center justify-between ${!u.ativo ? 'opacity-60 grayscale' : 'border-gray-100'}`}> 
                <div onClick={() => handleOpenUserModal(u)} className="flex items-center gap-4 flex-1 cursor-pointer min-w-0 pr-2">
                  <div className="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-md flex-shrink-0">{(u.foto) ? <img src={u.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user-tie text-xl"></i>}</div>
                  <div className="min-w-0"><p className="font-bold text-gray-800 text-sm leading-tight uppercase truncate">{u.nome}</p><p className="text-[10px] text-gray-400 font-bold mt-1 uppercase truncate">{u.telefone || 'Sem telefone'}</p></div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); props.updateUser(u.id, { ativo: !u.ativo }); }} className={`w-12 h-6 rounded-full flex-shrink-0 relative transition-colors ${u.ativo ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${u.ativo ? 'left-7' : 'left-1'}`}></div></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'CATALOGO' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Estoque Central</h2></div>
          <div className="flex gap-2"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium" /><button onClick={() => handleOpenProduct('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-plus"></i></button></div>
          <div className="grid gap-3 px-1">
            {filteredProducts.map(p => ( 
              <div key={p.id} className="bg-white px-4 py-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between transition-all hover:border-blue-200 group">
                <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => handleOpenProduct(p)}>
                  {!search && (
                    <div className="flex flex-col gap-1 pr-2 border-r border-gray-50">
                      <button onClick={(e) => { e.stopPropagation(); moveProduct(p.id, 'UP'); }} className="text-gray-300 hover:text-blue-500 active:scale-125 transition-all"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                      <button onClick={(e) => { e.stopPropagation(); moveProduct(p.id, 'DOWN'); }} className="text-gray-300 hover:text-blue-500 active:scale-125 transition-all"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-800 text-[13px] leading-tight line-clamp-2 uppercase">{p.nome}</h3> 
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5"><span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100 shadow-inner whitespace-nowrap">{(p.estoquePrincipal ?? 0)} UN</span><span className="text-[13px] font-black text-emerald-600">R$ {(p.precoVenda ?? 0).toFixed(2)}</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); setShowEntryModal(p); setEntryForm({ qtd: '', custo: (p.precoCusto ?? 0).toString() }); }} className="bg-emerald-600 text-white w-9 h-9 rounded-lg flex items-center justify-center shadow-md active:scale-90 transition-all"><i className="fa-solid fa-plus-circle text-base"></i></button>
                  <button onClick={(e) => { e.stopPropagation(); handleOpenProduct(p); }} className="bg-blue-50 text-blue-600 w-9 h-9 rounded-lg border border-blue-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-pencil-alt text-base"></i></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Roteiro Semanal</h2></div>
          <div className="space-y-3 px-1">
            {[1, 2, 3, 4, 5, 6].map(dia => {
              const isOpen = expandedDay === dia;
              const clientsInDay = props.clients.filter(c => (c.diaRoteiro ?? 0) === dia && (c.ativo ?? false)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); 
              return (
                <div key={dia} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                  <button onClick={() => setExpandedDay(isOpen ? null : dia)} className={`w-full flex items-center justify-between p-5 text-left transition-colors ${isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-700'}`}>
                    <div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${isOpen ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{dia}</div><span className="font-black uppercase text-xs tracking-tight">{DIAS_SEMANA[dia] ?? 'N/D'}</span></div>
                    <div className="flex items-center gap-2"><span className="text-[9px] font-black uppercase opacity-40">{clientsInDay.length} clientes</span><i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`}></i></div>
                  </button>
                  {isOpen && (
                    <div className="p-4 bg-white space-y-2 border-t border-indigo-50 animate-in slide-in-from-top duration-300">
                      {clientsInDay.map(c => (
                        <div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center group cursor-pointer" onClick={() => setViewingClientHistory(c)}>
                          <div className="flex items-center gap-3">
                             <div className="flex flex-col gap-1">
                                <button onClick={(e) => { e.stopPropagation(); moveClient(c.id, 'UP', dia); }} className="text-gray-300 hover:text-indigo-600 active:scale-125 transition-all"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                                <button onClick={(e) => { e.stopPropagation(); moveClient(c.id, 'DOWN', dia); }} className="text-gray-300 hover:text-indigo-600 active:scale-125 transition-all"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                             </div>
                             <div><p className="font-bold text-gray-800 text-xs">{c.nomeFantasia ?? 'Cliente'}</p><p className="text-[9px] text-gray-400 font-bold mt-0.5">{c.telefone || 'Sem fone'} {c.bairro ? `• ${c.bairro}` : ''}</p></div>
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

      {activeTab === 'REPORTS' && (
        <div className="space-y-6 py-4 px-1">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Relatórios</h2></div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">{(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (<button key={p} onClick={() => setPeriodoRelatorio(p)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${periodoRelatorio === p ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>))}</div>
          <div className="grid grid-cols-2 gap-4">
             <div className="bg-white p-6 rounded-[2rem] shadow-sm border-b-4 border-emerald-500"><p className="text-[10px] font-black text-gray-400 uppercase mb-2">Vendas Totais</p><p className="text-xl font-black text-gray-800">R$ {reportStats.totalVendas.toFixed(2)}</p></div>
             <div className="bg-white p-6 rounded-[2rem] shadow-sm border-b-4 border-blue-500"><p className="text-[10px] font-black text-gray-400 uppercase mb-2">Comissão Paga</p><p className="text-xl font-black text-xl font-black text-gray-800">R$ {reportStats.totalComissaoPaga.toFixed(2)}</p></div>
          </div>
          <div className="space-y-6 pt-4">
            <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2"><i className="fa-solid fa-crown text-yellow-500"></i> Top 10 Produtos (Qtd)</h3>
              <div className="space-y-4">
                {reportStats.topProducts.map((p, idx) => (
                  <div key={p.id} className="flex justify-between items-center pb-3 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${idx < 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-400'}`}>{idx + 1}</span>
                      <span className="text-xs font-bold text-gray-700 uppercase truncate max-w-[180px]">{p.nome}</span>
                    </div>
                    <span className="text-xs font-black text-blue-600">{p.qtd} UN</span>
                  </div>
                ))}
                {reportStats.topProducts.length === 0 && <p className="text-center py-4 text-[10px] font-bold text-gray-300 uppercase italic">Nenhum dado no período</p>}
              </div>
            </div>
            <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2"><i className="fa-solid fa-star text-orange-500"></i> Top 10 Clientes (Ticket)</h3>
              <div className="space-y-4">
                {reportStats.topClients.map((c, idx) => (
                  <div key={c.id} className="flex justify-between items-center pb-3 border-b border-gray-50 last:border-0 cursor-pointer" onClick={() => setViewingClientHistory(props.clients.find(cli => cli.id === c.id)!)}>
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${idx < 3 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-400'}`}>{idx + 1}</span>
                      <span className="text-xs font-bold text-gray-700 uppercase truncate max-w-[180px]">{c.nome}</span>
                    </div>
                    <span className="text-xs font-black text-emerald-600">R$ {c.total.toFixed(2)}</span>
                  </div>
                ))}
                {reportStats.topClients.length === 0 && <p className="text-center py-4 text-[10px] font-bold text-gray-300 uppercase italic">Nenhum dado no período</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'CONTAS_RECEBER' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Contas a Receber</h2></div>
          <div className="grid gap-3 px-1">
            {contasAReceber.map(s => {
              const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2)); 
              const today = new Date();
              today.setHours(0,0,0,0);
              const dueDate = s.dataVencimento ? new Date(s.dataVencimento) : null;
              if (dueDate) dueDate.setHours(0,0,0,0);
              const isOverdue = dueDate ? dueDate <= today : false;
              return (
              <div key={s.id} className={`p-5 rounded-3xl border shadow-sm transition-all ${isOverdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100'}`}>
                <div className="flex justify-between items-start mb-2">
                   <div className="flex flex-col">
                      <span className={`text-[10px] font-black uppercase ${isOverdue ? 'text-rose-600' : 'text-gray-400'}`}>Vencimento</span>
                      <span className={`text-xs font-black ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>{s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</span>
                   </div>
                   <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${isOverdue ? 'bg-rose-600 text-white animate-pulse' : 'bg-orange-50 text-orange-600'}`}>{isOverdue ? 'VENCIDO / HOJE' : 'EM ABERTO'}</span>
                </div>
                <div className="flex justify-between items-end">
                   <div className="cursor-pointer" onClick={() => setViewingClientHistory(props.clients.find(c => c.id === s.clientId)!)}>
                     <h4 className={`font-bold text-sm leading-tight ${isOverdue ? 'text-rose-900' : 'text-gray-800'}`}>{props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4>
                     <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vend: {props.users.find(u => u.id === s.vendedorId)?.nome ?? 'Desc.'}</p> 
                     {(s.valorPago ?? 0) > 0 && <p className="text-[9px] text-emerald-600 font-bold uppercase mt-1">Já pago: R$ {(s.valorPago ?? 0).toFixed(2)}</p>} 
                   </div>
                   <div className="text-right">
                     <p className={`text-sm font-black mb-2 ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>Saldo: R$ {saldo.toFixed(2)}</p>
                     <button onClick={() => { setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 ${isOverdue ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>RECEBER</button>
                   </div>
                </div>
              </div>
            )})}
            {contasAReceber.length === 0 && <div className="text-center py-20 opacity-20 italic font-black uppercase tracking-widest">Nenhuma conta pendente</div>}
          </div>
        </div>
      )}

      {activeTab === 'SETTINGS' && (
        <div className="space-y-6 py-4 px-2 pb-20">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Configurações</h2></div>
          
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Dados da Empresa</h3>
             <div className="space-y-4">
                <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Fantasia / Razão Social</label>
                    <input value={props.companyName} onChange={e => props.setCompanyName(e.target.value)} placeholder="Ex: Doce Mania Ltda" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-sm uppercase" />
                </div>
                <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase ml-1">CNPJ</label>
                    <input value={props.companyCnpj} onChange={e => props.setCompanyCnpj(e.target.value)} placeholder="00.000.000/0001-00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-sm" />
                </div>
             </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col items-center">
            <h3 className="font-black text-gray-800 uppercase text-xs mb-6 text-center">Logotipo da Empresa</h3>
            <div onClick={() => logoInputRef.current?.click()} className="w-48 h-24 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer relative group overflow-hidden">
               {props.logo ? <img src={props.logo} alt="Logo" className="w-full h-full object-contain" /> : <div className="text-gray-300 flex flex-col items-center gap-1"><i className="fa-solid fa-cloud-arrow-up text-2xl"></i><span className="text-[9px] font-black">Upload</span></div>}
            </div>
            <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
          </div>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Regras de Margem</h3>
             <div className="space-y-4">
                <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <label className="text-sm font-bold text-gray-700 uppercase">Margem Global Ativa</label>
                    <button onClick={() => props.setMargemGlobalAtiva(!props.margemGlobalAtiva)} className={`w-12 h-6 rounded-full relative transition-colors ${props.margemGlobalAtiva ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemGlobalAtiva ? 'left-7' : 'left-1'}`}></div></button>
                </div>
                <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor Margem Global (%)</label>
                    <input type="number" value={props.margemGlobalValor} onChange={e => props.setMargemGlobalValor(parseFloat(e.target.value) || 0)} placeholder="35" className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-lg" />
                </div>
                <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <label className="text-sm font-bold text-gray-700 uppercase">Margem Mínima Ativa</label>
                    <button onClick={() => props.setMargemMinimaAtiva(!props.margemMinimaAtiva)} className={`w-12 h-6 rounded-full relative transition-colors ${props.margemMinimaAtiva ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemMinimaAtiva ? 'left-7' : 'left-1'}`}></div></button>
                </div>
                <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor Margem Mínima (%)</label>
                    <input type="number" value={props.margemMinima} onChange={e => props.setMargemMinima(parseFloat(e.target.value) || 0)} placeholder="20" className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-lg" />
                </div>
             </div>
          </div>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Configurações PIX</h3>
             <div className="space-y-6">
                <div className="space-y-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-center">
                    <div className="space-y-1 mb-4 text-left">
                        <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome PIX 1</label>
                        <input value={props.pix1Name ?? ''} onChange={e => props.setPix1Name(e.target.value)} placeholder="Nome do Banco/Chave" className="w-full p-3 bg-white border rounded-xl font-bold text-sm" />
                    </div>
                    <div className="w-32 h-32 mx-auto bg-white rounded-xl border border-blue-100 mb-3 flex items-center justify-center overflow-hidden">
                      {props.pix1Code ? <img src={props.pix1Code} alt="Pix 1" className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-blue-100 text-3xl"></i>}
                    </div>
                    <button onClick={() => pix1InputRef.current?.click()} className="w-full bg-blue-600 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 shadow-md active:scale-95"><i className="fa-solid fa-camera"></i> Subir QR Code 1</button>
                    <input type="file" ref={pix1InputRef} onChange={(e) => handlePixUpload(e, 1)} accept="image/*" className="hidden" />
                </div>
                <div className="space-y-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-center">
                    <div className="space-y-1 mb-4 text-left">
                        <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome PIX 2</label>
                        <input value={props.pix2Name ?? ''} onChange={e => props.setPix2Name(e.target.value)} placeholder="Nome do Banco/Chave" className="w-full p-3 bg-white border rounded-xl font-bold text-sm" />
                    </div>
                    <div className="w-32 h-32 mx-auto bg-white rounded-xl border border-blue-100 mb-3 flex items-center justify-center overflow-hidden">
                      {props.pix2Code ? <img src={props.pix2Code} alt="Pix 2" className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-blue-100 text-3xl"></i>}
                    </div>
                    <button onClick={() => pix2InputRef.current?.click()} className="w-full bg-blue-600 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 shadow-md active:scale-95"><i className="fa-solid fa-camera"></i> Subir QR Code 2</button>
                    <input type="file" ref={pix2InputRef} onChange={(e) => handlePixUpload(e, 2)} accept="image/*" className="hidden" />
                </div>
             </div>
          </div>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Segurança</h3>
             <div className="space-y-4">
                <select value={pwUser} onChange={e => setPwUser(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none text-xs"><option value="">Selecione Usuário...</option>{props.users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
                <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Novo PIN" className="w-full p-4 bg-gray-50 rounded-2xl font-black text-xl tracking-widest border-none outline-none" />
                <button onClick={handleUpdatePassword} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 transition-all">Atualizar PIN</button>
             </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-gray-800 text-lg mb-4">Confirmar Exclusão</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium uppercase">Excluir {confirmDelete.type === 'PRODUCT' ? 'Produto' : 'Cliente'}: <br/><span className="text-gray-800 font-black">{confirmDelete.name}</span>?</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleConfirmDelete} className="w-full bg-rose-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Excluir</button>
              <button onClick={() => setConfirmDelete(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showConfirmSync && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-gray-800 text-lg mb-6">Enviar Carga Pendente?</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium">O vendedor precisará aceitar esta carga para que ela seja aplicada ao estoque dele.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleSync} className="w-full bg-gray-900 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Enviar Pendente</button>
              <button onClick={() => setShowConfirmSync(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showConfirmApply && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-gray-800 text-lg mb-6 tracking-tight">Aplicar Imediatamente?</h3>
            <p className="text-sm text-gray-500 mb-6 font-medium">Esta ação atualizará o estoque do vendedor agora mesmo, sem necessidade de aceite.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleApply} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 uppercase text-xs tracking-widest">Sim, Aplicar Agora</button>
              <button onClick={() => setShowConfirmApply(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {payoutVendedor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Pagar Comissão</h3>
              <div className="bg-emerald-50 p-4 rounded-2xl mb-6"><p className="text-[10px] font-black text-emerald-600 uppercase mb-1">Disponível</p><p className="text-xl font-black text-emerald-700">R$ {getVendedorStats(payoutVendedor.id).comissaoDisponivel.toFixed(2)}</p></div>
              <div className="flex bg-gray-100 p-1 rounded-xl mb-6"><button onClick={() => setPayoutType('TOTAL')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${payoutType === 'TOTAL' ? 'bg-white shadow-sm' : 'text-gray-400'}`}>Total</button><button onClick={() => setPayoutType('PARCIAL')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${payoutType === 'PARCIAL' ? 'bg-white shadow-sm' : 'text-gray-400'}`}>Parcial</button></div>
              {payoutType === 'PARCIAL' && <input type="number" placeholder="Valor" className="w-full p-4 bg-gray-50 border rounded-2xl font-black mb-6 text-center" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} />}
              <button onClick={handleConfirmPayout} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 mb-2">Confirmar Pagamento</button>
              <button onClick={() => setPayoutVendedor(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Confirmar Recebimento</h3>
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
                <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest active:scale-95">Dinheiro</button>
                <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest active:scale-95">PIX</button>
              </div>
              <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[90vh]">
              <h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showUserModal === 'NEW' ? 'Novo Vendedor' : 'Editar Vendedor'}</h3>
              <div className="flex flex-col items-center mb-6"><div onClick={() => userPhotoInputRef.current?.click()} className="w-24 h-24 bg-purple-100 text-purple-600 rounded-[2rem] flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-xl cursor-pointer relative group transition-all hover:scale-105">{userForm.foto ? <img src={userForm.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-camera text-2xl"></i>}</div><input type="file" ref={userPhotoInputRef} onChange={handleUserPhotoUpload} className="hidden" accept="image/*" /></div>
              <div className="space-y-4">
                 <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome do Vendedor</label><input value={userForm.nome ?? ''} onChange={e => setUserForm({...userForm, nome: e.target.value})} placeholder="Nome Completo" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>
                 <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label><input value={userForm.telefone ?? ''} onChange={e => setUserForm({...userForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div>
                 <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Placa do Veículo</label><input value={userForm.placaVeiculo ?? ''} onChange={e => setUserForm({...userForm, placaVeiculo: e.target.value})} placeholder="Ex: ABC-1234" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>
                 <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">PIN de Acesso (6 dígitos)</label><input type="password" value={userForm.pin ?? ''} onChange={e => setUserForm({...userForm, pin: e.target.value})} placeholder="123456" maxLength={6} className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-center text-xl tracking-[0.5em]" /></div>
                 <button onClick={handleSaveUser} className="w-full bg-purple-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4 tracking-widest">Salvar Vendedor</button>
                 <button onClick={() => setShowUserModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button>
              </div>
           </div>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center">
          <div className="bg-white w-full max-w-md rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[92vh] flex flex-col">
            <div className="p-6 pb-2 flex justify-between items-center border-b border-gray-50"><h3 className="font-black text-gray-800 uppercase text-sm tracking-tight">{showProductModal === 'NEW' ? 'Cadastrar Novo Produto' : 'Editar Informações'}</h3><button onClick={() => setShowProductModal(null)} className="w-8 h-8 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center"><i className="fa-solid fa-xmark"></i></button></div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Nome Comercial do Produto</label><input value={pForm.nome ?? ''} onChange={e => setPForm({...pForm, nome: e.target.value})} placeholder="Ex: Doce de Leite 500g" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold uppercase focus:ring-2 focus:ring-blue-100 outline-none" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Preço de Custo R$</label><input type="number" value={pForm.custo ?? ''} onChange={e => { const c = e.target.value; const nv = updatePriceFromMargin(parseFloat(c)||0, parseFloat(pForm.margem)||0).toFixed(2); setPForm({...pForm, custo: c, venda: nv}); }} placeholder="0.00" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold outline-none" /></div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Margem %</label>
                  <div className="relative"><input type="number" value={pForm.margem ?? ''} disabled={props.margemGlobalAtiva} onChange={e => { const m = e.target.value; const nv = updatePriceFromMargin(parseFloat(pForm.custo)||0, parseFloat(m)||0).toFixed(2); setPForm({...pForm, margem: m, venda: nv}); }} placeholder="0" className={`w-full p-4 border rounded-2xl font-bold outline-none ${props.margemGlobalAtiva ? 'bg-gray-100 text-gray-400' : 'bg-gray-50'}`} />{props.margemGlobalAtiva && <i className="fa-solid fa-lock absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 text-[10px]"></i>}</div>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Preço de Venda Final</label>
                <div className="relative"><input type="number" value={pForm.venda ?? ''} disabled={props.margemGlobalAtiva} onChange={e => { const v = e.target.value; const nm = updateMarginFromPrice(parseFloat(pForm.custo)||0, parseFloat(v)||0).toFixed(2); setPForm({...pForm, venda: v, margem: nm}); }} placeholder="0.00" className={`w-full p-5 border-2 rounded-2xl font-black text-2xl outline-none transition-colors ${props.margemGlobalAtiva ? 'bg-blue-50 border-blue-100 text-blue-600' : 'bg-emerald-50 border-emerald-100 text-emerald-600'}`} />{props.margemGlobalAtiva && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-blue-400 uppercase tracking-tighter bg-white px-2 py-1 rounded-lg shadow-sm">Automático</span>}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Comissão %</label><input type="number" value={pForm.comissao ?? ''} onChange={e => setPForm({...pForm, comissao: e.target.value})} placeholder="0" className="w-full p-4 bg-yellow-50 border border-yellow-100 text-yellow-700 rounded-2xl font-bold outline-none" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Estoque Inicial</label><input type="number" value={pForm.estoquePrincipal ?? ''} onChange={e => setPForm({...pForm, estoquePrincipal: e.target.value})} placeholder="0" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold outline-none" /></div>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100"><span className="text-xs font-bold text-gray-700 uppercase">Produto Ativo</span><button onClick={() => setPForm({...pForm, ativo: !pForm.ativo})} className={`w-12 h-6 rounded-full relative transition-colors ${pForm.ativo ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${pForm.ativo ? 'left-7' : 'left-1'}`}></div></button></div>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-3"><button onClick={handleSaveProduct} className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-[0.2em]">Salvar Produto</button><div className="flex gap-3">{showProductModal !== 'NEW' && <button onClick={() => setConfirmDelete({ id: (showProductModal as Product).id, type: 'PRODUCT', name: (showProductModal as Product).nome })} className="flex-1 bg-rose-50 text-rose-600 font-black py-4 rounded-2xl active:scale-95 transition-all uppercase text-[9px] tracking-widest border border-rose-100">Excluir</button>}<button onClick={() => setShowProductModal(null)} className="flex-1 bg-white text-gray-400 font-bold py-4 rounded-2xl border border-gray-200 uppercase text-[9px] tracking-widest">Cancelar</button></div></div>
          </div>
        </div>
      )}

      {showEntryModal && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-[32px] w-full max-w-xs shadow-2xl text-center">
            <h3 className="font-black text-gray-800 text-sm uppercase mb-4">Entrada de Mercadoria</h3>
            <div className="mb-6"><p className="text-[10px] font-black text-gray-400 uppercase mb-1">Produto</p><h4 className="text-sm font-bold text-gray-800 uppercase leading-tight">{showEntryModal.nome}</h4></div>
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex flex-col items-center"><span className="text-[10px] font-black text-blue-400 uppercase mb-1">📦 Estoque Atual</span><span className="text-lg font-black text-blue-700">{(showEntryModal.estoquePrincipal ?? 0)} UN</span></div>
              <input type="number" placeholder="Quantidade Entrada" className="w-full p-4 bg-gray-50 rounded-2xl border font-black text-center text-lg outline-none" value={entryForm.qtd} onChange={e => setEntryForm({...entryForm, qtd: e.target.value})} />
              <input type="number" placeholder="Custo Unit." className="w-full p-4 bg-gray-50 rounded-2xl border font-black text-center text-lg outline-none" value={entryForm.custo} onChange={e => setEntryForm({...entryForm, custo: e.target.value})} />
              <button onClick={() => { if(!entryForm.qtd || !entryForm.custo) return; props.registerStockEntry(showEntryModal.id, parseInt(entryForm.qtd), parseFloat(entryForm.custo)); showToast("Entrada registrada"); setShowEntryModal(null); }} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl active:scale-95 shadow-xl uppercase text-xs tracking-widest">Confirmar Entrada</button>
              <button onClick={() => setShowEntryModal(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 animate-in slide-in-from-bottom duration-300 shadow-2xl overflow-y-auto max-h-[95vh]">
            <h3 className="font-black text-gray-800 uppercase text-sm mb-6">{showClientModal === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3>
            <div className="space-y-4">
              <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Fantasia</label><input value={clientForm.nomeFantasia ?? ''} onChange={e => setClientForm({...clientForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone</label><input value={clientForm.telefone ?? ''} onChange={e => setClientForm({...clientForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Endereço</label><input value={clientForm.endereco ?? ''} onChange={e => setClientForm({...clientForm, endereco: e.target.value})} placeholder="Endereço" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Bairro</label><input value={clientForm.bairro ?? ''} onChange={e => setClientForm({...clientForm, bairro: e.target.value})} placeholder="Bairro" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold uppercase" /></div>
              <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border"><input type="checkbox" checked={clientForm.ativarCnpj ?? false} onChange={e => setClientForm({...clientForm, ativarCnpj: e.target.checked})} className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500" /><label className="text-xs font-bold text-gray-700 uppercase">Ativar CNPJ</label></div>
              {clientForm.ativarCnpj && <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">CNPJ</label><input value={clientForm.cnpj ?? ''} onChange={e => setClientForm({...clientForm, cnpj: e.target.value})} placeholder="00.000.000/0000-00" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div>}
              <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dia de Roteiro</label><select value={clientForm.diaRoteiro ?? 1} onChange={e => setClientForm({...clientForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold">{[1, 2, 3, 4, 5, 6].map(d => (<option key={d} value={d}>{DIAS_SEMANA[d] ?? 'N/D'}</option>))}</select></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">PIN Localização</label><input value={clientForm.pinLocalizacao ?? ''} onChange={e => setClientForm({...clientForm, pinLocalizacao: e.target.value})} placeholder="Latitude, Longitude" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" /></div>
              <button onClick={handlePinLocation} className="w-full bg-indigo-50 text-indigo-600 font-black py-3 rounded-2xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2"><i className="fa-solid fa-location-dot"></i> Capturar Localização Atual</button>
              <div className="flex flex-col gap-2 pt-2"><button onClick={handleSaveClient} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-widest">SALVAR CLIENTE</button><button onClick={() => setShowClientModal(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Cancelar</button></div>
            </div>
          </div>
        </div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2rem] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh]">
            <div className="flex-1 overflow-y-auto p-2"><Cupom sale={selectedSale} client={props.clients.find(c => c.id === selectedSale.clientId) || {} as Client} products={props.products} onClose={() => setSelectedSale(null)} onDeleteSale={props.deleteSale} allowDelete={true} /></div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-2"><button onClick={() => setSelectedSale(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar</button></div>
          </div>
        </div>
      )}

      {viewingClientHistory && (
        <ClientHistory 
          client={viewingClientHistory} 
          sales={props.sales} 
          products={props.products} 
          onClose={() => setViewingClientHistory(null)} 
        />
      )}
    </div>
  );
};

export default AdminDashboard;