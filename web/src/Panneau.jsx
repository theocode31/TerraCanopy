import React, { useState } from 'react';
import { sommePeriode, formaterHa, formaterPart } from './donnees.js';
import { RAMPES } from './couleurs.js';

const MESURES = [
  { cle: 'perte', nom: 'Perte', aide: 'Surface de couvert arboré perdue sur la période' },
  { cle: 'part', nom: 'Part perdue', aide: 'Perte de la période divisée par le couvert de 2000' },
  { cle: 'foret', nom: 'Forêt 2000', aide: 'Couvert arboré de plus de 30 % en 2000' },
];

function GraphiqueAnnuel({ annees, pertes, debut, fin }) {
  const [survol, setSurvol] = useState(null);
  const max = Math.max(...pertes);
  const largeur = 300;
  const hauteur = 90;
  const pas = largeur / pertes.length;
  return (
    <div className="graphique">
      <svg viewBox={`0 0 ${largeur} ${hauteur + 16}`} role="img" aria-label="Perte mondiale de couvert arboré par an">
        {[0.5, 1].map((f) => (
          <line key={f} x1="0" x2={largeur} y1={hauteur - f * hauteur} y2={hauteur - f * hauteur} className="grille" />
        ))}
        {pertes.map((p, k) => {
          const h = Math.max(1, (p / max) * hauteur);
          const dans = k >= debut && k <= fin;
          return (
            <g key={k} onMouseEnter={() => setSurvol(k)} onMouseLeave={() => setSurvol(null)}>
              <rect x={k * pas} y="0" width={pas} height={hauteur} fill="transparent" />
              <rect
                x={k * pas + 1}
                y={hauteur - h}
                width={pas - 2}
                height={h}
                rx="2"
                className={dans ? 'barre barre-active' : 'barre'}
                opacity={survol === null || survol === k ? 1 : 0.55}
              />
            </g>
          );
        })}
        <text x="0" y={hauteur + 13} className="axe">{annees[0]}</text>
        <text x={largeur} y={hauteur + 13} textAnchor="end" className="axe">{annees[annees.length - 1]}</text>
      </svg>
      <div className="graphique-info" aria-live="polite">
        {survol !== null
          ? `${annees[survol]} : ${formaterHa(pertes[survol])}`
          : `Maximum : ${formaterHa(max)} en ${annees[pertes.indexOf(max)]}`}
      </div>
    </div>
  );
}

function Legende({ mesure, seuils }) {
  if (!seuils || seuils.length === 0) return null;
  const format = mesure === 'part' ? formaterPart : formaterHa;
  const bornes = ['> 0', ...seuils.map(format)];
  return (
    <div className="legende">
      <div className="legende-barre">
        {RAMPES[mesure].map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="legende-bornes">
        {bornes.map((b, k) => (
          <span key={k}>{b}</span>
        ))}
      </div>
      <div className="legende-note">Seuils par septiles : chaque couleur regroupe environ un septième des hexagones.</div>
    </div>
  );
}

export default function Panneau({ donnees, erreur, mesure, setMesure, periode, setPeriode, relief, setRelief, seuils, resolution, allerVers }) {
  const [ouvert, setOuvert] = useState(true);
  const [debut, fin] = periode;

  if (erreur) return <aside className="panneau"><p className="erreur">{erreur}</p></aside>;
  if (!donnees) return <aside className="panneau"><p className="chargement">Chargement des hexagones…</p></aside>;

  const { resume } = donnees;
  const annees = resume.annees;
  const perteMonde = sommePeriode(resume.pertes, debut, fin);
  const classement = resume.pays
    .map((p) => ({ ...p, perte: sommePeriode(p.pertes, debut, fin) }))
    .sort((a, b) => b.perte - a.perte)
    .slice(0, 10);
  const maxPays = classement[0]?.perte || 1;

  return (
    <aside className={ouvert ? 'panneau' : 'panneau ferme'}>
      <header>
        <button className="replier" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert}>
          {ouvert ? 'Réduire' : 'Ouvrir'}
        </button>
        <h1>Terra Canopy</h1>
        <p className="sous-titre">Où le couvert arboré a disparu dans le monde, {annees[0]}–{annees[annees.length - 1]}</p>
      </header>

      <div className="contenu">
        <section>
          <div className="segments" role="group" aria-label="Mesure affichée">
            {MESURES.map((m) => (
              <button key={m.cle} aria-pressed={mesure === m.cle} title={m.aide} onClick={() => setMesure(m.cle)}>
                {m.nom}
              </button>
            ))}
          </div>
          <p className="aide">{MESURES.find((m) => m.cle === mesure).aide}.</p>
        </section>

        <section>
          <h2>Période : {annees[debut]}–{annees[fin]}</h2>
          <label className="curseur">
            <span>Début</span>
            <input type="range" min="0" max={annees.length - 1} value={debut}
              onChange={(e) => setPeriode([Math.min(+e.target.value, fin), fin])} />
          </label>
          <label className="curseur">
            <span>Fin</span>
            <input type="range" min="0" max={annees.length - 1} value={fin}
              onChange={(e) => setPeriode([debut, Math.max(+e.target.value, debut)])} />
          </label>
        </section>

        <section className="chiffre-cle">
          <div className="grand-nombre">{formaterHa(perteMonde)}</div>
          <div className="aide">
            de couvert arboré perdus dans le monde, soit {formaterPart((100 * perteMonde) / resume.foret_2000)} du couvert de 2000
            ({formaterHa(resume.foret_2000)}).
          </div>
          <GraphiqueAnnuel annees={annees} pertes={resume.pertes} debut={debut} fin={fin} />
        </section>

        <section>
          <h2>Pays qui ont le plus perdu</h2>
          <ol className="classement">
            {classement.map((p) => (
              <li key={p.code}>
                <button onClick={() => allerVers(p.centre)} title={`Aller à ${p.nom}`}>
                  <span className="nom">{p.nom}</span>
                  <span className="valeur">{formaterHa(p.perte)}</span>
                  <span className="jauge"><span style={{ width: `${(100 * p.perte) / maxPays}%` }} /></span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Légende</h2>
          <Legende mesure={mesure} seuils={seuils} />
          <label className="case">
            <input type="checkbox" checked={relief} onChange={(e) => setRelief(e.target.checked)} />
            Relief : hauteur proportionnelle à la valeur (clic droit pour pivoter)
          </label>
          <p className="aide">Hexagones H3 de résolution {resolution} ({resolution === 3 ? 'environ 12 400' : 'environ 1 770'} km²), zoomer pour plus de détail.</p>
        </section>

        <section className="notes">
          <h2>À lire avant d'interpréter</h2>
          <p>
            La perte de couvert arboré n'est pas toujours de la déforestation : elle compte aussi les coupes
            forestières qui repoussent, les incendies et les tempêtes. Le jeu de données ne dit pas pourquoi
            les arbres ont disparu.
          </p>
          <p>
            Seuls les pixels de plus de 30 % de couvert en 2000 sont comptés. Les auteurs préviennent que les
            années ne sont pas parfaitement comparables : les capteurs ont changé (Landsat 8 à partir de 2013)
            et il y a beaucoup plus d'images disponibles qu'au début des années 2000. Une hausse peut donc venir
            en partie d'une meilleure détection.
          </p>
          <p>
            Source : Hansen et al. (2013), Science 342, version {resume.version}. Traitement :
            agrégation de {resume.nb_tuiles} tuiles de pixels de 30 m en hexagones H3.
          </p>
        </section>
      </div>
    </aside>
  );
}
