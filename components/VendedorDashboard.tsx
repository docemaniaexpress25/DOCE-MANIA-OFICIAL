import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense } from '../types';
import { DIAS_SEMANA } from '../constants';
import PDV from './PDV';
import Cupom from './Cupom';
import RelatorioFiscal from './RelatorioFiscal';
import ClientHistory from './ClientHistory';
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
  expenses: Expense[];
  messages: SystemMessage[];
  markMessageAsRead: (id: string) => void;
  processSale: (data: any) => Promise<Sale | null>;
  addClient: (data: Omit<Client, 'id'>) => Promise<void>; 
  updateClient: (id: string, data: Partial<Client>) => void;
  deleteClient: (id: string) => void; 
  receivePayment: (id: string, method: PaymentMethod, amount?: number) => void;
  deleteSale: (id: string) => void;
  aceitarCarga: (id: string) => void;
  addExpense: (sellerId: string, descricao: string, valor: number) => Promise<boolean>;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
  dailyRouteState: DailyRouteState;
  updateDailyRoute: (clientIds: string[], skippedClientIds: string[]) => void;
  companyName: string;
  companyCnpj: string;
}

type TabType = 'HOME' | 'ROTEIRO' | 'CARGA' | 'HISTORY' | 'FINANCE' | 'CREDIT' | 'CLIENTES' | 'WEEKLY' | 'STOCK_VIEW';

