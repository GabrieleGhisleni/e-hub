# Struttura del repo

Monorepo pnpm (`pnpm-workspace.yaml`: `apps/*` e `packages/*`).

```
apps/
  web/            App React (Vite) che monta tutti i moduli: shell, header, home, routing
packages/
  ui/             Design system condiviso (shadcn/ui, tema, layout, filtri, pannello laterale)
  library/        Libreria ebook: sito, CLI e server locale di amministrazione
  podcasts/       Podcast: catalogo, episodi, trascrizioni, CLI e server locale
  notes/          Note su libri ed episodi (usate da entrambi i moduli)
docs/             Questa documentazione
.github/workflows Deploy su GitHub Pages
```

## Come si incastra

- `apps/web` dipende dai pacchetti `@ehub/*` e li espone come rotte: `/library`, `/podcasts`, `/notes`.
- Stack: React + Tailwind CSS + shadcn/ui; i componenti condivisi vivono in `packages/ui`.
- I server di scrittura (Hono) esistono solo in dev e non entrano nella build statica.

## Dati

I dati stanno in `packages/*/data` come file JSON, versionati in git e pubblicati con il sito. Non si modificano a mano: si passa dalla UI locale o dalle CLI dei moduli.

Il repo è pubblico, quindi alcuni dati restano solo in locale (gitignored): trascrizioni, audio e cache dei podcast in `packages/podcasts/data/`.
