import { getServiceClient } from '@/lib/serverSupabase';

/**
 * Sondas de schema em transicao (Bloco 5 — pre-venda).
 *
 * O codigo ja foi publicado para a Vercel, mas o SQL do Bloco 5 roda no
 * Supabase em um momento DEPOIS do deploy. Enquanto isso, colunas/tabelas
 * novas (app_users.pre_venda, sales.tipo_venda, entrega_rotas...) nao
 * existem e qualquer SELECT citando-as quebra ROTAS CRITICAS
 * (/api/users e /api/login -> lista de vendedores some do login e das cargas).
 *
 * Estrategia: sonda rapida (limit 1) com cache curto de 30s por instancia.
 * - Coluna ausente -> rotas montam queries SEM a coluna (flag preVenda=false).
 * - Depois que o Bloco 5 roda, a sonda se autocorrige em ate 30s.
 */
const TTL_MS = 30_000;

type Probe = { ok: boolean; at: number };
// BLOCO 217: sondas estoquesNota/modoCarga/pendenteModo REMOVIDAS junto com a
// regra de ESTOQUE 1/ESTOQUE 2 (colunas dropadas no Supabase).
const probes: Record<string, Probe | null> = { preVenda: null, entrega: null, foto: null, nota: null, fiscalProduto: null, rota2: null, modoVenda: null, produtoTeste: null, notaEmitidaEm: null, precoCupom: null, clientModoCupom: null, erpConfig: null, codigoGb: null, clientGb: null, notasOrdem: null, boletoCpf: null };

async function probeColumn(table: string, column: string, key: string): Promise<boolean> {
  const now = Date.now();
  const cached = probes[key];
  if (cached && now - cached.at < TTL_MS) return cached.ok;
  try {
    const { error } = await getServiceClient().from(table).select(column).limit(1);
    const ok = !error;
    probes[key] = { ok, at: now };
    return ok;
  } catch {
    // Falha transitoria (rede/timeout): nao cacheia, tenta de novo na proxima.
    return cached?.ok ?? false;
  }
}

/** app_users.pre_venda existe? (Bloco 5 aplicado) */
export function hasPreVendaColumn(): Promise<boolean> {
  return probeColumn('app_users', 'pre_venda', 'preVenda');
}

/** sales.tipo_venda / entrega_rotas existem? (Bloco 5 aplicado) */
export function hasEntregaTables(): Promise<boolean> {
  return probeColumn('sales', 'tipo_venda', 'entrega');
}

/** entrega_eventos.foto existe? (Bloco 6 aplicado — foto do boleto entregue) */
export function hasBoletoFotoColumn(): Promise<boolean> {
  return probeColumn('entrega_eventos', 'foto', 'foto');
}

/** sales.nota_status existe? (Bloco 10 aplicado — notas fiscais NFe/NFCe) */
export function hasNotaColumns(): Promise<boolean> {
  return probeColumn('sales', 'nota_status', 'nota');
}

/** products.ncm existe? (Bloco 10 aplicado — codigos fiscais por produto) */
export function hasProductFiscalColumns(): Promise<boolean> {
  return probeColumn('products', 'ncm', 'fiscalProduto');
}

/** sales.inter_boleto_status existe? (Bloco 25 aplicado — boleto bancario Inter) */
export function hasBoletoColumns(): Promise<boolean> {
  return probeColumn('sales', 'inter_boleto_status', 'boletoInter');
}

/** app_users.rota2 existe? (Bloco 27 aplicado — wizard de venda do teste ROTA 2) */
export function hasRota2Column(): Promise<boolean> {
  return probeColumn('app_users', 'rota2', 'rota2');
}

/** products.produto_teste existe? (Bloco 29 — produtos de teste so na rota 2) */
export function hasProdutoTesteColumn(): Promise<boolean> {
  return probeColumn('products', 'produto_teste', 'produtoTeste');
}

/** sales.modo_nota existe? (Bloco 29 — modo do atendimento: NFE | NFCE | CUPOM) */
export function hasModoVendaColumn(): Promise<boolean> {
  return probeColumn('sales', 'modo_nota', 'modoVenda');
}

/** sales.carga_confirmada_em existe? (Bloco 58 — check do admin: pedido carregado no veiculo) */
export function hasCargaCheckColumns(): Promise<boolean> {
  return probeColumn('sales', 'carga_confirmada_em', 'cargaCheck');
}

