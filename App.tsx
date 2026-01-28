import React, { useState, useEffect, useCallback } from 'react';
import { User, Product, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage } from './types';
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
import { generateId } from './utils/uuid';
import { 
  loadLocalState, saveLocalState, 
  DEFAULT_CARGAS, DEFAULT_CARGAS_PENDENTES,
  DailyRouteState
} from './utils/persistence';

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadLocalState('currentUser', null));
  
  const [logo, setLogo] = useState<string | null>(null);
  const [margemGlobalAtiva, setMargemGlobalAtiva] = useState(true);
  const [margemGlobalValor, setMargemGlobalValor] = useState(35);
  const [margemMinima, setMargemMinima] = useState(20); 
  const [margemMinimaAtiva, setMargemMinimaAtiva] = useState(true); 
  const [pix1Name, setPix1Name] = useState("Pix Banco A");
  const [pix1Code, setPix1Code] = useState<string | null>(null);
  const [pix2Name, setPix2Name] = useState("Pix Banco B");
  const [pix2Code, setPix2Code] = useState<string | null>(null);
  const [productOrder, setProductOrder] = useState<string[]>([]); // Novo estado para ordem dos produtos

  const [adminNotification, setAdminNotification] = useState<string | null>(null);
  
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  const [cargas, setCargas] = useState<Carga[]>([]);
  const [cargasPendentes, setCargasPendentes] = useState<CargaPendente[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payoutLogs, setPayoutLogs] = useState<CommissionPaymentLog[]>([]);
  const [messages, setMessages] = useState<SystemMessage[]>([]);

  const [dailyRouteState, setDailyRouteState] = useState<DailyRouteState>({ 
    date: getTodayDateString(), 
    clientIds: [], 
    skippedClientIds: [] 
  });

  useEffect(() => { saveLocalState('currentUser', currentUser); }, [currentUser]);

  const fetchUsers = useCallback(async () => { setUsers(await userService.getAllUsers()); }, []);
  const fetchClients = useCallback(async () => { setClients(await clientService.getAllClients()); }, []);
  
  const fetchProducts = useCallback(async (order: string[]) => { 
    const fetchedProducts = await productService.getAllProducts();
    
    // 1. Cria um mapa para acesso rápido (Tipagem explícita adicionada)
    const productMap: Map<string, Product> = new Map(fetchedProducts.map(p => [p.id, p]));
    
    // 2. Ordena usando a ordem persistida
    const orderedProducts: Product[] = [];
    const remainingProducts: Product[] = [];

    // Adiciona produtos na ordem definida
    order.forEach(id => {
      const product = productMap.get(id);
      if (product) {
        orderedProducts.push(product);
        productMap.delete(id); // Remove do mapa para não duplicar
      }
    });

    // Adiciona produtos novos ou não ordenados ao final
    productMap.forEach(product => {
      remainingProducts.push(product);
    });

    setProducts([...orderedProducts, ...remainingProducts]);
  }, []);

  const fetchTransactionalData = useCallback(async () => {
    const [s, c, p, m, cg, cgp] = await Promise.all([
      saleService.getAllSales(),
      commissionService.getAllCommissions(),
      commissionService.getAllPayouts(),
      messageService.getAllMessages(),
      cargaService.getAllCargas(),
      cargaService.getAllCargasPendentes()
    ]);
    setSales(s);
    setCommissions(c);
    setPayoutLogs(p);
    setMessages(m);
    setCargas(cg);
    setCargasPendentes(cgp);
  }, []);

  const fetchDailyRoute = useCallback(async (currentClients: Client[]) => {
    if (currentUser && currentUser.role === 'VENDEDOR') {
      const today = getTodayDateString();
      const route = await dailyRouteService.getRoute(currentUser.id, today);
      
      if (route) {
        setDailyRouteState(route);
      } else {
        // Lógica de Geração Automática da Rota
        const todayDay = new Date().getDay(); // 0=Domingo, 1=Segunda...
        const initialClientIds = currentClients
          .filter(c => c.diaRoteiro === todayDay && c.ativo)
          .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
          .map(c => c.id);

        const newRoute: DailyRouteState = { 
          date: today, 
          clientIds: initialClientIds, 
          skippedClientIds: [] 
        };
        
        // Persiste a rota recém-gerada
        await dailyRouteService.updateRoute(currentUser.id, newRoute);
        setDailyRouteState(newRoute);
      }
    }
  }, [currentUser]);

  const fetchCoreData = useCallback(async () => {
    let settings: AppSettings;
    try {
      settings = await appSettingsService.getSettings();
      setLogo(settings.logo);
      setMargemGlobalAtiva(settings.margemGlobalAtiva);
      setMargemGlobalValor(settings.margemGlobalValor);
      setMargemMinimaAtiva(settings.margemMinimaAtiva);
      setMargemMinima(settings.margemMinima);
      setPix1Name(settings.pix1Name ?? "Pix Banco A");
      setPix1Code(settings.pix1Code);
      setPix2Name(settings.pix2Name ?? "Pix Banco B");
      setPix2Code(settings.pix2Code);
      setProductOrder(settings.productOrder); // Carregando ordem dos produtos
    } catch (e) {
      console.error("Erro ao carregar configurações:", e);
      return;
    }

    const [fetchedUsers, fetchedClients] = await Promise.all([
      fetchUsers(),
      fetchClients(),
      fetchTransactionalData()
    ]);
    
    // 1. Carrega e ordena os produtos usando a ordem das configurações
    await fetchProducts(settings.productOrder);
    
    // 2. Chama a busca da rota após carregar os clientes
    if (fetchedClients) {
      await fetchDailyRoute(fetchedClients);
    }
    
  }, [fetchUsers, fetchClients, fetchTransactionalData, fetchDailyRoute, fetchProducts]);

  useEffect(() => { fetchCoreData(); }, [fetchCoreData]);

  const updateSetting = useCallback(async (key: keyof AppSettings, value: any) => {
    const success = await appSettingsService.updateSettings({ [key]: value });
    if (success) {
        switch (key) {
            case 'logo': setLogo(value); break;
            case 'margemGlobalAtiva': setMargemGlobalAtiva(value); break;
            case 'margemGlobalValor': setMargemGlobalValor(value); break;
            case 'margemMinimaAtiva': setMargemMinimaAtiva(value); break;
            case 'margemMinima': setMargemMinima(value); break;
            case 'pix1Name': setPix1Name(value); break;
            case 'pix1Code': setPix1Code(value); break;
            case 'pix2Name': setPix2Name(value); break;
            case 'pix2Code': setPix2Code(value); break;
            case 'productOrder': setProductOrder(value); 
              // Se a ordem do produto for atualizada, reordena a lista de produtos imediatamente
              const productMap: Map<string, Product> = new Map(products.map(p => [p.id, p])); // Tipagem explícita adicionada
              const orderedProducts: Product[] = [];
              value.forEach((id: string) => {
                const product = productMap.get(id);
                if (product) {
                  orderedProducts.push(product);
                  productMap.delete(id);
                }
              });
              productMap.forEach(product => orderedProducts.push(product));
              setProducts(orderedProducts);
              break;
        }
    }
  }, [products]);

  const addUser = async (nome: string, foto?: string, telefone?: string) => {
    const newUser: Omit<User, 'id'> = { nome, email: `${nome.toLowerCase().replace(/\s/g, '')}@sistema.com`, role: 'VENDEDOR', ativo: true, foto, telefone, pin: '123456' };
    const res = await userService.insertUser(newUser);
    if (res) await fetchUsers();
  };

  const updateUser = async (id: string, data: Partial<User>) => {
    const res = await userService.updateUser(id, data);
    if (res) await fetchUsers();
  };

  const addProduct = async (nome: string, custo: number, venda: number, comissao: number, estoque: number = 0) => {
    const newProduct: Omit<Product, 'id'> = { nome, precoCusto: Number(custo.toFixed(2)), precoVenda: Number(venda.toFixed(2)), comissaoPercentual: Number(comissao.toFixed(2)), estoquePrincipal: estoque, ativo: true };
    const res = await productService.insertProduct(newProduct);
    if (res) {
      // Adiciona o novo produto ao final da ordem persistida
      await updateSetting('productOrder', [...productOrder, res.id]);
      // Não precisa chamar fetchProducts, pois updateSetting já reordena e atualiza o estado local
    }
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    const res = await productService.updateProduct(id, data);
    if (res) await fetchProducts(productOrder); // Rebusca e reordena
  };

  const deleteProduct = async (id: string) => {
    const res = await productService.deleteProduct(id);
    if (res) {
      // Remove o produto da ordem persistida
      await updateSetting('productOrder', productOrder.filter(pId => pId !== id));
      // Não precisa chamar fetchProducts, pois updateSetting já reordena e atualiza o estado local
    }
  };

  const registerStockEntry = async (id: string, qtd: number, custo: number) => {
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    const novoTotal = p.estoquePrincipal + qtd;
    const novoCusto = novoTotal > 0 ? ((p.estoquePrincipal * p.precoCusto) + (qtd * custo)) / novoTotal : custo;
    const finalCusto = Number(novoCusto.toFixed(2));
    const finalVenda = margemGlobalAtiva ? Number((finalCusto / (1 - margemGlobalValor / 100)).toFixed(2)) : p.precoVenda;
    const res = await productService.updateProduct(id, { estoquePrincipal: novoTotal, precoCusto: finalCusto, precoVenda: finalVenda });
    if (res) await fetchProducts(productOrder); // Rebusca e reordena
  };

  const addClient = async (data: Omit<Client, 'id'>) => {
    const res = await clientService.insertClient(data);
    if (res) {
      await fetchClients();
      // Se o cliente for adicionado para o dia de hoje, atualiza a rota
      const todayDay = new Date().getDay();
      if (res.diaRoteiro === todayDay && currentUser?.role === 'VENDEDOR') {
        await handleUpdateDailyRoute([...dailyRouteState.clientIds, res.id], dailyRouteState.skippedClientIds);
      }
    }
  };

  const updateClient = async (id: string, data: Partial<Client>) => {
    const res = await clientService.updateClient(id, data);
    if (res) await fetchClients();
  };

  const deleteClient = async (id: string) => {
    const res = await clientService.deleteClient(id);
    if (res) await fetchClients();
  };

  const syncVendedorCarga = async (vId: string, itens: { produtoId: string, quantidade: number }[]) => {
    const res = await cargaService.insertCargaPendente({ vendedorId: vId, itens, data: new Date() });
    if (res) {
      await fetchTransactionalData();
    }
  };

  const applyCargaDirectly = async (vId: string, itens: { produtoId: string, quantidade: number }[]) => {
    // Atualiza o estoque principal dos produtos primeiro
    for (const item of itens) {
      const p = products.find(prod => prod.id === item.produtoId);
      const noVAnterior = cargas.find(c => c.vendedorId === vId && c.produtoId === item.produtoId)?.quantidade || 0;
      const delta = item.quantidade - noVAnterior;
      if (p) {
        await productService.updateProduct(p.id, { estoquePrincipal: p.estoquePrincipal - delta });
      }
    }
    const res = await cargaService.updateActiveCarga(vId, itens);
    if (res) {
      await fetchCoreData();
    }
  };

  const aceitarCarga = async (pendenciaId: string) => {
    const pendencia = cargasPendentes.find(p => p.id === pendenciaId);
    if (!pendencia) return;
    for (const item of pendencia.itens) {
      const p = products.find(prod => prod.id === item.produtoId);
      if (p) await productService.updateProduct(p.id, { estoquePrincipal: p.estoquePrincipal - item.quantidade });
    }
    
    // Atualiza a carga ativa no banco
    await cargaService.updateActiveCarga(pendencia.vendedorId, pendencia.itens);
    // Remove a pendência do banco
    await cargaService.deleteCargaPendente(pendenciaId);
    
    await fetchCoreData();
    setAdminNotification("Carga aceita com sucesso.");
  };

  const processSale = async (saleData: any) => {
    const valorTotalFixed = Number(saleData.valorTotal.toFixed(2));
    const salePayload: Omit<Sale, 'id'> = { 
      ...saleData, 
      data: new Date(), 
      valorTotal: valorTotalFixed, 
      valorPago: saleData.statusPagamento === 'PAGO' ? valorTotalFixed : 0 
    };

    // 1. Salvar no Supabase
    const savedSale = await saleService.insertSale(salePayload);
    if (!savedSale) return null;

    // 2. Calcular e Salvar Comissão no Supabase
    const totalComissao = saleData.itens.reduce((acc: number, item: any) => {
      const p = products.find(prod => prod.id === item.produtoId);
      return acc + (item.precoVenda * item.quantidade * ((p?.comissaoPercentual || 0) / 100));
    }, 0);
    const effectivePercentual = valorTotalFixed > 0 ? (totalComissao / valorTotalFixed) * 100 : 0;
    
    const commissionPayload: Omit<Commission, 'id'> = { 
      saleId: savedSale.id, 
      vendedorId: saleData.vendedorId, 
      valor: Number(totalComissao.toFixed(2)), 
      valorBase: valorTotalFixed, 
      percentual: Number(effectivePercentual.toFixed(2)), 
      status: saleData.statusPagamento === 'PAGO' ? 'DISPONIVEL' : 'A_RECEBER', 
      dataGeracao: new Date() 
    };
    await commissionService.insertCommission(commissionPayload);

    // 3. Atualizar Carga no Supabase
    const minhaCargaAtual = cargas.filter(c => c.vendedorId === saleData.vendedorId);
    const novaCargaItems = minhaCargaAtual.map(c => {
      const itemVendido = saleData.itens.find((i: any) => i.produtoId === c.produtoId);
      return {
        produtoId: c.produtoId,
        quantidade: Math.max(0, c.quantidade - (itemVendido?.quantidade || 0))
      };
    });
    await cargaService.updateActiveCarga(saleData.vendedorId, novaCargaItems);

    // 4. Sincronizar estados
    await fetchTransactionalData();
    return savedSale;
  };

  const deleteSaleInternal = async (saleId: string, isAdmin: boolean) => {
    const saleToDelete = sales.find(s => s.id === saleId);
    if (!saleToDelete) return;

    // 1. Remover Comissões associadas (Garantia de integridade, caso o CASCADE não esteja ativo)
    // O saleService.deleteSale deve remover os sale_items via CASCADE.
    // A comissão também deve ser removida.
    await commissionService.deleteCommissionBySale(saleId);

    // 2. Remover a Venda do Supabase (A regra Cascade deve tratar os sale_items)
    const success = await saleService.deleteSale(saleId);
    if (!success) return;

    // 3. Estornar Carga no Supabase
    const minhaCargaAtual = cargas.filter(c => c.vendedorId === saleToDelete.vendedorId);
    const novaCargaItems = [...minhaCargaAtual];
    saleToDelete.itens.forEach(item => {
      const idx = novaCargaItems.findIndex(c => c.produtoId === item.produtoId);
      if (idx !== -1) novaCargaItems[idx].quantidade += item.quantidade;
      else novaCargaItems.push({ vendedorId: saleToDelete.vendedorId, produtoId: item.produtoId, quantidade: item.quantidade });
    });
    await cargaService.updateActiveCarga(saleToDelete.vendedorId, novaCargaItems);

    // 4. Sincronizar estados
    await fetchTransactionalData();
  };

  const receiveAccount = async (saleId: string, method: PaymentMethod, amount?: number) => {
    const s = sales.find(sale => sale.id === saleId);
    if (!s) return;

    const novoValorPago = Number(((s.valorPago ?? 0) + (amount || s.valorTotal)).toFixed(2));
    const totalQuitado = novoValorPago >= s.valorTotal;

    // 1. Atualizar Venda no Supabase
    await saleService.updateSale(saleId, { 
      valorPago: novoValorPago, 
      statusPagamento: totalQuitado ? 'PAGO' : 'PENDENTE', 
      metodoPagamento: method 
    });

    // 2. Se quitado, atualizar Comissão no Supabase
    if (totalQuitado) {
      const comm = commissions.find(c => c.saleId === saleId && c.status === 'A_RECEBER');
      if (comm) await commissionService.updateCommissionStatus(comm.id, 'DISPONIVEL');
    }

    // 3. Sincronizar estados
    await fetchTransactionalData();
  };

  const handlePayCommission = async (vendedorId: string, amount: number, type: 'TOTAL' | 'PARCIAL', adminId: string) => {
    const v = users.find(u => u.id === vendedorId);
    if (!v) return;

    // 1. Salvar Log de Pagamento no Supabase
    const logSuccess = await commissionService.insertPayout({
      vendedorId,
      vendedorNome: v.nome,
      valorPago: amount,
      valorRestante: 0,
      tipo: type,
      dataPagamento: new Date(),
      adminId
    });

    if (!logSuccess) return;

    // 2. Atualizar status das comissões para pendente de confirmação
    await commissionService.bulkUpdateStatusByVendedor(vendedorId, 'DISPONIVEL', 'PENDENTE_CONFIRMACAO');

    // 3. Criar Mensagem no Supabase
    await messageService.insertMessage({
      vendedorId,
      titulo: "💰 Comissão Disponível",
      mensagem: `O administrador registrou o pagamento de R$ ${amount.toFixed(2)}. Aceite para confirmar.`,
      data: new Date(),
      lida: false,
      type: 'COMMISSION_CONFIRMATION'
    });

    // 4. Sincronizar estados
    await fetchTransactionalData();
  };

  const markMessageAsRead = async (msgId: string) => {
    const m = messages.find(msg => msg.id === msgId);
    if (!m) return;

    // 1. Atualizar Mensagem no Supabase
    await messageService.updateMessage(msgId, { lida: true });

    // 2. Se for confirmação de comissão, atualizar comissões no Supabase
    if (m.type === 'COMMISSION_CONFIRMATION') {
      await commissionService.bulkUpdateStatusByVendedor(m.vendedorId, 'PENDENTE_CONFIRMACAO', 'PAGO');
    }

    // 3. Sincronizar estados
    await fetchTransactionalData();
  };

  const handleUpdateDailyRoute = async (clientIds: string[], skippedClientIds: string[]) => {
    if (currentUser && currentUser.role === 'VENDEDOR') {
      const newState = { date: dailyRouteState.date, clientIds, skippedClientIds };
      setDailyRouteState(newState);
      await dailyRouteService.updateRoute(currentUser.id, newState);
    }
  };

  if (!currentUser) return <Login users={users} onLogin={setCurrentUser} logo={logo} />;

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 flex flex-col">
      <header className="bg-white text-gray-800 h-20 px-6 shadow-sm flex justify-between items-center sticky top-0 z-50 border-b border-gray-100">
        <div className="flex items-center h-full">
          {logo ? ( <img src={logo} alt="Logo" className="h-16 w-auto object-contain" /> ) : (
            <div className="h-10 w-32 bg-gray-100 rounded-lg flex items-center justify-center border border-gray-200">
               <span className="text-[10px] font-black uppercase text-gray-400">Logo</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] font-black uppercase text-gray-400 mb-0.5">{currentUser.role}</p>
            <p className="text-sm font-bold text-gray-800 leading-none">{currentUser.nome}</p>
          </div>
          <button onClick={() => setCurrentUser(null)} className="bg-gray-50 text-gray-400 hover:text-rose-500 p-2.5 rounded-xl border border-gray-100 transition-colors">
            <i className="fa-solid fa-right-from-bracket"></i>
          </button>
        </div>
      </header>
      
      <main className="container mx-auto p-4 max-w-lg">
        {currentUser.role === 'ADMIN' ? (
          <AdminDashboard 
            products={products} users={users} cargas={cargas} clients={clients} sales={sales} commissions={commissions} payoutLogs={payoutLogs}
            addProduct={addProduct} updateProduct={updateProduct} deleteProduct={deleteProduct} registerStockEntry={registerStockEntry}
            adjustStockManual={()=>{}} syncVendedorCarga={syncVendedorCarga} applyCargaDirectly={applyCargaDirectly} addClient={addClient} updateClient={updateClient}
            deleteClient={deleteClient} addUser={addUser} updateUser={updateUser} payCommission={handlePayCommission}
            setCommissions={()=>{}} updateEstoqueCentral={()=>{}} reinforceCarga={()=>{}} deleteSale={(id) => deleteSaleInternal(id, true)}
            receiveAccount={receiveAccount} logo={logo} setLogo={(val) => updateSetting('logo', val)} adminUser={currentUser} margemGlobalAtiva={margemGlobalAtiva}
            setMargemGlobalAtiva={(val) => updateSetting('margemGlobalAtiva', val)} margemGlobalValor={margemGlobalValor} setMargemGlobalValor={(val) => updateSetting('margemGlobalValor', val)}
            margemMinima={margemMinima} setMargemMinima={(val) => updateSetting('margemMinima', val)} margemMinimaAtiva={margemMinimaAtiva}
            setMargemMinimaAtiva={(val) => updateSetting('margemMinimaAtiva', val)} pix1Name={pix1Name} setPix1Name={(val) => updateSetting('pix1Name', val)} pix1Code={pix1Code} setPix1Code={(val) => updateSetting('pix1Code', val)}
            pix2Name={pix2Name} setPix2Name={(val) => updateSetting('pix2Name', val)} pix2Code={pix2Code} setPix2Code={(val) => updateSetting('pix2Code', val)}
            adminNotification={adminNotification} clearAdminNotification={() => setAdminNotification(null)}
            orderedProductIds={productOrder} setOrderedProductIds={(ids) => updateSetting('productOrder', ids)} // Passando e salvando a ordem
          />
        ) : (
          <VendedorDashboard 
            products={products} users={users} cargas={cargas} clients={clients} sales={sales} commissions={commissions}
            addClient={addClient} updateClient={updateClient} deleteClient={deleteClient}
            user={currentUser} 
            payoutLogs={payoutLogs.filter(l => l.vendedorId === currentUser.id)}
            cargasPendentes={cargasPendentes.filter(cp => cp.vendedorId === currentUser.id)}
            messages={messages.filter(m => m.vendedorId === currentUser.id)}
            markMessageAsRead={markMessageAsRead} processSale={processSale} 
            receivePayment={receiveAccount} deleteSale={(id) => deleteSaleInternal(id, false)} aceitarCarga={aceitarCarga}
            margemMinima={margemMinima} margemMinimaAtiva={margemMinimaAtiva} pix1Name={pix1Name} pix1Code={pix1Code}
            pix2Name={pix2Name} pix2Code={pix2Code}
            dailyRouteState={dailyRouteState}
            updateDailyRoute={handleUpdateDailyRoute}
          />
        )}
      </main>
    </div>
  );
};

export default App;