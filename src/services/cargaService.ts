import { supabase } from '@/lib/supabaseClient';
import { Carga, CargaPendente } from '@/lib/types';

export const cargaService = {
  async getAllCargas(): Promise<Carga[]> {
    // EGRESS: colunas explicitas (a tabela cresce 1 linha por vendedor×produto)
    // BLOCO 29: modo_nota vem junto — undefined = SQL do bloco 29 ainda nao rodado
    let data: any[];
    let error: any;
    try {
      const r = await supabase.from('cargas').select('vendedor_id, produto_id, quantidade, modo_nota');
      data = r.data as any[]; error = r.error;
      if (error && /modo_nota/i.test(error.message || '')) {
        const r2 = await supabase.from('cargas').select('vendedor_id, produto_id, quantidade');
        data = (r2.data as any[]) || []; error = r2.error;
      }
    } catch (e) { throw e; }
    if (error) throw error;
    return (data || []).map(c => ({
      vendedorId: c.vendedor_id,
      produtoId: c.produto_id,
      quantidade: Number(c.quantidade),
      modoNota: c.modo_nota === undefined ? undefined : (c.modo_nota || null)
    })) as Carga[];
  },

  async applyCargaAdminRPC(vId: string, items: { produtoId: string, quantidade: number }[]): Promise<void> {
    // Normaliza chaves para minúsculas para compatibilidade com o RPC no Postgres
    const rpcItems = items.map(item => ({
      produtoid: item.produtoId,
      quantidade: item.quantidade
    }));

    const { error } = await supabase.rpc('apply_carga_admin', {
      p_vendedor_id: vId,
      p_itens: rpcItems
    });
    if (error) throw error;
  },

  async getAllCargasPendentes(vId?: string): Promise<CargaPendente[]> {
    // EGRESS: colunas explicitas. BLOCO 29: modo_nota tolerante (pre-SQL)
    let data: any[];
    let error: any;
    let query = supabase.from('cargas_pendentes').select('id, vendedor_id, itens, data_criacao, modo_nota').eq('status', 'PENDENTE');
    if (vId) query = query.eq('vendedor_id', vId);
    let res: any = await query;
    data = (res.data as any[]) || []; error = res.error;
    if (error && /modo_nota/i.test(error.message || '')) {
      let q2 = supabase.from('cargas_pendentes').select('id, vendedor_id, itens, data_criacao').eq('status', 'PENDENTE');
      if (vId) q2 = q2.eq('vendedor_id', vId);
      res = await q2;
      data = (res.data as any[]) || []; error = res.error;
    }
    if (error) throw error;

    return (data || []).map(cp => ({
      id: cp.id,
      vendedorId: cp.vendedor_id,
      data: new Date(cp.data_criacao),
      modoNota: cp.modo_nota === undefined ? undefined : (cp.modo_nota || null),
      // Mapeia de volta para o padrão da aplicação (produtoId)
      itens: (cp.itens || []).map((i: any) => ({
        produtoId: i.produtoid || i.produtoId,
        quantidade: i.quantidade
      }))
    })) as CargaPendente[];
  },

  async insertCargaPendente(cp: Omit<CargaPendente, 'id'>): Promise<void> {
    // Normaliza chaves para minúsculas antes de persistir o JSON
    const rpcItems = cp.itens.map(item => ({
      produtoid: item.produtoId,
      quantidade: item.quantidade
    }));

    const { error } = await supabase.from('cargas_pendentes').insert({
      vendedor_id: cp.vendedorId,
      itens: rpcItems,
      data_criacao: cp.data.toISOString(),
      status: 'PENDENTE',
      ...(cp.modoNota ? { modo_nota: cp.modoNota } : {})
    });
    if (error) {
      // BLOCO 29: fallback pre-SQL — coluna modo_nota ainda nao existe
      if (/modo_nota/i.test(error.message || '')) {
        const { error: e2 } = await supabase.from('cargas_pendentes').insert({
          vendedor_id: cp.vendedorId,
          itens: rpcItems,
          data_criacao: cp.data.toISOString(),
          status: 'PENDENTE'
        });
        if (e2) throw e2;
        return;
      }
      throw error;
    }
  },

  /**
   * BLOCO 29 (ROTA 2) — carga da van com MODO (COM_NF | SEM_NF), 1 ou outro.
   * Toda a logica roda no SERVIDOR (/api/cargas): bloqueio de mistura,
   * movimento de casa (estoque_nota/estoque_semnf) e substituicao da carga.
   * acao: 'APLICAR' (aplica agora) | 'PENDENTE' (vendedor aceita depois).
   */
  async aplicarCargaRota2(vendedorId: string, itens: { produtoId: string; quantidade: number }[], modo: 'COM_NF' | 'SEM_NF', acao: 'APLICAR' | 'PENDENTE'): Promise<{ ok: boolean; erro?: string; detalhe?: any }> {
    const { authHeaders } = await import('./userService');
    try {
      const res = await fetch('/api/cargas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ vendedorId, itens, modo, acao })
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, erro: d?.erro || d?.error || 'Erro ao gravar a carga.', detalhe: d?.detalhe };
      return { ok: true };
    } catch {
      return { ok: false, erro: 'Falha de conexao ao gravar a carga.' };
    }
  },

  async aceitarCargaRPC(pendenciaId: string): Promise<void> {
    const { error } = await supabase.rpc('aceitar_carga_vendedor', {
      p_carga_pendente_id: pendenciaId
    });
    if (error) throw error;
  }
};