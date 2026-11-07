import React, { useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { FlyToInterpolator } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { GeoJsonLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';

import { chargerDonnees, calculerValeurs, perteHexagone, formaterHa, formaterPart } from './donnees.js';
import { calculerSeuils, creerEchelle } from './couleurs.js';
import Panneau from './Panneau.jsx';

// fond de carte sombre sans etiquettes, pour que les hexagones restent lisibles
const FOND_DE_CARTE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';
// centre decale vers l'est pour que le panneau a gauche ne cache pas l'Amerique du Sud
const VUE_DE_DEPART = { longitude: 0, latitude: 15, zoom: 1.35, pitch: 0, bearing: 0 };
const ZOOM_RESOLUTION_4 = 3.3; // en dessous on affiche les hexagones de resolution 3

function infobulle(objet, jeu, donnees, mesure, debut, fin) {
  if (!objet) return null;
  const perte = perteHexagone(jeu, objet.i, debut, fin);
  const max = Math.max(...objet.pertes, 1);
  const barres = objet.pertes
    .map((p, k) => {
      const h = Math.max(1, (28 * p) / max);
      const dans = k >= debut && k <= fin;
      return `<rect x="${k * 6}" y="${30 - h}" width="4" height="${h}" rx="1" fill="${dans ? '#f69046' : '#6b6b6b'}"/>`;
    })
    .join('');
  const pays = donnees.pays[objet.pays]?.nom ?? '';
  const annees = donnees.resume.annees;
  return {
    html: `
      <div class="bulle-titre">${pays}</div>
      <div class="bulle-ligne"><span>Forêt en 2000</span><b>${formaterHa(objet.foret)}</b></div>
      <div class="bulle-ligne"><span>Perte ${annees[debut]}–${annees[fin]}</span><b>${formaterHa(perte)}</b></div>
      <div class="bulle-ligne"><span>Part perdue</span><b>${formaterPart((100 * perte) / objet.foret)}</b></div>
      <svg class="bulle-graphique" width="150" height="32" viewBox="0 0 150 32" aria-hidden="true">${barres}</svg>
      <div class="bulle-note">Perte par an, ${annees[0]}–${annees[annees.length - 1]}</div>`,
    className: 'bulle',
    style: { background: 'none', padding: 0 },
  };
}

export default function App() {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [mesure, setMesure] = useState('perte');
  const [periode, setPeriode] = useState([0, 24]);
  const [relief, setRelief] = useState(false);
  const [vue, setVue] = useState(VUE_DE_DEPART);

  useEffect(() => {
    chargerDonnees()
      .then((d) => {
        setDonnees(d);
        setPeriode([0, d.resume.annees.length - 1]);
      })
      .catch((e) => setErreur(e.message));
  }, []);

  const [debut, fin] = periode;
  const resolution = vue.zoom < ZOOM_RESOLUTION_4 ? 3 : 4;
  const jeu = donnees ? (resolution === 3 ? donnees.res3 : donnees.res4) : null;

  const { valeurs, seuils, echelle, maximum } = useMemo(() => {
    if (!jeu) return {};
    const v = calculerValeurs(jeu, mesure, debut, fin);
    const s = calculerSeuils(v);
    let m = 0;
    for (const x of v) if (Number.isFinite(x) && x > m) m = x;
    return { valeurs: v, seuils: s, echelle: creerEchelle(mesure, s), maximum: m };
  }, [jeu, mesure, debut, fin]);

  const couches = jeu
    ? [
        new H3HexagonLayer({
          id: `hexagones-${resolution}`,
          data: jeu.hexagones,
          getHexagon: (d) => d.h,
          getFillColor: (d) => echelle(valeurs[d.i]),
          extruded: relief,
          getElevation: (d) => (Number.isFinite(valeurs[d.i]) ? valeurs[d.i] : 0),
          elevationScale: maximum > 0 ? (resolution === 3 ? 900000 : 350000) / maximum : 0,
          coverage: 0.94,
          stroked: false,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 90],
          opacity: 0.9,
          material: { ambient: 0.6, diffuse: 0.5, shininess: 10 },
          updateTriggers: {
            getFillColor: [mesure, debut, fin, resolution, seuils],
            getElevation: [mesure, debut, fin, resolution],
          },
          transitions: { getElevation: 400 },
        }),
        new GeoJsonLayer({
          id: 'frontieres',
          data: `${import.meta.env.BASE_URL}data/frontieres.json`,
          stroked: true,
          filled: false,
          getLineColor: [200, 200, 200, 70],
          lineWidthMinPixels: 0.6,
          pickable: false,
        }),
      ]
    : [];

  function allerVers(centre) {
    setVue({
      ...vue,
      longitude: centre[0],
      latitude: centre[1],
      zoom: 4.2,
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator(),
    });
  }

  function changerRelief(actif) {
    setRelief(actif);
    setVue({ ...vue, pitch: actif ? 45 : 0, transitionDuration: 600 });
  }

  return (
    <div className="appli">
      <DeckGL
        viewState={vue}
        onViewStateChange={({ viewState }) => setVue(viewState)}
        controller={{ dragRotate: relief }}
        layers={couches}
        getTooltip={({ object }) => (donnees ? infobulle(object, jeu, donnees, mesure, debut, fin) : null)}
      >
        <Map reuseMaps mapStyle={FOND_DE_CARTE} attributionControl={false} />
      </DeckGL>

      <Panneau
        donnees={donnees}
        erreur={erreur}
        mesure={mesure}
        setMesure={setMesure}
        periode={periode}
        setPeriode={setPeriode}
        relief={relief}
        setRelief={changerRelief}
        seuils={seuils}
        resolution={resolution}
        allerVers={allerVers}
      />

      <div className="credit">
        Données : <a href="https://glad.earthengine.app/view/global-forest-change" target="_blank" rel="noreferrer">Hansen/UMD/Google/USGS/NASA</a>
        {' · '}Fond : © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>, ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      </div>
    </div>
  );
}
