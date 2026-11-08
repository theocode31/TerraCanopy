import React, { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import {
  _GlobeView as GlobeView,
  _GlobeViewport as GlobeViewport,
  AmbientLight,
  DirectionalLight,
  LightingEffect,
  LinearInterpolator,
} from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { GeoJsonLayer, PathLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { latLngToCell } from 'h3-js';

import { chargerBase, chargerPaquet, valeur, perte, formaterHa, formaterPart, formaterKm2 } from './donnees.js';
import { couleur, hauteur, echellePeriode, seuilsPour, FACTEUR_MIN, FACTEUR_MAX, FACTEUR_DEPART } from './couleurs.js';
import Panneau from './Panneau.jsx';

const VUE_GLOBE = new GlobeView({ id: 'globe', resolution: 5 });
const OCEAN = [16, 52, 88];
const TERRE = [32, 48, 62];
const MONDE = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]];
const ARETE_KM = { 2: 182.5, 3: 69.0, 4: 26.07, 5: 9.85, 6: 3.72 }; // cote moyen des hexagones H3 (h3 4.5, average_hexagon_edge_length)
const ARETE_MIN_PX = 3; // on prend la resolution la plus fine dont les hexagones font au moins ca a l'ecran
const PAQUETS_MAX = 100; // vue inclinee : au-dela, on passe a la resolution du dessus
const RAYON_TERRE_KM = 6371;
const RAYON_GLOBE = 256; // rayon du globe dans les coordonnees internes de deck.gl
const INCLINAISON_RELIEF = 50;
const PAS_LECTURE = 700; // ms par annee quand on lance l'accumulation : 2001 a 2025 en 17 s environ

