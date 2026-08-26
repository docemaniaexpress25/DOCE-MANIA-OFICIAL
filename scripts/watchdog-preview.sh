#!/bin/bash
# Watchdog: mantém o preview Next.js sempre no ar
NEXT_CMD="npx next dev --turbopack -p 3000 -H 0.0.0.0"
LOG="/tmp/next-preview.log"
PROJECT="/home/z/my-project"

cd "$PROJECT"

while true; do
  # Verifica se o Next.js está respondendo
  STATUS=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    sleep 10
    continue
  fi

  # Mata qualquer processo Next.js residual
  pkill -f 'next dev' 2>/dev/null
  sleep 2

  # Inicia o Next.js
  echo "[$(date)] Reiniciando Next.js..." >> "$LOG"
  nohup $NEXT_CMD >> "$LOG" 2>&1 &
  echo "[$(date)] Iniciado PID: $!" >> "$LOG"

  # Espera subir
  sleep 20
  echo "[$(date)] Status: $(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null)" >> "$LOG"

  sleep 30
done
