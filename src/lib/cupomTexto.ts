import { Sale, Client, Product } from '@/lib/types';

/**
 * BLOCO 13: gerador de cupom COMPARTILHADO.
 * O texto e 100% identico em qualquer tela (vendedor, secretario, entregador,
 * admin) — a regra e "cupom unico": quem imprime, imprime sempre o mesmo.
 *
 * Baseado no gerador original do Cupom.tsx (56mm/80mm), com as novidades
 * do fluxo de pre-venda:
 *  - TROCAS anotadas pelo vendedor imprimem depois dos itens
 *  - Pedido de pre-venda imprime a forma de pagamento combinada
 */

export interface CupomTextoInput {
  sale: Pick<Sale, 'valorTotal' | 'metodoPagamento' | 'detalhePagamento' | 'statusPagamento' | 'dataVencimento' | 'itens' | 'data' | 'trocas' | 'tipoVenda' | 'entregaStatus'> & Partial<Sale>;
  client: Pick<Client, 'nomeFantasia' | 'telefone'> & Partial<Client>;
  products: Pick<Product, 'id' | 'nome'>[];
  width: '56MM' | '80MM';
}

const FORMA_LABEL: Record<string, string> = {
  DINHEIRO: 'DINHEIRO',
  PIX: 'PIX',
  BOLETO: 'BOLETO',
  A_PRAZO: 'A PRAZO',
};

/** Forma combinada para o pedido de pre-venda ("cobrar X na entrega") */
export function formaCobrancaDeSale(s: { metodoPagamento?: string; detalhePagamento?: string }): string {
  const det = String(s.detalhePagamento || '');
  const m = det.match(/cobrar\s+(DINHEIRO|PIX|BOLETO)/i);
  if (m) return m[1].toUpperCase();
  const mp = String(s.metodoPagamento || '').toUpperCase();
  if (FORMA_LABEL[mp]) return FORMA_LABEL[mp];
  return 'DINHEIRO';
}

export function gerarCupomTexto({ sale, client, products, width }: CupomTextoInput): string {
  const totalWidth = width === '80MM' ? 48 : 32;

  const padR = (str: string, len: number) => str.substring(0, len).padEnd(len);
  const padL = (str: string, len: number) => str.substring(0, len).padStart(len);
  const center = (str: string, len: number) => {
    const s = str.substring(0, len);
    const spaces = Math.max(0, Math.floor((len - s.length) / 2));
    return ' '.repeat(spaces) + s;
  };

  let t = '';

  t += '*'.repeat(totalWidth) + '\n';
  t += center('CUPOM NAO FISCAL', totalWidth) + '\n';
  t += '*'.repeat(totalWidth) + '\n';

  const clientName = client.nomeFantasia || 'Consumidor';
  t += `Cliente: ${clientName}\n`;
  t += `Data: ${new Date(sale.data).toLocaleDateString()} ${new Date(sale.data).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
  t += '-'.repeat(totalWidth) + '\n';

  const qtyW = 4;
  const valW = width === '80MM' ? 13 : 8;
  const descW = totalWidth - qtyW - valW;

  t += padR('DESCRICAO', descW) + padL('QTD', qtyW) + padL('VALOR', valW) + '\n';
  t += '-'.repeat(totalWidth) + '\n';

  (sale.itens || []).forEach(item => {
    const p = products.find(prod => prod.id === item.produtoId);
    const productName = (p?.nome ?? 'Produto');

    const qtyStr = `${item.quantidade}x`;
    const valStr = `${(item.quantidade * item.precoVenda).toFixed(2)}`;

    t += padR(productName.substring(0, descW), descW) + padL(qtyStr, qtyW) + padL(valStr, valW) + '\n';

    let remaining = productName.substring(descW);
    while (remaining.length > 0) {
      t += padR(remaining.substring(0, totalWidth), totalWidth) + '\n';
      remaining = remaining.substring(totalWidth);
    }
  });

  // BLOCO 13: trocas anotadas pelo vendedor (ex.: "1 Lays sour cream 62g")
  const trocas = String((sale as any).trocas || '').trim();
  if (trocas) {
    t += '-'.repeat(totalWidth) + '\n';
    t += 'TROCAS:\n';
    const linhas = trocas.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
    if (linhas.length === 0) {
      let rest = `1x ${trocas}`;
      while (rest.length > 0) {
        t += padR(rest.substring(0, descW), descW) + '\n';
        rest = rest.substring(descW);
      }
    } else {
      for (const linha of linhas) {
        let rest = linha;
        while (rest.length > 0) {
          t += padR(rest.substring(0, descW), descW) + '\n';
          rest = rest.substring(descW);
        }
      }
    }
  }

  t += '-'.repeat(totalWidth) + '\n';

  const totalLabel = 'TOTAL GERAL:';
  const totalVal = `R$ ${(sale.valorTotal || 0).toFixed(2)}`;
  t += padR(totalLabel, totalWidth - totalVal.length) + totalVal + '\n';

  // Pre-venda: imprime a forma combinada de cobranca na entrega
  const isPedido = sale.tipoVenda === 'PRE_VENDA' && sale.entregaStatus !== 'ENTREGUE';
  if (isPedido) {
    const forma = formaCobrancaDeSale({ metodoPagamento: sale.metodoPagamento as string, detalhePagamento: sale.detalhePagamento });
    const prazo = /A PRAZO/i.test(String(sale.detalhePagamento || ''));
    t += `Pagamento na entrega: ${forma}${prazo ? ' (A PRAZO)' : ' (A VISTA)'}\n`;
    if (sale.dataVencimento && prazo) {
      t += `Vencimento: ${new Date(sale.dataVencimento).toLocaleDateString()}\n`;
    }
  } else {
    t += `Metodo: ${FORMA_LABEL[String(sale.metodoPagamento)] || sale.metodoPagamento}\n`;

    if (sale.detalhePagamento) {
      t += `Info: ${sale.detalhePagamento}\n`;
    }

    if (sale.statusPagamento === 'PENDENTE' && sale.dataVencimento) {
      t += `Vencimento: ${new Date(sale.dataVencimento).toLocaleDateString()}\n`;
    }
  }

  t += '-'.repeat(totalWidth) + '\n';
  t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
  t += '*'.repeat(totalWidth) + '\n';
  t += '\n\n\n\n\n';

  return t;
}
