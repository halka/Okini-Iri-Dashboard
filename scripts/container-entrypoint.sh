#!/bin/sh
set -eu

if [ -n "${CUSTOM_CA_CERT:-}" ]; then
  if [ ! -f "$CUSTOM_CA_CERT" ]; then
    echo "CUSTOM_CA_CERT does not point to a readable certificate: $CUSTOM_CA_CERT" >&2
    exit 1
  fi

  cp "$CUSTOM_CA_CERT" /usr/local/share/ca-certificates/okini-custom-ca.crt
  update-ca-certificates
fi

exec "$@"
