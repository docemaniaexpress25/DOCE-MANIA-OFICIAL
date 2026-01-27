
# Relatório Técnico: DOCE MANIA - Aplicativo Mobile de Vendas Externas

Este documento apresenta um levantamento técnico detalhado do aplicativo "DOCE MANIA", focado na estrutura existente, fluxos de negócio, dados e operações, visando preparar uma futura integração com o Supabase sem alterar o código atual.

---

## 1️⃣ VISÃO GERAL DO APLICATIVO

O aplicativo "DOCE MANIA" é um sistema mobile de gestão para distribuidoras que operam com vendas externas e pronta-entrega. Sua finalidade principal é otimizar o controle de estoque em trânsito (carga de vendedores), registrar vendas de forma eficiente, gerenciar clientes, acompanhar o desempenho de vendas e controlar o pagamento de comissões, além de auxiliar na organização do roteiro de visitas.

O sistema opera com dois perfis de usuário principais:
*   **Administrador (ADMIN):** Possui controle total sobre o catálogo de produtos, estoque central, criação e sincronização de cargas para vendedores, gestão de clientes, visualização de vendas e relatórios financeiros, gerenciamento de comissões e configurações globais do aplicativo.
*   **Vendedor (VENDEDOR):** Focado nas operações de campo, gerencia sua rota diária de clientes, aceita e acompanha sua carga de produtos, realiza vendas no Ponto de Venda (PDV), acompanha seu histórico de vendas, finanças e contas a receber, e visualiza o roteiro semanal.

O login no sistema é realizado por um mecanismo de PIN (Personal Identification Number). Ao iniciar o aplicativo, o usuário é apresentado a uma tela de login onde pode selecionar seu perfil (Administrador ou Vendedor). Após a seleção, é solicitado um PIN. Este PIN é validado contra a propriedade `pin` do objeto `User` correspondente, que agora é carregado do Supabase. Caso a propriedade `pin` não esteja definida para um usuário específico, o sistema apresentará um erro na tela de login, exigindo que o `pin` seja configurado no Supabase para o usuário.

Após um login bem-sucedido, o sistema identifica o perfil do usuário logado através da propriedade `role` do objeto `currentUser`. Com base nessa informação, o componente `App.tsx` renderiza condicionalmente o dashboard apropriado: `AdminDashboard` para usuários com `role: 'ADMIN'` ou `VendedorDashboard` para usuários com `role: 'VENDEDOR'`. Isso garante que cada perfil tenha acesso exclusivo às funcionalidades e interfaces designadas.

---

## 2️⃣ ESTRUTURA DE PASTAS E ARQUIVOS

**Novas Pastas:**
*   `services/`: Contém os módulos de serviço para interação com o Supabase, encapsulando a lógica de acesso a dados para cada entidade.

**Novos Arquivos:**
*   **`config.ts`**: Centraliza a leitura das variáveis de ambiente `SUPABASE_URL` e `SUPABASE_ANON_KEY` diretamente do `window.process.env`, garantindo que sejam corretamente acessíveis pelos módulos ES6 no navegador. Inclui validação para garantir que as variáveis existam.
*   **`supabaseClient.ts`**: Inicializa e exporta o cliente Supabase configurado com a URL e a chave anon, utilizando variáveis de ambiente.
*   **`services/userService.ts`**: Oferece funções para buscar todos os usuários (`getAllUsers`), inserir (`insertUser`) e atualizar (`updateUser`) na tabela `users` do Supabase. Utilizado para o login e gerenciamento de vendedores.
*   **`services/productService.ts`**: Oferece funções para buscar todos os produtos (`getAllProducts`), inserir (`insertProduct`) e atualizar (`updateProduct`) na tabela `products` do Supabase.
*   **`services/clientService.ts`**: Oferece funções para buscar todos os clientes (`getAllClients`), inserir (`insertClient`), atualizar (`updateClient`) e deletar (`deleteClient`) na tabela `clients` do Supabase.

**Pastas do Projeto:**
*   `components/`: Esta pasta contém todos os componentes React reutilizáveis e as telas principais da aplicação. Organiza a interface do usuário em módulos lógicos.

**Arquivos Relevantes e Suas Funções:**

*   **`index.html`**
    *   **Função:** É o arquivo HTML principal da aplicação web.
    *   **Responsabilidade:** Carrega a estrutura básica da página, os estilos globais (Tailwind CSS, Font Awesome, Google Fonts), o script `index.tsx` (via importmap) e define o elemento `div` com `id="root"` onde a aplicação React será montada. Contém um script que define `window.process.env.SUPABASE_URL` e `window.process.env.SUPABASE_ANON_KEY` para que possam ser lidas pelo `config.ts`.

*   **`index.tsx`**
    *   **Função:** O ponto de entrada TypeScript/React da aplicação.
    *   **Responsabilidade:** Importa o componente `App` e utiliza `ReactDOM.createRoot` para montá-lo no elemento `root` do `index.html`, iniciando o ciclo de vida da aplicação React. Garante que a aplicação seja renderizada em `StrictMode`.

*   **`App.tsx`**
    *   **Função:** O componente React raiz da aplicação.
    *   **Responsabilidade (atualizada):** Gerencia o estado global da aplicação. As listas de `users`, `products` e `clients` são carregadas do Supabase na inicialização e atualizadas através dos serviços Supabase. Outras entidades como `cargas`, `cargasPendentes`, `sales`, `commissions`, `payoutLogs`, e `messages` continuam a ser gerenciadas via estado local ou `localStorage`. Controla a lógica de autenticação do `currentUser`, e persistência de dados de carga no `localStorage`. Realiza o cálculo automático de `precoVenda` baseado na `margemGlobalAtiva`. Renderiza condicionalmente `Login`, `AdminDashboard` ou `VendedorDashboard` com base no `currentUser` logado. Centraliza as funções CRUD que agora interagem com o Supabase para `users`, `products` e `clients`, e as passa via props aos componentes dos dashboards. A função `addUser` agora define o `pin` padrão para novos vendedores.

*   **`types.ts`**
    *   **Função:** Define todas as interfaces TypeScript para as estruturas de dados utilizadas no aplicativo.
    *   **Responsabilidade (atualizada):** Garante a tipagem forte de objetos como `User` (agora com campo `pin` para autenticação, e sem `password`), `Product`, `Carga`, `CargaPendente`, `Client`, `Sale`, `SaleItem`, `Commission`, `CommissionPaymentLog`, e `SystemMessage`, promovendo consistência e prevenindo erros de tipo.

*   **`constants.ts`**
    *   **Função:** Armazena constantes e configurações globais da aplicação.
    *   **Responsabilidade:** Define `APP_CONFIG` com valores como `MARGEM_LIQUIDA_GLOBAL` e `PRINTER_WIDTH_MM`, e um array `DIAS_SEMANA` para facilitar a referência aos dias da semana.

*   **`metadata.json`**
    *   **Função:** Contém metadados descritivos da aplicação.
    *   **Responsabilidade:** Define o nome (`name`) e a descrição (`description`) do aplicativo. Inclui `requestFramePermissions` para solicitar acesso a funcionalidades do dispositivo como "geolocation" (geolocalização) e "bluetooth".

*   **`components/Login.tsx`**
    *   **Função:** Componente que renderiza a tela de login.
    *   **Responsabilidade (atualizada):** Permite ao usuário selecionar seu perfil (Administrador ou Vendedor) a partir de uma lista de usuários (agora carregada do Supabase) e inserir um PIN para autenticação. Valida o PIN inserido contra o campo `pin` do objeto `User` vindo do Supabase. Removeu-se qualquer fallback de PIN estático. Em caso de sucesso, chama a função `onLogin` para definir o usuário atual no `App.tsx`. Exibe um erro se o `pin` do usuário não estiver configurado no Supabase. Adicionados logs de depuração temporários para verificar o PIN digitado, o PIN do usuário e o objeto `selectedUser`.

*   **`components/AdminDashboard.tsx`**
    *   **Função:** Componente que renderiza o painel principal para usuários com perfil de Administrador.
    *   **Responsabilidade (atualizada):** Gerencia a navegação entre as diversas abas administrativas (Estoque, Cargas, Clientes, Caixa, Vendedores, Vendas Realizadas, Roteiro, Relatórios, Contas a Receber, Configurações). Inclui lógica para pesquisa, filtros de período, manipulação de modais para adição/edição de produtos (agora persistidos via Supabase), clientes (agora persistidos via Supabase), vendedores (agora persistidos via Supabase), entrada de estoque (agora persistido via Supabase), pagamento de comissões, recebimento de contas e visualização de vendas (`Cupom`). Controla as configurações globais de margem e Pix. A função `handleUpdatePassword` agora atualiza o campo `pin` do usuário.

*   **`components/VendedorDashboard.tsx`**
    *   **Função:** Componente que renderiza o painel principal para usuários com perfil de Vendedor.
    *   **Responsabilidade:** Gerencia a navegação entre as abas de vendedor (Rota do Dia, Minha Carga, Vendas, Financeiro, Contas a Receber, Clientes, Roteiro Semanal, Estoque). Exibe informações sobre cargas pendentes para aceite, estoque ativo, histórico de vendas, status financeiro (comissões e vendas), e roteiro de clientes (agora carregados do Supabase). Interage com o `PDV` para vendas e `Cupom` para detalhes de vendas. Inclui um "Modo Fiscalização" para gerar relatórios da carga atual.

