package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	keyboardtutor "github.com/geropl/keyboard-tutor"
	"github.com/geropl/keyboard-tutor/internal/midi"
	"github.com/geropl/keyboard-tutor/internal/progress"
	"github.com/geropl/keyboard-tutor/internal/server"
	"github.com/geropl/keyboard-tutor/internal/songs"
)

func main() {
	port := flag.Int("port", 3000, "HTTP server port")
	midiDevice := flag.String("midi", "/dev/midi1", "MIDI device path")
	dataDir := flag.String("data", "./data", "Directory for progress data")
	flag.Parse()

	// --- Songs ---
	songsFS, err := fs.Sub(keyboardtutor.SongsFS, "songs")
	if err != nil {
		log.Fatalf("songs embed: %v", err)
	}
	songSvc, err := songs.NewService(songsFS)
	if err != nil {
		log.Fatalf("load songs: %v", err)
	}
	log.Printf("Loaded %d songs", len(songSvc.List()))

	// --- Progress ---
	progressFile := filepath.Join(*dataDir, "progress.json")
	prog, err := progress.NewManager(progressFile)
	if err != nil {
		log.Fatalf("progress: %v", err)
	}

	// --- MIDI ---
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var noteOn, noteOff <-chan midi.NoteEvent

	midiReader := midi.NewRawReader(*midiDevice)
	on, off, errc := midiReader.Start(ctx)

	// Check if MIDI device opened successfully
	select {
	case err := <-errc:
		if err != nil {
			log.Printf("MIDI device %s unavailable: %v (running without MIDI)", *midiDevice, err)
		}
	default:
		noteOn = on
		noteOff = off
		log.Printf("MIDI reader started on %s", *midiDevice)
	}

	// --- Static files ---
	publicFS, err := fs.Sub(keyboardtutor.PublicFS, "public")
	if err != nil {
		log.Fatalf("public embed: %v", err)
	}

	// --- HTTP Server ---
	handler := server.New(server.Config{
		PublicFS:  publicFS,
		Songs:    songSvc,
		Progress: prog,
		NoteOn:   noteOn,
		NoteOff:  noteOff,
	})

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: handler,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down...")
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("Piano Tutor running at http://localhost:%d", *port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}
