# Konkurso

Lietuviška pirkimų konkursų valdymo sistema dalyvių komandoms. Komanda gali registruotis, pakviesti kolegas, rankiniu būdu įvesti konkursus, sekti terminus, būsenas ir užduotis. Nemokamas planas leidžia turėti iki 3 konkursų; mėnesinis „Pro“ planas suteikia neribotą skaičių.

## Vietinis paleidimas

Reikia Node.js 22 ar naujesnės versijos ir npm. Projektas naudoja SQLite; papildomos duomenų bazės vietiniam paleidimui nereikia.

1. `npm ci`
2. `npm run build`
3. `PORT=3000 npm start`
4. Patikrinkite `GET http://localhost:3000/health` (HTTP 200, `ok`) ir atidarykite `http://localhost:3000/`.

`npm test` vykdo integracinį API ir prenumeratos teisių testą. `npm run lint` tikrina JavaScript sintaksę. `build` nukopijuoja `public/` į `dist/`; serveris aptarnauja `dist/` ir API tuo pačiu prievadu.

## Gamybinė konfigūracija

| Kintamasis | Paskirtis |
| --- | --- |
| `PORT` | HTTP prievadas; jei nenurodytas, 3000 |
| `BASE_URL` | Viešas HTTPS adresas, pvz., `https://testas1.vargan.pro`; naudojamas „Stripe“ grąžinimo adresams ir slapukams |
| `DATA_DIR` | **Nuolat išliekantis** katalogas SQLite duomenims; pagal nutylėjimą `./data` |
| `DATABASE_PATH` | Pasirinktinis pilnas SQLite failo kelias vietoje `DATA_DIR/testas1.sqlite` |
| `STRIPE_SECRET_KEY` | „Stripe“ serverio API raktas |
| `STRIPE_PRICE_ID` | „Stripe“ mėnesinės pasikartojančios kainos ID |
| `STRIPE_WEBHOOK_SECRET` | Webhook pasirašymo paslaptis |

Mokėjimų aktyvavimui „Stripe“ skydelyje reikia sukurti mėnesinę pasikartojančią kainą, įjungti klientų portalą ir užregistruoti viešą `POST /api/stripe/webhook` adresą. Įvykiai: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Be mokėjimo kintamųjų nemokamas planas veikia, o atsiskaitymo veiksmas neveikia. Sumą pirkėjas mato „Stripe“ atsiskaitymo lange; ji nustatoma pagal `STRIPE_PRICE_ID`.

`DATA_DIR` gamyboje turi būti prijungtas prie išliekančios saugyklos. Darykite SQLite failo atsargines kopijas. Saugaus HTTPS ir šios saugyklos konfigūraciją turi užtikrinti diegimo aplinka. Paslapčių ar `.env` failų į repozitoriją nedėkite.

## Dashboard diegimas

Repozitorijos `AGENTS.md` reikalauja `.dashboard/project.json`, tačiau šio failo kol kas nėra, o agentams jį keisti draudžiama. Dashboard administratorius turi jį pridėti su Node 22, `build` ir `start` npm skriptais, pavyzdžiui:

    { "runtime": "node", "node": "22", "build": "build", "start": "start" }

Taip pat reikia suteikti gamybinius kintamuosius, išliekančią `DATA_DIR` saugyklą ir tinklo prieigą prie `api.stripe.com`. Kol tai nepadaryta, mokamo plano negalima laikyti parengtu viešam diegimui.

Pakeitimai teikiami per atskirą šaką ir Pull Request į `main`; sujungia žmogus.
