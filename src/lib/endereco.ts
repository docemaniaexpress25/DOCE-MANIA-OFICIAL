/**
 * BLOCO 129 — ENDEREÇO DO CLIENTE: CEP automático (ViaCEP) + reverse geocode
 * do GPS (Nominatim) preenchendo CIDADE/UF/CEP no cadastro do cliente.
 *
 * Pedido do dono: "adicione o campo cidade ao cadastro do cliente! e tbm
 * quando puxar localizaçao ou digitar cep deve preencher automaticamente
 * esse campo" — a NFC-e levava o destinatário do cadastro (BLOCO 128), mas
 * os cadastros estavam sem cidade e sem preenchimento automático.
 *
 * Funções PURAS/sem estado — usadas por AdminDashboard e VendedorDashboard:
 * - mascararCep: máscara progressiva 00000-000
 * - buscarCep: ViaCEP (https://viacep.com.br) — gratuito, sem chave, CORS ok
 * - cidadeDeEstado/ufDeEstado/cepDeEstado: extrai cidade/sigla/CEP do
 *   retorno do reverse geocode do Nominatim (data.address) — o mesmo fetch
 *   que o botão "puxar localização" já fazia para rua/bairro.
 */

export interface CepResultado {
  ok: boolean;
  logradouro?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  erro?: string;
}

/** Máscara progressiva: 95012 → "95012", 95012400 → "95012-400". */
export function mascararCep(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** ViaCEP: GET /ws/{8 digitos}/json/ — { erro: true } quando CEP inexistente. */
export async function buscarCep(cep: string): Promise<CepResultado> {
  const d = (cep || '').replace(/\D/g, '');
  if (d.length !== 8) return { ok: false, erro: 'CEP deve ter 8 dígitos.' };
  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: AbortSignal.timeout(10_000) });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !j) return { ok: false, erro: 'Falha de rede ao consultar o CEP.' };
    if (j.erro) return { ok: false, erro: 'CEP não encontrado na base dos Correios.' };
    return {
      ok: true,
      logradouro: String(j.logradouro || '').trim(),
      bairro: String(j.bairro || '').trim(),
      cidade: String(j.localidade || '').trim(),
      uf: String(j.uf || '').trim().toUpperCase().slice(0, 2),
    };
  } catch {
    return { ok: false, erro: 'Falha de rede ao consultar o CEP.' };
  }
}

/** Remove acentos/minúsculas — para mapear o nome do estado do Nominatim. */
function semAcento(v: string): string {
  return (v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const UF_POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

/**
 * Sigla da UF vinda do reverse geocode do Nominatim.
 * Preferência: campo ISO3166-2-lvl4 ("BR-RS") -> sigla direta; fallback nome
 * do estado ("Rio Grande do Sul") -> tabela.
 */
export function ufDeEstado(addr: Record<string, unknown>): string {
  const iso = String(addr['ISO3166-2-lvl4'] || '');
  const m = iso.match(/-([A-Z]{2})$/);
  if (m) return m[1];
  return UF_POR_NOME[semAcento(String(addr.state || ''))] || '';
}

/** Cidade do Nominatim: city (urbano) / town / village / municipality (rural). */
export function cidadeDeEstado(addr: Record<string, unknown>): string {
  const a = addr as Record<string, string | undefined>;
  return String(a.city || a.town || a.village || a.municipality || '').trim();
}

/** CEP do Nominatim (só aceita com 8 dígitos — "95012-400" ou "95012400"). */
export function cepDeEstado(addr: Record<string, unknown>): string {
  const p = String(addr.postcode || '').replace(/\D/g, '');
  return p.length === 8 ? p : '';
}
