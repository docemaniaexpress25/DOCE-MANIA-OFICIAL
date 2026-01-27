import React, { useState, useEffect } from 'react';
import { User, Product, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage } from './types';
import AdminDashboard from './components/AdminDashboard';
import VendedorDashboard from './components/VendedorDashboard';
import Login from './components/Login';
import { userService } from './services/userService';
import { productService } from './services/productService';
import { clientService } from './services/clientService';
import { saleService } from './services/saleService';
import { commissionService } from './services/commissionService';
import { cargaService } from './services/cargaService';
import { messageService } from './services/messageService';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
  
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [cargasPendentes, setCargasPendentes] = useState<CargaPendente[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payoutLogs, setPayoutLogs] = useState<CommissionPaymentLog[]>([]);
  const [messages, setMessages] = useState<SystemMessage[]>([]);

  const fetchUsers = async () => { setUsers(await userService.getAllUsers()); };
  const fetchProducts = async () => { setProducts(await productService.getAllProducts()); };
  const fetchClients = async () => { setClients(await clientService.getAllClients()); };
  const fetchSales = async () => { setSales(await saleService.getAllSales()); };
  const fetchCommissions = async () => { 
    setCommissions(await commissionService.getAllCommissions());
    setPayoutLogs(await commissionService.getAllPayouts());
  };
  
  const fetchCargas = async () => {
    const active = await cargaService.getAllCargas();
    const pending = await cargaService.getAllCargasPendentes(
      currentUser?.role === 'VENDEDOR' ? currentUser.id : undefined
    );
    setCargas(active);
    setCargasPendentes(pending);
  };

  const fetchMessages = async () => { setMessages(await messageService.getAllMessages()); };

  // Carga inicial de dados globais
  useEffect(() => {
    const loadGlobals = async () => {
      await Promise.all([
        fetchUsers(),
        fetchProducts(),
        fetchClients()
      ]);
    };
    loadGlobals();
  }, []);

  // Recarrega dados específicos sempre que o usuário logar ou mudar
  useEffect(() => {
    if (currentUser) {
      fetchCargas();
      fetchSales();
      fetchCommissions();
      fetchMessages();
    }
  }, [currentUser]);

  useEffect(() => {
    if (margemGlobalAtiva) {
      setProducts(prev => prev.map(p => ({
        ...p,
        precoVenda: Number(((Number(p.precoCusto) || 0) / (1 - margemGlobalValor / 100)).toFixed(2))
      })));
    }
  }, [margemGlobalAtiva, margemGlobalValor]);

  const addUser = async (nome: string, foto?: string, telefone?: string) => {
    const newUser: Omit<User, 'id'> = {
      nome,
      email: `${nome.toLowerCase().replace(/\s/g, '')}@sistema.com`,
      role: 'VENDEDOR',
      ativo: true,
      foto,
      telefone,
      pin: '123456' 
    };
    const res = await userService.insertUser(newUser);
    if (res) await fetchUsers();
  };

  const updateUser = async (id: string, data: Partial<User>) => {
    const res = await userService.updateUser(id, data);
    if (res) await fetchUsers();
  };

  const addProduct = async (nome: string, custo: number, venda: number, comissao: number) => {
    const newProduct: Omit<Product, 'id'> = { 
      nome, 
      precoCusto: Number(custo.toFixed(2)), 
      precoVenda: Number(venda.toFixed(2)), 
      comissaoPercentual: Number(comissao.toFixed(2)), 
      estoquePrincipal: 0, 
      ativo: true 
    };
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

  const syncVendedorCarga = async (vendedorId: string, novosItens: { produtoId: string, quantidade: number }[]) => {
    // A carga pendente agora é persistida no Supabase
    const cp: Omit<CargaPendente, 'id'> = { vendedorId, itens: novosItens, data: new Date() };
    const res = await cargaService.insertCargaPendente(cp);
    if (res) {
      await fetchCargas(); // Re-sincroniza estado imediatamente após insert bem sucedido
    }
  };

  const aceitarCarga = async (pendenciaId: string) => {
    const pendencia = cargasPendentes.find(p => p.id === pendenciaId);
    if (!pendencia) return;

    // 1. Atualizar estoque principal dos produtos no Supabase (redução)
    for (const item of pendencia.itens) {
      const p = products.find(prod => prod.id === item.produtoId);
      if (p) {
        await productService.updateProduct(p.id, { estoquePrincipal: p.estoquePrincipal - item.quantidade });
      }
    }

    // 2. Atualizar carga ativa do vendedor no Supabase (Substitui a carga antiga pela nova)
    await cargaService.updateActiveCarga(pendencia.vendedorId, pendencia.itens);

    // 3. Deletar pendência no Supabase
    await cargaService.deleteCargaPendente(pendenciaId);

    // 4. Refresh Total para garantir integridade
    await Promise.all([fetchProducts(), fetchCargas()]);
    setAdminNotification("Carga aceita pelo vendedor com sucesso.");
  };

  const addClient = async (data: Omit<Client, 'id'>) => {
    const res = await clientService.insertClient(data);
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

  const processSale = async (saleData: any) => {
    const valorTotalFixed = Number(saleData.valorTotal.toFixed(2));
    const salePayload: Omit<Sale, 'id'> = { 
      ...saleData, 
      data: new Date(), 
      valorTotal: valorTotalFixed,
      valorPago: saleData.statusPagamento === 'PAGO' ? valorTotalFixed : 0,
    };

    const newSale = await saleService.insertSale(salePayload);
    if (!newSale) return null;

    // Atualiza a carga ativa do vendedor no Supabase (redução de estoque)
    const minhaCarga = cargas.filter(c => c.vendedorId === saleData.vendedorId);
    const novosItensCarga = minhaCarga.map(c => {
      const itemVendido = saleData.itens.find((i: any) => i.produtoId === c.produtoId);
      return { produtoId: c.produtoId, quantidade: Math.max(0, c.quantidade - (itemVendido?.quantidade || 0)) };
    });
    await cargaService.updateActiveCarga(saleData.vendedorId, novosItensCarga);

    const totalComissao = saleData.itens.reduce((acc: number, item: any) => {
      const p = products.find(prod => prod.id === item.produtoId);
      return acc + (item.precoVenda * item.quantidade * ((p?.comissaoPercentual || 0) / 100));
    }, 0);

    await commissionService.insertCommission({
      saleId: newSale.id,
      vendedorId: saleData.vendedorId,
      valor: Number(totalComissao.toFixed(2)),
      status: saleData.statusPagamento === 'PAGO' ? 'DISPONIVEL' : 'A_RECEBER',
      dataGeracao: new Date()
    });

    await Promise.all([fetchSales(), fetchCargas(), fetchCommissions()]);
    return newSale;
  };

  const deleteSaleInternal = async (saleId: string, isAdmin: boolean) => {
    const saleToDelete = sales.find(s => s.id === saleId);
    if (!saleToDelete) return;

    // Estorno da carga ativa do vendedor no Supabase
    const minhaCarga = cargas.filter(c => c.vendedorId === saleToDelete.vendedorId);
    const cargaAtualizada = [...minhaCarga];
    saleToDelete.itens.forEach(item => {
      const idx = cargaAtualizada.findIndex(c => c.produtoId === item.produtoId);
      if (idx !== -1) cargaAtualizada[idx].quantidade += item.quantidade;
      else cargaAtualizada.push({ vendedorId: saleToDelete.vendedorId, produtoId: item.produtoId, quantidade: item.quantidade });
    });
    await cargaService.updateActiveCarga(saleToDelete.vendedorId, cargaAtualizada);

    await commissionService.deleteCommissionBySale(saleId);
    await saleService.deleteSale(saleId);

    await Promise.all([fetchSales(), fetchCargas(), fetchCommissions()]);
  };

  const receiveAccount = async (saleId: string, method: PaymentMethod, amount?: number) => {
    const s = sales.find(sale => sale.id === saleId);
    if (!s) return;

    const novoValorPago = Number(((s.valorPago ?? 0) + (amount || s.valorTotal)).toFixed(2));
    const totalQuitado = novoValorPago >= s.valorTotal;

    await saleService.updateSale(saleId, { 
      valorPago: novoValorPago, 
      statusPagamento: totalQuitado ? 'PAGO' : 'PENDENTE',
      metodoPagamento: method
    });

    if (totalQuitado) {
      const comm = commissions.find(c => c.saleId === saleId);
      if (comm) await commissionService.updateCommissionStatus(comm.id, 'DISPONIVEL');
    }

    await Promise.all([fetchSales(), fetchCommissions()]);
  };

  const handlePayCommission = async (vendedorId: string, amount: number, type: 'TOTAL' | 'PARCIAL', adminId: string) => {
    const v = users.find(u => u.id === vendedorId);
    if (!v) return;

    const jaPagoNoPassado = payoutLogs.filter(l => l.vendedorId === vendedorId).reduce((acc, curr) => acc + curr.valorPago, 0);
    const totalDisp = commissions.filter(c => c.vendedorId === vendedorId && c.status === 'DISPONIVEL').reduce((acc, curr) => acc + curr.valor, 0);
    const saldoReal = totalDisp - jaPagoNoPassado;

    await commissionService.insertPayout({
      vendedorId, vendedorNome: v.nome, valorPago: amount, valorRestante: saldoReal - amount, tipo: type, dataPagamento: new Date(), adminId
    });

    await commissionService.bulkUpdateStatusByVendedor(vendedorId, 'DISPONIVEL', 'PENDENTE_CONFIRMACAO');

    await messageService.insertMessage({
      vendedorId,
      titulo: "💰 Comissão Disponível para Confirmação",
      mensagem: `O administrador registrou o pagamento de R$ ${amount.toFixed(2)}. Aceite para confirmar.`,
      data: new Date(),
      lida: false,
      type: 'COMMISSION_CONFIRMATION'
    });

    await Promise.all([fetchCommissions(), fetchMessages()]);
  };

  const markMessageAsRead = async (msgId: string) => {
    const m = messages.find(msg => msg.id === msgId);
    if (m && m.type === 'COMMISSION_CONFIRMATION') {
      await commissionService.bulkUpdateStatusByVendedor(m.vendedorId, 'PENDENTE_CONFIRMACAO', 'PAGO');
    }
    await messageService.updateMessage(msgId, { lida: true });
    await Promise.all([fetchMessages(), fetchCommissions()]);
  };

  if (!currentUser) return <Login users={users} onLogin={setCurrentUser} logo={logo} />;

  return (
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-0">
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
            adjustStockManual={adjustStockManual} syncVendedorCarga={syncVendedorCarga} addClient={addClient} updateClient={updateClient}
            deleteClient={deleteClient} addUser={addUser} updateUser={updateUser} payCommission={handlePayCommission}
            setCommissions={()=>{}} updateEstoqueCentral={()=>{}} reinforceCarga={()=>{}} deleteSale={(id) => deleteSaleInternal(id, true)}
            receiveAccount={receiveAccount} logo={logo} setLogo={setLogo} adminUser={currentUser} margemGlobalAtiva={margemGlobalAtiva}
            setMargemGlobalAtiva={setMargemGlobalAtiva} margemGlobalValor={margemGlobalValor} setMargemGlobalValor={setMargemGlobalValor}
            margemMinima={margemMinima} setMargemMinima={setMargemMinima} margemMinimaAtiva={margemMinimaAtiva}
            setMargemMinimaAtiva={setMargemMinimaAtiva} pix1Name={pix1Name} setPix1Name={setPix1Name} pix1Code={pix1Code} setPix1Code={setPix1Code}
            pix2Name={pix2Name} setPix2Name={setPix2Name} pix2Code={pix2Code} setPix2Code={setPix2Code}
            adminNotification={adminNotification} clearAdminNotification={() => setAdminNotification(null)}
          />
        ) : (
          <VendedorDashboard 
            user={currentUser} products={products} clients={clients} cargas={cargas} sales={sales} commissions={commissions}
            payoutLogs={payoutLogs.filter(l => l.vendedorId === currentUser.id)}
            cargasPendentes={cargasPendentes}
            messages={messages.filter(m => m.vendedorId === currentUser.id)}
            markMessageAsRead={markMessageAsRead} processSale={processSale} updateClient={updateClient}
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