"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { authHeaders } from '@/services/userService';
// BLOCO 112: reforço de impressão (config POR DISPOSITIVO em localStorage —
// não vai para o banco: cada aparelho/impressora tem sua calibração)
import { lerReforcoImpressao, salvarReforcoImpressao } from '@/lib/usbPrint';
// MINI DANFE (80mm) — janela de visualização do modelo
import ModelosImpressao from './ModelosImpressao';

/**
 * ERP FISCAL & AUTOMAÇÕES — hub de configurações organizado em cards que expandem.
 * Nada amontoado numa tela só: Nota Fiscal (Focus NFe), Boletos (Banco Inter) e Estoque.
 * GET  /api/configuracoes  → { ok, fiscal, boleto, pix }
 * POST /api/configuracoes  → envia SOMENTE o que mudou: { emitente?, nfeAutoPe?, cupomDuploNfc?, boletoAutoAReceber?, boletoMensagemPadrao? }
 */

interface Emitente {
  cnpj: string; ie: string; razao: string; fantasia: string;
  logradouro: string; numero: string; bairro: string;
  municipio: string; uf: string; cep: string; regime: number;
}

interface FiscalConfig {
  focusConfigurado: boolean;
  ambiente: string;
  nfeAutoPe: boolean;
  cupomDuploNfc: boolean;
  emitente: Emitente;
  emitenteFonte: 'app_settings' | 'env' | 'nenhum';
}

interface BoletoConfig {
  interConfigurado: boolean;
  autoBoletoAReceber: boolean;
  /** BLOCO 152: texto padrao na seção "responsabilidade do beneficiário" do PDF */
  mensagemPadrao: string;
  /** BLOCO 205: mensagem personalizada de cobrança (Portal de Cobranças / WhatsApp) */
  cobrancaMensagem: string;
}

// BLOCO 167 — evento do webhook do Inter (tabela webhook_logs, SQL 167)
interface WebhookLogEvento {
  id: string;
  criadoEm: string;
  origem?: string | null;
  codigo?: string | null;
  seuNumero?: string | null;
  saleId?: string | null;
  resultado: string;
  processado: boolean;
}

// BLOCO 172 — recebimento com origem (sales.baixa_origem/baixa_em, SQL 172)
interface RecebimentoLog {
  id: string;
  baixaEm: string;
  baixaOrigem: string;
  valor: number;
  metodo: string;
  cliente: string;
  detalhe: string;
}

// BLOCO 220 — painel da baixa automática: estado REAL do webhook no Inter
// (GET /cobranca/v3/cobrancas/webhook) + fila em aberto + último sync (cron)
interface InterPainel {
  ok: boolean;
  configurado: boolean;
  webhook: {
    ok: boolean;
    cadastrado: boolean;
    url: string;
    criacao: string;
    atualizacao: string;
    erro: string;
    semCredenciais: boolean;
  } | null;
  filaAberta: number | null;
  ultimoSync: { em: string; resultado: string; processado: boolean } | null;
  frequencia: { webhook: string; sync: string };
}

// BLOCO 116/117 — webhook da Focus (status em tempo real via API /v2/hooks)
// eventos: nfe (NF-e autorizada), nfce (NFC-e autorizada), nfce_contingencia
// (desfecho da NFC-e offline) — doc docs/webhooks, cada gatilho monitora UM evento.
interface FocoWebhook {
  url: string;
  instalado: boolean;
  id: string;
  eventos: string[];
  segredoConfigurado: boolean;
  erro: string;
}

interface Props {
  onBack: () => void;
  onAbrirMovimentos: () => void;
}

const EMITENTE_VAZIO: Emitente = {
  cnpj: '', ie: '', razao: '', fantasia: '', logradouro: '',
  numero: '', bairro: '', municipio: '', cep: '', uf: 'RS', regime: 1,
};

const soDigitos = (v: string) => (v || '').replace(/\D/g, '');

