import type { SupabaseClient } from '@supabase/supabase-js';
import { salvarFotoSupabase } from '@/lib/fotoStorage';

/**
 * BLOCO 118 — LEDGER DO CAIXA (Fechamento de Caixa)
 * =================================================
 * Cada dinheiro/pix/deposito recebido vira UMA linha em caixa_pagamentos
 * (fechamento_id NULL = caixa aberto). Os pontos de entrada do app:
 *
 *   VENDA       -> PDV salva venda a vista (dinheiro/pix)           [client]
 *   ENTREGA     -> /api/pre-venda acao ENTREGUE (DINHEIRO/PIX/MISTO) [server]
 *   RECEBIMENTO -> receiveAccount: conta a receber paga (admin/ven.) [client]
 *   PORTAL      -> /api/comprovantes/revisar CONFIRMAR (pix portal)  [server]
 *
 * O admin fecha o caixa a qualquer instante: a API /api/caixa acao FECHAR
 * cria o snapshot em caixa_fechamentos_geral e "prende" os pagamentos abertos
 * (fechamento_id = id do fechamento). Log de pagamentos = rastreio total.
 */

export type CaixaMetodo = 'DINHEIRO' | 'PIX' | 'DEPOSITO';
export type CaixaOrigem = 'VENDA' | 'ENTREGA' | 'RECEBIMENTO' | 'PORTAL' | 'AJUSTE';

export interface PagamentoCaixaInput {
  origem: CaixaOrigem;
  metodo: CaixaMetodo;
  valor: number;
  saleId?: string | null;
  cliente?: string | null;
  vendedor?: string | null;
  /** dataURL -> vai ao Storage (bucket privado); caminho/base64 existente passa direto */
  comprovante?: string | null;
  detalhe?: string | null;
  usuarioId?: string | null;
  usuarioNome?: string | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Registra um pagamento recebido no ledger do caixa.
 * NUNCA lança — devolve { ok, id?, erro? } para o chamador decidir ignorar
 * (o caixa é best-effort em todos os fluxos: nunca trava venda/entrega).
 * Idempotente por venda: mesmo sale_id + metodo + valor ainda ABERTO no
 * caixa não duplica (proteção contra duplo clique/reenvio).
 */
export async function registrarPagamentoCaixa(
  supabase: SupabaseClient,
  p: PagamentoCaixaInput
): Promise<{ ok: boolean; id?: string; erro?: string }> {
  try {
    const metodo = String(p.metodo || '').toUpperCase();
    if (!['DINHEIRO', 'PIX', 'DEPOSITO'].includes(metodo)) {
      return { ok: false, erro: 'metodo invalido' };
    }
    const origem = String(p.origem || '').toUpperCase();
    if (!['VENDA', 'ENTREGA', 'RECEBIMENTO', 'PORTAL', 'AJUSTE'].includes(origem)) {
      return { ok: false, erro: 'origem invalida' };
    }
    const valor = round2(Number(p.valor || 0));
    if (!(valor > 0)) return { ok: false, erro: 'valor invalido' };

    // Idempotência: venda/método/valor já no caixa aberto -> não duplica
    if (p.saleId) {
      const { data: dup } = await supabase
        .from('caixa_pagamentos')
        .select('id')
        .eq('sale_id', p.saleId)
        .eq('metodo', metodo)
        .eq('valor', valor)
        .is('fechamento_id', null)
        .limit(1);
      if (dup && dup.length > 0) return { ok: true, id: String(dup[0].id) };
    }

    // Economia de banco: dataURL vai ao Storage (bucket 'fotos-pedidos',
    // pasta comprovantes) e a coluna guarda só o caminho. Falha do Storage
    // NÃO perde a foto: grava o base64 na coluna (padrão do app).
    let comprovante = p.comprovante || null;
    if (comprovante && comprovante.startsWith('data:image/')) {
      comprovante = (await salvarFotoSupabase(supabase, 'comprovantes', comprovante)) ?? comprovante;
    }

    const { data, error } = await supabase
      .from('caixa_pagamentos')
      .insert({
        origem,
        metodo,
        valor,
        sale_id: p.saleId ? String(p.saleId).slice(0, 64) : null,
        cliente: (p.cliente || '').slice(0, 120) || null,
        vendedor: (p.vendedor || '').slice(0, 120) || null,
        comprovante,
        detalhe: (p.detalhe || '').slice(0, 220) || null,
        usuario_id: p.usuarioId ? String(p.usuarioId).slice(0, 64) : null,
        usuario_nome: (p.usuarioNome || '').slice(0, 120) || null,
      })
      .select('id')
      .single();
    if (error) return { ok: false, erro: error.message };
    return { ok: true, id: String(data?.id || '') };
  } catch (e: any) {
    return { ok: false, erro: e?.message || 'erro caixa' };
  }
}
