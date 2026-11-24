# Scorciatoie per i comandi di tutti i giorni. `make` (o `make help`) elenca i target.
# Il Pi: RPI_HOST/RPI_KEY si possono sovrascrivere, es. `make logs RPI_HOST=ggabry@altro`.

RPI_HOST ?= ggabry@100.84.50.10
RPI_KEY  ?= ~/.ssh/id_ed25519_py
RPI      := ssh -i $(RPI_KEY) $(RPI_HOST)
ELIB     := pnpm --filter @ehub/library elib

.DEFAULT_GOAL := help
.PHONY: help install dev build preview typecheck test check \
        db-status db-sync db-push validate kobo-sync-dry \
        logs logs-tail logs-errors status update-logs health

help: ## Elenco dei comandi
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

# ---- sviluppo
install: ## Installa le dipendenze
	pnpm install

dev: ## App + server locali su http://127.0.0.1:5173
	pnpm dev

build: ## Build statica in apps/web/dist
	pnpm build

preview: ## Anteprima della build
	pnpm preview

typecheck: ## Typecheck di tutti i pacchetti
	pnpm typecheck

test: ## Test di tutti i pacchetti
	pnpm test

check: typecheck test build ## Verifica completa prima di un commit

# ---- libreria
validate: ## Controlla packages/library/data
	$(ELIB) validate

db-status: ## Libreria locale vs account hosted (serve EHUB_API_URL/TOKEN)
	$(ELIB) db status

db-sync: ## Anteprima di cosa si allinea tra locale e account
	$(ELIB) db sync

db-push: ## Allinea davvero (copia ciò che manca; i file diversi restano)
	$(ELIB) db sync --apply

kobo-sync-dry: ## Cosa cambierebbe sul Kobo (nessuna scrittura)
	$(ELIB) sync --dry-run

# ---- Raspberry Pi (API hosted)
logs: ## Log del servizio in diretta (Ctrl-C per uscire)
	$(RPI) 'journalctl -u ehub-api -f'

logs-tail: ## Ultime 200 righe di log
	$(RPI) 'journalctl -u ehub-api -n 200 --no-pager'

logs-errors: ## Solo gli errori dell'ultima ora
	$(RPI) 'journalctl -u ehub-api --since "1 hour ago" -p err --no-pager'

status: ## Stato del servizio (attivo? riavvii recenti?)
	$(RPI) 'systemctl status ehub-api --no-pager'

update-logs: ## Ultimi aggiornamenti automatici da GitHub
	$(RPI) 'journalctl -u ehub-update -n 50 --no-pager'

health: ## Controlla /api/health (API_URL=https://… make health)
	@test -n "$(API_URL)" || { echo "Imposta API_URL, es. API_URL=https://… make health"; exit 1; }
	curl -fsS $(API_URL)/api/health && echo
