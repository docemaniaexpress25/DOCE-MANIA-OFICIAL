import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CommissionPaymentLog } from '../types';
import { DIAS_SEMANA } from '../constants';
import Cupom from './Cupom';

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

const AdminDashboard: React.FC<AdminDashboardProps> = (props) => {
  const [activeTab, setActiveTab] = useState<'HOME' | 'CATALOGO' | 'VENDEDORES' | 'CARGAS' | 'CLIENTES' | 'HISTORY' | 'CAIXA' | 'ROTEIRO' | 'REPORTS' | 'CONTAS_RECEBER' | 'SETTINGS'>('HOME');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [orderedProductIds, setOrderedProductIds] = useState<string[]>([]);

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
    if (props.products.length > 0 && orderedProductIds.length === 0) {
      setOrderedProductIds(props.products.map(p => p.id));
    } else if (props.products.length !== orderedProductIds.length) {
      const currentIds = props.products.map(p => p.id);
      const newIds = currentIds.filter(id => !orderedProductIds.includes(id));
      if (newIds.length > 0) {
        setOrderedProductIds([...orderedProductIds, ...newIds]);
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
  const [clientForm, setClientForm] = useState<Partial<Client>>({ ativarCnpj: false, cnpj: '', pinLocalizacao: '' });
  const [userForm, setUserForm] = useState<Partial<User>>({ nome: '', foto: '', telefone: '', pin: '' });
  const [selectedVendedorId, setSelectedVendedorId] = useState('');
  const [stagingCarga, setStagingCarga] = useState<{ [pId: string]: number }>({});

  const logoInputRef = useRef<HTMLInputElement>(null);
  const pix1InputRef = useRef<HTMLInputElement>(null);
  const pix2InputRef = useRef<HTMLInputElement>(null);
  const userPhotoInputRef = useRef<HTMLInputElement>(null);

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
    
    const totalCommsEligible = sellerComms
      .filter(c => c.status !== 'A_RECEBER')
      .reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
      
    const jaPago = props.payoutLogs.filter(l => l.vendedorId === vId).reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 
    const disponivel = Math.max(0, totalCommsEligible - jaPago);
    const aReceber = sellerComms.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    
    return {
      vendasHoje: Number(vSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), 
      comissaoDisponivel: Number(disponivel.toFixed(2)),
      comissaoAReceber: Number(aReceber.toFixed(2))
    };
  };

  const reportStats = useMemo(() => {
    const salesInPeriod = props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio));
    const totalVendas = salesInPeriod.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0);
    const paidCommissions = props.payoutLogs
      .filter(l => filterByPeriod(l.dataPagamento, periodoRelatorio))
      .reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0);
      
    // Top Clientes
    const clientMap: { [id: string]: number } = {};
    salesInPeriod.forEach(s => {
      clientMap[s.clientId] = (clientMap[s.clientId] || 0) + (s.valorTotal || 0);
    });
    const topClients = Object.entries(clientMap)
      .map(([id, total]) => ({
        id,
        nome: props.clients.find(c => c.id === id)?.nomeFantasia || 'Cliente Desconhecido',
        total: Number(total.toFixed(2))
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Top Produtos
    const prodMap: { [id: string]: number } = {};
    salesInPeriod.forEach(s => {
      s.itens.forEach(i => {
        prodMap[i.produtoId] = (prodMap[i.produtoId] || 0) + (i.quantidade || 0);
      });
    });
    const topProducts = Object.entries(prodMap)
      .map(([id, qtd]) => ({
        id,
        nome: props.products.find(p => p.id === id)?.nome || 'Produto Desconhecido',
        qtd
      }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 10);

    return {
      totalVendas: Number(totalVendas.toFixed(2)),
      totalComissaoPaga: Number(paidCommissions.toFixed(2)),
      topClients,
      topProducts
    };
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
    if (isNaN(amount) || amount <= 0 || amount > stats.comissaoDisponivel) return alert("Valor inválido");
    props.payCommission(payoutVendedor.id, amount, payoutType, props.adminUser.id);
    setPayoutVendedor(null);
    showToast("Pagamento registrado!");
  };

  // RESTAURANDO FUNÇÕES DE CARGA
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
  // FIM RESTAURAÇÃO FUNÇÕES DE CARGA

  const moveProduct = (id: string, dir: 'UP' | 'DOWN') => {
    const idx = orderedProductIds.indexOf(id);
    const newOrder = [...orderedProductIds];
    if (dir === 'UP' && idx > 0) [newOrder[idx], newOrder[idx-1]] = [newOrder[idx-1], newOrder[idx]];
    else if (dir === 'DOWN' && idx < newOrder.length - 1) [newOrder[idx], newOrder[idx+1]] = [newOrder[idx+1], newOrder[idx]];
    setOrderedProductIds(newOrder);
  };

  const moveClient = async (id: string, direction: 'UP' | 'DOWN', day: number) => {
    const clientsInDay = props.clients
      .filter(c => c.diaRoteiro === day && c.ativo)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    
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

  const handleOpenProduct = (p: Product | 'NEW') => {
    if (p === 'NEW') setPForm({ nome: '', custo: '', venda: '', comissao: '', margem: '35', ativo: true, estoquePrincipal: '0' });
    else {
      const precoVenda = Number(p.precoVenda) || 0;
      const precoCusto = Number(p.precoCusto) || 0;
      const margemCalculada = precoVenda > 0 ? ((precoVenda - precoCusto) / precoVenda) * 100 : 0;
      setPForm({ 
        nome: p.nome ?? '', 
        custo: precoCusto.toString(), 
        venda: precoVenda.toString(), 
        comissao: (p.comissaoPercentual ?? 0).toString(), 
        margem: margemCalculada.toFixed(2), 
        ativo: p.ativo ?? true,
        estoquePrincipal: (p.estoquePrincipal ?? 0).toString()
      });
    }
    setShowProductModal(p);
  };

  const handleSaveProduct = () => {
    if (!pForm.nome || !pForm.custo || !pForm.venda || !pForm.comissao) return;
    const data: Partial<Product> = { 
      nome: pForm.nome, 
      precoCusto: parseFloat(pForm.custo), 
      precoVenda: parseFloat(pForm.venda), 
      comissaoPercentual: parseFloat(pForm.comissao), 
      ativo: pForm.ativo ?? true,
      estoquePrincipal: parseInt(pForm.estoquePrincipal) || 0
    };
    if (showProductModal === 'NEW') props.addProduct(data.nome!, data.precoCusto!, data.precoVenda!, data.comissaoPercentual!, data.estoquePrincipal);
    else if (typeof showProductModal === 'object') props.updateProduct(showProductModal.id, data);
    setShowProductModal(null);
    showToast("Produto salvo!");
  };

  const handleOpenClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setClientForm({ nomeFantasia: '', telefone: '', diaRoteiro: 1, ativo: true, bairro: '', endereco: '', ordem: 0 });
    else setClientForm({ ...c });
    setShowClientModal(c);
  };

  const handleSaveClient = () => {
    if (!clientForm.nomeFantasia) return;
    if (showClientModal === 'NEW') props.addClient(clientForm as Omit<Client, 'id'>);
    else if (typeof showClientModal === 'object') props.updateClient(showClientModal.id, clientForm);
    setShowClientModal(null);
    showToast("Cliente salvo!");
  };

  const handleOpenUserModal = (u: User | 'NEW') => {
    if (u === 'NEW') setUserForm({ nome: '', telefone: '', foto: '', pin: '123456' });
    else setUserForm({ nome: u.nome ?? '', telefone: u.telefone ?? '', foto: u.foto ?? '', pin: u.pin ?? '' }); 
    setShowUserModal(u);
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

  const MenuCard = ({ icon, title, tab, color }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 active:scale-95 transition-all text-center group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700 tracking-tight">{title}</span>
    </button>
  );

  const filteredProducts = useMemo(() => {
    const filtered = props.products.filter(p => (p.nome ?? '').toLowerCase().includes(search.toLowerCase()));
    if (search) return filtered;
    return [...filtered].sort((a, b) => {
      const idxA = orderedProductIds.indexOf(a.id);
      const idxB = orderedProductIds.indexOf(b.id);
      if (idxA === -1 || idxB === -1) return 0;
      return idxA - idxB;
    });
  }, [props.products, orderedProductIds, search]);

  const filteredHistory = useMemo(() => {
    return props.sales.filter(s => filterByPeriod(s.data, filtroPeriodo))
      .sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)); 
  }, [props.sales, filtroPeriodo]);

  const updateStaging = (pId: string, delta: number) => {
    const p = props.products.find(prod => prod.id === pId);
    if (!p) return;
    const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === pId)?.quantidade ?? 0; 
    const totalDisp = (p.estoquePrincipal ?? 0) + noV; 
    const novaQ = Math.max(0, Math.min(totalDisp, (stagingCarga[pId] ?? 0) + delta));
    setStagingCarga(prev => ({ ...prev, [pId]: novaQ }));
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
                  const meta = stagingCarga[p.id] ?? 0;
                  return (
                    <div key={p.id} className="bg-white px-3 py-2 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                      <div className="flex-1 min-w-0 pr-3">
                        <h4 className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{p.nome}</h4> 
                        <p className="text-[9px] text-gray-400 font-semibold mt-0.5">C: {(p.estoquePrincipal ?? 0)} | V: {noV}</p> 
                      </div>
                      <div className="flex items-center bg-gray-50 rounded-xl p-1 gap-1 flex-shrink-0">
                        <button onClick={() => updateStaging(p.id, -1)} className="w-8 h-8 bg-white border border-gray-200 text-gray-400 rounded-lg active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus text-[10px]"></i></button>
                        <span className="font-black text-xs min-w-[24px] text-center">{meta}</span>
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
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center gap-2"><h3 className="font-bold text-gray-800 text-[13px] leading-tight uppercase truncate">{c.nomeFantasia}</h3>{c.telefone && <a href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}`} target="_blank" className="text-emerald-500" onClick={(e) => e.stopPropagation()}><i className="fa-brands fa-whatsapp text-lg"></i></a>}</div>
                  <div className="flex items-center gap-3 mt-1.5"><p className="text-[10px] text-gray-400 font-black uppercase truncate">{DIAS_SEMANA[c.diaRoteiro]}</p><div className="flex items-center gap-1.5 bg-blue-50 px-2 py-0.5 rounded border border-blue-100"><i className="fa-solid fa-chart-line text-blue-400 text-[10px]"></i><span className="text-[11px] font-black text-blue-600">R$ {getClientAvgRevenue(c.id)}</span></div></div>
                </div>
                <div className="flex gap-2"><button onClick={() => handleOpenClient(c)} className="bg-blue-50 text-blue-600 w-9 h-9 rounded-lg border border-blue-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-pencil-alt text-sm"></i></button><button onClick={() => { if(confirm("Excluir cliente?")) props.deleteClient(c.id); }} className="bg-rose-50 text-rose-600 w-9 h-9 rounded-lg border border-rose-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-trash-can text-sm"></i></button></div>
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
                  <div className="space-y-4"><div className="grid grid-cols-2 gap-4"><div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 flex flex-col items-center"><p className="text-[9px] text-gray-400 font-black uppercase mb-2 text-center leading-none">Vendas Hoje</p><p className="text-lg font-black text-gray-800">R$ {stats.vendasHoje.toFixed(2)}</p></div><div className="bg-emerald-50 p-5 rounded-[2rem] border border-emerald-100 flex flex-col items-center"><p className="text-[9px] text-emerald-600 font-black uppercase mb-2 text-center leading-none">Disponível</p><p className="text-lg font-black text-emerald-700">R$ {stats.comissaoDisponivel.toFixed(2)}</p></div></div><div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 flex justify-between items-center"><span className="text-[9px] font-black text-orange-600 uppercase">Comissão a Receber (Prazo)</span><span className="text-sm font-black text-orange-700">R$ {stats.comissaoAReceber.toFixed(2)}</span></div></div>
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
                      <p className="text-[9px] text-gray-400 font-semibold uppercase mt-0.5">
                        {log.dataPagamento.toLocaleDateString()} {log.dataPagamento.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} • {log.tipo}
                      </p>
                    </div>
                    <p className="text-xs font-black text-emerald-600 whitespace-nowrap">R$ {log.valorPago.toFixed(2)}</p>
                  </div>
                ))}
                {props.payoutLogs.length === 0 && (
                  <div className="text-center py-10 opacity-30 italic text-[10px] uppercase font-bold">Nenhum pagamento registrado.</div>
                )}
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
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {!search && (
                    <div className="flex flex-col gap-1 pr-2 border-r border-gray-50">
                      <button onClick={() => moveProduct(p.id, 'UP')} className="text-gray-300 hover:text-blue-500 active:scale-125 transition-all"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                      <button onClick={() => moveProduct(p.id, 'DOWN')} className="text-gray-300 hover:text-blue-500 active:scale-125 transition-all"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                    </div>
                  )}
                  <div className="flex-1 min-w-0" onClick={() => handleOpenProduct(p)}>
                    <h3 className="font-bold text-gray-800 text-[13px] leading-tight line-clamp-2 uppercase">{p.nome}</h3> 
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5"><span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100 shadow-inner whitespace-nowrap">{(p.estoquePrincipal ?? 0)} UN</span><span className="text-[13px] font-black text-emerald-600">R$ {(p.precoVenda ?? 0).toFixed(2)}</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { setShowEntryModal(p); setEntryForm({ qtd: '', custo: (p.precoCusto ?? 0).toString() }); }} className="bg-emerald-600 text-white w-9 h-9 rounded-lg flex items-center justify-center shadow-md active:scale-90 transition-all"><i className="fa-solid fa-plus-circle text-base"></i></button>
                  <button onClick={() => handleOpenProduct(p)} className="bg-blue-50 text-blue-600 w-9 h-9 rounded-lg border border-blue-100 flex items-center justify-center active:scale-90 transition-all shadow-sm"><i className="fa-solid fa-pencil-alt text-base"></i></button>
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
              const clientsInDay = props.clients
                .filter(c => (c.diaRoteiro ?? 0) === dia && (c.ativo ?? false))
                .sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); 
              return (
                <div key={dia} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                  <button onClick={() => setExpandedDay(isOpen ? null : dia)} className={`w-full flex items-center justify-between p-5 text-left transition-colors ${isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-700'}`}>
                    <div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${isOpen ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{dia}</div><span className="font-black uppercase text-xs tracking-tight">{DIAS_SEMANA[dia] ?? 'N/D'}</span></div>
                    <div className="flex items-center gap-2"><span className="text-[9px] font-black uppercase opacity-40">{clientsInDay.length} clientes</span><i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`}></i></div>
                  </button>
                  {isOpen && (
                    <div className="p-4 bg-white space-y-2 border-t border-indigo-50 animate-in slide-in-from-top duration-300">
                      {clientsInDay.map(c => (
                        <div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center group">
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
             <div className="bg-white p-6 rounded-[2rem] shadow-sm border-b-4 border-blue-500"><p className="text-[10px] font-black text-gray-400 uppercase mb-2">Comissão Paga</p><p className="text-xl font-black text-gray-800">R$ {reportStats.totalComissaoPaga.toFixed(2)}</p></div>
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
                  <div key={c.id} className="flex justify-between items-center pb-3 border-b border-gray-50 last:border-0">
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
              <div key={s.id} className={`p-5 rounded-3xl border shadow-sm transition-all ${isOverdue ? 'bg-rose-50 border-rose-200 shadow-rose-100/50' : 'bg-white border-gray-100'}`}>
                <div className="flex justify-between items-start mb-2">
                   <div className="flex flex-col">
                      <span className={`text-[10px] font-black uppercase ${isOverdue ? 'text-rose-600' : 'text-gray-400'}`}>Vencimento</span>
                      <span className={`text-xs font-black ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>{s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</span>
                   </div>
                   <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${isOverdue ? 'bg-rose-600 text-white animate-pulse' : 'bg-orange-50 text-orange-600'}`}>
                      {isOverdue ? 'VENCIDO / HOJE' : 'EM ABERTO'}
                   </span>
                </div>
                <div className="flex justify-between items-end">
                   <div>
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
            {contasAReceber.length === 0 && (
               <div className="text-center py-20 opacity-20 italic font-black uppercase tracking-widest">Nenhuma conta pendente</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'SETTINGS' && (
        <div className="space-y-6 py-4 px-2 pb-20">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Configurações</h2></div>
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 flex flex-col items-center">
            <h3 className="font-black text-gray-800 uppercase text-xs mb-6 text-center">Logotipo da Empresa</h3>
            <div onClick={() => logoInputRef.current?.click()} className="w-48 h-24 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer relative group overflow-hidden">
               {props.logo ? <img src={props.logo} alt="Logo" className="w-full h-full object-contain" /> : <div className="text-gray-300 flex flex-col items-center gap-1"><i className="fa-solid fa-cloud-arrow-up text-2xl"></i><span className="text-[9px] font-black">Upload</span></div>}
            </div>
            <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
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
              <div className="bg-emerald-50 p-4 rounded-2xl mb-6">
                 <p className="text-[10px] font-black text-emerald-600 uppercase mb-1">Disponível</p>
                 <p className="text-xl font-black text-emerald-700">R$ {getVendedorStats(payoutVendedor.id).comissaoDisponivel.toFixed(2)}</p>
              </div>
              <div className="flex bg-gray-100 p-1 rounded-xl mb-6">
                 <button onClick={() => setPayoutType('TOTAL')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${payoutType === 'TOTAL' ? 'bg-white shadow-sm' : 'text-gray-400'}`}>Total</button>
                 <button onClick={() => setPayoutType('PARCIAL')} className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase ${payoutType === 'PARCIAL' ? 'bg-white shadow-sm' : 'text-gray-400'}`}>Parcial</button>
              </div>
              {payoutType === 'PARCIAL' && <input type="number" placeholder="Valor" className="w-full p-4 bg-gray-50 border rounded-2xl font-black mb-6 text-center" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} />}
              <button onClick={handleConfirmPayout} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 mb-2">Confirmar Pagamento</button>
              <button onClick={() => setPayoutVendedor(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Confirmar Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-6"><p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo em Aberto</p><p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p></div>
              <div className="space-y-4 mb-6"><p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p><input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none" /></div>
              <div className="space-y-3">
                 <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest">Dinheiro</button>
                 <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest">PIX</button>
                 <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
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
    </div>
  );
};

export default AdminDashboard;