// meridiens et paralleles tous les 30 degres
const GRILLE = [
  ...[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map((lon) => ({
    path: Array.from({ length: 81 }, (_, k) => [lon, -80 + 2 * k]),
  })),
  ...[-60, -30, 0, 30, 60].map((lat) => ({
    path: Array.from({ length: 181 }, (_, k) => [-180 + 2 * k, lat]),
  })),
];

// echelle du globe de deck.gl : 256 unites pour le rayon, multipliees par 2^zoom / (pi cos lat)
function echelle(vue) {
  return Math.pow(2, vue.zoom) / (Math.PI * Math.cos((vue.latitude * Math.PI) / 180));
}

function choisirResolution(vue) {
  const pxParKm = (RAYON_GLOBE * echelle(vue)) / RAYON_TERRE_KM;
  for (let r = 6; r > 2; r--) if (ARETE_KM[r] * pxParKm >= ARETE_MIN_PX) return r;
  return 2;
}

function zoomPourVoirLeGlobe(largeur, hauteurPx, latitude) {
  // avec la perspective, le globe parait environ 0,71 fois plus petit que le calcul : 0,5 donne un
  // rayon visible de ~0,36 fois le petit cote, ce qui laisse la place au titre et a la frise
  const rayonVoulu = 0.5 * Math.min(largeur, hauteurPx);
  return Math.log2((rayonVoulu * Math.PI * Math.cos((latitude * Math.PI) / 180)) / RAYON_GLOBE);
}

// paquets a charger : on echantillonne l'ecran et on garde les parents qui existent
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

// contour du globe a l'ecran, pour placer l'atmosphere : le bord visible est le cercle de la
// sphere ou les rayons partant de la camera sont tangents
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

// viseur autour du globe : un anneau gradue tous les 5 degres, qui tourne avec l'orientation de la
// vue (N en haut quand le nord est en haut), et deux arcs qui balaient le bord
const CAPS = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' };

function Viseur({ bord, taille, orientation, opacite }) {
  if (!bord || !taille || !(opacite > 0)) return null;
  const { cx, cy, rx, ry } = bord;
  const point = (deg, k) => {
    const t = ((deg - orientation) * Math.PI) / 180;
    return [cx + rx * k * Math.sin(t), cy - ry * k * Math.cos(t)];
  };
  const k0 = 1.05;
  const graduations = [];
  for (let a = 0; a < 360; a += 5) {
    const longue = a % 30 === 0;
    const [x1, y1] = point(a, k0);
    const [x2, y2] = point(a, k0 + (longue ? 0.03 : 0.012));
    graduations.push(<line key={a} x1={x1} y1={y1} x2={x2} y2={y2} className={longue ? 'grad-longue' : 'grad'} />);
  }
  const etiquettes = [];
  for (let a = 0; a < 360; a += 30) {
    const [x, y] = point(a, k0 + 0.075);
    etiquettes.push(
      <text key={a} x={x} y={y} className={CAPS[a] ? 'cap' : 'degre'} textAnchor="middle" dominantBaseline="central">
        {CAPS[a] ?? String(a).padStart(3, '0')}
      </text>,
    );
  }
  return (
    <svg className="viseur" width={taille.largeur} height={taille.hauteur} style={{ opacity: opacite }} aria-hidden="true">
      <ellipse cx={cx} cy={cy} rx={rx * k0} ry={ry * k0} className="anneau" />
      <ellipse cx={cx} cy={cy} rx={rx * 1.022} ry={ry * 1.022} className="balayage" pathLength="1000" />
      <ellipse cx={cx} cy={cy} rx={rx * 1.022} ry={ry * 1.022} className="balayage retour" pathLength="1000" />
      {graduations}
      {etiquettes}
    </svg>
  );
}

function Etoiles({ taille }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!taille) return;
    const toile = ref.current;
    const dpr = window.devicePixelRatio || 1;
    toile.width = Math.round(taille.largeur * dpr);
    toile.height = Math.round(taille.hauteur * dpr);
    const ctx = toile.getContext('2d');
    ctx.scale(dpr, dpr);
    let graine = 7; // toujours le meme ciel
    const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
    const n = Math.round((taille.largeur * taille.hauteur) / 3600);
    for (let i = 0; i < n; i++) {
      const x = hasard() * taille.largeur;
      const y = hasard() * taille.hauteur;
      const t = hasard();
      const r = t > 0.985 ? 1.1 : t > 0.9 ? 0.75 : 0.45;
      const a = (0.15 + 0.6 * hasard() ** 2).toFixed(2);
      const teinte = hasard();
      ctx.fillStyle = teinte < 0.15 ? `rgba(255,226,190,${a})` : teinte < 0.35 ? `rgba(190,210,255,${a})` : `rgba(235,238,245,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    }
  }, [taille]);
  return <canvas className="etoiles" ref={ref} aria-hidden="true" />;
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
      return `<rect x="${k * 6}" y="${28 - h}" width="4.5" height="${h}" fill="${dans ? '#fa9512' : '#34506a'}"/>`;
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
  const [relief, setRelief] = useState(false);
  const [facteur, setFacteur] = useState(FACTEUR_DEPART); // multiplie la hauteur des colonnes
  // cumul : la periode part toujours de 2001 et les seuils restent ceux des 25 ans, pour voir la
  // perte s'accumuler. lecture : les annees defilent toutes seules.
  const [cumul, setCumul] = useState(false);
  const [lecture, setLecture] = useState(false);
  const [affiche, setAffiche] = useState({ r: 2, hexagones: [] });
  const [chargement, setChargement] = useState(false);
  const touche = useRef(false); // le globe tourne seul tant qu'on n'y a pas touche
  const carte = useRef(null);

  useEffect(() => {
    chargerBase()
      .then((d) => {
        setDonnees(d);
        setPeriode([0, d.resume.annees.length - 1]);
      })
      .catch((e) => setErreur(e.message));
  }, []);

  // taille de la zone de carte, pour calculer le zoom de depart et ce qui est visible
  useEffect(() => {
    const observer = new ResizeObserver(([e]) => setTaille({ largeur: e.contentRect.width, hauteur: e.contentRect.height }));
    observer.observe(carte.current);
    return () => observer.disconnect();
  }, []);

  // vue de depart : celle de l'adresse (#longitude,latitude,zoom[,inclinaison,orientation][,3d])
  // si on l'a partagee, sinon tout le globe
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
      setVue({ longitude: -35, latitude, zoom: zoomPourVoirLeGlobe(taille.largeur, taille.hauteur, latitude), pitch: 0, bearing: 0 });
    }
  }, [taille, vue]);

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

  // lecture de l'accumulation : une annee de plus a chaque pas, jusqu'a 2025
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
    // on reprend ou on etait si une lecture a ete mise en pause, sinon on repart de 2001
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

  // rotation lente au depart
  useEffect(() => {
    if (!vue || touche.current) return undefined;
    let id = requestAnimationFrame(function tourner() {
      if (touche.current) return;
      setVue((v) => ({ ...v, longitude: v.longitude + 0.04 }));
      id = requestAnimationFrame(tourner);
    });
    return () => cancelAnimationFrame(id);
  }, [vue === null]);

  const viewport = useMemo(
    () => (vue && taille ? new GlobeViewport({ ...vue, width: taille.largeur, height: taille.hauteur }) : null),
    [vue, taille],
  );
  const bord = viewport ? bordDuGlobe(viewport) : null;

  // relief : une lumiere qui suit la vue. Elle tombe d'en haut (la verticale du point vise), un peu
  // du cote de la camera, pour que le dessus des colonnes garde sa couleur partout sur le globe
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
    const l = [0, 1, 2].map((i) => t[i] / nt + (0.4 * vc[i]) / nv);
    const nl = Math.hypot(l[0], l[1], l[2]);
    lumiere.soleil.direction = l.map((x) => -x / nl);
  }
  const montrerBord = bord && taille && bord.rx < 4 * Math.max(taille.largeur, taille.hauteur);
  // le viseur s'efface quand on s'approche : le globe deborde de l'ecran et l'anneau n'a plus de sens
  const opaciteViseur = montrerBord
    ? Math.min(1, Math.max(0, (1.1 * Math.max(taille.largeur, taille.hauteur) - bord.rx) / (0.4 * Math.max(taille.largeur, taille.hauteur))))
    : 0;

  const resolution = vue ? choisirResolution(vue) : 2;

  // les hexagones a afficher : on garde l'ancien affichage tant que les nouveaux paquets ne sont pas la
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

  const couches = donnees
    ? [
        new SolidPolygonLayer({ id: 'ocean', data: MONDE, getPolygon: (d) => d, getFillColor: OCEAN }),
        new PathLayer({
          id: 'grille',
          data: GRILLE,
          getPath: (d) => d.path,
          getColor: [94, 231, 255, 46],
          getWidth: 1,
          widthUnits: 'pixels',
        }),
        new GeoJsonLayer({ id: 'terres', data: donnees.terres, filled: true, stroked: false, getFillColor: TERRE }),
        new H3HexagonLayer({
          id: `hexagones-${affiche.r}`,
          data: affiche.hexagones,
          getHexagon: (d) => d.h,
          getFillColor: (d) => couleur(mesure, valeur(d, mesure, debut, fin), seuils),
          getElevation: (d) => hauteur(valeur(d, mesure, debut, fin), echelle, arete),
          highPrecision: true,
          coverage: 1,
          stroked: false,
          extruded: relief,
          // le reglage « hauteur » passe par l'echelle de la couche : rien n'est recalcule, et les
          // colonnes suivent le curseur sans attendre
          elevationScale: facteur,
          // avec la lumiere ambiante (1) et la lumiere du dessus (1), le dessus des colonnes recoit
          // environ 0,55 + 0,5 = 1 : il garde sa couleur, et les cotes sont plus sombres
          material: { ambient: 0.55, diffuse: 0.5, shininess: 8, specularColor: [10, 10, 10] },
          pickable: true,
          autoHighlight: true,
          highlightColor: [94, 231, 255, 120],
          updateTriggers: { getFillColor: [mesure, debut, fin], getElevation: [mesure, debut, fin, arete] },
        }),
        new GeoJsonLayer({
          id: 'frontieres',
          data: donnees.terres,
          filled: false,
          stroked: true,
          getLineColor: [150, 225, 255, 75],
          lineWidthMinPixels: 0.6,
        }),
      ]
    : [];

  function allerVers(centre) {
    touche.current = true;
    setVue({
      ...vue,
      longitude: centre[0],
      latitude: centre[1],
      zoom: 4.3,
      transitionDuration: 1600,
      transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom']),
    });
  }

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
      pitch: actif ? (vue.zoom < 3.5 ? 30 : INCLINAISON_RELIEF) : 0,
      bearing: actif ? vue.bearing : 0,
      transitionDuration: 900,
      transitionInterpolator: new LinearInterpolator(['pitch', 'bearing']),
    });
  }

  return (
    <div className="appli">
      <main className="carte" ref={carte}>
        <Etoiles taille={taille} />
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
        {/* bord du globe : un trait fin et une lueur courte, a la place de l'ancien halo */}
        {montrerBord && (
          <div className="bord-globe" style={{ left: bord.cx - bord.rx, top: bord.cy - bord.ry, width: 2 * bord.rx, height: 2 * bord.ry }} />
        )}
        <Viseur bord={montrerBord ? bord : null} taille={taille} orientation={vue ? vue.bearing : 0} opacite={opaciteViseur} />
        <div className="cadre" aria-hidden="true">
          <span className="hg" /><span className="hd" /><span className="bg" /><span className="bd" />
        </div>
        <Panneau
          donnees={donnees}
          erreur={erreur}
          mesure={mesure}
          setMesure={setMesure}
          periode={periode}
          setPeriode={choisirPeriode}
          cumul={cumul}
          choisirCumul={choisirCumul}
          lecture={lecture}
          lancerLecture={lancerLecture}
          resolution={affiche.r}
          position={vue}
          relief={relief}
          basculerRelief={basculerRelief}
          facteur={facteur}
          setFacteur={setFacteur}
          revenirAuGlobe={revenirAuGlobe}
          chargement={chargement}
          allerVers={allerVers}
        />
      </main>
    </div>
  );
}