const VendedorDashboard: React.FC<VendedorDashboardProps> = ({ 
  user, products, clients, cargas, cargasPendentes, sales, commissions, payoutLogs, expenses, messages, markMessageAsRead, processSale, addClient, updateClient, deleteClient, receivePayment, deleteSale, aceitarCarga, addExpense, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code, dailyRouteState, updateDailyRoute, companyName, companyCnpj
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(() => loadLocalState('v_activeTab', 'HOME'));
  const [selectedClient, setSelectedClient] = useState<Client | null>(() => loadLocalState('v_selectedClient', null));
  const [viewingSale, setViewingSale] = useState<Sale | null>(() => loadLocalState('v_viewingSale', null));
  const [showFiscalization, setShowFiscalization] = useState(() => loadLocalState('v_showFiscalization', false));
  const [viewingClientHistory, setViewingClientHistory] = useState<Client | null>(null);

  useEffect(() => { saveLocalState('v_activeTab', activeTab); }, [activeTab]);

  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const diaAtual = new Date().getDay();
  const minhaCarga = useMemo(() => cargas.filter(c => c.vendedorId === user.id), [cargas, user.id]);
  
  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    receivePayment(showReceiveModal.id, method, valor);
    setShowReceiveModal(null);
    setValorRecebidoParcial('');
  };

  const contasAReceber = useMemo(() => sales.filter(s => s.vendedorId === user.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [sales, user.id]);

  // Lógica para parsear logs de recebimento específicos deste vendedor
  const reciboLogs = useMemo(() => {
    const logs: any[] = [];
    sales.filter(s => s.vendedorId === user.id).forEach(s => {
      if (s.detalhePagamento && s.detalhePagamento.includes('[')) {
        const entries = s.detalhePagamento.split('|');
        entries.forEach(entry => {
          if (entry.trim().startsWith('[')) {
            logs.push({
              id: Math.random().toString(),
              vendaId: s.id,
              clienteNome: clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Desc.',
              texto: entry.trim()
            });
          }
        });
      }
    });
    return logs.sort((a, b) => b.texto.localeCompare(a.texto));
  }, [sales, clients, user.id]);

  if (selectedClient) {
    return (
      <PDV
        client={selectedClient} products={products} minhaCarga={minhaCarga} vendedorId={user.id} onCancel={() => setSelectedClient(null)}
        onFinish={(s) => { setViewingSale(s); setSelectedClient(null); showToast("Venda realizada"); }}
        processSale={processSale} margemMinima={margemMinima} margemMinimaAtiva={margemMinimaAtiva} pix1Name={pix1Name} pix1Code={pix1Code} pix2Name={pix2Name} pix2Code={pix2Code}
        sales={sales} onNavigateToCredit={() => { setSelectedClient(null); setActiveTab('CREDIT'); }}
      />
    );
  }

  if (viewingSale) {
    const cupomClient = clients.find(c => c.id === viewingSale.clientId);
    return ( <Cupom sale={viewingSale} client={cupomClient!} products={products} onClose={() => setViewingSale(null)} onDeleteSale={deleteSale} allowDelete={true} showToast={showToast} /> );
  }

  if (showFiscalization) {
    return ( <RelatorioFiscal user={user} carga={minhaCarga} products={products} companyName={companyName} companyCnpj={companyCnpj} onClose={() => setShowFiscalization(false)} /> );
  }

  return (
    <div className="space-y-4 pb-20">
      {toast && (
        <div className="fixed top-20 left-4 right-4 z-[300] flex justify-center pointer-events-none">
          <div className={`${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-xs uppercase flex items-center gap-3`}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>{toast.message}
          </div>
        </div>
      )}

      {activeTab !== 'HOME' && <button onClick={() => setActiveTab('HOME')} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2 active:scale-90 transition-transform"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="py-4 grid grid-cols-2 gap-4">
          <button onClick={() => setActiveTab('ROTEIRO')} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
             <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-route"></i></div>
             <span className="text-[11px] font-black uppercase text-gray-700">Rota do Dia</span>
          </button>
          <button onClick={() => setActiveTab('CARGA')} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
             <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-truck-fast"></i></div>
             <span className="text-[11px] font-black uppercase text-gray-700">Minha Carga</span>
          </button>
          <button onClick={() => setActiveTab('HISTORY')} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
             <div className="w-14 h-14 bg-blue-50 text-[#1E3A5F] rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-receipt"></i></div>
             <span className="text-[11px] font-black uppercase text-gray-700">Vendas</span>
          </button>
          <button onClick={() => setActiveTab('FINANCE')} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
             <div className="w-14 h-14 bg-emerald-50 text-[#1F7A4D] rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-wallet"></i></div>
             <span className="text-[11px] font-black uppercase text-gray-700">Financeiro</span>
          </button>
          <button onClick={() => setActiveTab('CREDIT')} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
             <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-file-invoice-dollar"></i></div>
             <span className="text-[11px] font-black uppercase text-gray-700">Contas a Receber</span>
          </button>
          <button onClick={() => setActiveTab('CLIENTES')} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center">
             <div className="w-14 h-14 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center text-xl shadow-inner"><i className="fa-solid fa-users"></i></div>
             <span className="text-[11px] font-black uppercase text-gray-700">Clientes</span>
          </button>
        </div>
      )}

      {activeTab === 'CREDIT' && (
        <div className="space-y-4">
          <header className="px-1"><h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Contas a Receber</h2></header>
          <div className="grid gap-3">
            {contasAReceber.map(s => {
              const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2)); 
              const dueDate = s.dataVencimento ? new Date(s.dataVencimento) : null;
              const isOverdue = dueDate ? dueDate <= new Date() : false;
              return (
              <div key={s.id} className={`p-5 rounded-3xl border shadow-sm flex flex-col transition-all ${isOverdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100'}`}>
                <div className="flex justify-between items-start mb-2">
                   <div>
                      <h4 className="font-bold text-sm leading-tight uppercase text-gray-800" onClick={() => setViewingClientHistory(clients.find(c => c.id === s.clientId)!)}>{clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4>
                      <div className="flex flex-col mt-2">
                        <span className={`text-[9px] font-black uppercase ${isOverdue ? 'text-rose-600' : 'text-gray-400'}`}>Vencimento</span>
                        <span className={`text-xs font-black ${isOverdue ? 'text-rose-700' : 'text-gray-800'}`}>{s.dataVencimento ? new Date(s.dataVencimento).toLocaleDateString() : 'N/D'}</span>
                      </div>
                   </div>
                   <div className="text-right">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${isOverdue ? 'bg-rose-600 text-white' : 'bg-orange-100 text-orange-600'}`}>PENDENTE</span>
                      <p className="text-lg font-black mt-2 text-rose-600">Saldo: R$ {saldo.toFixed(2)}</p>
                   </div>
                </div>
                <button onClick={() => { setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className={`w-full py-3 rounded-2xl text-[10px] font-black uppercase mt-3 shadow-lg active:scale-95 ${isOverdue ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>Receber Agora</button>
              </div>
            )})}
            {contasAReceber.length === 0 && <div className="text-center py-10 opacity-20 italic font-black uppercase tracking-widest text-[10px]">Nenhuma conta pendente</div>}
          </div>

          <div className="space-y-2 pt-6">
             <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-2">Histórico de Recebimentos</h3>
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

      {/* Tabs omitidas para brevidade */}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 text-center tracking-tight">Confirmar Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-4"><p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo Devedor</p><p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p></div>
              <div className="space-y-4 mb-6"><p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p><input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none" /></div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                 <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs tracking-widest">DINHEIRO</button>
                 <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs tracking-widest">PIX</button>
              </div>
              <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-semibold uppercase text-[9px] tracking-widest text-center">Cancelar</button>
           </div>
        </div>
      )}

      {viewingClientHistory && (
        <ClientHistory client={viewingClientHistory} sales={sales} products={products} onClose={() => setViewingClientHistory(null)} />
      )}
    </div>
  );
};

export default VendedorDashboard;