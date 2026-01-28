import React, { useState, useEffect, useCallback } from 'react';
import { User, Product, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, DailyRouteState } from './types';
import AdminDashboard from './components/AdminDashboard';
import VendedorDashboard from './components/VendedorDashboard';
import Login from './components/Login';
import { userService } from './services/userService';
import { productService } from './services/productService';
import { clientService } from './services/clientService';
import { saleService } from './services/saleService';
import { cargaService } from './services/cargaService';
import { commissionService } from './services/commissionService';
import { messageService } from './services/messageService';
import { dailyRouteService } from './services/dailyRouteService';
import { appSettingsService, AppSettings } from './services/appSettingsService';
import { generateId } from './utils/uuid';
import { loadLocalState, saveLocalState } from './utils/persistence';

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadLocalState('currentUser', null));
  
  // Estados de Configuração
  const [logo, setLogo] = useState<string | null>(null);
  const [margemGlobalAtiva, setMargemGlobalAtiva] = useState(true);
  const [margemGlobalValor, setMargemGlobalValor] = useState(35);
  const [margemMinima, setMargemMinima] = useState(20); 
  const [margemMinimaAtiva, setMargemMinimaAtiva] = useState(true); 
  const [pix1Name, setPix1Name] = useState("Pix Banco A");
  const [pix1Code, setPix1Code] = useState<string | null>(null);
  const [pix2Name, setPix2Name] = useState("Pix Banco B");
  const [pix2Code, setPix2Code] = useState<string | null>(null);
  const [productOrder, setProductOrder] = useState<string[]>([]);

  // Estados de Dados
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [cargasPendentes, setCargasPendentes] = useState<CargaPendente[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payoutLogs, setPayoutLogs] = useState<CommissionPaymentLog[]>([]);
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [dailyRouteState, setDailyRouteState] = useState<DailyRouteState>({ 
    date: getTodayDateString(), clientIds: [], skippedClientIds: [] 
  });

  const [adminNotification, setAdminNotification] = useState<string | null>(null);

  // Efeito para persistir apenas o usuário atual localmente
  useEffect(() => { saveLocalState('currentUser', currentUser); }, [currentUser]);

  const fetchData = useCallback(async () => {
    // 1. Carregar Configurações Globais
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

    // 2. Carregar Dados das Tabelas
    const [u, p, c, s, cg, cp, comm, logs, msg] = await Promise.all([
      userService.getAllUsers(),
      productService.getAllProducts(),
      clientService.getAllClients(),
      saleService.getAllSales(),
      cargaService.getAllCargas(),
      cargaService.getAllCargasPendentes(),
      commissionService.getAllCommissions(),
      commissionService.getAllPayouts(),
      messageService.getAllMessages()
    ]);

    setUsers(u);
    setProducts(p);
    setClients(c);
    setSales(s);
    setCargas(cg);
    setCargasPendentes(cp);
    setCommissions(comm);
    setPayoutLogs(logs);
    setMessages(msg);

    // 3. Carregar Rota se houver usuário vendedor
    if (currentUser && currentUser.role === 'VENDEDOR') {
      const route = await dailyRouteService.getRoute(currentUser.id);
      if (route) {
        setDailyRouteState(route);
      } else {
        // Inicializar com roteiro padrão do dia
        const today = getTodayDateString();
        const currentDayOfWeek = new Date().getDay();
        const clientsFromRoute = c.filter(cl => cl.ativo && cl.diaRoteiro === currentDayOfWeek).map(cl => cl.id);
        const newState = { date: today, clientIds: clientsFromRoute, skippedClientIds: [] };
        setDailyRouteState(newState);
        await dailyRouteService.updateRoute(currentUser.id, newState);
      }
    }
  }, [currentUser]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sincronizar ordem dos produtos quando alterada
  const handleSetProductOrder = async (order: string[]) => {
    setProductOrder(order);
    await appSettingsService.updateSettings({ productOrder: order });
  };

  const updateSetting = useCallback(async (key: keyof AppSettings, value: any) => {
    const success = await appSettingsService.updateSettings({ [key]: value });
    if (success) await fetchData();
  }, [fetchData]);

  // --- Funções de Venda ---
  const processSale = async (saleData: any) => {
    const newSale = await saleService.insertSale(saleData);
    if (newSale) {
      // 1. Atualizar Carga no Supabase
      const vendedorCarga = cargas.filter(cg => cg.vendedorId === saleData.vendedorId);
      const novosItensCarga = vendedorCarga.map(cg => {
        const itemVendido = saleData.itens.find((i: any) => i.produtoId === cg.produtoId);
        return { 
          produtoId: cg.produtoId, 
          quantidade: itemVendido ? Math.max(0, cg.quantidade - itemVendido.quantidade) : cg.quantidade 
        };
      });
      await cargaService.updateActiveCarga(saleData.vendedorId, novosItensCarga);

      // 2. Criar Comissão no Supabase
      const totalComissao = saleData.itens.reduce((acc: number, item: any) => {
        const p = products.find(prod => prod.id === item.produtoId);
        return acc + (item.precoVenda * item.quantidade * ((p?.comissaoPercentual || 0) / 100));
      }, 0);

      await commissionService.insertCommission({
        saleId: newSale.id,
        vendedorId: saleData.vendedorId,
        valor: Number(totalComissao.toFixed(2)),
        valorBase: Number(saleData.valorTotal.toFixed(2)),
        percentual: saleData.valorTotal > 0 ? (totalComissao / saleData.valorTotal) * 100 : 0,
        status: saleData.statusPagamento === 'PAGO' ? 'DISPONIVEL' : 'A_RECEBER',
        dataGeracao: new Date()
      });

      await fetchData();
      return newSale;
    }
    return null;
  };

  const deleteSaleInternal = async (saleId: string) => {
    const saleToDelete = sales.find(s => s.id === saleId);
    if (!saleToDelete) return;

    // 1. Estornar Carga
    const vendedorCarga = cargas.filter(cg => cg.vendedorId === saleToDelete.vendedorId);
    const novosItensCarga = [...vendedorCarga.map(cg => ({ produtoId: cg.produtoId, quantidade: cg.quantidade }))];
    
    saleToDelete.itens.forEach(item => {
      const idx = novosItensCarga.findIndex(i => i.produtoId === item.produtoId);
      if (idx !== -1) novosItensCarga[idx].quantidade += item.quantidade;
      else novosItensCarga.push({ produtoId: item.produtoId, quantidade: item.quantidade });
    });

    await Promise.all([
      saleService.deleteSale(saleId),
      cargaService.updateActiveCarga(saleToDelete.vendedorId, novosItensCarga),
      commissionService.deleteCommissionBySale(saleId)
    ]);
    
    await fetchData();
  };

  const receiveAccount = async (saleId: string, method: PaymentMethod, amount?: number) => {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;

    const novoValorPago = Number(((sale.valorPago ?? 0) + (amount || sale.valorTotal)).toFixed(2));
    const totalQuitado = novoValorPago >= sale.valorTotal;

    await saleService.updateSale(saleId, { 
      valorPago: novoValorPago, 
      statusPagamento: totalQuitado ? 'PAGO' : 'PENDENTE',
      metodoPagamento: method
    });

    if (totalQuitado) {
      const comm = commissions.find(c => c.saleId === saleId);
      if (comm) await commissionService.updateCommissionStatus(comm.id, 'DISPONIVEL');
    }

    await fetchData();
  };

  // --- Funções de Carga ---
  const syncVendedorCarga = async (vendedorId: string, itens: { produtoId: string, quantidade: number }[]) => {
    await cargaService.insertCargaPendente({
      vendedorId,
      itens,
      data: new Date()
    });
    setAdminNotification("Carga enviada para aceite.");
    await fetchData();
  };

  const applyCargaDirectly = async (vendedorId: string, itens: { produtoId: string, quantidade: number }[]) => {
    await cargaService.updateActiveCarga(vendedorId, itens);
    setAdminNotification("Carga aplicada diretamente.");
    await fetchData();
  };

  const aceitarCarga = async (pendenciaId: string) => {
    const pendencia = cargasPendentes.find(p => p.id === pendenciaId);
    if (!pendencia) return;

    // Reduzir estoque principal
    for (const item of pendencia.itens) {
      const p = products.find(prod => prod.id === item.produtoId);
      if (p) await productService.updateProduct(p.id, { estoquePrincipal: p.estoquePrincipal - item.quantidade });
    }

    await Promise.all([
      cargaService.updateActiveCarga(pendencia.vendedorId, pendencia.itens),
      cargaService.deleteCargaPendente(pendenciaId)
    ]);

    await fetchData();
    setAdminNotification("Carga aceita!");
  };

  // --- Funções de Comissão ---
  const handlePayCommission = async (vendedorId: string, amount: number, type: 'TOTAL' | 'PARCIAL', adminId: string) => {
    const v = users.find(u => u.id === vendedorId);
    if (!v) return;

    await Promise.all([
      commissionService.insertPayout({
        vendedorId,
        vendedorNome: v.nome,
        valorPago: amount,
        valorRestante: 0, // Calculado dinamicamente na UI
        tipo: type,
        dataPagamento: new Date(),
        adminId
      }),
      messageService.insertMessage({
        vendedorId,
        titulo: "💰 Comissão Paga",
        mensagem: `O administrador registrou o pagamento de R$ ${amount.toFixed(2)}.`,
        data: new Date(),
        lida: false
      })
    ]);

    await fetchData();
  };

  const markMessageAsRead = async (msgId: string) => {
    await messageService.updateMessage(msgId, { lida: true });
    await fetchData();
  };

  const updateDailyRoute = async (clientIds: string[], skippedClientIds: string[]) => {
    if (!currentUser) return;
    const newState = { ...dailyRouteState, clientIds, skippedClientIds };
    setDailyRouteState(newState);
    await dailyRouteService.updateRoute(currentUser.id, newState);
  };

  if (!currentUser) return <Login users={users} onLogin={setCurrentUser} logo={logo} />;

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 flex flex-col">
      <header className="bg-white text-gray-800 h-20 px-6 shadow-sm flex justify-between items-center sticky top-0 z-50 border-b border-gray-100">
        <div className="flex items-center h-full">
          {logo ? <img src={logo} alt="Logo" className="h-16 w-auto object-contain" /> : <div className="h-10 w-32 bg-gray-100 rounded-lg flex items-center justify-center border border-gray-200"><span className="text-[10px] font-black uppercase text-gray-400">Logo</span></div>}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right"><p className="text-[10px] font-black uppercase text-gray-400 mb-0.5">{currentUser.role}</p><p className="text-sm font-bold text-gray-800 leading-none">{currentUser.nome}</p></div>
          <button onClick={() => setCurrentUser(null)} className="bg-gray-50 text-gray-400 hover:text-rose-500 p-2.5 rounded-xl border border-gray-100 transition-colors"><i className="fa-solid fa-right-from-bracket"></i></button>
        </div>
      </header>
      
      <main className="container mx-auto p-4 max-w-lg">
        {currentUser.role === 'ADMIN' ? (
          <AdminDashboard 
            products={products} users={users} cargas={cargas} clients={clients} sales={sales} commissions={commissions} payoutLogs={payoutLogs}
            addProduct={(n, c, v, com, e) => productService.insertProduct({ nome: n, precoCusto: c, precoVenda: v, comissaoPercentual: com, estoquePrincipal: e||0, ativo: true }).then(()=>fetchData())}
            updateProduct={(id, data) => productService.updateProduct(id, data).then(()=>fetchData())}
            deleteProduct={(id) => productService.deleteProduct(id).then(()=>fetchData())}
            registerStockEntry={async (id, q, c) => {
                const p = products.find(prod => prod.id === id);
                if (p) {
                    const nTotal = p.estoquePrincipal + q;
                    const nCusto = Number((((p.estoquePrincipal * p.precoCusto) + (q * c)) / nTotal).toFixed(2));
                    await productService.updateProduct(id, { estoquePrincipal: nTotal, precoCusto: nCusto });
                    await fetchData();
                }
            }}
            adjustStockManual={(id, q, t) => {
                const p = products.find(prod => prod.id === id);
                if (p) {
                    const nStock = Math.max(0, p.estoquePrincipal + (t === 'ADICAO' ? q : -q));
                    productService.updateProduct(id, { estoquePrincipal: nStock }).then(()=>fetchData());
                }
            }}
            syncVendedorCarga={syncVendedorCarga} applyCargaDirectly={applyCargaDirectly}
            addClient={(data) => clientService.insertClient(data).then(()=>fetchData())}
            updateClient={(id, data) => clientService.updateClient(id, data).then(()=>fetchData())}
            deleteClient={(id) => clientService.deleteClient(id).then(()=>fetchData())}
            addUser={(n, f, t) => userService.insertUser({ nome: n, email: '', role: 'VENDEDOR', ativo: true, foto: f, telefone: t, pin: '123456' }).then(()=>fetchData())}
            updateUser={(id, data) => userService.updateUser(id, data).then(()=>fetchData())}
            payCommission={handlePayCommission} setCommissions={()=>{}} updateEstoqueCentral={()=>{}} reinforceCarga={()=>{}}
            deleteSale={deleteSaleInternal} receiveAccount={receiveAccount} logo={logo} setLogo={(val) => updateSetting('logo', val)} adminUser={currentUser}
            margemGlobalAtiva={margemGlobalAtiva} setMargemGlobalAtiva={(val) => updateSetting('margemGlobalAtiva', val)}
            margemGlobalValor={margemGlobalValor} setMargemGlobalValor={(val) => updateSetting('margemGlobalValor', val)}
            margemMinima={margemMinima} setMargemMinima={(val) => updateSetting('margemMinima', val)}
            margemMinimaAtiva={margemMinimaAtiva} setMargemMinimaAtiva={(val) => updateSetting('margemMinimaAtiva', val)}
            pix1Name={pix1Name} setPix1Name={(val) => updateSetting('pix1Name', val)} pix1Code={pix1Code} setPix1Code={(val) => updateSetting('pix1Code', val)}
            pix2Name={pix2Name} setPix2Name={(val) => updateSetting('pix2Name', val)} pix2Code={pix2Code} setPix2Code={(val) => updateSetting('pix2Code', val)}
            adminNotification={adminNotification} clearAdminNotification={() => setAdminNotification(null)}
            productOrder={productOrder} setProductOrder={handleSetProductOrder}
          />
        ) : (
          <VendedorDashboard 
            products={products} users={users} cargas={cargas} clients={clients} sales={sales} commissions={commissions}
            addClient={async (data) => { await clientService.insertClient(data); await fetchData(); }}
            updateClient={async (id, data) => { await clientService.updateClient(id, data); await fetchData(); }}
            deleteClient={async (id) => { await clientService.deleteClient(id); await fetchData(); }}
            user={currentUser} payoutLogs={payoutLogs.filter(l => l.vendedorId === currentUser.id)}
            cargasPendentes={cargasPendentes.filter(cp => cp.vendedorId === currentUser.id)}
            messages={messages.filter(m => m.vendedorId === currentUser.id)}
            markMessageAsRead={markMessageAsRead} processSale={processSale} 
            receivePayment={receiveAccount} deleteSale={deleteSaleInternal} aceitarCarga={aceitarCarga}
            margemMinima={margemMinima} margemMinimaAtiva={margemMinimaAtiva} pix1Name={pix1Name} pix1Code={pix1Code}
            pix2Name={pix2Name} pix2Code={pix2Code} dailyRouteState={dailyRouteState} updateDailyRoute={updateDailyRoute}
            productOrder={productOrder}
          />
        )}
      </main>
    </div>
  );
};

export default App;