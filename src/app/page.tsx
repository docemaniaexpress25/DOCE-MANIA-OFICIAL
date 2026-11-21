"use client";

import dynamic from 'next/dynamic';
import React from 'react';

// ============================================================================
// BLOCO 118.5 (AUTO-RECUPERACAO DE CARREGAMENTO — iPhone/Safari/PWA)
// ============================================================================
// O dono reportou a tela "O sistema não conseguiu abrir" PERSISTINDO mesmo
// depois de recarregar. Causa real: o Safari (e o atalho instalado na Tela de
// Inicio do iPhone) segura o HTML antigo em cache; esse HTML aponta para
// chunks do Turbopack que mudam de nome a cada atualizacao do codigo. O
// import dinamico pede um arquivo que nao existe mais -> falha -> cai nesta
// tela. O simples "recarregar" do Safari nao refaz a busca do HTML, entao o
// erro voltava sempre.
//
// Correcao em 3 camadas de defesa:
//   1) IMPORT COM RETRY: tentamos carregar o app 2x com pausa (resolve rede
//      instavel 3G/4G e chunk que ainda esta compilando no dev);
//   2) AUTO-RELOAD COM CACHE NOVO: se o erro for de carregamento (chunk,
//      import, fetch), recarregamos sozinhos com ?rc=<timestamp> — isso
//      FORCA o Safari a buscar HTML fresco. Limitado a 2 tentativas por
//      janela de 3 minutos para nunca travar em loop;
//   3) TELA DE ERRO MAIS FORTE: botao principal recarrega com cache novo e
//      existe um botao "limpar cache" que apaga a Cache API antes de abrir.
// ============================================================================

const CHAVE_TENTATIVAS = 'dm_auto_reload_v1';

type RegistroTentativas = { n: number; ts: number };

/** Contador de auto-recargas com janela de 3 minutos (evita loop infinito). */
const lerTentativas = (): RegistroTentativas => {
  try {
    const bruto = sessionStorage.getItem(CHAVE_TENTATIVAS);
    if (!bruto) return { n: 0, ts: 0 };
    const obj = JSON.parse(bruto) as RegistroTentativas;
    // Se a ultima tentativa foi ha mais de 3 minutos, considera zerado.
    if (!obj || typeof obj.n !== 'number' || Date.now() - (obj.ts || 0) > 180000) {
      return { n: 0, ts: 0 };
    }
    return obj;
  } catch {
    return { n: 0, ts: 0 }; // sessionStorage bloqueado (Safari privado) — segue sem contador
  }
};

const marcarTentativa = () => {
  try {
    const atual = lerTentativas();
    sessionStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify({ n: atual.n + 1, ts: Date.now() }));
  } catch { /* storage bloqueado — ignora */ }
};

const zerarTentativas = () => {
  try { sessionStorage.removeItem(CHAVE_TENTATIVAS); } catch { /* ignora */ }
};

/** Recarrega buscando HTML FRESCO (cache-buster ?rc=) — o Safari obedece. */
const recarregarComCacheNovo = () => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('rc', String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
};

/** Limpa a Cache API (best effort) — remove respostas velhas guardadas. */
const limparCachesDoNavegador = async () => {
  try {
    if (typeof caches !== 'undefined' && caches?.keys) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map(k => caches.delete(k)));
    }
  } catch { /* alguns navegadores bloqueiam — segue o baile */ }
};

/**
 * Detecta se o erro veio de CARREGAMENTO (chunk 404, import falhou, fetch
 * quebrado, rede). Sao exatamente os erros que o auto-reload resolve.
 */