const mascaraCnpj = (v: string): string => {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const mascaraCep = (v: string): string => {
  const d = soDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/* ===== mini-componentes de estilo do app ===== */

const Campo = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">{label}</label>
    {children}
  </div>
);

const Switch = ({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`w-12 h-9 rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-emerald-600' : 'bg-gray-300'} ${disabled ? 'opacity-60' : ''}`}
  >
    <div className={`absolute top-1.5 w-6 h-6 bg-white rounded-full transition-all shadow-sm ${on ? 'left-5' : 'left-1'}`}></div>
  </button>
);

const ChipStatus = ({ cor, icon, label }: { cor: string; icon: string; label: string }) => (
  <span className={`text-[9px] font-black uppercase tracking-wide px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 ${cor}`}>
    <i className={`fa-solid ${icon} text-[9px]`}></i>{label}
  </span>
);

const ConfiguracoesHub: React.FC<Props> = ({ onBack, onAbrirMovimentos }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [fiscal, setFiscal] = useState<FiscalConfig | null>(null);
  const [boleto, setBoleto] = useState<BoletoConfig | null>(null);
  // BLOCO 208: o switch do QR do catálogo no cupom saiu (o QR foi removido do
  // cupom impresso a pedido do dono — o papel sai limpo sem QR do portal).
  const [focoWebhook, setFocoWebhook] = useState<FocoWebhook | null>(null);
  const [processandoHook, setProcessandoHook] = useState(false);

  const [emitenteAberto, setEmitenteAberto] = useState(false);
  const [form, setForm] = useState<Emitente>(EMITENTE_VAZIO);
  const [salvandoEmitente, setSalvandoEmitente] = useState(false);
  const [salvandoSwitch, setSalvandoSwitch] = useState<string | null>(null);

  // BLOCO 112 — reforço de impressão (cupom mais escuro). useState(true) +
  // useEffect evita mismatch de hidratação (localStorage só existe no cliente).
  const [reforco, setReforco] = useState(true);
  useEffect(() => { setReforco(lerReforcoImpressao()); }, []);

  // MINI DANFE (80mm) — janela de visualização do modelo
  const [modelosAberto, setModelosAberto] = useState(false);

  // BLOCO 152 — texto padrao do boleto (mensagem do beneficiário no PDF do Inter)
  const [msgPadraoInput, setMsgPadraoInput] = useState('');
  const [salvandoMsgPadrao, setSalvandoMsgPadrao] = useState(false);

  // BLOCO 205 — mensagem personalizada de cobrança (Portal de Cobranças)
  const PLACEHOLDERS_COBRANCA = ['{nome}', '{valor}', '{vencimento}', '{dias}'];
  const [msgCobrancaInput, setMsgCobrancaInput] = useState('');
  const [salvandoMsgCobranca, setSalvandoMsgCobranca] = useState(false);

  // BLOCO 167 — log de eventos do webhook do Inter (pagamentos/recebimentos)
  const [logAberto, setLogAberto] = useState(false);
  const [logHook, setLogHook] = useState<WebhookLogEvento[] | null>(null);
  const [logHookErro, setLogHookErro] = useState('');
  const [logHookCarregando, setLogHookCarregando] = useState(false);

  // BLOCO 172 — log de pagamentos e recebimentos (automático x manual)
  const [recLogAberto, setRecLogAberto] = useState(false);
  const [recLog, setRecLog] = useState<RecebimentoLog[] | null>(null);
  const [recLogErro, setRecLogErro] = useState('');
  const [recLogCarregando, setRecLogCarregando] = useState(false);

  // BLOCO 220 — painel da baixa automática (situação REAL do webhook no Inter)
  const [painelAberto, setPainelAberto] = useState(false);
  const [painelInter, setPainelInter] = useState<InterPainel | null>(null);
  const [painelCarregando, setPainelCarregando] = useState(false);
  const [acaoInter, setAcaoInter] = useState<'CADASTRAR' | 'EXCLUIR' | null>(null);
  const [syncRodando, setSyncRodando] = useState(false);
  const [syncResultado, setSyncResultado] = useState('');

  const [toast, setToast] = useState<{ msg: string; tipo: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mostrarToast = (msg: string, tipo: 'success' | 'error' = 'success') => {
    setToast({ msg, tipo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  /* ===== GET /api/configuracoes ===== */
  const carregar = useCallback(async (mostrarLoading = true) => {
    if (mostrarLoading) setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/configuracoes', { headers: { 'Content-Type': 'application/json', ...authHeaders() } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.erro || d.error || `Erro ${res.status} ao carregar configurações`);
      const f: FiscalConfig = {
        focusConfigurado: !!d.fiscal?.focusConfigurado,
        ambiente: d.fiscal?.ambiente || 'producao',
        nfeAutoPe: !!d.fiscal?.nfeAutoPe,
        cupomDuploNfc: !!d.fiscal?.cupomDuploNfc,
        emitente: { ...EMITENTE_VAZIO, ...(d.fiscal?.emitente || {}) },
        emitenteFonte: d.fiscal?.emitenteFonte || 'nenhum',
      };
      setFiscal(f);
      setForm(f.emitente);
      setBoleto({
        interConfigurado: !!d.boleto?.interConfigurado,
        autoBoletoAReceber: !!d.boleto?.autoBoletoAReceber,
        // BLOCO 152: texto padrao do boleto (linha 2 da mensagem da cobranca)
        mensagemPadrao: String(d.boleto?.mensagemPadrao || ''),
        // BLOCO 205: mensagem personalizada de cobrança
        cobrancaMensagem: String(d.boleto?.cobrancaMensagem || ''),
      });
      setMsgPadraoInput(String(d.boleto?.mensagemPadrao || ''));
      setMsgCobrancaInput(String(d.boleto?.cobrancaMensagem || ''));
      setFocoWebhook(
        d.focoWebhook
          ? {
              url: d.focoWebhook.url || '',
              instalado: !!d.focoWebhook.instalado,
              id: d.focoWebhook.id || '',
              eventos: Array.isArray(d.focoWebhook.eventos) ? d.focoWebhook.eventos : [],
              segredoConfigurado: !!d.focoWebhook.segredoConfigurado,
              erro: d.focoWebhook.erro || '',
            }
          : null
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Sem conexão. Tente novamente.');
    } finally {
      if (mostrarLoading) setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(true); }, [carregar]);

  /* ===== POST /api/configuracoes (só o que mudou) → re-GET → toast ===== */
  const postConfig = useCallback(async (body: Record<string, unknown>, msgOk: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.erro || d.error || 'Falha ao salvar.');
      await carregar(false);
      mostrarToast(msgOk, 'success');
      return true;
    } catch (e) {
      mostrarToast(e instanceof Error ? e.message : 'Erro ao salvar.', 'error');
      return false;
    }
  }, [carregar]);

  /* ===== switches otimistas (reverte se o POST falhar) ===== */
  const alternarSwitch = async (campo: 'nfeAutoPe' | 'cupomDuploNfc' | 'boletoAutoAReceber', novo: boolean) => {
    const prevFiscal = fiscal;
    const prevBoleto = boleto;
    if (campo === 'boletoAutoAReceber') setBoleto(b => (b ? { ...b, autoBoletoAReceber: novo } : b));
    else setFiscal(f => (f ? ({ ...f, [campo]: novo } as FiscalConfig) : f));
    setSalvandoSwitch(campo);
    const ok = await postConfig({ [campo]: novo }, 'Preferência salva!');
    if (!ok) { setFiscal(prevFiscal); setBoleto(prevBoleto); }
    setSalvandoSwitch(null);
  };

  /* ===== BLOCO 152 — salva o texto padrao do boleto ===== */
  const salvarMensagemPadrao = async () => {
    if (salvandoMsgPadrao) return;
    if (msgPadraoInput.trim() === (boleto?.mensagemPadrao || '')) return;
    setSalvandoMsgPadrao(true);
    await postConfig({ boletoMensagemPadrao: msgPadraoInput }, 'Mensagem padrão do boleto salva!');
    setSalvandoMsgPadrao(false);
  };

  /* ===== BLOCO 205 — salva a mensagem de cobrança (Portal de Cobranças) ===== */
  const salvarMensagemCobranca = async () => {
    if (salvandoMsgCobranca) return;
    if (msgCobrancaInput.trim() === (boleto?.cobrancaMensagem || '')) return;
    setSalvandoMsgCobranca(true);
    await postConfig({ cobrancaMensagem: msgCobrancaInput }, 'Mensagem de cobrança salva! Vale para o Portal de Cobranças.');
    setSalvandoMsgCobranca(false);
  };

  /* ===== emitente: CNPJ 14 dígitos obrigatório + diff por campo ===== */
  const cnpjOk = soDigitos(form.cnpj).length === 14;

  const emitenteDiff = useMemo(() => {
    if (!fiscal) return {} as Record<string, unknown>;
    const diff: Record<string, unknown> = {};
    (Object.keys(form) as (keyof Emitente)[]).forEach(k => {
      const atual = k === 'cnpj'
        ? soDigitos(form.cnpj)
        : k === 'regime'
          ? Number(form.regime) || 1
          : String(form[k] ?? '').trim().toUpperCase();
      const salvo = k === 'cnpj'
        ? soDigitos(fiscal.emitente.cnpj || '')
        : k === 'regime'
          ? Number(fiscal.emitente.regime) || 1
          : String(fiscal.emitente[k] ?? '').trim().toUpperCase();
      if (atual !== salvo) diff[k] = atual;
    });
    return diff;
  }, [form, fiscal]);

  const emitenteMudou = Object.keys(emitenteDiff).length > 0;

  const salvarEmitente = async () => {
    if (!cnpjOk || !emitenteMudou || salvandoEmitente) return;
    setSalvandoEmitente(true);
    await postConfig({ emitente: emitenteDiff }, 'Dados do emitente salvos!');
    setSalvandoEmitente(false);
  };

  /* ===== webhook do Inter ===== */
  const webhookUrl = typeof window !== 'undefined' ? window.location.origin + '/api/webhooks/inter' : '/api/webhooks/inter';
  const copiarWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      mostrarToast('URL do webhook copiada!', 'success');
    } catch {
      mostrarToast('Não foi possível copiar — copie manualmente.', 'error');
    }
  };

  /* ===== BLOCO 167 — log de eventos do webhook (GET /api/webhooks/inter-log) ===== */
  const carregarLogWebhook = useCallback(async () => {
    setLogHookCarregando(true);
    try {
      const res = await fetch('/api/webhooks/inter-log', { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setLogHookErro(String(d?.error || 'Falha ao carregar o log do webhook.'));
        return;
      }
      setLogHook(Array.isArray(d.eventos) ? d.eventos : []);
      setLogHookErro('');
    } catch {
      setLogHookErro('Sem conexão para carregar o log do webhook.');
    } finally {
      setLogHookCarregando(false);
    }
  }, []);

  const alternarLogWebhook = () => {
    const novo = !logAberto;
    setLogAberto(novo);
    if (novo && logHook === null) void carregarLogWebhook();
  };

  /* ===== BLOCO 172 — log de pagamentos e recebimentos (GET /api/recebimentos-log) ===== */
  const carregarLogRecebimentos = useCallback(async () => {
    setRecLogCarregando(true);
    try {
      const res = await fetch('/api/recebimentos-log', { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setRecLogErro(String(d?.error || 'Falha ao carregar o log de recebimentos.'));
        return;
      }
      setRecLog(Array.isArray(d.recebimentos) ? d.recebimentos : []);
      setRecLogErro('');
    } catch {
      setRecLogErro('Sem conexão para carregar o log de recebimentos.');
    } finally {
      setRecLogCarregando(false);
    }
  }, []);

  const alternarLogRecebimentos = () => {
    const novo = !recLogAberto;
    setRecLogAberto(novo);
    if (novo && recLog === null) void carregarLogRecebimentos();
  };

  /* ===== BLOCO 220 — painel da baixa automática (GET /api/webhooks/inter-painel) =====
   * O Internet Banking do Inter NÃO tem tela para cadastrar webhook — o cadastro
   * é feito pela API oficial da Cobrança V3. Este painel verifica o estado REAL
   * no Inter e cadastra/remove em um clique (o app fala direto com o banco via
   * mTLS usando as credenciais da Vercel). */
  const carregarPainelInter = useCallback(async () => {
    setPainelCarregando(true);
    try {
      const res = await fetch('/api/webhooks/inter-painel', { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) throw new Error(String(d?.error || 'Falha ao consultar o Inter.'));
      setPainelInter({
        ok: true,
        configurado: !!d.configurado,
        webhook: d.webhook || null,
        filaAberta: typeof d.filaAberta === 'number' ? d.filaAberta : null,
        ultimoSync: d.ultimoSync || null,
        frequencia: d.frequencia || { webhook: '', sync: '' },
      });
    } catch {
      setPainelInter(null);
    } finally {
      setPainelCarregando(false);
    }
  }, []);

  const alternarPainelInter = () => {
    const novo = !painelAberto;
    setPainelAberto(novo);
    if (novo) void carregarPainelInter();
  };

  /* ===== BLOCO 220 — cadastra/remove o webhook DIRETO na API do Inter ===== */
  const acaoWebhookInter = async (acao: 'CADASTRAR' | 'EXCLUIR') => {
    setAcaoInter(acao);
    try {
      const res = await fetch('/api/webhooks/inter-cadastrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(acao === 'CADASTRAR' ? { acao, url: webhookUrl } : { acao }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || 'O Inter recusou a operação.');
      mostrarToast(acao === 'CADASTRAR'
        ? 'Baixa automática ATIVADA — o Inter já avisará o app quando um boleto pagar!'
        : 'Webhook removido do Inter.', 'success');
    } catch (e) {
      mostrarToast(e instanceof Error ? e.message : 'Falha na operação.', 'error');
    } finally {
      setAcaoInter(null);
      void carregarPainelInter();
      setLogHook(null); // força o log a recarregar (a ação foi auditada)
      if (logAberto) void carregarLogWebhook();
    }
  };

  /* ===== BLOCO 220 — "Sincronizar agora" (GET /api/boletos-sync, admin) ===== */
  const sincronizarBoletosAgora = async () => {
    setSyncRodando(true);
    setSyncResultado('');
    try {
      const res = await fetch('/api/boletos-sync', { headers: { ...authHeaders() } });
      const d = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) throw new Error('Somente admin pode sincronizar.');
      if (!res.ok || !d.ok) throw new Error(d.erro || 'Falha na sincronização.');
      if (d.motivo === 'INTER_NAO_CONFIGURADO') setSyncResultado('Credenciais do Inter ausentes neste ambiente — na produção (Vercel) funciona.');
      else if (d.motivo === 'NADA_ABERTO') setSyncResultado('Nenhum boleto em aberto — tudo conciliado.');
      else if (d.motivo === 'SCHEMA_ANTIGO') setSyncResultado('Banco desatualizado — rode o SQL do bloco 25.');
      else setSyncResultado(`${d.processadas || 0} cobrança(s) reconsultada(s) no Inter · ${d.baixadas || 0} baixa(s) automática(s) agora.`);
      void carregarPainelInter();
      setLogHook(null);
      if (logAberto) void carregarLogWebhook();
    } catch (e) {
      setSyncResultado(e instanceof Error ? e.message : 'Falha na sincronização.');
    } finally {
      setSyncRodando(false);
    }
  };

  // BLOCO 172 — rótulo/cor da origem da baixa
  const origemBaixa = (o: string): { label: string; cls: string; icon: string } => {
    switch (o) {
      case 'WEBHOOK_INTER': return { label: 'Automático (webhook Inter)', cls: 'bg-emerald-50 text-emerald-600', icon: 'fa-bolt' };
      case 'CRON_INTER': return { label: 'Automático (sync diário)', cls: 'bg-emerald-50 text-emerald-600', icon: 'fa-arrows-rotate' };
      case 'PIX_PORTAL': return { label: 'PIX do portal (confirmado)', cls: 'bg-teal-50 text-teal-600', icon: 'fa-mobile-screen' };
      case 'MANUAL': return { label: 'Baixa manual no app', cls: 'bg-amber-50 text-amber-600', icon: 'fa-hand-holding-dollar' };
      case 'PDV': return { label: 'À vista (PDV)', cls: 'bg-gray-100 text-gray-600', icon: 'fa-cash-register' };
      default: return { label: o || '—', cls: 'bg-gray-100 text-gray-500', icon: 'fa-tag' };
    }
  };

  /* ===== BLOCO 116 — webhook da Focus (instalar/remover via API da Focus) ===== */
  const acaoWebhook = async (acao: 'INSTALAR_WEBHOOK' | 'REMOVER_WEBHOOK') => {
    setProcessandoHook(true);
    try {
      const res = await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.erro || d.error || 'Falha no webhook.');
      await carregar(false);
      mostrarToast(acao === 'INSTALAR_WEBHOOK' ? 'Status em tempo real ATIVADO — a Focus avisa o app na hora!' : 'Webhook desativado.', 'success');
    } catch (e) {
      mostrarToast(e instanceof Error ? e.message : 'Falha no webhook.', 'error');
    } finally {
      setProcessandoHook(false);
    }
  };

  const setF = (k: keyof Emitente, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const inputCls = 'w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-100';

  /* ===== chips de status ===== */
  const chipFocus = () => {
    if (!fiscal) return null;
    if (!fiscal.focusConfigurado)
      return <ChipStatus cor="bg-gray-100 text-gray-500 border-gray-200" icon="fa-circle-xmark" label="Não configurado (FOCUS_NFE_TOKEN)" />;
    if (fiscal.ambiente === 'producao')
      return <ChipStatus cor="bg-emerald-50 text-emerald-600 border-emerald-100" icon="fa-circle-check" label="Produção" />;
    return <ChipStatus cor="bg-amber-50 text-amber-600 border-amber-100" icon="fa-triangle-exclamation" label="Homologação" />;
  };

  const chipFonteEmitente = () => {
    if (!fiscal) return null;
    if (fiscal.emitenteFonte === 'app_settings')
      return <ChipStatus cor="bg-emerald-50 text-emerald-600 border-emerald-100" icon="fa-floppy-disk" label="Configurado aqui" />;
    if (fiscal.emitenteFonte === 'env')
      return <ChipStatus cor="bg-amber-50 text-amber-600 border-amber-100" icon="fa-cloud" label="Variável da Vercel (env)" />;
    return <ChipStatus cor="bg-gray-100 text-gray-500 border-gray-200" icon="fa-circle-xmark" label="Não configurado" />;
  };

  return (
    <div className="space-y-4 pb-10">
      {/* ===== HEADER (BLOCO 208: ícone no padrão das outras telas) ===== */}
      <div className="flex items-center gap-3 px-2">
        <button onClick={onBack} className="w-10 h-10 bg-white text-gray-500 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90 transition-transform flex-shrink-0">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
        <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0"><i className="fa-solid fa-gears text-sm"></i></span>
        <div className="min-w-0">
          <h2 className="text-xl font-black text-gray-800 tracking-tight truncate">ERP Fiscal &amp; Automações</h2>
          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Nota fiscal, boletos e estoque em um só lugar</p>
        </div>
      </div>

      {/* ===== LOADING ===== */}
      {carregando && (
        <>
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4 animate-pulse">
              <div className="h-4 w-44 bg-gray-100 rounded-lg"></div>
              <div className="h-3 w-full bg-gray-50 rounded-lg"></div>
              <div className="h-3 w-3/4 bg-gray-50 rounded-lg"></div>
              <div className="h-11 w-full bg-gray-50 rounded-xl"></div>
            </div>
          ))}
        </>
      )}

      {/* ===== ERRO ===== */}
      {!carregando && erro && (
        <div className="bg-rose-50 border border-rose-200 rounded-3xl p-6 mx-2 text-center space-y-3">
          <i className="fa-solid fa-triangle-exclamation text-rose-500 text-2xl block"></i>
          <p className="text-[11px] font-black text-rose-600 uppercase leading-snug">{erro}</p>
          <button onClick={() => carregar(true)} className="w-full py-3 rounded-xl text-[10px] font-black uppercase bg-rose-600 text-white active:scale-95 flex items-center justify-center gap-2">
            <i className="fa-solid fa-rotate-right"></i>Tentar novamente
          </button>
        </div>
      )}

      {/* ===== CARD 1 — NOTA FISCAL (Focus NFe) ===== */}
      {!carregando && !erro && fiscal && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
          <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-file-invoice text-emerald-600 mr-2"></i>Nota Fiscal (Focus NFe)</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {chipFocus()}
            {chipFonteEmitente()}
          </div>
          <p className="text-[10px] text-gray-400 font-semibold leading-snug">Emissão de NFC-e/NFe pela Focus NFe. O emitente abaixo é usado em toda nota — salvo aqui, vale para todos os aparelhos.</p>

          {/* BLOCO 116 — status em tempo real via webhook da Focus */}
          {focoWebhook && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {focoWebhook.instalado ? (
                  <ChipStatus cor="bg-emerald-50 text-emerald-600 border-emerald-100" icon="fa-bolt" label="Status em tempo real ATIVO" />
                ) : (
                  <ChipStatus cor="bg-gray-100 text-gray-500 border-gray-200" icon="fa-bolt" label="Status em tempo real desligado" />
                )}
                {!focoWebhook.segredoConfigurado && fiscal.focusConfigurado && (
                  <ChipStatus cor="bg-amber-50 text-amber-600 border-amber-100" icon="fa-key" label="Falta env de segredo" />
                )}
              </div>
              <p className="text-[9px] text-gray-400 font-semibold leading-snug">
                Quando a SEFAZ autoriza/rejeita a nota, a Focus avisa o app na hora — o status atualiza sozinho na fila de entregas e no histórico (sem esperar o cron). Instala 3 gatilhos de uma vez: NF-e, NFC-e e contingência da NFC-e (doc oficial da Focus). Instalação feita aqui mesmo, sem tocar no painel da Focus.
              </p>
              {focoWebhook.instalado && focoWebhook.eventos.length > 0 && (
                <p className="text-[9px] font-black text-emerald-600 uppercase">
                  Gatilhos ativos: {focoWebhook.eventos.join(' · ')}
                </p>
              )}
              <button
                onClick={() => acaoWebhook(focoWebhook.instalado ? 'REMOVER_WEBHOOK' : 'INSTALAR_WEBHOOK')}
                disabled={processandoHook || !fiscal.focusConfigurado || (!focoWebhook.instalado && !focoWebhook.segredoConfigurado)}
                className={`w-full py-3 rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 ${focoWebhook.instalado ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-emerald-600 text-white'}`}
              >
                <i className={`fa-solid ${processandoHook ? 'fa-spinner fa-spin' : focoWebhook.instalado ? 'fa-plug-circle-xmark' : 'fa-plug-circle-plus'}`}></i>
                {processandoHook ? 'Processando...' : focoWebhook.instalado ? 'Desativar status em tempo real' : 'Ativar status em tempo real'}
              </button>
              {focoWebhook.erro && <p className="text-[9px] font-bold text-amber-600 uppercase">{focoWebhook.erro}</p>}
            </div>
          )}

          <button
            onClick={() => setEmitenteAberto(a => !a)}
            className="w-full py-3 rounded-xl text-[10px] font-black uppercase bg-emerald-50 text-emerald-600 border border-emerald-100 active:scale-95 flex items-center justify-center gap-2"
          >
            <i className={`fa-solid ${emitenteAberto ? 'fa-chevron-up' : 'fa-id-card'}`}></i>
            {emitenteAberto ? 'Fechar dados do emitente' : 'Dados do emitente (CNPJ)'}
          </button>

          {emitenteAberto && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Campo label="CNPJ *">
                    <input
                      value={form.cnpj}
                      onChange={e => setF('cnpj', mascaraCnpj(e.target.value))}
                      placeholder="00.000.000/0000-00"
                      inputMode="numeric"
                      className={`${inputCls} ${form.cnpj && !cnpjOk ? 'ring-2 ring-rose-100 border-rose-200' : ''}`}
                    />
                  </Campo>
                  {form.cnpj && !cnpjOk && (
                    <p className="text-[9px] font-black text-rose-500 uppercase mt-1 ml-1"><i className="fa-solid fa-triangle-exclamation mr-1"></i>CNPJ precisa ter 14 dígitos</p>
                  )}
                </div>
                <div className="col-span-2"><Campo label="Razão social"><input value={form.razao} onChange={e => setF('razao', e.target.value)} className={inputCls} /></Campo></div>
                <div className="col-span-2"><Campo label="Nome fantasia"><input value={form.fantasia} onChange={e => setF('fantasia', e.target.value)} className={inputCls} /></Campo></div>
                <Campo label="Inscrição estadual"><input value={form.ie} onChange={e => setF('ie', e.target.value)} placeholder="Isento" className={inputCls} /></Campo>
                <Campo label="Regime tributário">
                  <select value={String(form.regime || 1)} onChange={e => setF('regime', Number(e.target.value))} className={inputCls}>
                    <option value="1">1 — Simples Nacional</option>
                    <option value="3">3 — Regime Normal</option>
                  </select>
                </Campo>
                <div className="col-span-2"><Campo label="Logradouro"><input value={form.logradouro} onChange={e => setF('logradouro', e.target.value)} placeholder="Rua, av, rodovia" className={inputCls} /></Campo></div>
                <Campo label="Número"><input value={form.numero} onChange={e => setF('numero', e.target.value)} className={inputCls} /></Campo>
                <Campo label="Bairro"><input value={form.bairro} onChange={e => setF('bairro', e.target.value)} className={inputCls} /></Campo>
                <div className="col-span-2"><Campo label="Município"><input value={form.municipio} onChange={e => setF('municipio', e.target.value)} className={inputCls} /></Campo></div>
                {/* BLOCO 217: UF agora é SELECT com os 27 estados — antes era
                    um input livre de 2 caracteres, que o dono não conseguia
                    atualizar (e o bug do merge apagava o CNPJ ao salvar). */}
                <Campo label="UF">
                  <select value={form.uf || ''} onChange={e => setF('uf', e.target.value.toUpperCase())} className={`${inputCls} uppercase`}>
                    <option value="">—</option>
                    {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="CEP"><input value={form.cep} onChange={e => setF('cep', mascaraCep(e.target.value))} placeholder="00000-000" inputMode="numeric" className={inputCls} /></Campo>
              </div>

              <button
                onClick={salvarEmitente}
                disabled={!cnpjOk || !emitenteMudou || salvandoEmitente}
                className="w-full py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-600 text-white active:scale-95 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100"
              >
                {salvandoEmitente ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                {salvandoEmitente ? 'Salvando...' : 'Salvar emitente'}
              </button>
              <p className="text-[9px] font-bold text-gray-400 uppercase text-center">
                {!cnpjOk ? 'CNPJ com 14 dígitos é obrigatório' : emitenteMudou ? `${Object.keys(emitenteDiff).length} campo(s) alterado(s)` : 'Nenhuma alteração pendente'}
              </p>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3 pr-2">
                <i className="fa-solid fa-bolt text-emerald-500 mt-1"></i>
                <div>
                  <p className="text-[11px] font-bold text-gray-600 uppercase">Emitir NFC-e automática ao finalizar pronta entrega</p>
                  <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">No PDV, a nota sai sozinha junto com o cupom — sem tela extra de emissão.</p>
                </div>
              </div>
              <Switch on={fiscal.nfeAutoPe} disabled={salvandoSwitch !== null} onClick={() => alternarSwitch('nfeAutoPe', !fiscal.nfeAutoPe)} />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-50 pt-3">
              <div className="flex items-start gap-3 pr-2">
                <i className="fa-solid fa-receipt text-amber-500 mt-1"></i>
                <div>
                  <p className="text-[11px] font-bold text-gray-600 uppercase">Cliente só cupom → NFC anônima com preço cupom</p>
                  <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">Venda sem identificação vira NFC-e anônima no valor do cupom (sem CPF/CNPJ do cliente).</p>
                </div>
              </div>
              <Switch on={fiscal.cupomDuploNfc} disabled={salvandoSwitch !== null} onClick={() => alternarSwitch('cupomDuploNfc', !fiscal.cupomDuploNfc)} />
            </div>
          </div>
        </div>
      )}

      {/* ===== CARD 2 — BOLETOS (Banco Inter) ===== */}
      {!carregando && !erro && boleto && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-4">
          <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-file-invoice-dollar text-teal-600 mr-2"></i>Boletos (Banco Inter)</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {boleto.interConfigurado
              ? <ChipStatus cor="bg-emerald-50 text-emerald-600 border-emerald-100" icon="fa-circle-check" label="Inter configurado" />
              : <ChipStatus cor="bg-gray-100 text-gray-500 border-gray-200" icon="fa-circle-xmark" label="Não configurado" />}
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-2">
            <p className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-1.5"><i className="fa-solid fa-webhook text-teal-600"></i>Webhook de cobrança (baixa automática do boleto pago)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-[10px] font-bold text-slate-700 truncate">{webhookUrl}</code>
              <button onClick={copiarWebhook} className="shrink-0 bg-teal-600 text-white h-10 px-4 rounded-xl text-[9px] font-black uppercase active:scale-95 flex items-center gap-1.5">
                <i className="fa-solid fa-copy"></i>Copiar
              </button>
            </div>
            {/* BLOCO 220 — PAINEL DA BAIXA AUTOMÁTICA: o Internet Banking do
                Inter NÃO tem tela para cadastrar webhook (a doc oficial manda
                cadastrar PELA API da Cobrança V3). Este painel verifica o estado
                REAL no Inter e ativa/remover em um clique. */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 mt-1 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-black text-slate-600 uppercase">Situação no Inter (consultada na hora, na fonte oficial)</p>
                <button onClick={alternarPainelInter} disabled={painelCarregando} aria-expanded={painelAberto} className="text-[9px] font-black uppercase text-teal-600 underline disabled:opacity-50 px-1 py-1 flex-shrink-0">
                  <i className={`fa-solid ${painelCarregando ? 'fa-spinner fa-spin' : 'fa-rotate-right'} mr-1`}></i>Verificar
                </button>
              </div>

              {!painelAberto && (
                <p className="text-[9px] font-semibold text-gray-400 leading-snug">
                  O Internet Banking do Inter <strong className="text-gray-500">não tem tela para cadastrar webhook</strong> (por isso você não encontrava a função) — o cadastro é feito pela <strong className="text-gray-500">API oficial do Inter</strong>. Clique em <strong className="text-teal-600">Verificar</strong> para consultar a situação real e ativar a baixa automática em um clique, sem sair daqui.
                </p>
              )}

              {painelAberto && painelCarregando && !painelInter && (
                <p className="text-[9px] font-black text-gray-300 uppercase py-2 text-center"><i className="fa-solid fa-spinner fa-spin mr-1"></i>Consultando o Inter...</p>
              )}
              {painelAberto && !painelCarregando && !painelInter && (
                <p className="text-[9px] font-bold text-rose-500 uppercase leading-snug">Não foi possível consultar o Inter agora — tente novamente em instantes.</p>
              )}

              {painelAberto && painelInter && (
                <div className="space-y-2.5">
                  {/* Estado REAL do webhook no Inter */}
                  {painelInter.webhook?.cadastrado ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                      <p className="text-[10px] font-black text-emerald-700 uppercase flex items-center gap-1.5"><i className="fa-solid fa-circle-check"></i>Webhook ATIVO no Inter — baixa automática ligada</p>
                      <p className="text-[8px] font-bold text-emerald-600/80 mt-1 break-all">{painelInter.webhook.url || webhookUrl}</p>
                      {painelInter.webhook.atualizacao && (
                        <p className="text-[8px] font-semibold text-emerald-600/70 mt-0.5">Cadastrado/atualizado em {new Date(painelInter.webhook.atualizacao).toLocaleString('pt-BR')}</p>
                      )}
                      {painelInter.webhook.url && painelInter.webhook.url !== webhookUrl && (
                        <p className="text-[8px] font-bold text-amber-600 mt-1">Atenção: o Inter está apontando para outra URL. Use &quot;Reapontar&quot; abaixo para corrigir para a URL deste app.</p>
                      )}
                    </div>
                  ) : painelInter.webhook?.ok ? (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <p className="text-[10px] font-black text-amber-700 uppercase flex items-center gap-1.5"><i className="fa-solid fa-triangle-exclamation"></i>Webhook ainda NÃO cadastrado no Inter</p>
                      <p className="text-[9px] font-semibold text-amber-600 leading-snug mt-1">Ative agora: o app cadastra sozinho na API do Inter (usa o certificado já configurado). Sem Internet Banking, sem Postman, sem suporte do banco.</p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] font-black text-gray-600 uppercase"><i className="fa-solid fa-circle-question mr-1.5"></i>Não foi possível verificar o cadastro</p>
                      <p className="text-[9px] font-semibold text-gray-400 leading-snug mt-1 break-words">
                        {painelInter.webhook?.erro || 'Sem resposta do Inter.'}
                        {painelInter.webhook?.semCredenciais ? ' — neste ambiente (dev/preview) não há credenciais do Inter; na produção (Vercel) a verificação funciona.' : ''}
                      </p>
                    </div>
                  )}

                  {/* Ações de cadastro/remoção (PUT/DELETE direto na API do Inter) */}
                  {!painelInter.webhook?.cadastrado && painelInter.webhook?.ok && (
                    <button onClick={() => void acaoWebhookInter('CADASTRAR')} disabled={acaoInter !== null} className="w-full bg-emerald-600 text-white h-11 rounded-xl text-[10px] font-black uppercase tracking-wide active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                      <i className={`fa-solid ${acaoInter ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i>{acaoInter ? 'Ativando no Inter...' : 'Ativar baixa automática agora'}
                    </button>
                  )}
                  {painelInter.webhook?.cadastrado && (
                    <div className="flex gap-2">
                      <button onClick={() => void acaoWebhookInter('CADASTRAR')} disabled={acaoInter !== null} className="flex-1 bg-teal-50 text-teal-700 border border-teal-100 h-9 rounded-xl text-[9px] font-black uppercase active:scale-95 disabled:opacity-60">
                        <i className={`fa-solid ${acaoInter === 'CADASTRAR' ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'} mr-1`}></i>Reapontar p/ esta URL
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Remover o webhook do Inter? A baixa automática para (o sync diário continua).')) void acaoWebhookInter('EXCLUIR'); }}
                        disabled={acaoInter !== null}
                        className="flex-1 bg-rose-50 text-rose-600 border border-rose-100 h-9 rounded-xl text-[9px] font-black uppercase active:scale-95 disabled:opacity-60"
                      >
                        <i className={`fa-solid ${acaoInter === 'EXCLUIR' ? 'fa-spinner fa-spin' : 'fa-trash-can'} mr-1`}></i>Remover
                      </button>
                    </div>
                  )}

                  {/* SINCRONIZAÇÃO — frequência real + botão manual */}
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1.5">
                    <p className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-1.5"><i className="fa-solid fa-arrows-rotate text-teal-600"></i>Sincronização (com que frequência atualiza)</p>
                    <ul className="text-[8px] font-semibold text-gray-500 leading-relaxed space-y-0.5">
                      <li>• Tempo real: webhook do Inter avisa o app na hora do pagamento (se falhar, o Inter reenvia em 20/30/60/120 min).</li>
                      <li>• Rede de segurança: sync automático 1x/dia às 07h (Brasília) + botão abaixo quando você quiser.</li>
                      {painelInter.filaAberta !== null && <li>• Boletos em aberto monitorados agora: <strong className="text-gray-600">{painelInter.filaAberta}</strong>.</li>}
                      {painelInter.ultimoSync && (
                        <li>• Último sync: {new Date(painelInter.ultimoSync.em).toLocaleString('pt-BR')} — {painelInter.ultimoSync.resultado}</li>
                      )}
                    </ul>
                    <button onClick={() => void sincronizarBoletosAgora()} disabled={syncRodando} className="w-full bg-slate-700 text-white h-9 rounded-xl text-[9px] font-black uppercase active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2">
                      <i className={`fa-solid ${syncRodando ? 'fa-spinner fa-spin' : 'fa-rocket'} mr-1`}></i>{syncRodando ? 'Sincronizando...' : 'Sincronizar agora'}
                    </button>
                    {syncResultado && <p className="text-[8px] font-bold text-gray-500 leading-snug">{syncResultado}</p>}
                  </div>

                  <p className="text-[8px] font-bold text-slate-400 leading-snug">Segurança: o aviso do Inter não move nada sozinho — o app SEMPRE re-consulta a cobrança direto no banco (mTLS) antes de baixar. Cada ação de ativação/remoção fica no log de eventos abaixo (origem CONFIG).</p>
                </div>
              )}
            </div>
          </div>

          {/* BLOCO 167 — LOG DE EVENTOS DO WEBHOOK (pagamentos e recebimentos registrados) */}
          <div className="border-t border-gray-50 pt-3 space-y-2">
            <button onClick={alternarLogWebhook} className="w-full flex items-center justify-between gap-2 text-left" aria-expanded={logAberto}>
              <div className="flex items-start gap-3">
                <i className="fa-solid fa-clipboard-list text-teal-500 mt-1"></i>
                <div>
                  <p className="text-[11px] font-bold text-gray-600 uppercase">Log de eventos do webhook (pagamentos)</p>
                  <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">Todo aviso do Inter fica registrado: boleto pago, baixa automática, avisos e erros — com data/hora.</p>
                </div>
              </div>
              <i className={`fa-solid fa-chevron-${logAberto ? 'up' : 'down'} text-gray-300 text-xs flex-shrink-0`}></i>
            </button>
            {logAberto && (
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[8px] font-black text-slate-400 uppercase">Últimos 60 eventos</p>
                  <button onClick={() => void carregarLogWebhook()} disabled={logHookCarregando} className="text-[9px] font-black uppercase text-teal-600 underline disabled:opacity-50 px-2 py-1">
                    <i className={`fa-solid ${logHookCarregando ? 'fa-spinner fa-spin' : 'fa-rotate-right'} mr-1`}></i>Atualizar
                  </button>
                </div>
                {logHookErro && <p className="text-[9px] font-bold text-rose-500 uppercase leading-snug">{logHookErro}</p>}
                {!logHookErro && logHookCarregando && <p className="text-[9px] font-black text-gray-300 uppercase py-3 text-center"><i className="fa-solid fa-spinner fa-spin mr-1"></i>Carregando log...</p>}
                {!logHookErro && !logHookCarregando && (logHook || []).length === 0 && (
                  <p className="text-[9px] font-bold text-gray-400 uppercase leading-snug">Nenhum evento ainda. O Inter manda o primeiro aviso quando o primeiro boleto pagar (ou quando você testar o webhook).</p>
                )}
                {!logHookErro && !logHookCarregando && logHook !== null && logHook.length > 0 && (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {logHook.map((e) => (
                      <div key={e.id} className="bg-white border border-slate-100 rounded-xl px-3 py-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md ${e.processado ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                              {e.processado ? 'processado' : 'aviso/erro'}
                            </span>
                            {e.origem === 'CRON' && (
                              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-600">sync diário</span>
                            )}
                          </div>
                          <span className="text-[8px] font-bold text-gray-400">{new Date(e.criadoEm).toLocaleDateString('pt-BR')} {new Date(e.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-[9px] font-bold text-gray-600 leading-snug mt-1 break-words">{e.resultado}</p>
                        {(e.saleId || e.codigo) && (
                          <p className="text-[8px] font-semibold text-gray-400 mt-0.5 break-all">venda {e.saleId ? e.saleId.slice(0, 8).toUpperCase() : '—'}{e.codigo ? ` · cobrança ${String(e.codigo).slice(0, 18)}…` : ''}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[8px] font-semibold text-gray-400 leading-snug mt-2">O recebimento de cada boleto também fica gravado no histórico da venda (detalhe do pagamento) e no Contas a Receber.</p>
              </div>
            )}
          </div>

          {/* BLOCO 172 — LOG DE PAGAMENTOS E RECEBIMENTOS (automático x manual) */}
          <div className="border-t border-gray-50 pt-3 space-y-2">
            <button onClick={alternarLogRecebimentos} className="w-full flex items-center justify-between gap-2 text-left" aria-expanded={recLogAberto}>
              <div className="flex items-start gap-3">
                <i className="fa-solid fa-piggy-bank text-teal-500 mt-1"></i>
                <div>
                  <p className="text-[11px] font-bold text-gray-600 uppercase">Log de pagamentos e recebimentos</p>
                  <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">De onde veio cada baixa: automática (webhook/sync do Inter), Pix do portal ou baixa manual (por quem). Últimos 40.</p>
                </div>
              </div>
              <i className={`fa-solid fa-chevron-${recLogAberto ? 'up' : 'down'} text-gray-300 text-xs flex-shrink-0`}></i>
            </button>
            {recLogAberto && (
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[8px] font-black text-slate-400 uppercase">Últimos 40 recebimentos</p>
                  <button onClick={() => void carregarLogRecebimentos()} disabled={recLogCarregando} className="text-[9px] font-black uppercase text-teal-600 underline disabled:opacity-50 px-2 py-1">
                    <i className={`fa-solid ${recLogCarregando ? 'fa-spinner fa-spin' : 'fa-rotate-right'} mr-1`}></i>Atualizar
                  </button>
                </div>
                {recLogErro && <p className="text-[9px] font-bold text-rose-500 uppercase leading-snug">{recLogErro}</p>}
                {!recLogErro && recLogCarregando && <p className="text-[9px] font-black text-gray-300 uppercase py-3 text-center"><i className="fa-solid fa-spinner fa-spin mr-1"></i>Carregando log...</p>}
                {!recLogErro && !recLogCarregando && (recLog || []).length === 0 && (
                  <p className="text-[9px] font-bold text-gray-400 uppercase leading-snug">
                    Nenhum recebimento com origem registrada ainda. {recLog === null ? '' : 'Rode o SQL do Bloco 172 no Supabase (o dono recebeu no chat) — as próximas baixas (automáticas e manuais) aparecem aqui com a origem.'}
                  </p>
                )}
                {!recLogErro && !recLogCarregando && recLog !== null && recLog.length > 0 && (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {recLog.map((r) => {
                      const o = origemBaixa(r.baixaOrigem);
                      return (
                        <div key={r.id} className="bg-white border border-slate-100 rounded-xl px-3 py-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 ${o.cls}`}>
                              <i className={`fa-solid ${o.icon}`}></i>{o.label}
                            </span>
                            <span className="text-[8px] font-bold text-gray-400">{new Date(r.baixaEm).toLocaleDateString('pt-BR')} {new Date(r.baixaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
                            <p className="text-[10px] font-black text-gray-700 uppercase break-words min-w-0">{r.cliente}</p>
                            <p className="text-[11px] font-black text-emerald-600 tabular-nums flex-shrink-0">{r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                          </div>
                          {r.baixaOrigem === 'MANUAL' && /— por (.+)$/.test(r.detalhe) && (
                            <p className="text-[8px] font-bold text-amber-600 uppercase mt-0.5">Recebido por {r.detalhe.match(/— por (.+)$/)?.[1] || ''}</p>
                          )}
                          <p className="text-[8px] font-semibold text-gray-400 mt-0.5 truncate">{r.metodo || '—'}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[8px] font-semibold text-gray-400 leading-snug mt-2">Automáticos = o banco avisou (webhook/sync). Manuais = alguém deu baixa no Contas a Receber — sempre com o nome de quem recebeu.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-50 pt-3">
            <div className="flex items-start gap-3 pr-2">
              <i className="fa-solid fa-wand-magic-sparkles text-teal-500 mt-1"></i>
              <div>
                <p className="text-[11px] font-bold text-gray-600 uppercase">Gerar boleto automaticamente em venda a prazo</p>
                <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">Ao registrar venda a prazo, o boleto já nasce no Inter — sem digitar nada no Internet Banking.</p>
              </div>
            </div>
            <Switch on={boleto.autoBoletoAReceber} disabled={salvandoSwitch !== null} onClick={() => alternarSwitch('boletoAutoAReceber', !boleto.autoBoletoAReceber)} />
          </div>

          {/* ===== BLOCO 152 — TEXTO PADRÃO DO BOLETO (mensagem do beneficiário) ===== */}
          <div className="border-t border-gray-50 pt-3 space-y-2">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-comment-dots text-teal-500 mt-1"></i>
              <div className="flex-1">
                <p className="text-[11px] font-bold text-gray-600 uppercase">Mensagem padrão do boleto</p>
                <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">Texto fixo impresso pelo Inter no PDF de TODO boleto novo, na seção <strong className="text-gray-500">Informações de Responsabilidade do Beneficiário</strong> (vai junto com “Venda XXX - Doce Mania”). Máx. 78 caracteres.</p>
              </div>
            </div>
            <input
              type="text"
              value={msgPadraoInput}
              maxLength={78}
              onChange={(e) => setMsgPadraoInput(e.target.value.slice(0, 78))}
              placeholder="Ex.: Pague via PIX e ganhe 5% de desconto na próxima compra"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-teal-400"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-black text-gray-400">{msgPadraoInput.length}/78</span>
              <div className="flex gap-2">
                {msgPadraoInput !== (boleto.mensagemPadrao || '') && (
                  <button onClick={() => setMsgPadraoInput(boleto.mensagemPadrao || '')} className="text-[9px] font-black uppercase text-gray-400 underline active:scale-95 px-2 py-1.5">Cancelar</button>
                )}
                <button
                  onClick={salvarMensagemPadrao}
                  disabled={salvandoMsgPadrao || msgPadraoInput === (boleto.mensagemPadrao || '')}
                  className="bg-teal-600 text-white font-black px-4 py-2 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <i className={`fa-solid ${salvandoMsgPadrao ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>Salvar
                </button>
              </div>
            </div>
          </div>

          {/* ===== BLOCO 205 — MENSAGEM DE COBRANÇA (Portal de Cobranças) ===== */}
          <div className="border-t border-gray-50 pt-3 space-y-2">
            <div className="flex items-start gap-3">
              <i className="fa-solid fa-bell text-rose-500 mt-1"></i>
              <div className="flex-1">
                <p className="text-[11px] font-bold text-gray-600 uppercase">Mensagem de cobrança (boletos atrasados)</p>
                <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">Texto enviado ao cliente pelo <strong className="text-gray-500">Portal de Cobranças</strong> (boletos atrasados do Inter). Os marcadores viram os dados de cada boleto: <span className="font-mono text-gray-500">{'{nome}'} {'{valor}'} {'{vencimento}'} {'{dias}'}</span>.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS_COBRANCA.map((ph) => (
                <button
                  key={ph}
                  onClick={() => setMsgCobrancaInput((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}${ph}`)}
                  className="text-[9px] font-black uppercase bg-rose-50 border border-rose-100 text-rose-600 px-2.5 py-1.5 rounded-lg active:scale-95 transition-transform"
                  title="Adicionar ao texto"
                >{ph}</button>
              ))}
            </div>
            <textarea
              value={msgCobrancaInput}
              onChange={(e) => setMsgCobrancaInput(e.target.value.slice(0, 600))}
              rows={4}
              maxLength={600}
              placeholder="Ex.: Olá {nome}! O boleto de {valor} venceu em {vencimento} ({dias} dia(s) de atraso). Quando puder, me manda o comprovante. Obrigado!"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-rose-400 resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-black text-gray-400">{msgCobrancaInput.length}/600</span>
              <div className="flex gap-2">
                {msgCobrancaInput !== (boleto.cobrancaMensagem || '') && (
                  <button onClick={() => setMsgCobrancaInput(boleto.cobrancaMensagem || '')} className="text-[9px] font-black uppercase text-gray-400 underline active:scale-95 px-2 py-1.5">Cancelar</button>
                )}
                <button
                  onClick={salvarMensagemCobranca}
                  disabled={salvandoMsgCobranca || msgCobrancaInput === (boleto.cobrancaMensagem || '')}
                  className="bg-rose-600 text-white font-black px-4 py-2 rounded-xl text-[9px] uppercase tracking-widest active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <i className={`fa-solid ${salvandoMsgCobranca ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>Salvar
                </button>
              </div>
            </div>
            <p className="text-[8px] text-gray-400 font-semibold leading-snug">Também edita no próprio Portal de Cobranças (botão “Mensagem de cobrança”) — é o mesmo texto.</p>
          </div>
        </div>
      )}

      {/* ===== CARD 4 — ESTOQUE ===== */}
      {!carregando && !erro && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-3">
          <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-boxes-stacked text-slate-600 mr-2"></i>Estoque</h3>
          <p className="text-[10px] text-gray-400 font-semibold leading-snug">Histórico completo do kardex e importação de entradas — tudo ligado ao estoque central dos produtos.</p>

          <button onClick={onAbrirMovimentos} className="w-full p-3.5 rounded-xl bg-slate-800 text-white flex items-center gap-3 active:scale-95 transition-transform shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-right-left"></i></div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide">Movimentações de estoque</p>
              <p className="text-[9px] font-bold opacity-60 normal-case">Entradas e saídas (kardex completo)</p>
            </div>
            <i className="fa-solid fa-chevron-right text-[10px] opacity-60"></i>
          </button>

          <button disabled className="w-full p-3.5 rounded-xl bg-white border border-gray-100 text-gray-300 flex items-center gap-3 relative cursor-not-allowed">
            <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-file-import"></i></div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide">Nova entrada por XML</p>
              <p className="text-[9px] font-bold text-gray-300 normal-case">Importar notas de compra dos fornecedores</p>
            </div>
            <span className="absolute -top-2 right-3 bg-amber-100 text-amber-600 text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wide">Em breve (importador manual em uso)</span>
          </button>
        </div>
      )}

      {/* ===== CARD 5 — IMPRESSÃO (BLOCO 112) ===== */}
      {!carregando && !erro && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-3">
          <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-print text-slate-600 mr-2"></i>Impressão</h3>
          <p className="text-[10px] text-gray-400 font-semibold leading-snug">Ajuste do cupom térmico — vale para a impressora Bluetooth e para a térmica USB do PC <strong className="text-gray-500">neste aparelho</strong>.</p>

          <div className="flex items-center justify-between gap-3 border-t border-gray-50 pt-3">
            <div className="flex items-start gap-3 pr-2">
              <i className="fa-solid fa-bolt text-amber-500 mt-1"></i>
              <div>
                <p className="text-[11px] font-bold text-gray-600 uppercase">Reforço de impressão (cupom mais escuro)</p>
                <p className="text-[9px] text-gray-400 font-semibold leading-snug mt-0.5">Cupom inteiro em negrito na térmica — use quando a impressão sair clara. Desligue se preferir o traço fino.</p>
              </div>
            </div>
            <Switch on={reforco} onClick={() => { const v = !reforco; setReforco(v); salvarReforcoImpressao(v); mostrarToast(v ? 'Reforço LIGADO neste aparelho' : 'Reforço DESLIGADO neste aparelho', 'success'); }} />
          </div>

          {/* MINI DANFE — visualizar o modelo antes de imprimir (BLOCO 152: mini boleto excluído — boleto = PDF original do Inter) */}
          <button onClick={() => setModelosAberto(true)} className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-slate-900 text-white active:scale-[0.98] transition-transform">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-file-receipt"></i></div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[11px] font-black uppercase tracking-wide">Ver modelo de impressão 80mm</p>
              <p className="text-[9px] font-bold text-white/60 normal-case leading-snug">Mini DANFE (retrato) — como sai na térmica Bluetooth ou USB</p>
            </div>
            <i className="fa-solid fa-chevron-right text-[10px] opacity-60"></i>
          </button>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <p className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-1.5 mb-1.5"><i className="fa-solid fa-circle-info text-teal-600"></i>Cupom ainda saindo claro?</p>
            <ul className="text-[9px] font-semibold text-gray-500 leading-snug space-y-1 list-decimal list-inside">
              <li>Impressora portátil: bateria fraca é a causa nº 1 — carregue até o fim e teste de novo.</li>
              <li>PC (USB): Propriedades da impressora no Windows → Preferências de impressão → diminua a VELOCIDADE ou aumente a DENSIDADE.</li>
              <li>Limpe a cabeça térmica (pó/graxa) e use papel térmico de qualidade, no lado certo.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ===== TOAST LOCAL ===== */}
      {toast && (
        <div className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[500] px-5 py-3 rounded-2xl shadow-xl text-[11px] font-black uppercase tracking-wide flex items-center gap-2 max-w-[92vw] text-center ${toast.tipo === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          <i className={`fa-solid ${toast.tipo === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>{toast.msg}
        </div>
      )}

      {/* ===== MINI DANFE — MODELO DE IMPRESSÃO 80mm ===== */}
      <ModelosImpressao abrir={modelosAberto} onClose={() => setModelosAberto(false)} showToast={mostrarToast} />
    </div>
  );
};

export default ConfiguracoesHub;
