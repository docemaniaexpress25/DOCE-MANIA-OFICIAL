import React, { useState, useMemo, useEffect } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage } from '../types';
import { DIAS_SEMANA } from '../constants';
import PDV from './PDV';
import Cupom from './Cupom';

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
  // Fix: processSale should return Promise<Sale | null> as it's an async operation in App.tsx
  processSale: (data: any) => Promise<Sale | null>;
  addClient: (data: Omit<Client, 'id'>) => Promise<void>; // Nova prop
  updateClient: (id: string, data: Partial<Client>) => void;
  deleteClient: (id: string) => void; // Mantendo para consistência, embora o vendedor não deva deletar
  receivePayment: (id: string, method: PaymentMethod, amount?: number) => void;
  deleteSale: (id: string) => void;
  aceitarCarga: (id: string) => void;
  margemMinima: number;
  margemMinimaAtiva: boolean;
  pix1Name: string;
  pix1Code: string | null;
  pix2Name: string;
  pix2Code: string | null;
}

const VendedorDashboard: React.FC<VendedorDashboardProps> = ({ 
  user, products, clients, cargas, cargasPendentes, sales, commissions, payoutLogs, messages, markMessageAsRead, processSale, addClient, updateClient, deleteClient, receivePayment, deleteSale, aceitarCarga, margemMinima, margemMinimaAtiva, pix1Name, pix1Code, pix2Name, pix2Code
}) => {
  const [activeTab, setActiveTab] = useState<'HOME' | 'ROTEIRO' | 'CARGA' | 'HISTORY' | 'FINANCE' | 'CREDIT' | 'CLIENTS' | 'WEEKLY' | 'STOCK_VIEW'>('HOME');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [skippedClientIds, setSkippedClientIds] = useState<string[]>([]);
  const [reopenedClientIds, setReopenedClientIds] = useState<string[]>([]);
  const [extraRouteClientIds, setExtraRouteClientIds] = useState<string[]>([]);
  const [showReceiveModal, setShowReceiveModal] = useState<Sale | null>(null);
  const [valorRecebidoParcial, setValorRecebidoParcial] = useState<string>('');
  const [editingClient, setEditingClient] = useState<Client | 'NEW' | null>(null); // Suporta 'NEW'
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [financeFilter, setFinanceFilter] = useState<'DIA' | 'SEMANA' | 'MES' | 'GERAL'>('DIA');
  const [weeklySearch, setWeeklySearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showFiscalization, setShowFiscalization] = useState(false);
  const [fiscalizationSize, setFiscalizationSize] = useState<56 | 80>(80);
  
  const [cForm, setCForm] = useState<Partial<Client>>({});

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const unreadMessage = useMemo(() => messages.find(m => !(m.lida ?? false)), [messages]); 
  const diaAtual = new Date().getDay();
  const minhaCarga = useMemo(() => cargas.filter(c => c.vendedorId === user.id), [cargas, user.id]);
  const totalItensCarga = useMemo(() => minhaCarga.length, [minhaCarga]);
  const unidadesTotaisCarga = useMemo(() => minhaCarga.reduce((acc, curr) => acc + (curr.quantidade ?? 0), 0), [minhaCarga]); 
  const valorTotalCarga = useMemo(() => minhaCarga.reduce((acc, curr) => {
    const p = products.find(prod => prod.id === curr.produtoId);
    return acc + ((curr.quantidade ?? 0) * (p?.precoVenda ?? 0)); 
  }, 0), [minhaCarga, products]);

  const rotaDeHoje = useMemo(() => clients.filter(c => (c.ativo ?? false) && ((c.diaRoteiro ?? 0) === diaAtual || extraRouteClientIds.includes(c.id))), [clients, diaAtual, extraRouteClientIds]); 

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

  const filteredHistory = useMemo(() => sales.filter(s => s.vendedorId === user.id && filterByPeriod((s.data ?? new Date()), historyFilter)).sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0)), [sales, user.id, historyFilter]); 
  const historySummary = useMemo(() => filteredHistory.reduce((acc, sale) => {
    acc.total += (sale.valorTotal ?? 0); 
    if (sale.metodoPagamento === 'DINHEIRO') acc.dinheiro += (sale.valorTotal ?? 0);
    if (sale.metodoPagamento === 'PIX') acc.pix += (sale.valorTotal ?? 0);
    if (sale.metodoPagamento === 'A_PRAZO') acc.prazo += (sale.valorTotal ?? 0);
    return acc;
  }, { total: 0, dinheiro: 0, pix: 0, prazo: 0 }), [filteredHistory]);

  const financeStats = useMemo(() => {
    const vCommsAll = commissions.filter(c => c.vendedorId === user.id);
    const jaPago = payoutLogs.reduce((acc, curr) => acc + (curr.valorPago ?? 0), 0); 
    const vSalesFiltered = sales.filter(s => s.vendedorId === user.id && filterByPeriod((s.data ?? new Date()), financeFilter)); 
    
    // Calcula o valor total de comissões que são elegíveis para pagamento (DISPONIVEL, PENDENTE_CONFIRMACAO, PAGO)
    const totalCommsEligible = vCommsAll
      .filter(c => c.status !== 'A_RECEBER')
      .reduce((acc, curr) => acc + (curr.valor ?? 0), 0);
      
    // A comissão disponível é o total elegível menos o que já foi pago
    const disponivel = Math.max(0, totalCommsEligible - jaPago);
    
    const pendente = vCommsAll.filter(c => c.status === 'A_RECEBER').reduce((acc, curr) => acc + (curr.valor ?? 0), 0); 
    
    return {
      totalVendido: Number(vSalesFiltered.reduce((acc, curr) => acc + (curr.valorTotal ?? 0), 0).toFixed(2)), 
      totalComissao: Number(vCommsAll.reduce((acc, curr) => acc + (curr.valor ?? 0), 0).toFixed(2)),
      disponivel: Number(disponivel.toFixed(2)), 
      pendente: Number(pendente.toFixed(2)) 
    };
  }, [commissions, user.id, sales, financeFilter, payoutLogs]);

  const handleSkipClient = (clientId: string) => { if (confirm("Pular atendimento?")) setSkippedClientIds(prev => [...prev, clientId]); };
  const handleReopenClient = (clientId: string) => setReopenedClientIds(prev => [...prev, clientId]);
  const handleAddToTodayRoute = (clientId: string) => { 
    if (!extraRouteClientIds.includes(clientId)) { 
      setExtraRouteClientIds(prev => [...prev, clientId]); 
      showToast("Cliente adicionado à rota do dia!"); 
    } 
  };
  const isSameDay = (date: Date | undefined) => new Date().toDateString() === (new Date(date ?? new Date())).toDateString(); 

  const handleOpenEditClient = (c: Client | 'NEW') => {
    if (c === 'NEW') {
      // Inicializa com valores padrão para novos clientes
      setCForm({ 
        nomeFantasia: '', 
        telefone: '', 
        endereco: '', 
        bairro: '', 
        diaRoteiro: diaAtual, // Sugere o dia atual como dia de roteiro
        ativo: true,
        ativarCnpj: false,
        cnpj: '',
        pinLocalizacao: ''
      });
    } else {
      setCForm({ ...c });
    }
    setEditingClient(c);
  };

  const handlePinLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const pin = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        setCForm(prev => ({ ...prev, pinLocalizacao: pin }));
        showToast("Localização capturada!");
      }, () => {
        showToast("Erro ao capturar localização. Verifique as permissões do GPS.", 'error');
      });
    } else {
      showToast("Geolocalização não suportada pelo seu dispositivo.", 'error');
    }
  };

  const handleSaveClientBasic = () => {
    if (!cForm.nomeFantasia || !cForm.telefone || !cForm.endereco || !cForm.bairro) {
      showToast("Preencha Nome Fantasia, Telefone, Endereço e Bairro.", 'error');
      return;
    }

    const clientData: Omit<Client, 'id'> = {
      nomeFantasia: cForm.nomeFantasia,
      telefone: cForm.telefone,
      endereco: cForm.endereco,
      bairro: cForm.bairro,
      diaRoteiro: cForm.diaRoteiro ?? diaAtual,
      ativo: cForm.ativo ?? true,
      ativarCnpj: cForm.ativarCnpj ?? false,
      cnpj: cForm.cnpj,
      pinLocalizacao: cForm.pinLocalizacao,
      nome: cForm.nome,
      observacoes: cForm.observacoes,
    };

    if (editingClient === 'NEW') {
      addClient(clientData);
      showToast("Novo cliente cadastrado com sucesso!");
    } else if (typeof editingClient === 'object') {
      updateClient(editingClient.id, clientData); 
      showToast("Cliente atualizado");
    }
    setEditingClient(null);
  };

  const handleAceitarCarga = (pendenciaId: string) => {
    aceitarCarga(pendenciaId);
    showToast("Carga recebida com sucesso");
  };

  const handleReadPayoutMessage = (msgId: string) => {
    markMessageAsRead(msgId);
    showToast("Pagamento de comissão recebido");
  };

  const handleConfirmReceive = (method: PaymentMethod) => {
    if (!showReceiveModal) return;
    const valor = parseFloat(valorRecebidoParcial);
    const saldoEmAberto = Number(((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)); 
    
    if (isNaN(valor) || valor <= 0 || valor > saldoEmAberto) {
        alert("Valor inválido.");
        return;
    }

    receivePayment(showReceiveModal.id, method, valor);
    showToast(valor === saldoEmAberto ? "Conta quitada!" : "Pagamento parcial registrado!");
    setShowReceiveModal(null);
    setValorRecebidoParcial('');
  };

  const getFiscalizationText = () => {
    const isNarrow = fiscalizationSize === 56;
    const width = isNarrow ? 32 : 48;
    const sep = "-".repeat(width);
    const titleSep = "═".repeat(width);

    const center = (str: string) => {
      const space = Math.max(0, Math.floor((width - str.length) / 2));
      return " ".repeat(space) + str;
    };

    let t = titleSep + "\n";
    t += center("RELATÓRIO DE CARGA PARA CONTROLE") + "\n";
    t += center("DE ESTOQUE E FISCALIZAÇÃO") + "\n";
    t += titleSep + "\n\n";

    t += `EMPRESA: DOCE SABOR DISTRIBUIDORA\n`;
    t += `CNPJ: 00.000.000/0001-00\n`;
    t += `VENDEDOR: ${(user.nome ?? 'Desconhecido').toUpperCase()}\n`; 
    t += `PLACA: ABC-1234\n\n`;

    t += sep + "\n";
    t += isNarrow 
      ? `PRODUTO             QTD NO VEÍCULO\n`
      : `PRODUTO                         QTD NO VEÍCULO\n`;
    t += sep + "\n";

    minhaCarga.forEach(c => {
      const p = products.find(prod => prod.id === c.produtoId);
      const name = (p?.nome ?? '').toUpperCase(); 
      const qty = (c.quantidade ?? 0).toString(); 
      
      if (isNarrow) {
        t += `${name.substring(0, 22).padEnd(22)} ${qty.padStart(9)}\n`;
      } else {
        t += `${name.substring(0, 35).padEnd(35)} ${qty.padStart(12)}\n`;
      }
    });

    t += sep + "\n\n";
    t += `TOTAL DE ITENS: ${totalItensCarga.toString().padStart(isNarrow ? 16 : 32)}\n`;
    t += `QUANTIDADE TOTAL DE UNIDADES: ${unidadesTotaisCarga.toString().padStart(isNarrow ? 2 : 18)}\n\n`;

    t += center(`GERADO EM ${new Date().toLocaleDateString()} AS ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) + "\n";
    t += center(`CÓDIGO DE AUTENTICAÇÃO: ${Math.random().toString(36).substring(2, 10).toUpperCase()}`) + "\n";
    t += center(`--- FIM DO RELATÓRIO ---`) + "\n";

    return t;
  };

  const MenuCard = ({ icon, title, tab, color, badge }: any) => (
    <button onClick={() => setActiveTab(tab)} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 active:scale-95 transition-all text-center relative">
      {badge && <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></div>}
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center text-xl shadow-inner`}><i className={`fa-solid ${icon}`}></i></div>
      <span className="text-[11px] font-black uppercase text-gray-700">{title}</span>
    </button>
  );

  const contasAReceber = useMemo(() => sales.filter(s => s.vendedorId === user.id && s.metodoPagamento === 'A_PRAZO' && s.statusPagamento === 'PENDENTE'), [sales, user.id]);

  if (selectedClient) {
    const pdvClient = clients.find(c => c.id === selectedClient.id);
    if (!pdvClient) {
      setSelectedClient(null);
      return null;
    }
    return (
      <PDV
        client={pdvClient}
        products={products}
        minhaCarga={minhaCarga}
        vendedorId={user.id}
        onCancel={() => setSelectedClient(null)}
        onFinish={(s) => {
          setViewingSale(s);
          setSelectedClient(null);
          showToast("Venda realizada");
        }}
        processSale={processSale}
        margemMinima={margemMinima}
        margemMinimaAtiva={margemMinimaAtiva}
        pix1Name={pix1Name}
        pix1Code={pix1Code}
        pix2Name={pix2Name}
        pix2Code={pix2Code}
      />
    );
  }

  if (viewingSale) {
    const cupomClient = clients.find(c => c.id === viewingSale.clientId);
    if (!cupomClient) {
      setViewingSale(null);
      return null;
    }
    return (
      <Cupom
        sale={viewingSale}
        client={cupomClient}
        products={products}
        onClose={() => setViewingSale(null)}
        onDeleteSale={deleteSale}
        allowDelete={true}
      />
    );
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

      {activeTab !== 'HOME' && <button onClick={() => setActiveTab('HOME')} className="w-10 h-10 bg-white text-blue-600 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 mb-2"><i className="fa-solid fa-arrow-left"></i></button>}

      {activeTab === 'HOME' && (
        <div className="py-4 grid grid-cols-2 gap-4">
          <MenuCard icon="fa-route" title="Rota do Dia" tab="ROTEIRO" color="bg-blue-50 text-blue-600" />
          <MenuCard icon="fa-truck-fast" title="Minha Carga" tab="CARGA" color="bg-purple-50 text-purple-600" badge={cargasPendentes.length > 0} />
          <MenuCard icon="fa-receipt" title="Vendas" tab="HISTORY" color="bg-blue-50 text-[#1E3A5F]" />
          <MenuCard icon="fa-wallet" title="Financeiro" tab="FINANCE" color="bg-emerald-50 text-[#1F7A4D]" />
          <MenuCard icon="fa-file-invoice-dollar" title="Contas a Receber" tab="CREDIT" color="bg-rose-50 text-rose-600" />
          <MenuCard icon="fa-users" title="Clientes" tab="CLIENTS" color="bg-green-50 text-green-600" />
          <MenuCard icon="fa-calendar-days" title="Roteiro Semanal" tab="WEEKLY" color="bg-indigo-50 text-indigo-600" />
          <MenuCard icon="fa-boxes-stacked" title="Estoque" tab="STOCK_VIEW" color="bg-yellow-50 text-yellow-600" />
        </div>
      )}

      {activeTab === 'CARGA' && (
        <div className="space-y-4">
          {cargasPendentes.length > 0 ? (
            <div className="bg-orange-50 p-6 rounded-3xl shadow-xl flex flex-col gap-4 items-center text-center animate-in fade-in zoom-in-95 duration-300">
              <i className="fa-solid fa-truck-loading text-orange-600 text-4xl mb-2"></i>
              <h3 className="text-xl font-black text-orange-800">Nova Carga Disponível!</h3>
              <p className="text-sm text-orange-700">O administrador enviou uma nova carga para você. Aceite para atualizar seu estoque e começar a vender.</p>
              <button 
                onClick={() => handleAceitarCarga(cargasPendentes[0].id)} 
                className="w-full bg-orange-600 text-white font-black py-5 rounded-2xl shadow-lg active:scale-95 transition-all text-sm uppercase tracking-widest"
              >
                <i className="fa-solid fa-check-circle mr-2"></i> ACEITAR CARGA
              </button>
            </div>
          ) : (
            <>
              <div className="bg-purple-600 text-white p-6 rounded-3xl shadow-xl flex justify-between items-center">
                 <div><p className="text-[10px] font-black uppercase opacity-60">Carga</p><h3 className="text-2xl font-black">R$ {valorTotalCarga.toFixed(2)}</h3></div>
                 <div className="text-right"><p className="text-[10px] font-black uppercase opacity-60">Itens</p><h3 className="text-2xl font-black">{unidadesTotaisCarga}</h3></div>
              </div>
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-gray-50"><tr><th className="p-4 text-[10px] font-black text-gray-400 uppercase">Item</th><th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase">Preço</th><th className="p-4 text-right text-[10px] font-black text-gray-400 uppercase">Qtd</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">{minhaCarga.map(c => { const p = products.find(prod => prod.id === c.produtoId); return (<tr key={c.produtoId}><td className="p-4 text-xs font-semibold">{p?.nome ?? 'Produto Desconhecido'}</td><td className="p-4 text-center text-xs text-gray-400">R$ {(p?.precoVenda ?? 0).toFixed(2)}</td><td className="p-4 text-right font-black text-lg text-blue-600">{(c.quantidade ?? 0)}</td></tr>); })}</tbody> 
                </table>
              </div>
              <button 
                onClick={() => setShowFiscalization(true)}
                className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all text-xs tracking-widest uppercase"
              >
                <i className="fa-solid fa-shield-halved"></i>
                Modo Fiscalização
              </button>
            </>
          )}
        </div>
      )}

      {activeTab === 'ROTEIRO' && (
        <div className="space-y-4">
          <header className="flex justify-between items-center px-1">
            <div className="flex flex-col items-start">
              <h2 className="text-xl font-black text-gray-800 tracking-tight leading-none">
                {DIAS_SEMANA[diaAtual] ?? 'N/D'}
              </h2>
              <span className="text-[10px] font-black uppercase text-gray-400 mt-1">
                {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <span className="bg-blue-100 text-blue-600 text-[10px] px-2 py-1 rounded-lg font-black">{rotaDeHoje.length} VISITAS</span>
          </header>
          {rotaDeHoje.map(c => {
            // Um cliente é considerado 'visited' se foi vendido OU pulado, e não foi reaberto.
            const isSold = sales.some(s => s.clientId === c.id && isSameDay(s.data));
            const isSkipped = skippedClientIds.includes(c.id);
            const isVisited = (isSold || isSkipped) && !reopenedClientIds.includes(c.id);
            
            return (
              <div key={c.id} className={`p-4 rounded-3xl border flex flex-col transition-all ${isVisited ? 'bg-gray-100 border-gray-200 grayscale opacity-60' : 'bg-white border-gray-100 shadow-sm'}`}>
                <div className="flex justify-between items-center">
                  <div className="flex-1"><p className="font-bold text-gray-800 leading-tight">{c.nomeFantasia ?? 'Cliente Desconhecido'}</p><p className="text-[10px] text-gray-400 mt-1 uppercase font-semibold"><i className="fa-solid fa-location-dot mr-1"></i> {(c.bairro || 'S/B')}</p></div>
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

      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          <div className="flex bg-gray-100 p-1 rounded-2xl shadow-inner mb-2">{(['DIA', 'SEMANA', 'MES', 'GERAL'] as const).map(f => (<button key={f} onClick={() => setHistoryFilter(f)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase ${historyFilter === f ? 'bg-white text-[#1E3A5F] shadow-sm' : 'text-gray-400'}`}>{f}</button>))}</div>
          
          {/* Card de Resumo de Histórico de Vendas (Melhorado) */}
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md flex flex-col gap-4">
             <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                <span className="text-xs font-black text-gray-400 uppercase">Total Geral ({historyFilter})</span>
                <span className="text-2xl font-black text-gray-900">R$ {historySummary.total.toFixed(2)}</span>
             </div>
             <div className="grid grid-cols-3 gap-3">
                <div className="text-center bg-emerald-50 p-3 rounded-xl">
                   <p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Dinheiro</p>
                   <p className="text-sm font-black text-emerald-700">R$ {historySummary.dinheiro.toFixed(2)}</p>
                </div>
                <div className="text-center bg-blue-50 p-3 rounded-xl">
                   <p className="text-[9px] font-black text-blue-600 uppercase mb-1">Pix</p>
                   <p className="text-sm font-black text-blue-700">R$ {historySummary.pix.toFixed(2)}</p>
                </div>
                <div className="text-center bg-orange-50 p-3 rounded-xl">
                   <p className="text-[9px] font-black text-orange-600 uppercase mb-1">A Prazo</p>
                   <p className="text-sm font-black text-orange-700">R$ {historySummary.prazo.toFixed(2)}</p>
                </div>
             </div>
          </div>
          
          {filteredHistory.map(s => (<div key={s.id} className="bg-white p-4 rounded-3xl border border-gray-100 flex flex-col shadow-sm"><div className="flex justify-between items-center mb-2"><p className="font-bold text-gray-800 text-sm">{clients.find(c => c.id === s.clientId)?.nomeFantasia ?? 'Cliente Desconhecido'}</p><p className="text-sm font-semibold text-emerald-600">R$ {(s.valorTotal ?? 0).toFixed(2)}</p></div><div className="flex justify-between items-end"><p className="text-[10px] text-gray-400 font-semibold">{(s.metodoPagamento ?? 'N/D')} • {(s.data ?? new Date()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p><div className="flex gap-3"><button onClick={() => setViewingSale(s)} className="text-[#1E3A5F] text-lg"><i className="fa-solid fa-file-invoice"></i></button></div></div></div>))} 
        </div>
      )}

      {activeTab === 'FINANCE' && (
        <div className="space-y-6">
           <div className="flex bg-gray-100 p-1 rounded-2xl shadow-inner">{(['DIA', 'SEMANA', 'MES', 'GERAL'] as const).map(f => (<button key={f} onClick={() => setFinanceFilter(f)} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase ${financeFilter === f ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'}`}>{f}</button>))}</div>
           <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex justify-between items-center"><div><p className="text-[10px] font-black uppercase text-gray-400 mb-1">Total Vendido</p><h2 className="text-2xl font-black text-gray-800">R$ {financeStats.totalVendido.toFixed(2)}</h2></div></div>
           <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 p-5 rounded-3xl shadow-md border border-emerald-100">
                 <p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Comissão disponível</p>
                 <p className="text-xl font-black text-emerald-700">R$ {financeStats.disponivel.toFixed(2)}</p>
              </div>
              <div className="bg-orange-50 p-5 rounded-3xl shadow-sm border border-orange-100">
                 <p className="text-[9px] font-black text-orange-600 uppercase mb-1">Comissão a receber</p>
                 <p className="text-xl font-black text-orange-700">R$ {financeStats.pendente.toFixed(2)}</p>
              </div>
           </div>
        </div>
      )}

      {activeTab === 'CREDIT' && (
        <div className="space-y-4">
          <header className="px-1"><h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Contas a Receber</h2></header>
          <div className="grid gap-3">
            {contasAReceber.map(s => {
              const saldo = Number(((s.valorTotal ?? 0) - (s.valorPago ?? 0)).toFixed(2)); 
              return (
              <div key={s.id} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col transition-all">
                <div className="flex justify-between items-start mb-2">
                   <div>
                      <h4 className="font-bold text-gray-800 text-sm leading-tight">{clients.find(c => c.id === s.clientId)?.nomeFantasia || 'Cliente'}</h4>
                      <div className="mt-2 space-y-1">
                         <p className="text-[10px] text-gray-400 font-semibold uppercase">Vencimento: {(s.dataVencimento ? new Date(s.dataVencimento) : new Date()).toLocaleDateString()}</p> 
                         {(s.valorPago ?? 0) > 0 && <p className="text-[10px] text-emerald-600 font-black uppercase">Já pago: R$ {(s.valorPago ?? 0).toFixed(2)}</p>} 
                      </div>
                   </div>
                   <p className="text-lg font-black text-rose-600">Saldo: R$ {saldo.toFixed(2)}</p>
                </div>
                <button onClick={() => { setShowReceiveModal(s); setValorRecebidoParcial(saldo.toString()); }} className="w-full bg-emerald-600 text-white py-3 rounded-2xl text-[10px] font-black uppercase mt-3 shadow-lg active:scale-95 transition-all">Receber Agora</button>
              </div>
            )})}
          </div>
        </div>
      )}

      {activeTab === 'CLIENTS' && (
        <div className="space-y-4">
          <header className="px-1 flex justify-between items-center">
            <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Meus Clientes</h2>
            <button onClick={() => handleOpenEditClient('NEW')} className="bg-green-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-md active:scale-95">
              <i className="fa-solid fa-user-plus mr-2"></i>Novo
            </button>
          </header>
          <div className="grid gap-3">
            {clients.map(c => (
              <div key={c.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex justify-between items-center transition-all">
                <div>
                  <h4 className="font-bold text-gray-800 text-sm leading-tight">{c.nomeFantasia ?? 'Cliente Desconhecido'}</h4> 
                  <p className="text-[10px] text-gray-400 font-semibold uppercase mt-1">{(c.telefone ?? 'Sem Telefone')} • {(DIAS_SEMANA[c.diaRoteiro ?? 0] ?? 'N/D')}</p> 
                </div>
                <button onClick={() => handleOpenEditClient(c)} className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center active:scale-95">
                  <i className="fa-solid fa-pencil text-xs"></i>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'WEEKLY' && (
        <div className="space-y-4">
          <header className="px-1"><h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Roteiro Semanal</h2></header>
          <div className="px-1">
             <input type="text" placeholder="Filtrar por nome..." value={weeklySearch} onChange={e => setWeeklySearch(e.target.value)} className="w-full px-4 py-3 bg-white border border-gray-100 rounded-2xl text-xs font-semibold shadow-sm outline-none" />
          </div>
          <div className="space-y-3 px-1">
            {[1, 2, 3, 4, 5, 6].map(dia => {
              const isOpen = expandedDay === dia;
              const clientsInDay = clients.filter(c => (c.diaRoteiro ?? 0) === dia && (c.ativo ?? false) && (weeklySearch === '' || (c.nomeFantasia ?? '').toLowerCase().includes(weeklySearch.toLowerCase()))); 
              if (weeklySearch !== '' && clientsInDay.length === 0) return null;
              return (
                <div key={dia} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                  <button onClick={() => setExpandedDay(isOpen ? null : dia)} className={`w-full flex items-center justify-between p-5 text-left transition-colors ${isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-gray-700'}`}>
                    <div className="flex items-center gap-3">
                       <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${isOpen ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>{dia}</div>
                       <span className="font-black uppercase text-xs tracking-tight">{DIAS_SEMANA[dia] ?? 'N/D'}</span>
                    </div>
                    <div className="flex items-center gap-2"><span className="text-[9px] font-black uppercase opacity-40">{clientsInDay.length}</span><i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px]`}></i></div>
                  </button>
                  {isOpen && (
                    <div className="p-4 bg-white space-y-2 border-t border-indigo-50 animate-in slide-in-from-top duration-300">
                      {clientsInDay.map(c => {
                        const isInCurrentRoute = ((c.diaRoteiro ?? 0) === diaAtual || extraRouteClientIds.includes(c.id)); 
                        return (
                          <div key={c.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center">
                            <div><p className="font-bold text-gray-800 text-xs">{c.nomeFantasia ?? 'Cliente Desconhecido'}</p><p className="text-[9px] text-gray-400 font-semibold mt-0.5">{(c.bairro || 'Sem Bairro')}</p></div>
                            {!isInCurrentRoute && (
                              <button 
                                onClick={() => handleAddToTodayRoute(c.id)} 
                                className="w-8 h-8 bg-white border border-indigo-200 text-indigo-600 rounded-xl flex items-center justify-center shadow-sm active:scale-90" 
                                title="Puxar para hoje"
                              >
                                <i className="fa-solid fa-plus text-[10px]"></i>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'STOCK_VIEW' && (
        <div className="space-y-4">
          <header className="px-1"><h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">Estoque Central (Apenas Leitura)</h2></header>
          <div className="grid gap-3">
            {products.map(p => ( 
              <div key={p.id} className="bg-white px-4 py-3 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-bold text-gray-800 text-sm leading-tight">{p.nome ?? 'Produto Desconhecido'}</h3> 
                  <div className="flex items-center gap-2 mt-1"><span className="text-[10px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded tracking-tighter">Central: {(p.estoquePrincipal ?? 0)} un</span></div> 
                </div>
                <div className="text-right"><p className="text-sm font-black text-emerald-600">R$ {(p.precoVenda ?? 0).toFixed(2)}</p></div> 
              </div>
            ))}
          </div>
        </div>
      )}

      {showFiscalization && (
        <div className="fixed inset-0 bg-slate-100 z-[500] flex flex-col items-center p-4 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-[450px] mb-6 flex items-center">
            <button onClick={() => setShowFiscalization(false)} className="p-3 text-slate-800 text-xl"><i className="fa-solid fa-chevron-left"></i></button>
            <h1 className="flex-1 text-center font-black text-[13px] uppercase tracking-[0.1em] text-slate-800">
              Relatório de Carga Oficial Atualizado
            </h1>
            <button className="p-3 text-slate-400 text-xl"><i className="fa-solid fa-print"></i></button>
          </div>

          <div className="w-full max-w-[400px] bg-gray-200 p-1 rounded-xl flex mb-8">
            <button 
              onClick={() => setFiscalizationSize(80)}
              className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${fiscalizationSize === 80 ? 'bg-white text-slate-900 shadow-md' : 'text-slate-400'}`}
            >
              80mm (Padrão)
            </button>
            <button 
              onClick={() => setFiscalizationSize(56)}
              className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${fiscalizationSize === 56 ? 'bg-white text-slate-900 shadow-md' : 'text-slate-400'}`}
            >
              56mm (Móvel)
            </button>
          </div>

          <div className={`bg-white shadow-2xl overflow-hidden mb-8 transform transition-all w-full max-w-[400px]`}>
            <div className="p-4 sm:p-8 font-mono text-black uppercase leading-tight bg-white overflow-x-auto">
              <pre className="whitespace-pre-wrap text-[11px] sm:text-[12px] select-none text-center sm:text-left min-w-[320px]">
                {getFiscalizationText()}
              </pre>
            </div>
            <div className="flex justify-between text-gray-100 overflow-hidden h-3 select-none">
              {Array.from({ length: 60 }).map((_, i) => (
                <span key={i} className="text-[25px] leading-none transform rotate-45">▲</span>
              ))}
            </div>
          </div>

          <div className="w-full max-w-[400px] grid grid-cols-2 gap-3 mb-6">
            <button 
              onClick={() => { navigator.clipboard.writeText(getFiscalizationText()); showToast("Relatório copiado!"); }}
              className="bg-white border-2 border-slate-200 text-slate-800 font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-[11px] uppercase"
            >
              <i className="fa-solid fa-copy"></i>
              Copiar Texto
            </button>
            <button className="bg-[#0f172a] text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all text-[11px] uppercase">
              <i className="fa-solid fa-share-nodes"></i>
              Compartilhar PDF
            </button>
          </div>

          <button onClick={() => setShowFiscalization(false)} className="text-slate-400 font-black text-[11px] uppercase tracking-[0.2em] py-4">
            Voltar
          </button>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
           <div className="bg-white w-full max-w-xs rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="font-black text-gray-800 text-sm uppercase mb-4 text-center tracking-tight">Confirmar Recebimento</h3>
              <div className="bg-gray-50 p-4 rounded-2xl mb-6">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Saldo em Aberto</p>
                <p className="text-xl font-black text-rose-600">R$ {((showReceiveModal.valorTotal ?? 0) - (showReceiveModal.valorPago ?? 0)).toFixed(2)}</p> 
              </div>
              <div className="space-y-4 mb-6">
                <p className="text-[10px] font-black text-gray-400 uppercase text-left ml-1">Valor a Receber</p>
                <input type="number" value={valorRecebidoParcial} onChange={e => setValorRecebidoParcial(e.target.value)} className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-black text-xl text-center outline-none focus:ring-2 focus:ring-blue-100" />
              </div>
              <div className="space-y-3">
                 <button onClick={() => handleConfirmReceive('DINHEIRO')} className="w-full bg-gray-900 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs tracking-widest">DINHEIRO</button>
                 <button onClick={() => handleConfirmReceive('PIX')} className="w-full bg-blue-600 text-white py-4 rounded-2xl shadow-lg active:scale-95 font-black uppercase text-xs tracking-widest">PIX</button>
                 <button onClick={() => setShowReceiveModal(null)} className="w-full py-3 text-gray-400 font-semibold uppercase text-[9px] tracking-widest text-center">Cancelar</button>
              </div>
           </div>
        </div>
      )}

      {editingClient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[310] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl p-8 animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-6"><h3 className="font-black text-gray-800 uppercase text-sm tracking-tight">{editingClient === 'NEW' ? 'Novo Cliente' : 'Editar Cliente'}</h3></div>
             <div className="space-y-4 pb-6">
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Nome Fantasia</label><input value={cForm.nomeFantasia || ''} onChange={e => setCForm({...cForm, nomeFantasia: e.target.value})} placeholder="Nome Fantasia" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Telefone / WhatsApp</label><input value={cForm.telefone || ''} onChange={e => setCForm({...cForm, telefone: e.target.value})} placeholder="Telefone" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Endereço</label><input value={cForm.endereco || ''} onChange={e => setCForm({...cForm, endereco: e.target.value})} placeholder="Endereço" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Bairro</label><input value={cForm.bairro || ''} onChange={e => setCForm({...cForm, bairro: e.target.value})} placeholder="Bairro" className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100" /></div>
                <div className="space-y-1"><label className="text-[10px] font-black text-gray-400 uppercase ml-1">Dia de Atendimento</label><select value={cForm.diaRoteiro ?? 1} onChange={e => setCForm({...cForm, diaRoteiro: parseInt(e.target.value)})} className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100">{[1, 2, 3, 4, 5, 6].map(d => (<option key={d} value={d}>{DIAS_SEMANA[d] ?? 'N/D'}</option>))}</select></div> 
                
                {/* Campo de PIN de Localização com botão de captura */}
                <div className="space-y-1">
                   <label className="text-[10px] font-black text-gray-400 uppercase ml-1">PIN de Localização (Lat, Lng)</label>
                   <div className="relative">
                      <input 
                         value={cForm.pinLocalizacao ?? ''} 
                         onChange={e => setCForm({...cForm, pinLocalizacao: e.target.value})} 
                         placeholder="Ex: -23.5505, -46.6333" 
                         className="w-full p-4 bg-gray-50 rounded-2xl font-semibold border-none outline-none focus:ring-2 focus:ring-blue-100 pr-12" 
                      />
                      <button 
                         type="button"
                         onClick={handlePinLocation} 
                         className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600 p-2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center active:scale-95"
                         title="Capturar Localização Atual"
                      >
                         <i className="fa-solid fa-location-crosshairs text-xs"></i>
                      </button>
                   </div>
                </div>

                <div className="flex flex-col gap-2 mt-4"><button onClick={handleSaveClientBasic} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg uppercase text-xs">Salvar Alterações</button><button onClick={() => setEditingClient(null)} className="w-full py-3 text-gray-400 font-bold uppercase text-[10px]">Cancelar</button></div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorDashboard;