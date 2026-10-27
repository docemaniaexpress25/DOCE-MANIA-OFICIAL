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
  /** Bloco 27: vendedor no teste do NOVO fluxo de venda (wizard guiado) */
  rota2?: boolean;
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
  /** Bloco 14: comissão de PRÉ-VENDA (%) — null/vazio = padrão do dono (Bloco 23: 5%) */
  comissaoPvPercentual?: number | null;
  /** Bloco 23: vínculo manual à família do catálogo do portal — null = automático pelo nome */
  familiaCatalogo?: string | null;
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
  /** Bloco 15: foto do produto no catalogo do portal (URL) — sobrepoe a foto do catalogo antigo */
  imagem?: string;
  /** Bloco 15: caixa fechada com N unidades (atacado) — 1/undefined = vende solto */
  unidadesPorCaixa?: number;
  /** Bloco 18: observacao visivel SOMENTE ao cliente comprador no catalogo do portal — nao aparece no PDV */
  obs?: string | null;
  /** Bloco 29 (ROTA 2): ESTOQUE 1 em casa — mercadoria COM NF. undefined = SQL do bloco 29 ainda nao rodado */
  estoqueNota?: number;
  /** Bloco 29 (ROTA 2): ESTOQUE 2 em casa — mercadoria SEM NF. undefined = SQL do bloco 29 ainda nao rodado */
  estoqueSemnf?: number;
  /** Bloco 29 (ROTA 2): produto de TESTE — aparece SOMENTE para vendedores rota2 */
  produtoTeste?: boolean;
  /** BLOCO 70: PREÇO ESPECIAL GB — preço exclusivo para clientes ESPECIAL GB.
   *  0/undefined/null = produto sem preço GB → cai no preço normal do PDV. */
  precoEspecialGb?: number | null;
}

export interface Carga {
  vendedorId: string;
  produtoId: string;
  quantidade: number;
  /** Bloco 29 (ROTA 2): modo da van — 'COM_NF' | 'SEM_NF' (1 ou outro, nunca mistura). undefined = pre-SQL */
  modoNota?: string | null;
}

export interface CargaPendente {
  id: string;
  vendedorId: string;
  itens: { produtoId: string; quantidade: number }[];
  data: Date;
  /** Bloco 29 (ROTA 2): modo da carga enviada pelo admin — casa baixa no aceite (coluna certa) */
  modoNota?: string | null;
}

/** Bloco 29 (ROTA 2): modo do ATENDIMENTO — fixado na pergunta do início e gravado na venda */
export type ModoNota = 'NFE' | 'NFCE' | 'CUPOM';

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
  /** BLOCO 70: cliente ESPECIAL GB — no PDV os produtos com preco_especial_gb > 0
   *  entram nesse preço (normal = preços de hoje, nada muda). */
  clienteEspecialGb?: boolean;
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
  /** Bloco 29 (ROTA 2): modo do atendimento — define o estoque de casa da baixa e a margem real */
  modoNota?: ModoNota;
}

export interface Commission {
  id: string;
  saleId: string;
  vendedorId: string;
  valor: number;
  valorBase?: number;
  percentual?: number;
  /** Bloco 14: quanto desta comissão já foi paga ao vendedor (acerto FIFO) */
  valorPago?: number;
  status: 'DISPONIVEL' | 'A_RECEBER' | 'PAGO';
  dataGeracao: Date;
}

/** Bloco 14 — interruptores das melhorias (admin liga/desliga em Configurações) */
export interface MelhoriasFlags {
  /** Secretário ajusta as trocas do card antes da entrega */
  trocaSeparacao: boolean;
  /** Avisa o vendedor (push) quando a entrega dele é confirmada */
  pushEntrega: boolean;
  /** Botão Zap na fila para avisar o cliente que o pedido está a caminho */
  whatsapp: boolean;
  /** Bairro em destaque no card da fila */
  bairroCard: boolean;
  /** Foto opcional da entrega concluída no aceite */
  fotoEntrega: boolean;
  /** Avisa o vendedor (push) quando a entrega dele falha */
  pushFalha: boolean;
}

export const MELHORIAS_DEFAULT: MelhoriasFlags = {
  trocaSeparacao: true,
  pushEntrega: true,
  whatsapp: true,
  bairroCard: true,
  fotoEntrega: true,
  pushFalha: true,
};

export interface CommissionPaymentLog {
  id: string;
  vendedorId: string;
  vendedorNome: string;
  valorPago: number;
  valorRestante: number;
  tipo: 'TOTAL' | 'PARCIAL';
  dataPagamento: Date;
  adminId: string;
  /** Bloco 15: recibo do vendedor — undefined = SQL ainda nao rodou (trata como aceito) */
  aceitado?: boolean;
  aceiteEm?: Date;
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
  /** Bloco 23: ORDEM DO PORTAL — independente da ordem do PDV */
  catalogoOrder: string[];
  companyName: string | null;
  companyCnpj: string | null;
  /** Bloco 14: interruptores das melhorias */
  melhorias: MelhoriasFlags;
}