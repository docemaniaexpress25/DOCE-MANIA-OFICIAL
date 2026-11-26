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
