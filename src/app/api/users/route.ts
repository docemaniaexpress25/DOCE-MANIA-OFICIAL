import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';

/**
 * Gerenciamento de usuarios via servidor (service_role).
 * - GET    /api/users          -> lista SEM pin/pin_hash (tela de login)
 * - POST   /api/users          -> cria usuario (hash do PIN)      [ADMIN]
 * - PUT    /api/users          -> atualiza usuario (re-hash PIN)   [ADMIN]
 * - DELETE /api/users?id=...   -> exclui usuario                   [ADMIN]
 *
 * O PIN em texto puro NUNCA e armazenado: entra na request,
 * vira bcrypt e so pin_hash vai para o banco.
 */

const SAFE_COLUMNS = 'id, nome, email, perfil, ativo, telefone, whatsapp, foto, placa_veiculo, rota';

function mapUser(u: any) {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.perfil as string,
    ativo: !!u.ativo,
    telefone: u.telefone,
    whatsapp: u.whatsapp,
    foto: u.foto,
    placaVeiculo: u.placa_veiculo,
    rota: u.rota,
  };
}

export async function GET() {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 });
  }
  try {
    const { data, error } = await getServiceClient()
      .from('app_users')
      .select(SAFE_COLUMNS)
      .order('nome', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ users: (data || []).map(mapUser) });
  } catch (e: any) {
    console.error('[api/users GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao buscar usuarios.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Nao autorizado. Faca login novamente.' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { pin, email, telefone, whatsapp, foto, placaVeiculo, rota } = body;
    const perfil = body.role || body.perfil || 'VENDEDOR';

    if (!body.nome || typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
      return NextResponse.json({ error: 'Nome e PIN (4-8 digitos) sao obrigatorios.' }, { status: 400 });
    }

    const payload: any = {
      nome: body.nome,
      email: email || `${String(body.nome).toLowerCase().replace(/\s/g, '')}@sistema.com`,
      perfil,
      ativo: body.ativo !== false,
      telefone: telefone || null,
      whatsapp: whatsapp || null,
      foto: foto || null,
      placa_veiculo: placaVeiculo || null,
      rota: rota || 'ROTA_01',
      pin_hash: await hash(pin, 10),
    };

    const { data, error } = await getServiceClient()
      .from('app_users')
      .insert(payload)
      .select(SAFE_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ user: mapUser(data) });
  } catch (e: any) {
    console.error('[api/users POST] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao criar usuario.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Nao autorizado. Faca login novamente.' }, { status: 401 });
  }
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ error: 'id obrigatorio.' }, { status: 400 });
    }

    const payload: any = {};
    if (body.nome !== undefined) payload.nome = body.nome;
    if (body.email !== undefined) payload.email = body.email;
    if (body.ativo !== undefined) payload.ativo = !!body.ativo;
    if (body.telefone !== undefined) payload.telefone = body.telefone;
    if (body.whatsapp !== undefined) payload.whatsapp = body.whatsapp;
    if (body.foto !== undefined) payload.foto = body.foto;
    if (body.placaVeiculo !== undefined) payload.placa_veiculo = body.placaVeiculo;
    if (body.rota !== undefined) payload.rota = body.rota;
    if (body.role !== undefined) payload.perfil = body.role;
    else if (body.perfil !== undefined) payload.perfil = body.perfil;

    // PIN so e alterado se vier preenchido (4-8 digitos)
    if (typeof body.pin === 'string' && body.pin !== '') {
      if (!/^\d{4,8}$/.test(body.pin)) {
        return NextResponse.json({ error: 'PIN deve ter entre 4 e 8 digitos.' }, { status: 400 });
      }
      payload.pin_hash = await hash(body.pin, 10);
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    }

    const { data, error } = await getServiceClient()
      .from('app_users')
      .update(payload)
      .eq('id', body.id)
      .select(SAFE_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ user: mapUser(data) });
  } catch (e: any) {
    console.error('[api/users PUT] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao atualizar usuario.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor nao configurado.' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Nao autorizado. Faca login novamente.' }, { status: 401 });
  }
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatorio.' }, { status: 400 });

    const { error } = await getServiceClient().from('app_users').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[api/users DELETE] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao excluir usuario.' }, { status: 500 });
  }
}
