# e-hub

Una sola app React per la mia **libreria di ebook**, i **podcast ascoltati** e le **note** su entrambi, con lo stesso stile e la stessa navigazione.

Sito pubblicato su GitHub Pages: https://gabrieleghisleni.github.io/e-hub/

Il sito pubblicato è in sola lettura. Aggiungere libri, podcast e note si fa solo in locale (`pnpm dev`), poi si fa commit dei file in `packages/*/data` e push: il deploy è automatico.

## Avvio rapido

Servono Node 24 e pnpm 11.

```bash
pnpm install
pnpm dev
```

L'app gira su http://127.0.0.1:5173.

## Comandi

| Comando          | Cosa fa                                          |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | App + server locali di scrittura (libreria, note, podcast) |
| `pnpm build`     | Build statica in `apps/web/dist`                 |
| `pnpm preview`   | Anteprima della build                            |
| `pnpm typecheck` | Typecheck di tutti i pacchetti                   |
| `pnpm test`      | Test di tutti i pacchetti                        |

## Deploy

Ogni push su `main` esegue [`.github/workflows/pages.yml`](.github/workflows/pages.yml): build con `BASE_PATH=/<nome-repo>/` e pubblicazione su GitHub Pages.

## Documentazione

Vedi [docs/](docs/README.md), a partire dalla [struttura del repo](docs/struttura.md).