*   **`components/PDV.tsx`**
    *   **Função:** Componente que implementa o Ponto de Venda.
    *   **Responsabilidade:** Permite ao vendedor adicionar produtos ao carrinho para um cliente específico, ajustar quantidades e preços de venda (com validação de margem mínima), selecionar o método de pagamento (Dinheiro, Pix, A Prazo), registrar o valor recebido e calcular o troco. Gerencia modais para condições de pagamento a prazo e finalização da venda, integrando-se à função `processSale` do `App.tsx`. Os produtos e clientes utilizados aqui agora são carregados do Supabase.

*   **`components/Cupom.tsx`**
    *   **Função:** Componente para exibir um cupom não fiscal detalhado de uma venda.
    *   **Responsabilidade:** Formata os dados de uma `Sale` em um layout de cupom de impressora, exibindo informações do cliente (agora carregado do Supabase), itens vendidos, total, método de pagamento e detalhes. Oferece a funcionalidade de copiar o texto formatado do cupom para a área de transferência e, se permitido, a opção de excluir a venda com estorno de estoque.

---

## 3️⃣ LISTA COMPLETA DE TELAS

### 🔹 ADMINISTRADOR

#### **Login** (via `components/Login.tsx`)
*   **Objetivo:** Autenticação inicial do administrador no sistema.
*   **Ações disponíveis:** Selecionar o perfil "Administrador", inserir o PIN de acesso (agora exclusivamente do Supabase).
*   **Dados manipulados:** `User` (leitura do Supabase para seleção e validação de PIN).

#### **Home** (via `components/AdminDashboard.tsx` - `activeTab: 'HOME'`)
*   **Objetivo:** Ponto de entrada centralizado para todas as funcionalidades administrativas, apresentando cards de atalho para outras seções.
*   **Ações disponíveis:** Navegar para as abas: Estoque, Cargas, Clientes, Caixa, Vendedores, Vendas Realizadas, Roteiro, Relatórios, Contas a Receber, Configurações.
*   **Dados manipulados:** Nenhum diretamente nesta tela; apenas navegação.

#### **Estoque Central** (via `components/AdminDashboard.tsx` - `activeTab: 'CATALOGO'`)
*   **Objetivo:** Visualizar o catálogo de produtos, gerenciar estoque principal, adicionar e editar produtos.
*   **Ações disponíveis:** Buscar produtos, abrir modal para adicionar novo produto, abrir modal para editar produto existente, abrir modal para registrar entrada de mercadoria.
*   **Dados manipulados:** `Product` (leitura, criação, atualização de detalhes e `estoquePrincipal` via Supabase).

#### **Gestão de Cargas** (via `components/AdminDashboard.tsx` - `activeTab: 'CARGAS'`)
*   **Objetivo:** Atribuir e sincronizar cargas de produtos para vendedores específicos, controlando o que cada vendedor leva no veículo.
*   **Ações disponíveis:** Selecionar um vendedor (dados do Supabase), ajustar as quantidades de cada produto na carga de estágio do vendedor (produtos do Supabase, carga atual local), sincronizar a carga (criação de `CargaPendente` local).
*   **Dados manipulados:** `User` (leitura do Supabase para selecionar o vendedor), `Product` (leitura do Supabase de `estoquePrincipal`), `Carga` (leitura local da carga ativa do vendedor), `CargaPendente` (criação local).

#### **Gestão de Clientes** (via `components/AdminDashboard.tsx` - `activeTab: 'CLIENTES'`)
*   **Objetivo:** Cadastrar, visualizar, editar e excluir informações de clientes da distribuidora.
*   **Ações disponíveis:** Buscar clientes, abrir modal para adicionar novo cliente, abrir modal para editar cliente existente, excluir cliente (com confirmação), capturar PIN de localização.
*   **Dados manipulados:** `Client` (leitura, criação, atualização, exclusão via Supabase).

#### **Caixa** (via `components/AdminDashboard.tsx` - `activeTab: 'CAIXA'`)
*   **Objetivo:** Monitorar a performance diária de vendas e o status das comissões dos vendedores, e realizar pagamentos de comissão.
*   **Ações disponíveis:** Visualizar estatísticas de vendas do dia e comissões disponíveis por vendedor (dados de vendas e comissões locais), abrir modal para pagar comissão (total ou parcial).
*   **Dados manipulados:** `Sale` (leitura local para vendas do dia), `Commission` (leitura local para comissões disponíveis), `CommissionPaymentLog` (leitura local para histórico de pagamentos), `User` (leitura do Supabase de vendedores), `SystemMessage` (criação local ao pagar comissão).

#### **Vendedores** (via `components/AdminDashboard.tsx` - `activeTab: 'VENDEDORES'`)
*   **Objetivo:** Gerenciar a lista de vendedores, incluindo cadastro, edição de dados e ativação/desativação.
*   **Ações disponíveis:** Abrir modal para adicionar novo vendedor, abrir modal para editar vendedor existente, ativar/desativar vendedor.
*   **Dados manipulados:** `User` (leitura, criação, atualização de `nome`, `telefone`, `foto`, `ativo` via Supabase).

#### **Vendas Realizadas** (via `components/AdminDashboard.tsx` - `activeTab: 'HISTORY'`)
*   **Objetivo:** Visualizar o histórico detalhado de todas as vendas realizadas no sistema, com opções de filtro.
*   **Ações disponíveis:** Filtrar vendas por período (hoje, semana, mês, geral), visualizar detalhes de uma venda (abre `Cupom`), excluir venda (apenas se for do dia atual, com estorno de estoque, via `Cupom`).
*   **Dados manipulados:** `Sale` (leitura local), `Client` (leitura do Supabase para nome do cliente), `User` (leitura do Supabase para nome do vendedor).

#### **Roteiro Semanal** (via `components/AdminDashboard.tsx` - `activeTab: 'ROTEIRO'`)
*   **Objetivo:** Visualizar a distribuição dos clientes pelos dias da semana para o planejamento de roteiros de vendas.
*   **Ações disponíveis:** Expandir/colapsar a lista de clientes para cada dia da semana.
*   **Dados manipulados:** `Client` (leitura do Supabase de `nomeFantasia`, `telefone`, `bairro`, `diaRoteiro`).

#### **Relatórios** (via `components/AdminDashboard.tsx` - `activeTab: 'REPORTS'`)
*   **Objetivo:** Exibir relatórios estatísticos sobre vendas, comissões pagas, top clientes e top produtos, com filtros de período.
*   **Ações disponíveis:** Filtrar relatórios por período (hoje, semana, mês, geral).
*   **Dados manipulados:** `Sale` (local), `CommissionPaymentLog` (local), `Client` (Supabase), `Product` (Supabase), `User` (Supabase) (leitura para gerar estatísticas).

#### **Contas a Receber** (via `components/AdminDashboard.tsx` - `activeTab: 'CONTAS_RECEBER'`)
*   **Objetivo:** Gerenciar as vendas realizadas a prazo que ainda estão pendentes de pagamento.
*   **Ações disponíveis:** Visualizar vendas em aberto, registrar recebimento (parcial ou total) para uma venda específica (abre modal de recebimento).
*   **Dados manipulados:** `Sale` (leitura e atualização local de `valorPago`, `statusPagamento`, `metodoPagamento`), `Client` (leitura do Supabase para nome do cliente), `User` (leitura do Supabase para nome do vendedor), `Commission` (atualização local de status ao quitar a venda).

#### **Configurações** (via `components/AdminDashboard.tsx` - `activeTab: 'SETTINGS'`)
*   **Objetivo:** Configurar aspectos globais da aplicação, como logotipo, contas Pix, senhas de usuários e regras de margem.
*   **Ações disponíveis:** Upload/definição do logotipo da empresa, configurar nomes e QR Codes para Pix 1 e Pix 2, alterar senhas de qualquer usuário (via Supabase), ativar/desativar e definir o valor da margem líquida global, ativar/desativar e definir o valor da margem líquida mínima.
*   **Dados manipulados:** `logo` (estado), `pix1Name`, `pix1Code`, `pix2Name`, `pix2Code` (estados), `User` (atualização de `pin` via Supabase), `margemGlobalAtiva`, `margemGlobalValor`, `margemMinima`, `margemMinimaAtiva` (estados). (Obs: estas configurações deverão ser persistidas no Supabase em uma etapa futura).

#### **Modal de Produto (Adicionar/Editar)** (via `components/AdminDashboard.tsx` - `showProductModal`)
*   **Objetivo:** Inserir ou modificar os detalhes de um produto.
*   **Ações disponíveis:** Preencher nome, custo, preço de venda, percentual de comissão. A margem é calculada automaticamente ou editável se a margem global não estiver ativa.
*   **Dados manipulados:** `Product` (criação ou atualização via Supabase).

