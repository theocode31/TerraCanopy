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
import { BitmapLayer, GeoJsonLayer, PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { latLngToCell } from 'h3-js';

import { chargerBase, chargerPaquet, valeur, perte, formaterHa, formaterPart, formaterKm2 } from './donnees.js';
import { couleur, visible, hauteur, echellePeriode, seuilsPour, FACTEUR_MIN, FACTEUR_MAX, FACTEUR_DEPART } from './couleurs.js';
import { Bandeau, Habillage, Pied } from './Panneau.jsx';

const VUE_GLOBE = new GlobeView({ id: 'globe', resolution: 5 });
// fond de carte : relief ombre de Natural Earth (1:50m, terres et fonds marins), colore en gris
// clair pour les terres et en bleu profond pour l'ocean (script pipeline/fond_relief.py). L'ocean et
// les terres en aplat servent le temps que l'image arrive.
const FOND_RELIEF = `${import.meta.env.BASE_URL}fond-relief.jpg`;
const OCEAN = [118, 160, 196];
const TERRE = [224, 223, 219];
const PAPIER = [246, 243, 236];
const MONDE = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]];
const ARETE_KM = { 2: 182.5, 3: 69.0, 4: 26.07, 5: 9.85, 6: 3.72 }; // cote moyen des hexagones H3 (h3 4.5, average_hexagon_edge_length)
const ARETE_MIN_PX = 3; // on prend la resolution la plus fine dont les hexagones font au moins ca a l'ecran
const PAQUETS_MAX = 100; // vue inclinee : au-dela, on passe a la resolution du dessus
const RAYON_TERRE_KM = 6371;
const RAYON_GLOBE = 256; // rayon du globe dans les coordonnees internes de deck.gl
const INCLINAISON_RELIEF = 50;
const PAS_LECTURE = 700; // ms par annee quand on lance l'accumulation : 2001 a 2025 en 17 s environ
// noms des pays, en relief seulement : a partir du zoom 3,5 (celui ou le relief s'incline davantage),
// avec un fondu sur 0,4 niveau de zoom. Chaque pays attend le zoom conseille par Natural Earth plus
// 0,5 : le globe incline montre plus de pays qu'une carte a plat au meme zoom. Encre a moitie
// transparente, pour ne pas cacher les blocs
const ZOOM_NOMS = 3.5;
const FONDU_NOMS = 0.4;
const DECALAGE_NOMS = 0.5;
const ENCRE = [29, 28, 26];
const OPACITE_NOMS = 0.55;

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
  // avec la perspective, le globe parait environ 0,8 fois plus petit que le calcul : en visant la
  // moitie du petit cote, il en occupe environ 80 %. Sur un ecran etroit, la legende prend le bas de
  // la carte, et le globe reste au-dessus (170 px)
  const petit = Math.min(largeur, hauteurPx);
  let rayonVoulu = 0.5 * petit;
  if (largeur < 760) rayonVoulu = Math.max(0.3 * petit, Math.min(rayonVoulu, (hauteurPx / 2 - 170) / 0.78));
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

// contour du globe a l'ecran, pour y tracer un trait fin : le bord visible est le cercle de la
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

