/**
 * Gerador de BR Code "Pix Copia e Cola" — padrao EMV QRCPS-MPM do Banco Central.
 * Gera o payload completo (com valor e txid) + CRC16 exigido pelo Bacen.
 *
 * O cliente escaneia o QR (ou cola o codigo) no app do banco e o valor
 * da divida ja vem preenchido — sem chance de erro de digitacao.
 *
 * Configuravel via env na Vercel (opcional):
 *   PIX_KEY   -> chave Pix do recebedor (default: CPF 01735712043)
 *   PIX_NAME  -> nome do recebedor, max 25 chars (default: DOCE MANIA)
 *   PIX_CITY  -> cidade do recebedor, max 15 chars (default: SAO PAULO)
 */

export const PIX_KEY = process.env.PIX_KEY || '01735712043';
export const PIX_NAME = sanitizePixText(process.env.PIX_NAME || 'DOCE MANIA', 25);
export const PIX_CITY = sanitizePixText(process.env.PIX_CITY || 'SAO PAULO', 15);

/** Campo TLV: tag (2) + tamanho (2) + valor */
function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) — exigido pelo Bacen no campo 63 */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e caracteres nao suportados no BR Code (nome/cidade) */
export function sanitizePixText(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

/** TXID: apenas [A-Za-z0-9], max 25 (regra Bacen) */
export function sanitizeTxid(s: string): string {
  const clean = (s || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  return clean || '***';
}

/** Gera um txid unico e curto para a transacao */
export function generateTxid(prefix = 'DM'): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0');
  return sanitizeTxid(`${prefix}${stamp}${rand}`);
}

/** Chave formatada apenas para EXIBICAO (CPF: 017.357.120-43) */
export function formatPixKey(key: string): string {
  const digits = key.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return key;
}

export interface PixPayloadResult {
  payload: string;      // codigo copia e cola (BR Code completo)
  valor: number;        // valor embutido
  txid: string;         // identificador da transacao
  chave: string;        // chave pix (diponivel tambem formatada em chaveFormatada)
  chaveFormatada: string;
  nome: string;
  cidade: string;
}

/**
 * Monta o BR Code com valor (QR de uso unico).
 * value em reais (ex.: 123.45), txid alfanumerico ate 25 chars.
 */
export function buildPixPayload(value: number, txid: string): PixPayloadResult {
  const safeTxid = sanitizeTxid(txid);
  const valor = Math.max(0, Number(value) || 0).toFixed(2);
  const chave = PIX_KEY.replace(/\s/g, '');

  let payload = '';
  payload += tlv('00', '01');                 // Payload Format Indicator
  payload += tlv('01', '12');                 // QR de uso unico (valor fixo)
  payload += tlv('26',
    tlv('00', 'br.gov.bcb.pix') +
    tlv('01', chave)
  );                                          // Merchant Account Info (Pix)
  payload += tlv('52', '0000');               // Merchant Category Code
  payload += tlv('53', '986');                // Moeda: BRL
  if (valor && Number(valor) > 0) payload += tlv('54', valor);
  payload += tlv('58', 'BR');                 // Pais
  payload += tlv('59', PIX_NAME);             // Nome do recebedor
  payload += tlv('60', PIX_CITY);             // Cidade do recebedor
  payload += tlv('62', tlv('05', safeTxid));  // TXID
  payload += '6304';                          // CRC16 (flag)
  payload += crc16(payload);

  return {
    payload,
    valor: Number(valor),
    txid: safeTxid,
    chave,
    chaveFormatada: formatPixKey(chave),
    nome: PIX_NAME,
    cidade: PIX_CITY,
  };
}