#### **Modal de Entrada de Estoque** (via `components/AdminDashboard.tsx` - `showEntryModal`)
*   **Objetivo:** Registrar a entrada de novas quantidades de um produto no estoque central.
*   **Ações disponíveis:** Informar a quantidade de entrada e o custo unitário da mercadoria.
*   **Dados manipulados:** `Product` (atualização de `estoquePrincipal` e recalculo de `precoCusto` e `precoVenda` via Supabase).

#### **Modal de Cliente (Adicionar/Editar)** (via `components/AdminDashboard.tsx` - `showClientModal`)
*   **Objetivo:** Cadastrar ou modificar informações detalhadas de um cliente.
*   **Ações disponíveis:** Preencher nome fantasia, ativar/desativar e inserir CNPJ, telefone, endereço, bairro, dia de roteiro, e capturar/informar PIN de localização.
*   **Dados manipulados:** `Client` (criação ou atualização via Supabase).

#### **Modal de Vendedor (Adicionar/Editar)** (via `components/AdminDashboard.tsx` - `showUserModal`)
*   **Objetivo:** Cadastrar ou modificar os dados básicos de um vendedor.
*   **Ações disponíveis:** Preencher nome, telefone, e foto (base64).
*   **Dados manipulados:** `User` (criação ou atualização via Supabase).

#### **Modal de Pagamento de Comissão** (via `components/AdminDashboard.tsx` - `payoutVendedor`)
*   **Objetivo:** Processar o pagamento de comissões acumuladas a um vendedor.
*   **Ações disponíveis:** Selecionar tipo de pagamento (total ou parcial), inserir valor (se parcial).
*   **Dados manipulados:** `CommissionPaymentLog` (criação local), `SystemMessage` (criação local para o vendedor), `Commission` (status implícito local alterado por `payoutLogs`).

#### **Modal de Recebimento de Conta** (via `components/AdminDashboard.tsx` - `showReceiveModal`)
*   **Objetivo:** Registrar o recebimento de valores para vendas a prazo pendentes.
*   **Ações disponíveis:** Inserir o valor recebido (parcial ou total), selecionar método de recebimento (Dinheiro ou Pix).
*   **Dados manipulados:** `Sale` (atualização local de `valorPago`, `statusPagamento`, `metodoPagamento`), `Commission` (atualização local de status ao quitar a venda).

#### **Modal de Visualização de Cupom** (via `components/AdminDashboard.tsx` - `selectedSale` que renderiza `components/Cupom.tsx`)
*   **Objetivo:** Exibir um cupom não fiscal detalhado de uma venda para auditoria ou referência.
*   **Ações disponíveis:** Copiar o texto formatado do cupom, excluir a venda (se for do dia atual e `allowDelete` for `true`).
*   **Dados manipulados:** `Sale` (leitura local, potencial exclusão local), `Client` (leitura do Supabase), `Product` (leitura do Supabase).

### 🔹 VENDEDOR

#### **Login** (via `components/Login.tsx`)
*   **Objetivo:** Autenticação inicial do vendedor no sistema.
*   **Ações disponíveis:** Selecionar o perfil "Vendedor", inserir o PIN de acesso (agora exclusivamente do Supabase).
*   **Dados manipulados:** `User` (leitura do Supabase para seleção e validação de PIN).

#### **Home** (via `components/VendedorDashboard.tsx` - `activeTab: 'HOME'`)
*   **Objetivo:** Ponto de entrada centralizado para as funcionalidades de vendas em campo, apresentando cards de atalho para outras seções.
*   **Ações disponíveis:** Navegar para as abas: Rota do Dia, Minha Carga, Vendas, Financeiro, Contas a Receber, Clientes, Roteiro Semanal, Estoque.
*   **Dados manipulados:** `SystemMessage` (leitura local de mensagens não lidas para exibição de badge).

#### **Rota do Dia** (via `components/VendedorDashboard.tsx` - `activeTab: 'ROTEIRO'`)
*   **Objetivo:** Visualizar a lista de clientes programados para atendimento no dia atual.
*   **Ações disponíveis:** Pular atendimento de um cliente, iniciar atendimento de um cliente (abre o `PDV`), reabrir atendimento de um cliente que foi pulado ou já atendido no dia.
*   **Dados manipulados:** `Client` (leitura do Supabase), `Sale` (leitura local para verificar vendas no dia), estados locais para `skippedClientIds` e `reopenedClientIds`.

#### **Minha Carga** (via `components/VendedorDashboard.tsx` - `activeTab: 'CARGA'`)
*   **Objetivo:** Visualizar o estoque de produtos disponível no veículo do vendedor e aceitar novas cargas enviadas pelo administrador.
*   **Ações disponíveis:** Aceitar uma carga pendente (se houver), visualizar o estoque de produtos carregados no veículo, abrir o modal "Modo Fiscalização" para gerar um relatório da carga.
*   **Dados manipulados:** `CargaPendente` (leitura local, exclusão local no aceite), `Carga` (leitura local da carga ativa do vendedor), `Product` (leitura do Supabase para detalhes dos produtos na carga, atualização do `estoquePrincipal` via Supabase no aceite).

#### **Ponto de Venda (PDV)** (via `components/PDV.tsx` - aberto de `VendedorDashboard.tsx` quando `selectedClient` é definido)
*   **Objetivo:** Registrar uma nova venda para um cliente específico.
*   **Ações disponíveis:** Adicionar/remover produtos ao carrinho (limitado pela carga disponível), ajustar o preço de venda por item (com validação de margem mínima), selecionar o método de pagamento (Dinheiro, Pix, A Prazo), registrar valor recebido e calcular troco (para dinheiro), definir condições de prazo (data, forma de pagamento), finalizar a venda.
*   **Dados manipulados:** `Product` (leitura do Supabase), `Carga` (leitura local para disponibilidade de estoque, atualização local após venda), `Sale` (criação local), `Commission` (criação local).

#### **Vendas** (via `components/VendedorDashboard.tsx` - `activeTab: 'HISTORY'`)
*   **Objetivo:** Visualizar o histórico de vendas realizadas pelo próprio vendedor, com resumo financeiro e filtros por período.
*   **Ações disponíveis:** Filtrar vendas por período (dia, semana, mês, geral), visualizar resumo de vendas por método de pagamento, visualizar detalhes de uma venda (abre `Cupom`).
*   **Dados manipulados:** `Sale` (leitura local), `Client` (leitura do Supabase para nome do cliente).

#### **Financeiro** (via `components/VendedorDashboard.tsx` - `activeTab: 'FINANCE'`)
*   **Objetivo:** Acompanhar o desempenho financeiro do vendedor, incluindo total vendido, comissões disponíveis e a receber.
*   **Ações disponíveis:** Filtrar estatísticas por período (dia, semana, mês, geral).
*   **Dados manipulados:** `Sale` (leitura local para total vendido), `Commission` (leitura local para comissões), `CommissionPaymentLog` (leitura local para comissões pagas).

#### **Contas a Receber** (via `components/VendedorDashboard.tsx` - `activeTab: 'CREDIT'`)
*   **Objetivo:** Gerenciar as vendas realizadas a prazo que o vendedor precisa cobrar.
*   **Ações disponíveis:** Visualizar suas vendas a prazo pendentes, registrar recebimento (parcial ou total) para uma venda específica (abre modal de recebimento).
*   **Dados manipulados:** `Sale` (leitura e atualização local de `valorPago`, `statusPagamento`, `metodoPagamento`), `Client` (leitura do Supabase para nome do cliente), `Commission` (atualização local de status para `DISPONIVEL` ao quitar a venda).

#### **Clientes** (via `components/VendedorDashboard.tsx` - `activeTab: 'CLIENTS'`)
*   **Objetivo:** Visualizar informações básicas dos clientes e editar dados relevantes em campo.
*   **Ações disponíveis:** Visualizar lista de clientes, abrir modal para editar informações básicas de um cliente.
*   **Dados manipulados:** `Client` (leitura e atualização de `nomeFantasia`, `telefone`, `diaRoteiro`, `endereco` via Supabase).

#### **Roteiro Semanal** (via `components/VendedorDashboard.tsx` - `activeTab: 'WEEKLY'`)
*   **Objetivo:** Visualizar o roteiro de clientes por dia da semana e adicionar clientes à rota do dia atual (se necessário).
*   **Ações disponíveis:** Filtrar clientes por nome, expandir/colapsar a lista de clientes por dia, adicionar um cliente à rota do dia atual.
*   **Dados manipulados:** `Client` (leitura do Supabase), estado local `extraRouteClientIds` (para clientes adicionados à rota do dia).

#### **Estoque** (via `components/VendedorDashboard.tsx` - `activeTab: 'STOCK_VIEW'`)
*   **Objetivo:** Fornecer uma visão somente leitura do estoque principal dos produtos da distribuidora.
*   **Ações disponíveis:** Visualizar nome do produto, estoque principal e preço de venda.
*   **Dados manipulados:** `Product` (leitura do Supabase).

