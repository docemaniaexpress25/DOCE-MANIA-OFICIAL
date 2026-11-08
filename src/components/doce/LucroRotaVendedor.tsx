"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '@/services/userService';
import ConfirmModal from '@/components/doce/ConfirmModal';

/**
 * BLOCO 92 — LUCRO DA ROTA (aba exclusiva do vendedor David — R5)
 *
 * A conta do dono na mão do vendedor:
 *   Faturamento (venda REAL finalizada) − Custo (CONGELADO na venda)
 *   = Lucro Bruto (R$ + %)  −  Despesas lançadas por ele  =  Lucro Líquido (R$ + %).
 * Despesas gravam na MESMA tabela do Financeiro (seller_expenses) — o acerto
 * de comissões do admin já desconta. Cada vendedor só enxerga a própria rota
 * (a API corta pela sessão).
 */

interface AccFechada { nVendas: number; faturamento: number; custo: number; lucro: number; margem: number }
interface DiaAcc extends AccFechada { dia: string }
interface Despesa { id: string; descricao: string; valor: number; data: string }
interface LucroRotaData {
  ok: boolean;
  mes: string;
  totais: AccFechada & { ticketMedio: number; despesasTotal: number; despesasPct: number; lucroLiquido: number; margemLiquida: number };
  pago: AccFechada;
  aReceber: AccFechada;
  porDia: DiaAcc[];
  despesas: Despesa[];
  avisos: { custoCongelado: boolean; detalhe: string };
}

