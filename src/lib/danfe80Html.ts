import { code128Svg } from './code128';
import { extrairDaChave, mascaraCnpjCpf } from './danfeTexto';
import { DanfeFiscalData } from './danfe80';

/**
 * BLOCO 158 — MINI DANFE 80mm EM HTML (LAYOUT DE REFERENCIA DO DONO, 100%)
 *
 * BLOCO 163 — FIM DEFINITIVO DO CORTE DO LADO DIREITO EM 100% DE ESCALA
 * Prova do campo: com a pagina em 72mm o dono imprimia SEMPRE com corte no
 * lado direito em 100% e so ficava bom ajustando a escala do dialogo para
 * 98% (72mm x 0,98 = 70,56mm). Ou seja, a AREA IMPRIMIVEL REAL do driver
 * termico dele e ~70,5mm — menor que os 72mm da cabeca (576 pontos), porque
 * o driver ainda reserva margens fisicas de alinhamento do papel.
 *
 * FIX: pagina redesenhada em 70mm (72 -> 70 = 97,2% da largura anterior).
 * Em 100% de escala o documento inteiro (bordas, grade, Code 128 de 65,5mm)
 * fica DENTRO da area imprimivel de qualquer termica 80mm real — SEM AJUSTE
 * MANUAL DE ESCALA. No PC imprime em 100% e na rua (Bluetooth) continua a
 * versao texto ESC/POS 48 colunas, que nunca corta (largura nativa).
 *
 * BLOCO 161 — LEGIBILIDADE NA TERMICA (mantido)
 * Toda a escala tipografica subiu +1pt (base 7pt -> 8pt, minimo 6,4pt),
 * traço engrossado com -webkit-text-stroke 0,15px (imprime mais escuro sem
 * mudar larguras), bordas finas 0,5px -> 0,75px (nao somem na termica) e
 * CHAVE DE ACESSO em grupos de 4 (conferencia manual, nao quebra no meio).
 *
 * Dica de impressao aparece so na TELA (.hint — display:none no papel):
 * escala 100% (nao precisa mais ajustar nada) e margens minimas.
 *
 * O dono mandou: "VOU PEGAR A DANFE CRIADA NA NFE E CRIAR ALGO 100% A ESSE
 * LAYOUT AQUI. PRECISAMOS SEGUIR ESSA LINHA DE LAYOUT! SEMPRE OTIMIZADO PARA
 * IMPRESSAO EM 80MM, DEIXE A MELHOR DEFINICAO DE QUALIDADE DA FONTE."
 *
 * Este gerador reproduz EXATAMENTE o modelo "Mini DANFE 80mm - NF-e 69 Serie 1"
 * (HTML de referencia enviado pelo dono), secao por secao:
 *
 *   [cabecalho]  MINI DANFE + DOCUMENTO AUXILIAR... | "1 - SAIDA" + NF + SERIE
 *   [destaque]   caixa dupla com VALOR TOTAL DA NOTA (grande) + NAT OPERACAO
 *                + EMISSAO (faixa lateral)
 *   [barras]     CODE 128 da chave de acesso (SVG em modulos — nitido na
 *                cabeca termica de 203 dpi)
 *   [chave]      CHAVE DE ACESSO + PROTOCOLO DE AUTORIZACAO DE USO
 *   [emitente]   EMITENTE: razao + endereco + CNPJ + IE
 *   [destinat.]  DESTINATARIO: razao + endereco + CNPJ/CPF + IE
 *   [datas]      DATA EMISSAO / DATA SAIDA / HORA SAIDA
 *   [itens]      COD | PRODUTO | CST | CFOP — item em 2 linhas (desc e
 *                un qtd x vUnit ... total em negrito)
 *   [imposto]    CALCULO DO IMPOSTO em grade: BASE/VALOR ICMS, BASE/VALOR
 *                ICMS ST, VALOR PRODUTOS/FRETE/DESCONTO/OUTRAS DESP, VALOR
 *                TOTAL DA NOTA + TRIB. APROX. FEDERAIS/ESTADUAIS (Lei 12.741,
 *                parseados do infCpl quando presentes)
 *   [pagamento]  FORMA DE PAGAMENTO / VALOR (tPag oficial) + TROCO
 *                — BLOCO 180, regra do dono: TANTO NFC-e COMO NF-e SEMPRE
 *                mostram a forma de pagamento (mesma regra do cupom de texto
 *                BT danfe80 — o HTML USB nao tinha o bloco)
 *   [transport]  TRANSPORTADOR/VOLUMES: [9] 9-SEM FRETE + pesos (venda sem
 *                transportadora, como o modelo)
 *   [adic]       DADOS ADICIONAIS: Simples Nacional I/II + tributos + IBPT +
 *                infCpl
 *   [fisco]      RESERVADO AO FISCO + FOLHA + consulta SEFAZ
 *   [recebim.]   bloco de RECEBIMENTO DA MERCADORIA (carimbo/assinatura) —
 *                NF-e (modelo 55); NFC-e nao vai (venda de balcao)
 *
 * A saida e um DOCUMENTO HTML COMPLETO (@page 80mm auto) pronto para o
 * dialogo de impressao USB (usbPrint.imprimirHtmlViaUsb), para o preview e —
 * BLOCO 185 — para a RASTERIZACAO do canal Bluetooth (variante raster:
 * mesmo papel sem @media screen/.hint -> btRaster.htmlParaEscposRaster), que
 * imprime o LAYOUT IDENTICO ao USB na termica pareada do celular.
 * Fonte: Consolas/Liberation Mono (monoespacada nítida, melhor definicao na
 * termica) com print-color-adjust: exact.
 */

