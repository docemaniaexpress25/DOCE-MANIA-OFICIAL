import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * FOTOS NO STORAGE (fora do banco!) — economia do Supabase gratuito
 * ================================================================
 * ANTES: fotos de entrega (entrega_eventos.foto) e comprovantes de Pix
 * (payment_comprovantes.foto) eram salvas como base64 EM LINHAS DO
 * POSTGRES. Cada foto de celular comprimida tem ~150-350KB — em texto
 * base64 isso cresce ~110MB/mes de banco no ritmo das rotas. O limite
 * do plano gratuito e 500MB: em poucos meses estoura.
 *
 * AGORA: a foto vai para o bucket PRIVADO 'fotos-pedidos' do Supabase
 * Storage (1GB proprio, nao concorre com o banco) e a coluna guarda
 * apenas o CAMINHO (~40 bytes). Na leitura, a API valida a sessao e
 * devolve uma URL ASSINADA (1h) — o <img src> do app funciona igual
 * com dataURL (linhas antigas) e com URL assinada (linhas novas).
 *
 * RESILIENCIA: se o Storage falhar, salvarFotoSupabase() devolve null
 * e o chamador grava o base64 na coluna como antes — a foto NUNCA se
 * perde; so deixa de economizar banco naquele caso raro.
 */

const BUCKET = 'fotos-pedidos';
/** Cache curto: URLs assinadas expiram em 1h, entao o browser nao deve guardar mais que isso */
const SIGNED_TTL = 3600;
/** Guarda dura: cliente manda foto comprimida (~250-350KB base64); rejeita patologias */
export const MAX_FOTO_CHARS = 3_500_000;

let bucketOk = false;

/** Cria o bucket privado uma unica vez por processo (idempotente). */
async function garanteBucket(supabase: SupabaseClient): Promise<boolean> {
  if (bucketOk) return true;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const existe = (buckets || []).some((b) => b.name === BUCKET);
    if (!existe) {
      const { error } = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: '2MB',
      });
      if (error && !/exists|duplicate/i.test(error.message || '')) throw error;
    }
    bucketOk = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Salva um dataURL no Storage e devolve o CAMINHO (para gravar na coluna).
 * Null = falhou (chamador grava o base64 na coluna, como antes).
 */
export async function salvarFotoSupabase(
  supabase: SupabaseClient,
  pasta: 'entregas' | 'comprovantes',
  dataUrl: string
): Promise<string | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_FOTO_CHARS) return null;
  if (!(await garanteBucket(supabase))) return null;
  try {
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;
    const mime = m[1] === 'jpg' ? 'jpeg' : m[1];
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0) return null;
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const path = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: `image/${mime}`, upsert: false });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Converte o valor da coluna em algo que o <img src> entenda:
 *  - 'data:image...' (linhas antigas) -> passa igual;
 *  - caminho do Storage (linhas novas) -> URL assinada de 1h;
 *  - http(s) (improvavel) -> passa igual.
 * Nunca lanca: em caso de erro devolve o valor original.
 */
export async function resolverFotoSupabase(
  supabase: SupabaseClient,
  valor: string | null | undefined
): Promise<string | null> {
  if (!valor) return null;
  if (valor.startsWith('data:') || /^https?:\/\//.test(valor)) return valor;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(valor, SIGNED_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch { /* cai no fallback abaixo */ }
  return valor;
}
