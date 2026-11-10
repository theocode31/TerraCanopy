import React, { useRef, useState } from 'react';
import { sommePeriode, formaterHa, formaterPart } from './donnees.js';
import { CLASSES, echellePeriode, seuilsPour, FACTEUR_MIN, FACTEUR_MAX } from './couleurs.js';

const MESURES = [
  { cle: 'perte', nom: 'Perte' },
  { cle: 'part', nom: 'Part perdue' },
  { cle: 'foret', nom: 'Forêt 2000' },
];

const DEPOT = 'https://github.com/theocode31/TerraCanopy';
const ANNEES_REPERES = [2001, 2005, 2010, 2015, 2020, 2025];

const nombre = (x) => String(x).replace('.', ',');
const libellePeriode = (annees, debut, fin) => (debut === fin ? `${annees[debut]}` : `${annees[debut]} – ${annees[fin]}`);

export function Bandeau({ donnees, erreur, periode, relief, basculerRelief, revenirAuGlobe, chargement }) {
  const [debut, fin] = periode;
  let phrase;
  if (erreur) phrase = <p className="phrase erreur">{erreur}</p>;
  else if (!donnees) phrase = <p className="phrase attente">Chargement…</p>;
  else {
    const { resume } = donnees;
    const annees = resume.annees;
    const perteMonde = sommePeriode(resume.pertes, debut, fin);
    const quand = debut === fin ? `En ${annees[debut]}` : `Entre ${annees[debut]} et ${annees[fin]}`;
    phrase = (
      <p className="phrase">
        {quand}, <em>{formaterHa(perteMonde)}</em> de couvert arboré ont disparu, soit{' '}
        <em>{formaterPart((100 * perteMonde) / resume.foret_2000)}</em> de la forêt de 2000.
      </p>
    );
  }
  return (
    <header className="bandeau">
      <div className="bandeau-texte">
        <h1>Terra Canopy</h1>
        {phrase}
      </div>
      {donnees && (
        <nav className="actions">
          {chargement && <span className="charge">Chargement…</span>}
          <button className="puce" aria-pressed={relief} onClick={basculerRelief}>{relief ? 'Vue à plat' : 'Relief 3D'}</button>
          <button className="puce" onClick={revenirAuGlobe}>Tout le globe</button>
        </nav>
      )}
    </header>
  );
}

function Legende({ mesure, setMesure, annees, debut, fin, cumul }) {
  const { couleurs } = CLASSES[mesure];
  const echelle = cumul ? 1 : echellePeriode(mesure, fin - debut + 1, annees.length);
  const seuils = seuilsPour(mesure, echelle);
  const sansPremiere = couleurs[0] === null;
  const teintes = sansPremiere ? couleurs.slice(1) : couleurs;
  const quand = debut === fin ? `en ${annees[debut]}` : `de ${annees[debut]} à ${annees[fin]}`;
  const texte = {
    perte: `Surface perdue ${quand}, en % de la surface de l’hexagone`,
    part: `Perte ${quand}, en % de la forêt de 2000`,
    foret: 'Couvert arboré de plus de 30 % en 2000, en % de la surface',
  }[mesure];
  return (
    <div className="legende">
      <div className="couches" role="group" aria-label="Ce que montrent les couleurs">
        {MESURES.map((m) => (
          <button key={m.cle} aria-pressed={mesure === m.cle} onClick={() => setMesure(m.cle)}>{m.nom}</button>
        ))}
      </div>
      <div className="legende-barre">
        {teintes.map((c) => <span key={c} style={{ background: c }} />)}
      </div>
      <div className="legende-bornes">
        {seuils.map((s, i) => {
          const position = sansPremiere ? i / teintes.length : (i + 1) / teintes.length;
          return (
            <span key={i} style={{ left: `${position * 100}%`, transform: position === 0 ? 'none' : undefined }}>{nombre(s)}</span>
          );
        })}
        <span className="unite">%</span>
      </div>
      <p>
        {texte}.
        {sansPremiere && ` En dessous de ${nombre(seuils[0])} %, l’hexagone n’est pas dessiné.`}
        {!cumul && echelle < 1 && ' Les seuils suivent la durée de la période.'}
      </p>
    </div>
  );
}

