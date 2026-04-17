import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense } from '../types';
import { DIAS_SEMANA } from '../constants';
import Cupom from './Cupom';
import ClientHistory from './ClientHistory';
import { loadLocalState, saveLocalState } from '../utils/persistence';
import { clientService } from '../services/clientService';
import { cargaService } from '../services/cargaService';

const AdminDashboard: React.FC = ({ 
  users, 
  products, 
  setProducts, 
  clients, 
  setClients, 
  currentUser, 
  setCurrentUser, 
  appSettings, 
  setAppSettings, 
  sales, 
  setSales, 
  commissions, 
  setCommissions, 
  payoutLogs, 
  setPayoutLogs, 
  messages, 
  setMessages, 
  cargas, 
  setCargas, 
  cargasPendentes, 
  setCargasPendentes,
  dailyRouteState,
  setDailyRouteState
}) => {
  const [cachedClients, setCachedClients] = useState<Client[] | null>(null);
  const [cachedCargas, setCachedCargas] = useState<Carga[] | null>(null);
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  useEffect(() => {
    const cached = loadLocalState<Client[]>('cachedClients');
    if (cached) setCachedClients(cached);
  }, []);

  useEffect(() => {
    const cached = loadLocalState<Carga[]>('cachedCargas');
    if (cached) setCachedCargas(cached);
  }, []);

  const saveToCache = (key: string, value: any) => {
    saveLocalState(key, value);
  };

  const handleLoadClients = async () => {
    if (cachedClients) return cachedClients;
    const data = await clientService.getAllClients();
    saveToCache('cachedClients', data);
    return data;
  };

  const handleLoadCargas = async () => {
    if (cachedCargas) return cachedCargas;
    const data = await cargaService.getAllCargas();
    saveToCache('cachedCargas', data);
    return data;
  };

  // ... (rest of component) ...
};

export default AdminDashboard;