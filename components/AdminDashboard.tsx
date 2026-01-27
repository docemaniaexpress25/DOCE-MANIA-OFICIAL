import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CommissionPaymentLog } from '../types';
import { APP_CONFIG, DIAS_SEMANA } from '../constants';
import Cupom from './Cupom';

interface AdminDashboardProps {
  products: Product[];
  users: User[];
  cargas: Carga[];
  clients: Client[];
  addProduct: (n: string, c: number, v: number, com: number) => void;
  updateProduct: (id: string, data: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  registerStockEntry: (id: string, q: number, c: number) => void;
  adjustStockManual: (id: string, q: number, t: 'ADICAO' | 'SUBTRACAO') => void;
  syncVendedorCarga: (vId: string, itens: { produtoId: string, quantidade: number }[]) => void;
  applyCargaDirectly: (vId: string, itens: { produtoId: string, quantidade: number }[]) => void; // Nova prop
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
  const [showClientModal, setShowClientModal] = useState<Client | 'NEW' | null>(null);
  const [showConfirmSync, setShowConfirmSync] = useState(false);
  const [showConfirmApply, setShowConfirmApply] = useState(false); // Novo estado para aplicação direta
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

  const [pForm, setPForm] = useState({ nome: '', custo: '', venda: '', comissao: '', margem: '', ativo: true });
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
    const vSales = props.sales.filter(s => s.vendedorId === vId && s.statusPagamento === 'PAGO' && filterByPeriod(s.data, 'HOJE'));
    
    // Calcula o valor total de comissões que são elegíveis para pagamento (DISPONIVEL, PENDENTE_CONFIRMACAO, PAGO)
    const totalCommsEligible = props.commissions
      .filter(c => c.vendedorId === vId && c.status !== 'A_RECEBER')
      .reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
      
    const jaPago = props.payoutLogs.filter(l => l.vendedorId === vId).reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 
    
    // A comissão disponível é o total elegível menos o que já foi pago
    const comissaoDisponivel = Math.max(0, totalCommsEligible - jaPago);
    
    return {
      vendasHoje: Number(vSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), 
      comissaoDisponivel: Number(comissaoDisponivel.toFixed(2)),
    };
  };

