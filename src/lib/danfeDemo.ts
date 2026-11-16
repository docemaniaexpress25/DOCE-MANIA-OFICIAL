import { DanfeFiscalData } from './danfe80';

/**
 * BLOCO 158 — DADOS DO EXEMPLO OFICIAL DO MINI DANFE 80mm
 *
 * NF-e 69 Serie 1 — exatamente os dados do MODELO DE REFERENCIA do dono
 * ("Mini DANFE 80mm - NF-e 69 Serie 1.html"). Usado no preview do app
 * (ModelosImpressao) e na geracao do exemplo publico (danfe-exemplo.html) —
 * uma unica fonte de verdade para comparar o papel com o modelo.
 */
export const DEMO_DANFE_69: DanfeFiscalData = {
  autorizada: true,
  modelo: 'NFE',
  numero: '000000069',
  serie: '1',
  chave: '43261063720443000177550010000000691310985885',
  protocolo: '243260455305958',
  dataAutorizacao: '2026-10-30T10:20:16-03:00',
  dataEmissao: '2026-10-30T10:13:00-03:00',
  natureza: 'VENDA',
  emitente: {
    nome: 'DOCE MANIA EXPRESS LTDA',
    fantasia: 'DOCE MANIA EXPRESS LTDA',
    cnpj: '63720443000177',
    ie: '0290764262',
    endereco: 'Rua dos Mimo-de-Venus, 185\nCaxias do Sul - RS\nCEP: 95012-400',
  },
  destinatario: {
    nome: 'AUTO POSTO TREVO DA ROTA LTDA',
    doc: '46190996000146',
    ie: '1190038975',
    endereco: 'ROD RST 453 S/N LAJEADO GRANDE\nSao Francisco de Paula - RS\nCEP: 95400-000',
  },
  itens: [
    { codigo: 'GRTSC100', descricao: 'G RUFFLES TUBO SOUR E CREAM 100G', quantidade: 14, unidade: 'un', valorUnitario: 11.05, valorTotal: 154.70, ncm: '19059090', cst: '0101', cfop: '5102' },
    { codigo: 'GRTO100', descricao: 'G RUFFLES TUBO ORIGINAL 100G', quantidade: 14, unidade: 'un', valorUnitario: 11.05, valorTotal: 154.70, ncm: '19059090', cst: '0101', cfop: '5102' },
    { codigo: 'GRORG68', descricao: 'G RUFFLES ORIGINAL 68G', quantidade: 15, unidade: 'un', valorUnitario: 9.04, valorTotal: 135.60, ncm: '20052000', cst: '0101', cfop: '5102' },
    { codigo: 'GDQN75', descricao: 'G DORITOS QUEIJO NACHO 75G', quantidade: 38, unidade: 'un', valorUnitario: 9.04, valorTotal: 343.52, ncm: '20052000', cst: '0101', cfop: '5102' },
    { codigo: 'GFDP85', descricao: 'G FANDANGOS PRESUNTO 85G', quantidade: 15, unidade: 'un', valorUnitario: 6.79, valorTotal: 101.85, ncm: '19041000', cst: '0101', cfop: '5102' },
    { codigo: 'GCHR90', descricao: 'G CHEETOS REQUEIJAO 90G', quantidade: 30, unidade: 'un', valorUnitario: 7.69, valorTotal: 230.70, ncm: '19041000', cst: '0101', cfop: '5102' },
    { codigo: 'GCHL80', descricao: 'G CHEETOS LUA 80G', quantidade: 15, unidade: 'un', valorUnitario: 8.39, valorTotal: 125.85, ncm: '19041000', cst: '0101', cfop: '5102' },
    { codigo: 'GPB160', descricao: 'G PINGO D OURO BACON 160G', quantidade: 28, unidade: 'un', valorUnitario: 9.50, valorTotal: 266.00, ncm: '19059090', cst: '0101', cfop: '5102' },
    { codigo: 'GTDC200', descricao: 'G TODDYNHO CHOCOLATE 200ML', quantidade: 27, unidade: 'un', valorUnitario: 2.34, valorTotal: 63.18, ncm: '22029900', cst: '0101', cfop: '5102' },
    { codigo: 'GKEC330', descricao: 'G KERO COCO 330ML', quantidade: 12, unidade: 'un', valorUnitario: 5.69, valorTotal: 68.28, ncm: '20098921', cst: '0101', cfop: '5102' },
  ],
  quantidadeItens: 208,
  valorProdutos: 1644.38,
  valorDesconto: 0,
  valorTotal: 1644.38,
  valorTributos: 446.20,
  baseIcms: 0,
  valorIcms: 0,
  pagamentos: [{ forma: 'BOLETO BANCARIO', valor: 1644.38 }],
  troco: 0,
  informacoes: 'Valor aproximado dos tributos: R$ 222,19 federais R$ 224,01 estaduais Fonte: IBPT/empresometro.com.br AA45DF',
  simplesNacional: true,
  fonte: 'XML',
};
