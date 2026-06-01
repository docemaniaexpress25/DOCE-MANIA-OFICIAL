import React, { useState, useEffect, useCallback } from 'react';
import { User, Product, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense } from './types';
import AdminDashboard from './components/AdminDashboard';
import VendedorDashboard from './components/VendedorDashboard';
import Login from './components/Login';
import { userService } from './services/userService';
import { productService } from './services/productService';
import { clientService } from './services/clientService';
import { appSettingsService, AppSettings } from './services/appSettingsService';
import { saleService } from './services/saleService';
import { commissionService } from './services/commissionService';
import { messageService } from './services/messageService';
import { cargaService } from './services/cargaService';
import { dailyRouteService } from './services/dailyRouteService';
import { expenseService } from './services/expenseService';
import { supabase } from './supabaseClient';
import { loadLocalState, saveLocalState, DailyRouteState } from './utils/persistence';

const getTodayDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadLocalState('currentUser', null));
  
  const [logo, setLogo] = useState<string | null>(null);
  const [margemGlobalAtiva, setMargemGlobalAtiva] = useState(true);
  const [margemGlobalValor, setMargemGlobalValor] = useState(30); 
  const [margemMinima, setMargemMinima] = useState(20); 
  const [margemMinimaAtiva, setMargemMinimaAtiva] = useState(true); 
  const [pix1Name, setPix1Name] = useState("Pix Banco A");
  const [pix1Code, setPix1Code] = useState<string | null>(null);
  const [pix2Name, setPix2Name] = useState("Pix Banco B");
  const [pix2Code, setPix2Code] = useState<string | null>(null);
  const [productOrder, setProductOrder] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState("DOCE MANIA DISTRIBUIDORA");
  const [companyCnpj, setCompanyCnpj] = useState("00.000.000/0001-00");

  const [adminNotification, setAdminNotification] = useState<string | null>(null);
  
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const [cargas, setCargas] = useState<Carga[]>([]);
  const [cargasPendentes, setCargasPendentes] = useState<CargaPendente[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payoutLogs, setPayoutLogs] = useState<CommissionPaymentLog[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<SystemMessage[]>([]);

  const [dailyRouteState, setDailyRouteState] = useState<DailyRouteState>(() => {
    const saved = loadLocalState('dailyRouteState', null);
    const today = getTodayDateString();
    if (!saved || saved.date !== today) {
      return { date: today, clientIds: [], skippedClientIds: [] };
    }
    return saved;
  });

  useEffect(() => { saveLocalState('currentUser', currentUser); }, [currentUser]);
  useEffect(() => { saveLocalState('dailyRouteState', dailyRouteState); }, [dailyRouteState]);

  const fetchTransactionalData = useCallback(async () => {
    try {
      const [s, c, p, m, cg, cgp, ex] = await Promise.all([
        saleService.getAllSales(),
        commissionService.getAllCommissions(),
        commissionService.getAllPayouts(),
        messageService.getAllMessages(),
        cargaService.getAllCargas(),
        cargaService.getAllCargasPendentes(),
        expenseService.getAllExpenses()
      ]);
      setSales(s);
      setCommissions(c);
      setPayoutLogs(p);
      setMessages(m);
      setCargas(cg);
      setCargasPendentes(cgp);
      setExpenses(ex);
    } catch (e) {
      console.error("Erro ao carregar dados transacionais:", e);
    }
  }, []);

  const fetchCoreData = useCallback(async () => {
    try {
      const settings = await appSettingsService.getSettings();
      setLogo(settings.logo);
      setMargemGlobalAtiva(settings.margemGlobalAtiva);
      setMargemGlobalValor(settings.margemGlobalValor);
      setMargemMinimaAtiva(settings.margemMinimaAtiva);
      setMargemMinima(settings.margemMinima);
      setPix1Name(settings.pix1Name ?? "Pix Banco A");
      setPix1Code(settings.pix1Code);
      setPix2Name(settings.pix2Name ?? "Pix Banco B");
      setPix2Code(settings.pix2Code);
      setProductOrder(settings.productOrder || []);
      setCompanyName(settings.companyName ?? "DOCE MANIA DISTRIBUIDORA");
      setCompanyCnpj(settings.companyCnpj ?? "00.000.000/0001-00");

      const [u, cl, p] = await Promise.all([
        userService.getAllUsers(),
        clientService.getAllClients(),
        productService.getAllProducts()
      ]);
      
      setUsers(u);
      setClients(cl);
      
      const order = settings.productOrder || [];
      const sortedProducts = [...p].sort((a, b) => {
        const idxA = order.indexOf(a.id);
        const idxB = order.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
      setProducts(sortedProducts);

      const today = getTodayDateString();
      if (dailyRouteState.date === today && dailyRouteState.clientIds.length === 0) {
        const todayDay = new Date().getDay();
        const routeClients = cl
          .filter(c => c.diaRoteiro === todayDay && c.ativo)
          .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
          .map(c => c.id);
        
        if (routeClients.length > 0) {
          setDailyRouteState(prev => ({ ...prev, clientIds: routeClients }));
        }
      }

      await fetchTransactionalData();
    } catch (e) {
      console.error("Erro ao carregar dados principais:", e);
    }
  }, [fetchTransactionalData, dailyRouteState.date, dailyRouteState.clientIds.length]);

  useEffect(() => {
    const checkDate = () => {
      const today = getTodayDateString();
      if (dailyRouteState.date !== today) {
        setDailyRouteState({ date: today, clientIds: [], skippedClientIds: [] });
        fetchCoreData();
      }
    };

    const interval = setInterval(checkDate, 30000);
    window.addEventListener('focus', checkDate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkDate);
    };
  }, [dailyRouteState.date, fetchCoreData]);

  // Sincronização em tempo real com debounce para evitar race conditions e reloads múltiplos
  useEffect(() => {
    let timeoutId: any;
    const debouncedFetch = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fetchCoreData();
      }, 300);
    };

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        debouncedFetch();
      })
      .subscribe();

    return () => {
      clearTimeout(timeoutId);
      supabase.removeChannel(channel);
    };
  }, [fetchCoreData]);

  useEffect(() => { fetchCoreData(); }, [fetchCoreData]);

  const updateSetting = async (key: keyof AppSettings, value: any) => {
    // Atualização otimista imediata do estado local para evitar lag visual e race conditions
    if (key === 'logo') setLogo(value);
    else if (key === 'margemGlobalAtiva') setMargemGlobalAtiva(value);
    else if (key === 'margemGlobalValor') setMargemGlobalValor(value);
    else if (key === 'margemMinimaAtiva') setMargemMinimaAtiva(value);
    else if (key === 'margemMinima') setMargemMinima(value);
    else if (key === 'pix1Name') setPix1Name(value);
    else if (key === 'pix1Code') setPix1Code(value);
    else if (key === 'pix2Name') setPix2Name(value);
    else if (key === 'pix2Code') setPix2Code(value);
    else if (key === 'companyName') setCompanyName(value);
    else if (key === 'companyCnpj') setCompanyCnpj(value);
    else if (key === 'productOrder') {
      setProductOrder(value);
      // Ordena os produtos localmente de forma instantânea
      setProducts(prev => {
        return [...prev].sort((a, b) => {
          const idxA = value.indexOf(a.id);
          const idxB = value.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
      });
    }

    // Persiste no banco de dados em segundo plano
    await appSettingsService.updateSettings({ [key]: value });
  };

  const addUser = async (nome: string, foto?: string, telefone?: string) => {
    await userService.insertUser({ nome, email: `${nome.toLowerCase().replace(/\s/g, '')}@sistema.com`, role: 'VENDEDOR', ativo: true, foto, telefone, pin: '123456' });
    fetchCoreData();
  };

  const updateUser = async (id: string, data: Partial<User>) => {
    await userService.updateUser(id, data);
    fetchCoreData();
  };

  const addProduct = async (nome: string, custo: number, venda: number, comissao: number, estoque: number = 0) => {
    const res = await productService.insertProduct({ nome, precoCusto: custo, precoVenda: venda, comissaoPercentual: comissao, estoquePrincipal: estoque, ativo: true });
    if (res) {
      await appSettingsService.updateSettings({ productOrder: [...productOrder, res.id] });
      fetchCoreData();
    }
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    await productService.updateProduct(id, data);
    fetchCoreData();
  };

  const deleteProduct = async (id: string) => {
    await productService.deleteProduct(id);
    fetchCoreData();
  };

  const addClient = async (data: Omit<Client, 'id'>) => {
    await clientService.insertClient(data);
    fetchCoreData();
  };

  const updateClient = async (id: string, data: Partial<Client>) => {
    await clientService.updateClient(id, data);
    fetchCoreData();
  };

  const deleteClient = async (id: string) => {
    await clientService.deleteClient(id);
    fetchCoreData();
  };

  const applyCargaDirectly = async (vId: string, itens: { produtoId: string, quantidade: number }[]) => {
    try {
      await cargaService.applyCargaAdminRPC(vId, itens);
      setAdminNotification("Carga aplicada com sucesso!");
      fetchTransactionalData();
    } catch (e) {
      console.error(e);
      setAdminNotification("Erro ao aplicar carga.");
    }
  };

  const syncVendedorCarga = async (vId: string, itens: { produtoId: string, quantidade: number }[]) => {
    await cargaService.insertCargaPendente({ vendedorId: vId, itens, data: new Date() });
    fetchTransactionalData();
  };

  const aceitarCarga = async (pendenciaId: string) => {
    try {
      await cargaService.aceitarCargaRPC(pendenciaId);
      setAdminNotification("Carga aceita!");
      fetchTransactionalData();
    } catch (e) {
      console.error(e);
    }
  };

  const markMessageAsRead = async (id: string) => {
    await messageService.updateMessage(id, { lida: true });
    fetchTransactionalData();
  };

  const processSale = async (saleData: any) => {
    try {
      const res = await saleService.insertSale(saleData);
      if (res) fetchTransactionalData();
      return res;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  const deleteSale = async (id: string) => {
    const success = await saleService.deleteSale(id);
    if (success) fetchTransactionalData();
  };

  const receiveAccount = async (saleId: string, method: PaymentMethod, amount?: number) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;

    const valorRecebido = amount || (sale.valorTotal - sale.valorPago);
    const novoValorPago = Number((sale.valorPago + valorRecebido).toFixed(2));
    const statusPagamento = novoValorPago >= sale.valorTotal ? 'PAGO' : 'PENDENTE';
    
    const timestamp = new Date().toLocaleString('pt-BR');
    const novoLog = `${timestamp}: R$ ${valorRecebido.toFixed(2)} (${method})`;
    const novoDetalhe = sale.detalhePagamento ? `${sale.detalhePagamento} | ${novoLog}` : novoLog;

    const success = await saleService.updateSale(saleId, {
      valorPago: novoValorPago,
      statusPagamento,
      detalhePagamento: novoDetalhe
    });

    if (success) {
      if (statusPagamento === 'PAGO') {
        const comm = commissions.find(c => c.saleId === saleId);
        if (comm && comm.status === 'A_RECEBER') {
          await commissionService.updateCommissionStatus(comm.id, 'DISPONIVEL');
        }
      }
      fetchTransactionalData();
    }
  };

  const addExpense = async (vId: string, desc: string, val: number) => {
    const success = await expenseService.insertExpense({ sellerId: vId, descricao: desc, valor: val });
    if (success) fetchTransactionalData();
    return success;
  };

  const updateDailyRoute = (clientIds: string[], skippedClientIds: string[]) => {
    setDailyRouteState(prev => ({ ...prev, clientIds, skippedClientIds }));
  };

  if (!currentUser) return <Login users={users} onLogin={setCurrentUser} logo={logo} />;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white h-20 px-6 shadow-sm flex justify-between items-center sticky top-0 z-50 border-b">
        {logo ? <img src={logo} alt="Logo" className="h-14 w-auto object-contain" /> : <span className="font-black text-gray-300">LOGO</span>}
        <div className="flex items-center gap-3">
          <div className="text-right"><p className="text-[10px] font-black uppercase text-gray-400">{currentUser.role}</p><p className="text-sm font-bold text-gray-800">{currentUser.nome}</p></div>
          <button onClick={() => setCurrentUser(null)} className="text-gray-400 p-2"><i className="fa-solid fa-right-from-bracket"></i></button>
        </div>
      </header>
      
      <main className="container mx-auto p-4 max-w-lg">
        {currentUser.role === 'ADMIN' ? (
          <AdminDashboard 
            {...{ products, users, cargas, clients, sales, commissions, payoutLogs, expenses, logo, margemGlobalAtiva, margemGlobalValor, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, adminNotification, companyName, companyCnpj, orderedProductIds: productOrder }}
            addProduct={addProduct} updateProduct={updateProduct} deleteProduct={deleteProduct} registerStockEntry={()=>{}} adjustStockManual={()=>{}}
            syncVendedorCarga={syncVendedorCarga} applyCargaDirectly={applyCargaDirectly} addClient={addClient} updateClient={updateClient} deleteClient={deleteClient}
            addUser={addUser} updateUser={updateUser} payCommission={()=>{}} setCommissions={()=>{}} updateEstoqueCentral={()=>{}} reinforceCarga={()=>{}} deleteSale={deleteSale} receiveAccount={receiveAccount}
            setLogo={(v)=>updateSetting('logo', v)} adminUser={currentUser} setMargemGlobalAtiva={(v)=>updateSetting('margemGlobalAtiva', v)} setMargemGlobalValor={(v)=>updateSetting('margemGlobalValor', v)}
            setMargemMinima={(v)=>updateSetting('margemMinima', v)} setMargemMinimaAtiva={(v)=>updateSetting('margemMinimaAtiva', v)} setPix1Name={(v)=>updateSetting('pix1Name', v)} setPix1Code={(v)=>updateSetting('pix1Code', v)}
            setPix2Name={(v)=>updateSetting('pix2Name', v)} setPix2Code={(v)=>updateSetting('pix2Code', v)} clearAdminNotification={() => setAdminNotification(null)} setOrderedProductIds={(v)=>updateSetting('productOrder', v)}
            setCompanyName={(v)=>updateSetting('companyName', v)} setCompanyCnpj={(v)=>updateSetting('companyCnpj', v)}
          />
        ) : (
          <VendedorDashboard 
            {...{ products, users, cargas, cargasPendentes, clients, sales, commissions, payoutLogs, expenses, messages, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, dailyRouteState, companyName, companyCnpj, user: currentUser }}
            markMessageAsRead={markMessageAsRead} processSale={processSale} addClient={addClient} updateClient={updateClient} deleteClient={deleteClient}
            receivePayment={receiveAccount} deleteSale={deleteSale} aceitarCarga={aceitarCarga} addExpense={addExpense} updateDailyRoute={updateDailyRoute}
          />
        )}
      </main>
    </div>
  );
};

export default App;