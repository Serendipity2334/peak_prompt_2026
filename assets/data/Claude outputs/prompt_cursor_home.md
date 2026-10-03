# Prompt per Cursor: home page "Peak Prompt"

Copia tutto quello che segue nella chat di Cursor (modalità Agent), con la cartella `peak prompt` aperta come progetto.

---

## Contesto

Sto realizzando un sito interattivo chiamato **Peak Prompt** per un progetto di Design della Comunicazione. Il 2 ottobre 2026 ho fatto un trekking da Passo Falzarego al Lagazuoi (da circa 2.065 a 2.680 m, circa 4,4 km, salendo anche attraverso le gallerie della Grande Guerra). Lungo il percorso ho scattato 30 immagini con l'app phyphox, che sovrappone alla fotocamera due colori:

- **rosso** dove la luce è oltre la soglia alta (zone abbagliate),
- **blu** dove è sotto la soglia bassa (zone buie),
- il resto dell'immagine resta in **scala di grigi**: è l'intermezzo, l'unica parte in cui si vede davvero.

Il riferimento concettuale è [Solar Protocol](https://solarprotocol.net), un sito che cambia in base all'energia solare disponibile. Qui il tema è la **soglia tra luce e ombra**.

## Concetto della home

La home è un **ambiente 3D che ricostruisce la salita**, attraversato con lo **scroll**.

- **Il blu è il punto di partenza** (Passo Falzarego, in basso): all'inizio il mondo è quasi tutto blu.
- **Il rosso è la vetta** (Lagazuoi, in alto): alla fine il mondo è quasi tutto rosso.
- **Il grigio è l'intermezzo**, la fascia visibile tra le due soglie: è stretto all'inizio e alla fine e massimo a metà salita.
- Scorrere significa salire: lo scroll fa avanzare la camera lungo il percorso reale e, insieme, **sposta le due soglie** che decidono cosa diventa blu, cosa diventa rosso e cosa resta grigio.
- Le 30 immagini sono collocate nello spazio **in ordine cronologico, nella posizione GPS in cui sono state scattate**, e reagiscono alla stessa soglia globale.

Nota di senso da rispettare: le tappe più buie (le gallerie) sono vicino alla cima. La luce della vetta arriva quindi dopo il tratto più scuro, e la soglia globale non deve cancellare i dati delle singole immagini, che conservano le loro percentuali misurate.

## Dati (già presenti nel progetto)

- `assets/data/percorso.json` contiene:
  - `route`: nome, date, quota minima e massima, distanza totale, note.
  - `track`: circa 380 punti `{t, lat, lon, ele, dist}` della traccia GPS (quote già lisciate).
  - `photos`: 30 oggetti in ordine cronologico con `order, id, image, layer, time, timeEstimated, lat, lon, ele, dist, luma (0–1), light, shadow, neutral (frazioni 0–1), phyphoxFile`.
- `assets/images/<id>.jpg` (e `27.PNG`, `28.PNG`): screenshot phyphox originali, cioè grigio con rosso e blu sovrapposti.
- `assets/images/solo_rosso_blu/<id>_rosso_blu.png`: solo i livelli rosso e blu su sfondo trasparente.

Non inventare dati: ogni numero mostrato deve venire da `percorso.json`.

## Stack

- Vite + JavaScript (vanilla, moduli ES) + **Three.js** (ultima versione stabile da npm).
- Nessun framework UI. CSS scritto a mano.
- Scroll nativo: una pagina alta (circa 800vh) con il canvas `position: fixed`; il progresso è `p = scrollY / (scrollHeight − innerHeight)`, da 0 a 1, interpolato con un easing morbido (lerp) per evitare scatti.

## Scena 3D

1. **Coordinate.** Converti lat/lon in metri locali rispetto al primo punto della traccia (proiezione equirettangolare: `x = (lon − lon0) · 111320 · cos(lat0)`, `z = −(lat − lat0) · 110540`), poi `y = (ele − eleMin)` con un'esagerazione verticale di 1.5. Scala tutto (per esempio 1 unità = 10 m) in modo che il percorso stia comodamente in scena.
2. **Percorso.** Una `CatmullRomCurve3` costruita sui punti di `track`. Disegnala come linea sottile e luminosa, più una seconda linea proiettata sul piano di base (y = 0) collegata alla prima da sottili linee verticali ogni N punti, così si legge il dislivello.
3. **Camera.** Segue la curva in funzione di `p`: posizione = punto della curva a `p`, leggermente sopra e dietro; sguardo verso un punto più avanti sulla curva. Movimento lento e fluido, senza scossoni.
4. **Immagini.** Ogni foto è un `PlaneGeometry` con le proporzioni reali dell'immagine, posizionato sul punto della curva più vicino a `dist` e ruotato di fronte alla camera (billboard morbido). Offset laterale alternato (sinistra e destra) per evitare sovrapposizioni tra foto ravvicinate (per esempio 15 e 16, 25 e 26, 29 e 30).
5. **Ambiente.** Nessun terreno inventato: lo spazio è astratto, il rilievo lo dà solo la traccia. Il piano di base è una **griglia a tasselli** (vedi "Estetica"), non un pavimento realistico. Sfondo e nebbia (`scene.fog`) passano dal blu elettrico al grigio al rosso in base a `p`; nei tratti di galleria (foto con `shadow > 0.15`) virano verso il nero.

## La soglia (il cuore del progetto)

Un unico `ShaderMaterial` condiviso da tutte le immagini, con uniform `uLow`, `uHigh`, `uTime`, la texture dello screenshot `uImage` e i colori `uBlue`, `uRed`.

**Nel fragment shader, per ogni pixel dello screenshot:**

1. Ricostruisci una luminosità `L`:
   - se il pixel è saturo (max − min dei canali > 0.16) ed è dominante il rosso → `L = 1.0` (era sovraesposto);
   - se è saturo ed è dominante il blu → `L = 0.0` (era sottoesposto);
   - altrimenti `L = 0.2126·R + 0.7152·G + 0.0722·B`.
2. Applica le soglie:
   - `L < uLow` → `uBlue`;
   - `L > uHigh` → `uRed`;
   - altrimenti grigio, rimappato nell'intermezzo: `gray = (L − uLow) / (uHigh − uLow)`.
3. Aggiungi un **dithering ordinato (matrice Bayer 4×4)** ai bordi delle soglie, così il passaggio tra blu, grigio e rosso ha la grana a puntini di phyphox e non un taglio netto.

**Soglie in funzione dello scroll `p`:**

```
centro    c = 1.0 − p                     // da 1 (tutto blu) a 0 (tutto rosso)
larghezza w = 0.06 + 0.55 · sin(π · p)    // intermezzo stretto agli estremi, ampio a metà
uLow  = clamp(c − w/2, 0, 1)
uHigh = clamp(c + w/2, 0, 1)
```

**Correzione locale.** Quando la camera è vicina a una foto (distanza lungo la curva < soglia), sposta leggermente `c` verso il bilanciamento misurato di quella foto: `c += 0.15 · (shadow − light)`. In questo modo le gallerie restano più blu anche vicino alla vetta.

**Secondo gesto, opzionale.** La posizione verticale del mouse (o un trascinamento verticale su touch) **allarga o stringe** l'intermezzo, moltiplicando `w` tra 0.5× e 1.6×. È lo spettatore che decide quanto spazio dare alle sfumature.

Applica la stessa logica, in versione semplificata, anche all'ambiente: il colore di sfondo e della nebbia è `mix(uBlue, grigio, uRed)` secondo quanta parte della scala 0–1 cade sotto `uLow`, nell'intermezzo e sopra `uHigh`.

## Estetica: "laboratorio di visione artificiale"

Il sito deve sembrare **lo schermo di uno strumento scientifico che sta guardando la montagna**, non un sito di viaggio. Riferimenti visivi: overlay di debug di computer vision (bounding box, ID, coordinate), mappe a tasselli di dati, tavole scientifiche che affiancano immagine in grigio e immagine in falsi colori, reti di nodi collegati da linee sottili. Grezzo e preciso insieme, niente effetti "patinati".

**Colore**
- Il blu non è solo un colore della soglia: è **il campo di partenza**. A `p = 0` lo sfondo è un **blu elettrico pieno e piatto** (circa `#2348ff`), come uno schermo di laboratorio.
- Sopra il blu, tutto ciò che è dato o struttura è chiaro: linee bianche sottili, tasselli azzurro-trasparenti, testi bianchi.
- Il rosso (circa `#ff3a24`) arriva salendo e domina alla vetta. Il grigio resta sempre neutro, senza tinta.
- Nei tratti di galleria il fondo diventa **nero `#000`**, con i pixel blu e rossi che emergono come punti, simile a una mappa di dati su nero.
- Un unico colore d'accento per l'interfaccia: **magenta `#ff3df0`**, usato solo per le linee di collegamento e per il cursore. Niente altri colori: niente verdi, gialli o arcobaleni da termocamera.

**Tasselli**
- Il piano di base è una griglia di quadrati. I quadrati vicini alla camera e alle foto si "accendono" (riempimento bianco trasparente al 15–25% con bordo sottile), quelli lontani restano spenti. L'effetto è una mappa che si rivela per blocchi mentre si sale.
- Ogni tassello acceso prende il colore della soglia in base alla quota del punto di traccia che contiene: blu sotto `uLow`, grigio nell'intermezzo, rosso sopra `uHigh`.

**Le foto come "rilevamenti"**
- Ogni foto ha una cornice sottile bianca (1 px) e, in alto a sinistra, un'etichetta monospace minuscola nello stile di un sistema di tracciamento: `ID 13 · 15:20:07 · 2.429 m · L 0.079`.
- Sulle zone rosse e blu di ogni foto disegna dei **bounding box**: rettangoli sottili attorno alle macchie più grandi (calcolati una volta al caricamento, per esempio con un'analisi delle componenti connesse su una versione ridotta a 64 px della maschera). Box blu per l'ombra, box rossi per la luce.
- Le foto sono collegate tra loro, in ordine cronologico, da **linee magenta sottili**, come la rete di nodi di un grafo. La foto in focus emette linee verso le 3–4 foto con il bilanciamento luce/ombra più simile, in qualunque punto del percorso si trovino.

**HUD (testi sovrapposti)**
- In alto a sinistra, in monospace, i valori grezzi come in un overlay di debug: `POS X 0.412 Y 0.268`, `P 0.537`, `SOGLIA 0.31 / 0.74`, `TAPPA 14/30`.
- Tipografia: **tutto in monospace**. *IBM Plex Mono* per i testi piccoli e i dati, *VT323* (font da terminale) per i numeri grandi dell'HUD e per la quota. Niente font display, niente serif.
- I testi dell'HUD possono "tremolare" leggermente (cifre che si aggiornano in continuo), ma senza animazioni decorative.

**Grana**
- Dithering Bayer anche sullo sfondo e sulle transizioni di colore, non solo nelle foto: la grana a puntini è la firma visiva del sito.
- Niente gradienti morbidi, niente ombre, niente bordi arrotondati, niente glassmorphism.

## Interfaccia (sovrapposta al canvas, HTML/CSS)

- **In alto a sinistra:** "PEAK PROMPT" e, sotto, "Passo Falzarego → Lagazuoi · 2 ottobre 2026".
- **In alto a destra:** la quota corrente in grande (interpolata lungo la traccia, formato italiano: `2.428 m`) e l'ora corrispondente.
- **In basso:** la **barra della soglia**, cioè una scala orizzontale 0–1 con la zona blu (0 → uLow), la zona grigia (uLow → uHigh) e la zona rossa (uHigh → 1), aggiornata in tempo reale, con i valori numerici di `uLow` e `uHigh` sotto.
- **Accanto alla barra:** un mini profilo altimetrico 2D (SVG) con un punto per ogni foto e un cursore sulla posizione corrente; cliccando su un punto si scorre fino a quella tappa.
- **Foto in focus** (quella più vicina alla camera): un'etichetta piccola con numero, ora (con "stimata" se `timeEstimated`), quota, luma e le tre percentuali luce / ombra / neutro.
- **Menu discreto:** Percorso · Metodo · Archivio · Dati · Progetto. Per ora solo la voce Percorso è attiva.
- **Tipografia e palette:** vedi la sezione "Estetica".

## Sobrietà energetica (come Solar Protocol)

- Renderizza solo quando qualcosa cambia (scroll, mouse, resize, transizioni in corso). Altrimenti ferma il loop.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
- Carica le texture in modo progressivo: prima le 5 foto più vicine, poi le altre.
- Ridimensiona le texture a una larghezza massima di 1024 px.

## Accessibilità e casi limite

- Con `prefers-reduced-motion`, sostituisci il movimento della camera con passaggi a scatti tra le tappe.
- Navigazione da tastiera: frecce su e giù (o Pagina su e Pagina giù) per passare alla tappa successiva o precedente.
- Se WebGL non è disponibile, mostra un fallback 2D: il mini profilo altimetrico più l'immagine della tappa corrente con le soglie applicate su canvas 2D.
- Funziona su telefono (scroll touch, interfaccia che si impila, testo leggibile a 390 px di larghezza).

## Struttura file attesa

```
index.html
src/main.js          // setup, loop, scroll
src/scene.js         // curva, camera, ambiente
src/threshold.js     // calcolo uLow/uHigh da p e correzione locale
src/photos.js        // caricamento e piani delle immagini
src/shaders/photo.vert / photo.frag
src/ui.js            // overlay, HUD, barra soglia, mini profilo
src/boxes.js         // bounding box delle zone rosse e blu
src/style.css
assets/…             // già esistente, non modificare
```

## Come procedere

1. Prima di scrivere codice, leggi `assets/data/percorso.json` e riassumimi in 5 righe i dati che userai.
2. Costruisci in quest'ordine, fermandoti dopo ogni passo perché io possa controllare:
   1. percorso 3D + camera che segue lo scroll;
   2. immagini nello spazio;
   3. shader della soglia;
   4. estetica (tasselli, bounding box, linee, HUD);
   5. interfaccia;
   6. ottimizzazioni e fallback.
3. Non modificare i file in `assets/`.
4. Commenta il codice in italiano, in modo breve, spiegando soprattutto la logica della soglia.