#### **Modal de Fiscalização** (via `components/VendedorDashboard.tsx` - `showFiscalization`)
*   **Objetivo:** Gerar um relatório formatado da carga atual do vendedor para fins de controle e fiscalização.
*   **Ações disponíveis:** Alternar o tamanho do relatório (80mm/56mm), copiar o texto formatado do relatório, compartilhar o relatório em formato PDF (funcionalidade mockada).
*   **Dados manipulados:** `User` (leitura do Supabase do nome do vendedor), `Carga` (leitura local da carga ativa do vendedor), `Product` (leitura do Supabase de nome dos produtos).

#### **Modal de Edição de Cliente** (via `components/VendedorDashboard.tsx` - `editingClient`)
*   **Objetivo:** Permitir ao vendedor atualizar informações básicas de um cliente.
*   **Ações disponíveis:** Editar nome fantasia, telefone, dia de atendimento e endereço.
*   **Dados manipulados:** `Client` (atualização via Supabase).

#### **Modal de Recebimento de Conta** (via `components/VendedorDashboard.tsx` - `showReceiveModal`)
*   **Objetivo:** Registrar o recebimento de valores para vendas a prazo pendentes pelo vendedor.
*   **Ações disponíveis:** Inserir o valor recebido (parcial ou total), selecionar método de recebimento (Dinheiro ou Pix).
*   **Dados manipulados:** `Sale` (atualização local de `valorPago`, `statusPagamento`, `metodoPagamento`), `Commission` (atualização local de status para `DISPONIVEL` ao quitar a venda).

#### **Modal de Condições a Prazo** (via `components/PDV.tsx` - `showPrazoOverlay`)
*   **Objetivo:** Definir os detalhes e a data de vencimento para uma venda a prazo.
*   **Ações disponíveis:** Selecionar a forma de pagamento (cheque, boleto, Pix a prazo, dinheiro a prazo), selecionar uma condição de prazo predefinida (dias), ou definir uma data de vencimento personalizada.
*   **Dados manipulados:** `detalheMetodo` e `prazoData` (estados locais que afetam a criação da `Sale`).

#### **Modal de Visualização de Cupom** (via `components/VendedorDashboard.tsx` - `viewingSale` que renderiza `components/Cupom.tsx`)
*   **Objetivo:** Exibir um cupom não fiscal detalhado de uma venda realizada.
*   **Ações disponíveis:** Copiar o texto formatado do cupom, excluir a venda (se for do dia atual e `allowDelete` for `true`).
*   **Dados manipulados:** `Sale` (leitura local, potencial exclusão local), `Client` (leitura do Supabase), `Product` (leitura do Supabase).

---

## 4️⃣ FLUXOS DE NEGÓCIO (PASSO A PASSO)

### Cadastro de Produtos
1.  O **Administrador** navega para a aba "Estoque Central" (`CATALOGO`).
2.  Clica no botão "Adicionar" (`fa-plus`) ou seleciona um produto existente para edição.
3.  Um modal de "Novo Produto" ou "Editar Produto" é exibido.
4.  O Administrador preenche/edita os campos: "Nome Comercial", "Custo R$", "Venda R$", e "Comissão %".
    *   Se a "Margem Global Ativa" estiver habilitada nas Configurações, o campo "Margem %" é desabilitado e o "Venda R$" é automaticamente calculado com base no custo e na margem global.
    *   Caso contrário, a margem e o preço de venda são editáveis, e um é calculado a partir do outro (margem do custo e venda, ou venda do custo e margem).
5.  O Administrador clica em "SALVAR PRODUTO".
6.  A função `addProduct` em `App.tsx` (agora chamando `productService.insertProduct`) ou `updateProduct` (chamando `productService.updateProduct`) é chamada, adicionando ou atualizando o produto no Supabase e no estado local `products`.
7.  Uma notificação de sucesso ("Produto salvo com sucesso") é exibida.

### Entrada de Estoque
1.  O **Administrador** navega para a aba "Estoque Central" (`CATALOGO`).
2.  Ao lado do produto desejado, clica no botão "Entrada" (`fa-plus-circle`).
3.  Um modal de "Entrada de Mercadoria" é exibido, mostrando o "Estoque Atual" do produto.
4.  O Administrador informa a "Quantidade Entrada" e o "Custo Unit." da nova mercadoria.
5.  Clica em "Confirmar Entrada".
6.  A função `registerStockEntry` em `App.tsx` (agora chamando `productService.updateProduct`) é chamada.
    *   O `estoquePrincipal` do produto é atualizado, somando a `Quantidade Entrada`.
    *   O `precoCusto` do produto é recalculado usando uma média ponderada: `((estoque_antigo * custo_antigo) + (quantidade_nova * custo_novo)) / (estoque_antigo + quantidade_nova)`.
    *   Se a `margemGlobalAtiva` estiver `true`, o `precoVenda` do produto é automaticamente recalculado com base no novo `precoCusto` e `margemGlobalValor`.
    *   As atualizações são enviadas ao Supabase.
7.  Uma notificação de sucesso ("Entrada registrada") é exibida.

### Criação de Carga pelo Administrador
1.  O **Administrador** navega para a aba "Gestão de Cargas" (`CARGAS`).
2.  Seleciona um **vendedor** no dropdown (lista de vendedores do Supabase).
3.  Para cada produto ativo (do Supabase), o Administrador ajusta a "Quantidade" que deseja atribuir à carga do vendedor, utilizando os botões `+` e `-`. A quantidade é limitada pela soma do `estoquePrincipal` do produto (do Supabase) e a quantidade desse produto já presente na carga *ativa* atual do vendedor (local).
4.  Após ajustar as quantidades, o Administrador clica em "SINCRONIZAR CARGA".
5.  Um modal de confirmação ("Deseja sincronizar a carga?") é exibido.
6.  Ao confirmar, a função `syncVendedorCarga` em `App.tsx` é chamada.
7.  Uma nova `CargaPendente` é criada localmente com um `id` único, o `vendedorId` selecionado, os `itens` (lista de `produtoId` e `quantidade`) e a `data` de criação. Esta `CargaPendente` é adicionada ao estado local `cargasPendentes` e persistida no `localStorage`.
8.  Uma notificação de sucesso ("Carga sincronizada com sucesso") é exibida.

### Sincronização de Carga (Detecção pelo Vendedor)
*   Este processo é majoritariamente passivo para o vendedor.
1.  Quando o Administrador cria uma `CargaPendente` para um `vendedorId` específico, ela é armazenada no estado local `cargasPendentes` do `App.tsx`.
2.  O `VendedorDashboard` filtra `cargasPendentes` para exibir apenas as pendências destinadas ao `currentUser` logado.
3.  Quando o Vendedor acessa a aba "Minha Carga" (`CARGA`), se houver `cargasPendentes` para ele, um card de notificação "Nova Carga Disponível!" e um botão "ACEITAR CARGA" são exibidos. O badge no menu principal de HOME também indica a pendência.

### Aceite de Carga pelo Vendedor
1.  O **Vendedor** navega para a aba "Minha Carga" (`CARGA`).
2.  Se houver uma `CargaPendente` disponível, ele clica no botão "ACEITAR CARGA".
3.  A função `aceitarCarga` em `App.tsx` é chamada, recebendo o `id` da `CargaPendente`.
    *   O `estoquePrincipal` de cada produto envolvido na pendência é **reduzido** no Supabase (chamando `productService.updateProduct`) e no estado local `products`.
    *   A carga **ativa** do vendedor (`cargas`) é atualizada localmente: todos os itens antigos para aquele `vendedorId` são removidos, e os `itens` da `CargaPendente` (com suas quantidades) são adicionados/substituídos na `cargas` (apenas itens com quantidade > 0).
    *   A `CargaPendente` é removida da lista local `cargasPendentes`.
    *   Uma `adminNotification` é gerada em `App.tsx` ("Carga aceita pelo vendedor com sucesso"), que será exibida no `AdminDashboard`.
4.  Uma notificação de sucesso ("Carga recebida com sucesso") é exibida para o vendedor.

### Processo de Venda
1.  O **Vendedor** navega para a aba "Rota do Dia" (`ROTEIRO`) ou "Clientes" (`CLIENTS`).
2.  Clica em "Atender" (na rota do dia) ou no ícone de edição (na lista de clientes) para um cliente (do Supabase).
3.  O componente `PDV.tsx` é aberto, mostrando o cliente selecionado.
4.  O Vendedor adiciona produtos (do Supabase) ao carrinho usando os botões `+` e `-`.
    *   A quantidade de cada produto é limitada pela `quantidade` disponível na `minhaCarga` do vendedor (local).
    *   O Vendedor pode ajustar o `precoVenda` por item.
    *   Se a `margemMinimaAtiva` estiver `true` e o `precoVenda` inserido for menor que o `minPriceAllowed` (calculado com base no `precoCusto` do produto do Supabase e `margemMinima`), a venda é bloqueada, um aviso "Venda Bloqueada: Margem Mínima" é exibido, e o campo de preço é destacado em vermelho.
