# Regras de Desenvolvimento e Stack Tecnológica

Este documento define a pilha tecnológica utilizada no projeto DOCE MANIA e estabelece regras claras para o uso de bibliotecas e padrões de codificação.

## 1. Stack Tecnológica

1.  **Linguagem:** TypeScript (TSX) para tipagem forte e desenvolvimento robusto.
2.  **Framework:** React (v19+) para construção da interface do usuário.
3.  **Build Tool:** Vite.
4.  **Estilização:** Tailwind CSS para design responsivo e utilitário-first.
5.  **Componentes UI:** Priorizar componentes nativos e utilitários do Tailwind. O uso de `shadcn/ui` e `lucide-react` é incentivado para componentes complexos e ícones, respectivamente.
6.  **Backend/Banco de Dados:** Supabase (PostgreSQL) para persistência de dados, utilizando o `@supabase/supabase-js` para comunicação.
7.  **Arquitetura de Dados:** O acesso a dados deve ser encapsulado em módulos de serviço (`src/services/`), garantindo que a lógica de interação com o Supabase não esteja nos componentes.
8.  **Autenticação:** Baseada em PIN, com dados de usuário (`User`) persistidos na tabela `app_users` do Supabase.
9.  **Navegação:** Implementada via renderização condicional e gerenciamento de estado local (Single Page Application - SPA), sem o uso de bibliotecas de roteamento externas como React Router.

## 2. Regras de Uso de Bibliotecas e Padrões

| Funcionalidade | Biblioteca/Padrão Recomendado | Regras de Uso |
| :--- | :--- | :--- |
| **Estilo e Layout** | Tailwind CSS | **Obrigatório** para todo o estilo. Garantir designs responsivos (mobile-first). |
| **Ícones** | `lucide-react` | **Priorizar** o uso de `lucide-react`. Font Awesome (atualmente em uso) pode ser mantido onde já existe, mas novos ícones devem ser `lucide-react`. |
| **Componentes UI** | `shadcn/ui` | Utilizar componentes pré-construídos do `shadcn/ui` (como Button, Card, Input, etc.) para manter a consistência visual. |
| **Acesso a Dados (CRUD)** | Módulos de Serviço (`src/services/`) | **Obrigatório** que todas as operações de leitura/escrita/atualização de entidades persistidas no Supabase (`User`, `Product`, `Client`, `Sale`, `Commission`, `Carga`, etc.) passem pelo serviço correspondente. |
| **Notificações** | Toasts (se instalados) | Usar notificações de toast para feedback de sucesso ou erro ao usuário após operações assíncronas. |
| **Persistência Local** | `localStorage` | Usado para persistir estados temporários ou não críticos (e.g., carrinho PDV, configurações de UI), mas a maioria dos dados críticos deve ser persistida no Supabase. |
| **Tipagem** | `types.ts` | **Obrigatório** usar as interfaces definidas em `src/types.ts` para garantir a consistência dos dados em toda a aplicação. |