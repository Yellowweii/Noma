FROM golang:1.25-alpine
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY noma-backend ./noma-backend
COPY scripts/dev-reload.sh /usr/local/bin/dev-reload.sh
RUN sed -i 's/\r$//' /usr/local/bin/dev-reload.sh && chmod +x /usr/local/bin/dev-reload.sh
EXPOSE 3000
CMD ["sh", "/usr/local/bin/dev-reload.sh"]