5.  Após adicionar os itens, o Vendedor clica em "Confirmar Venda".
6.  O modal de "Pagamento" (`showFinalizeOverlay`) é exibido.
7.  O Vendedor seleciona o "Método de Pagamento":
    *   **Dinheiro:** Informa o "Valor Recebido", e o sistema calcula e exibe o "Troco".
    *   **PIX:** Escolhe entre "Pix Banco A" ou "Pix Banco B" (nomes configurados pelo admin). O QR Code correspondente é exibido para o cliente escanear.
    *   **A Prazo:** Abre um modal de "Condições a Prazo" (`showPrazoOverlay`), onde o vendedor escolhe a "Forma de Pagamento" (cheque, boleto, Pix a prazo, dinheiro a prazo) e a "Data Personalizada" de vencimento (ou presets de dias). Após salvar as condições, retorna ao modal de Pagamento.
8.  Clicar em "Finalizar Agora". O botão é desabilitado se o carrinho estiver vazio, houver violação da margem mínima, ou os dados de pagamento não estiverem completos (e.g., valor recebido < total para Dinheiro, Pix não selecionado, data de prazo vazia).
9.  A função `processSale` em `App.tsx` é chamada, criando uma nova `Sale` localmente.

### Geração de Vendas Realizadas e Comissões
1.  Após a chamada de `processSale` em `App.tsx`:
    *   Uma nova `Sale` é criada localmente com um `id` único, `vendedorId`, `clientId`, `data`, `valorTotal`, `metodoPagamento`, `detalhePagamento` (e.g., "Pix Banco A", "Cheque"), `statusPagamento` ('PAGO' para Dinheiro/Pix, 'PENDENTE' para A Prazo), `itens` (lista de `SaleItem`) e `dataVencimento` (se `A_PRAZO`).
    *   A `Sale` é adicionada ao estado local `sales`.
    *   A carga do vendedor (`cargas`) é atualizada localmente, **reduzindo** a quantidade dos produtos vendidos na `minhaCarga`.
    *   É calculada a `totalComissao` para a venda, somando a comissão de cada item (`item.precoVenda * item.quantidade * (produto.comissaoPercentual / 100)`). O `Product` é buscado do estado local (vindo do Supabase).
    *   Uma nova `Commission` é criada localmente com `id` único, `saleId`, `vendedorId`, `valor` e `dataGeracao`. O `status` da comissão é `DISPONIVEL` se a venda for `PAGO` ou `A_RECEBER` se a venda for `PENDENTE`.
    *   A `Commission` é adicionada ao estado local `commissions`.
2.  O `PDV` é fechado, e o `Cupom` da venda recém-realizada é exibido para o vendedor.
3.  Uma notificação de sucesso ("Venda realizada") é exibida.

### Exclusão de Venda e Estorno de Estoque
1.  O **Administrador** (na aba "Vendas Realizadas" via `Cupom`) ou o **Vendedor** (na aba "Vendas" via `Cupom`) clica em "EXCLUIR VENDA".
2.  Uma janela de confirmação ("Tem certeza que deseja excluir esta venda? Esta ação é irreversível e estornará o estoque do vendedor.") é exibida.
3.  O sistema verifica se a venda é do **dia atual**. Se não for, um alerta ("Erro: Só é possível excluir vendas do dia atual.") é exibido, e a operação é bloqueada.
4.  Se a venda for do dia atual e a exclusão for confirmada, a função `deleteSaleInternal` em `App.tsx` é chamada.
    *   A carga do vendedor (`cargas`) é **estornada** localmente: a quantidade dos produtos da venda é adicionada de volta à carga do vendedor. Se um produto não estava mais na carga, ele é adicionado com a quantidade estornada.
    *   Todas as `Commission` associadas a essa `saleId` são removidas do estado local `commissions`.
    *   A `Sale` é removida do estado local `sales`.
5.  O `Cupom` é fechado.

### Cálculo e Pagamento de Comissão

#### Cálculo de Comissão
1.  O cálculo da comissão ocorre automaticamente ao final do fluxo `processSale` em `App.tsx`, após a criação da `Sale`.
2.  Para cada `SaleItem` na `Sale`:
    *   O `Product` correspondente é encontrado no estado local (vindo do Supabase).
    *   O valor da comissão para o item é calculado como: `item.precoVenda * item.quantidade * (product.comissaoPercentual / 100)`.
3.  A soma desses valores resulta no `totalComissao` da venda.
4.  Uma nova `Commission` é criada localmente com: `id` único, `saleId`, `vendedorId`, `valor` (totalComissao) e `dataGeracao`.
5.  O `status` da comissão é definido como `DISPONIVEL` se a venda foi `PAGO` ou `A_RECEBER` se a venda foi `PENDENTE`.
6.  A `Commission` é adicionada ao estado local `commissions`.

#### Pagamento de Comissão (Administrador)
1.  O **Administrador** navega para a aba "Caixa" (`CAIXA`).
2.  Para um vendedor específico (do Supabase), o Administrador clica no botão "Pagar Comissão".
3.  Um modal de "Pagar Comissão" é exibido, mostrando o "Valor Disponível" para aquele vendedor (total de comissões `DISPONIVEL` locais menos o que já foi pago historicamente localmente).
4.  O Administrador escolhe o `tipo` de pagamento: "Total" ou "Parcial".
5.  Se "Parcial", ele informa o "Valor" a ser pago.
6.  Clica em "Confirmar Pagamento".
7.  A função `handlePayCommission` em `App.tsx` é chamada com `vendedorId`, `amount`, `type` e `adminId`.
    *   É realizada uma validação para garantir que o `amount` não exceda o `saldoReal` disponível para o vendedor. Se exceder, um alerta é emitido.
    *   Um novo `CommissionPaymentLog` é criado localmente, registrando os detalhes do pagamento (`id`, `vendedorId`, `vendedorNome`, `valorPago`, `valorRestante`, `tipo`, `dataPagamento`, `adminId`).
    *   O `CommissionPaymentLog` é adicionado ao estado local `payoutLogs`.
    *   Uma `SystemMessage` é criada localmente para o vendedor correspondente, notificando-o sobre o pagamento da comissão, e adicionada ao estado local `messages`.
8.  Uma notificação de sucesso ("Comissão paga com sucesso") é exibida.

### Contas a Receber

#### Para o Administrador
1.  O **Administrador** navega para a aba "Contas a Receber" (`CONTAS_RECEBER`).
2.  Visualiza uma lista de todas as `Sales` locais onde `metodoPagamento` é 'A_PRAZO' e `statusPagamento` é 'PENDENTE'.
3.  Para cada conta, ele vê o "Saldo" em aberto e um botão "RECEBER".
4.  Ao clicar em "RECEBER", um modal de "Confirmar Recebimento" é aberto, pré-preenchido com o saldo em aberto.
5.  O Administrador informa o "Valor a Receber" (parcial ou total) e seleciona o método de recebimento ("Dinheiro" ou "PIX").
6.  Clica em "Confirmar Dinheiro" ou "Confirmar PIX".
7.  A função `receiveAccount` em `App.tsx` é chamada, atualizando o estado local.

#### Para o Vendedor
1.  O **Vendedor** navega para a aba "Contas a Receber" (`CREDIT`).
2.  Visualiza apenas suas próprias `Sales` locais com `metodoPagamento` 'A_PRAZO' e `statusPagamento` 'PENDENTE'.
3.  O fluxo de recebimento (abertura do modal, preenchimento do valor, seleção do método) é similar ao do administrador.
4.  Ao confirmar o recebimento, a função `receiveAccount` em `App.tsx` é chamada.
    *   O campo `valorPago` da `Sale` é atualizado localmente somando o valor recebido.
    *   O `statusPagamento` da `Sale` muda para 'PAGO' se o `valorPago` se tornar maior ou igual ao `valorTotal`. Caso contrário, permanece 'PENDENTE'.
    *   Se a `Sale` for totalmente quitada, o `status` da `Commission` associada muda de 'A_RECEBER' para `DISPONIVEL` (localmente).
8.  Uma notificação de sucesso ("Conta quitada!" ou "Pagamento parcial registrado!") é exibida.

---

## 5️⃣ ENTIDADES DE DADOS (MODELO LÓGICO)

### `User` (Usuário)
*   **Finalidade:** Representa um usuário do sistema, podendo ser Administrador ou Vendedor, com suas informações de identificação e acesso.
*   **Campos:**
    *   `id`: string (Identificador único do usuário)
    *   `nome`: string (Nome completo do usuário)
    *   `email`: string (Endereço de e-mail; mantido para compatibilidade, mas não visível nem diretamente usado na UI atual)
    *   `role`: 'ADMIN' | 'VENDEDOR' (Define o perfil de acesso do usuário)
    *   `ativo`: boolean (Indica se a conta do usuário está ativa)
    *   `telefone?`: string (Opcional; número de telefone do usuário)
    *   `whatsapp?`: string (Opcional; número de WhatsApp, atualmente não usado diretamente na UI)
    *   `foto?`: string (Opcional; string base64 da foto de perfil do usuário)
    *   `pin?`: string (Opcional; PIN para login, agora **obrigatório** para login no Supabase)
*   **Tipo de dado inferido:** `string`, `boolean`.
*   **Relações implícitas:** Referenciado por `vendedorId` em `Carga` (local), `CargaPendente` (local), `Sale` (local), `Commission` (local), `CommissionPaymentLog` (local), `SystemMessage` (local). Referenciado por `adminId` em `CommissionPaymentLog` (local).
*   **Status de persistência:** Lida e gravada via **Supabase**.

