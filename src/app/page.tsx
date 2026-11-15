"use client";

import dynamic from 'next/dynamic';
import React from 'react';

// BLOCO 118.4 (HOTFIX iPHONE): tela branca sem recuperacao tinha duas causas.
// 1) Crash de render (ex.: localStorage bloqueado no Safari) sem boundary
//    React = tela branca eterna — agora o ErrorBoundary abaixo mostra
//    mensagem clara + botao "Recarregar".
// 2) Chunk 404 / rede lenta no primeiro load — agora existe um SPLASH de
//    carregamento em vez de fundo vazio, e o fallback de erro orienta o
//    usuario (incluindo o caminho de limpeza no iPhone).
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
    console.error('[SafeBoundary] erro de render capturado:', error, info?.componentStack);
  }

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
          <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, margin: '0 0 24px' }}>
            Ocorreu um erro de carregamento. Na maioria dos casos, um recarregamento resolve.
            <br /><br />
            <strong style={{ fontSize: 12 }}>iPhone:</strong> se o problema continuar,
            limpe os dados do site em <em>Ajustes &gt; Safari &gt; Avançado &gt; Dados do site &gt; sistema-doce-mania1</em> e abra de novo.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              width: '100%', background: '#1d4ed8', color: '#fff', border: 'none',
              padding: '16px 24px', borderRadius: 16, fontSize: 13, fontWeight: 900,
              letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            Recarregar o sistema
          </button>
          <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 16, wordBreak: 'break-word' }}>
            {this.state.msg.slice(0, 140)}
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

const DoceManiaApp = dynamic(() => import('@/lib/doce-app'), {
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
