package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"noma.local/public/noma-backend/app"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		_, port, err := net.SplitHostPort(os.Getenv("NOMA_LOCAL_ADDR"))
		if err != nil {
			_, port, _ = net.SplitHostPort(app.DefaultAddr)
		}
		client := &http.Client{Timeout: 2 * time.Second}
		response, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", port) + "/api/local/health")
		if err != nil {
			os.Exit(1)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}
	configPath := flag.String("config", "data/local.json", "local backend configuration file (optional)")
	flag.Parse()
	cfg, err := app.LoadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	handler, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	// The gateway proxies the Next.js dev server, including its long-lived refresh socket.
	srv := &http.Server{Addr: cfg.Addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 0, WriteTimeout: 0, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("Noma Local listening on %s", cfg.Addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
