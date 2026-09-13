#!/bin/sh
set -eu
umask 027
case "$TELEMETRY_HOST" in ''|*[!a-zA-Z0-9.-]*) echo 'TELEMETRY_HOST must be a DNS hostname' >&2; exit 1;; esac
mkdir -p /certs /secrets
if [ ! -f /secrets/ca-key.pem ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out /secrets/ca-key.pem
  openssl req -new -x509 -key /secrets/ca-key.pem -sha256 -days 3650 -subj '/CN=Lease Tracker Telemetry CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -out /certs/ca.pem
fi
if [ ! -f /secrets/command-private.pem ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out /secrets/command-private.pem
  openssl ec -in /secrets/command-private.pem -pubout -out /secrets/command-public.pem
fi
for service in telemetry proxy; do
  if [ "$service" = telemetry ]; then host="$TELEMETRY_HOST"; else host=command-proxy; fi
  openssl ecparam -name prime256v1 -genkey -noout -out "/certs/$service-key.pem.new"
  openssl req -new -key "/certs/$service-key.pem.new" -subj "/CN=$host" -out "/certs/$service.csr"
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\nbasicConstraints=critical,CA:FALSE\n' "$host" > "/certs/$service.ext"
  openssl x509 -req -in "/certs/$service.csr" -CA /certs/ca.pem -CAkey /secrets/ca-key.pem -CAcreateserial -days 90 -sha256 -extfile "/certs/$service.ext" -out "/certs/$service.pem.new"
  openssl verify -CAfile /certs/ca.pem "/certs/$service.pem.new"
  mv "/certs/$service-key.pem.new" "/certs/$service-key.pem"
  mv "/certs/$service.pem.new" "/certs/$service.pem"
  rm "/certs/$service.csr" "/certs/$service.ext"
done
chown -R 1000:1000 /certs /secrets
chmod 750 /certs /secrets
chmod 640 /certs/* /secrets/*
chmod 644 /certs/ca.pem /secrets/command-public.pem
echo 'Certificates generated. Restart telemetry and command-proxy after renewal.'