### `Product` (Produto)
*   **Finalidade:** Representa um item de mercadoria disponível para venda e controle de estoque central e por carga.
*   **Campos:**
    *   `id`: string (Identificador único do produto)
    *   `nome`: string (Nome comercial do produto)
    *   `precoCusto`: number (Preço de custo unitário do produto)
    *   `precoVenda`: number (Preço de venda unitário sugerido ou calculado do produto)
    *   `comissaoPercentual`: number (Percentual de comissão sobre o `precoVenda` que o vendedor recebe)
    *   `estoquePrincipal`: number (Quantidade total disponível do produto no estoque central)
    *   `ativo`: boolean (Indica se o produto está ativo e disponível para venda/gestão)
*   **Tipo de dado inferido:** `string`, `number`, `boolean`.
*   **Relações implícitas:** Referenciado por `produtoId` em `Carga` (local), `CargaPendente` (local, dentro de `itens`), `SaleItem` (local).
*   **Status de persistência:** Lida e gravada via **Supabase**.

### `Carga` (Carga Ativa do Vendedor)
*   **Finalidade:** Representa o inventário de produtos que um vendedor específico possui atualmente em seu veículo/para pronta-entrega.
*   **Campos:**
    *   `vendedorId`: string (ID do vendedor a quem a carga pertence)
    *   `produtoId`: string (ID do produto na carga)
    *   `quantidade`: number (Quantidade do produto que o vendedor possui em sua carga)
*   **Tipo de dado inferido:** `string`, `number`.
*   **Relações implícitas:** Referencia `User` (do Supabase via `vendedorId`) e `Product` (do Supabase via `produtoId`). Uma carga é uma coleção de pares `(produtoId, quantidade)` para um `vendedorId`.
*   **Status de persistência:** Via estado local e `localStorage`.

### `CargaPendente` (Carga Pendente de Aceite)
*   **Finalidade:** Registra uma proposta de carga de produtos que foi enviada pelo administrador para um vendedor, aguardando que o vendedor a aceite.
*   **Campos:**
    *   `id`: string (Identificador único da carga pendente)
    *   `vendedorId`: string (ID do vendedor destinatário da carga pendente)
    *   `itens`: `{ produtoId: string; quantidade: number }[]` (Um array de objetos, onde cada objeto descreve um produto e a quantidade proposta para a carga)
    *   `data`: Date (Data e hora em que a carga pendente foi criada pelo administrador)
*   **Tipo de dado inferido:** `string`, `Date`, `array` de objetos.
*   **Relações implícitas:** Referencia `User` (do Supabase via `vendedorId`) e `Product` (do Supabase via `produtoId` dentro de `itens`).
*   **Status de persistência:** Via estado local e `localStorage`.

### `Client` (Cliente)
*   **Finalidade:** Armazena as informações de contato e roteiro dos clientes da distribuidora.
*   **Campos:**
    *   `id`: string (Identificador único do cliente)
    *   `nomeFantasia`: string (Nome fantasia ou nome comercial do cliente)
    *   `nome?`: string (Opcional; nome do contato principal do cliente, atualmente não usado na UI)
    *   `ativarCnpj?`: boolean (Opcional; indica se o campo CNPJ está ativo para este cliente)
    *   `cnpj?`: string (Opcional; número do CNPJ do cliente)
    *   `telefone`: string (Telefone de contato principal do cliente)
    *   `endereco`: string (Endereço completo do cliente)
    *   `bairro`: string (Bairro onde o cliente está localizado)
    *   `ativo`: boolean (Indica se o cliente está ativo no sistema)
    *   `localizacao?`: `{ lat: number; lng: number }` (Opcional; coordenadas de latitude e longitude do cliente, atualmente não usadas na UI para exibição ou cálculo de rota)
    *   `diaRoteiro`: number (Dia da semana para inclusão no roteiro de vendas, de 0 (Domingo) a 6 (Sábado))
    *   `observacoes?`: string (Opcional; campo para anotações adicionais sobre o cliente, atualmente não usado na UI)
    *   `pinLocalizacao?`: string (Opcional; PIN de localização manual, e.g., "latitude, longitude")
*   **Tipo de dado inferido:** `string`, `boolean`, `number`, `objeto` para `localizacao`.
*   **Relações implícitas:** Referenciado por `clientId` em `Sale` (local).
*   **Status de persistência:** Lida e gravada via **Supabase**.

### `SaleItem` (Item de Venda)
*   **Finalidade:** Descreve um produto específico vendido como parte de uma `Sale`, registrando a quantidade e o preço efetivo no momento da venda.
*   **Campos:**
    *   `produtoId`: string (ID do produto que foi vendido)
    *   `quantidade`: number (Quantidade vendida deste produto)
    *   `precoVenda`: number (Preço de venda efetivo por unidade deste produto no momento da venda)
*   **Tipo de dado inferido:** `string`, `number`.
*   **Relações implícitas:** Referencia `Product` (do Supabase via `produtoId`). É um sub-objeto que compõe a entidade `Sale`.
*   **Status de persistência:** Via estado local.

### `Sale` (Venda)
*   **Finalidade:** Registra uma transação de venda completa, com todos os detalhes da transação e do pagamento.
*   **Campos:**
    *   `id`: string (Identificador único da venda)
    *   `vendedorId`: string (ID do vendedor que realizou esta venda)
    *   `clientId`: string (ID do cliente para quem a venda foi realizada)
    *   `data`: Date (Data e hora em que a venda foi registrada)
    *   `valorTotal`: number (Valor total da venda)
    *   `valorPago`: number (Valor já pago pelo cliente para esta venda; usado para pagamentos parciais a prazo)
    *   `metodoPagamento`: 'DINHEIRO' | 'PIX' | 'A_PRAZO' (Método de pagamento utilizado)
    *   `detalhePagamento?`: string (Opcional; detalhes adicionais sobre o método de pagamento, e.g., "Pix Banco A", "Cheque 30 dias")
    *   `statusPagamento`: 'PAGO' | 'PENDENTE' (Status do pagamento da venda)
    *   `itens`: `SaleItem[]` (Um array de objetos `SaleItem` detalhando os produtos e quantidades vendidas)
    *   `dataVencimento?`: Date (Opcional; data de vencimento para vendas realizadas `A_PRAZO`)
*   **Tipo de dado inferido:** `string`, `Date`, `number`, `array` de objetos.
*   **Relações implícitas:** Referencia `User` (do Supabase via `vendedorId`), `Client` (do Supabase via `clientId`), e `Product` (do Supabase indiretamente via `itens.produtoId`). Referenciado por `saleId` em `Commission`.
*   **Status de persistência:** Via estado local.

### `Commission` (Comissão)
*   **Finalidade:** Representa uma comissão gerada para um vendedor a partir de uma venda específica, com seu status de pagamento.
*   **Campos:**
    *   `id`: string (Identificador único da comissão)
    *   `saleId`: string (ID da venda que gerou esta comissão)
    *   `vendedorId`: string (ID do vendedor a quem esta comissão pertence)
    *   `valor`: number (Valor da comissão)
    *   `status`: 'DISPONIVEL' | 'A_RECEBER' | 'PAGO' (Status atual da comissão: disponível para pagamento, aguardando recebimento da venda, ou já paga)
    *   `dataGeracao`: Date (Data e hora em que a comissão foi gerada)
*   **Tipo de dado inferido:** `string`, `number`, `Date`.
*   **Relações implícitas:** Referencia `Sale` (local via `saleId`) e `User` (do Supabase via `vendedorId`).
*   **Status de persistência:** Via estado local.

### `CommissionPaymentLog` (Registro de Pagamento de Comissão)
*   **Finalidade:** Registra o histórico de pagamentos de comissão efetuados pelo administrador a um vendedor.
*   **Campos:**
    *   `id`: string (Identificador único do registro de pagamento)
    *   `vendedorId`: string (ID do vendedor que recebeu o pagamento)
    *   `vendedorNome`: string (Nome do vendedor no momento do pagamento)
    *   `valorPago`: number (Valor pago nesta transação específica)
    *   `valorRestante`: number (Saldo restante de comissão após este pagamento)
    *   `tipo`: 'TOTAL' | 'PARCIAL' (Indica se o pagamento foi total ou parcial da comissão disponível)
    *   `dataPagamento`: Date (Data e hora em que o pagamento foi realizado)
    *   `adminId`: string (ID do administrador que realizou o pagamento)
*   **Tipo de dado inferido:** `string`, `number`, `Date`.
*   **Relações implícitas:** Referencia `User` (do Supabase via `vendedorId` e `adminId`).
*   **Status de persistência:** Via estado local.

### `SystemMessage` (Mensagem do Sistema)
*   **Finalidade:** Armazena mensagens enviadas pelo sistema (ou administrador) para os vendedores, geralmente para notificações.
*   **Campos:**
    *   `id`: string (Identificador único da mensagem)
    *   `vendedorId`: string (ID do vendedor destinatário da mensagem)
    *   `titulo`: string (Título ou assunto da mensagem)
    *   `mensagem`: string (Conteúdo da mensagem)
    *   `data`: Date (Data e hora em que a mensagem foi enviada)
    *   `lida`: boolean (Indica se o vendedor já visualizou a mensagem)
