/**
 * PEDIDO ONLINE — agrupamento do catalogo em FAMILIAS com variantes.
 *
 * O cliente conhece o catalogo antigo (pedidos-doce-mania.netlify.app):
 * um card por produto (ex.: "Kero Coco") com as variantes dentro
 * (200 ml, 330 ml, 1 Litro) — em vez de um card por tamanho espalhado.
 *
 * O ESTOQUE CENTRAL grava cada tamanho como um product separado
 * ("Kero coco 200ml", "Kero coco 330ml", "Kero coco litro"), entao o
 * agrupamento e feito AQUI, na hora, a partir do nome:
 *
 *   - tamanho numerico (160g, 200ml, 20un, 50x) vira rotulo da variante;
 *   - palavra de tamanho no FIM (peq, pequeno, litro, g = grande) idem;
 *   - abreviacoes de sabor viram o nome completo (pim -> Pimenta,
 *     salg -> Salgado, fand -> Fandangos, sc -> Sour Cream);
 *   - o que sobra e a FAMILIA ("Kero Coco", "Cheetos Onda", "Doritos").
 *
 * Tudo em caixa alta/ordem estavel, sem depender de foto ou cadastro novo:
 * se o dono cadastrar "Cheetos onda 90g" amanha, a variante aparece
 * sozinha no mesmo card.
 */

export interface ProdutoCatalogo {
  id: string;
  nome: string;
  preco: number;
  estoque: number;
  categoryId: string | null;
}

export interface VarianteFamilia {
  produtoId: string;
  /** null = produto unico sem tamanho no nome (mostra sem etiqueta) */
  rotulo: string | null;
  preco: number;
  estoque: number;
}

export interface FamiliaCatalogo {
  key: string;
  nome: string;
  categoryId: string | null;
  variantes: VarianteFamilia[];
}

/** Conectivos ficam em minuscula no nome da familia ("Pe de Moleque") */
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e", "com", "a", "o"]);

/** Abreviacoes de sabor/linha que viram o nome completo */
const ALIAS: Record<string, string> = {
  pim: "Pimenta",
  salg: "Salgado",
  fand: "Fandangos",
  sc: "Sour Cream",
};

/** 160g / 200ml / 20un / 50x ... (numero colado na unidade) */
const RE_TAMANHO = /^(\d+(?:[.,]\d+)?)(g|gr|ml|l|kg|un|unds?|x)$/;

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
}

function rotuloTamanho(num: string, un: string): string {
  const v = Number(num.replace(",", ".")) || 0;
  if (un === "x") return `${fmtNum(v)}x`;
  const mapa: Record<string, string> = {
    g: "g", gr: "g", ml: "ml", l: "L", kg: "kg", un: "un", und: "un", unds: "un",
  };
  return `${fmtNum(v)} ${mapa[un] || un}`;
}

function rotuloDeToken(lower: string): string | null {
  const m = lower.match(RE_TAMANHO);
  if (m) return rotuloTamanho(m[1], m[2]);
  if (lower === "peq" || lower === "pequeno" || lower === "pequena") return "Pequeno";
  if (lower === "litro") return "1 Litro";
  return null;
}

/** Nome da familia em Title Case a partir dos tokens originais */
function tituloDos(tokens: string[]): string {
  return tokens
    .map((t, i) => {
      const low = semAcento(t.toLowerCase());
      if (ALIAS[low]) return ALIAS[low];
      if (i > 0 && CONECTIVOS.has(low)) return t.toLowerCase();
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Escala "fisica" da variante, para ordenar da maior para a menor
 *  (igual ao catalogo antigo: 160G antes de 105G antes de PEQ). */
function escalaVariante(rotulo: string | null): number {
  if (!rotulo) return 4e9; // sem etiqueta = item unico
  if (rotulo === "Grande") return 9e9;
  if (rotulo === "1 Litro") return 1000;
  const m = rotulo.match(/^([\d.,]+) (g|ml|L|kg|un|x)$/);
  if (!m) return 0;
  const v = Number(m[1].replace(",", ".")) || 0;
  if (m[2] === "kg" || m[2] === "un" || m[2] === "x") return v * 1000;
  return v;
}

export function agruparCatalogo(produtos: ProdutoCatalogo[]): FamiliaCatalogo[] {
  const map = new Map<string, FamiliaCatalogo>();

  for (const p of produtos) {
    const tokens = p.nome.trim().replace(/\s+/g, " ").split(" ");
    let rotulo: string | null = null;
    const fam: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const lower = semAcento(tokens[i].toLowerCase());
      const isLast = i === tokens.length - 1;

      if (rotulo === null) {
        const porToken = rotuloDeToken(lower);
        if (porToken) { rotulo = porToken; continue; }
        // "g" solto no fim = Grande ("Cheetos lua g"); so no fim p/ nao
        // engolir letra de sigla no meio do nome
        if (isLast && lower === "g") { rotulo = "Grande"; continue; }
      }
      fam.push(tokens[i]);
    }

    const nome = tituloDos(fam) || p.nome;
    const key = semAcento(nome).toLowerCase();

    let f = map.get(key);
    if (!f) {
      f = { key, nome, categoryId: p.categoryId, variantes: [] };
      map.set(key, f);
    } else if (!f.categoryId && p.categoryId) {
      f.categoryId = p.categoryId;
    }
    f.variantes.push({ produtoId: p.id, rotulo, preco: p.preco, estoque: p.estoque });
  }

  const familias = [...map.values()];
  for (const f of familias) {
    f.variantes.sort((a, b) => escalaVariante(b.rotulo) - escalaVariante(a.rotulo));
  }
  // ORDEM DAS FAMILIAS = ORDEM DE ENTRADA (nao alfabetica).
  // A API do catalogo devolve os produtos na MESMA ORDEM DO PDV
  // (app_settings.product_order), entao o portal fica igual ao PDV e
  // qualquer reordenacao feita na Gestao de Catalogo vale pros dois.
  return familias;
}

/** Rotulo completo p/ carrinho e resumo: "Kero Coco · 330 ml" */
export function rotuloItem(
  familias: FamiliaCatalogo[],
  produtoId: string
): { familia: string; variante: string | null } {
  for (const f of familias) {
    const v = f.variantes.find(x => x.produtoId === produtoId);
    if (v) return { familia: f.nome, variante: v.rotulo };
  }
  return { familia: produtoId, variante: null };
}
