# testas1

Projektas valdomas AI projektų dashboardo.

- Viešas adresas: https://testas1.vargan.pro
- Diegimo šaka: `main`
- Projekto aplinka: `.dashboard/project.json` (žr. žemiau)
- Sveikatos patikra: `GET /health`

## Kaip diegiami pakeitimai

1. Pakeitimai daromi atskiroje šakoje ir pateikiami Pull Request į `main`.
2. Rankinis režimas: PR peržiūri ir sujungia žmogus.
3. Kiekvienas naujas commit diegimo šakoje automatiškai įdiegiamas į projekto LXC konteinerį (tikslus SHA). Nepavykus veikia projekto atkūrimo politika.

## Projekto aplinka: `.dashboard/project.json`

Konteineris – tuščias Ubuntu. Ko projektui reikia, aprašoma šiame faile; dashboardas diegdamas įdiegia trūkstamą aplinką ir paleidžia programą.

| Laukas | Reikšmė |
|---|---|
| `runtime` | `node`, `python` arba `static` |
| `node` | Node.js versija: `18`, `20`, `22` (numatyta) arba `24` |
| `build` | npm skriptas build'ui, pvz. `build` (nebūtina) |
| `start` | node: npm skriptas paleidimui (numatyta `start`); python: įėjimo failas (numatyta `main.py`) |
| `root` | static: aptarnaujamas katalogas (numatyta `dist`, jei yra build, kitaip `public`) |

Pavyzdžiai:

- Node: `{ "runtime": "node", "node": "22", "build": "build", "start": "start" }` – vykdoma `npm ci`, `npm run build`, paleidžiama `npm run start`.
- Python: `{ "runtime": "python", "start": "main.py" }` – venv, `pip install -r requirements.txt`, paleidžiamas `main.py`.
- Statinė svetainė: `{ "runtime": "static", "build": "build", "root": "dist" }`.

Programa turi klausytis prievado iš `PORT` ir atsakyti `200` į `GET /health`. Kitų komandų failas nurodyti negali.

Daugiau taisyklių AI agentui – `AGENTS.md`.
