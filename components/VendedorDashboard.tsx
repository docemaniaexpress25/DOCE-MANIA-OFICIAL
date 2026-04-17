import React, { useState, useMemo, useEffect, useRef } from 'react';
import { User, Product, Client, Carga, Sale, Commission, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense } from '../types';
import { DIAS_SEMANA } from '../constants';
import PDV from './PDV';
import Cupom from './Cupom';
import RelatorioFiscal from './RelatorioFiscal';
import ClientHistory from './ClientHistory';
import { DailyRouteState, loadLocalState, saveLocalState } from '../utils/persistence';
import { dailyRouteService } from '../services/dailyRouteService';

// ... (rest of imports) ...

const [cachedDailyRoute, setCachedDailyRoute] = useState<DailyRouteState | null>(null);
useEffect(() => {
  const cached = loadLocalState<DailyRouteState>('v_dailyRoute', null); // ✅ Provide default null
  if (cached) setCachedDailyRoute(cached);
}, []);

// ... (rest of component) ...