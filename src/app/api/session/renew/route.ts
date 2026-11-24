import { NextRequest, NextResponse } from 'next/server';
import { sessionFromRequest, createSessionToken } from '@/lib/session';

/**
 * BLOCO 217 — RENOVAÇÃO DE SESSÃO (sliding session).
 *
 * Problema que originou este bloco: o token de sessão dura 7 dias e o app
 * restaura o usuário do localStorage SEM validar o token. Quando o token
 * expirava, o vendedor continuava "logado" na tela (fantasma) mas TODAS as
 * APIs de venda (pre-venda, pix/venda, notas/cupom, cargas/aceitar) devolviam
 * 401 "Sessão expirada" no meio do atendimento.
 *
 * Solução: o client chama esta rota periodicamente (e ao abrir o app). Se o
 * token vigente ainda é válido, devolve um token NOVO (7 dias) — o vendedor
 * ativo nunca mais vê "sessão expirada". Se o token já morreu, 401 e o app
 * força o logout (tela de login).
 *
 * Não confundir com /api/login (que valida PIN e emite o token inicial).
 */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }
  // Token válido: emite um novo com janela completa de 7 dias.
  const token = createSessionToken(session.sub, session.perfil);
  return NextResponse.json({ ok: true, token, perfil: session.perfil });
}
