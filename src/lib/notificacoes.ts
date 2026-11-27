import { getServiceClient } from '@/lib/serverSupabase';

/**
 * BLOCO 221 — AVISO DE BAIXA AOS ADMINS (pedido do dono: "gere um aviso, uma
 * mensagem! para que toda baixa a gente seja comunicado! no caso os admin do
 * sistema!").
 *
 * TODA baixa automática (webhook do Inter em tempo real, sync do cron,
 * auto-sync horário, consulta manual) grava uma linha na tabela
 * `notificacoes` (perfil_alvo='ADMIN'). O app do admin:
 *   - sincroniza o sino a cada 60 s (GET /api/notificacoes) e mostra o
 *     badge de NAO LIDAS em todas as abas;
 *   - abre o painel do sino com o historico (persistido no banco — o aviso
 *     sobrevive ao fechamento do app, diferente do realtime);
 *   - continua recebendo o ALERTA IMEDIATO com som/vibracao pelo realtime
 *     de `sales` que ja existia (UPDATE de valor_pago).
 *
 * Best-effort TOTAL: se o SQL 221 ainda nao rodou (tabela ausente), o aviso
 * e ignorado com warn e a BAIXA segue normal — automacao nunca trava por
 * causa de notificacao.
 */

type Db = ReturnType<typeof getServiceClient>;

export interface AvisoBaixa {
  saleId?: string | null;
  valor: number;
  origem: string;
  cliente?: string | null;
  /** Parcela N de M (boleto duplo rota 5) — ausente = boleto unico. */
  parcelaSeq?: number | null;
  parcelaTotal?: number | null;
  /** true = baixa parcial (parcela; venda segue aberta). */
  parcial?: boolean;
}

/** Rotulo curto da origem da baixa, para a mensagem do aviso. */
function rotuloOrigem(origem: string): string {
  switch (origem) {
    case 'WEBHOOK_INTER': return 'webhook do Inter (tempo real)';
    case 'CRON_INTER': return 'sync automatico (cron/auto)';
    case 'PIX_PORTAL': return 'comprovante Pix do portal';
    case 'MANUAL': return 'baixa manual';
    default: return origem;
  }
}

