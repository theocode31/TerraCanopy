const JAUNE_ROUGE = [null, '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'];
const VIRIDIS = ['#355f8d', '#2a7b8e', '#20968b', '#29af7f', '#55c667', '#95d840', '#fde725'];

export const CLASSES = {
  perte: { seuils: [0.5, 1.5, 4, 10, 20, 35], couleurs: JAUNE_ROUGE },
  part: { seuils: [1, 2.5, 5, 10, 20, 35], couleurs: JAUNE_ROUGE },
  foret: { seuils: [5, 15, 30, 50, 70, 85], couleurs: VIRIDIS },
};

const TRANSPARENT = [0, 0, 0, 0];

function versRgb(hex) {
  if (!hex) return TRANSPARENT;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function visible(mesure, v, seuils) {
  if (!(v > 0)) return false;
  return CLASSES[mesure].couleurs[0] !== null || v >= seuils[0];
}

const RGB = Object.fromEntries(Object.entries(CLASSES).map(([m, c]) => [m, c.couleurs.map(versRgb)]));

export function echellePeriode(mesure, nAnnees, nTotal) {
  return mesure === 'foret' ? 1 : nAnnees / nTotal;
}

export function seuilsPour(mesure, echelle) {
  return CLASSES[mesure].seuils.map((s) => Number((s * echelle).toPrecision(2)));
}

export function couleur(mesure, v, seuils) {
  if (!(v > 0)) return TRANSPARENT;
  let k = 0;
  while (k < seuils.length && v >= seuils[k]) k++;
  return RGB[mesure][k];
}

export function hauteur(v, echelle, areteKm) {
  if (!(v > 0)) return 0;
  return (Math.min(v, 100) / echelle / 100) * 2 * areteKm * 1000;
}

export const FACTEUR_MIN = 1;
export const FACTEUR_MAX = 10;
export const FACTEUR_DEPART = 3;
