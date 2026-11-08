// Chargement des fichiers produits par pipeline/exporter_web.py.
// Une ligne d'hexagone : [h3, code pays, foret 2000 (ha), [perte 2001, ..., perte 2025] (ha)].
// Pour chaque hexagone on garde les sommes cumulees des pertes : perte de a a b = cumul[b + 1] - cumul[a].
import { cellArea } from 'h3-js';

const base = import.meta.env.BASE_URL;

async function lireJson(chemin) {
  const reponse = await fetch(`${base}data/${chemin}`);
  if (!reponse.ok) throw new Error(`${chemin} introuvable (lancer d'abord pipeline/exporter_web.py)`);
  return reponse.json();
}

function preparer(lignes) {
  return lignes.map(([h, pays, foret, pertes]) => {
    const cumul = new Float64Array(pertes.length + 1);
    for (let k = 0; k < pertes.length; k++) cumul[k + 1] = cumul[k] + pertes[k];
    return { h, pays, foret, cumul, aire: cellArea(h, 'km2') };
  });
}

export async function chargerBase() {
  const [resume, index, r2, r3, terres] = await Promise.all(
    ['resume.json', 'index.json', 'r2.json', 'r3.json', 'terres.json'].map(lireJson),
  );
  const disponibles = {};
  for (const [r, parents] of Object.entries(index)) disponibles[r] = new Set(parents);
  return {
    resume,
    terres,
    disponibles,
    pays: Object.fromEntries(resume.pays.map((p) => [p.code, p])),
    niveaux: { 2: preparer(r2), 3: preparer(r3) },
  };
}

const cache = new Map();

// paquet = les hexagones de resolution r qui descendent d'un meme parent (r - 4)
export function chargerPaquet(r, parent) {
  const cle = `${r}/${parent}`;
  if (!cache.has(cle)) {
    cache.set(cle, lireJson(`r${r}/${parent}.json`).then(preparer).catch((e) => {
      cache.delete(cle);
      throw e;
    }));
  }
  return cache.get(cle);
}

export function perte(d, debut, fin) {
  return d.cumul[fin + 1] - d.cumul[debut];
}

// valeur affichee selon la mesure, en % : on divise par la surface de l'hexagone (ou par sa foret)
// pour que les couleurs veuillent dire la meme chose quelle que soit la taille des hexagones
export function valeur(d, mesure, debut, fin) {
  if (mesure === 'foret') return d.foret / d.aire;               // ha par km2 = % de la surface
  if (mesure === 'part') return (100 * perte(d, debut, fin)) / d.foret;
  return perte(d, debut, fin) / d.aire;
}

export function sommePeriode(pertes, debut, fin) {
  let s = 0;
  for (let k = debut; k <= fin; k++) s += pertes[k];
  return s;
}

const entier = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formaterHa(ha) {
  if (ha >= 1e6) return `${decimal.format(ha / 1e6)} Mha`;
  if (ha >= 1e4) return `${entier.format(ha / 1e3)} kha`;
  return `${entier.format(ha)} ha`;
}

export function formaterPart(p) {
  if (!Number.isFinite(p)) return '–';
  if (p > 0 && p < 0.1) return '< 0,1 %';
  return `${decimal.format(p)} %`;
}

export function formaterKm2(km2) {
  return `${entier.format(km2)} km²`;
}