/** Nome do cliente da venda (nome_fantasia || nome || razao_social). */
export async function nomeClienteDaVenda(db: Db, clientId: unknown): Promise<string | null> {
  const id = String(clientId || '').trim();
  if (!id) return null;
  try {
    const { data } = await db.from('clients').select('nome_fantasia, nome, razao_social').eq('id', id).maybeSingle();
    const c = (data || {}) as Record<string, unknown>;
    const nome = String(c.nome_fantasia || c.nome || c.razao_social || '').trim();
    return nome || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BLOCO 226 — AVISOS DO AUTO-DESTRAVAMENTO E DO ÓRFÃO DO INTER.
//
// Caso Paradouro do Campo (26–27/11): o Inter ACEITA a emissão (POST devolve
// codigoSolicitacao) mas a cobrança fica EM_PROCESSAMENTO para sempre e o
// cancelamento é RECUSADO lá dentro ("se encontra na situação
// EM_PROCESSAMENTO"). O dono ficava sem boleto novo até um admin apertar
// DESTRAVAR na mão. Agora o sync AUTO-DESTRAVA (60+ min presos) e ainda cuida
// da COBRANÇA ÓRFÃ que fica viva no Inter (se ela processar um dia, o cliente
// poderia pagar um boleto que o sistema não conhece mais).
//
// Toda ação automática dessas grava um aviso para os ADMINs (mesmo canal do
// aviso de baixa: tabela notificacoes, perfil_alvo='ADMIN').
// ---------------------------------------------------------------------------

export interface AvisoAutoDestravado {
  saleId?: string | null;
  /** Boleto único quando ausente. */
  parcelaSeq?: number | null;
  parcelaTotal?: number | null;
  /** CodigoSolicitacao da cobrança presa (foi liberada/órfã). */
  codigo?: string | null;
  cliente?: string | null;
  /** true = o Inter ACEITOU cancelar a cobrança presa (órfão morto lá). */
  cancelouNoInter?: boolean;
  /** Minutos que ficou presa em EM_PROCESSAMENTO. */
  minutosPreso?: number;
}

/**
 * BLOCO 226: avisa os admins que um boleto preso em EM_PROCESSAMENTO foi
 * AUTO-DESTRAVADO pelo sync (o botão DESTRAVAR de agora em diante é rede de
 * segurança, não o caminho principal). Best-effort.
 */
export async function avisarBoletoAutoDestravado(db: Db, a: AvisoAutoDestravado): Promise<void> {
  const quem = a.cliente || 'Cliente';
  const parcelaTxt = a.parcelaSeq ? ` parcela ${a.parcelaSeq}/${a.parcelaTotal || 2} da venda` : ' venda';
  const min = Number(a.minutosPreso) > 0 ? ` há ${a.minutosPreso} min` : '';
  const destino = a.cancelouNoInter
    ? 'A cobrança presa foi CANCELADA no Inter (saiu do processamento). Nenhum risco de pagamento em duplicidade.'
    : 'A cobrança presa segue VIVA no Inter e foi registrada como ÓRFÃ — o sync vai cancelá-la automaticamente se ela sair do processamento (ninguém consegue pagá-la sem linha digitável, mas por garantia o sistema vigia).';
  const mensagem = `Emissão presa no Inter${min} sem processar (${quem},${parcelaTxt} ${String(a.saleId || '').slice(0, 8)}). Boleto LIBERADO automaticamente — toque GERAR no card para emitir um boleto novo. ${destino}`;
  try {
    const { error } = await db.from('notificacoes').insert({
      perfil_alvo: 'ADMIN',
      tipo: 'BOLETO_DESTRAVADO',
      titulo: 'Boleto travado liberado automaticamente (sync)',
      mensagem,
      sale_id: a.saleId ? String(a.saleId).slice(0, 64) : null,
      origem: 'SYNC_AUTO_DESTRAVA',
      valor: 0,
      lida: false,
    });
    if (error) console.warn('[notificacoes] aviso auto-destrava nao gravado:', error.message);
  } catch (err: unknown) {
    console.warn('[notificacoes] aviso auto-destrava nao gravado (SQL 221 rodado?):', (err as Error)?.message);
  }
}

export interface AvisoOrfao {
  /** codigoSolicitacao da cobrança órfã no Inter. */
  codigo: string;
  /** Situação atual lá (EM_PROCESSAMENTO, A_RECEBER, RECEBIDO...). */
  situacao: string;
  saleId?: string | null;
  cliente?: string | null;
  valor?: number | null;
  /** true = o Inter aceitou cancelar a órfã (fim da linha). */
  cancelada?: boolean;
  /** true = o cliente PAGOU a cobrança órfã — admin precisa agir. */
  paga?: boolean;
}

/**
 * BLOCO 226: avisa os admins sobre uma COBRANÇA ÓRFÃ no Inter (emitida pelo
 * app e depois liberada localmente enquanto ela continuou viva lá). O caso
 * grave é PAGA: o cliente pagou um boleto que o sistema não conhece — precisa
 * de ação humana (combinar com o cliente / pedir baixa no suporte do Inter).
 */
export async function avisarBoletoOrfao(db: Db, a: AvisoOrfao): Promise<void> {
  const situacaoTxt = a.paga
    ? 'PAGA pelo cliente'
    : a.cancelada
      ? 'cancelada no Inter'
      : `situação ${a.situacao}`;
  const valorTxt = a.valor ? ` R$ ${Number(a.valor).toFixed(2)}` : '';
  const acao = a.paga
    ? 'AÇÃO URGENTE: combinar com o cliente ou pedir a baixa no suporte do Inter — a venda não tem essa cobrança mais.'
    : a.cancelada
      ? 'Nada a fazer — o sistema cancelou a cobrança sobrando lá dentro.'
      : 'O sync segue vigiando: se ela sair do processamento, será cancelada automaticamente (o cliente não tem linha digitável para pagá-la).';
  const mensagem = `Cobrança órfã do Inter ${a.codigo.slice(0, 36)} ${situacaoTxt}${valorTxt}${a.saleId ? ` (venda ${String(a.saleId).slice(0, 8)}` : ''}${a.saleId ? ')' : ''}${a.cliente ? ` — ${a.cliente}` : ''}. ${acao}`;
  try {
    const { error } = await db.from('notificacoes').insert({
      perfil_alvo: 'ADMIN',
      tipo: 'BOLETO_ORFAO',
      titulo: a.paga ? 'URGENTE: cliente pagou cobrança órfã do Inter' : 'Cobrança órfã do Inter em vigilância',
      mensagem,
      sale_id: a.saleId ? String(a.saleId).slice(0, 64) : null,
      origem: 'ORFAO_INTER',
      valor: Number(a.valor) || 0,
      lida: false,
    });
    if (error) console.warn('[notificacoes] aviso órfão nao gravado:', error.message);
  } catch (err: unknown) {
    console.warn('[notificacoes] aviso órfão nao gravado (SQL 221 rodado?):', (err as Error)?.message);
  }
}

/**
 * Grava o AVISO da baixa na tabela notificacoes (best-effort). Chamado pelo
 * webhook do Inter (boleto unico), pelo core do sync e pela baixa de parcela.
 */
export async function avisarBaixaBoleto(db: Db, aviso: AvisoBaixa): Promise<void> {
  const valorTxt = 'R$ ' + (Number(aviso.valor) || 0).toFixed(2);
  const via = rotuloOrigem(aviso.origem);
  const quem = aviso.cliente || 'Cliente sem cadastro';
  const titulo = aviso.parcial
    ? `Parcela ${aviso.parcelaSeq}/${aviso.parcelaTotal || 2} paga — baixa automatica`
    : 'Boleto pago — baixa automatica';
  const mensagem = aviso.parcial
    ? `${quem} pagou a parcela ${aviso.parcelaSeq}/${aviso.parcelaTotal || 2} — ${valorTxt} recebido via ${via}.`
    : `${quem} pagou o boleto — ${valorTxt} recebido via ${via}. Conta saiu de "Contas a Receber" e entrou no caixa.`;

  try {
    const { error } = await db.from('notificacoes').insert({
      perfil_alvo: 'ADMIN',
      tipo: 'BAIXA_BOLETO',
      titulo,
      mensagem,
      sale_id: aviso.saleId ? String(aviso.saleId).slice(0, 64) : null,
      origem: aviso.origem,
      valor: Number(aviso.valor) || 0,
      lida: false,
    });
    if (error) console.warn('[notificacoes] aviso nao gravado:', error.message);
  } catch (err: unknown) {
    // SQL 221 pendente (tabela nao existe) — a baixa segue, aviso cai fora.
    console.warn('[notificacoes] aviso nao gravado (SQL 221 rodado?):', (err as Error)?.message);
  }
}
