# UI/UX DOCEMANIA — telas, navegação e padrões visuais

## 1. Mapa de rotas (páginas)

| Rota | Arquivo | Tela | Quem usa |
|---|---|---|---|
| `/` | `src/app/page.tsx` (SafeBoundary + Splash) → `src/lib/doce-app.tsx` | **O app inteiro** (navegação por abas internas, não rotas) | Todos os perfis internos |
| `/notas` | `src/app/notas/page.tsx` (1953 linhas) | Portal de Notas Fiscais (PC 1600px) | admin/dono (PIN) |
| `/fiscal-produtos` | `src/app/fiscal-produtos/page.tsx` | Portal de Produtos Fiscais (planilha NCM/CEST/CFOP) | admin/dono (mesma sessão PIN) |
| `/entradas` | `src/app/entradas/page.tsx` | Portal de Entradas (XML fornecedores) | admin/dono (mesma sessão PIN) |
| `/cliente/[codigo]` | `src/app/cliente/[codigo]/page.tsx` | Portal do Cliente (extrato, dívida, Pix, comprovante) | cliente final (link portal_code) |
| `/pedido/[codigo]` | `src/app/pedido/[codigo]/page.tsx` | Catálogo atacado online (mín R$200 → pré-venda) | cliente final |

Shell `/` decide por perfil: VENDEDOR → `VendedorDashboard` · ADMIN → `AdminDashboard` · ENTREGADOR → FilaEntregas modo ENTREGADOR · SECRETARIO → 2 abas (Separação + Estoque) · sem sessão → `Login` (5 toques no logo revela acessos fixos).

## 2. Navegação dos dashboards

**ADMIN** (`AdminDashboard.tsx`, TabType ~24 abas): Menu HOME em grid 2 colunas — Estoque, Portal Fiscal (→/notas), Portal de Entradas (→/entradas), Produtos Fiscais (→/fiscal-produtos), Catálogo Portal, Categorias, Cargas, Clientes, Comissoes, **Caixa**, Vendedores, Vendas Realizadas, Roteiro, Relatórios, Lucro por Rota, Contas a Receber, Comprovantes Pix (badge), Entregas, Backup, Configurações. Topo: sino de notificações + push. Aba restaurada do localStorage (try/catch!). HISTORY abre `Cupom` com `JanelaFiscal`. **Aba Relatórios (REPORTS) já existe com conteúdo próprio — ANTES de criar relatório novo, ler o que ela mostra para não duplicar; relatórios temáticos viram aba/card novo (ex: Lucro por Rota é aba própria).**

**VENDEDOR** (`VendedorDashboard.tsx`, TabType 14 abas): Rota do Dia, Entregas, Portal Fiscal, Avisos (clientes >25d sem compra), Minha Carga (badge), Vendas, Financeiro (**oculto para David**), Lucro da Rota (**só David**), **Caixa (só David/Rota 5)**, Contas a Receber, Clientes, Roteiro Semanal, Estoque. Ao abrir cliente: PRONTA/PRE_VENDA + documento + PDV; GPS automático.

**Permissão visual ≠ permissão real**: esconder aba é conveniência — o servidor revalida tudo (ver references/arquitetura.md).

## 3. Componentes-chave (src/components/doce/ — 33 arquivos)

`PDV.tsx` (fluxo 8 telas) · `Cupom.tsx` (preview/impressão + JanelaFiscal + BoletoCard) · `JanelaFiscal.tsx` (NF-e/NFC identificada/NFC anônima; Imprimir Mini-DANFE / DANFE A4 / Cancelar) · `FilaEntregas.tsx` (2559 linhas — coração da operação: prioridades, check de carga, sheet ENTREGUE/FALHOU, caixa por entregador, QR Pix, notas pendentes) · `CaixaFechamento.tsx` (polling 20s, FECHAR admin, lixeira, histórico) · `BoletoCard.tsx` (gerar/PDF/Pix/mini boleto) · `MiniBoletoImpressao.tsx` · `ModelosImpressao.tsx` (mini DANFE demo) · `PrinterSelector.tsx` · `ConfiguracoesHub.tsx` (ERP) · `AReceberPanel.tsx` · `LucroRotas.tsx` / `LucroRotaVendedor.tsx` · `MovimentacoesEstoque.tsx` (kardex) · `GestaoCatalogoPortal.tsx` · `SecretarioView.tsx` / `SecretarioEstoque.tsx` · `Login.tsx` · `ClientHistory.tsx` · `EditorPedido.tsx` · `TrocasBox.tsx` · `ConfirmModal.tsx` · `FiscalXml.tsx` (aba órfã — migrado ao /entradas).

