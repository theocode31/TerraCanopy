import React, { useRef, useState } from 'react';
import { sommePeriode, formaterHa, formaterPart } from './donnees.js';
import { CLASSES, echellePeriode, seuilsPour, FACTEUR_MIN, FACTEUR_MAX } from './couleurs.js';

// ce que montrent les couleurs du globe ; le choix se fait au-dessus de la legende
const MESURES = [
  { cle: 'perte', nom: 'perte' },
  { cle: 'part', nom: 'part perdue' },
  { cle: 'foret', nom: 'forêt 2000' },
];

// releve de position en haut a droite : 10,60° S · 62,80° O
function coordonnee(v, plus, moins) {
  return `${Math.abs(v).toFixed(2).replace('.', ',')}° ${v >= 0 ? plus : moins}`;
}
const DEPOT = 'https://github.com/theocode31/TerraCanopy';
const ANNEES_REPERES = [2001, 2005, 2010, 2015, 2020, 2025];

// frise des annees : la perte mondiale par an, et on choisit la periode en cliquant-glissant dessus.
// En mode cumul, la periode part toujours de 2001 et un clic choisit l'annee de fin.
function Frise({ annees, pertes, debut, fin, setPeriode, cumul, choisirCumul, lecture, lancerLecture }) {
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
          <span className="frise-periode">{debut === fin ? annees[debut] : `${annees[debut]} – ${annees[fin]}`}</span>
          <span className="frise-modes">
            <button aria-pressed={!cumul} onClick={() => choisirCumul(false)}>période choisie</button>
            <span className="sep"> · </span>
            <button aria-pressed={cumul} onClick={() => choisirCumul(true)}>cumul depuis {annees[0]}</button>
          </span>
          <button className="puce frise-lecture" aria-pressed={lecture} onClick={lancerLecture}>{lecture ? '❚❚ pause' : '▶ voir la perte s’accumuler'}</button>
        </div>
        <span className="frise-info">
          {k !== null
            ? `${annees[k]} : ${formaterHa(pertes[k])} perdus dans le monde`
            : cumul
              ? `Cliquer sur une année pour voir tout ce qui a été perdu depuis ${annees[0]}`
              : 'Cliquer-glisser sur les années pour choisir la période, double-clic pour tout reprendre'}
        </span>
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

function Legende({ mesure, setMesure, annees, debut, fin, cumul }) {
  const { couleurs } = CLASSES[mesure];
  const echelle = cumul ? 1 : echellePeriode(mesure, fin - debut + 1, annees.length);
  const seuils = seuilsPour(mesure, echelle);
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
        {couleurs.map((c) => <span key={c} style={{ background: c }} />)}
      </div>
      <div className="legende-bornes">
        {seuils.map((s, i) => (
          <span key={i} style={{ left: `${((i + 1) / couleurs.length) * 100}%` }}>{String(s).replace('.', ',')}</span>
        ))}
        <span className="unite">%</span>
      </div>
      <p>
        {texte}.
        {!cumul && echelle < 1 && ' Les seuils suivent la durée de la période.'}
      </p>
    </div>
  );
}

export default function Panneau({
  donnees, erreur, mesure, setMesure, periode, setPeriode, cumul, choisirCumul, lecture, lancerLecture, resolution,
  position, relief, basculerRelief, facteur, setFacteur, revenirAuGlobe, chargement, allerVers,
}) {
  const [ouvert, setOuvert] = useState(null); // 'pays', 'apropos' ou null
  const [debut, fin] = periode;

  if (erreur) return <div className="habillage"><p className="erreur">{erreur}</p></div>;
  if (!donnees) return <div className="habillage"><p className="attente">Chargement…</p></div>;

  const { resume } = donnees;
  const annees = resume.annees;
  const perteMonde = sommePeriode(resume.pertes, debut, fin);
  const classement = resume.pays
    .map((p) => ({ ...p, perte: sommePeriode(p.pertes, debut, fin) }))
    .sort((a, b) => b.perte - a.perte)
    .slice(0, 10);
  const quand = debut === fin ? `En ${annees[debut]}` : `Entre ${annees[debut]} et ${annees[fin]}`;
  const basculer = (quoi) => setOuvert(ouvert === quoi ? null : quoi);

  return (
    <div className="habillage">
      <header className="titre">
        <h1>Terra Canopy</h1>
        <p className="phrase">
          {quand}, <em>{formaterHa(perteMonde)}</em> de couvert arboré ont disparu, soit{' '}
          <em>{formaterPart((100 * perteMonde) / resume.foret_2000)}</em> de la forêt de 2000.
        </p>
      </header>

      <nav className="actions">
        <div className="actions-boutons">
          {chargement && <span className="charge">chargement</span>}
          <button className="puce" aria-pressed={relief} onClick={basculerRelief}>{relief ? 'vue à plat' : 'relief 3D'}</button>
          <button className="puce" onClick={revenirAuGlobe}>tout le globe</button>
        </div>
        <div className="console">
        {position && (
          <p className="releve">
            <b>{coordonnee(position.latitude, 'N', 'S')}</b> · <b>{coordonnee(((position.longitude + 540) % 360) - 180, 'E', 'O')}</b>
            {' '}· zoom <b>{position.zoom.toFixed(1).replace('.', ',')}</b> · H3 <b>r{resolution}</b>
          </p>
        )}
        {relief && (
          <div className="options-relief">
            <label className="hauteur">
              hauteur ×{facteur}
              <input
                type="range"
                min={FACTEUR_MIN}
                max={FACTEUR_MAX}
                step={1}
                value={facteur}
                onChange={(e) => setFacteur(Number(e.target.value))}
              />
            </label>
            <p className="astuce">clic droit et glisser pour tourner autour</p>
          </div>
        )}
        </div>
      </nav>

      <div className="bas">
        <div className="bas-ligne">
          <Legende mesure={mesure} setMesure={setMesure} annees={annees} debut={debut} fin={fin} cumul={cumul} />
          <div className="liens">
            <button aria-expanded={ouvert === 'pays'} onClick={() => basculer('pays')}>Les dix pays qui ont le plus perdu</button>
            <button aria-expanded={ouvert === 'apropos'} onClick={() => basculer('apropos')}>À propos des données</button>
            <a className="credit" href={DEPOT} target="_blank" rel="noreferrer">Un projet de Théo · le code sur GitHub</a>
          </div>
        </div>
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
        />
      </div>

      {ouvert === 'pays' && (
        <section className="volet">
          <h2>{quand}, les pays qui ont perdu le plus de couvert arboré</h2>
          <ol className="classement">
            {classement.map((p) => (
              <li key={p.code}>
                <button onClick={() => { allerVers(p.centre); setOuvert(null); }} title={`Aller vers : ${p.nom}`}>
                  <span className="nom">{p.nom}</span>
                  <span className="valeur">{formaterHa(p.perte)}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="note">Cliquer sur un pays pour y aller.</p>
        </section>
      )}

      {ouvert === 'apropos' && (
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
            Pays : <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>.
          </p>
          <p>
            Projet réalisé par Théo (theocode31). Le code, le calcul et le journal du projet sont sur{' '}
            <a href={DEPOT} target="_blank" rel="noreferrer">github.com/theocode31/TerraCanopy</a>.
          </p>
        </section>
      )}
    </div>
  );
}
