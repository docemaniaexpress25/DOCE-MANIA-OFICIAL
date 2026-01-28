import React, { useState, useMemo, useEffect } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage } from '../types';
import { DIAS_SEMANA } from '../constants';
import PDV from './PDV';
import Cupom from './Cupom';
import { DailyRouteState } from '../utils/persistence';

interface VendedorDashboardProps {
  user: User;
  products: Product[];
  clients: Client[];
  cargas: Carga[];
  cargasPendentes: CargaPendente[];
  sales: Sale[];
  commissions: Commission[];
  payoutLogs: CommissionPaymentLog[];
  messages: SystemMessage[];
  markMessageAsRead: (id: string) => void;
  processSale: (data: any) => Promise<Sale | null>;
  addClient: (data: Omit<Client, 'id'>) => Promise<void>; 
  updateClient: (id: string, data: Partial<Client>) => void;
  deleteClient: (id: string) => void; 
  receivePayment: (id: string, method: PaymentMethod, amount?: number) => void;
  deleteSale: (id: string) => void;
  aceitarCarga: (id: string) => void;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
  dailyRouteState: DailyRouteState;
  updateDailyRoute: (clientIds: string[], skippedClientIds: string[]) => void;
  productOrder: string[]; 
}

const VendedorDashboard: React.FC<VendedorDashboardProps> = ({ 
  user, products, clients, cargas, cargasPendentes, sales, commissions, payoutLogs, messages, markMessageAsRead, processSale, addClient, updateClient, deleteClient, receivePayment, deleteSale, aceitarCarga, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, dailyRouteState, updateDailyRoute, productOrder
}) => {
  const [activeTab, setActiveTab] = useState<'HOME' | 'ROTEIRO' | 'CARGA' | 'HISTORY' | 'FINANCE' | 'CREDIT' | 'CLIENTS' | 'WEEKLY' | 'STOCK_VIEW'>('HOME');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [reopenedClientIds, setReopenedClientIds] = useState<string[]>([]);
  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [editingClient, setEditingClient] = useState<Client | 'NEW' | null>(null); 
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [financeFilter, setFinanceFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [weeklySearch, setWeeklySearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  const [cForm, setCForm] = useState<Partial<Client>>({});

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const diaAtual = new Date().getDay();
  
  // Filtra as cargas ativas e pendentes do vendedor logado
  const minhaCargaAtiva = useMemo(() => cargas.filter(c => c.vendedorId === user.id), [cargas, user.id]);
  const minhasPendencias = useMemo(() => cargasPendentes.filter(cp => cp.vendedorId === user.id), [cargasPendentes, user.id]);
  
  const rotaDeHoje = useMemo(() => {
    const clientMap = new Map(clients.map(c => [c.id, c]));
    const clientsInRoute = dailyRouteState.clientIds
      .map(id => clientMap.get(id))
      .filter((c): c is Client => !!c && (c.ativo ?? false));
    return clientsInRoute.sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); 
  }, [clients, dailyRouteState.clientIds]); 

  const getProductById = (id: string) => products.find(p => p.id === id);

  const orderedCargaProducts = useMemo(() => {
    // Explicitamente tipando o Map para evitar erros de comparação com 'unknown'
    const cargaMap = new Map<string, number>(minhaCargaAtiva.map(c => [c.produtoId, c.quantidade]));
    return productOrder
      .map(pId => {
        const product = getProductById(pId);
        const qtd = cargaMap.get(pId);
        if (product && qtd && qtd > 0) {
          return { ...product, quantidadeCarga: qtd };
        }
        return null;
      })
      .filter((p): p is (Product & { quantidadeCarga: number }) => !!p);
  }, [minhaCargaAtiva, products, productOrder]);

  const orderedStockProducts = useMemo(() => {
    return productOrder
      .map(id => getProductById(id))
      .filter((p): p is Product => !!p);
  }, [products, productOrder]);

  const isSameDay = (date: Date | undefined) => new Date().toDateString() === (new Date(date ?? new Date())).toDateString(); 

  const handleSkipClient = (clientId: string) => { 
    if (confirm("Pular atendimento?")) {
      const newSkipped = [...dailyRouteState.skippedClientIds, clientId];
      updateDailyRoute(dailyRouteState.clientIds, newSkipped);
    }
  };

  const handleReopenClient = (clientId: string) => {
    const newSkipped = dailyRouteState.skippedClientIds.filter(id => id !== clientId);
    updateDailyRoute(dailyRouteState.clientIds, newSkipped);
    setReopenedClientIds(prev => [...prev, clientId]);
  };

  const handleAddToTodayRoute = (clientId: string) => { 
    if (!dailyRouteState.clientIds.includes(clientId)) { 
      const newRoute = [...dailyRouteState.clientIds, clientId];
      updateDailyRoute(newRoute, dailyRouteState.skippedClientIds);
      showToast("Cliente adicionado à rota do dia!"); 
    } 
  };

  const handleOpenEditClient = (c: Client | 'NEW') => {
    if (c === 'NEW') setCForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: diaAtual, ativo: true, ordem: 0 });
    else setCForm({ ...c });
    setEditingClient(c);
  };

  const handleSaveClientBasic = () => {
    if (!cForm.nomeFantasia || !cForm.telefone) return showToast("Preencha Nome e Telefone.", 'error');
    const data: Omit<Client, 'id'> = {
      nomeFantasia: cForm.nomeFantasia!,
      telefone: cForm.telefone!,
      endereco: cForm.endereco || '',
      bairro: cForm.bairro || '',
      diaRoteiro: cForm.diaRoteiro ?? diaAtual,
      ordem: cForm.ordem ?? 0,
      ativo: cForm.ativo ?? true,
      ativarCnpj: cForm.ativarCnpj ?? false,
      cnpj: cForm.cnpj,
      pinLocalizacao: cForm.pinLocalizacao,
      nome: cForm.nome,
      observacoes: cForm.observacoes,
    };
    if (editingClient === 'NEW') addClient(data).then(() => showToast("Novo cliente cadastrado!"));
    else if (typeof editingClient === 'object') {
      updateClient(editingClient.id, data);
      showToast("Cliente atualizado");
    }
    setEditingClient(null);
  };

  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    const saldo = Number(((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)); 
    if (isNaN(valor) || valor <= 0 || valor > saldo) return alert("Valor inválido.");
    receivePayment(showReceiveModal.id, method, valor);
    showToast(valor === saldo ? "Conta quitada!" : "Pagamento parcial registrado!");
    setShowReceiveModal(null);
  };

  const MenuCard = ({ icon, title, tab, color, badge }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center relative">
      {badge && <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></div>}
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700">{title}</span>
    </button>
  );

  const filterByPeriod = (date: Date, period: string) => {
    const d = new Date(date);
    const today = new Date();
    if (period === 'DIA') return d.toDateString() === today.toDateString();
    if (period === 'SEMANA') {
      const weekAgo = new Date();
      weekAgo.setDate(today.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === 'MES') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    return true;
  };

  const filteredHistory = useMemo(() => sales.filter(s => s.vendedorId === user.id && filterByPeriod(s.data, historyFilter)).sort((a, b) => b.data.getTime() - a.data.getTime()), [sales, user.id, historyFilter]); 
  
  const financeStats = useMemo(() => {
    const vCommsAll = commissions.filter(c => c.vendedorId === user.id);
    const jaPago = payoutLogs.reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 
    const vSalesFiltered = sales.filter(s => s.vendedorId === user.id && filterByPeriod(s.data, financeFilter)); 
    const totalCommsEligible = vCommsAll.filter(c => c.status !== 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const disponivel = Math.max(0, totalCommsEligible - jaPago);
    const pendente = vCommsAll.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
    return {
      totalVendido: Number(vSalesFiltered.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), 
      totalComissao: Number(vCommsAll.reduce((acc, curr) => acc + (curr.valor ?? 0), 0).toFixed(2)),
      disponivel: Number(disponivel.toFixed(2)), 
      pendente: Number(pendente.toFixed(2)) 
    };
  }, [commissions, user.id, sales, financeFilter, payoutLogs]);

  const historySummary = useMemo(() => filteredHistory.reduce((acc, sale) => {
    acc.total += sale.valorTotal; 
    if (sale.metodoPagamento === 'DINHEIRO') acc.dinheiro += sale.valorTotal;
    if (sale.metodoPagamento === 'PIX') acc.pix += sale.valorTotal;
    if (sale.metodoPagamento === 'A_PRAZO') acc.prazo += sale.valorTotal;
    return acc;
  }, { total: 0, dinheiro: 0, pix: 0, prazo: 0 }), [filteredHistory]);

  const contasAReceber = useMemo(() => sales.filter(s => s.vendedorId === user.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [sales, user.id]);

  const valorTotalCarga = useMemo(() => minhaCargaAtiva.reduce((acc, curr) => {
    const p = products.find(prod => prod.id === curr.produtoId);
    return acc + (curr.quantidade * (p?.precoVenda ?? 0)); 
  }, 0), [minhaCargaAtiva, products]);

  if (selectedClient) {
    return (
      <PDV
        client={selectedClient} products={products} minhaCarga={minhaCargaAtiva} vendedorId={user.id} 
        onCancel={() => setSelectedClient(null)}
        onFinish={(s) => { setViewingSale(s); setSelectedClient(null); showToast("Venda realizada"); }}
        processSale={processSale} margemMinima={margemMinima} margemMinimaAtiva={margemMinimaAtiva} 
        pix1Name={pix1Name} pix1Code={pix1Code} pix2Name={pix2Name} pix2Code={pix2Code}
        productOrder={productOrder}
      />
    );
  }

  if (viewingSale) {
    const cupomClient = clients.find(c => c.id === viewingSale.clientId);
    return ( <Cupom sale={viewingSale} client={cupomClient!} products={products} onClose={() => setViewingSale(null)} onDeleteSale={deleteSale} allowDelete={true} /> );
  }

  return (
    <div className="space-y-4 pb-20">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center pointer-events-none">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3 animate-in slide-in-from-top`}>
            <i className="fa-solid fa-circle-check"></i>{toast.message}
          </div>
        </div>
      )}

      {activeTab !== 'HOME' && <button onClick={() => setActiveTab('HOME')} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2 active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="py-4 grid grid-cols-2 gap-4">
          <MenuCard icon="fa-route" title="Rota do Dia" tab="ROTEIRO" color="bg-blue-50 text-blue-600" />
          <MenuCard icon="fa-truck-fast" title="Minha Carga" tab="CARGA" color="bg-purple-50 text-purple-600" badge={minhasPendencias.length > 0} />
          <MenuCard icon="fa-receipt" title="Vendas" tab="HISTORY" color="bg-blue-50 text-[#1E3A5F]" />
          <MenuCard icon="fa-wallet" title="Financeiro" tab="FINANCE" color="bg-emerald-50 text-[#1F7A4D]" />
          <MenuCard icon="fa-file-invoice-dollar" title="Contas a Receber" tab="CREDIT" color="bg-rose-50 text-rose-600" />
          <MenuCard icon="fa-users" title="Clientes" tab="CLIENTES" color="bg-green-50 text-green-600" />
          <MenuCard icon="fa-calendar-days" title="Roteiro Semanal" tab="WEEKLY" color="bg-indigo-50 text-indigo-600" />
          <MenuCard icon="fa-boxes-stacked" title="Estoque" tab="STOCK_VIEW" color="bg-yellow-50 text-yellow-600" />
        </div>
      )}

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-4">
          <header className="flex justify-between items-center px-1">
            <div className="flex flex-col items-start"><h2 className="text-xl font-black text-gray-800 tracking-tight leading-none">{DIAS_SEMANA[diaAtual]}</h2><span className="text-[10px] font-black uppercase text-gray-400 mt-1">{new Date().toLocaleDateString()}</span></div>
            <span className="bg-blue-100 text-blue-600 text-[10px] px-2 py-1 rounded-lg font-black uppercase">{rotaDeHoje.length} VISITAS</span>
          </header>
          {rotaDeHoje.map(c => {
            const isSold = sales.some(s => s.clientId === c.id && isSameDay(s.data));
            const isSkipped = dailyRouteState.skippedClientIds.includes(c.id);
            const isVisited = (isSold || isSkipped) && !reopenedClientIds.includes(c.id);
            return (
              <div key={c.id} className={`p-4 rounded-3xl border flex flex-col transition-all ${isVisited ? 'bg-gray-100 border-gray-200 grayscale opacity-60' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex-1"><p className="font-bold text-gray-800 leading-tight uppercase">{c.nomeFantasia}</p><p className="text-[10px] text-gray-400 mt-1 uppercase font-semibold"><i className="fa-solid fa-location-dot mr-1"></i> {c.bairro}</p></div>
                  {!isVisited ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleSkipClient(c.id)} className="w-10 h-10 bg-gray-50 text-gray-400 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-forward"></i></button>
                      <button onClick={() => setSelectedClient(c)} className="bg-blue-600 text-white px-4 py-2 rounded-2xl font-black text-xs uppercase shadow-lg">Atender</button>
                    </div>
                  ) : <button onClick={() => handleReopenClient(c.id)} className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase">Reabrir</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'CARGA' && (
        <div className="space-y-4">
          {minhasPendencias.length > 0 ? (
            <div className="bg-orange-50 p-6 rounded-3xl shadow-xl flex flex-col gap-4 items-center text-center">
              <i className="fa-solid fa-truck-loading text-orange-600 text-4xl mb-2"></i>
              <h3 className="text-xl font-black text-orange-800 uppercase">Nova Carga Disponível!</h3>
              <p className="text-xs text-orange-600 font-bold uppercase">Você tem {minhasPendencias.length} carga(s) aguardando aceite.</p>
              <button onClick={() => aceitarCarga(minhasPendencias[0].id)} className="w-full bg-orange-600 text-white font-black py-5 rounded-2xl shadow-lg active:scale-95 text-sm uppercase">ACEITAR CARGA</button>
            </div>
          ) : (
            <>
              <div className="bg-purple-600 text-white p-6 rounded-3xl shadow-xl flex justify-between items-center">
                 <div><p className="text-[10px] font-black uppercase opacity-60">Valor Total Carga</p><h3 className="text-2xl font-black">R$ {valorTotalCarga.toFixed(2)}</h3></div>
                 <div className="text-right"><p className="text-[10px] font-black uppercase opacity-60">Itens Ativos</p><h3 className="text-2xl font-black">{orderedCargaProducts.length}</h3></div>
              </div>
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50"><tr><th className="p-4 text-[10px] font-black text-gray-400 uppercase">Item</th><th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase">Preço</th><th className="p-4 text-right text-[10px] font-black text-gray-400 uppercase">Qtd</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">{orderedCargaProducts.map(p => (<tr key={p.id}><td className="p-4 text-xs font-semibold uppercase">{p.nome}</td><td className="p-4 text-center text-xs text-gray-400">R$ {p.precoVenda.toFixed(2)}</td><td className="p-4 text-right font-black text-lg text-blue-600">{p.quantidadeCarga}</td></tr>))}</tbody> 
                </table>
              </div>
              {orderedCargaProducts.length === 0 && <p className="text-center py-10 opacity-30 italic font-black uppercase text-[10px]">Carga vazia</p>}
            </>
          )}
        </div>
      )}

      {/* Outras abas permanecem inalteradas... */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">{(['DIA', 'SEMANA', 'MES', 'GERAL'] as const).map(f => (<button key={f} onClick={() => setHistoryFilter(f)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase ${historyFilter === f ? 'bg-white text-[#1E3A5F] shadow-sm' : 'text-gray-400'}`}>{f}</button>))}</div>
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex flex-col gap-4">
             <div className="flex justify-between items-center border-b border-gray-100 pb-3"><span className="text-xs font-black text-gray-400 uppercase">Total Geral</span><span className="text-2xl font-black text-gray-900">R$ {historySummary.total.toFixed(2)}</span></div>
             <div className="grid grid-cols-3 gap-3">
                <div className="text-center bg-emerald-50 p-3 rounded-xl"><p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Dinheiro</p><p className="text-sm font-black text-emerald-700">R$ {historySummary.dinheiro.toFixed(2)}</p></div>
                <div className="text-center bg-blue-50 p-3 rounded-xl"><p className="text-[9px] font-black text-blue-600 uppercase mb-1">Pix</p><p className="text-sm font-black text-blue-700">R$ {historySummary.pix.toFixed(2)}</p></div>
                <div className="text-center bg-orange-50 p-3 rounded-xl"><p className="text-[9px] font-black text-orange-600 uppercase mb-1">A Prazo</p><p className="text-sm font-black text-orange-700">R$ {historySummary.prazo.toFixed(2)}</p></div>
             </div>
          </div>
          {filteredHistory.map(s => (<div key={s.id} onClick={() => setViewingSale(s)} className="bg-white p-4 rounded-3xl border border-gray-100 flex flex-col shadow-sm active:scale-95 transition-all"><div className="flex justify-between items-center mb-2"><p className="font-bold text-gray-800 text-sm uppercase truncate pr-2">{clients.find(c => c.id === s.clientId)?.nomeFantasia}</p><p className="text-sm font-semibold text-emerald-600 whitespace-nowrap">R$ {s.valorTotal.toFixed(2)}</p></div><div className="flex justify-between items-end"><p className="text-[10px] text-gray-400 font-semibold">{s.metodoPagamento} • {s.data.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p><i className="fa-solid fa-file-invoice text-[#1E3A5F]"></i></div></div>))} 
        </div>
      )}

      {activeTab === 'FINANCE' && (
        <div className="space-y-6">
           <div className="flex bg-gray-100 p-1 rounded-2xl mx-2 shadow-inner">{(['DIA', 'SEMANA', 'MES', 'GERAL'] as const).map(f => (<button key={f} onClick={() => setFinanceFilter(f)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase ${financeFilter === f ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'}`}>{f}</button>))}</div>
           <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex justify-between items-center"><div><p className="text-[10px] font-black uppercase text-gray-400 mb-1">Total Vendido</p><h2 className="text-2xl font-black text-gray-800">R$ {financeStats.totalVendido.toFixed(2)}</h2></div></div>
           <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 p-5 rounded-3xl shadow-md border border-emerald-100"><p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Disponível</p><p className="text-xl font-black text-emerald-700">R$ {financeStats.disponivel.toFixed(2)}</p></div>
              <div className="bg-orange-50 p-5 rounded-3xl shadow-sm border border-orange-100"><p className="text-[9px] font-black text-orange-600 uppercase mb-1">A receber</p><p className="text-xl font-black text-orange-700">R$ {financeStats.pendente.toFixed(2)}</p></div>
           </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 text-center tracking-tight">Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-6"><p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo em Aberto</p><p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p></div>
              <div className="space-y-4 mb-6"><p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p><input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none" /></div>
              <div className="space-y-3">
                 <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest">DINHEIRO</button>
                 <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg font-black uppercase text-xs tracking-widest">PIX</button>
                 <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-semibold uppercase text-[9px] text-center">Cancelar</button>
              </div>
           </div>
        </div>
      )}

      {editingClient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[310] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl p-8 animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-6"><h3 className="font-black text-gray-800 uppercase text-sm tracking-tight">{editingClient === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3></div>
             <div className="space-y-4 pb-6">
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Nome Fantasia</label><input value={cForm.nomeFantasia || ''} onChange={e => setCForm({...cForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 uppercase" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label><input value={cForm.telefone || ''} onChange={e => setCForm({...cForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Endereço</label><input value={cForm.endereco || ''} onChange={e => setCForm({...cForm, endereco: e.target.value})} placeholder="Endereço" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 uppercase" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Bairro</label><input value={cForm.bairro || ''} onChange={e => setCForm({...cForm, bairro: e.target.value})} placeholder="Bairro" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 uppercase" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Dia de Atendimento</label><select value={cForm.diaRoteiro ?? 1} onChange={e => setCForm({...cForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100">{[1, 2, 3, 4, 5, 6].map(d => (<option key={d} value={d}>{DIAS_SEMANA[d]}</option>))}</select></div> 
                <div className="flex flex-col gap-2 mt-4"><button onClick={handleSaveClientBasic} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs">Salvar</button><button onClick={() => setEditingClient(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button></div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorDashboard;