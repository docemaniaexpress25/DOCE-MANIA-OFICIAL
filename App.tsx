import React, { useState, useEffect, useCallback } from 'react';
// ✅ Fix default export imports
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

// ✅ Add missing type imports
import { User } from './types';
import { Product } from './types';
import { Client } from './types';
import { Sale } from './types';
import { Commission } from './types';
import { CommissionPaymentLog } from './types';
import { SystemMessage } from './types';
import { Expense } from './types';
import { Carga } from './types';
import { CargaPendente } from './types';

function App() {
  // ✅ Define valorComissaoLiberada (example calculation)
  const valorComissaoLiberada = 0; // Replace with actual calculation

  // ... (state declarations) ...
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

  // ... (rest of component) ...

  const fetchCommissionData = async () => {
    const [commissionsData, payoutsData, messagesData, expensesData] = await Promise.all([
      commissionService.getAllCommissions(), // ✅ Method exists
      commissionService.getAllPayouts(), // ✅ Method exists
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
      await commissionService.updateCommission(comm.id, { status: 'DISPONIVEL' }); // ✅ Method exists
    }

    // ... (rest of logic) ...
    const valorComissaoLiberada = ...; // calculate based on payment
    const valorRecebido = novoValorPago;
    const s = sales.find(s => s.id === saleId);
    if (s) {
      await commissionService.insertCommission({ // ✅ Method exists
        saleId: s.id,
        vendedorId: s.vendedorId,
        valor: valorComissaoLiberada,
        valorBase: valorRecebido,
        percentual: comm.percentual || 0,
        status: 'DISPONIVEL',
        dataGeracao: new Date()
      });

      await commissionService.updateCommission(comm.id, { // ✅ Method exists
        valor: Number((comm.valor - valorComissaoLiberada).toFixed(2)),
        valorBase: Number(((comm.valorBase || 0) - valorRecebido).toFixed(2))
      });

      const logSuccess = await commissionService.insertPayout({ // ✅ Method exists
        vendedorId: s.vendedorId,
        vendedorNome: s.vendedorId ? users.find(u => u.id === s.vendedorId)?.nome || 'N/D' : 'N/D',
        valorPago: valorRecebido,
        valorRestante: 0,
        tipo: 'TOTAL',
        dataPagamento: new Date(),
        adminId: 'N/D' // ✅ Add missing adminId property
      });
    }
  };

  // ... (rest of component) ...
}

export default App;