interface LucroRotaVendedorProps {
  user: { id: string; nome: string; role: string; rota?: string };
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const fmtBRL = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => `${(Number.isFinite(v) ? v : 0).toFixed(1).replace('.', ',')}%`;

/** Mês corrente no fuso de São Paulo (UTC-3 fixo), como YYYY-MM */
const mesCorrenteSP = (): string => {
  const sp = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${sp.getUTCFullYear()}-${String(sp.getUTCMonth() + 1).padStart(2, '0')}`;
};

const somarMes = (mes: string, delta: number): string => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const corMargem = (m: number): { txt: string; bg: string; barra: string } =>
  m >= 20 ? { txt: 'text-emerald-600', bg: 'bg-emerald-50', barra: 'bg-emerald-500' }
  : m >= 10 ? { txt: 'text-amber-600', bg: 'bg-amber-50', barra: 'bg-amber-500' }
  : { txt: 'text-rose-600', bg: 'bg-rose-50', barra: 'bg-rose-500' };

const BarraMargem: React.FC<{ pct: number; cor: string }> = ({ pct, cor }) => (
  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all duration-700 ${cor}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
);

const Skeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-24 bg-gray-100 rounded-3xl" />
    <div className="grid grid-cols-2 gap-4"><div className="h-28 bg-gray-100 rounded-3xl" /><div className="h-28 bg-gray-100 rounded-3xl" /></div>
    <div className="h-20 bg-gray-100 rounded-3xl" />
    <div className="h-48 bg-gray-100 rounded-3xl" />
  </div>
);

const LucroRotaVendedor: React.FC<LucroRotaVendedorProps> = ({ user, showToast }) => {
  const [mes, setMes] = useState<string>(() => mesCorrenteSP());
  const [data, setData] = useState<LucroRotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [desc, setDesc] = useState('');
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [excluir, setExcluir] = useState<Despesa | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(async (m: string) => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(`/api/vendedor/lucro-rota?mes=${m}`, { headers: authHeaders(), cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErro(d?.error || 'Não foi possível carregar o lucro da rota.');
        setData(null);
      } else {
        setData(d as LucroRotaData);
      }
    } catch {
      setErro('Sem conexão. Verifique a internet e tente novamente.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(mes); }, [mes, carregar]);

  const mesRotulo = useMemo(() => {
    const [y, m] = mes.split('-').map(Number);
    return `${MESES_PT[m - 1]} ${y}`;
  }, [mes]);
  const podeAvancar = mes < mesCorrenteSP();

  const lancar = async () => {
    const v = Number(valor.replace(',', '.'));
    if (!desc.trim()) { showToast('Descreva a despesa (ex: Combustível).', 'error'); return; }
    if (!Number.isFinite(v) || v <= 0) { showToast('Informe um valor maior que zero.', 'error'); return; }
    setSalvando(true);
    try {
      const res = await fetch('/api/vendedor/lucro-rota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ descricao: desc.trim(), valor: v }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast(d?.error || 'Erro ao lançar a despesa.', 'error');
      } else {
        showToast('Despesa lançada!');
        setDesc(''); setValor(''); setFormAberto(false);
        await carregar(mes);
      }
    } catch {
      showToast('Sem conexão. Tente novamente.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setExcluindo(true);
    try {
      const res = await fetch(`/api/vendedor/lucro-rota?id=${encodeURIComponent(excluir.id)}`, { method: 'DELETE', headers: authHeaders() });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        showToast(d?.error || 'Erro ao excluir a despesa.', 'error');
      } else {
        showToast('Despesa excluída.');
        setExcluir(null);
        await carregar(mes);
      }
    } catch {
      showToast('Sem conexão. Tente novamente.', 'error');
    } finally {
      setExcluindo(false);
    }
  };

  const t = data?.totais;
  const temVenda = !!t && t.nVendas > 0;

  return (
    <div className="space-y-4 pb-24">
      {/* ===== Cabeçalho + navegação de mês ===== */}
      <header className="px-1 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-gray-800 tracking-tight leading-none">Lucro da Rota</h2>
            <p className="text-[9px] font-black uppercase text-gray-400 mt-1">
              {user?.nome || 'Vendedor'}{user?.rota ? ` · ${user.rota.replace(/^ROTA_/i, 'Rota ')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setMes(somarMes(mes, -1))} disabled={loading} aria-label="Mês anterior"
              className="w-10 h-10 bg-white rounded-xl shadow-sm border border-gray-100 flex items-center justify-center text-gray-600 active:scale-90 transition-transform disabled:opacity-40">
              <i className="fa-solid fa-chevron-left text-xs"></i>
            </button>
            <span className="text-[11px] font-black text-gray-700 uppercase min-w-[110px] text-center">{mesRotulo}</span>
            <button onClick={() => podeAvancar && setMes(somarMes(mes, 1))} disabled={loading || !podeAvancar} aria-label="Próximo mês"
              className="w-10 h-10 bg-white rounded-xl shadow-sm border border-gray-100 flex items-center justify-center text-gray-600 active:scale-90 transition-transform disabled:opacity-30">
              <i className="fa-solid fa-chevron-right text-xs"></i>
            </button>
          </div>
        </div>
        {data?.avisos?.custoCongelado && (
          <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-2xl px-3 py-2 shadow-sm">
            <i className="fa-solid fa-lock text-emerald-500 text-[10px]"></i>
            <p className="text-[8.5px] font-bold text-gray-400 uppercase leading-tight">
              Custo congelado no momento de cada venda — mudar o custo hoje não muda o passado
            </p>
          </div>
        )}
      </header>

      {loading && <Skeleton />}

      {!loading && erro && (
        <div className="bg-white rounded-3xl border border-rose-100 shadow-sm p-8 text-center space-y-3">
          <i className="fa-solid fa-triangle-exclamation text-rose-400 text-3xl"></i>
          <p className="text-[11px] font-bold text-gray-500">{erro}</p>
          <button onClick={() => carregar(mes)} className="bg-gray-900 text-white font-black px-6 py-3 rounded-2xl text-[10px] uppercase tracking-widest active:scale-95 shadow-md">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !erro && data && (
        <>
          {/* ===== Hero: Lucro Líquido ===== */}
          <div className={`rounded-[2rem] p-6 shadow-xl text-white ${temVenda && (t!.lucroLiquido >= 0) ? 'bg-gradient-to-br from-emerald-600 to-teal-700' : 'bg-gradient-to-br from-rose-600 to-red-700'}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-black uppercase opacity-70 tracking-widest">Lucro Líquido do Mês</p>
                <h3 className="text-4xl font-black mt-1 tracking-tight">{fmtBRL(t!.lucroLiquido)}</h3>
              </div>
              <div className={`text-right px-3 py-1.5 rounded-2xl ${temVenda && (t!.lucroLiquido >= 0) ? 'bg-white/15' : 'bg-black/20'}`}>
                <p className="text-[8px] font-black uppercase opacity-70">Margem</p>
                <p className="text-lg font-black leading-none mt-0.5">{fmtPct(t!.margemLiquida)}</p>
              </div>
            </div>
            <div className="mt-4">
              <BarraMargem pct={Math.max(0, t!.margemLiquida)} cor={temVenda && (t!.lucroLiquido >= 0) ? 'bg-white' : 'bg-rose-300'} />
              <div className="flex justify-between mt-1.5 text-[8px] font-black uppercase opacity-70">
                <span>Lucro bruto {fmtBRL(t!.lucro)}</span>
                <span>− despesas {fmtBRL(t!.despesasTotal)}</span>
              </div>
            </div>
          </div>

          {!temVenda ? (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center space-y-2">
              <i className="fa-solid fa-mug-hot text-gray-300 text-4xl"></i>
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Nenhuma venda neste mês</p>
              <p className="text-[9px] font-bold text-gray-300 uppercase">Navegue pelos meses nas setas acima</p>
            </div>
          ) : (
            <>
              {/* ===== Faturamento × Custo ===== */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-1"><i className="fa-solid fa-sack-dollar mr-1 text-emerald-500"></i>Faturamento</p>
                  <p className="text-xl font-black text-gray-800">{fmtBRL(t!.faturamento)}</p>
                  <p className="text-[8px] font-bold text-gray-400 uppercase mt-1">{t!.nVendas} vendas · ticket {fmtBRL(t!.ticketMedio)}</p>
                </div>
                <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-1"><i className="fa-solid fa-boxes-packing mr-1 text-rose-400"></i>Custo dos produtos</p>
                  <p className="text-xl font-black text-gray-800">{fmtBRL(t!.custo)}</p>
                  <p className="text-[8px] font-bold text-gray-400 uppercase mt-1">{fmtPct(t!.faturamento > 0 ? (t!.custo / t!.faturamento) * 100 : 0)} do faturamento</p>
                </div>
              </div>

              {/* ===== Lucro Bruto (com barra de margem) ===== */}
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-black text-gray-400 uppercase"><i className="fa-solid fa-chart-line mr-1 text-emerald-500"></i>Lucro Bruto (venda − custo)</p>
                  <span className={`text-sm font-black ${corMargem(t!.margem).txt}`}>{fmtPct(t!.margem)}</span>
                </div>
                <p className="text-2xl font-black text-gray-800 mb-3">{fmtBRL(t!.lucro)}</p>
                <BarraMargem pct={t!.margem} cor={corMargem(t!.margem).barra} />
                <div className="flex justify-between mt-1.5 text-[8px] font-black uppercase text-gray-300">
                  <span>0%</span><span className="text-gray-400">meta 20%</span><span>40%+</span>
                </div>
              </div>

              {/* ===== Recebido × A receber ===== */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50 p-5 rounded-3xl shadow-sm border border-emerald-100">
                  <p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Dinheiro recebido</p>
                  <p className="text-lg font-black text-emerald-700">{fmtBRL(data!.pago.faturamento)}</p>
                  <p className="text-[8px] font-bold text-emerald-500 uppercase mt-1">lucro nele: {fmtBRL(data!.pago.lucro)}</p>
                </div>
                <div className="bg-amber-50 p-5 rounded-3xl shadow-sm border border-amber-100">
                  <p className="text-[9px] font-black text-amber-600 uppercase mb-1">A receber (prazo)</p>
                  <p className="text-lg font-black text-amber-700">{fmtBRL(data!.aReceber.faturamento)}</p>
                  <p className="text-[8px] font-bold text-amber-500 uppercase mt-1">lucro nele: {fmtBRL(data!.aReceber.lucro)}</p>
                </div>
              </div>

              {/* ===== Despesas ===== */}
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between p-5 pb-3">
                  <div>
                    <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">Minhas Despesas</h3>
                    <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">Combustível, almoço, manutenção… descontam do lucro</p>
                  </div>
                  <button onClick={() => setFormAberto(o => !o)} aria-label="Lançar despesa"
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-sm ${formAberto ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}>
                    <i className={`fa-solid ${formAberto ? 'fa-xmark' : 'fa-plus'}`}></i>
                  </button>
                </div>

                {formAberto && (
                  <div className="px-5 pb-5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Descrição do gasto</label>
                      <input value={desc} onChange={e => setDesc(e.target.value)} maxLength={120} placeholder="Ex: Gasolina, Almoço, Pedágio…"
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-semibold outline-none focus:border-emerald-200" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Valor R$</label>
                      <input type="number" inputMode="decimal" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-lg font-black outline-none focus:border-emerald-200" />
                    </div>
                    <button onClick={lancar} disabled={salvando}
                      className="w-full bg-rose-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest disabled:opacity-60">
                      <i className={`fa-solid ${salvando ? 'fa-spinner fa-spin' : 'fa-circle-check'} mr-1.5`}></i>
                      {salvando ? 'Lançando…' : 'Confirmar despesa'}
                    </button>
                  </div>
                )}

                <div className="px-5 pb-2 flex items-center justify-between">
                  <p className="text-[9px] font-black text-rose-500 uppercase">Total: {fmtBRL(t!.despesasTotal)}</p>
                  <p className="text-[9px] font-black text-gray-300 uppercase">{fmtPct(t!.despesasPct)} do faturamento</p>
                </div>

                <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                  {data!.despesas.map(d => (
                    <div key={d.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-gray-50/60 transition-colors">
                      <div className="min-w-0 pr-3">
                        <p className="text-[11px] font-black text-gray-700 uppercase truncate">{d.descricao}</p>
                        <p className="text-[8px] font-bold text-gray-300 uppercase mt-0.5">
                          {new Date(d.data).toLocaleDateString('pt-BR')} · desconta do lucro bruto
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-black text-rose-600">−{fmtBRL(d.valor)}</span>
                        <button onClick={() => setExcluir(d)} aria-label={`Excluir ${d.descricao}`}
                          className="w-9 h-9 rounded-xl bg-gray-50 text-gray-300 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center active:scale-90 transition-all">
                          <i className="fa-solid fa-trash-can text-xs"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                  {data!.despesas.length === 0 && (
                    <div className="text-center py-6 opacity-40 italic text-[9px] uppercase font-bold tracking-widest">Nenhuma despesa neste mês</div>
                  )}
                </div>
              </div>

              {/* ===== Dia a dia ===== */}
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-5 pb-3">
                  <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">Dia a dia do mês</h3>
                  <p className="text-[8px] font-bold text-gray-400 uppercase mt-0.5">Lucro bruto de cada dia trabalhado</p>
                </div>
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {data!.porDia.map(d => {
                    const dt = new Date(`${d.dia}T12:00:00`);
                    const cor = corMargem(d.margem);
                    return (
                      <div key={d.dia} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50/60 transition-colors">
                        <div className={`w-12 h-12 rounded-2xl ${cor.bg} flex flex-col items-center justify-center shrink-0`}>
                          <span className="text-[13px] font-black text-gray-700 leading-none">{d.dia.slice(8, 10)}</span>
                          <span className="text-[7px] font-black text-gray-400 uppercase leading-none mt-0.5">{DIAS_PT[dt.getDay()]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-black text-gray-700">{fmtBRL(d.lucro)} <span className={`text-[9px] font-black ${cor.txt}`}>· {fmtPct(d.margem)}</span></p>
                            <p className="text-[9px] font-bold text-gray-400 shrink-0">{fmtBRL(d.faturamento)}</p>
                          </div>
                          <div className="mt-1.5"><BarraMargem pct={d.margem} cor={cor.barra} /></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* ===== Nota de rodapé ===== */}
          <div className="flex items-start gap-2 px-3 pt-1">
            <i className="fa-solid fa-circle-info text-gray-300 text-[10px] mt-0.5"></i>
            <p className="text-[8px] font-bold text-gray-300 uppercase leading-relaxed">
              {data!.avisos.detalhe}
            </p>
          </div>
        </>
      )}

      {/* ===== Confirmação de exclusão ===== */}
      {excluir && (
        <ConfirmModal
          title="Excluir despesa?"
          message={`"${excluir.descricao}" — ${fmtBRL(excluir.valor)} sai da lista e o lucro líquido volta a subir.`}
          type="danger"
          icon="fa-solid fa-trash-can"
          confirmLabel={excluindo ? 'Excluindo…' : 'Excluir'}
          onConfirm={confirmarExclusao}
          onCancel={() => !excluindo && setExcluir(null)}
        />
      )}
    </div>
  );
};

export default LucroRotaVendedor;
