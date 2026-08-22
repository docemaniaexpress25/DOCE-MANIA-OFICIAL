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
  placaVeiculo?: string;
  rota?: string;
}

export interface Category {
  id: string;
  name: string;
  display_order?: number;
}

export interface Subcategory {
  id: string;
  categoryId: string;
  name: string;
  display_order?: number;
}

export interface Product {
  id: string;
  nome: string;
  precoCusto: number;
  precoVenda: number;
  precoMinimo: number;
  comissaoPercentual: number;
  estoquePrincipal: number;
  ativo: boolean;
  categoryId?: string;
  subcategoryId?: string;
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
  ordem: number; 
  observacoes?: string;
  pinLocalizacao?: string;
  rota?: string;
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
  comprovanteFoto?: string;
}

export interface Commission {
  id: string;
  saleId: string;
  vendedorId: string;
  valor: number;
  valorBase?: number;
  percentual?: number;
  status: 'DISPONIVEL' | 'A_RECEBER' | 'PAGO';
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

export interface Expense {
  id: string;
  sellerId: string;
  descricao: string;
  valor: number;
  createdAt: Date;
}

export interface SystemMessage {
  id: string;
  vendedorId: string;
  titulo: string;
  mensagem: string;
  data: Date;
  lida: boolean;
  type?: 'INFO' | 'COMMISSION_CONFIRMATION' | 'CARGA_PENDENTE'; 
}

export interface DailyRouteState {
  date: string; 
  clientIds: string[]; 
  skippedClientIds: string[]; 
}

export interface AppSettings {
  logo: string | null;
  margemGlobalAtiva: boolean;
  margemGlobalValor: number;
  margemMinimaAtiva: boolean;
  margemMinima: number;
  pix1Name: string | null;
  pix1Code: string | null;
  pix2Name: string | null;
  pix2Code: string | null;
  productOrder: string[];
  clientOrder: string[]; // NOVO: ordem dos clientes
  companyName: string | null;
  companyCnpj: string | null;
}