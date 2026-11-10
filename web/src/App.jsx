import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import {
  _GlobeView as GlobeView,
  _GlobeViewport as GlobeViewport,
  COORDINATE_SYSTEM,
  AmbientLight,
  DirectionalLight,
  LightingEffect,
  LinearInterpolator,
} from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer, PathLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { latLngToCell } from 'h3-js';

import { chargerBase, chargerPaquet, valeur, perte, formaterHa, formaterPart, formaterKm2 } from './donnees.js';
import { couleur, visible, hauteur, echellePeriode, seuilsPour, FACTEUR_MIN, FACTEUR_MAX, FACTEUR_DEPART } from './couleurs.js';
import { Bandeau, Habillage, Pied } from './Panneau.jsx';

const VUE_GLOBE = new GlobeView({ id: 'globe', resolution: 5 });
const FOND_RELIEF = `${import.meta.env.BASE_URL}fond-relief.jpg`;
const OCEAN = [118, 160, 196];
const TERRE = [224, 223, 219];
const PAPIER = [246, 243, 236];
const MONDE = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]];
const ARETE_KM = { 2: 182.5, 3: 69.0, 4: 26.07, 5: 9.85, 6: 3.72 };
const ARETE_MIN_PX = 3;
const PAQUETS_MAX = 100;
const RAYON_TERRE_KM = 6371;
const RAYON_GLOBE = 256;
const INCLINAISON_RELIEF = 50;
const INCLINAISON_GLOBE = 30;
const PAS_LECTURE = 700;
const ZOOM_NOMS = 3.5;
const FONDU_NOMS = 0.4;
const DECALAGE_NOMS = 0.5;
const OPACITE_NOMS = 0.9;

const GRILLE = [
  ...[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map((lon) => ({
    path: Array.from({ length: 81 }, (_, k) => [lon, -80 + 2 * k]),
  })),
  ...[-60, -30, 0, 30, 60].map((lat) => ({
    path: Array.from({ length: 181 }, (_, k) => [-180 + 2 * k, lat]),
  })),
];

function echelle(vue) {
  return Math.pow(2, vue.zoom) / (Math.PI * Math.cos((vue.latitude * Math.PI) / 180));
}

function choisirResolution(vue) {
  const pxParKm = (RAYON_GLOBE * echelle(vue)) / RAYON_TERRE_KM;
  for (let r = 6; r > 2; r--) if (ARETE_KM[r] * pxParKm >= ARETE_MIN_PX) return r;
  return 2;
}

function rayonVoulu(largeur, hauteurPx) {
  const petit = Math.min(largeur, hauteurPx);
  if (largeur >= 760) return 0.5 * petit;
  return Math.max(0.3 * petit, Math.min(0.5 * petit, (hauteurPx / 2 - 170) / 0.78));
}

function zoomPourVoirLeGlobe(largeur, hauteurPx, latitude) {
  return Math.log2((rayonVoulu(largeur, hauteurPx) * Math.PI * Math.cos((latitude * Math.PI) / 180)) / RAYON_GLOBE);
}

function paquetsVisibles(viewport, r, disponibles) {
  const { width, height } = viewport;
  const parents = new Set();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = viewport.unproject([(i / n) * width, (j / n) * height]);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const parent = latLngToCell(p[1], p[0], r - 4);
      if (disponibles[r]?.has(parent)) parents.add(parent);
    }
  }
  return [...parents].sort();
}

