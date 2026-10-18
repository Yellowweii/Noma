FROM golang:1.25-alpine
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
COPY scripts/dev-reload.sh /usr/local/bin/dev-reload.sh
RUN sed -i 's/\r$//' /usr/local/bin/dev-reload.sh && chmod +x /usr/local/bin/dev-reload.sh
EXPOSE 3000
CMD ["sh", "/usr/local/bin/dev-reload.sh"]
