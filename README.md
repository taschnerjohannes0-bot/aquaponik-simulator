# Aquaponik-Simulator

Ein Browser-Spiel, in dem du eine Aquaponik-Anlage betreibst: Fische, Bakterien und Pflanzen teilen sich einen Wasserkreislauf.

Die Simulation rechnet mit echten Zusammenhängen:

- Stickstoffkreislauf: Futter → Ammonium → Nitrit → Nitrat, mit zwei Bakteriengruppen, die sich erst ansiedeln müssen (Einfahren)
- Giftiges freies Ammoniak abhängig von pH und Temperatur
- pH aus Karbonathärte und CO2; Nitrifikation verbraucht den Puffer
- Sauerstoffsättigung nach Temperatur, Verbrauch durch Fische, Bakterien und Verrottung
- Eisenmangel bei hohem pH, Pflanzenwachstum nach dem Minimumgesetz
- Jahreszeiten, Tag und Nacht im Gewächshaus, Strom- und Futterkosten

## Entwickeln

```sh
npm install
npm run dev     # lokal starten
npm run build   # fertige Version in dist/
npm run sim     # Simulation ohne Oberfläche durchrechnen
```

Bei jedem Push auf `main` wird das Spiel automatisch auf GitHub Pages veröffentlicht.
