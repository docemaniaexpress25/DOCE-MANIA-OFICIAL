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
  const m = det.match(/cobrar\s+(DINHEIRO|PIX|BOLETO|CHEQUE)/i);
  if (m) return m[1].toUpperCase();
  const mp = String(s.metodoPagamento || '').toUpperCase();
  if (FORMA_LABEL[mp]) return FORMA_LABEL[mp];
  return 'DINHEIRO';
}

/**
 * BLOCO 37 (regra do dono): tipo de documento do atendimento — impresso
 * DESTACADO na parte de baixo do cupom. Fontes, em ordem:
 *  1. sales.modo_nota ('NFE' | 'NFCE' | 'CUPOM' — fluxo Rota 2)
 *  2. detalhePagamento "COM NOTA: NF-e" / "COM NOTA: NFC-e" (legado)
 *  3. sem sinal = CUPOM (fluxo antigo / nao fiscal)
 */
export type TipoDocumento = 'CUPOM' | 'NF-e' | 'NFC-e';

export function tipoDocumentoDeSale(s: { modoNota?: string | null; detalhePagamento?: string }): TipoDocumento {
  const modo = String((s as any).modoNota || '').toUpperCase();
  if (modo === 'NFE') return 'NF-e';
  if (modo === 'NFCE') return 'NFC-e';
  const det = String(s.detalhePagamento || '');
  if (/COM NOTA:\s*NF-e/i.test(det)) return 'NF-e';
  if (/COM NOTA:\s*NFC-e/i.test(det)) return 'NFC-e';
  return 'CUPOM';
}

/**
 * BLOCO 37 (regra do dono): forma de pagamento CONSOLIDADA entre todas as
 * opcoes — DINHEIRO, PIX, MISTO (Dinheiro+Pix), BOLETO, CHEQUE e PIX NA
 * DATA — com a condicao (A VISTA / A PRAZO). Destacada na parte de baixo.
 */
export function formaPagamentoDeSale(s: { metodoPagamento?: string; detalhePagamento?: string; statusPagamento?: string; tipoVenda?: string; entregaStatus?: string }): { forma: string; condicao: 'A VISTA' | 'A PRAZO' } {
  const det = String(s.detalhePagamento || '');
  const detU = det.toUpperCase();
  const mp = String(s.metodoPagamento || '').toUpperCase();
  const isPedido = s.tipoVenda === 'PRE_VENDA' && s.entregaStatus !== 'ENTREGUE';

  // ---- Pre-venda pendente: "PRE-VENDA — cobrar X na entrega (A PRAZO)" ----
  if (isPedido) {
    const m = detU.match(/COBRAR\s+(DINHEIRO|PIX|BOLETO|CHEQUE)\s+NA ENTREGA/);
    const forma = m ? m[1] : formaCobrancaDeSale(s);
    const condicao: 'A VISTA' | 'A PRAZO' = detU.includes('A PRAZO') ? 'A PRAZO' : 'A VISTA';
    return { forma: FORMA_LABEL[forma] || forma, condicao };
  }

  // ---- Pronta entrega / pre-venda entregue ----
  // A prazo grava o instrumento no detalhe (wizard): Boleto | Cheque nº X
  // (bom para dd/mm/yyyy) | Pix na data
  if (mp === 'A_PRAZO') {
    let forma = 'BOLETO';
    if (detU.includes('CHEQUE')) forma = 'CHEQUE';
    else if (detU.includes('PIX NA DATA')) forma = 'PIX NA DATA';
    return { forma, condicao: 'A PRAZO' };
  }

  // A vista PIX (detalhe = nome da chave pix)
  if (mp === 'PIX') return { forma: 'PIX', condicao: 'A VISTA' };

  // A vista DINHEIRO — MISTO grava como DINHEIRO com detalhe explícito
  if (mp === 'DINHEIRO') {
    if (detU.includes('MISTO')) return { forma: 'DINHEIRO + PIX', condicao: 'A VISTA' };
    return { forma: 'DINHEIRO', condicao: 'A VISTA' };
  }

  // Fallback legado (formas antigas / vendas sem metodo conhecido)
  const forma = FORMA_LABEL[mp] || (mp || 'DINHEIRO');
  const condicao: 'A VISTA' | 'A PRAZO' = s.statusPagamento === 'PENDENTE' ? 'A PRAZO' : 'A VISTA';
  return { forma, condicao };
}

