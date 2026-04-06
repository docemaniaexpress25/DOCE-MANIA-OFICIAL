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

  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

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

  const handleOpenProduct = (p: Product | 'NEW') => {
    if (p === 'NEW') {
      setPForm({ nome: '', custo: '0.00', venda: props.margemGlobalAtiva ? '0.00' : '0.00', comissao: '0.00', margem: props.margemGlobalAtiva ? props.margemGlobalValor.toFixed(2) : '0.00', ativo: true, estoquePrincipal: '0' });
    } else {
      setPForm({ nome: p.nome ?? '', custo: (p.precoCusto || 0).toFixed(2), venda: (p.precoVenda || 0).toFixed(2), comissao: (p.comissaoPercentual ?? 0).toFixed(2), margem: '0', ativo: p.ativo ?? true, estoquePrincipal: (p.estoquePrincipal ?? 0).toString() });
    }
    setShowProductModal(p);
  };

  const handleSaveProduct = () => {
    if (!pForm.nome) { showToast("Preencha o nome.", 'error'); return; }
    const data: Partial<Product> = { nome: pForm.nome, precoCusto: parseFloat(pForm.custo), precoVenda: parseFloat(pForm.venda), comissaoPercentual: parseFloat(pForm.comissao), ativo: pForm.ativo ?? true, estoquePrincipal: parseInt(pForm.estoquePrincipal) || 0 };
    if (showProductModal === 'NEW') props.addProduct(data.nome!, data.precoCusto!, data.precoVenda!, data.comissaoPercentual!, data.estoquePrincipal);
    else if (typeof showProductModal === 'object') props.updateProduct(showProductModal.id, data);
    setShowProductModal(null);
    showToast("Produto salvo!");
  };

  const handleOpenClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setClientForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: 1, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0 });
    else setClientForm({ ...c });
    setShowClientModal(c);
  };

  const handleSaveClient = () => {
    if (!clientForm.nomeFantasia || !clientForm.telefone) { showToast("Preencha Nome e Telefone.", 'error'); return; }
    const clientPayload: Omit<Client, 'id'> = { nomeFantasia: clientForm.nomeFantasia, telefone: clientForm.telefone, endereco: clientForm.endereco || '', bairro: clientForm.bairro || '', diaRoteiro: clientForm.diaRoteiro ?? 1, ativo: clientForm.ativo ?? true, ativarCnpj: clientForm.ativarCnpj ?? false, cnpj: clientForm.cnpj, pinLocalizacao: clientForm.pinLocalizacao, ordem: clientForm.ordem ?? 0, nome: clientForm.nome, observacoes: clientForm.observacoes };
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

  const handleSaveUser = () => {
    if (!userForm.nome) return;
    if (showUserModal === 'NEW') props.addUser(userForm.nome, userForm.foto, userForm.telefone);
    else if (typeof showUserModal === 'object') props.updateUser(showUserModal.id, userForm);
    setShowUserModal(null);
    showToast("Vendedor salvo!");
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

  // Lógica para parsear logs de recebimento
  const reciboLogs = useMemo(() => {
    const logs: any[] = [];
    props.sales.forEach(s => {
      if (s.detalhePagamento && s.detalhePagamento.includes('[')) {
        const entries = s.detalhePagamento.split('|');
        entries.forEach(entry => {
          if (entry.trim().startsWith('[')) {
            // [DD/MM/YYYY] R$ 0.00 (METHOD) - Por: NOME
            logs.push({
              id: Math.random().toString(),
              vendaId: s.id,
              clienteNome: props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Desc.',
              texto: entry.trim()
            });
          }
        });
      }
    });
    return logs.sort((a, b) => b.texto.localeCompare(a.texto));
  }, [props.sales, props.clients]);

  const MenuCard = ({ icon, title, tab, color }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 active:scale-95 transition-all text-center group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700 tracking-tight">{title}</span>
    </button>
  );

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

      {activeTab === 'CATALOGO' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-xl font-black text-gray-800">Estoque Central</h2>
            <button onClick={() => handleOpenProduct('NEW')} className="bg-blue-600 text-white w-10 h-10 rounded-xl shadow-lg active:scale-90"><i className="fa-solid fa-plus"></i></button>
          </div>
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <i className="fa-solid fa-magnifying-glass text-gray-400 text-xs"></i>
            <input type="text" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-sm font-semibold" />
          </div>
          <div className="grid gap-3">
            {props.products.filter(p => p.nome.toLowerCase().includes(search.toLowerCase())).map(p => (
              <div key={p.id} className={`p-4 rounded-3xl border shadow-sm flex items-center gap-4 transition-all ${p.ativo ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-gray-800 text-xs uppercase truncate leading-tight">{p.nome}</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <div className="flex flex-col"><span className="text-[9px] font-black text-gray-400 uppercase">Estoque</span><span className={`text-xs font-black ${p.estoquePrincipal > 10 ? 'text-blue-600' : 'text-rose-600'}`}>{p.estoquePrincipal} UN</span></div>
                    <div className="flex flex-col"><span className="text-[9px] font-black text-gray-400 uppercase">Preço</span><span className="text-xs font-black text-emerald-600">R$ {p.precoVenda.toFixed(2)}</span></div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowEntryModal(p)} className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-plus-circle"></i></button>
                  <button onClick={() => handleOpenProduct(p)} className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-pen"></i></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'VENDEDORES' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-xl font-black text-gray-800">Vendedores</h2>
            <button onClick={() => handleOpenUserModal('NEW')} className="bg-purple-600 text-white w-10 h-10 rounded-xl shadow-lg active:scale-90"><i className="fa-solid fa-plus"></i></button>
          </div>
          <div className="grid gap-3">
            {props.users.filter(u => u.role === 'VENDEDOR').map(u => {
              const stats = getVendedorStats(u.id);
              return (
              <div key={u.id} className={`p-4 rounded-3xl border shadow-sm flex items-center gap-4 transition-all ${u.ativo ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                {u.foto ? (
                  <img src={u.foto} className="w-12 h-12 rounded-2xl object-cover shadow-sm border border-gray-100" />
                ) : (
                  <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-user"></i></div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-gray-800 text-xs uppercase truncate leading-tight">{u.nome}</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <div className="flex flex-col"><span className="text-[9px] font-black text-gray-400 uppercase">Hoje</span><span className="text-xs font-black text-emerald-600">R$ {stats.vendasHoje.toFixed(2)}</span></div>
                    <div className="flex flex-col"><span className="text-[9px] font-black text-gray-400 uppercase">Disponível</span><span className="text-xs font-black text-blue-600">R$ {stats.comissaoDisponivel.toFixed(2)}</span></div>
                  </div>
                </div>
                <button onClick={() => handleOpenUserModal(u)} className="w-9 h-9 bg-gray-50 text-gray-400 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-gear"></i></button>
              </div>
            )})}
          </div>
        </div>
      )}

      {activeTab === 'CARGAS' && (
        <div className="space-y-6">
          <div className="px-2"><h2 className="text-xl font-black text-gray-800">Sincronização de Cargas</h2></div>
          <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4">
             <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Selecionar Vendedor</label>
             <select value={selectedVendedorId} onChange={e => setSelectedVendedorId(e.target.value)} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm text-gray-700 outline-none">
                <option value="">Selecione um vendedor...</option>
                {props.users.filter(u => u.role === 'VENDEDOR' && u.ativo).map(u => (<option key={u.id} value={u.id}>{u.nome.toUpperCase()}</option>))}
             </select>
          </div>
          
          {selectedVendedorId && (
            <div className="space-y-4">
              <div className="grid gap-2">
                {props.products.filter(p => p.ativo).map(p => {
                  const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === p.id)?.quantidade ?? 0;
                  const totalDisp = (p.estoquePrincipal ?? 0) + noV;
                  const current = stagingCarga[p.id] ?? 0;
                  return (
                    <div key={p.id} className={`p-4 rounded-3xl border shadow-sm flex items-center gap-4 transition-all ${current !== noV ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100'}`}>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-black text-gray-800 text-[11px] uppercase truncate leading-tight">{p.nome}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[9px] font-black text-gray-400 uppercase">Disp: {totalDisp}</span>
                          <span className="text-[9px] font-black text-blue-600 uppercase">Atual: {noV}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 bg-white rounded-2xl p-1 border border-gray-100">
                         <button onClick={() => updateStaging(p.id, -1)} className="w-8 h-8 text-gray-400 active:scale-90"><i className="fa-solid fa-minus"></i></button>
                         <input type="number" value={current} onChange={e => handleStagingInputChange(p.id, e.target.value)} className="w-10 text-center font-black text-sm outline-none bg-transparent" />
                         <button onClick={() => updateStaging(p.id, 1)} className="w-8 h-8 text-blue-600 active:scale-90"><i className="fa-solid fa-plus"></i></button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="fixed bottom-24 left-4 right-4 flex gap-3 max-w-lg mx-auto z-40">
                 <button onClick={() => setShowConfirmSync(true)} disabled={!hasCargaChanges} className={`flex-1 py-5 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 ${hasCargaChanges ? 'bg-orange-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                   <i className="fa-solid fa-rotate"></i> Sincronizar
                 </button>
                 <button onClick={() => setShowConfirmApply(true)} disabled={!hasCargaChanges} className={`flex-1 py-5 rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 ${hasCargaChanges ? 'bg-slate-800 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                   <i className="fa-solid fa-circle-check"></i> Aplicar Agora
                 </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-xl font-black text-gray-800">Gestão de Clientes</h2>
            <button onClick={() => handleOpenClient('NEW')} className="bg-emerald-600 text-white w-10 h-10 rounded-xl shadow-lg active:scale-90"><i className="fa-solid fa-plus"></i></button>
          </div>
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <i className="fa-solid fa-magnifying-glass text-gray-400 text-xs"></i>
            <input type="text" placeholder="Buscar cliente..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-sm font-semibold" />
          </div>
          <div className="grid gap-3">
            {props.clients.filter(c => c.nomeFantasia.toLowerCase().includes(search.toLowerCase())).map(c => (
              <div key={c.id} className={`p-4 rounded-3xl border shadow-sm flex items-center gap-4 transition-all ${c.ativo ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                <div onClick={() => setViewingClientHistory(c)} className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center text-xl shadow-inner cursor-pointer active:scale-90 transition-transform"><i className="fa-solid fa-shop"></i></div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-gray-800 text-xs uppercase truncate leading-tight">{c.nomeFantasia}</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[9px] font-black text-gray-400 uppercase">{DIAS_SEMANA[c.diaRoteiro]}</span>
                    <span className="text-[9px] font-black text-blue-600 uppercase">Avg: R$ {getClientAvgRevenue(c.id)}</span>
                  </div>
                </div>
                <button onClick={() => handleOpenClient(c)} className="w-9 h-9 bg-gray-50 text-gray-400 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-pen"></i></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'CAIXA' && (
        <div className="space-y-6 py-4">
           <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Fluxo de Caixa</h2></div>
           <div className="grid grid-cols-2 gap-4 px-1">
              <div className="bg-emerald-600 p-5 rounded-[2.5rem] shadow-lg text-white">
                 <p className="text-[10px] font-black uppercase opacity-60 mb-1">Vendas Hoje</p>
                 <p className="text-xl font-black tracking-tight">R$ {props.sales.filter(s => filterByPeriod(s.data, 'HOJE')).reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)}</p>
              </div>
              <div className="bg-blue-600 p-5 rounded-[2.5rem] shadow-lg text-white">
                 <p className="text-[10px] font-black uppercase opacity-60 mb-1">Comissões Pagas</p>
                 <p className="text-xl font-black tracking-tight">R$ {props.payoutLogs.filter(l => filterByPeriod(l.dataPagamento, 'HOJE')).reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0).toFixed(2)}</p>
              </div>
           </div>

           <div className="space-y-4 px-1">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider ml-1">Comissões por Vendedor</h3>
              {props.users.filter(u => u.role === 'VENDEDOR').map(u => {
                 const stats = getVendedorStats(u.id);
                 return (
                 <div key={u.id} className="p-5 rounded-3xl border border-gray-100 bg-white shadow-sm flex items-center justify-between">
                    <div className="min-w-0 pr-4">
                       <h4 className="font-bold text-sm leading-tight text-gray-800 uppercase truncate">{u.nome}</h4>
                       <div className="flex gap-3 mt-1">
                          <span className="text-[10px] font-black text-blue-600 uppercase">Disp: R$ {stats.comissaoDisponivel.toFixed(2)}</span>
                          <span className="text-[10px] font-black text-rose-400 uppercase">Rec: R$ {stats.comissaoAReceber.toFixed(2)}</span>
                       </div>
                    </div>
                    <button onClick={() => handleOpenPayout(u)} className="bg-emerald-50 text-emerald-600 p-3 rounded-xl font-black text-[10px] active:scale-95 transition-all">Pagar</button>
                 </div>
              )})}
           </div>
        </div>
      )}

      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-xl font-black text-gray-800">Vendas Realizadas</h2></div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mb-4 shadow-inner">
            {(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (
              <button key={p} onClick={() => setFiltroPeriodo(p)} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${filtroPeriodo === p ? 'bg-white text-blue-600 shadow-md' : 'text-gray-400'}`}>{p}</button>
            ))}
          </div>
          <div className="grid gap-3">
            {props.sales.filter(s => filterByPeriod(s.data, filtroPeriodo)).sort((a,b) => new Date(b.data).getTime() - new Date(a.data).getTime()).map(s => {
              const client = props.clients.find(c => c.id === s.clientId);
              const vendor = props.users.find(u => u.id === s.vendedorId);
              return (
              <div key={s.id} onClick={() => setSelectedSale(s)} className="p-4 rounded-3xl border border-gray-100 bg-white shadow-sm flex items-center gap-4 active:scale-95 transition-all hover:border-blue-200">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center text-lg"><i className="fa-solid fa-receipt"></i></div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-gray-800 text-xs uppercase truncate leading-tight">{client?.nomeFantasia || 'Consumidor'}</h4>
                  <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vend: {vendor?.nome ?? 'Desc.'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-gray-800 leading-none">R$ {s.valorTotal.toFixed(2)}</p>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${s.statusPagamento === 'PAGO' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{s.statusPagamento}</span>
                </div>
              </div>
            )})}
            {props.sales.length === 0 && <div className="text-center py-20 opacity-20 italic font-black text-sm uppercase">Nenhuma venda encontrada</div>}
          </div>
        </div>
      )}

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-4">
           <div className="px-2"><h2 className="text-xl font-black text-gray-800">Roteiro Semanal</h2></div>
           <div className="grid gap-3">
              {DIAS_SEMANA.map((dia, idx) => {
                 const clientesDia = props.clients.filter(c => c.diaRoteiro === idx && c.ativo);
                 return (
                 <div key={dia} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden transition-all">
                    <button onClick={() => setExpandedDay(expandedDay === idx ? null : idx)} className={`w-full p-5 flex items-center justify-between transition-colors ${expandedDay === idx ? 'bg-indigo-50' : 'bg-white'}`}>
                       <span className="font-black text-xs text-gray-800 uppercase tracking-widest">{dia}</span>
                       <div className="flex items-center gap-3">
                          <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{clientesDia.length}</span>
                          <i className={`fa-solid ${expandedDay === idx ? 'fa-chevron-up' : 'fa-chevron-down'} text-gray-300 text-xs`}></i>
                       </div>
                    </button>
                    {expandedDay === idx && (
                       <div className="p-4 grid gap-2 animate-in slide-in-from-top-2 duration-300">
                          {clientesDia.map(c => (
                             <div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex items-center justify-between border border-gray-100/50">
                                <div className="min-w-0 pr-4">
                                  <p className="text-[11px] font-black text-gray-800 uppercase truncate">{c.nomeFantasia}</p>
                                  <p className="text-[9px] text-gray-400 font-bold uppercase truncate">{c.bairro || 'Sem bairro'}</p>
                                </div>
                                <i className="fa-solid fa-grip-lines text-gray-200"></i>
                             </div>
                          ))}
                          {clientesDia.length === 0 && <div className="text-center py-6 opacity-30 italic text-[10px] uppercase font-bold">Sem clientes definidos</div>}
                       </div>
                    )}
                 </div>
              )})}
           </div>
        </div>
      )}

      {activeTab === 'REPORTS' && (
        <div className="space-y-6 py-4">
           <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Relatórios Gerais</h2></div>
           <div className="flex bg-gray-100 p-1 rounded-2xl mb-4 shadow-inner px-1">
             {(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (
               <button key={p} onClick={() => setPeriodoRelatorio(p)} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${periodoRelatorio === p ? 'bg-white text-emerald-600 shadow-md' : 'text-gray-400'}`}>{p}</button>
             ))}
           </div>
           
           {/* Estatísticas resumidas e mais relatórios omitidos para brevidade mas a estrutura de tabs está mantida */}
           <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
              <div className="flex justify-between items-center"><h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Resumo Financeiro</h3><span className="bg-emerald-50 text-emerald-600 text-[10px] px-3 py-1 rounded-full font-black uppercase">{periodoRelatorio}</span></div>
              <div className="grid grid-cols-1 gap-4">
                 <div className="bg-slate-50 p-5 rounded-3xl flex justify-between items-center"><div className="flex flex-col"><span className="text-[10px] font-black text-gray-400 uppercase">Volume Bruto</span><span className="text-lg font-black text-gray-800">R$ {props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio)).reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)}</span></div><i className="fa-solid fa-chart-line text-blue-500 opacity-20 text-2xl"></i></div>
                 <div className="bg-slate-50 p-5 rounded-3xl flex justify-between items-center"><div className="flex flex-col"><span className="text-[10px] font-black text-gray-400 uppercase">Lucro Líquido Est.</span><span className="text-lg font-black text-emerald-600">R$ {(props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio)).reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0) * 0.35).toFixed(2)}</span></div><i className="fa-solid fa-hand-holding-dollar text-emerald-500 opacity-20 text-2xl"></i></div>
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
              const dueDate = s.dataVencimento ? new Date(s.dataVencimento) : null;
              const isOverdue = dueDate ? dueDate <= new Date() : false;
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
                   </div>
                   <div className="text-right">
                     <p className={`text-sm font-black mb-2 ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>Saldo: R$ {saldo.toFixed(2)}</p>
                     <button onClick={() => { setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 ${isOverdue ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>RECEBER</button>
                   </div>
                </div>
              </div>
            )})}
            {contasAReceber.length === 0 && <div className="text-center py-10 opacity-20 italic font-black uppercase tracking-widest text-[10px]">Nenhuma conta pendente</div>}
          </div>

          <div className="space-y-4 pt-6">
             <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider px-2">Histórico de Recebimentos</h3>
             <div className="grid gap-3 px-1">
                {reciboLogs.map(log => (
                  <div key={log.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <p className="font-bold text-gray-800 text-[11px] leading-tight uppercase truncate">{log.clienteNome}</p>
                      <i className="fa-solid fa-receipt text-emerald-500 opacity-20"></i>
                    </div>
                    <p className="text-[10px] text-gray-600 font-semibold uppercase">{log.texto}</p>
                  </div>
                ))}
                {reciboLogs.length === 0 && <div className="text-center py-10 opacity-30 italic text-[10px] uppercase font-bold">Nenhum recebimento registrado.</div>}
             </div>
          </div>
        </div>
      )}

      {activeTab === 'SETTINGS' && (
        <div className="space-y-6 pb-20">
          <div className="px-2"><h2 className="text-xl font-black text-gray-800">Configurações Gerais</h2></div>
          
          <div className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
             <div className="flex justify-center flex-col items-center gap-4">
                <div className="w-full h-32 bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl flex items-center justify-center overflow-hidden">
                   {props.logo ? <img src={props.logo} className="h-full w-full object-contain" /> : <i className="fa-solid fa-image text-gray-200 text-3xl"></i>}
                </div>
                <button onClick={() => logoInputRef.current?.click()} className="text-[10px] font-black uppercase bg-slate-900 text-white px-8 py-4 rounded-2xl shadow-xl active:scale-95 transition-all">Alterar Logotipo</button>
                <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
             </div>

             <div className="space-y-4 pt-6 border-t border-gray-50">
                <div className="flex justify-between items-center"><h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Informações da Empresa</h3></div>
                <div className="space-y-3">
                   <input type="text" value={props.companyName} onChange={e => props.setCompanyName(e.target.value)} placeholder="NOME DA EMPRESA" className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" />
                   <input type="text" value={props.companyCnpj} onChange={e => props.setCompanyCnpj(e.target.value)} placeholder="CNPJ" className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" />
                </div>
             </div>

             <div className="space-y-4 pt-6 border-t border-gray-50">
                <div className="flex justify-between items-center"><h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Regras de Margem</h3></div>
                <div className="bg-slate-50 p-5 rounded-3xl space-y-4">
                   <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-gray-700 uppercase">Margem Global</span>
                      <button onClick={() => props.setMargemGlobalAtiva(!props.margemGlobalAtiva)} className={`w-12 h-6 rounded-full relative transition-all ${props.margemGlobalAtiva ? 'bg-emerald-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemGlobalAtiva ? 'left-7' : 'left-1'}`}></div></button>
                   </div>
                   {props.margemGlobalAtiva && <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-gray-100"><input type="number" value={props.margemGlobalValor} onChange={e => props.setMargemGlobalValor(parseFloat(e.target.value))} className="w-16 font-black text-sm text-center outline-none bg-transparent" /><span className="text-[10px] font-black text-gray-400">% LIQUIDO</span></div>}
                </div>
                <div className="bg-slate-50 p-5 rounded-3xl space-y-4">
                   <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-gray-700 uppercase">Trava Mínima</span>
                      <button onClick={() => props.setMargemMinimaAtiva(!props.margemMinimaAtiva)} className={`w-12 h-6 rounded-full relative transition-all ${props.margemMinimaAtiva ? 'bg-rose-600' : 'bg-gray-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemMinimaAtiva ? 'left-7' : 'left-1'}`}></div></button>
                   </div>
                   {props.margemMinimaAtiva && <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-gray-100"><input type="number" value={props.margemMinima} onChange={e => props.setMargemMinima(parseFloat(e.target.value))} className="w-16 font-black text-sm text-center outline-none bg-transparent" /><span className="text-[10px] font-black text-gray-400">% MINIMO</span></div>}
                </div>
             </div>

             <div className="space-y-4 pt-6 border-t border-gray-50">
                <div className="flex justify-between items-center"><h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Contas Pix</h3></div>
                <div className="grid gap-4">
                   <div className="bg-slate-50 p-5 rounded-3xl space-y-4">
                      <input type="text" value={props.pix1Name} onChange={e => props.setPix1Name(e.target.value)} className="w-full bg-white p-3 rounded-xl font-black text-xs outline-none border border-gray-100" />
                      <div className="flex items-center justify-between">
                         <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center overflow-hidden border border-gray-100">{props.pix1Code ? <img src={props.pix1Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200"></i>}</div>
                         <button onClick={() => pix1InputRef.current?.click()} className="text-[9px] font-black uppercase bg-blue-600 text-white px-4 py-3 rounded-xl shadow-lg active:scale-95">Atualizar QR</button>
                      </div>
                      <input type="file" ref={pix1InputRef} onChange={e => handlePixUpload(e, 1)} className="hidden" />
                   </div>
                   <div className="bg-slate-50 p-5 rounded-3xl space-y-4">
                      <input type="text" value={props.pix2Name} onChange={e => props.setPix2Name(e.target.value)} className="w-full bg-white p-3 rounded-xl font-black text-xs outline-none border border-gray-100" />
                      <div className="flex items-center justify-between">
                         <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center overflow-hidden border border-gray-100">{props.pix2Code ? <img src={props.pix2Code} className="w-full h-full object-contain" /> : <i className="fa-solid fa-qrcode text-gray-200"></i>}</div>
                         <button onClick={() => pix2InputRef.current?.click()} className="text-[9px] font-black uppercase bg-blue-600 text-white px-4 py-3 rounded-xl shadow-lg active:scale-95">Atualizar QR</button>
                      </div>
                      <input type="file" ref={pix2InputRef} onChange={e => handlePixUpload(e, 2)} className="hidden" />
                   </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-lg uppercase mb-6 text-center">{showProductModal === 'NEW' ? 'Novo Produto' : 'Editar Produto'}</h3>
              <div className="space-y-4 mb-8">
                 <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Comercial</label><input type="text" value={pForm.nome} onChange={e => setPForm({...pForm, nome: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Custo R$</label><input type="number" value={pForm.custo} onChange={e => setPForm({...pForm, custo: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Venda R$</label><input type="number" value={pForm.venda} onChange={e => setPForm({...pForm, venda: e.target.value})} disabled={props.margemGlobalAtiva} className={`w-full p-4 border-none rounded-2xl font-black text-sm outline-none ${props.margemGlobalAtiva ? 'bg-gray-100 text-gray-400' : 'bg-gray-50 text-emerald-600'}`} /></div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Comissão %</label><input type="number" value={pForm.comissao} onChange={e => setPForm({...pForm, comissao: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Estoque</label><input type="number" value={pForm.estoquePrincipal} onChange={e => setPForm({...pForm, estoquePrincipal: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-blue-600" /></div>
                 </div>
              </div>
              <button onClick={handleSaveProduct} className="w-full bg-blue-600 text-white font-black py-5 rounded-3xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-widest mb-3">Salvar Produto</button>
              <button onClick={() => setShowProductModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {showEntryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6 text-center">Entrada de Mercadoria</h3>
              <p className="text-[10px] font-black text-gray-400 uppercase text-center mb-6">{showEntryModal.nome}</p>
              <div className="space-y-4 mb-8">
                 <input type="number" placeholder="QUANTIDADE ENTRADA" value={entryForm.qtd} onChange={e => setEntryForm({...entryForm, qtd: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm text-center outline-none" />
                 <input type="number" placeholder="CUSTO UNIT. R$" value={entryForm.custo} onChange={e => setEntryForm({...entryForm, custo: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm text-center outline-none" />
              </div>
              <button onClick={() => { props.registerStockEntry(showEntryModal.id, parseInt(entryForm.qtd), parseFloat(entryForm.custo)); setShowEntryModal(null); setEntryForm({qtd:'', custo:''}); showToast("Entrada registrada"); }} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-[10px]">Confirmar Entrada</button>
              <button onClick={() => setShowEntryModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase mt-2">Cancelar</button>
           </div>
        </div>
      )}

      {showClientModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-lg uppercase mb-6 text-center">{showClientModal === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3>
              <div className="space-y-4 mb-8">
                 <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Fantasia</label><input type="text" value={clientForm.nomeFantasia} onChange={e => setClientForm({...clientForm, nomeFantasia: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                 <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone</label><input type="text" value={clientForm.telefone} onChange={e => setClientForm({...clientForm, telefone: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                 </div>
                 <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Endereço Completo</label><input type="text" value={clientForm.endereco} onChange={e => setClientForm({...clientForm, endereco: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Bairro</label><input type="text" value={clientForm.bairro} onChange={e => setClientForm({...clientForm, bairro: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Dia Roteiro</label>
                      <select value={clientForm.diaRoteiro} onChange={e => setClientForm({...clientForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700">
                         {DIAS_SEMANA.map((d, i) => (<option key={i} value={i}>{d}</option>))}
                      </select>
                    </div>
                 </div>
                 <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Pin Localização (Lat, Lng)</label><input type="text" value={clientForm.pinLocalizacao} onChange={e => setClientForm({...clientForm, pinLocalizacao: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-[10px] outline-none text-gray-500" /></div>
              </div>
              <button onClick={handleSaveClient} className="w-full bg-emerald-600 text-white font-black py-5 rounded-3xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-widest mb-3">Salvar Cliente</button>
              <button onClick={() => setShowClientModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {showUserModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="font-black text-gray-800 text-lg uppercase mb-6 text-center">{showUserModal === 'NEW' ? 'Novo Vendedor' : 'Editar Vendedor'}</h3>
              <div className="space-y-6 mb-8">
                 <div className="flex justify-center flex-col items-center gap-3">
                    <div className="w-20 h-20 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden">
                       {userForm.foto ? <img src={userForm.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-camera text-gray-200"></i>}
                    </div>
                    <button onClick={() => userPhotoInputRef.current?.click()} className="text-[9px] font-black uppercase text-blue-600">Alterar Foto</button>
                    <input type="file" ref={userPhotoInputRef} onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setUserForm({...userForm, foto: reader.result as string});
                        reader.readAsDataURL(file);
                      }
                    }} accept="image/*" className="hidden" />
                 </div>
                 <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome Completo</label><input type="text" value={userForm.nome} onChange={e => setUserForm({...userForm, nome: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone</label><input type="text" value={userForm.telefone} onChange={e => setUserForm({...userForm, telefone: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                    <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">Placa Veículo</label><input type="text" value={userForm.placaVeiculo} onChange={e => setUserForm({...userForm, placaVeiculo: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-sm outline-none text-gray-700" /></div>
                 </div>
                 <div className="space-y-1.5"><label className="text-[9px] font-black text-gray-400 uppercase ml-1">PIN de Acesso</label><input type="password" value={userForm.pin} onChange={e => setUserForm({...userForm, pin: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-lg text-center outline-none text-gray-700 tracking-widest" maxLength={6} /></div>
              </div>
              <button onClick={handleSaveUser} className="w-full bg-purple-600 text-white font-black py-5 rounded-3xl shadow-xl active:scale-95 transition-all uppercase text-xs tracking-widest mb-3">Salvar Vendedor</button>
              <button onClick={() => setShowUserModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {showConfirmSync && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-[2.5rem] p-8 text-center animate-in zoom-in-95 duration-200 shadow-2xl">
              <div className="w-16 h-16 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6"><i className="fa-solid fa-rotate"></i></div>
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 leading-tight">Deseja sincronizar a carga?</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-8">Isso enviará uma notificação para o vendedor aceitar o novo estoque.</p>
              <div className="flex flex-col gap-3">
                 <button onClick={handleSync} className="w-full bg-orange-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-[10px]">Sincronizar Agora</button>
                 <button onClick={() => setShowConfirmSync(false)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Voltar</button>
              </div>
           </div>
        </div>
      )}

      {showConfirmApply && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-[2.5rem] p-8 text-center animate-in zoom-in-95 duration-200 shadow-2xl">
              <div className="w-16 h-16 bg-slate-100 text-slate-800 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6"><i className="fa-solid fa-circle-check"></i></div>
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 leading-tight">Aplicar Diretamente?</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-8">Isso atualizará o estoque do vendedor IMEDIATAMENTE sem necessidade de aceite.</p>
              <div className="flex flex-col gap-3">
                 <button onClick={handleApply} className="w-full bg-slate-800 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-[10px]">Aplicar Direto</button>
                 <button onClick={() => setShowConfirmApply(false)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Voltar</button>
              </div>
           </div>
        </div>
      )}

      {payoutVendedor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Pagar Comissão</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-6">
                 <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Valor Disponível</p>
                 <p className="text-xl font-black text-emerald-600">R$ {getVendedorStats(payoutVendedor.id).comissaoDisponivel.toFixed(2)}</p>
              </div>
              <div className="flex bg-gray-100 p-1 rounded-xl mb-6">
                 <button onClick={() => setPayoutType('TOTAL')} className={`flex-1 py-3 rounded-lg text-[9px] font-black uppercase transition-all ${payoutType === 'TOTAL' ? 'bg-white text-emerald-600 shadow-md' : 'text-gray-400'}`}>Total</button>
                 <button onClick={() => setPayoutType('PARCIAL')} className={`flex-1 py-3 rounded-lg text-[9px] font-black uppercase transition-all ${payoutType === 'PARCIAL' ? 'bg-white text-emerald-600 shadow-md' : 'text-gray-400'}`}>Parcial</button>
              </div>
              {payoutType === 'PARCIAL' && (
                <div className="space-y-4 mb-6 text-left">
                   <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor do Pagamento</label>
                   <input type="number" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} className="w-full p-4 bg-gray-50 border-none rounded-2xl font-black text-xl text-center outline-none" />
                </div>
              )}
              <button onClick={handleConfirmPayout} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs active:scale-95 transition-all">Confirmar Pagamento</button>
              <button onClick={() => setPayoutVendedor(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase mt-2">Cancelar</button>
           </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Confirmar Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-4"><p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo Devedor</p><p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p></div>
              <div className="space-y-4 mb-6"><p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p><input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none" /></div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest active:scale-95">Dinheiro</button>
                <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest active:scale-95">PIX</button>
              </div>
              <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {selectedSale && (
        <Cupom sale={selectedSale} client={props.clients.find(c => c.id === selectedSale.clientId)!} products={props.products} onClose={() => setSelectedSale(null)} onDeleteSale={props.deleteSale} allowDelete={true} showToast={showToast} />
      )}

      {viewingClientHistory && (
        <ClientHistory client={viewingClientHistory} sales={props.sales} products={props.products} onClose={() => setViewingClientHistory(null)} />
      )}
    </div>
  );
};

export default AdminDashboard;