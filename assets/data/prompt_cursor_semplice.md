Crea la home page di "Peak Prompt", un sito su un trekking da Passo Falzarego al Lagazuoi (vetta 2.682 m). Usa Vite + JavaScript + Three.js (un piano a tutto schermo con uno shader).

DATI
- Leggi `assets/data/percorso.json` → array `photos`.
- Ordina le foto per `lightRank` (1 = la più buia, 30 = la più luminosa).
- Per ogni foto usa: `imageBW` (immagine in bianco e nero), `light` e `shadow` (frazione 0–1 di luce e buio), `thrLow` e `thrHigh` (soglie 0–1), `zoomFocus` {x, y} (punto in cui zoomare), `time`, `ele`, `sunAzimuth`, `sunElevation`.
- `sunPath.points` contiene l'arco del sole di quel giorno ({time, az, el}).
- Non modificare nulla in `assets/`.

ESPERIENZA (tutto guidato dallo scroll, reversibile)
1. Apertura: sfondo blu (#1f2dff) a tutto schermo, granuloso e in movimento (grana animata). Al centro "PEAK PROMPT" e un pulsante "Scorri verso la luce ↓" che porta alla prima foto.
2. Poi le 30 foto, una dopo l'altra, sempre a pieno schermo (cover). Per ogni foto, scrollando verso il basso:
   - la foto appare in bianco e nero;
   - si accendono le soglie: i pixel con luminanza > `thrHigh` diventano rossi (#ff3a24), quelli < `thrLow` blu (#1f2dff), il resto resta grigio. Le soglie partono "spente" (0 e 1) e arrivano a `thrLow`/`thrHigh`;
   - la camera zooma dentro la foto verso `zoomFocus`;
   - dal centro dello zoom compare la foto successiva, di nuovo in bianco e nero.
3. Scrollando verso l'alto succede l'inverso: zoom out, le soglie si spengono, si torna alla foto precedente.
4. Fine: dopo la foto più luminosa, sfondo rosso (#ff3a24) a tutto schermo, granuloso e in movimento, con "VETTA · 2.682 m".

INTERFACCIA (sopra le foto, font monospace, bianco con mix-blend-mode: difference)
- In basso a sinistra: "LUCE xx,x%" e "BUIO xx,x%" della foto corrente, che salgono mentre si accendono le soglie fino a `light` e `shadow`.
- In basso a destra: un orologio solare. Un cerchio è l'orizzonte visto dall'alto (centro = zenit, bordo = orizzonte, con N E S O), l'arco tratteggiato è `sunPath`, un punto pieno è il sole nel momento della foto (angolo = azimut, distanza dal centro = 1 − elevazione/90). Sotto, l'ora della foto.
- In alto a destra: "07 / 30" e la quota della foto.

Lavora per passi e fermati dopo ognuno: (1) sfondo blu/rosso granuloso + scroll, (2) foto a pieno schermo in sequenza, (3) soglie rosso/blu, (4) zoom e passaggio tra foto, (5) interfaccia.
