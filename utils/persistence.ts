import { Sale, Carga, CargaPendente, Commission, CommissionPaymentLog, SystemMessage } from '../types';

// Helper function to check if a string is a valid ISO date string
const isIsoDateString = (value: any): boolean => {
  if (typeof value !== 'string') return false;
  // Regex para verificar formatos ISO 8601 comuns
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/.test(value) || /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
};

// Recursive function to revive Date objects from ISO strings
const dateReviver = (key: string, value: any): any => {
  if (isIsoDateString(value)) {
    return new Date(value);
  }
  return value;
};

// Generic function to load state from localStorage
export const loadLocalState = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      // Use dateReviver to reconstruct Date objects
      const parsed = JSON.parse(saved, dateReviver);
      return parsed as T;
    } catch (e) {
      console.error(`Error parsing localStorage key ${key}`, e);
      localStorage.removeItem(key); // Clear corrupted data
    }
  }
  return defaultValue;
};

// Generic function to save state to localStorage
export const saveLocalState = <T>(key: string, state: T): void => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      console.error(`Error saving localStorage key ${key}`, e);
    }
  }
};

// Define default values for local state arrays
export const DEFAULT_CARGAS: Carga[] = [];
export const DEFAULT_CARGAS_PENDENTES: CargaPendente[] = [];
export const DEFAULT_SALES: Sale[] = [];
export const DEFAULT_COMMISSIONS: Commission[] = [];
export const DEFAULT_PAYOUT_LOGS: CommissionPaymentLog[] = [];
export const DEFAULT_MESSAGES: SystemMessage[] = [];