  const filteredHistory = useMemo(() => {
    return props.sales.filter(s => filterByPeriod(s.data, filtroPeriodo))
      .sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)); 
  }, [props.sales, filtroPeriodo]);

  const reportStats = useMemo(() => {
    const sales = props.sales.filter(s => filterByPeriod(s.data, periodoRelatorio));
    const totalVendas = sales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0); 
    const ticketMedio = sales.length > 0 ? totalVendas / sales.length : 0;
    
    const paidCommissions = props.payoutLogs
      .filter(l => filterByPeriod(l.dataPagamento, periodoRelatorio))
      .reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 

    const clientRevenue: { [id: string]: { nome: string, total: number } } = {};
    sales.forEach(s => {
      const c = props.clients.find(cli => cli.id === s.clientId);
      const name = c?.nomeFantasia || 'Desconhecido';
      if (!clientRevenue[s.clientId]) clientRevenue[s.clientId] = { nome: name, total: 0 };
      clientRevenue[s.clientId].total += (s.valorTotal ?? 0); 
    });

    const topClients = Object.values(clientRevenue).sort((a, b) => b.total - a.total).slice(0, 10);

    const prodMap: { [id: string]: { nome: string, qtd: number, valor: number } } = {};
    sales.forEach(s => {
      s.itens.forEach(item => {
        if (!prodMap[item.produtoId]) {
          const p = props.products.find(prod => prod.id === item.produtoId);
          prodMap[item.produtoId] = { nome: p?.nome || 'Desconhecido', qtd: 0, valor: 0 };
        }
        prodMap[item.produtoId].qtd += (item.quantidade ?? 0); 
        prodMap[item.produtoId].valor += ((item.quantidade ?? 0) * (item.precoVenda ?? 0)); 
      });
    });
    const rankingProdutos = Object.values(prodMap).sort((a, b) => b.qtd - a.qtd).slice(0, 10);
    
    const sellerPerformance = props.users.filter(u => u.role === 'VENDEDOR').map((v: User) => {
      const vSales = sales.filter(s => s.vendedorId === v.id);
      return { nome: v.nome ?? 'Desconhecido', total: vSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0) }; 
    }).sort((a, b) => b.total - a.total);

    return { totalVendas: Number(totalVendas.toFixed(2)), ticketMedio: Number(ticketMedio.toFixed(2)), totalComissaoPaga: Number(paidCommissions.toFixed(2)), rankingProdutos, sellerPerformance, topClients };
  }, [props.sales, props.products, props.users, props.payoutLogs, props.clients, periodoRelatorio]);

  const handleOpenProduct = (p: Product | 'NEW') => {
    if (p === 'NEW') {
      setPForm({ nome: '', custo: '', venda: '', comissao: '', margem: props.margemGlobalAtiva ? props.margemGlobalValor.toString() : '35', ativo: true });
    } else {
      const precoVenda = Number(p.precoVenda) || 0;
      const precoCusto = Number(p.precoCusto) || 0;
      const margemCalculada = precoVenda > 0 ? ((precoVenda - precoCusto) / precoVenda) * 100 : 0;
      setPForm({ 
        nome: p.nome ?? '', 
        custo: precoCusto.toString(), 
        venda: precoVenda.toString(), 
        comissao: (p.comissaoPercentual ?? 0).toString(), 
        margem: margemCalculada.toFixed(2), 
        ativo: p.ativo ?? true 
      });
    }
    setShowProductModal(p);
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

  const handleSaveProduct = () => {
    if (!pForm.nome || !pForm.custo || !pForm.venda || !pForm.comissao) return alert("Preencha todos os campos.");
    const data = { 
      nome: pForm.nome, 
      precoCusto: parseFloat(pForm.custo), 
      precoVenda: parseFloat(pForm.venda), 
      comissaoPercentual: parseFloat(pForm.comissao), 
      ativo: pForm.ativo ?? true 
    };
    if (showProductModal === 'NEW') props.addProduct(data.nome, data.precoCusto, data.precoVenda, data.comissaoPercentual);
    else if (typeof showProductModal === 'object') props.updateProduct(showProductModal.id, data);
    showToast("Produto salvo com sucesso");
    setShowProductModal(null);
  };

  const updateStaging = (pId: string, delta: number) => {
    const p = props.products.find(prod => prod.id === pId);
    if (!p) return;
    const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === pId)?.quantidade ?? 0; 
    const totalDisp = (p.estoquePrincipal ?? 0) + noV; 
    const novaQ = Math.max(0, Math.min(totalDisp, (stagingCarga[pId] ?? 0) + delta));
    setStagingCarga(prev => ({ ...prev, [pId]: novaQ }));
  };

  const handleSync = () => {
    const itens = Object.entries(stagingCarga).map(([produtoId, quantidade]) => ({ produtoId, quantidade: quantidade ?? 0 })); 
    props.syncVendedorCarga(selectedVendedorId, itens);
    setShowConfirmSync(false);
    showToast("Carga enviada para aceite do vendedor.");
  };

  const handleApply = () => {
    const itens = Object.entries(stagingCarga).map(([produtoId, quantidade]) => ({ produtoId, quantidade: quantidade ?? 0 })); 
    props.applyCargaDirectly(selectedVendedorId, itens);
    setShowConfirmApply(false);
    showToast("Carga aplicada imediatamente.");
  };

  const handleOpenClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setClientForm({ nomeFantasia: '', telefone: '', diaRoteiro: 1, ativo: true, bairro: '', endereco: '', ativarCnpj: false, cnpj: '', pinLocalizacao: '' });
    else setClientForm({ ...c });
    setShowClientModal(c);
  };

  const handlePinLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const pin = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        setClientForm(prev => ({ ...prev, pinLocalizacao: pin }));
        showToast("Localização capturada!");
      }, () => {
        alert("Erro ao capturar localização. Verifique as permissões do GPS.");
      });
    }
  };

  const handleSaveClient = () => {
    if (!clientForm.nomeFantasia) return alert("Nome é obrigatório!");
    if ((clientForm.ativarCnpj ?? false) && !(clientForm.cnpj)) return alert("CNPJ é obrigatório!"); 
    const data: Omit<Client, 'id'> = { 
        nomeFantasia: clientForm.nomeFantasia || '', telefone: clientForm.telefone || '', diaRoteiro: clientForm.diaRoteiro || 1, ativo: clientForm.ativo ?? true, bairro: clientForm.bairro || '', endereco: clientForm.endereco || '',
        ativarCnpj: clientForm.ativarCnpj ?? false, cnpj: clientForm.cnpj || '', pinLocalizacao: clientForm.pinLocalizacao || ''
    };
    if (showClientModal === 'NEW') props.addClient(data);
    else if (typeof showClientModal === 'object') props.updateClient(showClientModal.id, data);
    showToast("Cliente salvo com sucesso");
    setShowClientModal(null);
  };

  const handleOpenUserModal = (u: User | 'NEW') => {
    if (u === 'NEW') setUserForm({ nome: '', telefone: '', foto: '', pin: '123456' });
    else setUserForm({ nome: u.nome ?? '', telefone: u.telefone ?? '', foto: u.foto ?? '', pin: u.pin ?? '' }); 
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
    if (!userForm.nome) return alert("Nome é obrigatório");
    if (showUserModal === 'NEW') props.addUser(userForm.nome, userForm.foto, userForm.telefone); 
    else if (typeof showUserModal === 'object') props.updateUser(showUserModal.id, userForm);
    showToast("Vendedor salvo com sucesso");
    setShowUserModal(null);
  };

  const handleUpdatePassword = () => {
    if (!pwUser || !pwNew) return alert("Selecione um usuário e digite a nova senha.");
    props.updateUser(pwUser, { pin: pwNew }); 
    setPwNew('');
    showToast("Senha atualizada com sucesso.");
  };

  const getClientAvgRevenue = (clientId: string) => {
    const cSales = props.sales.filter(s => s.clientId === clientId).slice(-3);
    if (cSales.length === 0) return "0.00";
    const total = cSales.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0); 
    return (total / cSales.length).toFixed(2);
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
        showToast("QR Code Pix atualizado.");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleOpenPayout = (u: User) => {
    setPayoutVendedor(u);
    setPayoutType('TOTAL');
    setPartialAmount('');
  };

  const handleConfirmPayout = () => {
    if (!payoutVendedor) return;
    const stats = getVendedorStats(payoutVendedor.id);
    const available = stats.comissaoDisponivel;
    const amountToPay = payoutType === 'TOTAL' ? available : parseFloat(partialAmount);
    if (isNaN(amountToPay) || amountToPay <= 0 || amountToPay > available) return alert("Valor inválido.");
    props.payCommission(payoutVendedor.id, amountToPay, payoutType, props.adminUser.id);
    setPayoutVendedor(null);
    showToast("Comissão paga com sucesso");
  };

  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    const saldoEmAberto = Number(((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)); 
    
    if (isNaN(valor) || valor <= 0 || valor > saldoEmAberto) {
        alert("Valor inválido.");
        return;
    }

    props.receiveAccount(showReceiveModal.id, method, valor);
    showToast(valor === saldoEmAberto ? "Conta quitada!" : "Pagamento parcial registrado!");
    setShowReceiveModal(null);
    setValorRecebidoParcial('');
  };

  const MenuCard = ({ icon, title, tab, color }: { icon: string, title: string, tab: any, color: string }) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-3 active:scale-95 transition-all text-center group">
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner group-hover:scale-110 transition-transform`}>
        <i className={`fa-solid ${icon}`}></i>
      </div>
      <span className="text-[11px] font-black uppercase text-gray-700 tracking-tight">{title}</span>
    </button>
  );

  const contasAReceber = useMemo(() => props.sales.filter(s => s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [props.sales]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center animate-in slide-in-from-top duration-300 pointer-events-none">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3`}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
            {toast.message}
          </div>
        </div>
      )}

      {activeTab !== 'HOME' && (
        <button onClick={() => setActiveTab('HOME')} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90 transition-transform mb-2">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
      )}

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

      {/* HISTÓRICO TAB */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-6 py-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Vendas Realizadas</h2>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Auditoria e Histórico</p>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">
            {(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (
              <button key={p} onClick={() => setFiltroPeriodo(p)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${filtroPeriodo === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>
            ))}
          </div>
          <div className="grid gap-3 px-1">
            {filteredHistory.map((s: Sale) => {
              const today = new Date();
              const saleDate = new Date(s.data ?? today); 
              return (
                <button key={s.id} onClick={() => setSelectedSale(s)} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col transition-all hover:border-blue-200 text-left w-full">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9px] font-black text-gray-400 uppercase">{(s.data ?? today).toLocaleDateString()} {(s.data ?? today).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span> 
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${s.statusPagamento === 'PAGO' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{s.statusPagamento === 'PAGO' ? 'RECEBIDA' : 'EM ABERTO'}</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm leading-tight">{props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4>
                      <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vend: {props.users.find(u => u.id === s.vendedorId)?.nome ?? 'Desconhecido'} • {s.metodoPagamento?.replace('_', ' ') ?? 'N/D'}</p> 
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-gray-800">R$ {(s.valorTotal ?? 0).toFixed(2)}</p> 
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredHistory.length === 0 && <div className="text-center py-20 opacity-30 italic text-xs font-bold uppercase">Nenhuma venda encontrada</div>}
          </div>
        </div>
      )}

      {/* ROTEIRO TAB */}
      {activeTab === 'ROTEIRO' && (
        <div className="space-y-6 py-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Roteiro Semanal</h2>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Visualização por Dia</p>
          </div>
          <div className="space-y-3 px-1">
            {[1, 2, 3, 4, 5, 6].map(dia => {
              const isOpen = expandedDay === dia;
              const clientsInDay = props.clients.filter(c => (c.diaRoteiro ?? 0) === dia && (c.ativo ?? false)); 
              return (
                <div key={dia} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                  <button onClick={() => setExpandedDay(isOpen ? null : dia)} className={`w-full flex items-center justify-between p-5 text-left transition-colors ${isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-700'}`}>
                    <div className="flex items-center gap-3">
                       <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${isOpen ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{dia}</div>
                       <span className="font-black uppercase text-xs tracking-tight">{DIAS_SEMANA[dia] ?? 'N/D'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black uppercase opacity-40">{clientsInDay.length} clientes</span>
                      <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`}></i>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="p-4 bg-white space-y-2 border-t border-indigo-50 animate-in slide-in-from-top duration-300">
                      {clientsInDay.map((c: Client) => (
                        <div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center">
                          <div>
                            <p className="font-bold text-gray-800 text-xs">{c.nomeFantasia ?? 'Cliente Desconhecido'}</p> 
                            <p className="text-[9px] text-gray-400 font-bold mt-0.5">{(c.telefone || 'Sem fone')} {c.bairro ? `• ${c.bairro}` : ''}</p> 
                          </div>
                        </div>
                      ))}
                      {clientsInDay.length === 0 && <p className="text-center py-4 text-[10px] text-gray-400 font-bold uppercase">Nenhum cliente</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CONTAS A RECEBER TAB */}
      {activeTab === 'CONTAS_RECEBER' && (
        <div className="space-y-6 py-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Contas a Receber</h2>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Vendas em Aberto</p>
          </div>
          <div className="grid gap-3 px-1">
            {contasAReceber.map((s: Sale) => {
              const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2)); 
              return (
              <div key={s.id} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[9px] font-black text-gray-400 uppercase">{(s.data ?? new Date()).toLocaleDateString()}</span> 
                  <span className="bg-rose-50 text-rose-600 text-[9px] font-black px-2 py-0.5 rounded uppercase">EM ABERTO</span>
                </div>
                <div className="flex justify-between items-end">
                   <div>
                     <h4 className="font-bold text-gray-800 text-sm leading-tight">{props.clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4>
                     <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">Vend: {props.users.find(u => u.id === s.vendedorId)?.nome ?? 'Desconhecido'}</p> 
                     {(s.valorPago ?? 0) > 0 && <p className="text-[9px] text-emerald-600 font-bold uppercase mt-1">Já pago: R$ {(s.valorPago ?? 0).toFixed(2)}</p>} 
                   </div>
                   <div className="text-right">
                     <p className="text-sm font-black text-gray-800 mb-2">Saldo: R$ {saldo.toFixed(2)}</p>
                     <button onClick={() => { setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95">RECEBER</button>
                   </div>
                </div>
              </div>
            )})}
            {contasAReceber.length === 0 && <div className="text-center py-20 opacity-30 italic text-[10px] uppercase font-bold">Sem contas pendentes</div>}
          </div>
        </div>
      )}

      {/* CATALOGO (ESTOQUE) TAB */}
      {activeTab === 'CATALOGO' && (
        <div className="space-y-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Estoque Central</h2>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Produtos e Preços</p>
          </div>
          <div className="flex gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..." className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium" />
            <button onClick={() => handleOpenProduct('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-plus"></i></button>
          </div>
          <div className="grid gap-3">
            {props.products.filter(p => (p.nome ?? '').toLowerCase().includes(search.toLowerCase())).map((p: Product) => ( 
              <div key={p.id} className="bg-white px-4 py-3 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between transition-all hover:border-blue-200">
                <div className="flex-1 min-w-0 pr-3">
                  <h3 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2">{p.nome ?? 'Produto sem nome'}</h3> 
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] font-black bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100 shadow-inner">
                      Estoque: {(p.estoquePrincipal ?? 0)} un 
                    </span>
                    <span className="text-sm font-black text-emerald-600">R$ {(p.precoVenda ?? 0).toFixed(2)}</span> 
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setShowEntryModal(p); setEntryForm({ qtd: '', custo: (p.precoCusto ?? 0).toString() }); }} className="bg-emerald-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-md active:scale-90 transition-all border-2 border-emerald-700" title="Entrada"><i className="fa-solid fa-plus-circle text-lg"></i></button>
                  <button onClick={() => handleOpenProduct(p)} className="bg-blue-50 text-blue-600 w-12 h-12 rounded-xl border-2 border-blue-100 flex items-center justify-center active:scale-90 transition-all shadow-sm" title="Editar"><i className="fa-solid fa-pencil-alt text-lg"></i></button>
                  <button onClick={() => { if(confirm("Excluir produto?")) { props.deleteProduct(p.id); showToast("Produto excluído ou desativado"); } }} className="text-gray-300 hover:text-red-500 w-12 h-12 rounded-xl flex items-center justify-center active:scale-90 transition-colors" title="Excluir"><i className="fa-solid fa-trash-can text-lg"></i></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CARGAS TAB */}
      {activeTab === 'CARGAS' && (
        <div className="space-y-4">
          <div className="px-2"><h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Cargas</h2></div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="font-black text-gray-800 mb-4 uppercase text-[10px]">Vendedor Responsável</h3>
            <select value={selectedVendedorId} onChange={e => setSelectedVendedorId(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-semibold text-sm">
              <option value="">Selecione um vendedor...</option>
              {props.users.filter((u: User) => (u.role === 'VENDEDOR') && (u.ativo ?? false)).map((u: User) => <option key={u.id} value={u.id}>{u.nome ?? 'Vendedor Desconhecido'}</option>)} 
            </select>
          </div>
          {selectedVendedorId && (
            <>
              <div className="grid gap-2 mb-24 px-1">
                {props.products.map((p: Product) => { 
                  const noV = props.cargas.find(c => c.vendedorId === selectedVendedorId && c.produtoId === p.id)?.quantidade ?? 0; 
                  const meta = stagingCarga[p.id] ?? 0;
                  const totalDisp = (p.estoquePrincipal ?? 0) + noV; 
                  return (
                    <div key={p.id} className="bg-white px-4 py-3 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                      <div className="flex-1 min-w-0 pr-3">
                        <h4 className="font-bold text-gray-800 text-sm leading-tight">{p.nome ?? 'Produto sem nome'}</h4> 
                        <p className="text-[10px] text-gray-400 font-semibold mt-1">Central: {(p.estoquePrincipal ?? 0)} | Veículo: {noV}</p> 
                      </div>
                      <div className="flex items-center bg-gray-50 rounded-xl p-1 gap-1">
                        <button onClick={() => updateStaging(p.id, -1)} className="w-9 h-9 bg-white border border-gray-200 text-gray-400 rounded-lg active:scale-90 flex items-center justify-center"><i className="fa-solid fa-minus text-xs"></i></button>
                        <span className="font-black text-sm min-w-[28px] text-center">{meta}</span>
                        <button onClick={() => updateStaging(p.id, 1)} className="w-9 h-9 bg-blue-600 text-white rounded-lg active:scale-90 shadow-sm flex items-center justify-center"><i className="fa-solid fa-plus text-xs"></i></button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="fixed bottom-4 left-4 right-4 max-w-lg mx-auto z-50 flex flex-col gap-2">
                <button 
                  onClick={() => setShowConfirmApply(true)} 
                  disabled={!hasCargaChanges}
                  className={`w-full font-black py-5 rounded-3xl shadow-xl flex items-center justify-center gap-3 transition-all ${hasCargaChanges ? 'bg-emerald-600 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                >
                  <i className="fa-solid fa-check-circle"></i> APLICAR CARGA IMEDIATAMENTE
                </button>
                <button 
                  onClick={() => setShowConfirmSync(true)} 
                  disabled={!hasCargaChanges}
                  className={`w-full font-black py-5 rounded-3xl shadow-xl flex items-center justify-center gap-3 transition-all ${hasCargaChanges ? 'bg-gray-900 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                >
                  <i className="fa-solid fa-truck-loading"></i> ENVIAR CARGA PENDENTE
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* CLIENTES TAB */}
      {activeTab === 'CLIENTES' && (
        <div className="space-y-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Gestão de Clientes</h2>
          </div>
          <div className="flex gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..." className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm" />
            <button onClick={() => handleOpenClient('NEW')} className="bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-lg active:scale-90 transition-transform"><i className="fa-solid fa-user-plus"></i></button>
          </div>
          <div className="grid gap-3">
            {props.clients.filter(c => (c.nomeFantasia ?? '').toLowerCase().includes(search.toLowerCase())).map((c: Client) => ( 
              <div key={c.id} className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-800 text-sm leading-tight">{c.nomeFantasia ?? 'Cliente sem nome'}</h3> 
                    <p className="text-[10px] text-gray-400 font-semibold uppercase mt-1">{DIAS_SEMANA[c.diaRoteiro ?? 0] ?? 'N/D'} {c.cnpj ? `• CNPJ: ${c.cnpj}` : ''}</p> 
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleOpenClient(c)} className="text-gray-300 hover:text-blue-600 w-10 h-10 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-pencil-alt"></i></button>
                    <button onClick={() => { if(confirm("Excluir cliente?")) { props.deleteClient(c.id); showToast("Cliente removido"); } }} className="text-gray-300 hover:text-red-500 w-10 h-10 rounded-xl flex items-center justify-center active:scale-90"><i className="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-chart-line text-blue-400 text-xs"></i>
                    <span className="text-[10px] font-black text-gray-400 uppercase">Média de Faturamento</span>
                  </div>
                  <span className="text-xs font-black text-gray-800">R$ {getClientAvgRevenue(c.id)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CAIXA TAB */}
      {activeTab === 'CAIXA' && (
        <div className="space-y-6 py-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Caixa</h2>
          </div>
          <div className="grid gap-4 px-1">
            {props.users.filter((u: User) => (u.role === 'VENDEDOR') && (u.ativo ?? false)).map((v: User) => { 
              const stats = getVendedorStats(v.id);
              return (
                <div key={v.id} className="bg-white rounded-[2.5rem] shadow-xl border-t-4 border-blue-500 p-8 flex flex-col gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-3xl flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-md">
                      {v.foto ? <img src={v.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user text-2xl"></i>}
                    </div>
                    <div>
                      <h3 className="font-black text-gray-800 text-lg leading-none mb-1">{v.nome ?? 'Vendedor Desconhecido'}</h3> 
                      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Performance Hoje</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-5 rounded-[2rem] border border-gray-100 flex flex-col items-center">
                      <p className="text-[9px] text-gray-400 font-black uppercase mb-2">Vendas Hoje</p>
                      <p className="text-lg font-black text-gray-800">R$ {stats.vendasHoje.toFixed(2)}</p>
                    </div>
                    <div className="bg-emerald-50 p-5 rounded-[2rem] border border-emerald-100 flex flex-col items-center">
                      <p className="text-[9px] text-emerald-600 font-black uppercase mb-2">Comissão Disp.</p>
                      <p className="text-lg font-black text-emerald-700">R$ {stats.comissaoDisponivel.toFixed(2)}</p>
                    </div>
                  </div>
                  <button onClick={() => handleOpenPayout(v)} className="w-full bg-emerald-600 text-white py-5 rounded-3xl font-black text-xs uppercase shadow-xl active:scale-95 transition-all">Pagar Comissão</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VENDEDORES TAB */}
      {activeTab === 'VENDEDORES' && (
        <div className="space-y-4">
          <div className="px-2 flex justify-between items-center">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Vendedores</h2>
            <button onClick={() => handleOpenUserModal('NEW')} className="bg-purple-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-md active:scale-95"><i className="fa-solid fa-plus mr-2"></i>Novo</button>
          </div>
          <div className="grid gap-3">
            {props.users.filter(u => u.role === 'VENDEDOR').map((u: User) => (
              <div key={u.id} className={`bg-white p-4 rounded-3xl border transition-all shadow-sm flex items-center justify-between ${!(u.ativo ?? false) ? 'opacity-60 grayscale' : 'border-gray-100'}`}> 
                <div onClick={() => handleOpenUserModal(u)} className="flex items-center gap-4 flex-1 cursor-pointer">
                  <div className="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center font-black overflow-hidden border-2 border-white shadow-md">
                    {(u.foto) ? <img src={u.foto} className="w-full h-full object-cover" /> : <i className="fa-solid fa-user-tie text-xl"></i>} 
                  </div>
                  <div>
                    <p className="font-bold text-gray-800 text-sm leading-tight">{u.nome ?? 'Vendedor Desconhecido'}</p> 
                    <p className="text-[10px] text-gray-400 font-bold mt-1 uppercase">{(u.telefone || 'Sem telefone')}</p> 
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); props.updateUser(u.id, { ativo: !(u.ativo ?? false) }); }} className={`w-12 h-6 rounded-full relative transition-colors ${(u.ativo ?? false) ? 'bg-green-500' : 'bg-gray-300'}`}> 
                   <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${(u.ativo ?? false) ? 'left-7' : 'left-1'}`}></div>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* REPORTS TAB */}
      {activeTab === 'REPORTS' && (
        <div className="space-y-6 py-4">
          <div className="px-2">
            <h2 className="text-2xl font-black text-gray-800 tracking-tight">Relatórios</h2>
          </div>
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">
            {(['HOJE', 'SEMANA', 'MES', 'GERAL'] as const).map(p => (
              <button key={p} onClick={() => setPeriodoRelatorio(p)} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all ${periodoRelatorio === p ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'}`}>{p}</button>
            ))}
          </div>
          
          <div className="grid grid-cols-2 gap-4 px-1">
             <div className="bg-white p-6 rounded-[2rem] shadow-sm border-b-4 border-emerald-500">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Vendas Totais</p>
                <p className="text-xl font-black text-gray-800">R$ {reportStats.totalVendas.toFixed(2)}</p>
             </div>
             <div className="bg-white p-6 rounded-[2rem] shadow-sm border-b-4 border-blue-500">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Comissão Paga</p>
                <p className="text-xl font-black text-gray-800">R$ {reportStats.totalComissaoPaga.toFixed(2)}</p>
             </div>
          </div>

          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden mx-1">
             <div className="p-6 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
                <h3 className="text-[10px] font-black text-gray-400 uppercase">👥 Top Clientes (Faturamento)</h3>
                <i className="fa-solid fa-star text-yellow-500"></i>
             </div>
             <div className="divide-y divide-gray-50">
                {reportStats.topClients.map((c, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 px-6">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-gray-300 w-4">{idx + 1}º</span>
                      <span className="text-xs font-bold text-gray-700">{c.nome ?? 'Cliente Desconhecido'}</span> 
                    </div>
                    <p className="text-xs font-black text-emerald-600">R$ {c.total.toFixed(2)}</p>
                  </div>
                ))}
             </div>
          </div>

          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden mx-1">
             <div className="p-6 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
                <h3 className="text-[10px] font-black text-gray-400 uppercase">📦 Top 10 Produtos</h3>
                <i className="fa-solid fa-trophy text-yellow-500"></i>
             </div>
             <div className="divide-y divide-gray-50">
                {reportStats.rankingProdutos.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 px-6">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black text-gray-300 w-4">{idx + 1}º</span>
                      <span className="text-xs font-bold text-gray-700">{p.nome ?? 'Produto Desconhecido'}</span> 
                    </div>
                    <p className="text-xs font-black text-gray-800">{p.qtd} un</p>
                  </div>
                ))}
             </div>
          </div>
        </div>
      )}

      {/* CONFIGURAÇÕES TAB */}
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
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Configurações de Pix (QR Codes)</h3>
             <div className="space-y-8">
                <div className="space-y-4">
                   <div className="flex gap-4 items-center">
                      <div className="flex-1 space-y-1">
                         <label className="text-[10px] font-black text-gray-400 uppercase">Nome Pix 1</label>
                         <input value={props.pix1Name ?? ''} onChange={e => props.setPix1Name(e.target.value)} className="w-full p-4 bg-gray-50 rounded-xl border-none outline-none font-bold text-xs" />
                      </div>
                      <div onClick={() => pix1InputRef.current?.click()} className="w-20 h-20 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center cursor-pointer overflow-hidden">
                         {props.pix1Code ? <img src={props.pix1Code} alt="QR Code Pix 1" className="w-full h-full object-cover" /> : <i className="fa-solid fa-qrcode text-gray-300"></i>}
                      </div>
                      <input type="file" ref={pix1InputRef} onChange={e => handlePixUpload(e, 1)} className="hidden" accept="image/*" />
                   </div>
                </div>
                <div className="space-y-4 border-t border-gray-100 pt-6">
                   <div className="flex gap-4 items-center">
                      <div className="flex-1 space-y-1">
                         <label className="text-[10px] font-black text-gray-400 uppercase">Nome Pix 2</label>
                         <input value={props.pix2Name ?? ''} onChange={e => props.setPix2Name(e.target.value)} className="w-full p-4 bg-gray-50 rounded-xl border-none outline-none font-bold text-xs" />
                      </div>
                      <div onClick={() => pix2InputRef.current?.click()} className="w-20 h-20 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center cursor-pointer overflow-hidden">
                         {props.pix2Code ? <img src={props.pix2Code} alt="QR Code Pix 2" className="w-full h-full object-cover" /> : <i className="fa-solid fa-qrcode text-gray-300"></i>}
                      </div>
                      <input type="file" ref={pix2InputRef} onChange={e => handlePixUpload(e, 2)} className="hidden" accept="image/*" />
                   </div>
                </div>
             </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Segurança / Senhas</h3>
             <div className="space-y-4">
                <div className="space-y-1">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Usuário</label>
                   <select value={pwUser} onChange={e => setPwUser(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none">
                      <option value="">Selecione...</option>
                      {props.users.map((u: User) => <option key={u.id} value={u.id}>{u.nome ?? 'Usuário Desconhecido'} ({u.role ?? 'N/D'})</option>)} 
                   </select>
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Nova Senha</label>
                   <input 
                    type="password" 
                    value={pwNew} 
                    onChange={e => setPwNew(e.target.value)} 
                    placeholder="••••••"
                    className="w-full p-4 bg-gray-50 rounded-2xl font-black text-xl tracking-widest border-none outline-none" 
                   />
                </div>
                <button onClick={handleUpdatePassword} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 transition-all">Atualizar Senha</button>
             </div>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
             <h3 className="font-black text-gray-800 uppercase text-xs mb-6">Margens Líquidas</h3>
             
             <div className="flex justify-between items-center mb-6">
                <span className="text-xs font-bold text-gray-600">Ativar margem global?</span>
                <button onClick={() => props.setMargemGlobalAtiva(!props.margemGlobalAtiva)} className={`w-12 h-6 rounded-full relative transition-colors ${props.margemGlobalAtiva ? 'bg-blue-600' : 'bg-gray-300'}`}>
                   <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemGlobalAtiva ? 'left-7' : 'left-1'}`}></div>
                </button>
             </div>
             
             <div className="space-y-6">
                {props.margemGlobalAtiva && (
                    <div className="animate-in slide-in-from-top duration-200">
                       <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Margem Líquida Global (%)</p>
                       <input type="number" value={props.margemGlobalValor ?? 0} onChange={e => props.setMargemGlobalValor(Number(e.target.value))} className="w-full p-4 bg-gray-50 rounded-2xl border-none font-black text-xl text-blue-600" />
                    </div>
                )}

                <div className="pt-4 border-t border-gray-50">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-xs font-bold text-gray-600">Ativar trava de margem mínima?</span>
                        <button onClick={() => props.setMargemMinimaAtiva(!props.margemMinimaAtiva)} className={`w-12 h-6 rounded-full relative transition-colors ${props.margemMinimaAtiva ? 'bg-rose-600' : 'bg-gray-300'}`}>
                           <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${props.margemMinimaAtiva ? 'left-7' : 'left-1'}`}></div>
                        </button>
                    </div>
                    {props.margemMinimaAtiva && (
                        <div className="animate-in slide-in-from-top duration-200">
                            <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Margem Líquida Mínima (%)</p>
                            <input type="number" value={props.margemMinima ?? 0} onChange={e => props.setMargemMinima(Number(e.target.value))} className="w-full p-4 bg-rose-50 rounded-2xl border-none font-black text-xl text-rose-600" />
                        </div>
                    )}
                </div>
             </div>
          </div>
        </div>
      )}

      {/* MODAL PAGAMENTO COMISSÃO */}
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
              {payoutType === 'PARCIAL' && (
                 <input type="number" placeholder="Valor" className="w-full p-4 bg-gray-50 border rounded-2xl font-black mb-6" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} />
              )}
              <button onClick={handleConfirmPayout} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase shadow-lg active:scale-95 mb-2">Confirmar Pagamento</button>
              <button onClick={() => setPayoutVendedor(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
           </div>
        </div>
      )}

      {/* MODAL VENDEDOR */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl">
              <h3 className="font-black text-gray-800 uppercase text-sm mb-6 text-center">{showUserModal === 'NEW' ? 'Novo Vendedor' : 'Editar Vendedor'}</h3>
              
              <div className="flex flex-col items-center mb-6">
                <div onClick={() => userPhotoInputRef.current?.click()} className="w-24 h-24 bg-purple-100 text-purple-600 rounded-[2rem] flex items-center justify-center font-black overflow-hidden border-4 border-white shadow-xl cursor-pointer relative group transition-all hover:scale-105">
                  {userForm.foto ? <img src={userForm.foto} alt="Foto do Vendedor" className="w-full h-full object-cover" /> : <i className="fa-solid fa-camera text-2xl"></i>}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-black uppercase">Alterar</div>
                </div>
                <input type="file" ref={userPhotoInputRef} onChange={handleUserPhotoUpload} className="hidden" accept="image/*" />
              </div>

              <div className="space-y-4">
                 <div className="space-y-1">
                   <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Nome do Vendedor</label>
                   <input value={userForm.nome ?? ''} onChange={e => setUserForm({...userForm, nome: e.target.value})} placeholder="Nome Completo" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" />
                 </div>
                 <div className="space-y-1">
                   <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label>
                   <input value={userForm.telefone ?? ''} onChange={e => setUserForm({...userForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" />
                 </div>
                 <div className="space-y-1">
                   <label className="text-[9px] font-black text-gray-400 uppercase ml-1">PIN de Acesso (6 dígitos)</label>
                   <input value={userForm.pin ?? ''} onChange={e => setUserForm({...userForm, pin: e.target.value})} placeholder="123456" maxLength={6} className="w-full p-4 bg-gray-50 border rounded-2xl font-black text-center text-xl tracking-[0.5em]" />
                 </div>
                 <button onClick={handleSaveUser} className="w-full bg-purple-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 uppercase text-xs mt-4">Salvar Vendedor</button>
                 <button onClick={() => setShowUserModal(null)} className="w-full py-2 text-gray-400 font-bold text-[9px] uppercase text-center">Cancelar</button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL PRODUTO */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 animate-in slide-in-from-bottom duration-300 shadow-2xl">
            <h3 className="font-black text-gray-800 uppercase text-sm mb-6">{showProductModal === 'NEW' ? 'Novo Produto' : 'Editar Produto'}</h3>
            <div className="space-y-4">
              <input value={pForm.nome ?? ''} onChange={e => setPForm({...pForm, nome: e.target.value})} placeholder="Nome Comercial" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" />
              <div className="grid grid-cols-2 gap-4">
                <input type="number" value={pForm.custo ?? ''} onChange={e => { const c = e.target.value; const nv = updatePriceFromMargin(parseFloat(c)||0, parseFloat(pForm.margem)||0).toFixed(2); setPForm({...pForm, custo: c, venda: nv}); }} placeholder="Custo R$" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" />
                <input type="number" value={pForm.margem ?? ''} disabled={props.margemGlobalAtiva} onChange={e => { const m = e.target.value; const nv = updatePriceFromMargin(parseFloat(pForm.custo)||0, parseFloat(m)||0).toFixed(2); setPForm({...pForm, margem: m, venda: nv}); }} placeholder="Margem %" className={`w-full p-4 border rounded-2xl font-bold ${props.margemGlobalAtiva ? 'bg-gray-100 opacity-50' : 'bg-gray-50'}`} />
              </div>
              <input type="number" value={pForm.venda ?? ''} disabled={props.margemGlobalAtiva} onChange={e => { const v = e.target.value; const nm = updateMarginFromPrice(parseFloat(pForm.custo)||0, parseFloat(v)||0).toFixed(2); setPForm({...pForm, venda: v, margem: nm}); }} placeholder="Venda R$" className={`w-full p-4 border rounded-2xl font-black text-lg ${props.margemGlobalAtiva ? 'bg-gray-100 opacity-50' : 'bg-green-50'}`} />
              <input type="number" value={pForm.comissao ?? ''} onChange={e => setPForm({...pForm, comissao: e.target.value})} placeholder="Comissão %" className="w-full p-4 bg-yellow-50 border rounded-2xl font-bold" />
              <button onClick={handleSaveProduct} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 transition-all">SALVAR PRODUTO</button>
              <button onClick={() => setShowProductModal(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CLIENTE */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
            <h3 className="font-black text-gray-800 uppercase text-sm mb-6">{showClientModal === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3>
            <div className="space-y-4">
              <input value={clientForm.nomeFantasia ?? ''} onChange={e => setClientForm({...clientForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" />
              <div className="flex items-center justify-between p-2">
                <span className="text-xs font-bold text-gray-600 uppercase">Ativar CNPJ?</span>
                <button onClick={() => setClientForm({...clientForm, ativarCnpj: !(clientForm.ativarCnpj ?? false)})} className={`w-10 h-5 rounded-full relative transition-colors ${(clientForm.ativarCnpj ?? false) ? 'bg-blue-600' : 'bg-gray-300'}`}> 
                   <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${(clientForm.ativarCnpj ?? false) ? 'left-5' : 'left-0.5'}`}></div>
                </button>
              </div>
              {(clientForm.ativarCnpj ?? false) && ( 
                <input value={clientForm.cnpj ?? ''} onChange={e => setClientForm({...clientForm, cnpj: e.target.value})} placeholder="CNPJ" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold animate-in fade-in" />
              )}
              <div className="relative">
                <input value={clientForm.pinLocalizacao ?? ''} onChange={e => setClientForm({...clientForm, pinLocalizacao: e.target.value})} placeholder="PIN de Localização" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold pr-12" />
                <button onClick={handlePinLocation} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600 p-2"><i className="fa-solid fa-location-dot"></i></button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input value={clientForm.telefone ?? ''} onChange={e => setClientForm({...clientForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 border rounded-2xl font-bold" />
                <select value={clientForm.diaRoteiro ?? 1} onChange={e => setClientForm({...clientForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 border rounded-2xl font-bold text-sm">{[1, 2, 3, 4, 5, 6].map(dia => (<option key={dia} value={dia}>{DIAS_SEMANA[dia] ?? 'N/D'}</option>))}</select> 
              </div>
              <button onClick={handleSaveClient} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl active:scale-95 transition-all uppercase text-xs">Salvar Cliente</button>
              <button onClick={() => setShowClientModal(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SINCRONIZAÇÃO PENDENTE */}
      {showConfirmSync && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl">
            <h3 className="font-black text-gray-800 text-lg mb-6">Enviar Carga Pendente?</h3>
            <p className="text-sm text-gray-500 mb-6">O vendedor precisará aceitar esta carga para que ela seja aplicada ao estoque dele.</p>
            <button onClick={handleSync} className="w-full bg-gray-900 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 mb-2 uppercase text-xs">Sim, Enviar Pendente</button>
            <button onClick={() => setShowConfirmSync(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL APLICAR IMEDIATAMENTE */}
      {showConfirmApply && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-xs rounded-3xl p-8 text-center shadow-2xl">
            <h3 className="font-black text-gray-800 text-lg mb-6">Aplicar Carga Imediatamente?</h3>
            <p className="text-sm text-gray-500 mb-6">Esta ação sobrescreverá o estoque atual do vendedor sem a necessidade de aceite.</p>
            <button onClick={handleApply} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 mb-2 uppercase text-xs">Sim, Aplicar Agora</button>
            <button onClick={() => setShowConfirmApply(false)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL ENTRADA ESTOQUE */}
      {showEntryModal && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-[32px] w-full max-w-xs shadow-2xl text-center">
            <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Entrada de Mercadoria</h3>
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex flex-col items-center">
                <span className="text-[10px] font-black text-blue-400 uppercase mb-1">📦 Estoque Atual</span>
                <span className="text-lg font-black text-blue-700">{(showEntryModal.estoquePrincipal ?? 0)} UN</span> 
              </div>
              <input type="number" placeholder="Quantidade Entrada" className="w-full p-4 bg-gray-50 rounded-2xl border font-black text-center text-lg" value={entryForm.qtd} onChange={e => setEntryForm({...entryForm, qtd: e.target.value})} />
              <input type="number" placeholder="Custo Unit." className="w-full p-4 bg-gray-50 rounded-2xl border font-black text-center text-lg" value={entryForm.custo} onChange={e => setEntryForm({...entryForm, custo: e.target.value})} />
              <button onClick={() => { if(!entryForm.qtd || !entryForm.custo) return; props.registerStockEntry(showEntryModal.id, parseInt(entryForm.qtd), parseFloat(entryForm.custo)); showToast("Entrada registrada"); setShowEntryModal(null); }} className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl active:scale-95 shadow-xl uppercase text-xs">Confirmar Entrada</button>
              <button onClick={() => setShowEntryModal(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-6">Confirmar Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-6">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo em Aberto</p>
                <p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p> 
              </div>
              <div className="space-y-4 mb-6">
                <p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p>
                <input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none" />
              </div>
              <div className="space-y-3">
                 <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest">Confirmar Dinheiro</button>
                 <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest">Confirmar PIX</button>
                 <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-bold text-[9px] uppercase">Cancelar</button>
              </div>
           </div>
        </div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[2rem] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh]">
            <div className="flex-1 overflow-y-auto p-2">
              <Cupom 
                sale={selectedSale} 
                client={props.clients.find(c => c.id === selectedSale.clientId) || {} as Client} 
                products={props.products} 
                onClose={() => setSelectedSale(null)} 
                onDeleteSale={props.deleteSale} 
                allowDelete={true} 
              />
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-col gap-2">
              <button onClick={() => setSelectedSale(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px] tracking-widest">Voltar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;