// cos de l'angle entre la verticale d'un lieu et la direction de la camera : 1 quand on le voit
// d'en haut, 0 au bord du globe, negatif derriere
function vuDeHaut(viewport, [lon, lat]) {
  const p = viewport.projectPosition([lon, lat, 0]);
  const c = viewport.cameraPosition;
  const v = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  return (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / (Math.hypot(p[0], p[1], p[2]) * Math.hypot(v[0], v[1], v[2]));
}

// nom en capitales ; un nom long passe sur deux lignes, coupe a l'espace le plus proche du milieu
// (jamais au milieu d'un mot : « BOSNIE-HERZÉGOVINE » reste entier)
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
  const [relief, setRelief] = useState(false);
  const [facteur, setFacteur] = useState(FACTEUR_DEPART); // multiplie la hauteur des colonnes
  // cumul : la periode part toujours de 2001 et les seuils restent ceux des 25 ans, pour voir la
  // perte s'accumuler. lecture : les annees defilent toutes seules.
  const [cumul, setCumul] = useState(false);
  const [lecture, setLecture] = useState(false);
  const [affiche, setAffiche] = useState({ r: 2, hexagones: [] });
  const [chargement, setChargement] = useState(false);
  const [fondRelief, setFondRelief] = useState(null);
  const [replie, setReplie] = useState(false); // frise des annees repliee
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

  // l'image du relief est chargee a part : tant qu'elle n'est pas la, on affiche l'ocean et les
  // terres en aplat, puis on les retire (deux surfaces a la meme altitude se melangent a l'ecran)
  useEffect(() => {
    const image = new Image();
    image.onload = () => setFondRelief(image);
    image.src = FOND_RELIEF;
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

  // tant qu'on n'a pas touche au globe, il garde la bonne taille si la zone de carte change
  // (chargement de la frise, fenetre redimensionnee)
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
  // du cote de la camera et un peu de la gauche de l'ecran : le dessus des blocs garde sa couleur,
  // la face avant est un peu plus sombre et la face de droite est dans l'ombre
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
    // droite de l'ecran : produit vectoriel de la verticale et de la direction de la camera
    const droite = [haut[1] * vers[2] - haut[2] * vers[1], haut[2] * vers[0] - haut[0] * vers[2], haut[0] * vers[1] - haut[1] * vers[0]];
    const nd = Math.hypot(droite[0], droite[1], droite[2]) || 1;
    const l = [0, 1, 2].map((i) => haut[i] + 0.4 * vers[i] - (0.35 * droite[i]) / nd);
    const nl = Math.hypot(l[0], l[1], l[2]);
    lumiere.soleil.direction = l.map((x) => -x / nl);
  }
  const montrerBord = bord && taille && bord.rx < 4 * Math.max(taille.largeur, taille.hauteur);
  // l'ombrage qui donne du volume au globe s'efface quand on s'approche : de pres, il assombrirait
  // seulement un cote de l'ecran
  const grand = taille ? Math.max(taille.largeur, taille.hauteur) : 1;
  const opaciteVolume = montrerBord ? Math.min(1, Math.max(0, (1.2 * grand - bord.rx) / (0.5 * grand))) : 0;

  // noms des pays : toute la couche arrive en fondu autour du zoom 3,5. Chaque nom s'ajoute quand on
  // a passe son zoom, et seulement sur la face du globe tournee vers nous, loin du bord
  const opaciteNoms = relief && vue ? Math.min(1, Math.max(0, (vue.zoom - ZOOM_NOMS + FONDU_NOMS) / FONDU_NOMS)) : 0;
  const cleNoms =
    donnees && viewport && opaciteNoms > 0
      ? donnees.noms.flatMap((d, i) => (vue.zoom >= d.zoomMin + DECALAGE_NOMS && vuDeHaut(viewport, d.position) > 0.15 ? [i] : [])).join(',')
      : '';
  // la liste ne change que si un nom entre ou sort : la couche ne refait pas la mise en page des
  // lettres a chaque image
  const nomsVisibles = useMemo(() => (cleNoms ? cleNoms.split(',').map((i) => donnees.noms[i]) : []), [donnees, cleNoms]);
  // toutes les lettres des noms, une fois pour toutes, pour que l'atlas des caracteres ne change pas
  const lettresNoms = useMemo(() => (donnees ? [...new Set(donnees.noms.map((d) => d.nom.toUpperCase()).join(''))].join('') : ''), [donnees]);

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
  const cleSeuils = seuils.join(',');
  // on ne garde que les hexagones dessines : les tres petites pertes ne sont ni colorees ni en relief
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
          // a plat : une mosaique, avec un liseré couleur papier entre les hexagones. En relief : des
          // blocs un peu espaces, sans liseré
          coverage: relief ? 0.86 : 1,
          stroked: !relief,
          getLineColor: [...PAPIER, 170],
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          extruded: relief,
          // le reglage « hauteur » passe par l'echelle de la couche : rien n'est recalcule, et les
          // colonnes suivent le curseur sans attendre
          elevationScale: facteur,
          // le dessus des blocs recoit environ 0,46 + 0,6 x 0,88 = 1 : il garde sa couleur. La face
          // avant descend vers 0,65 et la face a l'ombre vers 0,46
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
        // noms des pays en relief : ils font face a la camera et rapetissent avec la distance, comme
        // le reste de la scene. Ils passent devant les blocs, a moitie transparents
        new TextLayer({
          id: 'noms-des-pays',
          data: nomsVisibles,
          visible: nomsVisibles.length > 0,
          getText: (d) => etiquette(d.nom),
          getPosition: (d) => d.position,
          getColor: [...ENCRE, Math.round(255 * OPACITE_NOMS)],
          getSize: (d) => (d.zoomMin <= 2 ? 15 : d.zoomMin <= 3 ? 13 : 12),
          characterSet: lettresNoms,
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontWeight: 'bold',
          fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16 },
          outlineWidth: 5,
          outlineColor: [...PAPIER, 120],
          lineHeight: 1.1,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          // le globe de deck.gl ecarte les faces vues de dos (cullMode 'back'), et les lettres sont
          // tracees dans l'autre sens : sans ce reglage, aucune ne s'affiche
          parameters: { cullMode: 'none', depthCompare: 'always', depthWriteEnabled: false },
          opacity: opaciteNoms,
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
      pitch: actif ? (vue.zoom < 3.5 ? 30 : INCLINAISON_RELIEF) : 0,
      bearing: actif ? vue.bearing : 0,
      transitionDuration: 900,
      transitionInterpolator: new LinearInterpolator(['pitch', 'bearing']),
    });
  }

  // trois bandes : le bandeau du titre, la carte, la frise des annees (repliable)
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
        {/* volume du globe : un ombrage doux vers le bord et un peu de clarte en haut a gauche, puis
            le trait gris fin du bord */}
        {montrerBord && opaciteVolume > 0 && (
          <div
            className="volume-globe"
            style={{ left: bord.cx - bord.rx, top: bord.cy - bord.ry, width: 2 * bord.rx, height: 2 * bord.ry, opacity: opaciteVolume }}
          />
        )}
        {montrerBord && (
          <div className="bord-globe" style={{ left: bord.cx - bord.rx, top: bord.cy - bord.ry, width: 2 * bord.rx, height: 2 * bord.ry }} />
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
