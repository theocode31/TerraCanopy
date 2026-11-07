// Chargement des fichiers produits par pipeline/exporter_web.py et calculs sur une periode.
//
// Une ligne d'hexagone : [h3, code pays, foret 2000 (ha), [perte 2001, ..., perte 2025] (ha)].
// Pour sommer vite les pertes sur n'importe quelle periode, on garde pour chaque hexagone
// les sommes cumulees : perte de a a b = cumul[b + 1] - cumul[a].

async function lireJson(nom) {
  const reponse = await fetch(`${import.meta.env.BASE_URL}data/${nom}.json`);
  if (!reponse.ok) throw new Error(`${nom}.json introuvable (lancer d'abord pipeline/exporter_web.py)`);
  return reponse.json();
}

function preparerJeu(lignes, nbAnnees) {
  const largeur = nbAnnees + 1;
  const cumul = new Float64Array(lignes.length * largeur);
  const hexagones = lignes.map(([h, pays, foret, pertes], i) => {
    let somme = 0;
    for (let k = 0; k < nbAnnees; k++) {
      somme += pertes[k];
      cumul[i * largeur + k + 1] = somme;
    }
    return { h, pays, foret, pertes, i };
  });
  return { hexagones, cumul, largeur };
}

export async function chargerDonnees() {
  const [resume, res3, res4] = await Promise.all(['resume', 'hex_res3', 'hex_res4'].map(lireJson));
  const nb = resume.annees.length;
  const pays = Object.fromEntries(resume.pays.map((p) => [p.code, p]));
  return { resume, pays, res3: preparerJeu(res3, nb), res4: preparerJeu(res4, nb) };
}

export function perteHexagone(jeu, i, debut, fin) {
  const base = i * jeu.largeur;
  return jeu.cumul[base + fin + 1] - jeu.cumul[base + debut];
}

export function sommePeriode(pertes, debut, fin) {
  let s = 0;
  for (let k = debut; k <= fin; k++) s += pertes[k];
  return s;
}

// valeur affichee pour chaque hexagone selon la mesure choisie
export function calculerValeurs(jeu, mesure, debut, fin) {
  const valeurs = new Float64Array(jeu.hexagones.length);
  jeu.hexagones.forEach((d) => {
    if (mesure === 'foret') valeurs[d.i] = d.foret;
    else {
      const perte = perteHexagone(jeu, d.i, debut, fin);
      valeurs[d.i] = mesure === 'part' ? (100 * perte) / d.foret : perte;
    }
  });
  return valeurs;
}

const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formaterHa(ha) {
  if (ha >= 1e6) return `${decimal.format(ha / 1e6)} Mha`;
  if (ha >= 1e4) return `${nombre.format(ha / 1e3)} kha`;
  return `${nombre.format(ha)} ha`;
}

export function formaterPart(p) {
  if (!Number.isFinite(p)) return '–';
  if (p > 0 && p < 0.1) return '< 0,1 %';
  return `${decimal.format(p)} %`;
}
