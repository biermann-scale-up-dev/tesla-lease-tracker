FROM alpine:3.22
RUN apk add --no-cache openssl
COPY certificates.sh /usr/local/bin/certificates
ENTRYPOINT ["/bin/sh", "/usr/local/bin/certificates"]
