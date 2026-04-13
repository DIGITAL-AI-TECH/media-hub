#!/usr/bin/env bash
# configure-s3-cors.sh — Configura CORS no bucket S3 para players HLS no browser
#
# Uso:
#   ./scripts/configure-s3-cors.sh <origem1> [origem2] [origem3...]
#
# Exemplos:
#   ./scripts/configure-s3-cors.sh https://app.cliente.com
#   ./scripts/configure-s3-cors.sh https://a.com https://b.com https://admin.b.com
#
# Variáveis de ambiente:
#   S3_BUCKET       — nome do bucket (default: cdn.digital-ai.tech)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION — credenciais AWS

set -euo pipefail

BUCKET="${S3_BUCKET:-cdn.digital-ai.tech}"
CORS_TMP="$(mktemp /tmp/cors-XXXXXX.json)"

# --- Validação de argumentos ---
if [ "$#" -eq 0 ]; then
  echo "Uso: $0 <origem1> [origem2] ..."
  echo "Exemplo: $0 https://app.seucliente.com https://admin.seucliente.com"
  exit 1
fi

# --- Verificar AWS CLI ---
if ! command -v aws &>/dev/null; then
  echo "Erro: aws CLI não encontrado. Instale com: pip install awscli"
  exit 1
fi

# --- Construir JSON de origens ---
ORIGINS_JSON="["
first=true
for origin in "$@"; do
  # Validação básica: deve começar com http:// ou https://
  if [[ ! "$origin" =~ ^https?:// ]]; then
    echo "Erro: origem inválida '$origin' — deve começar com http:// ou https://"
    exit 1
  fi
  if [ "$first" = true ]; then
    ORIGINS_JSON+="\"$origin\""
    first=false
  else
    ORIGINS_JSON+=",\"$origin\""
  fi
done
ORIGINS_JSON+="]"

echo "Configurando CORS no bucket: $BUCKET"
echo "Origens autorizadas: $ORIGINS_JSON"
echo ""

# --- Gerar configuração CORS ---
cat > "$CORS_TMP" << EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": $ORIGINS_JSON,
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
      "MaxAgeSeconds": 86400
    }
  ]
}
EOF

echo "Configuração CORS gerada:"
cat "$CORS_TMP"
echo ""

# --- Aplicar no S3 ---
echo "Aplicando configuração no S3..."
aws s3api put-bucket-cors \
  --bucket "$BUCKET" \
  --cors-configuration "file://$CORS_TMP"

echo ""
echo "Verificando configuração aplicada..."
aws s3api get-bucket-cors --bucket "$BUCKET"

echo ""
echo "✓ CORS configurado com sucesso no bucket '$BUCKET'"
echo ""
echo "Próximos passos:"
echo "  1. Se usar CloudFront, certifique-se que o Origin header é encaminhado ao S3"
echo "     (use a policy managed 'CORS-S3Origin' no CloudFront Behavior)"
echo "  2. Se CORS não funcionar imediatamente, invalide o cache do CloudFront:"
echo "     aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'"

# --- Cleanup ---
rm -f "$CORS_TMP"
