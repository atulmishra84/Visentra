#!/usr/bin/env bash
# Bind aiauthpro.com (and www) to the Visentra web Container App.
# Prerequisites: DNS records below must already propagate.
set -euo pipefail

RG="${RG:-rg-agentradar-disc-01}"
WEB_APP="${WEB_APP:-web-arqsrvr46epnpok}"
API_APP="${API_APP:-api-arqsrvr46epnpok}"
ENV_NAME="${ENV_NAME:-cae-arqsrvr46epnpok}"
DOMAIN="${DOMAIN:-aiauthpro.com}"
WWW="www.${DOMAIN}"

STATIC_IP="$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query properties.staticIp -o tsv)"
VERIFY_ID="$(az containerapp show -n "$WEB_APP" -g "$RG" --query properties.customDomainVerificationId -o tsv)"
WEB_FQDN="$(az containerapp show -n "$WEB_APP" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv)"

echo "==> Required DNS (GoDaddy → DNS → aiauthpro.com)"
echo
echo "  Type  Name    Value"
echo "  ----  ------  ---------------------------------------------------------------"
echo "  TXT   asuid   ${VERIFY_ID}"
echo "  TXT   asuid   ${VERIFY_ID}   (host: asuid.www  OR name 'asuid.www')"
echo "  A     @       ${STATIC_IP}"
echo "  CNAME www     ${WEB_FQDN}"
echo
echo "  Optional cleanup: remove GoDaddy parking/forwarding A records"
echo "  (13.248.243.5 / 76.223.105.230) so only ${STATIC_IP} remains."
echo

fail=0
check_txt() {
  local host="$1"
  local got
  got="$(dig +short TXT "$host" | tr -d '"' | tr -d ' ' | head -1 || true)"
  if [[ "$got" == "$VERIFY_ID" ]]; then
    echo "OK  TXT $host"
  else
    echo "MISSING/WRONG  TXT $host (got: ${got:-none})"
    fail=1
  fi
}

check_txt "asuid.${DOMAIN}"
check_txt "asuid.${WWW}"

APEX_IP="$(dig +short A "$DOMAIN" | head -1 || true)"
if [[ "$APEX_IP" == "$STATIC_IP" ]]; then
  echo "OK  A ${DOMAIN} → ${STATIC_IP}"
else
  echo "MISSING/WRONG  A ${DOMAIN} (got: ${APEX_IP:-none}, want ${STATIC_IP})"
  fail=1
fi

WWW_TARGET="$(dig +short CNAME "$WWW" | head -1 || true)"
if [[ "$WWW_TARGET" == "${WEB_FQDN}." || "$WWW_TARGET" == "$WEB_FQDN" ]]; then
  echo "OK  CNAME ${WWW} → ${WEB_FQDN}"
else
  # Also accept A pointing at static IP
  WWW_IP="$(dig +short A "$WWW" | head -1 || true)"
  if [[ "$WWW_IP" == "$STATIC_IP" ]]; then
    echo "OK  A ${WWW} → ${STATIC_IP}"
  else
    echo "MISSING/WRONG  CNAME/A ${WWW} (got CNAME=${WWW_TARGET:-none} A=${WWW_IP:-none})"
    fail=1
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "Fix DNS at GoDaddy, wait for propagation, then re-run:"
  echo "  $0"
  exit 1
fi

echo
echo "==> Binding managed certificates"
az containerapp hostname bind \
  -n "$WEB_APP" -g "$RG" \
  --hostname "$DOMAIN" \
  --environment "$ENV_NAME" \
  --validation-method HTTP

az containerapp hostname bind \
  -n "$WEB_APP" -g "$RG" \
  --hostname "$WWW" \
  --environment "$ENV_NAME" \
  --validation-method HTTP

echo
echo "==> Updating API CORS / SSO redirect"
az containerapp update -n "$API_APP" -g "$RG" \
  --set-env-vars \
  "CORS_ORIGIN=https://${DOMAIN},https://${WWW},https://${WEB_FQDN}" \
  "ENTRA_REDIRECT_URI=https://${DOMAIN}/login" \
  -o none

echo
echo "Done."
echo "  Web: https://${DOMAIN}/login"
echo "  Also: https://${WWW}/login"
echo "In your IdP (Entra/Okta/Auth0), set redirect URI to:"
echo "  https://${DOMAIN}/login"