**Código morto** (não importados — não usar como referência): `WizardPagamento.tsx`, `EntregasView.tsx`, `RelatorioFiscal.tsx`.

## 4. Configurações (organização vigente — bloco 167)

Aba **SETTINGS** com 4 sub-abas (tab bar 4 botões):
1. **GERAL** — Dados da Empresa (nome, CNPJ) · Logo e Marca (upload/remover)
2. **PAGAMENTOS** — Pix 1/2 (nome + QR) · Chave do recebimento `pixChave` (QR do PDV/entrega)
3. **SISTEMA** — Margem de Lucro Global · Preço mínimo · Melhorias liga/desliga (Trocas na separação, Avisar vendedor, Zap cliente, Bairro destaque, Foto entrega)
4. **INTEGRAÇÕES** — atalhos: Gestão de Catálogo · ERP Fiscal (`ConfiguracoesHub.tsx`: Focus/Inter/webhook log/impressão) · Kardex

Nada foi removido na reorganização (167) — apenas agrupado. Novas configurações DEVEM entrar na sub-abа correspondente, nunca empilhadas na raiz.

## 5. Padrões visuais (obrigatórios em tela nova/alterada)

- **Mobile-first**: `max-w-lg`; nada rola de lado (overflow-x: clip global — bloco 99); safe-area de notch.
- Cards brancos `rounded-3xl` + `border-gray-100 shadow-sm`; paddings p-4/p-6; gaps gap-4/gap-6.
- **Micro-tipografia**: caixa-alta `font-black` 8–11px com `tracking-wide` para rótulos.
- **Cores de marca**: `blue-600` primário (login/botões), `emerald-600` sucesso/caixa, vermelho/rosa perigo, âmbar alerta/boletos. **Não introduzir indigo.**
- Botões: `active:scale-95`, alvos ≥44px, haptics em todo clique.
- **NUNCA truncar nomes de clientes** (`truncate` → `break-words`, bloco 126).
- Modais: `max-h` com scroll interno; sheets com scroll testado no iPhone (110).
- Listas longas: `max-h-96 overflow-y-auto`.
- ConfirmModal unificado para ações destrutivas; toasts topo/baixo; sons (kaChing) em venda.
- **shadcn/ui existe** (44 componentes em `src/components/ui`) mas o app doce usa quase só o Toaster — telas doce são Tailwind artesanal; não depender de primitivas shadcn ao editar o app, mas PODE usá-las em telas novas fora do fluxo doce se combinar.
- Tema: **apenas light** (sem dark mode). Fonte Inter + Font Awesome 6 (`fa-solid/fa-brands`).
- Footer: se houver footer, fixo no fim (mt-auto) e sem cobrir conteúdo.
- Portais de PC (/notas, /fiscal-produtos, /entradas): tabela larga com sticky header, filtros-chip, KPIs clicáveis, mesma sessão PIN entre eles. **PADRÃO BLOCO 170 de ações** (nascido no /notas): 1 botão "Ações" (h-11 44px) por linha abre painel flutuante `createPortal(document.body)` `position:fixed` ancorado por `getBoundingClientRect` (abre ACIMA perto do fim da tela; pela RIGHT na borda), overlay z-40 + ESC/scroll/resize fecham, `max-h-[60vh]` scroll interno, grupos Documentos/Compartilhar/SEFAZ/Registro, itens = ícone (cor original) + label + sub dica, ação fora do prazo fica VISÍVEL DESABILITADA com o motivo (nunca "sumir"). Motivo: `overflow-x-auto` da tabela CORTA dropdown absoluto — só fixed+portal resolve. Filtros do portal: busca/selects/chips todos h-9 (mesma altura).

## 6. Regras de "botões nos lugares certos" (aprendidas com o dono)

- Ação mais frequente da tela = botão grande e à mão (ex: "Entregador 1" gigante, bloco 98).
- Seta voltar em TODAS as telas do PDV (139); tela de pagamento só diz COMO (sem texto de sistema, 139).
- Confirmar/cancelar reais: botão secundário pequeno; perigoso com ConfirmModal.
- Fluxo linear com preview ANTES de confirmar (cupom de conferência — 100/122).
- Banner de estado visível e autoexplicativo: NOTA PENDENTE (134), banner offline amarelo, aviso de boletos pendentes no caixa (167).
- Status colorido consistente: verde=entregue/pago/autorizada, âmbar=pendente/a prazo, vermelho=falhou/rejeitada, cinza=inativo/separado.
- Mostrar QUEM recebe/tem a carga nos modais (58/119) — nome completo, sem cortar.
- Imagem do cupom (canvas 384/576px) e links WhatsApp com token assinado (7d) para compartilhar.
