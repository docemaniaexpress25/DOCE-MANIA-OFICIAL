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

const getTodayDateString = () => new Date().toISOString().split('T')[0];

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

  const [dailyRouteState, setDailyRouteState] = useState<DailyRouteState>({ 
    date: getTodayDateString(), 
    clientIds: [], 
    skippedClientIds: [] 
  });

  useEffect(() => { saveLocalState('currentUser', currentUser); }, [currentUser]);

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
      setProductOrder(settings.productOrder);
      setCompanyName(settings.companyName ?? "DOCE MANIA DISTRIBUIDORA");
      setCompanyCnpj(settings.companyCnpj ?? "00.000.000/0001-00");

      const [u, cl, p] = await Promise.all([
        userService.getAllUsers(),
        clientService.getAllClients(),
        productService.getAllProducts()
      ]);
      setUsers(u);
      setClients(cl);
      setProducts(p);
      await fetchTransactionalData();
    } catch (e) {
      console.error("Erro ao carregar dados principais:", e);
    }
  }, [fetchTransactionalData]);

  // Supabase Realtime Subscription
  useEffect(() => {
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        fetchTransactionalData();
        fetchCoreData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTransactionalData, fetchCoreData]);

  useEffect(() => { fetchCoreData(); }, [fetchCoreData]);

  const updateSetting = async (key: keyof AppSettings, value: any) => {
    await appSettingsService.updateSettings({ [key]: value });
  };

  const addUser = async (nome: string, foto?: string, telefone?: string) => {
    await userService.insertUser({ nome, email: `${nome.toLowerCase().replace(/\s/g, '')}@sistema.com`, role: 'VENDEDOR', ativo: true, foto, telefone, pin: '123456' });
  };

  const addProduct = async (nome: string, custo: number, venda: number, comissao: number, estoque: number = 0) => {
    const res = await productService.insertProduct({ nome, precoCusto: custo, precoVenda: venda, comissaoPercentual: comissao, estoquePrincipal: estoque, ativo: true });
    if (res) await updateSetting('productOrder', [...productOrder, res.id]);
  };

  const applyCargaDirectly = async (vId: string, itens: { produtoId: string, quantidade: number }[]) => {
    try {
      await cargaService.applyCargaAdminRPC(vId, itens);
      setAdminNotification("Carga aplicada com sucesso!");
    } catch (e) {
      console.error(e);
      setAdminNotification("Erro ao aplicar carga.");
    }
  };

  const aceitarCarga = async (pendenciaId: string) => {
    try {
      await cargaService.aceitarCargaRPC(pendenciaId);
      setAdminNotification("Carga aceita!");
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
      return await saleService.insertSale(saleData);
    } catch (e) {
      console.error(e);
      return null;
    }
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
            addProduct={addProduct} updateProduct={productService.updateProduct} deleteProduct={productService.deleteProduct} registerStockEntry={()=>{}} adjustStockManual={()=>{}}
            syncVendedorCarga={cargaService.insertCargaPendente} applyCargaDirectly={applyCargaDirectly} addClient={clientService.insertClient} updateClient={clientService.updateClient} deleteClient={clientService.deleteClient}
            addUser={addUser} updateUser={userService.updateUser} payCommission={()=>{}} setCommissions={()=>{}} updateEstoqueCentral={()=>{}} reinforceCarga={()=>{}} deleteSale={saleService.deleteSale} receiveAccount={()=>{}}
            setLogo={(v)=>updateSetting('logo', v)} adminUser={currentUser} setMargemGlobalAtiva={(v)=>updateSetting('margemGlobalAtiva', v)} setMargemGlobalValor={(v)=>updateSetting('margemGlobalValor', v)}
            setMargemMinima={(v)=>updateSetting('margemMinima', v)} setMargemMinimaAtiva={(v)=>updateSetting('margemMinimaAtiva', v)} setPix1Name={(v)=>updateSetting('pix1Name', v)} setPix1Code={(v)=>updateSetting('pix1Code', v)}
            setPix2Name={(v)=>updateSetting('pix2Name', v)} setPix2Code={(v)=>updateSetting('pix2Code', v)} clearAdminNotification={() => setAdminNotification(null)} setOrderedProductIds={(v)=>updateSetting('productOrder', v)}
            setCompanyName={(v)=>updateSetting('companyName', v)} setCompanyCnpj={(v)=>updateSetting('companyCnpj', v)}
          />
        ) : (
          <VendedorDashboard 
            {...{ products, users, cargas, clients, sales, commissions, payoutLogs, expenses, messages, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, dailyRouteState, companyName, companyCnpj, user: currentUser }}
            markMessageAsRead={markMessageAsRead} processSale={processSale} addClient={clientService.insertClient} updateClient={clientService.updateClient} deleteClient={clientService.deleteClient}
            receivePayment={()=>{}} deleteSale={saleService.deleteSale} aceitarCarga={aceitarCarga} addExpense={expenseService.insertExpense} updateDailyRoute={()=>{}}
            setPix2Name={(v)=>updateSetting('pix2Name', v)} setPix2Code={(v)=>updateSetting('pix2Code', v)}
          />
        )}
      </main>
    </div>
  );
};

export default App;