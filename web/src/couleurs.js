// Couleurs sur fond sombre : du plus sombre (peu) au plus lumineux (beaucoup).
// Perte : 7 teintes prises dans la palette « inferno » (van der Walt et Smith, matplotlib), du violet
// au jaune pale, entre 0,3 et 1 de l'echelle pour que la premiere classe reste visible sur le globe.
// Inferno est faite pour que la clarte monte reguliere, et elle se lit aussi avec un daltonisme.
// Foret : meme principe avec « viridis », du bleu au jaune-vert.
// Seuils fixes et ronds plutot que des quantiles : une couleur garde le meme sens quand on zoome
// ou qu'on se deplace, et la legende se lit directement.
const INFERNO = ['#6a176e', '#9b2964', '#c63f4e', '#e8632a', '#fa9512', '#f7cf3c', '#fcffa4'];
const VIRIDIS = ['#355f8d', '#2a7b8e', '#20968b', '#29af7f', '#55c667', '#95d840', '#fde725'];

export const CLASSES = {
  perte: { seuils: [0.5, 1.5, 4, 10, 20, 35], couleurs: INFERNO },
  part: { seuils: [1, 2.5, 5, 10, 20, 35], couleurs: INFERNO },
  foret: { seuils: [5, 15, 30, 50, 70, 85], couleurs: VIRIDIS },
};

const TRANSPARENT = [0, 0, 0, 0];

function versRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

const RGB = Object.fromEntries(Object.entries(CLASSES).map(([m, c]) => [m, c.couleurs.map(versRgb)]));

// Les seuils de CLASSES valent pour toute la periode (25 ans). Pour une periode plus courte, la perte
// et la part perdue sont mecaniquement plus petites : sur une seule annee, presque tous les hexagones
// tombaient dans la premiere classe. Les seuils suivent donc la duree de la periode (x n / 25) : une
// meme couleur veut dire la meme perte moyenne par an, quelle que soit la periode choisie.
// Arrondis a deux chiffres significatifs pour que la legende se lise.
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

// hauteur des colonnes en mode relief, en metres. Les trois mesures sont des pourcentages (0 a 100).
// La hauteur est proportionnelle a la valeur : une colonne deux fois plus haute veut dire deux fois
// plus. Elle est rapportee a la taille des hexagones pour garder la meme allure a tous les zooms
// (100 % sur 25 ans = 4 cotes d'hexagone), puis multipliee par le reglage « hauteur » du site. Comme
// pour les couleurs, la valeur est divisee par l'echelle de la periode : sur une seule annee, une
// colonne a la hauteur qu'elle aurait si la meme perte se repetait chaque annee.
export function hauteur(v, echelle, areteKm) {
  if (!(v > 0)) return 0;
  return (Math.min(v, 100) / echelle / 100) * 4 * areteKm * 1000;
}

// reglage « hauteur » : x1 a x10, x3 au depart
export const FACTEUR_MIN = 1;
export const FACTEUR_MAX = 10;
export const FACTEUR_DEPART = 3;