/** sales.nota_emitida_em existe? (Bloco 108 — carimbo de quando a nota saiu) */
export function hasNotaEmitidaEm(): Promise<boolean> {
  return probeColumn('sales', 'nota_emitida_em', 'notaEmitidaEm');
}

/** sales.estoque_baixado existe? (Bloco 88 — reserva de estoque na pre-venda) */
export function hasEstoqueBaixadoColumn(): Promise<boolean> {
  return probeColumn('sales', 'estoque_baixado', 'estoqueBaixado');
}

/** products.preco_cupom existe? (Bloco 108 — modo cupom: NFC anonima com preco da caixa) */
export function hasPrecoCupom(): Promise<boolean> {
  return probeColumn('products', 'preco_cupom', 'precoCupom');
}

/** products.codigo existe? (BLOCO 145 — codigo INTERNO do produto, o que aparece na NF) */
export function hasProductCodigoColumn(): Promise<boolean> {
  return probeColumn('products', 'codigo', 'codigoProduto');
}

/** clients.modo_cupom existe? (Bloco 108 — cliente que quer somente cupom) */
export function hasClientModoCupom(): Promise<boolean> {
  return probeColumn('clients', 'modo_cupom', 'clientModoCupom');
}

/** products.codigo_especial_gb existe? (BLOCO 157 — código que sobe na NF do cliente ESPECIAL GB) */
export function hasProductCodigoGbColumn(): Promise<boolean> {
  return probeColumn('products', 'codigo_especial_gb', 'codigoGb');
}

/** clients.cliente_especial_gb existe? (BLOCO 70 aplicado — cliente ESPECIAL GB) */
export function hasClientEspecialGbColumn(): Promise<boolean> {
  return probeColumn('clients', 'cliente_especial_gb', 'clientGb');
}

/** app_settings.erp_config existe? (Bloco 108 — central de automacoes ERP) */
export function hasErpConfig(): Promise<boolean> {
  return probeColumn('app_settings', 'erp_config', 'erpConfig');
}

/** estoque_movimentos existe? (Bloco 108 — kardex) */
export function hasKardexTable(): Promise<boolean> {
  return probeColumn('estoque_movimentos', 'id', 'kardex');
}

/** xml_itens.cest existe? (Bloco 95.1 — CEST da nota de compra) */
export function hasXmlCestColumn(): Promise<boolean> {
  return probeColumn('xml_itens', 'cest', 'xmlCest');
}

/** xml_itens.entrada_estoque_em existe? (Bloco 95.1 — trava de entrada duplicada) */
export function hasXmlEntradaColumn(): Promise<boolean> {
  return probeColumn('xml_itens', 'entrada_estoque_em', 'xmlEntrada');
}

/** app_settings.notas_ordem existe? (Bloco 184 — ordem MANUAL das notas no portal, kanban) */
export function hasNotasOrdem(): Promise<boolean> {
  return probeColumn('app_settings', 'notas_ordem', 'notasOrdem');
}

/** xml_importacoes.direcao existe? (Bloco 193 — ENTRADA de fornecedor x SAÍDA de terceiros) */
export function hasXmlDirecaoColumn(): Promise<boolean> {
  return probeColumn('xml_importacoes', 'direcao', 'xmlDirecao');
}

/** custos_empresa existe? (Bloco 191 — Portal Financeiro, custos lançados pelo admin) */
export function hasCustosEmpresaTable(): Promise<boolean> {
  return probeColumn('custos_empresa', 'id', 'custosEmpresa');
}

/** sales.boleto_cpf existe? (Bloco 187 — CPF/CNPJ do pagador capturado na venda a prazo) */
export function hasBoletoCpfColumn(): Promise<boolean> {
  return probeColumn('sales', 'boleto_cpf', 'boletoCpf');
}

/** sales_boletos existe? (Bloco 199 — BOLETO DUPLICO do Deivid/R5: parcelas de boleto por venda) */
export function hasSalesBoletosTable(): Promise<boolean> {
  return probeColumn('sales_boletos', 'id', 'salesBoletos');
}

/** cargas_fiscal existe? (Bloco 215 — remessa 5949 da carga + devolução 1949 automática) */
export function hasCargasFiscalTable(): Promise<boolean> {
  return probeColumn('cargas_fiscal', 'id', 'cargasFiscal');
}
