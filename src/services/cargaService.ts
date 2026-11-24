import { supabase } from '@/lib/supabaseClient';
import { Carga, CargaPendente } from '@/lib/types';

export const cargaService = {
  async getAllCargas(): Promise<Carga[]> {
    // EGRESS: colunas explicitas (a tabela cresce 1 linha por vendedor×produto)
    // BLOCO 217: modo_nota saiu junto com a regra de ESTOQUE 1/2 (a van é uma só).
    const { data, error } = await supabase.from('cargas').select('vendedor_id, produto_id, quantidade');
    if (error) throw error;
    return (data || []).map(c => ({
      vendedorId: c.vendedor_id,
      produtoId: c.produto_id,
      quantidade: Number(c.quantidade)
    })) as Carga[];
  },

  // BLOCO 217: applyCargaAdminRPC/insertCargaPendente (caminhos client-side
  // antigos) REMOVIDOS — toda carga da van passa pelo servidor (/api/cargas).

  async getAllCargasPendentes(vId?: string): Promise<CargaPendente[]> {
    // EGRESS: colunas explicitas. BLOCO 217: modo_nota saiu (regra ESTOQUE 1/2 removida)
    let query = supabase.from('cargas_pendentes').select('id, vendedor_id, itens, data_criacao').eq('status', 'PENDENTE');
    if (vId) query = query.eq('vendedor_id', vId);
    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(cp => ({
      id: cp.id,
      vendedorId: cp.vendedor_id,
      data: new Date(cp.data_criacao),
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
      status: 'PENDENTE'
    });
    if (error) throw error;
  },

  /**
   * BLOCO 217 — carga da van pelo SERVIDOR (/api/cargas), SEM modo (a regra
   * COM_NF/SEM_NF do estoque 1/2 foi removida). Toda a lógica roda no
   * servidor: movimento da CASA (estoque central) e substituição da carga.
   * acao: 'APLICAR' (aplica agora) | 'PENDENTE' (vendedor aceita depois).
   */
  async aplicarCarga(vendedorId: string, itens: { produtoId: string; quantidade: number }[], acao: 'APLICAR' | 'PENDENTE'): Promise<{ ok: boolean; erro?: string; detalhe?: any }> {
    const { authHeaders } = await import('./userService');
    try {
      const res = await fetch('/api/cargas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ vendedorId, itens, acao })
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