*   **Tipo de dado inferido:** `string`, `Date`, `boolean`.
*   **Relações implícitas:** Referencia `User` (do Supabase via `vendedorId`).
*   **Status de persistência:** Via estado local.

---

## 6️⃣ OPERAÇÕES DE DADOS

| Entidade | Operação | Tela Responsável                                      | Perfil Autorizado | Função/Estado Envolvido                                                                                                                  | Status de Persistência |
| :------- | :------- | :---------------------------------------------------- | :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :--------------------- |
| `User`   | Create   | `AdminDashboard` (Modal Vendedor)                     | ADMIN             | `addUser` (chama `userService.insertUser`)                                                                                               | **Supabase**           |
| `User`   | Read     | `Login`, `AdminDashboard`, `VendedorDashboard`, `App` | ADMIN, VENDEDOR   | `users` (estado, preenchido via `userService.getAllUsers`), `currentUser` (estado), filtros e mapeamentos em várias telas.             | **Supabase**           |
| `User`   | Update   | `AdminDashboard` (Modal Vendedor, Configurações)      | ADMIN             | `updateUser` (chama `userService.updateUser`).                                                                                           | **Supabase**           |
| `Product`| Create   | `AdminDashboard` (Modal Produto)                      | ADMIN             | `addProduct` (chama `productService.insertProduct`).                                                                                     | **Supabase**           |
| `Product`| Read     | `AdminDashboard`, `VendedorDashboard`, `PDV`, `Cupom` | ADMIN, VENDEDOR   | `products` (estado, preenchido via `productService.getAllProducts`), `minhaCarga` (calculada), exibição em tabelas e listas.             | **Supabase**           |
| `Product`| Update   | `AdminDashboard` (Modal Produto, Entrada Estoque)     | ADMIN             | `updateProduct` (chama `productService.updateProduct`), `registerStockEntry` (chama `productService.updateProduct`), `adjustStockManual` (chama `productService.updateProduct`). | **Supabase**           |
| `Carga`  | Create   | `App` (via `aceitarCarga`)                            | ADMIN             | `setCargas` (adiciona itens à carga ativa do vendedor, substituindo o estado anterior).                                                  | Local                  |
| `Carga`  | Read     | `AdminDashboard`, `VendedorDashboard`, `PDV`          | ADMIN, VENDEDOR   | `cargas` (estado), `minhaCarga` (calculada no VendedorDashboard).                                                                        | Local                  |
| `Carga`  | Update   | `App` (via `processSale`, `aceitarCarga`)             | ADMIN, VENDEDOR   | `setCargas` (reduz `quantidade` na venda, atualiza no aceite).                                                                           | Local                  |
| `Carga`  | Delete   | `App` (via `aceitarCarga`, `deleteSaleInternal`)      | ADMIN             | `setCargas` (remove itens da carga antiga no aceite, estorna/adiciona na exclusão de venda).                                             | Local                  |
| `CargaPendente` | Create | `AdminDashboard`                                    | ADMIN             | `syncVendedorCarga`.                                                                                                                     | Local                  |
| `CargaPendente` | Read | `AdminDashboard`, `VendedorDashboard`                 | ADMIN, VENDEDOR   | `cargasPendentes` (estado), filtrada por `vendedorId` no VendedorDashboard.                                                              | Local                  |
| `CargaPendente` | Delete | `App` (via `aceitarCarga`)                          | ADMIN             | `setCargasPendentes` (remove pendência após aceite).                                                                                     | Local                  |
| `Client` | Create   | `AdminDashboard` (Modal Cliente)                      | ADMIN             | `addClient` (chama `clientService.insertClient`).                                                                                        | **Supabase**           |
| `Client` | Read     | `AdminDashboard`, `VendedorDashboard`, `PDV`, `Cupom` | ADMIN, VENDEDOR   | `clients` (estado, preenchido via `clientService.getAllClients`), exibição em listas, dropdowns.                                         | **Supabase**           |
| `Client` | Update   | `AdminDashboard` (Modal Cliente), `VendedorDashboard` (Modal Edição) | ADMIN, VENDEDOR   | `updateClient` (chama `clientService.updateClient`).                                                                                     | **Supabase**           |
| `Client` | Delete   | `AdminDashboard`                                      | ADMIN             | `deleteClient` (chama `clientService.deleteClient`).                                                                                     | **Supabase**           |
| `Sale`   | Create   | `PDV`                                                 | VENDEDOR          | `processSale`.                                                                                                                           | Local                  |
| `Sale`   | Read     | `AdminDashboard`, `VendedorDashboard`, `Cupom`        | ADMIN, VENDEDOR   | `sales` (estado), exibição em histórico, relatórios.                                                                                     | Local                  |
| `Sale`   | Update   | `App` (via `receiveAccount`)                          | ADMIN, VENDEDOR   | `setSales` (atualiza `valorPago`, `statusPagamento`, `metodoPagamento` após recebimento).                                                | Local                  |
| `Sale`   | Delete   | `Cupom`                                               | ADMIN, VENDEDOR   | `deleteSaleInternal` (apenas vendas do dia atual).                                                                                       | Local                  |
| `Commission` | Create | `App` (via `processSale`)                           | VENDEDOR          | `setCommissions`.                                                                                                                        | Local                  |
| `Commission` | Read   | `AdminDashboard`, `VendedorDashboard`                 | ADMIN, VENDEDOR   | `commissions` (estado), exibição em caixa, financeiro, relatórios.                                                                       | Local                  |
| `Commission` | Update | `App` (via `receiveAccount`)                        | ADMIN, VENDEDOR   | `setCommissions` (atualiza `status` para `DISPONIVEL` após quitação de venda a prazo).                                                   | Local                  |
| `Commission` | Delete | `App` (via `deleteSaleInternal`)                    | ADMIN             | `setCommissions` (remove comissão ao excluir venda).                                                                                     | Local                  |
| `CommissionPaymentLog` | Create | `AdminDashboard` (Modal Pagamento)            | ADMIN             | `handlePayCommission`.                                                                                                                   | Local                  |
| `CommissionPaymentLog` | Read | `AdminDashboard`, `VendedorDashboard`         | ADMIN, VENDEDOR   | `payoutLogs` (estado), exibição em caixa, financeiro.                                                                                    | Local                  |
| `SystemMessage` | Create | `App` (via `handlePayCommission`)                   | ADMIN             | `setMessages`.                                                                                                                           | Local                  |
| `SystemMessage` | Read   | `VendedorDashboard`                                 | VENDEDOR          | `messages` (estado), exibição de notificações.                                                                                           | Local                  |
| `SystemMessage` | Update | `VendedorDashboard`                                 | VENDEDOR          | `markMessageAsRead`.                                                                                                                     | Local                  |

---

## 7️⃣ PREPARAÇÃO PARA SUPABASE (CONCEITUAL)

Para uma futura integração com o Supabase, as entidades e lógicas atuais do aplicativo `DOCE MANIA` seriam mapeadas para um esquema de banco de dados relacional (PostgreSQL, gerenciado pelo Supabase) com foco em persistência de dados, relações, atomicidade e segurança.

### Quais entidades DEVEM virar tabelas no Supabase:

Todas as interfaces de dados definidas em `types.ts`, bem como as configurações globais do aplicativo, devem ser persistidas como tabelas no Supabase para garantir a durabilidade e a centralização dos dados.

1.  **`users`**
    *   Mapeia para a interface `User`.
    *   Campos: `id` (PK, UUID), `nome`, `email` (pode ser usado para Supabase Auth), `role`, `ativo`, `telefone`, `whatsapp`, `foto`, `pin` (PIN; agora **obrigatório** para login).

2.  **`products`**
    *   Mapeia para a interface `Product`.
    *   Campos: `id` (PK, UUID), `nome`, `preco_custo`, `preco_venda`, `comissao_percentual`, `estoque_principal`, `ativo`.

3.  **`clients`**
    *   Mapeia para a interface `Client`.
    *   Campos: `id` (PK, UUID), `nome_fantasia`, `nome`, `ativar_cnpj`, `cnpj`, `telefone`, `endereco`, `bairro`, `ativo`, `lat` (extraído de `localizacao` ou `pinLocalizacao`), `lng` (extraído de `localizacao` ou `pinLocalizacao`), `dia_roteiro`, `observacoes`, `pin_localizacao`.

4.  **`cargas`**
    *   Mapeia para a interface `Carga`. Representa a carga **ativa** do vendedor.
    *   Campos: `vendedor_id` (PK, FK para `users.id`), `produto_id` (PK, FK para `products.id`), `quantidade`.
    *   Esta seria uma tabela de junção com chave primária composta (`vendedor_id`, `produto_id`).

