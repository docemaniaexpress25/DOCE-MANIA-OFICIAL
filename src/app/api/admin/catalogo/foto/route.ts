import { NextRequest, NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/session';
import { devBridge, getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';

/**
 * GESTAO DO CATALOGO DO PORTAL (Bloco 17) — upload de FOTO do produto.
 *
 * POST /api/admin/catalogo/foto   (Bearer session ADMIN obrigatoria)
 * Body: { dataUrl: 'data:image/jpeg;base64,...' }
 *
 * O cliente (aba Gestao de Catalogo) comprime a foto no aparelho
 * (max 640px, JPEG ~0.7) e manda o data URL. Esta rota grava no
 * Supabase Storage (bucket publico 'product-images', criado na primeira
 * vez se nao existir) e devolve a URL publica para salvar em
 * products.imagem (Bloco 15).
 */

const MAX_BYTES = 1_500_000; // 1.5MB no corpo decodificado (cliente manda ~40-80KB)
const BUCKET = 'product-images';

export async function POST(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, erro: 'Indisponivel no preview local.' }, { status: 503 });
  }
  if (!isAdminSession(request)) {
    return NextResponse.json({ ok: false, erro: 'Sessao invalida.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(dataUrl);
    if (!m) {
      return NextResponse.json({ ok: false, erro: 'Imagem invalida (use JPEG/PNG/WebP).' }, { status: 400 });
    }
    const mime = m[1] === 'jpg' ? 'jpeg' : m[1];
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, erro: 'Foto grande demais (max 1.5MB).' }, { status: 413 });
    }

    const supabase = getServiceClient();

    // Garante o bucket publico (idempotente)
    const { data: buckets } = await supabase.storage.listBuckets();
    const existe = (buckets || []).some((b) => b.name === BUCKET);
    if (!existe) {
      const { error: bErr } = await supabase.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: '2MB',
      });
      if (bErr && !/exists|duplicate/i.test(bErr.message || '')) throw bErr;
    }

    const path = `produtos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${mime === 'jpeg' ? 'jpg' : mime}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: `image/${mime}`, upsert: false });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, url: pub.publicUrl });
  } catch (e: any) {
    console.error('[api/admin/catalogo/foto] erro:', e?.message);
    return NextResponse.json({ ok: false, erro: 'Falha ao enviar a foto.' }, { status: 500 });
  }
}
