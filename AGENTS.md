# Instrukcijos AI agentui

Šią repozitoriją diegia AI projektų dashboardas. Laikykis šių taisyklių.

## Darbo eiga

- Niekada nekeisk `main` tiesiogiai – kurk šaką ir atidaryk Pull Request į `main`.
- Vienas PR – vienas aiškus pakeitimas. Aprašyk, ką ir kodėl keiti.
- Programa turi klausytis prievado iš `PORT` aplinkos kintamojo ir atsakyti `200` į `GET /health`.
- Reikalinga aplinka (Node/Python/static, versija, build, paleidimas) aprašyta `.dashboard/project.json` (žr. README.md). Jo keisti negalima – paprašyk žmogaus.
- Į repozitoriją nedėk paslapčių, raktų, slaptažodžių ar `.env` failų.

## Failai, kurių keisti negalima

Šių failų pakeitimai niekada nepatvirtinami automatiškai:

- `.github/**`
- `CODEOWNERS`
- `AGENTS.md`
- `.dashboard/**`

## Patvirtinimas

Projektas naudoja rankinį patvirtinimą: PR sujungia žmogus.
