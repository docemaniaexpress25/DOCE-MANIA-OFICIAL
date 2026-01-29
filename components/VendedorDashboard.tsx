import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage } from '../types';
import { DIAS_SEMANA } from '../constants';
import PDV from './PDV';
import Cupom from './Cupom';
import { DailyRouteState, loadLocalState, saveLocalState } from '../utils/persistence';

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
}

type TabType = 'HOME' | 'ROTEIRO' | 'CARGA' | 'HISTORY' | 'FINANCE' | 'CREDIT' | 'CLIENTS' | 'WEEKLY' | 'STOCK_VIEW';

const VendedorDashboard: React.FC<VendedorDashboardProps> = ({ 
  user, products, clients, cargas, cargasPendentes, sales, commissions, payoutLogs, messages, markMessageAsRead, processSale, addClient, updateClient, deleteClient, receivePayment, deleteSale, aceitarCarga, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, dailyRouteState, updateDailyRoute
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(() => loadLocalState('v_activeTab', 'HOME'));
  const [selectedClient, setSelectedClient] = useState<Client | null>(() => loadLocalState('v_selectedClient', null));
  const [viewingSale, setViewingSale] = useState<Sale | null>(() => loadLocalState('v_viewingSale', null));
  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [editingClient, setEditingClient] = useState<Client | 'NEW' | null>(null); 
  
  const [reopenedClientIds, setReopenedClientIds] = useState<string[]>([]);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [financeFilter, setFinanceFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [weeklySearch, setWeeklySearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [cForm, setCForm] = useState<Partial<Client>>({});

  const lastUnreadCount = useRef(0);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Gerencia o botão voltar (Popstate)
  useEffect(() => {
    const handlePopState = () => {
      // Prioridade 1: Fechar modais de visualização (Cupom/PDV)
      if (viewingSale) { setViewingSale(null); return; }
      if (selectedClient) { setSelectedClient(null); return; }
      
      // Prioridade 2: Fechar modais de edição/recebimento
      if (editingClient) { setEditingClient(null); return; }
      if (showReceiveModal) { setShowReceiveModal(null); return; }

      // Prioridade 3: Voltar para HOME se estiver em outra aba
      if (activeTab !== 'HOME') {
        setActiveTab('HOME');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, selectedClient, viewingSale, editingClient, showReceiveModal]);

  // Função auxiliar para mudar aba
  const changeTab = (tab: TabType) => {
    if (tab !== 'HOME') window.history.pushState({ tab }, '');
    setActiveTab(tab);
  };

  // Função auxiliar para abrir visualizações pesadas (PDV/Cupom)
  const openView = (type: 'PDV' | 'CUPOM') => {
    window.history.pushState({ view: type }, '');
  };

  // Função auxiliar para modais simples
  const pushModalState = () => {
    window.history.pushState({ modal: true }, '');
  };

  useEffect(() => {
    const unreadPayments = messages.filter(m => !m.lida && m.type === 'COMMISSION_CONFIRMATION');
    if (unreadPayments.length > lastUnreadCount.current) {
      showToast("💰 Novo pagamento!", 'success');
    }
    lastUnreadCount.current = unreadPayments.length;
  }, [messages]);

  const filterByPeriod = (date: Date, period: string) => {
    const d = new Date(date);
    const today = new Date();
    if (period === 'DIA') return d.toDateString() === today.toDateString();
    if (period === 'SEMANA') {
      const weekAgo = new Date(); weekAgo.setDate(today.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === 'MES') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    return true;
  };

  const isSameDay = (date: Date | undefined) => new Date().toDateString() === (new Date(date ?? new Date())).toDateString(); 
  const diaAtual = new Date().getDay();
  const minhaCarga = useMemo(() => cargas.filter(c => c.vendedorId === user.id), [cargas, user.id]);
  
  const orderedCargaProducts = useMemo(() => {
    const cargaMap = new Map(minhaCarga.map(c => [c.produtoId, c]));
    return products.filter(p => cargaMap.has(p.id)).map(p => ({ product: p, carga: cargaMap.get(p.id)! }));
  }, [products, minhaCarga]);

  const rotaDeHoje = useMemo(() => {
    const clientMap = new Map(clients.map(c => [c.id, c]));
    return dailyRouteState.clientIds.map(id => clientMap.get(id)).filter((c): c is Client => !!c && (c.ativo ?? false)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); 
  }, [clients, dailyRouteState.clientIds]); 

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
      showToast("Adicionado à rota!"); 
    } 
  };

  const handleOpenEditClient = (c: Client | 'NEW') => {
    pushModalState();
    if (c === 'NEW') setCForm({ nomeFantasia: '', telefone: '', endereco: '', bairro: '', diaRoteiro: diaAtual, ativo: true, ativarCnpj: false, cnpj: '', pinLocalizacao: '', ordem: 0 });
    else setCForm({ ...c });
    setEditingClient(c);
  };

  const handleSaveClientBasic = () => {
    if (!cForm.nomeFantasia || !cForm.telefone) { showToast("Dados incompletos.", 'error'); return; }
    const clientData: Omit<Client, 'id'> = { nomeFantasia: cForm.nomeFantasia!, telefone: cForm.telefone!, endereco: cForm.endereco || '', bairro: cForm.bairro || '', diaRoteiro: cForm.diaRoteiro ?? diaAtual, ordem: cForm.ordem ?? 0, ativo: cForm.ativo ?? true, ativarCnpj: cForm.ativarCnpj ?? false, cnpj: cForm.cnpj, pinLocalizacao: cForm.pinLocalizacao, nome: cForm.nome, observacoes: cForm.observacoes };
    if (editingClient === 'NEW') addClient(clientData);
    else if (typeof editingClient === 'object') updateClient(editingClient.id, clientData); 
    window.history.back();
  };

  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    receivePayment(showReceiveModal.id, method, valor);
    window.history.back();
  };

  const MenuCard = ({ icon, title, tab, color, badge }: any) => (
    <button onClick={() => changeTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center relative">
      {badge && <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></div>}
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700">{title}</span>
    </button>
  );

  const financeStats = useMemo(() => {
    const vCommsAll = commissions.filter(c => c.vendedorId === user.id);
    const jaPago = payoutLogs.reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 
    const vSalesFiltered = sales.filter(s => s.vendedorId === user.id && filterByPeriod((s.data ?? new Date()), financeFilter)); 
    const totalCommsEligible = vCommsAll.filter(c => c.status !== 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
    const disponivel = Math.max(0, totalCommsEligible - jaPago);
    const pendente = vCommsAll.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
    return { totalVendido: Number(vSalesFiltered.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), disponivel: Number(disponivel.toFixed(2)), pendente: Number(pendente.toFixed(2)) };
  }, [commissions, user.id, sales, financeFilter, payoutLogs]);

  const filteredHistory = useMemo(() => sales.filter(s => s.vendedorId === user.id && filterByPeriod((s.data ?? new Date()), historyFilter)).sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)), [sales, user.id, historyFilter]); 
  const historySummary = useMemo(() => filteredHistory.reduce((acc, sale) => { acc.total += (sale.valorTotal ?? 0); return acc; }, { total: 0 }), [filteredHistory]);
  const contasAReceber = useMemo(() => sales.filter(s => s.vendedorId === user.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [sales, user.id]);
  const valorTotalCarga = useMemo(() => minhaCarga.reduce((acc, curr) => { const p = products.find(prod => prod.id === curr.produtoId); return acc + ((curr.quantidade ?? 0) * (p?.precoVenda ?? 0)); }, 0), [minhaCarga, products]);

  if (selectedClient) {
    return (
      <PDV
        client={selectedClient} products={products} minhaCarga={minhaCarga} vendedorId={user.id} onCancel={() => window.history.back()}
        onFinish={(s) => { setViewingSale(s); setSelectedClient(null); showToast("Venda realizada"); }}
        processSale={processSale} margemMinima={margemMinima} margemMinimaAtiva={margemMinimaAtiva} pix1Name={pix1Name} pix1Code={pix1Code} pix2Name={pix2Name} pix2Code={pix2Code}
      />
    );
  }

  if (viewingSale) {
    return ( <Cupom sale={viewingSale} client={clients.find(c => c.id === viewingSale.clientId)!} products={products} onClose={() => window.history.back()} onDeleteSale={deleteSale} allowDelete={true} /> );
  }

  return (
    <div className="space-y-4 pb-20">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center pointer-events-none animate-in slide-in-from-top">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3`}><i className="fa-solid fa-circle-check"></i>{toast.message}</div>
        </div>
      )}

      {activeTab !== 'HOME' && <button onClick={() => window.history.back()} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2 active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="py-4 grid grid-cols-2 gap-4">
          <MenuCard icon="fa-route" title="Rota do Dia" tab="ROTEIRO" color="bg-blue-50 text-blue-600" />
          <MenuCard icon="fa-truck-fast" title="Minha Carga" tab="CARGA" color="bg-purple-50 text-purple-600" badge={cargasPendentes.length > 0} />
          <MenuCard icon="fa-receipt" title="Vendas" tab="HISTORY" color="bg-blue-50 text-[#1E3A5F]" />
          <MenuCard icon="fa-wallet" title="Financeiro" tab="FINANCE" color="bg-emerald-50 text-[#1F7A4D]" badge={messages.some(m => !m.lida && m.type === 'COMMISSION_CONFIRMATION')} />
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
          </header>
          {rotaDeHoje.map(c => {
            const isSold = sales.some(s => s.clientId === c.id && isSameDay(s.data));
            const isSkipped = dailyRouteState.skippedClientIds.includes(c.id);
            const isVisited = (isSold || isSkipped) && !reopenedClientIds.includes(c.id);
            return (
              <div key={c.id} className={`p-4 rounded-3xl border flex flex-col transition-all ${isVisited ? 'bg-gray-100 border-gray-200 opacity-60' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex-1"><p className="font-bold text-gray-800 leading-tight uppercase">{c.nomeFantasia}</p></div>
                  {!isVisited ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleSkipClient(c.id)} className="w-10 h-10 bg-gray-50 text-gray-400 rounded-2xl flex items-center justify-center"><i className="fa-solid fa-forward"></i></button>
                      <button onClick={() => { openView('PDV'); setSelectedClient(c); }} className="bg-blue-600 text-white px-4 py-2 rounded-2xl font-black text-xs uppercase shadow-lg">Atender</button>
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
          {cargasPendentes.length > 0 ? (
            <div className="bg-orange-50 p-6 rounded-3xl shadow-xl flex flex-col gap-4 items-center text-center">
              <h3 className="text-xl font-black text-orange-800 uppercase">Nova Carga!</h3>
              <button onClick={() => aceitarCarga(cargasPendentes[0].id)} className="w-full bg-orange-600 text-white font-black py-5 rounded-2xl shadow-lg active:scale-95 text-sm uppercase">ACEITAR</button>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 bg-purple-600 text-white font-black text-sm uppercase">Minha Carga: R$ {valorTotalCarga.toFixed(2)}</div>
                <table className="w-full text-left">
                  <tbody className="divide-y divide-gray-50">
                    {orderedCargaProducts.map(({ product: p, carga: c }) => (
                      <tr key={c.produtoId}>
                        <td className="p-4 text-xs font-semibold uppercase">{p.nome}</td>
                        <td className="p-4 text-right font-black text-lg text-blue-600">{c.quantidade}</td>
                      </tr>
                    ))}
                  </tbody> 
                </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex justify-between items-center"><span className="text-xs font-black text-gray-400 uppercase">Total Período</span><span className="text-2xl font-black text-gray-900">R$ {historySummary.total.toFixed(2)}</span></div>
          {filteredHistory.map(s => (<div key={s.id} className="bg-white p-4 rounded-3xl border border-gray-100 flex flex-col shadow-sm" onClick={() => { openView('CUPOM'); setViewingSale(s); }}><div className="flex justify-between items-center"><p className="font-bold text-gray-800 text-sm uppercase">{clients.find(c => c.id === s.clientId)?.nomeFantasia}</p><p className="text-sm font-semibold text-emerald-600">R$ {s.valorTotal.toFixed(2)}</p></div><p className="text-[10px] text-gray-400 font-semibold">{s.metodoPagamento} • {s.data.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p></div>))} 
        </div>
      )}

      {activeTab === 'FINANCE' && (
        <div className="space-y-6">
           <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 p-5 rounded-3xl shadow-md border border-emerald-100"><p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Disponível</p><p className="text-xl font-black text-emerald-700">R$ {financeStats.disponivel.toFixed(2)}</p></div>
              <div className="bg-orange-50 p-5 rounded-3xl shadow-sm border border-orange-100"><p className="text-[9px] font-black text-orange-600 uppercase mb-1">A receber</p><p className="text-xl font-black text-orange-700">R$ {financeStats.pendente.toFixed(2)}</p></div>
           </div>
           <div className="space-y-2">
             <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Notificações</h3>
             <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
                {messages.filter(m => m.vendedorId === user.id).map(m => (
                    <div key={m.id} className={`p-4 flex justify-between items-center ${!m.lida ? 'bg-blue-50/50' : 'bg-white'}`}>
                        <div className="flex-1 pr-3">
                            <p className="text-[11px] font-black uppercase leading-none mb-1">{m.titulo}</p>
                            <p className="text-[10px] font-semibold text-gray-500 mt-1">{m.mensagem}</p>
                        </div>
                        {!m.lida && <button onClick={() => markMessageAsRead(m.id)} className="bg-emerald-600 text-white px-3 py-2 rounded-xl text-[9px] font-black uppercase">Confirmar</button>}
                    </div>
                ))}
             </div>
           </div>
        </div>
      )}

      {activeTab === 'CREDIT' && (
        <div className="space-y-4">
          <div className="grid gap-3">
            {contasAReceber.map(s => (
              <div key={s.id} className="p-5 rounded-3xl border shadow-sm flex flex-col bg-white border-gray-100">
                <div className="flex justify-between items-start mb-2">
                   <div><h4 className="font-bold text-sm leading-tight uppercase text-gray-800">{clients.find(c => c.id === s.clientId)?.nomeFantasia}</h4><p className="text-xs font-black text-gray-800">Vencimento: {s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</p></div>
                   <div className="text-right"><p className="text-lg font-black text-rose-600">R$ {(s.valorTotal - s.valorPago).toFixed(2)}</p></div>
                </div>
                <button onClick={() => { pushModalState(); setShowReceiveModal(s); setValorRecebidoParcial((s.valorTotal - s.valorPago).toString()); }} className="w-full bg-emerald-600 text-white py-3 rounded-2xl text-[10px] font-black uppercase mt-3">Receber</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'CLIENTS' && (
        <div className="space-y-4">
          <div className="grid gap-3">
            {clients.map(c => (
              <div key={c.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex justify-between items-center" onClick={() => handleOpenEditClient(c)}>
                <div><h4 className="font-bold text-gray-800 text-sm leading-tight uppercase">{c.nomeFantasia}</h4><p className="text-[10px] text-gray-400 font-semibold uppercase mt-1">{c.telefone}</p></div>
                <i className="fa-solid fa-pencil text-gray-200"></i>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'STOCK_VIEW' && (
        <div className="space-y-4">
          <div className="grid gap-3">
            {products.map(p => ( 
              <div key={p.id} className="bg-white px-4 py-3 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                <h3 className="font-bold text-gray-800 text-sm leading-tight uppercase">{p.nome}</h3>
                <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded uppercase">Central: {p.estoquePrincipal}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 text-center">Recebimento</h3>
              <input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none mb-6" />
              <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs">Confirmar</button>
              <button onClick={() => window.history.back()} className="w-full py-3 text-gray-400 font-semibold uppercase text-[9px] text-center">Cancelar</button>
           </div>
        </div>
      )}

      {editingClient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[310] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl p-8 animate-in slide-in-from-bottom duration-300">
             <h3 className="font-black text-gray-800 uppercase text-sm mb-6">Editar Cliente</h3>
             <div className="space-y-4">
                <input value={cForm.nomeFantasia || ''} onChange={e => setCForm({...cForm, nomeFantasia: e.target.value})} placeholder="Nome" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none uppercase" />
                <input value={cForm.telefone || ''} onChange={e => setCForm({...cForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none" />
                <button onClick={handleSaveClientBasic} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs">Salvar</button>
                <button onClick={() => window.history.back()} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorDashboard;