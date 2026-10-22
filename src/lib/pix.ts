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

/** Chave formatada apenas para EXIBICAO (CPF: 017.357.120-43; CNPJ e telefone tambem) */
export function formatPixKey(key: string): string {
  const digits = key.replace(/[^0-9a-zA-Z@.+-]/g, '');
  const onlyDigits = key.replace(/\D/g, '');
  if (onlyDigits.length === 11 && /^\d+$/.test(key.replace(/\D/g, ''))) {
    return `${onlyDigits.slice(0, 3)}.${onlyDigits.slice(3, 6)}.${onlyDigits.slice(6, 9)}-${onlyDigits.slice(9)}`;
  }
  if (onlyDigits.length === 14 && /^\d+$/.test(key.replace(/\D/g, ''))) {
    return `${onlyDigits.slice(0, 2)}.${onlyDigits.slice(2, 5)}.${onlyDigits.slice(5, 8)}/${onlyDigits.slice(8, 12)}-${onlyDigits.slice(12)}`;
  }
  if (key.startsWith('+55') && (onlyDigits.length === 12 || onlyDigits.length === 13)) {
    const ddd = key.slice(3, 5);
    const rest = key.slice(5);
    return `${rest.length > 8 ? `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}` : `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`}`;
  }
  return digits;
}

/**
 * BLOCO 62 — TIPOS DE CHAVE PIX aceitos pelo Bacen:
 *   CPF (11 digitos com DV), CNPJ (14 digitos com DV), TELEFONE (com DDI+DDD),
 *   E-MAIL, CHAVE ALEATORIA (EVP: 32 hex ou UUID).
 */
export type PixKeyType = 'CPF' | 'CNPJ' | 'TELEFONE' | 'EMAIL' | 'ALEATORIA' | 'INVALIDA';

export interface ChavePixNormalizada {
  tipo: PixKeyType;
  chave: string;      // normalizada no formato do Bacen (telefone = +55...)
  valida: boolean;
  erro?: string;
}

/** DV do CPF (regra da Receita) */
function validaDVCPF(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = 11 - (s % 11); if (d1 > 9) d1 = 0;
  if (Number(c[9]) !== d1) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = 11 - (s % 11); if (d2 > 9) d2 = 0;
  return Number(c[10]) === d2;
}

/** DV do CNPJ (regra da Receita) */
function validaDVCNPJ(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string) => {
    let peso = base.length - 7;
    let s = 0;
    for (let i = 0; i < base.length; i++) { s += Number(base[i]) * peso--; if (peso < 2) peso = 9; }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (calc(c.slice(0, 12)) !== Number(c[12])) return false;
  return calc(c.slice(0, 13)) === Number(c[13]);
}

/**
 * Detecta o tipo da chave, valida e normaliza no formato do Bacen.
 * "54999765432" -> TELEFONE "+5554999765432" | "01735712043" -> CPF.
 * Espacos/pontos/tracos sao ignorados. Vazia = sem chave (usa o padrao).
 */
export function normalizarChavePix(raw: string): ChavePixNormalizada {
  const v = (raw || '').trim();
  if (!v) return { tipo: 'INVALIDA', chave: '', valida: false, erro: 'Chave vazia' };
  const digits = v.replace(/\D/g, '');

  // E-MAIL (sem espaços, com @ e dominio)
  if (v.includes('@')) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { tipo: 'EMAIL', chave: v.toLowerCase(), valida: true };
    return { tipo: 'EMAIL', chave: v.toLowerCase(), valida: false, erro: 'E-mail invalido' };
  }

  // CHAVE ALEATORIA (EVP): 32 hex ou UUID
  if (/^[0-9a-fA-F]{32}$/.test(v) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
    return { tipo: 'ALEATORIA', chave: v.toLowerCase(), valida: true };
  }

  // CPF/CNPJ x TELEFONE: 11 digitos colide com celular (DDD+9) e 14 nao colide.
  // Decide pelo DV: bate CPF -> CPF; senao, com DDD plausivel -> TELEFONE.
  if (digits.length === 11) {
    if (validaDVCPF(digits)) return { tipo: 'CPF', chave: digits, valida: true };
    if (/^[1-9][1-9]$/.test(digits.slice(0, 2))) return { tipo: 'TELEFONE', chave: `+55${digits}`, valida: true };
    return { tipo: 'CPF', chave: digits, valida: false, erro: 'CPF invalido (digito verificador nao bate)' };
  }
  if (digits.length === 10) {
    if (/^[1-9][1-9]$/.test(digits.slice(0, 2))) return { tipo: 'TELEFONE', chave: `+55${digits}`, valida: true };
    return { tipo: 'INVALIDA', chave: v, valida: false, erro: 'Numero incompleto' };
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return { tipo: 'TELEFONE', chave: `+${digits}`, valida: true };
  }
  if (digits.length === 14) {
    if (validaDVCNPJ(digits)) return { tipo: 'CNPJ', chave: digits, valida: true };
    return { tipo: 'CNPJ', chave: digits, valida: false, erro: 'CNPJ invalido (digito verificador nao bate)' };
  }

  return { tipo: 'INVALIDA', chave: v, valida: false, erro: 'Nao parece CPF, CNPJ, telefone, e-mail ou chave aleatoria' };
}

/**
 * BLOCO 62: le a chave Pix do recebimento gravada em app_settings
 * (pix_chave_entrega — editavel em Configuracoes). Se nao houver chave
 * configurada/valida (coluna pendente ou vazia), devolve undefined e o
 * buildPixPayload usa o padrao do env (PIX_KEY / CPF do dono).
 */
export async function lerChavePixEntrega(supabase: any): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('pix_chave_entrega')
      .eq('id', 'global_settings')
      .limit(1)
      .maybeSingle();
    const raw = data?.pix_chave_entrega ? String(data.pix_chave_entrega).trim() : '';
    if (!raw) return undefined;
    const n = normalizarChavePix(raw);
    return n.valida ? n.chave : undefined;
  } catch {
    return undefined;
  }
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
export function buildPixPayload(value: number, txid: string, chaveOverride?: string | null): PixPayloadResult {
  const safeTxid = sanitizeTxid(txid);
  const valor = Math.max(0, Number(value) || 0).toFixed(2);
  // BLOCO 62: a chave pode vir das Configuracoes (app_settings.pix_chave_entrega).
  // Sem override, segue o padrao (env PIX_KEY ou CPF do dono).
  const chave = (chaveOverride && chaveOverride.trim() ? chaveOverride.trim() : PIX_KEY).replace(/\s/g, '');

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
