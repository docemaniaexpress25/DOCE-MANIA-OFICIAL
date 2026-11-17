# IMPRESSÃO TÉRMICA E FISCAL 80mm — padrões aprovados pelo dono

O dono APROVOU o layout da mini DANFE (blocos 158/163) e do mini boleto (167). Qualquer documento novo de impressora segue EXATAMENTE estes padrões.

## 1. Arquitetura de impressão

- **Central única**: `src/lib/impressao.ts::imprimirDoc()` — TODO documento 80mm passa por aqui. Usuário escolhe canal **Bluetooth ou USB** a cada impressão (seletor DOM); iOS pula para o painel AirPrint/Bluefy. 56mm é legado (`APP_CONFIG.PRINTER_WIDTH_MM`).
- **Bluetooth** (`bluetoothPrinterService.ts`): Web Bluetooth → bytes ESC/POS (init, code page 860, bold `ESC E 1`, align, code128/QR nativos, gaveta). Não existe em iOS → navegador **Bluefy** (`iosPrint.ts`). Keep-alive DLE EOT 5s, auto-reconnect, fila (68).
- **USB/desktop** (`usbPrint.ts`): iframe oculto com `@page` do tamanho do papel + `window.print()` (NÃO é `@media print`). iOS: `imprimirViaIos` (documento principal + painel com gesto — Safari ignora print() de iframe/timeout, 120). Reforço de impressão (negrito global) por dispositivo.
- **Marcadores ESC/POS** resolvidos na térmica: `[[QR:...]]`, `[[BARCODE:...]]`, `[[PEQ]]` (texto pequeno `ESC ! 0x01` — NUNCA `GS ! 0x01`, que é ampliação).

## 2. Papel: 70mm de largura útil

- `@page { size: 70mm auto; margin: 0 }` — área imprimível real da térmica do dono ~70,5mm (comprovado em campo, bloco 163; antes 72mm cortava à direita).
- Imprimir em escala 100%. "80mm" é a classe da impressora; 70mm é a largura que não corta.
- Cupom comum: folha virtual 80mm 420px de altura no preview; cupom em `shrink-0` para flex não esmagar (78).

## 3. Mini DANFE fiscal 80mm (layout de referência do dono)

- **Fonte de dados**: XML AUTORIZADO via `/api/notas/cupom` (fonte `XML` obrigatória — nunca montar com dados da venda; sem XML = aviso e não imprime). Parser: `focusXml.ts`.
- **Texto ESC/POS** (`danfe80.ts`): 48 colunas, seções espelhando a DANFE A4 — emitente, destinatário, itens com grade fiscal (NCM/CST/CFOP), impostos, totais, forma de pagamento SEMPRE, chave em grupos de 4 dígitos, protocolo, QR consulta.
- **HTML USB** (`danfe80Html.ts`): `@page 70mm`, mono Consolas, stroke 0.15px — fiel 1:1 ao modelo NF-e 69 de referência (`danfeDemo.ts` + `public/danfe-exemplo.html`). Ajustes aprovados: fonte +1, traço engrossado, chave em grupos de 4 (162).
- **Preview/validação**: `ModelosImpressao.tsx` (aba do hub de impressão) com demo NF-e 69.
- **code128.ts**: `code128Svg()` — Code 128-C da chave de 44 dígitos em SVG puro (sem dependências).

## 4. Mini BOLETO 80mm (bloco 167)

- `src/lib/miniBoleto80Html.ts` — mesmo padrão visual da mini DANFE (CSS clonado, @page 70mm, escala 1.6): destaque VALOR/VENCIMENTO 12.5pt; **Code 128 SVG 65.5×12mm** do código de barras 44díg (fallback linha digitável); **QR Pix 28mm** (copia-e-cola); linha digitável com máscara oficial 5.5 5.6 5.6 1 11 (ou grupos de 5); PAGADOR/BENEFICIÁRIO/VENDA/SEU NÚMERO/SITUAÇÃO; rodapé "NAO E DOCUMENTO FISCAL — boleto oficial = PDF do Inter".
- `src/components/doce/MiniBoletoImpressao.tsx`: modal preview iframe 430px + canal USB (HTML exato) ou Bluetooth (`comprovanteBoletoTexto` 48 col com [[BARCODE]]/[[QR]]).
- Botão teal "Mini Boleto (80mm)" no `BoletoCard` quando há linha/barras/pix. **Boleto oficial continua sendo o PDF do Inter** (152).

## 5. Cupom não fiscal (venda)

- Gerador único `cupomTexto.ts` (56/80mm, trocas, forma de pagamento, QR catálogo `[[PEQ]]`); rodapé só tipo de documento + pagamento (38); trocas em letra pequena abaixo do total (101/102); OBS quando marcada; tipo real do documento via `rotuloDocumentoNota` ("NFC 17" — 135).
- Cupom é a base da SEPARAÇÃO — secretário imprime o mesmo cupom.
- Cupom fiscal em imagem canvas 576px (203dpi) no portal `/notas` (`CupomNaoFiscal.tsx`).

## 7. Impressão A4 (relatórios/portais de PC) — padrão

- Diferente da térmica: A4 usa `window.print()` **direto no gesto do clique** (sem await antes, sem iframe — lição do bloco 120 vale para todo browser iOS) + `@media print` que esconde o app e mostra só o relatório com cabeçalho da empresa.
- No iOS o diálogo dá "Salvar em PDF" — não precisa de gerador de PDF próprio para relatórios.
- Portais de PC (notas/entradas/fiscal-produtos) usam esse padrão; telas doce mobile preferem compartilhar imagem canvas (cupom 576px) ou link assinado.

## 8. Lições de campo que não podem voltar

1. iOS sem Web Bluetooth → Bluefy; instrução no app (`iosPrint.ts`).
2. Safari ignora print() de iframe e print() pós-await → imprimir pelo documento principal + gesto.
3. `GS ! 0x01` ampliou trocas GIGANTES → fonte pequena é `ESC ! 0x01`.
4. CODE128 com NUL corrompeu buffer → formato `GS k 73 n d...` sem NUL; QR com módulo dinâmico (576 dots).
5. Impressora caindo → keep-alive + fila + auto-reconnect (68).
6. 72mm cortava à direita → 70mm (163).
7. QR NFC-e alinhado com `fit-content` (137).
8. localStorage com try/catch sempre (SecurityError no iPhone = tela branca).
