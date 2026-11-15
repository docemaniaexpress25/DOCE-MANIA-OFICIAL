import { getServiceClient } from '@/lib/serverSupabase';
import {
  hasNotaColumns,
  hasModoVendaColumn,
  hasEstoquesNotaColumns,
  hasEstoqueBaixadoColumn,
} from '@/lib/serverSchema';
import { arquivarNotaCancelada } from '@/lib/focusArquivos';

/**
 * BLOCO 147 — CASCATA DO CANCELAMENTO DA NOTA (regra do dono):
 *
 * "AS NOTAS CANCELADAS ESTAO SUMINDO DO PORTAL, ELAS DEVEM APARECER EM
 *  CANCELADAS! QUANDO CANCELAR UMA NOTA JUNTO DEVEREMOS CANCELAR O BOLETO!"
 *
 * O que esta lib faz (sempre DEPOIS que a SEFAZ confirmou o cancelamento):
 *  0) ARQUIVA a nota cancelada como AVULSA no Portal Fiscal (filtro
 *     CANCELADAS) — DANFE, XML e XML do cancelamento ficam no nosso Storage
 *     com cliente/valor/pagamento/vendedor da venda original. Era AQUI que a
 *     nota sumia: a venda era apagada e nada sobrevivia no portal.
 *  1) Devolve a reserva de estoque de CASA (estoque_baixado da pré-venda).
 *  2) Abate o contador de saída (estoque 1 COM NF / estoque 2 SEM NF).
 *  3) EXCLUI a venda (RPC excluir_venda_estornar_estoque devolve a carga da
 *     van, apaga comissões/comprovantes/eventos/itens e a venda; fallback
 *     manual com o mesmo contrato).
 *  4) Recalcula o total de paradas da rota de entrega.
 *
 * Falha de qualquer etapa NUNCA sobe exceção — vira mensagem na lista de
 * avisos para o admin resolver manualmente.
 */

