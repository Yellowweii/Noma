FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /noma-local ./cmd/noma-local

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /noma-local /usr/local/bin/noma-local
USER 10001:10001
ENV NOMA_LOCAL_ADDR=0.0.0.0:3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/usr/local/bin/noma-local", "healthcheck"]
ENTRYPOINT ["noma-local"]