export function gerarCupomTexto({ sale, client, products, width }: CupomTextoInput): string {
  const totalWidth = width === '80MM' ? 48 : 32;

  // BLOCO 40: datas do cupom em America/Sao_Paulo — o cupom e UNICO (mesmo
  // texto em qualquer aparelho); em TZ diferente (servidor/UTC) o vencimento
  // e os DIAS do prazo saiam com +1 dia.
  const fmtDia = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const diaSP = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

  const padR = (str: string, len: number) => str.substring(0, len).padEnd(len);
  const padL = (str: string, len: number) => str.substring(0, len).padStart(len);
  const center = (str: string, len: number) => {
    const s = str.substring(0, len);
    const spaces = Math.max(0, Math.floor((len - s.length) / 2));
    return ' '.repeat(spaces) + s;
  };

  let t = '';

  // BLOCO 37: quebra textos longos em linhas da largura do papel (nunca
  // estoura a coluna — impressora 56mm cortaria o que vier depois).
  const quebra = (txt: string) => {
    let rest = txt;
    while (rest.length > 0) {
      t += padR(rest.substring(0, totalWidth), totalWidth) + '\n';
      rest = rest.substring(totalWidth);
    }
  };

  t += '*'.repeat(totalWidth) + '\n';
  t += center('CUPOM NAO FISCAL', totalWidth) + '\n';
  t += '*'.repeat(totalWidth) + '\n';

  const clientName = client.nomeFantasia || 'Consumidor';
  t += `Cliente: ${clientName}\n`;
  t += `Data: ${fmtDia(sale.data)} ${new Date(sale.data).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}\n`;
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
  // BLOCO 41: OBSERVACAO do pedido — o vendedor anota no PDV (switch "Obs.")
  // e ela grava como linha "OBS: ..." na coluna trocas (mesmo padrao do
  // portal). O cupom separa: linhas "OBS:" imprimem no bloco OBSERVACAO e o
  // resto continua no bloco TROCAS (pedidos antigos ficam iguais).
  const rawAnot = String((sale as any).trocas || '').trim();
  const linhasTrocas: string[] = [];
  const linhasObs: string[] = [];
  rawAnot.split(/[\n;]+/).map(s => s.trim()).filter(Boolean).forEach(l => {
    const semPrefixo = l.replace(/^obs[:\-]\s*/i, '');
    // BLOCO 45 (regra do dono): linha SEM letra/numero (ex. "-", "—", "...")
    // nao imprime bloco nenhum — o cupom nao mostra TROCAS/OBSERVACAO vazio.
    if (!/[a-z0-9]/i.test(semPrefixo)) return;
    if (/^obs[:\-]/i.test(l)) linhasObs.push(semPrefixo);
    else linhasTrocas.push(l);
  });
  // Campo proprio de observacoes (futuro/legado) tambem imprime como observacao
  const obsDireta = String((sale as any).observacoes || '').trim();
  if (obsDireta) linhasObs.unshift(obsDireta);

  if (linhasTrocas.length > 0) {
    t += '-'.repeat(totalWidth) + '\n';
    t += 'TROCAS:\n';
    for (const linha of linhasTrocas) {
      let rest = linha;
      while (rest.length > 0) {
        t += padR(rest.substring(0, descW), descW) + '\n';
        rest = rest.substring(descW);
      }
    }
  }

  if (linhasObs.length > 0) {
    t += '-'.repeat(totalWidth) + '\n';
    t += 'OBSERVACAO:\n';
    for (const linha of linhasObs) {
      let rest = linha;
      while (rest.length > 0) {
        t += padR(rest.substring(0, totalWidth), totalWidth) + '\n';
        rest = rest.substring(totalWidth);
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
    // BLOCO 13.3: em 56mm (32 colunas) "Pagamento na entrega: DINHEIRO (A PRAZO)"
    // estoura a linha. A forma vai completa na linha de baixo (nunca quebra no meio).
    const pgLabel = 'Pagamento na entrega:';
    const pgValor = `${forma}${prazo ? ' (A PRAZO)' : ' (A VISTA)'}`;
    if ((pgLabel + ' ' + pgValor).length <= totalWidth) {
      t += `${pgLabel} ${pgValor}\n`;
    } else {
      t += pgLabel + '\n';
      let restPg = pgValor;
      while (restPg.length > 0) {
        t += padR(restPg.substring(0, totalWidth), totalWidth) + '\n';
        restPg = restPg.substring(totalWidth);
      }
    }
    if (sale.dataVencimento && prazo) {
      t += `Vencimento: ${fmtDia(sale.dataVencimento)}\n`;
    }
  } else {
    t += `Metodo: ${FORMA_LABEL[String(sale.metodoPagamento)] || sale.metodoPagamento}\n`;

    if (sale.detalhePagamento) {
      quebra(`Info: ${sale.detalhePagamento}`);
    }

    if (sale.statusPagamento === 'PENDENTE' && sale.dataVencimento) {
      t += `Vencimento: ${fmtDia(sale.dataVencimento)}\n`;
    }
  }

  // BLOCO 38 (regra do dono): a parte de baixo do cupom e a BASE DA
  // SEPARACAO dos itens — imprime SOMENTE:
  //  - o tipo do documento destacado (CUPOM / NF-e / NFC-e);
  //  - NF-e: o CNPJ do cliente ("NF-e: 12.345.678/0001-99");
  //  - NFC-e: o CPF se identificado na nota ("CPF: ...");
  //  - a forma de pagamento entre todas as opcoes + quantos dias (a prazo).
  // NAO imprime nome, endereco nem WhatsApp nessa parte (o nome ja aparece
  // no topo do cupom; quem separa nao precisa do resto).
  const tipoDoc = tipoDocumentoDeSale(sale as any);
  const { forma: formaPg, condicao: condicaoPg } = formaPagamentoDeSale(sale as any);

  t += '='.repeat(totalWidth) + '\n';
  t += center(`>>> ${tipoDoc} <<<`, totalWidth) + '\n';

  // Documento fiscal do cliente — so no documento que vai ter nota
  if (tipoDoc === 'NF-e') {
    const cnpjDigits = String((client as any).cnpj || '').replace(/\D/g, '');
    if (cnpjDigits.length === 14) {
      const cnpjFmt = `${cnpjDigits.slice(0, 2)}.${cnpjDigits.slice(2, 5)}.${cnpjDigits.slice(5, 8)}/${cnpjDigits.slice(8, 12)}-${cnpjDigits.slice(12)}`;
      t += center(`NF-e: ${cnpjFmt}`, totalWidth) + '\n';
    }
  } else if (tipoDoc === 'NFC-e') {
    // CPF identificado na NFC-e — gravado no detalhePagamento ("COM NOTA: NFC-e (CPF ...)")
    let cpfNaNota = (String(sale.detalhePagamento || '').match(/CPF\s*([\d.\-\/]+)/) || [])[1] || '';
    // BLOCO 52: o CPF pode chegar sem pontuação (payload do wizard grava só
    // digitos) — imprime mascarado 000.000.000-00 (legivel e fiscal)
    const soDig = cpfNaNota.replace(/\D/g, '');
    if (soDig.length === 11 && cpfNaNota.length !== 14) {
      cpfNaNota = `${soDig.slice(0, 3)}.${soDig.slice(3, 6)}.${soDig.slice(6, 9)}-${soDig.slice(9)}`;
    }
    if (cpfNaNota) t += center(`CPF: ${cpfNaNota}`, totalWidth) + '\n';
  }

  // BLOCO 46 (regra do dono): E-MAIL do cliente abaixo dos dados da nota
  // (ex.: logo abaixo do CNPJ na NF-e) — facilita o envio do XML. So imprime
  // quando o cadastro tem e-mail.
  const emailFmt = String((client as any).email || '').trim();
  if (emailFmt) {
    const emailLabel = 'EMAIL:';
    if ((emailLabel + ' ' + emailFmt).length <= totalWidth) {
      t += center(`${emailLabel} ${emailFmt}`, totalWidth) + '\n';
    } else {
      t += emailLabel + '\n';
      let restE = emailFmt;
      while (restE.length > 0) {
        t += padR(restE.substring(0, totalWidth), totalWidth) + '\n';
        restE = restE.substring(totalWidth);
      }
    }
  }

  // Forma de pagamento + quantos dias (a prazo = dias ate o vencimento)
  let payValor: string;
  if (condicaoPg === 'A PRAZO') {
    let dias = 0;
    if (sale.dataVencimento) {
      // BLOCO 40: dias de CALENDARIO em America/Sao_Paulo (meio-dia UTC das
      // duas datas) — nunca pega +1 por fuso do aparelho
      const d1 = new Date(`${diaSP(sale.data)}T12:00:00Z`).getTime();
      const d2 = new Date(`${diaSP(sale.dataVencimento)}T12:00:00Z`).getTime();
      dias = Math.round((d2 - d1) / 86400000);
    }
    payValor = `${formaPg} (A PRAZO${dias > 0 ? ` - ${dias} DIAS` : ''})`;
  } else {
    payValor = `${formaPg} (A VISTA)`;
  }
  const payLabel = 'PAGAMENTO:';
  if ((payLabel + ' ' + payValor).length <= totalWidth) {
    t += center(`${payLabel} ${payValor}`, totalWidth) + '\n';
  } else {
    t += payLabel + '\n';
    const spaces = Math.max(0, Math.floor((totalWidth - payValor.length) / 2));
    t += ' '.repeat(spaces) + payValor + '\n';
  }
  t += '='.repeat(totalWidth) + '\n';

  t += '-'.repeat(totalWidth) + '\n';
  t += center('OBRIGADO PELA PREFERENCIA!', totalWidth) + '\n';
  t += '*'.repeat(totalWidth) + '\n';
  t += '\n\n\n\n\n';

  return t;
}
