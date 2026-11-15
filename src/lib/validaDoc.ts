/**
 * Validacao de CPF/CNPJ (digito verificador, modulo 11).
 * Arquivo PURO (sem imports) — pode ser usado no client e no server.
 *
 * Motivo: o Inter recusa boleto com documento de dígito invalido com a
 * mensagem generica "Verifique se os dados informados estao de acordo com
 * a documentacao..." — validamos aqui ANTES para dar erro claro na tela.
 */

function calcDigito(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) soma += Number(base[i]) * pesos[i];
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

function todosIguais(d: string): boolean {
  return /^(\d)\1+$/.test(d);
}

export function validaCpfCnpj(doc: string): boolean {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 11) {
    // CPF: 9 digitos base + 2 digitos verificadores
    if (todosIguais(d)) return false;
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return calcDigito(d.slice(0, 9), p1) === Number(d[9]) && calcDigito(d.slice(0, 10), p2) === Number(d[10]);
  }
  if (d.length === 14) {
    // CNPJ: 12 digitos base + 2 digitos verificadores (pesos ciclicos 2..9)
    if (todosIguais(d)) return false;
    const calc = (base: string): number => {
      let peso = 2;
      let soma = 0;
      for (let i = base.length - 1; i >= 0; i--) {
        soma += Number(base[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13]);
  }
  return false;
}

/** Formata para mensagem amigavel: 000.000.000-00 / 00.000.000/0000-00 */
export function mascaraCpfCnpj(doc: string): string {
  const d = String(doc || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}
