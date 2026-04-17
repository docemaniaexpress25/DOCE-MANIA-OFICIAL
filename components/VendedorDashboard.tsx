import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense } from '../types';
import { DIAS_SEMANA } from '../constants';
import PDV from './PDV';
import Cupom from './Cupom';
import RelatorioFiscal from './RelatorioFiscal';
import ClientHistory from './ClientHistory';
import { DailyRouteState, loadLocalState, saveLocalState } from '../utils/persistence';
import { dailyRouteService } from '../services/dailyRouteService';

const VendedorDashboard: React.FC = ({ 
  user, 
  products, 
  clients, 
  minhaCarga, 
  vendas, 
  commissions, 
  payoutLogs, 
  messages, 
  expenses, 
  dailyRouteState, 
  setDailyRouteState
}) => {
  const [cachedDailyRoute, setCachedDailyRoute] = useState<DailyRouteState | null>(null);
  useEffect(() => {
    const cached = loadLocalState<DailyRouteState>('v_dailyRoute');
    if (cached) setCachedDailyRoute(cached);
  }, []);

  const saveDailyRouteToCache = (route: DailyRouteState) => {
    saveLocalState('v_dailyRoute', route);
  };

  const handleFetchDailyRoute = async () => {
    if (cachedDailyRoute) return cachedDailyRoute;
    const route = await dailyRouteService.getRoute(user.id, dailyRouteState.date);
    if (route) saveDailyRouteToCache(route);
    return route;
  };

  // ... (rest of component) ...
};

export default VendedorDashboard;