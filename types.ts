export type UserRole = 'ADMIN' | 'VENDEDOR';

export interface User {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  ativo: boolean;
  telefone?: string;
  whatsapp?: string;
  foto?: string;
  pin?: string;
}

export interface Product {
  id: string;
  nome: string;
  precoCusto: number;
  precoVenda: number;
  comissaoPercentual: number;
  estoquePrincipal: number;
  ativo: boolean;
}

export interface Carga {
  vendedorId: string;
  produtoId: string;
  quantidade: number;
}

export interface CargaPendente {
  id: string;
  vendedorId: string;
  itens: { produtoId: string; quantidade: number }[];
  data: Date;
}

export type PaymentMethod = 'DINHEIRO' | 'PIX' | 'A_PRAZO';

export interface Client {
  id: string;
  nomeFantasia: string;
  nome?: string;
  ativarCnpj?: boolean;
  cnpj?: string;
  telefone: string;
  endereco: string;
  bairro: string;
  ativo: boolean;
  localizacao?: { lat: number; lng: number };
  diaRoteiro: number;
  observacoes?: string;
  pinLocalizacao?: string;
}

export interface SaleItem {
  produtoId: string;
  quantidade: number;
  precoVenda: number;
}

export interface Sale {
  id: string;
  vendedorId: string;
  clientId: string;
  data: Date;
  valorTotal: number;
  valorPago: number;
  metodoPagamento: PaymentMethod;
  detalhePagamento?: string; 
  statusPagamento: 'PAGO' | 'PENDENTE';
  itens: SaleItem[];
  dataVencimento?: Date;
}

export interface Commission {
  id: string;
  saleId: string;
  vendedorId: string;
  valor: number;
  valorBase?: number;
  percentual?: number;
  status: 'DISPONIVEL' | 'A_RECEBER' | 'PAGO' | 'PENDENTE_CONFIRMACAO';
  dataGeracao: Date;
}

export interface CommissionPaymentLog {
  id: string;
  vendedorId: string;
  vendedorNome: string;
  valorPago: number;
  valorRestante: number;
  tipo: 'TOTAL' | 'PARCIAL';
  dataPagamento: Date;
  adminId: string;
}

export interface SystemMessage {
  id: string;
  vendedorId: string;
  titulo: string;
  mensagem: string;
  data: Date;
  lida: boolean;
  type?: 'INFO' | 'COMMISSION_CONFIRMATION'; // Adicionado 'type'
}