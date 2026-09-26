export type UserRole = 'ADMIN' | 'VENDEDOR' | 'ENTREGADOR' | 'SECRETARIO';

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
  /** Pre-vendedor (ex.: Edipo): vende do estoque principal e gera rota de entrega */
  preVenda?: boolean;
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
  /** Fiscais (Bloco 12) — usados na emissao de NFe/NFCe */
  ncm?: string;
  cest?: string;
  cfop?: string;
  ean?: string;
  unidade?: string;
  origem?: string;
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
  /** Codigo aleatorio do portal do cliente (link do extrato) */
  portalCodigo?: string;
  /** Fiscais (Bloco 10) — completos para emissao de NFe no cliente */
  razaoSocial?: string;
  inscricaoEstadual?: string;
  enderecoNumero?: string;
  enderecoCep?: string;
  enderecoMunicipio?: string;
  enderecoUf?: string;
  /** Email do cliente (NF-e envia para o financeiro; normalmente manual) */
  email?: string;
}

export type NotaStatus = 'NAO_EMITIDA' | 'EMITINDO' | 'AUTORIZADA' | 'REJEITADA' | 'CANCELADA';

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
  /** Bloco 13: fila continua de pre-venda */
  tipoVenda?: 'PRONTA' | 'PRE_VENDA';
  entregaStatus?: string; // PENDENTE | EM_ROTA | ENTREGUE | FALHOU
  /** Trocas anotadas pelo vendedor (impressas no cupom) ex.: "1 Lays sour cream 62g" */
  trocas?: string;
  /** 0 = normal, 1 = PRIORIDADE 1, 2 = PRIORIDADE 2 */
  prioridade?: number;
  /** Secretario da base separou o pedido (card cinza) */
  separado?: boolean;
  /** Quem fez a entrega (nominal) */
  entregadorId?: string;
  /** Nota fiscal (Bloco 10) — preenchido via /api/notas */
  notaStatus?: NotaStatus;
  notaNumero?: string;
  notaPdfUrl?: string;
  notaErro?: string;
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

/** Bloco 13: fechamento de caixa do entregador (dinheiro em especie) */
export interface CaixaFechamento {
  id: string;
  entregadorId: string;
  data: string;
  valorDinheiro: number;
  valorPix: number;
  qtdEntregas: number;
  obs?: string;
  confirmado: boolean;
  confirmadoEm?: string;
  criadoEm: string;
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