const ehErroDeCarregamento = (msg: string): boolean => {
  const m = (msg || '').toLowerCase();
  return (
    m.includes('chunk') ||
    m.includes('dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('load failed') ||
    m.includes('erro ao buscar') ||
    m.includes('falha de rede')
  );
};

// ============================================================================
// BLOCO 118.4 (original) — SafeBoundary: qualquer crash de render mostra uma
// tela amigavel com orientacao (incluindo o caminho de limpeza no iPhone).
// BLOCO 118.5 — ganhou AUTO-RECUPERACAO de erro de carregamento (ver acima).
// ============================================================================
class SafeBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; msg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, msg: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, msg: String(error?.message || error || 'Erro desconhecido') };
  }

  componentDidCatch(error: any, info: any) {
    const msg = String(error?.message || error || '');
    console.error('[SafeBoundary] erro de render capturado:', error, info?.componentStack);

    // CAMADA 2 — AUTO-RELOAD: erro de carregamento (chunk/import/fetch) se
    // resolve recarregando com HTML fresco. Max 2 tentativas em 3 minutos.
    if (typeof window !== 'undefined' && ehErroDeCarregamento(msg)) {
      const t = lerTentativas();
      if (t.n < 2) {
        console.warn(`[SafeBoundary] erro de carregamento — auto-recarga ${t.n + 1}/2 com cache novo...`);
        marcarTentativa();
        setTimeout(() => recarregarComCacheNovo(), 500);
      }
    }
  }

  /** Botao principal: recarrega com cache novo e zera o contador. */
  private acaoRecarregar = () => {
    zerarTentativas();
    recarregarComCacheNovo();
  };

  /** Botao de forca bruta: apaga Cache API + contador + recarrega. */
  private acaoLimparEAbrir = () => {
    zerarTentativas();
    limparCachesDoNavegador().finally(() => {
      setTimeout(recarregarComCacheNovo, 300);
    });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: '#1d4ed8', fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          background: '#fff', borderRadius: 24, padding: 32, maxWidth: 420,
          width: '100%', textAlign: 'center', boxShadow: '0 25px 50px rgba(0,0,0,.25)',
        }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: '#1f2937', margin: '0 0 8px' }}>
            O sistema não conseguiu abrir
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, margin: '0 0 20px' }}>
            Ocorreu um erro de carregamento. Toque no botão abaixo para
            <strong> recarregar com cache atualizado</strong> — na maioria dos casos resolve.
            <br /><br />
            <strong style={{ fontSize: 12 }}>iPhone:</strong> se o problema continuar,
            use o botão de limpar cache; se ainda assim não abrir, limpe os dados do
            site em <em>Ajustes &gt; Safari &gt; Avançado &gt; Dados do site &gt; sistema-doce-mania1</em> e abra de novo.
          </p>
          <button
            onClick={this.acaoRecarregar}
            style={{
              width: '100%', background: '#1d4ed8', color: '#fff', border: 'none',
              padding: '16px 24px', borderRadius: 16, fontSize: 13, fontWeight: 900,
              letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            Recarregar o sistema
          </button>
          <button
            onClick={this.acaoLimparEAbrir}
            style={{
              width: '100%', background: '#fff', color: '#1d4ed8', border: '2px solid #1d4ed8',
              padding: '14px 24px', borderRadius: 16, fontSize: 12, fontWeight: 900,
              letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
              marginTop: 10,
            }}
          >
            Limpar cache e abrir de novo
          </button>
          {/* Mensagem tecnica para diagnostico — o dono pode copiar e mandar. */}
          <p style={{
            fontSize: 10, color: '#9ca3af', marginTop: 16, wordBreak: 'break-word',
            userSelect: 'text', WebkitUserSelect: 'text', textAlign: 'left',
          }}>
            {this.state.msg.slice(0, 200)}
          </p>
        </div>
      </div>
    );
  }
}

const Splash = () => (
  <div style={{
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 16, background: '#1d4ed8',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }}>
    <div style={{
      width: 48, height: 48, border: '5px solid rgba(255,255,255,.25)',
      borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite',
    }} />
    <p style={{ color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.9 }}>
      Carregando o sistema...
    </p>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// CAMADA 1 — IMPORT COM RETRY: se o chunk falhar (rede instavel ou servidor
// recompilando), tentamos de novo apos 1.2s antes de acusar erro.
const carregarAppComRetry = async () => {
  try {
    return await import('@/lib/doce-app');
  } catch (e) {
    console.warn('[APP] falha ao carregar o app — tentando de novo em 1.2s...', e);
    await new Promise(r => setTimeout(r, 1200));
    return await import('@/lib/doce-app');
  }
};

const DoceManiaApp = dynamic(carregarAppComRetry, {
  ssr: false,
  loading: () => <Splash />,
});

export default function Page() {
  return (
    <SafeBoundary>
      <DoceManiaApp />
    </SafeBoundary>
  );
}