export async function finalizarVendaCancelada(saleId: string): Promise<string[]> {
  const cascade: string[] = [];
  const db = getServiceClient();

  const [temNota, temModo, temEstoques, temBaixado] = await Promise.all([
    hasNotaColumns(),
    hasModoVendaColumn(),
    hasEstoquesNotaColumns(),
    hasEstoqueBaixadoColumn(),
  ]);

  // ----- dados da venda (uma leitura só) -----
  const sel = [
    'id, route_id, client_id, vendedor_id, valor_total, metodo_pagamento',
    temNota ? ', nota_tipo, nota_ref, nota_numero, nota_status' : '',
    temModo ? ', modo_nota' : '',
    temBaixado ? ', estoque_baixado' : '',
  ].join('');
  const { data: sX } = await db.from('sales').select(sel).eq('id', saleId).single();
  const sRow = ((sX as unknown) as Record<string, unknown>) || {};

  // ----- 0) ARQUIVA A NOTA CANCELADA NO PORTAL (CANCELADAS) -----
  const ref = String(sRow.nota_ref || '');
  const tipoNota = String(sRow.nota_tipo || '').toUpperCase();
  if (ref && (tipoNota === 'NFCE' || tipoNota === 'NFE')) {
    try {
      let clienteNome = '';
      let clienteDoc = '';
      if (String(sRow.client_id || '')) {
        const { data: cRow } = await db.from('clients')
          .select('nome_fantasia, nome, cnpj')
          .eq('id', String(sRow.client_id)).single();
        clienteNome = String(cRow?.nome_fantasia || cRow?.nome || '');
        clienteDoc = String(cRow?.cnpj || '');
      }
      let vendedorNome = '';
      if (String(sRow.vendedor_id || '')) {
        const { data: vRow } = await db.from('app_users')
          .select('nome')
          .eq('id', String(sRow.vendedor_id)).single();
        vendedorNome = String(vRow?.nome || '');
      }
      const rA = await arquivarNotaCancelada(
        tipoNota === 'NFCE' ? 'nfce' : 'nfe',
        ref,
        {
          numero: String(sRow.nota_numero || ''),
          valor: Number(sRow.valor_total) || 0,
          cliente: clienteNome,
          clienteDoc,
          pagamento: String(sRow.metodo_pagamento || ''),
          vendedor: vendedorNome,
        },
      );
      if (rA.ok) cascade.push('Nota cancelada arquivada no Portal Fiscal (filtro CANCELADAS)');
      else cascade.push(`Arquivamento da nota cancelada falhou (${rA.motivo || 'erro'}) — reimporte depois em Ações > Importar`);
    } catch (eA) {
      cascade.push(`Arquivamento da nota cancelada falhou (${(eA as Error).message}) — reimporte depois em Ações > Importar`);
    }
  }

  // ----- 1) reserva da PRÉ-VENDA → devolve ao ESTOQUE TOTAL de casa -----
  try {
    if (temBaixado && sRow.estoque_baixado === true) {
      await db.from('sales').update({ estoque_baixado: false }).eq('id', saleId);
      const { data: itensRes } = await db.from('sale_items').select('produto_id, quantidade').eq('sale_id', saleId);
      const devolve = new Map<string, number>();
      for (const it of ((itensRes || []) as unknown) as Record<string, unknown>[]) {
        const pid = String(it.produto_id || '');
        if (pid) devolve.set(pid, (devolve.get(pid) || 0) + (Number(it.quantidade) || 0));
      }
      const idsDev = [...devolve.keys()];
      if (idsDev.length > 0) {
        const { data: prodsDev } = await db.from('products').select('id, estoque_principal').in('id', idsDev);
        for (const p of ((prodsDev || []) as unknown) as Record<string, unknown>[]) {
          await db.from('products').update({
            estoque_principal: (Number(p.estoque_principal) || 0) + (devolve.get(String(p.id)) || 0),
          }).eq('id', String(p.id));
        }
        cascade.push('Estoque TOTAL (casa) reposto');
      }
    }
  } catch (e1) {
    cascade.push(`Estoque de casa não reposto (${(e1 as Error).message}) — revise manualmente`);
  }

  // ----- 2) abate o CONTADOR DE SAÍDA (estoque 1 COM NF / estoque 2 SEM NF) -----
  try {
    if (temEstoques) {
      const modoVenda = String(sRow.modo_nota || sRow.nota_tipo || '').toUpperCase();
      const colContador = modoVenda === 'CUPOM' ? 'estoque_semnf' : 'estoque_nota';
      const { data: itensRes } = await db.from('sale_items').select('produto_id, quantidade').eq('sale_id', saleId);
      const totais = new Map<string, number>();
      for (const it of ((itensRes || []) as unknown) as Record<string, unknown>[]) {
        const pid = String(it.produto_id || '');
        if (pid) totais.set(pid, (totais.get(pid) || 0) + (Number(it.quantidade) || 0));
      }
      const idsC = [...totais.keys()];
      if (idsC.length > 0) {
        const { data: prodsC } = await db.from('products').select(`id, ${colContador}`).in('id', idsC);
        for (const p of ((prodsC || []) as unknown) as Record<string, unknown>[]) {
          const q = totais.get(String(p.id)) || 0;
          if (q <= 0) continue;
          await db.from('products').update({
            [colContador]: Math.max(0, (Number(p[colContador]) || 0) - q),
          }).eq('id', String(p.id));
        }
        cascade.push('Contador de saídas (estoque 1/2) corrigido');
      }
    }
  } catch (e2) {
    cascade.push(`Contador de saídas não corrigido (${(e2 as Error).message})`);
  }

  // ----- 3) carga da VAN + exclusão (comissões, comprovantes, itens, venda) -----
  try {
    const rRpc = await db.rpc('excluir_venda_estornar_estoque', { p_sale_id: saleId });
    if (rRpc.error) {
      // fallback manual — mesmo contrato do RPC (padrão do projeto)
      const { data: itensRes } = await db.from('sale_items').select('produto_id, quantidade').eq('sale_id', saleId);
      const { data: sVend } = await db.from('sales').select('vendedor_id').eq('id', saleId).single();
      const vendedorId = String((sVend as Record<string, unknown>)?.vendedor_id || '');
      for (const it of ((itensRes || []) as unknown) as Record<string, unknown>[]) {
        const { data: cRow } = await db.from('cargas').select('quantidade')
          .eq('vendedor_id', vendedorId).eq('produto_id', String(it.produto_id)).maybeSingle();
        await db.from('cargas').update({ quantidade: (Number((cRow as Record<string, unknown>)?.quantidade) || 0) + (Number(it.quantidade) || 0) })
          .eq('vendedor_id', vendedorId).eq('produto_id', String(it.produto_id));
      }
      await db.from('commissions').delete().eq('sale_id', saleId);
      await db.from('payment_comprovantes').delete().eq('sale_id', saleId);
      await db.from('entrega_eventos').delete().eq('sale_id', saleId);
      await db.from('sale_items').delete().eq('sale_id', saleId);
      await db.from('sales').delete().eq('id', saleId);
    }
    cascade.push('Venda excluída do sistema — estoque devolvido (carga da van + casa)');
  } catch (e3) {
    cascade.push(`Exclusão da venda não concluída (${(e3 as Error).message}) — revise manualmente`);
  }

  // ----- 4) rota de entrega: recalcula o total de paradas (best-effort) -----
  const routeId = String(sRow.route_id || '');
  if (routeId) {
    try {
      const { count } = await db.from('sales').select('id', { count: 'exact', head: true }).eq('route_id', routeId);
      await db.from('entrega_rotas').update({ total_paradas: count || 0 }).eq('id', routeId);
    } catch { /* rota já pode ter sido removida */ }
  }

  return cascade;
}