const escapeHtml = (s: string): string =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Sem acentos (como o modelo de referencia) — evita falha de glifo na termica. */
const ascii = (s: string): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/—/g, '-')
    .replace(/…/g, '...');

const money = (v: number | undefined | null): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(Number(v)) ? Number(v) : 0);

/** Quantidade como o modelo mostra: 4 casas fixas ("14,0000"). */
const qtd4 = (v: number | undefined | null): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    .format(Number.isFinite(Number(v)) ? Number(v) : 0);

/** Valor unitario como o modelo mostra: 5 casas fixas ("11,05000"). */
const unit5 = (v: number | undefined | null): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 5, maximumFractionDigits: 5 })
    .format(Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * BLOCO 161 — CHAVE DE ACESSO em grupos de 4 ("4326 1063 7204 ...").
 * A termica quebrava os 44 digitos no meio de qualquer numero (break-all);
 * com grupos de 4 a quebra cai sempre entre grupos e o dono confere a chave
 * olho nu — mesmo formato dos grupos do cupom de texto (danfeTexto).
 */
const chaveGrupos4 = (k: string): string =>
  k.replace(/(\d{4})(?=\d)/g, '$1 ').trim();

/** Linha de CEP sobe para a linha anterior (modelo: "Caxias do Sul - RS   CEP: 95012-400"). */
function linhasEndereco(endereco?: string): string[] {
  const linhas = ascii(endereco || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const l of linhas) {
    if (/^CEP:/i.test(l) && out.length) out[out.length - 1] = `${out[out.length - 1]}   ${l}`;
    else out.push(l);
  }
  return out;
}

interface DataHora {
  data: string;
  hora: string;
}

/** dhEmi/dhRecbto -> data dd/MM/yyyy + hora HH:mm:ss (fuso America/Sao_Paulo). */
function dataHoraDe(iso?: string): DataHora {
  const vazio: DataHora = { data: '--/--/----', hora: '--:--:--' };
  if (!iso) return vazio;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return vazio;
  const data = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return { data, hora };
}

/** Tributos aproximados federais/estaduais e fonte IBPT gravados no infCpl. */
function tributosDoTexto(inf?: string): { federais?: string; estaduais?: string; fonte?: string; resto?: string } {
  if (!inf) return {};
  const txt = ascii(String(inf)).replace(/\s+/g, ' ').trim();
  const fed = txt.match(/R\$\s*([\d.]+,?\d{0,2})\s*FEDERAIS/i);
  const est = txt.match(/R\$\s*([\d.]+,?\d{0,2})\s*ESTADUAIS/i);
  const fonte = txt.match(/FONTE:\s*([^\n]+)$/i);
  const iniTrib = txt.toUpperCase().indexOf('VALOR APROXIMADO DOS TRIBUTOS');
  const iniFonte = txt.toUpperCase().indexOf('FONTE:');
  // resto = texto do infCpl que nao e a mensagem de tributos (ex.: "Venda 123...")
  let resto = '';
  if (iniTrib >= 0) resto = txt.substring(0, iniTrib).trim();
  else if (iniFonte >= 0) resto = txt.substring(0, iniFonte).trim();
  else resto = txt;
  return {
    federais: fed ? fed[1] : undefined,
    estaduais: est ? est[1] : undefined,
    fonte: fonte ? fonte[1].trim() : undefined,
    resto: resto.length ? resto : undefined,
  };
}

/** CSS do modelo de referencia (do dono) — BLOCO 163: pagina 70mm (cabe SEM ajuste de escala) + fonte +1pt + traço grosso.
 *  BLOCO 185: BASE = CSS puro de papel (USB e raster BT); TELA = só @media screen, colada DEPOIS da base
 *  no canal USB — no raster o CSS entra num SVG foreignObject sem contexto de midia e NAO pode levar
 *  o body transform scale(1.6) nem a .hint visivel (medicao 1.6x maior e barra escura no papel). */
const CSS_DANFE_BASE = `@page { size: 70mm auto; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; }
* { box-sizing: border-box; }
body { font-family: 'Consolas', 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace; color: #000;
  background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  /* BLOCO 161: traço engrossado ~30% — a termica 203dpi perde pontos finos;
     o stroke NAO muda a largura das colunas monoespacadas (nada desalinha). */
  -webkit-text-stroke: 0.15px #000; text-rendering: optimizeLegibility; }
.poster { width: 70mm; background: #fff; }
/* .hint: esconder no papel — visivel só no @media screen (CSS_DANFE_TELA, canal USB) */
.hint { display: none; }
.poster { padding: 2mm 1.8mm 1.2mm 1.8mm; font-size: 8pt; line-height: 1.32; }
.row { display: flex; flex-wrap: wrap; justify-content: space-between; max-width: 100%; }
.hd-left { font-size: 7.8pt; font-weight: bold; }
.hd-left .t2 { font-weight: normal; font-size: 7.2pt; }
.hd-right { text-align: right; font-size: 7.8pt; font-weight: bold; white-space: nowrap; }
.hd-right .out { font-weight: normal; }
.destaque { display: flex; border: 1.6px solid #000; margin-top: 1.4mm; }
.destaque > div { padding: 1.1mm 1.4mm; min-width: 0; }
.destaque .vlr { flex: 1 1 auto; border-right: 1.6px solid #000; }
.destaque .vlr b { font-size: 12.5pt; line-height: 1.15; display: block; }
.destaque .lbl { font-size: 7pt; font-weight: bold; }
.destaque .side { flex: 0 0 26mm; font-size: 7.4pt; }
.destaque .side b { display: block; font-size: 8pt; }
.bc-wrap { text-align: center; margin: 1.4mm 0 0 0; }
.bc-wrap svg { display: block; margin: 0 auto; max-width: 100%; }
.box { border: 1px solid #000; padding: 0.9mm 1.2mm; margin-top: 1.2mm; }
.box .lbl { font-size: 7.1pt; font-weight: bold; }
.box .val { font-size: 8pt; word-break: break-all; }
.box .val.chv { word-break: break-word; letter-spacing: 0.3px; line-height: 1.4; }
.emit-name { font-size: 7.6pt; font-weight: bold; word-break: break-word; }
.small { font-size: 7.2pt; }
.grid2 { display: flex; flex-wrap: wrap; max-width: 100%; }
.grid2 > div { flex: 1 1 0; min-width: 0; border: 1px solid #000; padding: 0.8mm 1.2mm; }
.grid2 > div + div { margin-left: -1px; }
.grid2 .lbl { font-size: 7.1pt; font-weight: bold; }
.sect-title { font-size: 8.2pt; font-weight: bold; margin: 1.4mm 0 0.4mm 0; }
.ihead, .item2 { display: flex; flex-wrap: wrap; justify-content: space-between; max-width: 100%; gap: 0 1.5mm; }
.ihead { font-size: 7.2pt; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 0.5mm; }
.item { margin: 0.55mm 0 0.65mm 0; }
.item1 { display: flex; gap: 1.5mm; align-items: baseline; font-size: 7.5pt; }
.item1 .cod { font-weight: bold; flex: 0 0 auto; }
.item1 .desc { font-weight: bold; flex: 1 1 auto; min-width: 0; word-break: break-word; }
.item1 .cf { flex: 0 0 auto; white-space: nowrap; }
.item2 { font-size: 7.5pt; margin-top: 0.25mm; }
.item2 b { font-weight: bold; }
.imp-row { display: flex; max-width: 100%; }
.imp-row > div { flex: 1 1 0; min-width: 0; border: 0.75px solid #000; padding: 0.7mm 1mm; }
.imp-row:first-child > div { border-top: none; }
.imp-row > div:first-child { border-left: none; }
.imp-row > div:last-child { border-right: none; }
.imp-row .ilbl { display: block; font-size: 6.4pt; font-weight: bold; line-height: 1.25; }
.imp-row b { display: block; font-size: 7.8pt; margin-top: 0.2mm; }
.imp-row .vnf b { font-size: 8.6pt; }
.tr-grid { display: flex; flex-wrap: wrap; max-width: 100%; border: 1px solid #000; }
.tr-grid > div { border: 0.75px solid #000; padding: 0.7mm 1.2mm; font-size: 7.3pt; }
.tr-grid .lbl { font-weight: bold; font-size: 7.1pt; }
.w20 { flex: 0 0 20%; } .w25 { flex: 0 0 25%; } .w30 { flex: 0 0 30%; } .w40 { flex: 0 0 40%; }
.adic { font-size: 6.8pt; line-height: 1.45; text-align: left; word-break: break-word; }
.fisco { min-height: 7mm; }
.footer { text-align: center; font-size: 6.6pt; margin-top: 1.6mm; }
.rec { border: 0.5mm solid #000; margin-top: 1.5mm; background: #fff; }
.rec-msg { padding: 1mm 1.25mm; border-bottom: 0.3mm solid #000;
  font-size: 7.2pt; font-weight: bold; line-height: 1.35; word-break: break-word; }
.rec-row { display: flex; align-items: stretch; }
.rec-data { flex: 0 0 24mm; border-right: 0.3mm solid #000; padding: 1mm 1.25mm; }
.rec-sign { flex: 1 1 0; min-width: 0; padding: 1mm 1.25mm; }
.rec .lbl { font-size: 6.5pt; font-weight: bold; letter-spacing: 0.2px; }
.rec-dia { font-size: 8.5pt; font-weight: bold; margin-top: 1.25mm; letter-spacing: 0.5px; white-space: nowrap; }
.rec-space { height: 15mm; }
.rec-cut { border-top: 0.3mm dashed #000; margin-top: 1.5mm; padding-top: 1mm;
  text-align: center; font-size: 6.5pt; font-weight: bold; letter-spacing: 0.3px; }
.qr-wrap { text-align: center; margin: 1.4mm 0 0 0; }
.qr-wrap img { display: block; margin: 0 auto; width: 30mm; height: 30mm; }
.qr-wrap .qlbl { font-size: 6.8pt; font-weight: bold; margin-top: 0.6mm; }
.alerta { border: 1.2px solid #000; padding: 1mm 1.2mm; margin-top: 1.2mm; font-size: 7.4pt; font-weight: bold; text-align: center; }`;

/** BLOCO 185 — @media screen: preview na tela e janela USB (iframe/srcdoc imprimem em midia screen).
 *  NAO vai no raster BT (htmlParaEscposRaster) — la nao existe midia screen e o bloco quebraria a medicao. */
const CSS_DANFE_TELA = `\n@media screen {
  html { height: auto; display: flex; justify-content: center; background: #ffffff; }
  body { transform: scale(1.6); transform-origin: top center; margin: 12px 0; }
  .poster { box-shadow: 0 0 24px rgba(0,0,0,0.35); }
  .hint { display: block; background: #0f172a; color: #fff; font-family: Arial, sans-serif;
    font-size: 12px; line-height: 1.4; padding: 8px 10px; text-align: center; }
}`;

/**
 * Opcoes do gerador do MINI DANFE.
 */
export interface DanfeHtmlOpcoes {
  /** BLOCO 185: variante para RASTERIZACAO no canal Bluetooth — mesmo papel,
   *  sem @media screen (que escalaria a medicao) e sem a barra .hint (que e
   *  instrução de tela e nunca pode sair no papel). O USB segue intocado. */
  raster?: boolean;
}

/**
 * Gera o documento HTML completo do MINI DANFE 80mm (layout de referencia).
 * Async por causa do QR Code da NFC-e (gerado como imagem data URL).
 */
export async function danfeFiscal80Html(d: DanfeFiscalData, opcoes?: DanfeHtmlOpcoes): Promise<string> {
  const raster = opcoes?.raster === true;
  const chave = (d.chave || '').replace(/\D/g, '');
  const info = extrairDaChave(chave);
  const isNfe = (d.modelo === 'NFE') || (info?.mod === '55');

  const numero9 = info?.numero || (d.numero || '').replace(/\D/g, '');
  const serie3 = (info?.serie || (d.serie || '')).replace(/\D/g, '');
  const nfNum = String(Number(numero9 || '0') || 0);
  const serieNum = String(Number(serie3 || '0') || 0);

  const dhEmi = dataHoraDe(d.dataEmissao);
  const dhAut = dataHoraDe(d.dataAutorizacao);
  const natureza = ascii(d.natureza || 'VENDA').toUpperCase();

  const emitNome = ascii((d.emitente?.nome || '').trim()).toUpperCase();
  const emitFant = ascii((d.emitente?.fantasia || '').trim()).toUpperCase();
  const emitCab = (emitFant || emitNome);
  const emitCnpj = (d.emitente?.cnpj || info?.cnpj || '').replace(/\D/g, '');
  const emitIe = ascii((d.emitente?.ie || '').trim());
  const endEmitLinhas = linhasEndereco(d.emitente?.endereco);

  const cliNome = ascii((d.destinatario?.nome || '').trim()).toUpperCase();
  const cliDoc = (d.destinatario?.doc || '').replace(/\D/g, '');
  const cliIe = ascii((d.destinatario?.ie || '').trim());
  const cliEndLinhas = linhasEndereco(d.destinatario?.endereco);

  const itens = d.itens || [];
  const tributos = tributosDoTexto(d.informacoes);

  // ---------------------------------------------------------
  // QR Code oficial (NFC-e) como imagem — obrigatorio no papel
  // ---------------------------------------------------------
  let qrHtml = '';
  if (!isNfe && d.qrCode && /^https?:/i.test(d.qrCode)) {
    try {
      const { default: QRCode } = await import('qrcode');
      const data = await QRCode.toDataURL(d.qrCode, { margin: 1, errorCorrectionLevel: 'M', width: 320 });
      qrHtml = `<div class="qr-wrap"><img src="${data}" alt="QR Code de consulta da NFC-e"><div class="qlbl">CONSULTE A NFC-E PELO QR CODE</div></div>`;
    } catch { /* QR indisponivel — cupom segue sem ele */ }
  }

  // ---------------------------------------------------------
  // ITENS
  // ---------------------------------------------------------
  const itensHtml = itens.map((it) => {
    const cod = ascii(it.codigo || '-');
    const desc = ascii(it.descricao || 'ITEM').toUpperCase();
    const un = ascii(it.unidade || 'UN').toLowerCase();
    const cst = ascii(it.cst || '-');
    const cfop = ascii(it.cfop || '-');
    return `<div class="item">
    <div class="item1">
      <span class="cod">${escapeHtml(cod)}</span>
      <span class="desc">${escapeHtml(desc)}</span>
      <span class="cf">${escapeHtml(cst)} ${escapeHtml(cfop)}</span>
    </div>
    <div class="item2">
      <span>${escapeHtml(un)}</span><span>${qtd4(it.quantidade)}</span><span>${unit5(it.valorUnitario)}</span>
      <b>${money(it.valorTotal)}</b>
    </div>
  </div>`;
  }).join('\n');

  // ---------------------------------------------------------
  // CALCULO DO IMPOSTO (3 linhas como o modelo)
  // ---------------------------------------------------------
  const tribCell = tributos.federais && tributos.estaduais
    ? `<div><span class="ilbl">TRIB. APROX. FEDERAIS</span><b>${escapeHtml(tributos.federais)}</b></div>
       <div><span class="ilbl">TRIB. APROX. ESTADUAIS</span><b>${escapeHtml(tributos.estaduais)}</b></div>`
    : tributos.federais
      ? `<div><span class="ilbl">TRIB. APROX. FEDERAIS</span><b>${escapeHtml(tributos.federais)}</b></div>`
      : (Number(d.valorTributos) || 0) > 0
        ? `<div><span class="ilbl">TRIB. APROX. TOTAL</span><b>${money(d.valorTributos)}</b></div>`
        : '';

  // ---------------------------------------------------------
  // BLOCO 180 — FORMA DE PAGAMENTO / VALOR + TROCO (tPag oficial)
  // Mesmo bloco do cupom de texto BT (danfe80): cada pagamento e uma
  // linha FORMA | VALOR, TROCO no fim, e quando o XML nao traz o bloco
  // <pag> a linha avisa "NAO INFORMADO" (nunca silencioso).
  // ---------------------------------------------------------
  const pags = d.pagamentos || [];
  const pagRows = pags.length
    ? pags.map((pg) => `<div class="imp-row">
      <div><span class="ilbl">FORMA DE PAGAMENTO</span><b>${escapeHtml(ascii(pg.forma || 'PAGAMENTO'))}</b></div>
      <div><span class="ilbl">VALOR (R$)</span><b>${money(pg.valor)}</b></div>
    </div>`).join('\n')
    : `<div class="imp-row">
      <div><span class="ilbl">FORMA DE PAGAMENTO</span><b>NAO INFORMADO NO XML</b></div>
      <div><span class="ilbl">VALOR (R$)</span><b>${money(d.valorTotal)}</b></div>
    </div>`;
  const trocoRow = (Number(d.troco) || 0) > 0
    ? `<div class="imp-row"><div class="vnf"><span class="ilbl">TROCO</span><b>R$ ${money(d.troco)}</b></div><div></div></div>`
    : '';

  // ---------------------------------------------------------
  // DADOS ADICIONAIS
  // ---------------------------------------------------------
  const adicLinhas: string[] = [];
  if (d.simplesNacional) {
    adicLinhas.push('I - "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL";');
    adicLinhas.push('II - "NAO GERA DIREITO A CREDITO FISCAL DE ICMS, DE ISS E DE IPI".');
  }
  if (tributos.federais || tributos.estaduais) {
    adicLinhas.push('Valor aproximado dos tributos:');
    if (tributos.federais) adicLinhas.push(`R$ ${tributos.federais} federais`);
    if (tributos.estaduais) adicLinhas.push(`R$ ${tributos.estaduais} estaduais`);
  } else if ((Number(d.valorTributos) || 0) > 0) {
    adicLinhas.push('Valor aproximado dos tributos:');
    adicLinhas.push(`R$ ${money(d.valorTributos)} total`);
  }
  if (tributos.fonte) adicLinhas.push(`Fonte: ${tributos.fonte}`);
  if (tributos.resto) adicLinhas.push(tributos.resto);
  const adicHtml = adicLinhas.map((l) => escapeHtml(l)).join('<br>') || 'SEM INFORMACOES ADICIONAIS';

  // ---------------------------------------------------------
  // CONTEUDO DAS SECOES
  // ---------------------------------------------------------
  const recHtml = isNfe ? `
  <div class="rec-cut">RECEBIMENTO DA MERCADORIA - ASSINAR E CARIMBAR APOS CONFERENCIA</div>

  <div class="rec">
    <div class="rec-msg">RECEBEMOS DE <b>${escapeHtml(emitCab)}</b> OS PRODUTOS E SERVICOS DA NF-E NUMERO ${escapeHtml(nfNum)} ACIMA</div>
    <div class="rec-row">
      <div class="rec-data">
        <div class="lbl">DATA DO RECEBIMENTO</div>
        <div class="rec-dia">____/____/______</div>
      </div>
      <div class="rec-sign">
        <div class="lbl">ASSINATURA E CARIMBO DO RECEBEDOR</div>
        <div class="rec-space"></div>
      </div>
    </div>
  </div>` : '';

  const alertaHtml: string[] = [];
  if (d.contingencia) alertaHtml.push('<div class="alerta">*** EMITIDA EM CONTINGENCIA (OFF-LINE) - VALIDA APOS TRANSMISSAO A SEFAZ ***</div>');
  if (d.cancelada) alertaHtml.push('<div class="alerta">*** NOTA CANCELADA NA SEFAZ - NAO E DOCUMENTO VALIDO ***</div>');

  const consultaUrl = isNfe ? 'www.nfe.fazenda.gov.br/portal' : 'www.nfce.fazenda.gov.br/portal';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mini DANFE 80mm - ${isNfe ? 'NF-e' : 'NFC-e'} ${escapeHtml(nfNum)} Serie ${escapeHtml(serieNum)}</title>
<style>
${CSS_DANFE_BASE}${raster ? '' : CSS_DANFE_TELA}
</style>
</head>
<body>
${raster ? '' : '<div class="hint">MINI DANFE 80mm — LARGURA 70mm (cabe na area imprimivel) • IMPRIMA EM ESCALA 100% E MARGENS “NENHUMA/MÍNIMA” • NAO PRECISA MAIS AJUSTAR ESCALA</div>'}
<div class="poster">

  <div class="row">
    <div class="hd-left">
      MINI DANFE<br>
      <span class="t2">DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA</span>
    </div>
    <div class="hd-right">
      <span class="out">1 - SAIDA</span><br>
      NF: ${escapeHtml(nfNum)}<br>
      SERIE: ${escapeHtml(serieNum)}
    </div>
  </div>

  <div class="destaque">
    <div class="vlr">
      <span class="lbl">VALOR TOTAL DA NOTA</span>
      <b>R$ ${money(d.valorTotal)}</b>
    </div>
    <div class="side">
      <span class="lbl">NAT OPERACAO</span><b>${escapeHtml(natureza)}</b>
      <span class="lbl">EMISSAO</span><b>${escapeHtml(dhEmi.data)}</b>
    </div>
  </div>
${alertaHtml.join('\n')}
${qrHtml}

  <div class="bc-wrap">${chave ? code128Svg(chave, { larguraMm: 65.5, alturaMm: 12 }) : ''}</div>

  <div class="box">
    <div class="lbl">CHAVE DE ACESSO</div>
    <div class="val chv">${escapeHtml(chaveGrupos4(chave))}</div>
    ${d.protocolo ? `<div class="lbl" style="margin-top:0.6mm">PROTOCOLO DE AUTORIZACAO DE USO</div>
    <div class="val">${escapeHtml(d.protocolo)} ${escapeHtml(dhAut.data)} ${escapeHtml(dhAut.hora)}</div>` : ''}
  </div>

  <div class="box">
    <div class="lbl">EMITENTE</div>
    ${emitCab ? `<div class="emit-name">${escapeHtml(emitCab)}</div>` : ''}
    ${endEmitLinhas.map((l) => `<div class="small">${escapeHtml(l)}</div>`).join('\n    ')}
    ${emitCnpj ? `<div class="small">CNPJ: ${escapeHtml(mascaraCnpjCpf(emitCnpj))}</div>` : ''}
    ${emitIe && !/^isen/i.test(emitIe) ? `<div class="small">IE: ${escapeHtml(emitIe)}</div>` : ''}
  </div>

  ${cliNome || cliDoc ? `<div class="box">
    <div class="lbl">DESTINATARIO</div>
    <div class="emit-name">${escapeHtml(cliNome || '-')}</div>
    ${cliEndLinhas.map((l) => `<div class="small">${escapeHtml(l)}</div>`).join('\n    ')}
    ${cliDoc ? `<div class="small">${cliDoc.length === 11 ? 'CPF' : 'CNPJ'}: ${escapeHtml(mascaraCnpjCpf(cliDoc))}</div>` : ''}
    ${cliIe && !/^isen/i.test(cliIe) ? `<div class="small">IE: ${escapeHtml(cliIe)}</div>` : ''}
  </div>` : ''}

  <div class="grid2" style="margin-top:1.2mm">
    <div><div class="lbl">DATA EMISSAO</div>${escapeHtml(dhEmi.data)}</div>
    <div><div class="lbl">DATA SAIDA</div>${escapeHtml(dhEmi.data)}</div>
    <div><div class="lbl">HORA SAIDA</div>${escapeHtml(dhEmi.hora)}</div>
  </div>

  <div class="sect-title">DADOS DOS PRODUTOS (${itens.length} ITENS)</div>
  <div class="ihead">
    <span>COD</span><span style="flex:1 1 auto">PRODUTO</span><span>CST</span><span>CFOP</span>
  </div>

${itensHtml}

  <div class="sect-title">CALCULO DO IMPOSTO</div>
  <div style="border:1px solid #000">
    <div class="imp-row">
      <div><span class="ilbl">BASE CALC ICMS</span><b>${money(d.baseIcms)}</b></div>
      <div><span class="ilbl">VALOR ICMS</span><b>${money(d.valorIcms)}</b></div>
      <div><span class="ilbl">BASE CALC ICMS ST</span><b>${money(d.baseIcmsSt)}</b></div>
      <div><span class="ilbl">VALOR ICMS ST</span><b>${money(d.valorIcmsSt)}</b></div>
    </div>
    <div class="imp-row">
      <div><span class="ilbl">VALOR TOTAL PRODUTOS</span><b>${money(d.valorProdutos ?? (itens.reduce((a, it) => a + it.valorTotal, 0)))}</b></div>
      <div><span class="ilbl">FRETE</span><b>0,00</b></div>
      <div><span class="ilbl">DESCONTO</span><b>${money(d.valorDesconto)}</b></div>
      <div><span class="ilbl">OUTRAS DESP.</span><b>0,00</b></div>
    </div>
    <div class="imp-row">
      <div class="vnf"><span class="ilbl">VALOR TOTAL DA NOTA</span><b>R$ ${money(d.valorTotal)}</b></div>
      ${tribCell}
    </div>
  </div>

  <div class="sect-title">FORMA DE PAGAMENTO</div>
  <div style="border:1px solid #000">
${pagRows}
${trocoRow}
  </div>

  <div class="sect-title">TRANSPORTADOR / VOLUMES</div>
  <div class="tr-grid">
    <div class="w40"><div class="lbl">FRETE POR CONTA</div>[9] 9-SEM FRETE</div>
    <div class="w20"><div class="lbl">QTDE</div>0</div>
    <div class="w20"><div class="lbl">PESO BRUTO (KG)</div>0,000</div>
    <div class="w20" style="flex:1 1 0"><div class="lbl">PESO LIQUIDO (KG)</div>0,000</div>
  </div>

  <div class="sect-title">DADOS ADICIONAIS</div>
  <div class="box adic" style="margin-top:0">${adicHtml}</div>

  <div class="box fisco">
    <div class="lbl">RESERVADO AO FISCO</div>
  </div>

  <div class="footer">FOLHA 1 de 1 - CONSULTA: ${consultaUrl}</div>
${recHtml}
</div>

</body></html>`;
}