function bordDuGlobe(viewport) {
  const c = viewport.cameraPosition;
  const d = Math.hypot(c[0], c[1], c[2]);
  if (!(d > RAYON_GLOBE)) return null;
  const u = [c[0] / d, c[1] / d, c[2] / d];
  let e1 = [u[1], -u[0], 0];
  let n1 = Math.hypot(e1[0], e1[1]);
  if (n1 < 1e-6) {
    e1 = [1, 0, 0];
    n1 = 1;
  }
  e1 = e1.map((x) => x / n1);
  const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const cosT = RAYON_GLOBE / d;
  const sinT = Math.sqrt(1 - cosT * cosT);
  const m = viewport.pixelProjectionMatrix;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * 2 * Math.PI;
    const p = [0, 1, 2].map((i) => RAYON_GLOBE * (cosT * u[i] + sinT * (Math.cos(a) * e1[i] + Math.sin(a) * e2[i])));
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (!(w > 0)) return null;
    const x = (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w;
    const y = (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 };
}

function vuDeHaut(viewport, [lon, lat]) {
  const p = viewport.projectPosition([lon, lat, 0]);
  const c = viewport.cameraPosition;
  const v = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  return (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / (Math.hypot(p[0], p[1], p[2]) * Math.hypot(v[0], v[1], v[2]));
}

function etiquette(nom) {
  const n = nom.toUpperCase();
  if (n.length <= 14 || !n.includes(' ')) return n;
  let coupe = -1;
  for (let k = 0; k < n.length; k++) {
    if (n[k] === ' ' && (coupe < 0 || Math.abs(k - n.length / 2) < Math.abs(coupe - n.length / 2))) coupe = k;
  }
  return `${n.slice(0, coupe)}\n${n.slice(coupe + 1)}`;
}

function infobulle(d, donnees, debut, fin) {
  if (!d) return null;
  const annees = donnees.resume.annees;
  const pertes = Array.from(d.cumul.slice(1), (c, k) => c - d.cumul[k]);
  const max = Math.max(...pertes, 1);
  const barres = pertes
    .map((p, k) => {
      const h = Math.max(1, (26 * p) / max);
      const dans = k >= debut && k <= fin;
      return `<rect x="${k * 6}" y="${28 - h}" width="4.5" height="${h}" fill="${dans ? '#e2401f' : '#cfc8b9'}"/>`;
    })
    .join('');
  const p = perte(d, debut, fin);
  return {
    html: `
      <div class="bulle-titre">${donnees.pays[d.pays]?.nom ?? ''}</div>
      <div class="bulle-ligne"><span>Forêt en 2000</span><b>${formaterHa(d.foret)}</b></div>
      <div class="bulle-ligne"><span>Perdu ${annees[debut]}–${annees[fin]}</span><b>${formaterHa(p)}</b></div>
      <div class="bulle-ligne"><span>Soit</span><b>${formaterPart((100 * p) / d.foret)} de la forêt</b></div>
      <svg class="bulle-graphique" width="150" height="30" viewBox="0 0 150 30" aria-hidden="true">${barres}</svg>
      <div class="bulle-note">Perte par an, ${annees[0]}–${annees[annees.length - 1]} · hexagone de ${formaterKm2(d.aire)}</div>`,
    className: 'bulle',
    style: { background: 'none', padding: 0 },
  };
}

export default function App() {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [mesure, setMesure] = useState('perte');
  const [periode, setPeriode] = useState([0, 24]);
  const [taille, setTaille] = useState(null);
  const [vue, setVue] = useState(null);
  const [relief, setRelief] = useState(true);
  const [facteur, setFacteur] = useState(FACTEUR_DEPART);
  const [cumul, setCumul] = useState(false);
  const [lecture, setLecture] = useState(false);
  const [affiche, setAffiche] = useState({ r: 2, hexagones: [] });
  const [chargement, setChargement] = useState(false);
  const [fondRelief, setFondRelief] = useState(null);
  const [replie, setReplie] = useState(false);
  const touche = useRef(false);
  const carte = useRef(null);

  useEffect(() => {
    chargerBase()
      .then((d) => {
        setDonnees(d);
        setPeriode([0, d.resume.annees.length - 1]);
      })
      .catch((e) => setErreur(e.message));
  }, []);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setFondRelief(image);
    image.src = FOND_RELIEF;
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(([e]) => setTaille({ largeur: e.contentRect.width, hauteur: e.contentRect.height }));
    observer.observe(carte.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!taille || vue) return;
    const morceaux = window.location.hash.slice(1).split(',');
    const [lon, lat, zoom, pitch, bearing] = morceaux.map(Number);
    if ([lon, lat, zoom].every(Number.isFinite)) {
      touche.current = true;
      setRelief(morceaux.includes('3d'));
      const x = Number((morceaux.find((m) => m.startsWith('x')) || '').slice(1));
      if (x >= FACTEUR_MIN && x <= FACTEUR_MAX) setFacteur(x);
      setVue({
        longitude: lon,
        latitude: lat,
        zoom,
        pitch: Number.isFinite(pitch) ? pitch : 0,
        bearing: Number.isFinite(bearing) ? bearing : 0,
      });
    } else {
      const latitude = 8;
      setVue({ longitude: -35, latitude, zoom: zoomPourVoirLeGlobe(taille.largeur, taille.hauteur, latitude), pitch: INCLINAISON_GLOBE, bearing: 0 });
    }
  }, [taille, vue]);

  useEffect(() => {
    if (!taille || touche.current) return;
    setVue((v) => (v ? { ...v, zoom: zoomPourVoirLeGlobe(taille.largeur, taille.hauteur, v.latitude) } : v));
  }, [taille]);

  useEffect(() => {
    if (!vue || !touche.current) return undefined;
    const id = setTimeout(() => {
      let hash = `#${vue.longitude.toFixed(2)},${vue.latitude.toFixed(2)},${vue.zoom.toFixed(2)}`;
      if (vue.pitch > 0.5 || Math.abs(vue.bearing) > 0.5) hash += `,${vue.pitch.toFixed(0)},${vue.bearing.toFixed(0)}`;
      if (relief) hash += ',3d';
      if (relief && facteur !== FACTEUR_DEPART) hash += `,x${facteur}`;
      window.history.replaceState(null, '', hash);
    }, 400);
    return () => clearTimeout(id);
  }, [vue, relief, facteur]);

  const nAnnees = donnees ? donnees.resume.annees.length : 0;
  useEffect(() => {
    if (!lecture) return undefined;
    const id = setInterval(() => setPeriode(([, f]) => [0, Math.min(f + 1, nAnnees - 1)]), PAS_LECTURE);
    return () => clearInterval(id);
  }, [lecture, nAnnees]);
  useEffect(() => {
    if (lecture && periode[1] >= nAnnees - 1) setLecture(false);
  }, [lecture, periode, nAnnees]);

  function lancerLecture() {
    if (lecture) return setLecture(false);
    if (!(cumul && periode[1] < nAnnees - 1)) setPeriode([0, 0]);
    setCumul(true);
    setLecture(true);
  }

  function choisirCumul(actif) {
    setLecture(false);
    setCumul(actif);
    if (actif) setPeriode(([, f]) => [0, f]);
  }

  function choisirPeriode(p) {
    setLecture(false);
    setPeriode(p);
  }

  useEffect(() => {
    if (!vue || touche.current) return undefined;
    let id = requestAnimationFrame(function tourner() {
      if (touche.current) return;
      setVue((v) => ({ ...v, longitude: v.longitude + 0.04 }));
      id = requestAnimationFrame(tourner);
    });
    return () => cancelAnimationFrame(id);
  }, [vue === null]);

  const marge = taille ? Math.round((taille.largeur < 760 ? 0.6 : 0.35) * rayonVoulu(taille.largeur, taille.hauteur)) : 0;
  const viewport = useMemo(
    () => (vue && taille ? new GlobeViewport({ ...vue, width: taille.largeur, height: taille.hauteur + 2 * marge }) : null),
    [vue, taille, marge],
  );
  const bord = viewport ? bordDuGlobe(viewport) : null;

  const lumiere = useMemo(() => {
    const soleil = new DirectionalLight({ color: [255, 255, 255], intensity: 1, direction: [0, 0, -1] });
    const effet = new LightingEffect({ ambiante: new AmbientLight({ color: [255, 255, 255], intensity: 1 }), soleil });
    return { soleil, effet };
  }, []);
  if (viewport) {
    const t = viewport.projectPosition([vue.longitude, vue.latitude, 0]);
    const nt = Math.hypot(t[0], t[1], t[2]);
    const c = viewport.cameraPosition;
    const vc = [c[0] - t[0], c[1] - t[1], c[2] - t[2]];
    const nv = Math.hypot(vc[0], vc[1], vc[2]);
    const haut = t.map((x) => x / nt);
    const vers = vc.map((x) => x / nv);
    const droite = [haut[1] * vers[2] - haut[2] * vers[1], haut[2] * vers[0] - haut[0] * vers[2], haut[0] * vers[1] - haut[1] * vers[0]];
    const nd = Math.hypot(droite[0], droite[1], droite[2]) || 1;
    const l = [0, 1, 2].map((i) => haut[i] + 0.4 * vers[i] - (0.35 * droite[i]) / nd);
    const nl = Math.hypot(l[0], l[1], l[2]);
    lumiere.soleil.direction = l.map((x) => -x / nl);
  }
  const montrerBord = bord && taille && bord.rx < 4 * Math.max(taille.largeur, taille.hauteur);
  const grand = taille ? Math.max(taille.largeur, taille.hauteur) : 1;
  const opaciteVolume = montrerBord ? Math.min(1, Math.max(0, (1.2 * grand - bord.rx) / (0.5 * grand))) : 0;

  const nomsAffiches = [];
  if (donnees && viewport && relief && vue.zoom > ZOOM_NOMS - FONDU_NOMS) {
    const m = viewport.pixelProjectionMatrix;
    const profondeur = (p) => m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const w0 = profondeur(viewport.projectPosition([vue.longitude, vue.latitude, 0]));
    for (const d of donnees.noms) {
      const zoomVoulu = Math.max(ZOOM_NOMS, d.zoomMin + DECALAGE_NOMS);
      const parZoom = Math.min(1, Math.max(0, (vue.zoom - zoomVoulu + FONDU_NOMS) / FONDU_NOMS));
      if (parZoom === 0) continue;
      const opacite = parZoom * Math.min(1, Math.max(0, (vuDeHaut(viewport, d.position) - 0.1) / 0.15));
      if (opacite === 0) continue;
      const [x, y] = viewport.project([d.position[0], d.position[1], 0]);
      if (x < -150 || y < -60 || x > viewport.width + 150 || y > viewport.height + 60) continue;
      const w = profondeur(viewport.projectPosition([d.position[0], d.position[1], 0]));
      nomsAffiches.push({ ...d, x, y, w, grossissement: Math.min(1.5, Math.max(0.55, w0 / w)), opacite });
    }
    nomsAffiches.sort((a, b) => b.w - a.w);
  }

  const resolution = vue ? choisirResolution(vue) : 2;

  const cleVisible = useMemo(() => {
    if (!donnees || !viewport) return `${Math.min(resolution, 3)}`;
    for (let r = resolution; r > 3; r--) {
      const parents = paquetsVisibles(viewport, r, donnees.disponibles);
      if (parents.length <= PAQUETS_MAX || r === 4) return `${r}:${parents.join(',')}`;
    }
    return `${Math.min(resolution, 3)}`;
  }, [donnees, viewport, resolution]);

  useEffect(() => {
    if (!donnees) return undefined;
    const [r, liste] = cleVisible.split(':');
    if (+r <= 3) {
      setAffiche({ r: +r, hexagones: donnees.niveaux[r] });
      return undefined;
    }
    let annule = false;
    setChargement(true);
    const parents = liste ? liste.split(',') : [];
    Promise.all(parents.map((p) => chargerPaquet(+r, p)))
      .then((paquets) => {
        if (!annule) setAffiche({ r: +r, hexagones: paquets.flat() });
      })
      .catch((e) => console.warn(e))
      .finally(() => !annule && setChargement(false));
    return () => {
      annule = true;
    };
  }, [donnees, cleVisible]);

  const [debut, fin] = periode;
  const arete = ARETE_KM[affiche.r];
  const echelle = donnees && !cumul ? echellePeriode(mesure, fin - debut + 1, nAnnees) : 1;
  const seuils = seuilsPour(mesure, echelle);
  const cleSeuils = seuils.join(',');
  const hexagones = useMemo(
    () => affiche.hexagones.filter((d) => visible(mesure, valeur(d, mesure, debut, fin), seuils)),
    [affiche, mesure, debut, fin, cleSeuils],
  );

  const couches = donnees
    ? [
        ...(fondRelief
          ? [
              new BitmapLayer({
                id: 'relief-du-terrain',
                image: fondRelief,
                bounds: [-180, -90, 180, 90],
                _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
              }),
            ]
          : [
              new SolidPolygonLayer({ id: 'ocean', data: MONDE, getPolygon: (d) => d, getFillColor: OCEAN }),
              new GeoJsonLayer({ id: 'terres', data: donnees.terres, filled: true, stroked: false, getFillColor: TERRE }),
            ]),
        new PathLayer({
          id: 'grille',
          data: GRILLE,
          getPath: (d) => d.path,
          getColor: [70, 85, 95, 28],
          getWidth: 1,
          widthUnits: 'pixels',
        }),
        new H3HexagonLayer({
          id: `hexagones-${affiche.r}`,
          data: hexagones,
          getHexagon: (d) => d.h,
          getFillColor: (d) => couleur(mesure, valeur(d, mesure, debut, fin), seuils),
          getElevation: (d) => hauteur(valeur(d, mesure, debut, fin), echelle, arete),
          highPrecision: true,
          coverage: relief ? 0.86 : 1,
          stroked: !relief,
          getLineColor: [...PAPIER, 170],
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          extruded: relief,
          elevationScale: facteur,
          material: { ambient: 0.46, diffuse: 0.6, shininess: 8, specularColor: [10, 10, 10] },
          pickable: true,
          autoHighlight: true,
          highlightColor: [29, 28, 26, 70],
          updateTriggers: { getFillColor: [mesure, debut, fin], getElevation: [mesure, debut, fin, arete] },
        }),
        new GeoJsonLayer({
          id: 'frontieres',
          data: donnees.terres,
          filled: false,
          stroked: true,
          getLineColor: [110, 105, 95, 110],
          lineWidthMinPixels: 0.6,
        }),
      ]
    : [];

  function revenirAuGlobe() {
    touche.current = true;
    setVue({
      ...vue,
      zoom: zoomPourVoirLeGlobe(taille.largeur, taille.hauteur, vue.latitude),
      transitionDuration: 1200,
      transitionInterpolator: new LinearInterpolator(['zoom']),
    });
  }

  function basculerRelief() {
    const actif = !relief;
    touche.current = true;
    setRelief(actif);
    setVue({
      ...vue,
      pitch: actif ? (vue.zoom < 3.5 ? INCLINAISON_GLOBE : INCLINAISON_RELIEF) : 0,
      bearing: actif ? vue.bearing : 0,
      transitionDuration: 900,
      transitionInterpolator: new LinearInterpolator(['pitch', 'bearing']),
    });
  }

  return (
    <div className="appli">
      <Bandeau
        donnees={donnees}
        erreur={erreur}
        periode={periode}
        relief={relief}
        basculerRelief={basculerRelief}
        revenirAuGlobe={revenirAuGlobe}
        chargement={chargement}
      />
      <main className="carte" ref={carte}>
        {taille && (
          <div
            className="scene"
            style={{ top: -marge, height: taille.hauteur + 2 * marge, transform: `translateY(${relief ? -marge : 0}px)` }}
          >
            {vue && (
              <DeckGL
                views={VUE_GLOBE}
                viewState={vue}
                onViewStateChange={({ viewState }) => setVue(viewState)}
                onInteractionStateChange={(s) => {
                  if (s.isDragging || s.isZooming || s.isPanning || s.isRotating) touche.current = true;
                }}
                controller={{ inertia: 300, dragRotate: true }}
                layers={couches}
                effects={[lumiere.effet]}
                getTooltip={({ object }) => (donnees ? infobulle(object, donnees, debut, fin) : null)}
              />
            )}
            {montrerBord && opaciteVolume > 0 && (
              <div
                className="volume-globe"
                style={{ left: bord.cx - bord.rx, top: bord.cy - bord.ry, width: 2 * bord.rx, height: 2 * bord.ry, opacity: opaciteVolume }}
              />
            )}
            {montrerBord && (
              <div className="bord-globe" style={{ left: bord.cx - bord.rx, top: bord.cy - bord.ry, width: 2 * bord.rx, height: 2 * bord.ry }} />
            )}
            {nomsAffiches.length > 0 && (
              <div className="noms-pays" aria-hidden="true">
                {nomsAffiches.map((d) => (
                  <div
                    key={d.nom}
                    className="nom-pays"
                    style={{
                      fontSize: d.zoomMin <= 2 ? 15 : d.zoomMin <= 3 ? 13 : 12,
                      transform: `translate(${d.x}px, ${d.y}px) translate(-50%, -50%) scale(${d.grossissement})`,
                      opacity: OPACITE_NOMS * d.opacite,
                    }}
                  >
                    {etiquette(d.nom)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <Habillage
          donnees={donnees}
          mesure={mesure}
          setMesure={setMesure}
          periode={periode}
          cumul={cumul}
          relief={relief}
          facteur={facteur}
          setFacteur={setFacteur}
        />
      </main>
      <Pied
        donnees={donnees}
        periode={periode}
        setPeriode={choisirPeriode}
        cumul={cumul}
        choisirCumul={choisirCumul}
        lecture={lecture}
        lancerLecture={lancerLecture}
        replie={replie}
        setReplie={setReplie}
      />
    </div>
  );
}
