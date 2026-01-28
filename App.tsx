import React, { useState, useEffect, useCallback } from 'react';
import { User, Product, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage } from './types';
import AdminDashboard from './components/AdminDashboard';
import VendedorDashboard from './components/VendedorDashboard';
import Login from './components/Login';
import { userService } from './services/userService';
import { productService } from './services/productService';
import { clientService } from './services/clientService';
import { appSettingsService, AppSettings } from './services/appSettingsService';
import { generateId } from './utils/uuid';
import { 
  loadLocalState, saveLocalState, 
  DEFAULT_CARGAS, DEFAULT_CARGAS_PENDENTES, DEFAULT_SALES, 
  DEFAULT_COMMISSIONS, DEFAULT_PAYOUT_LOGS, DEFAULT_MESSAGES 
} from './utils/persistence';

const App: React.FC = () => {
  // Carrega o usuário persistido na inicialização
  const [currentUser, setCurrentUser] = useState<User | null>(() => loadLocalState('currentUser', null));
  
  // Configurações Globais (Supabase-backed)
  const [logo, setLogo] = useState<string | null>(null);
  const [margemGlobalAtiva, setMargemGlobalAtiva] = useState(true);
  const [margemGlobalValor, setMargemGlobalValor] = useState(35);
  const [margemMinima, setMargemMinima] = useState(20); 
  const [margemMinimaAtiva, setMargemMinimaAtiva] = useState(true); 
  const [pix1Name, setPix1Name] = useState("Pix Banco A");
  const [pix1Code, setPix1Code] = useState<string | null>(null);
  const [pix2Name, setPix2Name] = useState("Pix Banco B");
  const [pix2Code, setPix2Code] = useState<string | null>(null);

  const [adminNotification, setAdminNotification] = useState<string | null>(null);
  
  // Dados Supabase (Carregados na inicialização)
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  // Dados Locais (Persistidos via localStorage)
  const [cargas, setCargas] = useState<Carga[]>(loadLocalState('cargas', DEFAULT_CARGAS));
  const [cargasPendentes, setCargasPendentes] = useState<CargaPendente[]>(loadLocalState('cargasPendentes', DEFAULT_CARGAS_PENDENTES));
  const [sales, setSales] = useState<Sale[]>(loadLocalState('sales', DEFAULT_SALES));
  const [commissions, setCommissions] = useState<Commission[]>(loadLocalState('commissions', DEFAULT_COMMISSIONS));
  const [payoutLogs, setPayoutLogs] = useState<CommissionPaymentLog[]>(loadLocalState('payoutLogs', DEFAULT_PAYOUT_LOGS));
  const [messages, setMessages] = useState<SystemMessage[]>(loadLocalState('messages', DEFAULT_MESSAGES));

  // --- Efeitos de Persistência Local ---
  useEffect(() => { saveLocalState('currentUser', currentUser); }, [currentUser]);
  useEffect(() => { saveLocalState('cargas', cargas); }, [cargas]);
  useEffect(() => { saveLocalState('cargasPendentes', cargasPendentes); }, [cargasPendentes]);
  useEffect(() => { saveLocalState('sales', sales); }, [sales]);
  useEffect(() => { saveLocalState('commissions', commissions); }, [commissions]);
  useEffect(() => { saveLocalState('payoutLogs', payoutLogs); }, [payoutLogs]);
  useEffect(() => { saveLocalState('messages', messages); }, [messages]);
  // -------------------------------------

  const fetchUsers = useCallback(async () => { setUsers(await userService.getAllUsers()); }, []);
  const fetchProducts = useCallback(async () => { setProducts(await productService.getAllProducts()); }, []);
  const fetchClients = useCallback(async () => { setClients(await clientService.getAllClients()); }, []);
  
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
    } catch (e) {
      console.error("Erro ao carregar configurações iniciais do Supabase:", e);
    }

    await Promise.all([
      fetchUsers(),
      fetchProducts(),
      fetchClients()
    ]);
  }, [fetchUsers, fetchProducts, fetchClients]);

  useEffect(() => {
    fetchCoreData();
  }, [fetchCoreData]);

  // Recalcula preço de venda se margem global mudar
  useEffect(() => {
    if (margemGlobalAtiva) {
      setProducts(prev => prev.map(p => ({
        ...p,
        precoVenda: Number(((Number(p.precoCusto) || 0) / (1 - margemGlobalValor / 100)).toFixed(2))
      })));
    }
  }, [margemGlobalAtiva, margemGlobalValor]);

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
        }
    }
  }, []);

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
    if (res) await fetchProducts();
  };

  const updateProduct = async (id: string, data: Partial<Product>) => {
    const res = await productService.updateProduct(id, data);
    if (res) await fetchProducts();
  };

  const deleteProduct = async (id: string) => {
    const res = await productService.deleteProduct(id);
    if (res) await fetchProducts();
  };

  const registerStockEntry = async (id: string, qtd: number, custo: number) => {
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    const novoTotal = p.estoquePrincipal + qtd;
    const novoCusto = novoTotal > 0 ? ((p.estoquePrincipal * p.precoCusto) + (qtd * custo)) / novoTotal : custo;
    const finalCusto = Number(novoCusto.toFixed(2));
    const finalVenda = margemGlobalAtiva ? Number((finalCusto / (1 - margemGlobalValor / 100)).toFixed(2)) : p.precoVenda;
    const res = await productService.updateProduct(id, { estoquePrincipal: novoTotal, precoCusto: finalCusto, precoVenda: finalVenda });
    if (res) await fetchProducts();
  };

  const adjustStockManual = async (id: string, q: number, t: 'ADICAO' | 'SUBTRACAO') => {
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    const newStock = Math.max(0, p.estoquePrincipal + (t === 'ADICAO' ? q : -q));
    const res = await productService.updateProduct(id, { estoquePrincipal: newStock });
    if (res) await fetchProducts();
  };

  const addClient = async (data: Omit<Client, 'id'>) => {
    const clientPayload: Omit<Client, 'id'> = { ...data, bairro: data.bairro || 'N/D', endereco: data.endereco || 'N/D', telefone: data.telefone || 'N/D', diaRoteiro: data.diaRoteiro || 1, ativo: data.ativo ?? true, ativarCnpj: data.ativarCnpj ?? false };
    const res = await clientService.insertClient(clientPayload);
    if (res) await fetchClients();
  };

  const updateClient = async (id: string, data: Partial<Client>) => {
    const res = await clientService.updateClient(id, data);
    if (res) await fetchClients();
  };

  const deleteClient = async (id: string) => {
    const res = await clientService.deleteClient(id);
    if (res) await fetchClients();
  };

  const syncVendedorCarga = (vendedorId: string, novosItens: { produtoId: string, quantidade: number }[]) => {
    const cp: CargaPendente = { id: generateId(), vendedorId, itens: novosItens, data: new Date() };
    setCargasPendentes(prev => [...prev, cp]);
    setAdminNotification("Carga enviada para aceite do vendedor.");
  };

  const applyCargaDirectly = (vendedorId: string, novosItens: { produtoId: string, quantidade: number }[]) => {
    const otherCargas = cargas.filter(c => c.vendedorId !== vendedorId);
    const newCargas = novosItens.filter(i => i.quantidade > 0).map(i => ({ vendedorId: vendedorId, produtoId: i.produtoId, quantidade: i.quantidade }));
    setCargas([...otherCargas, ...newCargas]);
    setAdminNotification("Carga aplicada diretamente com sucesso.");
  };

  const aceitarCarga = async (pendenciaId: string) => {
    const pendencia = cargasPendentes.find(p => p.id === pendenciaId);
    if (!pendencia) return;
    for (const item of pendencia.itens) {
      const p = products.find(prod => prod.id === item.produtoId);
      if (p) {
        await productService.updateProduct(p.id, { estoquePrincipal: p.estoquePrincipal - item.quantidade });
      }
    }
    const otherCargas = cargas.filter(c => c.vendedorId !== pendencia.vendedorId);
    const newCargas = pendencia.itens.filter(i => i.quantidade > 0).map(i => ({ vendedorId: pendencia.vendedorId, produtoId: i.produtoId, quantidade: i.quantidade }));
    setCargas([...otherCargas, ...newCargas]);
    setCargasPendentes(prev => prev.filter(cp => cp.id !== pendenciaId));
    await fetchProducts();
    setAdminNotification("Carga aceita pelo vendedor com sucesso.");
  };

  const processSale = async (saleData: any) => {
    const valorTotalFixed = Number(saleData.valorTotal.toFixed(2));
    const newSale: Sale = { ...saleData, id: generateId(), data: new Date(), valorTotal: valorTotalFixed, valorPago: saleData.statusPagamento === 'PAGO' ? valorTotalFixed : 0 };
    setSales(prev => [...prev, newSale]);
    setCargas(prevCargas => {
      const updatedCargas = [...prevCargas];
      saleData.itens.forEach((item: any) => {
        const idx = updatedCargas.findIndex(c => c.vendedorId === saleData.vendedorId && c.produtoId === item.produtoId);
        if (idx !== -1) {
          updatedCargas[idx].quantidade = Math.max(0, updatedCargas[idx].quantidade - item.quantidade);
        }
      });
      return updatedCargas.filter(c => c.quantidade > 0);
    });
    const totalComissao = saleData.itens.reduce((acc: number, item: any) => {
      const p = products.find(prod => prod.id === item.produtoId);
      return acc + (item.precoVenda * item.quantidade * ((p?.comissaoPercentual || 0) / 100));
    }, 0);
    const effectivePercentual = valorTotalFixed > 0 ? (totalComissao / valorTotalFixed) * 100 : 0;
    const newCommission: Commission = { id: generateId(), saleId: newSale.id, vendedorId: saleData.vendedorId, valor: Number(totalComissao.toFixed(2)), valorBase: valorTotalFixed, percentual: Number(effectivePercentual.toFixed(2)), status: saleData.statusPagamento === 'PAGO' ? 'DISPONIVEL' : 'A_RECEBER', dataGeracao: new Date() };
    setCommissions(prev => [...prev, newCommission]);
    return newSale;
  };

  const deleteSaleInternal = (saleId: string, isAdmin: boolean) => {
    const saleToDelete = sales.find(s => s.id === saleId);
    if (!saleToDelete) return;
    setCargas(prevCargas => {
      const updatedCargas = [...prevCargas];
      saleToDelete.itens.forEach(item => {
        const idx = updatedCargas.findIndex(c => c.vendedorId === saleToDelete.vendedorId && c.produtoId === item.produtoId);
        if (idx !== -1) updatedCargas[idx].quantidade += item.quantidade;
        else updatedCargas.push({ vendedorId: saleToDelete.vendedorId, produtoId: item.produtoId, quantidade: item.quantidade });
      });
      return updatedCargas;
    });
    setCommissions(prev => prev.filter(c => c.saleId !== saleId));
    setSales(prev => prev.filter(s => s.id !== saleId));
  };

  const receiveAccount = (saleId: string, method: PaymentMethod, amount?: number) => {
    let saleUpdated: Sale | undefined;
    setSales(prevSales => prevSales.map(s => {
      if (s.id !== saleId) return s;
      const novoValorPago = Number(((s.valorPago ?? 0) + (amount || s.valorTotal)).toFixed(2));
      const totalQuitado = novoValorPago >= s.valorTotal;
      saleUpdated = { ...s, valorPago: novoValorPago, statusPagamento: totalQuitado ? 'PAGO' : 'PENDENTE', metodoPagamento: method };
      return saleUpdated;
    }));
    if (saleUpdated && saleUpdated.statusPagamento === 'PAGO') {
      setCommissions(prevComms => prevComms.map(c => c.saleId === saleId && c.status === 'A_RECEBER' ? { ...c, status: 'DISPONIVEL' } : c));
    }
  };

  const handlePayCommission = (vendedorId: string, amount: number, type: 'TOTAL' | 'PARCIAL', adminId: string) => {
    const v = users.find(u => u.id === vendedorId);
    if (!v) return;
    const jaPagoNoPassado = payoutLogs.filter(l => l.vendedorId === vendedorId).reduce((acc, curr) => acc + curr.valorPago, 0);
    const totalCommsEligible = commissions.filter(c => c.vendedorId === vendedorId && c.status !== 'A_RECEBER').reduce((acc, curr) => acc + curr.valor, 0);
    const saldoReal = totalCommsEligible - jaPagoNoPassado;
    const newLog: CommissionPaymentLog = { id: generateId(), vendedorId, vendedorNome: v.nome, valorPago: amount, valorRestante: saldoReal - amount, tipo: type, dataPagamento: new Date(), adminId };
    setPayoutLogs(prev => [...prev, newLog]);
    setCommissions(prev => prev.map(c => c.vendedorId === vendedorId && c.status === 'DISPONIVEL' ? { ...c, status: 'PENDENTE_CONFIRMACAO' } : c));
    const newMessage: SystemMessage = { id: generateId(), vendedorId, titulo: "💰 Comissão Disponível para Confirmação", mensagem: `O administrador registrou o pagamento de R$ ${amount.toFixed(2)}. Aceite para confirmar.`, data: new Date(), lida: false, type: 'COMMISSION_CONFIRMATION' };
    setMessages(prev => [...prev, newMessage]);
  };

  const markMessageAsRead = (msgId: string) => {
    const m = messages.find(msg => msg.id === msgId);
    if (m && m.type === 'COMMISSION_CONFIRMATION') {
      setCommissions(prev => prev.map(c => c.vendedorId === m.vendedorId && c.status === 'PENDENTE_CONFIRMACAO' ? { ...c, status: 'PAGO' } : c));
    }
    setMessages(prev => prev.map(msg => msg.id === msgId ? { ...msg, lida: true } : msg));
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
            adjustStockManual={adjustStockManual} syncVendedorCarga={syncVendedorCarga} applyCargaDirectly={applyCargaDirectly} addClient={addClient} updateClient={updateClient}
            deleteClient={deleteClient} addUser={addUser} updateUser={updateUser} payCommission={handlePayCommission}
            setCommissions={()=>{}} updateEstoqueCentral={()=>{}} reinforceCarga={()=>{}} deleteSale={(id) => deleteSaleInternal(id, true)}
            receiveAccount={receiveAccount} logo={logo} setLogo={(val) => updateSetting('logo', val)} adminUser={currentUser} margemGlobalAtiva={margemGlobalAtiva}
            setMargemGlobalAtiva={(val) => updateSetting('margemGlobalAtiva', val)} margemGlobalValor={margemGlobalValor} setMargemGlobalValor={(val) => updateSetting('margemGlobalValor', val)}
            margemMinima={margemMinima} setMargemMinima={(val) => updateSetting('margemMinima', val)} margemMinimaAtiva={margemMinimaAtiva}
            setMargemMinimaAtiva={(val) => updateSetting('margemMinimaAtiva', val)} pix1Name={pix1Name} setPix1Name={(val) => updateSetting('pix1Name', val)} pix1Code={pix1Code} setPix1Code={(val) => updateSetting('pix1Code', val)}
            pix2Name={pix2Name} setPix2Name={(val) => updateSetting('pix2Name', val)} pix2Code={pix2Code} setPix2Code={(val) => updateSetting('pix2Code', val)}
            adminNotification={adminNotification} clearAdminNotification={() => setAdminNotification(null)}
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
          />
        )}
      </main>
    </div>
  );
};

export default App;