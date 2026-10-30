import type { GameState } from '../sim/state.ts'
import { eur, stamp } from './format.ts'

export function LogPanel({ s }: { s: GameState }) {
  const st = s.stats
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Tagebuch</h2>
      </div>
      <div className="stats">
        <span>Einnahmen {eur(st.revenue)}</span>
        <span>Ausgaben {eur(st.spent)}</span>
        <span>{st.plantsHarvested} Pflanzen geerntet</span>
        <span>{st.fishSold} Fische verkauft</span>
        <span>{st.fishDied} Fische gestorben</span>
      </div>
      <ul className="log">
        {[...s.log].reverse().map((l, i) => (
          <li key={i} className={l.kind}>
            <time>{stamp(l.t)}</time>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HelpPanel({ onReset }: { onReset: () => void }) {
  return (
    <div className="panel help">
      <h2>So funktioniert Aquaponik</h2>
      <p>
        Fische und Pflanzen teilen sich einen Wasserkreislauf. Die Pumpe bringt das Fischwasser durch den Biofilter in die Pflanzbeete, von dort fließt es gereinigt zurück.
      </p>
      <ol>
        <li>
          <b>Fische</b> fressen und scheiden <b>Ammonium</b> aus. Futterreste und tote Fische verrotten ebenfalls zu Ammonium.
        </li>
        <li>
          <b>Bakterien</b> im Biofilter und an den Wurzeln machen daraus erst <b>Nitrit</b>, dann <b>Nitrat</b>. Beides passiert nur mit Sauerstoff.
        </li>
        <li>
          <b>Pflanzen</b> nehmen Nitrat als Dünger auf und reinigen so das Wasser für die Fische.
        </li>
      </ol>
      <h3>Einfahren</h3>
      <p>
        Eine neue Anlage hat kaum Bakterien. In den ersten Wochen steigt erst Ammonium, dann Nitrit an, bevor beides verschwindet und Nitrat
        auftaucht. Erst dann ist die Anlage „eingefahren“. Bei Wärme geht das schneller, Bakterienstarter hilft zusätzlich.
      </p>
      <ul>
        <li>
          <b>Mit Fischen:</b> wenige Fische, wenig füttern, oft messen, bei hohen Werten Wasser wechseln.
        </li>
        <li>
          <b>Ohne Fische:</b> Ammoniumchlorid zugeben, bis Ammonium und Nitrit innerhalb eines Tages auf null fallen.
        </li>
      </ul>
      <h3>Worauf es ankommt</h3>
      <ul>
        <li>
          <b>Freies Ammoniak</b> ist der giftige Teil des Ammoniums. Je höher pH und Temperatur, desto mehr davon.
        </li>
        <li>
          <b>pH-Wert:</b> Die Bakterien verbrauchen die Karbonathärte. Ist sie weg, stürzt der pH ab. Dann Puffer zugeben.
        </li>
        <li>
          <b>Eisen:</b> Fischfutter liefert zu wenig. Ohne Eisen werden die Blätter gelb. Bei pH über 7,5 können Pflanzen Eisen schlecht aufnehmen.
        </li>
        <li>
          <b>Sauerstoff:</b> Fische, Bakterien und verrottende Reste verbrauchen ihn. Warmes Wasser hält weniger davon.
        </li>
        <li>
          <b>Jahreszeiten:</b> Das Gewächshaus ist im Winter kalt. Dann wachsen Fische, Pflanzen und Bakterien langsamer.
        </li>
      </ul>
      <h3>Profi-Anlage</h3>
      <ul>
        <li>
          <b>Feststofffilter:</b> Kot und Futterreste müssen raus, bevor sie faulen. Erst Radialabscheider (Schlamm ab und zu ablassen), später Trommelfilter.
        </li>
        <li>
          <b>MBBR-Biofilter:</b> Viel mehr Platz für Bakterien. Ohne ihn kommen die Bakterien bei vielen Fischen nicht hinterher.
        </li>
        <li>
          <b>Sauerstoff:</b> Luftpumpe, Rieselturm und für hohe Besatzdichte ein Sauerstoffkonzentrator.
        </li>
        <li>
          <b>Stromausfall:</b> Ohne Luft ersticken dichte Bestände in wenigen Stunden. Eine Akku-Luftpumpe oder ein Notstromaggregat sichert ab.
        </li>
        <li>
          <b>Krankheiten:</b> Neue Fische bringen manchmal Weißpünktchen mit. Salz (2–3 g/L) heilt, ein UV-Klärer beugt vor. Stress macht anfällig.
        </li>
        <li>
          <b>Schädlinge:</b> Blattläuse nur mit Nützlingen bekämpfen. Spritzmittel würden die Fische töten. Ein Insektennetz beugt vor.
        </li>
        <li>
          <b>Klima:</b> Heizung im Winter, Lüftung und Schattierung im Sommer, LED-Licht für kurze Tage. Kostet Energie, bringt Ernte.
        </li>
        <li>
          <b>Mineralisierer und Dosierstation:</b> Machen aus Fischschlamm Dünger und halten Puffer und Eisen automatisch im Lot.
        </li>
      </ul>
      <h3>Ziel</h3>
      <p>Verkaufe Ernte und Fische, baue die Anlage aus und halte alles im Gleichgewicht.</p>
      <p className="muted small">
        <b>1:1 (Echtzeit):</b> Uhrzeit und Datum laufen wie in echt weiter, auch wenn die App geschlossen ist. Beim Öffnen wird die verpasste Zeit
        nachgeholt (höchstens 14 Tage). In Echtzeit hält das Spiel nicht von selbst an, schau also regelmäßig nach deinen Fischen.
      </p>
      <p className="muted small">
        In den schnellen Stufen hält das Spiel bei schlimmen Ereignissen automatisch an. Dein Spielstand wird auf diesem Gerät gespeichert.
      </p>
      <button
        className="danger"
        onClick={() => {
          if (confirm('Wirklich neu anfangen? Der aktuelle Spielstand geht verloren.')) onReset()
        }}
      >
        Neues Spiel
      </button>
    </div>
  )
}
