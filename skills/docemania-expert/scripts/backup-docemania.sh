#!/usr/bin/env bash
# DOCEMANIA — backup rotativo local (padrão da skill docemania-expert)
#
# O que faz:
#   1. Snapshot timestampado dos arquivos críticos do projeto em backups/<timestamp>/
#   2. Mantém só os últimos N backups (default 10) — rotação automática
#   3. Gera manifest com o HEAD do git para rastreabilidade
#   4. Nunca sobe para o git (backups/ está no .gitignore) — o backup DE NUVEM é o commit+push
#
# Uso:  bash skills/docemania-expert/scripts/backup-docemania.sh [N]
#   N = quantos backups manter (default 10)
#
# Quando rodar (regra da skill): antes de operação destrutiva e após cada bloco concluído,
# sempre seguido de commit + push (backup na nuvem + deploy Vercel).

set -euo pipefail
cd "$(dirname "$0")/../../.."   # raiz do projeto (/home/z/my-project)

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backups/${STAMP}"
KEEP="${1:-10}"

mkdir -p "$DEST"

# --- arquivos críticos (editados com frequência / essenciais ao sistema) ---
FILES=(
  worklog.md
  vercel.json
  package.json
  src/lib/supabase-config.ts
  src/lib/session.ts
  src/lib/serverSupabase.ts
  src/lib/serverSchema.ts
  src/lib/equipe.ts
  src/lib/caixaLedger.ts
  src/lib/erpConfig.ts
  src/lib/interBoleto.ts
  src/lib/focusNfe.ts
  prisma/schema.prisma
)
for f in "${FILES[@]}"; do
  [ -f "$f" ] && cp --parents "$f" "$DEST/"
done

# --- pastas críticas (SQL dos blocos + setup consolidado) ---
for d in sql supabase; do
  [ -d "$d" ] && cp -r "$d" "$DEST/"
done

# --- manifest com estado do git ---
{
  echo "Backup DOCEMANIA ${STAMP}"
  echo "HEAD: $(git rev-parse HEAD 2>/dev/null || echo 'sem git')"
  echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  echo "Status sujo (arquivos não commitados):"
  git status --porcelain 2>/dev/null | head -20 || true
  echo "Conteúdo:"
  (cd "$DEST" && find . -type f | sort)
} > "$DEST/backup-manifest.txt"

# --- rotação: manter só os últimos N ---
ls -1d backups/2* 2>/dev/null | sort | head -n -"$KEEP" 2>/dev/null | xargs -r rm -rf

echo "OK: backup criado em ${DEST}"
echo "Lembrete: o backup de nuvem é o GIT — rode commit + push na main após o bloco."
