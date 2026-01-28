import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CommissionPaymentLog } from '../types';
import { DIAS_SEMANA } from '../constants';
import Cupom from './Cupom';
import { loadLocalState, saveLocalState } from '../utils/persistence';

interface AdminDashboardProps {
  products: Product[];
  users: User[];
  cargas: Carga[];
  clients: Client[];
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
  sales: Sale[];
  commissions: Commission[];
  payoutLogs: CommissionPaymentLog[];
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
}

type TabType = 'HOME' | 'CATALOGO' | 'VENDEDORES' | 'CARGAS' | 'CLIENTES' | 'HISTORY' | 'CAIXA' | 'ROTEIRO' | 'REPORTS' | 'CONTAS_RECEBER' | 'SETTINGS';

const AdminDashboard: React.FC<AdminDashboardProps> = (props) => {
  const [activeTab, setActiveTab] = useState<TabType>(() => loadLocalState('a_activeTab', 'HOME'));
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [orderedProductIds, setOrderedProductIds] = useState<string[]>([]);

  // --- Efeitos de Persistência e Histórico ---
  useEffect(() => {
    saveLocalState('a_activeTab', activeTab);
    if (activeTab !== 'HOME' && window.history.state?.tab !== activeTab) {
      window.history.pushState({ tab: activeTab }, '');
    }
  }, [activeTab]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (activeTab !== 'HOME') {
        if (state && state.tab) setActiveTab(state.tab);
        else setActiveTab('HOME');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab]);
  // -------------------------------------------

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
    if (props.products.length > 0) {
      const activeIds = props.products.filter(p => p.ativo).map(p => p.id);
      if (orderedProductIds.length === 0) setOrderedProductIds(activeIds);
      else {
        const newIds = activeIds.filter(id => !orderedProductIds.includes(id));
        if (newIds.length > 0) setOrderedProductIds([...orderedProductIds, ...newIds]);
      }
    }
  }, [props.products]);

  const [showProductModal, setShowProductModal] = useState<Product | 'NEW' | null>(null);
  const [showEntryModal, setShowEntryModal] = useState<Product | null>(null);
  const [showClientModal, setShowClientModal] = useState<Client | 'NEW' | null>(null);
  const [showConfirmSync, setShowConfirmSync] = useState(false);
  const [showConfirmApply, setShowConfirmApply] = useState(false);
  const [filtroPeriodo, setFiltroPeriodo] = useState<'HOJE' | 'SEMANA' | 'MES' | 'GERAL'>('HOJE');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [showUserModal, setShowUserModal] = useState<User | 'NEW' | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [payoutVendedor, setPayoutVendedor] = useState<User | null>(null);
  const [payoutType, setPayoutType] = useState<'TOTAL' | 'PARCIAL'>('TOTAL');
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [periodoRelatorio, setPeriodoRelatorio] = useState<'HOJE' | 'SEMANA' | 'MES' | 'GERAL'>('MES');

  const [pwUser, setPwUser] = useState<string>('');
  const [pwNew, setPwNew] = useState<string>('');

  const [pForm, setPForm] = useState({ nome: '', custo: '', venda: '', comissao: '', margem: '', ativo: true, estoquePrincipal: '' });
  const [entryForm, setEntryForm] = useState({ qtd: '', custo: '' });
  const [clientForm, setClientForm] = useState<Partial<Client>>({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0 });
  const [userForm, setUserForm] = useState<Partial<User>>({ nome: '', foto: '', telefone: '', pin: '' });
  const [selectedVendedorId, setSelectedVendedorId] = useState('');
  const [stagingCarga, setStagingCarga] = useState<{ [pId: string]: number }>({});

  const logoInputRef = useRef<HTMLInputElement>(null);
  const pix1InputRef = useRef<HTMLInputElement>(null);
  const pix2InputRef = useRef<HTMLInputElement>(null);
  const userPhotoInputRef = useRef<HTMLInputElement>(null);

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

  const getClientAvgRevenue = (id: string) => {
    const cSales = props.sales.filter(s => s.clientId === id).slice(-3);
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
    for (const pId of allProdIds) { if ((cargaAtualMap[pId] ?? 0) !== (stagingCarga[pId] ?? 0)) return true; }
    return false;
  }, [stagingCarga, props.cargas, selectedVendedorId]);

  const getVendedorStats = (vId: string) => {
    const vSales = props.sales.filter(s => s.vendedorId === vId && filterByPeriod(s.data, 'HOJE'));
    const sellerComms = props.commissions.filter(c => c.vendedorId === vId);
    const totalCommsEligible = sellerComms.filter(c => c.status !== 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
    const jaPago = props.payoutLogs.filter(l => l.vendedorId === vId).reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 
    const disponivel = Math.max(0, totalCommsEligible - jaPago);
    const aReceber = sellerComms.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    return { vendasHoje: Number(vSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), comissaoDisponivel: Number(disponivel.toFixed(2)), comissaoAReceber: Number(aReceber.toFixed(2)) };
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

  const handleConfirmPayout = () => {
    if (!payoutVendedor) return;
    const stats = getVendedorStats(payoutVendedor.id);
    const amount = payoutType === 'TOTAL' ? stats.comissaoDisponivel : parseFloat(partialAmount);
    if (isNaN(amount) || amount <= 0 || amount > stats.comissaoDisponivel) return alert("Valor inválido");
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
    const idx = orderedProductIds.indexOf(id);
    const newOrder = [...orderedProductIds];
    if (dir === 'UP' && idx > 0) [newOrder[idx], newOrder[idx-1]] = [newOrder[idx-1], newOrder[idx]];
    else if (dir === 'DOWN' && idx < newOrder.length - 1) [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]];
    setOrderedProductIds(newOrder);
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
      props.updateClient(currentClient.id, { ordem: targetClient.ordem });
      props.updateClient(targetClient.id, { ordem: currentClient.ordem });
      showToast("Ordem atualizada!");
    }
  };

  const handleOpenClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setClientForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0 });
    else setClientForm({ ...c });
    setShowClientModal(c);
  };

  const handleSaveProduct = () => {
    if (!pForm.nome || !pForm.custo || !pForm.venda || !pForm.comissao) { showToast("Preencha todos os campos obrigatórios.", 'error'); return; }
    const data: Partial<Product> = { nome: pForm.nome, precoCusto: parseFloat(pForm.custo), precoVenda: parseFloat(pForm.venda), comissaoPercentual: parseFloat(pForm.comissao), ativo: pForm.ativo ?? true, estoquePrincipal: parseInt(pForm.estoquePrincipal) || 0 };
    if (showProductModal === 'NEW') props.addProduct(data.nome!, data.precoCusto!, data.precoVenda!, data.comissaoPercentual!, data.estoquePrincipal);
    else if (typeof showProductModal === 'object') props.updateProduct(showProductModal.id, data);
    setShowProductModal(null);
    showToast("Produto salvo!");
  };

  const handleDeleteProductInModal = async () => {
    if (typeof showProductModal === 'object' && showProductModal !== null) {
      if (confirm(`Deseja realmente excluir o produto "${showProductModal.nome}"?`)) {
        await props.deleteProduct(showProductModal.id);
        setShowProductModal(null);
        showToast("Operação concluída.");
      }
    }
  };

  const handleSaveClient = () => {
    if (!clientForm.nomeFantasia || !clientForm.telefone || !clientForm.endereco || !clientForm.bairro) { showToast("Preencha Nome Fantasia, Telefone, Endereço e Bairro.", 'error'); return; }
    const clientPayload: Omit<Client, 'id'> = { nomeFantasia: clientForm.nomeFantasia!, telefone: clientForm.telefone!, endereco: clientForm.endereco!, bairro: clientForm.bairro!, diaRoteiro: clientForm.diaRoteiro ?? 1, ativo: clientForm.ativo ?? true, ativarCnpj: clientForm.ativarCnpj ?? false, cnpj: clientForm.cnpj, pinLocalizacao: clientForm.pinLocalizacao, ordem: clientForm.ordem ?? 0, nome: clientForm.nome, observacoes: clientForm.observacoes };
    if (showClientModal === 'NEW') props.addClient(clientPayload);
    else if (typeof showClientModal === 'object') props.updateClient(showClientModal.id, clientPayload);
    setShowClientModal(null);
    showToast("Cliente salvo!");
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

  const MenuCard = ({ icon, title, tab, color }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 active:scale-95 transition-all text-center group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700 tracking-tight">{title}</span>
    </button>
  );

  const filteredProducts = useMemo(() => {
    const filtered = props.products.filter(p => p.ativo && (p.nome ?? '').toLowerCase().includes(search.toLowerCase()));
    if (search) return filtered;
    return [...filtered].sort((a, b) => orderedProductIds.indexOf(a.id) - orderedProductIds.indexOf(b.id));
  }, [props.products, orderedProductIds, search]);

  const filteredHistory = useMemo(() => props.sales.filter(s => filterByPeriod(s.data, filtroPeriodo)).sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)), [props.sales, filtroPeriodo]);

  const updateStaging = (pId: string, delta: number) => {
    const p = props.products.find(prod => prod.id === pId);
    if (!p) return;
    const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === pId)?.quantidade ?? 0; 
    const meta = Math.max(0, Math.min((p.estoquePrincipal ?? 0) + noV, (stagingCarga[pId] ?? 0) + delta));
    setStagingCarga(prev => ({ ...prev, [pId]: meta }));
  };

  const contasAReceber = useMemo(() => props.sales.filter(s => s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [props.sales]);

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
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Painel Administrativo</h2><p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Gestão e Controle Total</p></div>
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
          <div className="grid gap-3 px-1">{filteredHistory.map(s => (<button key={s.id} onClick={() => setSelectedSale(s)} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col text-left transition-all hover:border-blue-200"><div className="flex justify-between items-start mb-2"><span className="text-[9px] font-black text-gray-400 uppercase">{s.data.toLocaleDateString()} {s.data.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span><span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${s.statusPagamento === 'PAGO' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{s.statusPagamento === 'PAGO' ? 'RECEBIDA' : 'EM ABERTO'}</span></div><div className="flex justify-between items-end"><div><h4 className="font-bold text-gray-800 text-sm leading-tight">{props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4><p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vend: {props.users.find(u => u.id === s.vendedorId)?.nome ?? 'Desc.'}</p></div><p className="text-sm font-black text-gray-800">R$ {s.valorTotal.toFixed(2)}</p></div></button>))}</div>
        </div>
      )}

      {activeTab === 'CARGAS' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Cargas</h2></div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"><h3 className="font-black text-gray-800 mb-4 uppercase text-[10px]">Vendedor Responsável</h3><select value={selectedVendedorId} onChange={e => setSelectedVendedorId(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-semibold text-sm"><option value="">Selecione um vendedor...</option>{props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
          {selectedVendedorId && (<div className="pb-40"><div className="grid gap-1.5 px-1">{props.products.filter(p => p.ativo).map(p => { const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === p.id)?.quantidade ?? 0; const meta = stagingCarga[p.id] ?? 0; return (<div key={p.id} className="bg-white px-3 py-2 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between"><div className="flex-1 min-w-0 pr-3"><h4 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h4><p className="text-[9px] text-gray-400 font-semibold mt-0.5">C: {(p.estoquePrincipal ?? 0)} | V: {noV}</p></div><div className="flex items-center bg-gray-50 rounded-xl p-1 gap-1 flex-shrink-0"><button onClick={() => updateStaging(p.id, -1)} className="w-8 h-8 bg-white border border-gray-200 text-gray-400 rounded-lg active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus text-[10px]"></i></button><span className="font-black text-xs min-w-[24px] text-center">{meta}</span><button onClick={() => updateStaging(p.id, 1)} className="w-8 h-8 bg-blue-600 text-white rounded-lg active:scale-90 shadow-sm flex items-center justify-center"><i className="fa-solid fa-plus text-[10px]"></i></button></div></div>); })}</div></div>)}
          {selectedVendedorId && (<div className="fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] z-50 max-w-lg mx-auto safe-bottom"><div className="flex flex-row gap-2"><button onClick={() => setShowConfirmApply(true)} disabled={!hasCargaChanges} className={`flex-1 font-black py-4 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1 transition-all text-[9px] uppercase tracking-tighter ${hasCargaChanges ? 'bg-emerald-600 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><i className="fa-solid fa-check-circle text-sm"></i> Aplicar Agora</button><button onClick={() => setShowConfirmSync(true)} disabled={!hasCargaChanges} className={`flex-1 font-black py-4 rounded-2xl shadow-xl flex flex-col items-center justify-center gap-1 transition-all text-[9px] uppercase tracking-tighter ${hasCargaChanges ? 'bg-gray-900 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}><i className="fa-solid fa-truck-loading text-sm"></i> Enviar Pendente</button></div></div>)}
        </div>
      )}

      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Clientes</h2></div>
          <div className="flex gap-2"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm" /><button onClick={() => handleOpenClient('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-user-plus"></i></button></div>
          <div className="grid gap-2 px-1">{props.clients.filter(c => c.nomeFantasia.toLowerCase().includes(search.toLowerCase())).sort((a,b) => (a.nomeFantasia||'').toLowerCase().localeCompare((b.nomeFantasia||'').toLowerCase())).map(c => (<div key={c.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between transition-all hover:border-blue-200"><div className="flex-1 min-w-0 pr-2"><div className="flex items-center gap-2"><h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{c.nomeFantasia}</h3>{c.telefone && <a href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}`} target="_blank" className="text-emerald-500" onClick={(e) => e.stopPropagation()}><i className="fa-brands fa-whatsapp text-lg"></i></a>}</div><div className="flex items-center gap-3 mt-1.5"><p className="text-[10px] text-gray-400 font-black uppercase truncate">{DIAS_SEMANA[c.diaRoteiro]}</p><div className="flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-100"><i className="fa-solid fa-chart-line text-blue-400 text-[10px]"></i><span className="text-[11px] font-black text-blue-600">R$ {getClientAvgRevenue(c.id)}</span></div></div></div><div className="flex gap-2"><button onClick={() => handleOpenClient(c)} className="bg-blue-50 text-blue-600 w-9 h-9 rounded-lg border border-blue-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-pencil-alt text-sm"></i></button><button onClick={() => { if(confirm("Excluir cliente?")) props.deleteClient(c.id); }} className="bg-rose-50 text-rose-600 w-9 h-9 rounded-lg border border-rose-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-trash-can text-sm"></i></button></div></div>))}</div>
        </div>
      )}

      {activeTab === 'CAIXA' && (
        <div className="space-y-6 py-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Caixa</h2></div>
          <div className="grid gap-4 px-1">{props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(v => { const stats = getVendedorStats(v.id); return (<div key={v.id} className="bg-white rounded-[2.5rem] shadow-xl border-t-4 border-blue-500 p-8 flex flex-col gap-6"><div className="flex items-center gap-4"><div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-md">{v.foto ? <img src={v.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user text-2xl"></i>}</div><div><h3 className="font-black text-gray-800 text-lg leading-none mb-1 uppercase truncate max-w-[150px]">{v.nome}</h3><p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Performance Hoje</p></div></div><div className="space-y-4"><div className="grid grid-cols-2 gap-4"><div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 flex flex-col items-center"><p className="text-[9px] text-gray-400 font-black uppercase mb-2 text-center leading-none">Vendas Hoje</p><p className="text-lg font-black text-gray-800">R$ {stats.vendasHoje.toFixed(2)}</p></div><div className="bg-emerald-50 p-5 rounded-[2rem] border border-emerald-100 flex flex-col items-center"><p className="text-[9px] text-emerald-600 font-black uppercase mb-2 text-center leading-none">Disponível</p><p className="text-lg font-black text-emerald-700">R$ {stats.comissaoDisponivel.toFixed(2)}</p></div></div><div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 flex justify-between items-center"><span className="text-[9px] font-black text-orange-600 uppercase">Comissão a Receber (Prazo)</span><span className="text-sm font-black text-orange-700">R$ {stats.comissaoAReceber.toFixed(2)}</span></div></div><button onClick={() => setPayoutVendedor(v)} className="w-full bg-emerald-600 text-white py-5 rounded-3xl font-black text-xs uppercase shadow-xl active:scale-95 transition-all tracking-widest">Pagar Comissão</button></div>); })}</div>
        </div>
      )}

      {activeTab === 'SETTINGS' && (
        <div className="space-y-6 py-4 px-2 pb-20"><div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Configurações</h2></div><div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col items-center"><h3 className="font-black text-gray-800 uppercase text-xs mb-6 text-center">Logotipo da Empresa</h3><div onClick={() => logoInputRef.current?.click()} className="w-48 h-24 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer relative group overflow-hidden">{props.logo ? <img src={props.logo} alt="Logo" className="w-full h-full object-contain" /> : <div className="text-gray-300 flex flex-col items-center gap-1"><i className="fa-solid fa-cloud-arrow-up text-2xl"></i><span className="text-[9px] font-black">Upload</span></div>}</div><input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" /></div><div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100"><h3 className="font-black text-gray-800 uppercase text-xs mb-6">Regras de Margem</h3><div className="space-y-4"><div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100"><label className="text-sm font-bold text-gray-700 uppercase">Margem Global Ativa</label><button onClick={() => props.setMargemGlobalAtiva(!props.margemGlobalAtiva)} className={`w-12 h-6 rounded-full relative transition-colors ${props.margemGlobalAtiva ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemGlobalAtiva ? 'left-7' : 'left-1'}`}></div></button></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor Margem Global (%)</label><input type="number" value={props.margemGlobalValor} onChange={e => props.setMargemGlobalValor(parseFloat(e.target.value) || 0)} placeholder="35" className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-lg" /></div><div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100"><label className="text-sm font-bold text-gray-700 uppercase">Margem Mínima Ativa</label><button onClick={() => props.setMargemMinimaAtiva(!props.margemMinimaAtiva)} className={`w-12 h-6 rounded-full relative transition-colors ${props.margemMinimaAtiva ? 'bg-green-500' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemMinimaAtiva ? 'left-7' : 'left-1'}`}></div></button></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor Margem Mínima (%)</label><input type="number" value={props.margemMinima} onChange={e => props.setMargemMinima(parseFloat(e.target.value) || 0)} placeholder="20" className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-lg" /></div></div></div><div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100"><h3 className="font-black text-gray-800 uppercase text-xs mb-6">Configurações PIX</h3><div className="space-y-6"><div className="space-y-3 p-4 bg-blue-50 rounded-2xl border border-blue-100"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome PIX 1</label><input value={props.pix1Name ?? ''} onChange={e => props.setPix1Name(e.target.value)} placeholder="Nome do Banco/Chave" className="w-full p-3 bg-white border rounded-xl font-bold text-sm" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">QR Code PIX 1 (Base64 ou URL)</label><input value={props.pix1Code ?? ''} onChange={e => props.setPix1Code(e.target.value)} placeholder="URL ou Base64 do QR Code" className="w-full p-3 bg-white border rounded-xl font-bold text-xs" /></div><button onClick={() => pix1InputRef.current?.click()} className="w-full bg-blue-600 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2"><i className="fa-solid fa-qrcode"></i> Upload QR Code 1</button><input type="file" ref={pix1InputRef} onChange={(e) => handlePixUpload(e, 1)} accept="image/*" className="hidden" /></div><div className="space-y-3 p-4 bg-blue-50 rounded-2xl border border-blue-100"><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome PIX 2</label><input value={props.pix2Name ?? ''} onChange={e => props.setPix2Name(e.target.value)} placeholder="Nome do Banco/Chave" className="w-full p-3 bg-white border rounded-xl font-bold text-sm" /></div><div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">QR Code PIX 2 (Base64 ou URL)</label><input value={props.pix2Code ?? ''} onChange={e => props.setPix2Code(e.target.value)} placeholder="URL ou Base64 do QR Code" className="w-full p-3 bg-white border rounded-xl font-bold text-xs" /></div><button onClick={() => pix2InputRef.current?.click()} className="w-full bg-blue-600 text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-widest flex items-center justify-center gap-2"><i className="fa-solid fa-qrcode"></i> Upload QR Code 2</button><input type="file" ref={pix2InputRef} onChange={(e) => handlePixUpload(e, 2)} accept="image/*" className="hidden" /></div></div></div><div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100"><h3 className="font-black text-gray-800 uppercase text-xs mb-6">Segurança</h3><div className="space-y-4"><select value={pwUser} onChange={e => setPwUser(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none text-xs"><option value="">Selecione Usuário...</option>{props.users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select><input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Novo PIN" className="w-full p-4 bg-gray-50 rounded-2xl font-black text-xl tracking-widest border-none outline-none" /><button onClick={handleUpdatePassword} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 transition-all">Atualizar PIN</button></div></div></div>
      )}

      {selectedSale && (<div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-[2rem] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh]"><div className="flex-1 overflow-y-auto p-2"><Cupom sale={selectedSale} client={props.clients.find(c => c.id === selectedSale.clientId) || {} as Client} products={props.products} onClose={() => setSelectedSale(null)} onDeleteSale={props.deleteSale} allowDelete={true} /></div><div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-2"><button onClick={() => setSelectedSale(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar</button></div></div></div>)}
    </div>
  );
};

export default AdminDashboard;