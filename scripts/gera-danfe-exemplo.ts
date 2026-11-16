/**
 * BLOCO 158 — GERA O EXEMPLO PUBLICO DO MINI DANFE 80mm
 *
 * Gera public/danfe-exemplo.html com os dados da NF-e 69 Serie 1 (modelo de
 * referencia do dono) usando o MESMO gerador do sistema (danfeFiscal80Html).
 * Serve para: (1) comparar lado a lado com o modelo; (2) capturar a imagem de
 * exemplo para o dono; (3) conferir o Code 128 da chave.
 *
 * Uso: bun scripts/gera-danfe-exemplo.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { DEMO_DANFE_69 } from '../src/lib/danfeDemo';
import { danfeFiscal80Html } from '../src/lib/danfe80Html';

async function main() {
  const html = await danfeFiscal80Html(DEMO_DANFE_69);
  mkdirSync('public', { recursive: true });
  writeFileSync('public/danfe-exemplo.html', html, 'utf8');
  console.log('OK: public/danfe-exemplo.html gerado (' + html.length + ' bytes)');
}

main().catch((e) => {
  console.error('FALHOU:', e);
  process.exit(1);
});
