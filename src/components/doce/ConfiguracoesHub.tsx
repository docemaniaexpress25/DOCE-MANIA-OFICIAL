"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { authHeaders } from '@/services/userService';
// BLOCO 112: reforço de impressão (config POR DISPOSITIVO em localStorage —
// não vai para o banco: cada aparelho/impressora tem sua calibração)
import { lerReforcoImpressao, salvarReforcoImpressao } from '@/lib/usbPrint';

/**
 * ERP FISCAL & AUTOMAÇÕES — hub de configurações organizado em cards que expandem.
 * Nada amontoado numa tela só: Nota Fiscal (Focus NFe), Boletos (Banco Inter) e Estoque.
 * GET  /api/configuracoes  → { ok, fiscal, boleto, pix }
 * POST /api/configuracoes  → envia SOMENTE o que mudou: { emitente?, nfeAutoPe?, cupomDuploNfc?, boletoAutoAReceber? }
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
    className={`w-12 h-7 rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-emerald-600' : 'bg-gray-300'} ${disabled ? 'opacity-60' : ''}`}
  >
    <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-all shadow-sm ${on ? 'left-5.5' : 'left-0.5'}`}></div>
  </button>
);

const ChipStatus = ({ cor, icon, label }: { cor: string; icon: string; label: string }) => (
  <span className={`text-[9px] font-black uppercase tracking-wide px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 ${cor}`}>
    <i className={`fa-solid ${icon} text-[8px]`}></i>{label}
  </span>
);

const ConfiguracoesHub: React.FC<Props> = ({ onBack, onAbrirMovimentos }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [fiscal, setFiscal] = useState<FiscalConfig | null>(null);
  const [boleto, setBoleto] = useState<BoletoConfig | null>(null);
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

  const [toast, setToast] = useState<{ msg: string; tipo: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mostrarToast = (msg: string, tipo: 'success' | 'error') => {
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
      });
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
      {/* ===== HEADER ===== */}
      <div className="flex items-center gap-3 px-2">
        <button onClick={onBack} className="w-10 h-10 bg-white text-gray-500 rounded-xl flex items-center justify-center shadow-sm border border-gray-100 active:scale-90 transition-transform flex-shrink-0">
          <i className="fa-solid fa-arrow-left"></i>
        </button>
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
                <p className="text-[8px] font-black text-emerald-600 uppercase">
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
              {focoWebhook.erro && <p className="text-[8px] font-bold text-amber-600 uppercase">{focoWebhook.erro}</p>}
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
                    <p className="text-[8px] font-black text-rose-500 uppercase mt-1 ml-1"><i className="fa-solid fa-triangle-exclamation mr-1"></i>CNPJ precisa ter 14 dígitos</p>
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
                <Campo label="UF">
                  <input value={form.uf} onChange={e => setF('uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="RS" maxLength={2} className={`${inputCls} uppercase`} />
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
              <p className="text-[8px] font-bold text-gray-400 uppercase text-center">
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
            <p className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-1.5"><i className="fa-solid fa-webhook text-teal-600"></i>Webhook a cadastrar no Internet Banking do Inter</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-[10px] font-bold text-slate-700 truncate">{webhookUrl}</code>
              <button onClick={copiarWebhook} className="shrink-0 bg-teal-600 text-white h-10 px-4 rounded-xl text-[9px] font-black uppercase active:scale-95 flex items-center gap-1.5">
                <i className="fa-solid fa-copy"></i>Copiar
              </button>
            </div>
            <p className="text-[8px] font-semibold text-slate-400 leading-snug">Cole essa URL em Inter API → Webhooks (cobrança) para o sistema receber a baixa automática dos boletos.</p>
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
        </div>
      )}

      {/* ===== CARD 3 — ESTOQUE ===== */}
      {!carregando && !erro && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm mx-2 space-y-3">
          <h3 className="font-black text-gray-800 uppercase text-xs tracking-wider"><i className="fa-solid fa-boxes-stacked text-slate-600 mr-2"></i>Estoque</h3>
          <p className="text-[10px] text-gray-400 font-semibold leading-snug">Histórico completo do kardex e importação de entradas — tudo ligado ao estoque central dos produtos.</p>

          <button onClick={onAbrirMovimentos} className="w-full p-3.5 rounded-xl bg-slate-800 text-white flex items-center gap-3 active:scale-95 transition-transform shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-right-left"></i></div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide">Movimentações de estoque</p>
              <p className="text-[8px] font-bold opacity-60 normal-case">Entradas e saídas (kardex completo)</p>
            </div>
            <i className="fa-solid fa-chevron-right text-[10px] opacity-60"></i>
          </button>

          <button disabled className="w-full p-3.5 rounded-xl bg-white border border-gray-100 text-gray-300 flex items-center gap-3 relative cursor-not-allowed">
            <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-file-import"></i></div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide">Nova entrada por XML</p>
              <p className="text-[8px] font-bold text-gray-300 normal-case">Importar notas de compra dos fornecedores</p>
            </div>
            <span className="absolute -top-2 right-3 bg-amber-100 text-amber-600 text-[7px] font-black px-2 py-0.5 rounded-md uppercase tracking-wide">Em breve (importador manual em uso)</span>
          </button>
        </div>
      )}

      {/* ===== CARD 4 — IMPRESSÃO (BLOCO 112) ===== */}
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
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] px-5 py-3 rounded-2xl shadow-xl text-[11px] font-black uppercase tracking-wide flex items-center gap-2 max-w-[92vw] text-center ${toast.tipo === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          <i className={`fa-solid ${toast.tipo === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`}></i>{toast.msg}
        </div>
      )}
    </div>
  );
};

export default ConfiguracoesHub;