5.  **`cargas_pendentes`**
    *   Mapeia para a interface `CargaPendente`.
    *   Campos: `id` (PK, UUID), `vendedor_id` (FK para `users.id`), `data_criacao`, `itens` (JSONB, para manter a estrutura do array de objetos. Idealmente, para maior granularidade e consultas, seria desnormalizado para uma tabela `carga_pendente_itens`).

6.  **`sales`**
    *   Mapeia para a interface `Sale`.
    *   Campos: `id` (PK, UUID), `vendedor_id` (FK para `users.id`), `client_id` (FK para `clients.id`), `data_venda`, `valor_total`, `valor_pago`, `metodo_pagamento`, `detalhe_pagamento`, `status_pagamento`, `data_vencimento`.

7.  **`sale_items`**
    *   Mapeia para a interface `SaleItem`. Esta seria uma tabela de junção detalhando os itens de cada venda.
    *   Campos: `sale_id` (PK, FK para `sales.id`), `produto_id` (PK, FK para `products.id`), `quantidade`, `preco_venda_item`.
    *   Chave primária composta (`sale_id`, `produto_id`).

8.  **`commissions`**
    *   Mapeia para a interface `Commission`.
    *   Campos: `id` (PK, UUID), `sale_id` (FK para `sales.id`), `vendedor_id` (FK para `users.id`), `valor`, `status_comissao`, `data_geracao`.

9.  **`commission_payout_logs`**
    *   Mapeia para a interface `CommissionPaymentLog`.
    *   Campos: `id` (PK, UUID), `vendedor_id` (FK para `users.id`), `vendedor_nome`, `valor_pago`, `valor_restante`, `tipo`, `data_pagamento`, `admin_id` (FK para `users.id`).

10. **`system_messages`**
    *   Mapeia para a interface `SystemMessage`.
    *   Campos: `id` (PK, UUID), `vendedor_id` (FK para `users.id`), `titulo`, `mensagem`, `data_envio`, `lida`.

1.  **`app_settings`**
    *   Mapeia para as configurações globais do aplicativo (logo, margens, Pix) atualmente gerenciadas em `App.tsx`.
    *   Campos: `id` (PK, e.g., 'global_settings', para garantir uma única linha de configurações), `logo`, `margem_global_ativa`, `margem_global_valor`, `margem_minima`, `margem_minima_ativa`, `pix1_name`, `pix1_code`, `pix2_name`, `pix2_code`.

### Relações Existentes entre Tabelas (Chaves Estrangeiras - FKs):

As seguintes relações (Foreign Keys) seriam estabelecidas entre as tabelas para garantir a integridade referencial:

*   `cargas.vendedor_id` -> `users.id`
*   `cargas.produto_id` -> `products.id`
*   `cargas_pendentes.vendedor_id` -> `users.id`
*   `sales.vendedor_id` -> `users.id`
*   `sales.client_id` -> `clients.id`
*   `sale_items.sale_id` -> `sales.id`
*   `sale_items.produto_id` -> `products.id`
*   `commissions.sale_id` -> `sales.id`
*   `commissions.vendedor_id` -> `users.id`
*   `commission_payout_logs.vendedor_id` -> `users.id`
*   `commission_payout_logs.admin_id` -> `users.id`
*   `system_messages.vendedor_id` -> `users.id`

### Onde Será Necessário Controle Transacional (Atomicidade):

Operações que modificam múltiplas tabelas e que exigem que todas as alterações sejam bem-sucedidas ou nenhuma delas (atomicidade) seriam implementadas como transações no Supabase (via funções de banco de dados/triggers ou chamadas de API de transação). Isso é crucial para evitar inconsistências nos dados:

*   **Processo de Venda (`processSale`):** Uma única venda envolve:
    *   Criação de um registro em `sales`.
    *   Criação de múltiplos registros em `sale_items`.
    *   Atualização (`UPDATE`) da `quantidade` de produtos na tabela `cargas` do vendedor (reduzindo o estoque).
    *   Criação de um registro em `commissions`.
    *   Risco de inconsistência se, por exemplo, a venda for registrada, mas o estoque do vendedor não for atualizado.

*   **Aceite de Carga (`aceitarCarga`):** O aceite de uma carga implica:
    *   Atualização (`UPDATE`) do `estoque_principal` dos produtos na tabela `products` (reduzindo o estoque central).
    *   Atualização (`DELETE`/`INSERT`) da tabela `cargas` (removendo a carga antiga do vendedor e inserindo a nova).
    *   Exclusão (`DELETE`) da `CargaPendente` da tabela `cargas_pendentes`.
    *   Risco de inconsistência se, por exemplo, o estoque central for reduzido, mas a carga do vendedor não for atualizada corretamente.

*   **Exclusão de Venda (`deleteSaleInternal`):** Esta operação complexa requer:
    *   Exclusão (`DELETE`) da `Sale` da tabela `sales`.
    *   Exclusão (`DELETE`) de todos os `SaleItem` relacionados da tabela `sale_items`.
    *   Exclusão (`DELETE`) de todas as `Commission` relacionadas da tabela `commissions`.
    *   Atualização (`UPDATE`/`INSERT`) da `quantidade` de produtos na tabela `cargas` do vendedor (estornando o estoque).
    *   Risco de inconsistência se a venda for excluída, mas o estoque não for estornado ou as comissões não forem canceladas.

*   **Entrada de Estoque (`registerStockEntry`):** A entrada de mercadoria afeta:
    *   Atualização (`UPDATE`) do `estoque_principal` em `products`.
    *   Atualização (`UPDATE`) do `preco_custo` e, condicionalmente, do `preco_venda` em `products`.
    *   Risco de inconsistência se as quantidades e custos não forem atualizados de forma coesa.

*   **Recebimento de Contas (`receiveAccount`):** Para vendas a prazo, o recebimento pode envolver:
    *   Atualização (`UPDATE`) de `valor_pago` e `status_pagamento` na tabela `sales`.
    *   Atualização (`UPDATE`) do `status_comissao` na tabela `commissions` (se a venda for quitada).
    *   Risco de inconsistência se a venda for marcada como paga, mas a comissão não for liberada.

### Onde Será Necessário Controle de Permissão (RLS - Row-Level Security no futuro):

O Supabase oferece Row-Level Security (RLS) para controlar o acesso a dados no nível da linha, garantindo que os usuários vejam e interajam apenas com os dados a que têm permissão. As seguintes políticas de RLS seriam implementadas:

*   **`users`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` em seus próprios dados de perfil (`id`, `nome`, `telefone`, `foto`, `role`). Não pode `INSERT`, `UPDATE` ou `DELETE` em outros usuários. Pode `UPDATE` em seus próprios campos permitidos (e.g., foto, telefone).

*   **`products`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` em todos os produtos (apenas `ativo=true`). Não pode `INSERT`, `UPDATE` ou `DELETE`.

*   **`clients`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` em todos os clientes. Pode `UPDATE` em clientes existentes (campos como `nome_fantasia`, `telefone`, `endereco`, `dia_roteiro`, `bairro`). Não pode `INSERT` ou `DELETE`.

*   **`cargas`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` e `UPDATE` apenas nas linhas onde `vendedor_id` é igual ao seu próprio `id`. Não pode `INSERT` ou `DELETE` diretamente.

*   **`cargas_pendentes`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` apenas nas linhas onde `vendedor_id` é igual ao seu próprio `id`. Pode `DELETE` a linha após aceitar a carga (a `DELETE` de fato ocorre via função do admin, mas a ação do vendedor aciona o processo).

*   **`sales`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE` (apenas `valor_pago`, `status_pagamento`) apenas nas linhas onde `vendedor_id` é igual ao seu próprio `id`. A exclusão (`DELETE`) seria restrita a vendas do dia e mediada por uma função de banco de dados.

*   **`sale_items`:**
    *   **ADMIN:** Pode `SELECT` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` apenas nas linhas relacionadas às suas próprias vendas (`sales.vendedor_id = current_user_id`). Não pode `INSERT`, `UPDATE` ou `DELETE` diretamente.

*   **`commissions`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` apenas nas linhas onde `vendedor_id` é igual ao seu próprio `id`. Não pode `INSERT`, `UPDATE` ou `DELETE`.

*   **`commission_payout_logs`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` apenas nas linhas onde `vendedor_id` é igual ao seu próprio `id`. Não pode `INSERT` ou `DELETE`.

*   **`system_messages`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT`, `UPDATE`, `DELETE` em todas as linhas.
    *   **VENDEDOR:** Pode `SELECT` apenas nas linhas onde `vendedor_id` é igual ao seu próprio `id`. Pode `UPDATE` a coluna `lida` para `true` em suas próprias mensagens. Não pode `INSERT` ou `DELETE`.

*   **`app_settings`:**
    *   **ADMIN:** Pode `SELECT`, `INSERT` (se a tabela estiver vazia), `UPDATE`, `DELETE`.
    *   **VENDEDOR:** Apenas `SELECT` (restrito aos campos necessários para o funcionamento do PDV, como nomes e QR codes Pix, e configurações de margem).

Este relatório técnico detalhado serve como um guia abrangente para a transição e implementação do banco de dados no Supabase, garantindo que todas as funcionalidades existentes, regras de negócio e requisitos de segurança sejam adequadamente considerados.