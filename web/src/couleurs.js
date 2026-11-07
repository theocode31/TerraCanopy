// Echelles de couleur sequentielles : une seule teinte, de sombre (peu) a clair (beaucoup),
// parce que le fond de carte est sombre. Orange pour la perte, vert pour la foret de 2000.
export const RAMPES = {
  perte: ['#3d1d0c', '#62290c', '#8c380b', '#b9490a', '#e2610f', '#f69046', '#fcc595'],
  part: ['#3d1d0c', '#62290c', '#8c380b', '#b9490a', '#e2610f', '#f69046', '#fcc595'],
  foret: ['#11301d', '#17462a', '#1f5f38', '#297a47', '#389959', '#5fba78', '#9edcaa'],
};

export const COULEUR_ZERO = [70, 70, 70, 90];

function versRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Seuils par quantiles sur les valeurs non nulles : chaque classe a a peu pres autant
// d'hexagones, sinon quelques hexagones extremes ecrasent toute la carte dans la premiere couleur.
export function calculerSeuils(valeurs, nbClasses = 7) {
  const positives = Array.from(valeurs).filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return [];
  const seuils = [];
  for (let k = 1; k < nbClasses; k++) {
    seuils.push(positives[Math.floor((k / nbClasses) * (positives.length - 1))]);
  }
  return seuils;
}

export function creerEchelle(mesure, seuils) {
  const rampe = RAMPES[mesure].map(versRgb);
  return (v) => {
    if (!(v > 0)) return COULEUR_ZERO;
    let k = 0;
    while (k < seuils.length && v >= seuils[k]) k++;
    return rampe[k];
  };
}