export function Habillage({ donnees, mesure, setMesure, periode, cumul, relief, facteur, setFacteur }) {
  const [apropos, setApropos] = useState(false);
  if (!donnees) return null;
  const { resume } = donnees;
  const [debut, fin] = periode;

  return (
    <div className="habillage">
      {relief && (
        <div className="carte-relief">
          <label className="hauteur">
            Hauteur ×{facteur}
            <input
              type="range"
              min={FACTEUR_MIN}
              max={FACTEUR_MAX}
              step={1}
              value={facteur}
              onChange={(e) => setFacteur(Number(e.target.value))}
            />
          </label>
          <p className="astuce">Clic droit et glisser pour tourner autour</p>
        </div>
      )}

      <div className="coin">
        {apropos && (
          <section className="volet">
            <h2>À savoir avant de lire la carte</h2>
            <p>
              Perte de couvert arboré ne veut pas dire déforestation : les coupes qui repoussent, les incendies et
              les tempêtes comptent aussi. Les données ne disent pas pourquoi les arbres ont disparu.
            </p>
            <p>
              Seuls les pixels de plus de 30 % de couvert en 2000 sont comptés. Les années ne sont pas parfaitement
              comparables : les satellites ont changé (Landsat 8 à partir de 2013) et il y a plus d’images qu’au début
              des années 2000, donc une partie de la hausse peut venir d’une meilleure détection.
            </p>
            <p>
              Données : <a href="https://glad.earthengine.app/view/global-forest-change" target="_blank" rel="noreferrer">Hansen et al. (2013), Science 342</a>,
              version {resume.version}, {resume.nb_tuiles} tuiles de pixels de 30 m regroupées en hexagones H3.
              Pays et relief du fond de carte : <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>.
            </p>
            <p>
              Projet réalisé par Théo (theocode31). Le code, le calcul et le journal du projet sont sur{' '}
              <a href={DEPOT} target="_blank" rel="noreferrer">github.com/theocode31/TerraCanopy</a>.
            </p>
          </section>
        )}
        <div className="carte-legende">
          <Legende mesure={mesure} setMesure={setMesure} annees={resume.annees} debut={debut} fin={fin} cumul={cumul} />
          <div className="liens">
            <button aria-expanded={apropos} onClick={() => setApropos(!apropos)}>À propos des données</button>
            <span className="credit">Projet Théo Lafon</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Frise({ annees, pertes, debut, fin, setPeriode, cumul, choisirCumul, lecture, lancerLecture, replier }) {
  const [survol, setSurvol] = useState(null);
  const depart = useRef(null);
  const zone = useRef(null);
  const n = pertes.length;
  const max = Math.max(...pertes);

  const indice = (e) => {
    const r = zone.current.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };

  function clavier(e) {
    const decaler = (d) => {
      if (cumul) {
        if (fin + d >= 0 && fin + d <= n - 1) setPeriode([0, fin + d]);
        return;
      }
      if (debut + d < 0 || fin + d > n - 1) return;
      setPeriode([debut + d, fin + d]);
    };
    if (e.key === 'ArrowLeft') decaler(-1);
    else if (e.key === 'ArrowRight') decaler(1);
    else if (e.key === 'Home' || e.key === 'Escape') setPeriode([0, n - 1]);
    else return;
    e.preventDefault();
  }

  const k = survol;
  return (
    <div className="frise">
      <div className="frise-tete">
        <div className="frise-gauche">
          <span className="frise-periode">{libellePeriode(annees, debut, fin)}</span>
          <span className="frise-modes">
            <button aria-pressed={!cumul} onClick={() => choisirCumul(false)}>Période choisie</button>
            <span className="sep"> · </span>
            <button aria-pressed={cumul} onClick={() => choisirCumul(true)}>Cumul depuis {annees[0]}</button>
          </span>
          <button className="puce frise-lecture" aria-pressed={lecture} onClick={lancerLecture}>{lecture ? '❚❚ Pause' : '▶ Voir la perte s’accumuler'}</button>
        </div>
        <div className="frise-droite">
          <span className="frise-info">
            {k !== null
              ? `${annees[k]} : ${formaterHa(pertes[k])} perdus dans le monde`
              : cumul
                ? `Cliquer sur une année pour voir tout ce qui a été perdu depuis ${annees[0]}`
                : 'Cliquer-glisser sur les années pour choisir la période, double-clic pour tout reprendre'}
          </span>
          <button className="replier" aria-expanded={true} onClick={replier}>Replier ▾</button>
        </div>
      </div>
      <div
        className="frise-barres"
        ref={zone}
        tabIndex={0}
        role="group"
        aria-label={`Période affichée : ${annees[debut]} à ${annees[fin]}. Flèches gauche et droite pour la décaler, Origine pour tout reprendre.`}
        onPointerDown={(e) => {
          zone.current.setPointerCapture(e.pointerId);
          depart.current = cumul ? 0 : indice(e);
          setPeriode(cumul ? [0, indice(e)] : [depart.current, depart.current]);
        }}
        onPointerMove={(e) => {
          const i = indice(e);
          setSurvol(i);
          if (depart.current !== null) setPeriode([Math.min(depart.current, i), Math.max(depart.current, i)]);
        }}
        onPointerUp={() => (depart.current = null)}
        onPointerLeave={() => setSurvol(null)}
        onDoubleClick={() => setPeriode([0, n - 1])}
        onKeyDown={clavier}
      >
        {pertes.map((p, i) => (
          <span key={i} className={i >= debut && i <= fin ? 'dans' : ''}>
            <i style={{ height: `${Math.max(2, (100 * p) / max)}%`, opacity: k === null || k === i ? 1 : 0.7 }} />
          </span>
        ))}
      </div>
      <div className="frise-annees" aria-hidden="true">
        {ANNEES_REPERES.filter((a) => annees.includes(a)).map((a) => (
          <span key={a} style={{ left: `${((annees.indexOf(a) + 0.5) / n) * 100}%` }}>{a}</span>
        ))}
      </div>
    </div>
  );
}

export function Pied({ donnees, periode, setPeriode, cumul, choisirCumul, lecture, lancerLecture, replie, setReplie }) {
  if (!donnees) return null;
  const { resume } = donnees;
  const annees = resume.annees;
  const [debut, fin] = periode;

  if (replie) {
    return (
      <footer className="pied replie">
        <span className="frise-periode">{libellePeriode(annees, debut, fin)}</span>
        <span className="pied-mode">{cumul ? `Cumul depuis ${annees[0]}` : 'Période choisie'}</span>
        {lecture && <button className="puce" aria-pressed={true} onClick={lancerLecture}>❚❚ Pause</button>}
        <button className="replier" aria-expanded={false} onClick={() => setReplie(false)}>Afficher les années ▴</button>
      </footer>
    );
  }
  return (
    <footer className="pied">
      <Frise
        annees={annees}
        pertes={resume.pertes}
        debut={debut}
        fin={fin}
        setPeriode={setPeriode}
        cumul={cumul}
        choisirCumul={choisirCumul}
        lecture={lecture}
        lancerLecture={lancerLecture}
        replier={() => setReplie(true)}
      />
    </footer>
  );
}
