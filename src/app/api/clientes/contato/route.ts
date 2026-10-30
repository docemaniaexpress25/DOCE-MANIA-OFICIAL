import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * ATUALIZA CONTATO DO CLIENTE (Bloco 72)
 *
 * POST /api/clientes/contato
 * { clientId, telefone?, pinLocalizacao?, endereco?, bairro? }
 *
 * Regra nova do dono: a tela de WhatsApp/Localizacao NAO trava mais o
 * atendimento — virou opcional. E o dono pediu para GARANTIR que grava no
 * banco: esta rota grava com service_role (bypassa RLS — o mesmo motivo da
 * exclusao de cliente ser server-side) e DEVOLVE a linha gravada, provando
 * a persistencia na resposta.
 *
 * Validacao: o que vier tem que estar completo (WhatsApp com 10+ digitos,
 * pin com 5+ chars). Campo vazio/ausente = nao altera. Nada valido = erro.
 */

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, erro: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = String(body.clientId || '');
  if (!clientId) {
    return NextResponse.json({ ok: false, erro: 'Cliente nao informado.' }, { status: 400 });
  }

  const payload: Record<string, string> = {};

  // WhatsApp: se veio, tem que ser completo (DDD + numero)
  if (body.telefone !== undefined && body.telefone !== null && String(body.telefone).trim() !== '') {
    const tel = String(body.telefone).trim();
    if (tel.replace(/\D/g, '').length < 10) {
      return NextResponse.json({ ok: false, erro: 'WhatsApp incompleto — digite DDD + número (ex: 54 99999-9999).' }, { status: 400 });
    }
    payload.telefone = tel;
  }

  // Localizacao: se veio, tem que ser um pin util (5+ chars)
  if (body.pinLocalizacao !== undefined && body.pinLocalizacao !== null && String(body.pinLocalizacao).trim() !== '') {
    const pin = String(body.pinLocalizacao).trim();
    if (pin.length < 5) {
      return NextResponse.json({ ok: false, erro: 'Localização inválida — capture o GPS de novo.' }, { status: 400 });
    }
    payload.pin_localizacao = pin;
  }

  // Endereço/bairro vêm do reverse geocode (quando o GPS resolveu a rua)
  if (body.endereco !== undefined && body.endereco !== null && String(body.endereco).trim() !== '') {
    payload.endereco = String(body.endereco).trim().slice(0, 300);
  }
  if (body.bairro !== undefined && body.bairro !== null && String(body.bairro).trim() !== '') {
    payload.bairro = String(body.bairro).trim().slice(0, 120);
  }

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nada para salvar — informe o WhatsApp ou capture a localização.' }, { status: 400 });
  }

  try {
    const db = getServiceClient();

    const { error: updErr } = await db.from('clients').update(payload).eq('id', clientId);
    if (updErr) {
      return NextResponse.json({ ok: false, erro: 'Erro ao gravar no banco.', detalhe: updErr.message }, { status: 500 });
    }

    // Prova de persistencia: le de volta a linha gravada e devolve.
    const { data: row, error: selErr } = await db
      .from('clients')
      .select('id, nome_fantasia, telefone, pin_localizacao, endereco, bairro')
      .eq('id', clientId)
      .maybeSingle();

    if (selErr) {
      // Gravou mas falhou a releitura — ainda é sucesso (update sem erro).
      return NextResponse.json({ ok: true, cliente: payload });
    }

    if (!row) {
      return NextResponse.json({ ok: false, erro: 'Cliente não encontrado no banco.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, cliente: row });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, erro: 'Erro ao gravar no banco.', detalhe: msg }, { status: 500 });
  }
}
