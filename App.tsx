import React, { useState, useEffect, useCallback } from 'react';
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
import { 
  loadLocalState, saveLocalState, 
  DailyRouteState
} from './utils/persistence';

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    logo: null,
    margemGlobalAtiva: true,
    margemGlobalValor: 30,
    margemMinimaAtiva: true,
    margemMinima: 20,
    pix1Name: "Pix Banco A",
    pix1Code: null,
    pix2Name: "Pix Banco B",
    pix2Code: null,
    productOrder: [],
    companyName: "DOCE MANIA DISTRIBUIDORA",
    companyCnpj: "00.000.000/0001-00"
  });
  const [sales, setSales] = useState<Sale[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payoutLogs, setPayoutLogs] = useState<CommissionPaymentLog[]>([]);
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [cargasPendentes, setCargasPendentes] = useState<CargaPendente[]>([]);
  const [dailyRouteState, setDailyRouteState] = useState<DailyRouteState>({
    date: new Date().toISOString().split('T')[0],
    clientIds: [],
    skippedClientIds: []
  });

  // ... (rest of the component logic) ...

  const fetchCommissionData = async () => {
    const [commissionsData, payoutsData, messagesData, expensesData] = await Promise.all([
      commissionService.getAllCommissions(),
      commissionService.getAllPayouts(),
      messageService.getAllMessages(),
      expenseService.getAllExpenses()
    ]);
    setCommissions(commissionsData);
    setPayoutLogs(payoutsData);
    setMessages(messagesData);
    setExpenses(expensesData);
  };

  // ... (sale service calls) ...
  const processSale = async (salePayload: Omit<Sale, 'id'>) => {
    const savedSale = await saleService.insertSale(salePayload);
    if (savedSale) {
      // ... (rest of logic) ...
    }
    return savedSale;
  };

  // ... (delete sale) ...
  const handleDeleteSale = async (saleId: string) => {
    const success = await saleService.deleteSale(saleId);
    if (success) {
      // ... (rest of logic) ...
    }
  };

  // ... (update sale) ...
  const handleReceiveAccount = async (saleId: string, novoValorPago: number) => {
    // Atualiza a venda
    await saleService.updateSale(saleId, { 
      valorPago: novoValorPago,
      // ... (other updates) ...
    });

    // ... (rest of logic) ...
    const comm = commissions.find(c => c.saleId === saleId);
    if (comm) {
      await commissionService.updateCommission(comm.id, { status: 'DISPONIVEL' });
    }

    // ... (rest of logic) ...
    const valorComissaoLiberada = ...; // calculate based on payment
    const valorRecebido = novoValorPago;
    const s = sales.find(s => s.id === saleId);
    if (s) {
      await commissionService.insertCommission({
        saleId: s.id,
        vendedorId: s.vendedorId,
        valor: valorComissaoLiberada,
        valorBase: valorRecebido,
        percentual: comm.percentual || 0,
        status: 'DISPONIVEL',
        dataGeracao: new Date()
      });

      await commissionService.updateCommission(comm.id, {
        valor: Number((comm.valor - valorComissaoLiberada).toFixed(2)),
        valorBase: Number(((comm.valorBase || 0) - valorRecebido).toFixed(2))
      });

      const logSuccess = await commissionService.insertPayout({
        vendedorId: s.vendedorId,
        vendedorNome: s.vendedorId ? users.find(u => u.id === s.vendedorId)?.nome || 'N/D' : 'N/D',
        valorPago: valorRecebido,
        valorRestante: 0,
        tipo: 'TOTAL',
        dataPagamento: new Date()
      });
    }
  };

  // ... (rest of component) ...
}

export default App;