import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, User, Carga, Sale, Commission, Client, PaymentMethod, CargaPendente, CommissionPaymentLog, SystemMessage, Expense } from '../types';
import { DIAS_SEMANA } from '../constants';
import Cupom from './Cupom';
import ClientHistory from './ClientHistory';
import { loadLocalState, saveLocalState } from '../utils/persistence';
import { clientService } from '../services/clientService';
import { cargaService } from '../services/cargaService';

// ... (rest of imports) ...

const [cachedClients, setCachedClients] = useState<Client[] | null>(null);
const [cachedCargas, setCachedCargas] = useState<Carga[] | null>(null);
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

useEffect(() => {
  const cached = loadLocalState<Client[]>('cachedClients', []); // ✅ Provide default []
  if (cached) setCachedClients(cached);
}, []);

useEffect(() => {
  const cached = loadLocalState<Carga[]>('cachedCargas', []); // ✅ Provide default []
  if (cached) setCachedCargas(cached);
}, []);

// ... (rest of component) ...