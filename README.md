# Terra Canopy : la perte de couvert arboré dans le monde, 2001-2025

Projet étudiant en géomatique et visualisation de données.

Site : https://theocode31.github.io/terra-canopy/

![Aperçu du site](docs/apercu.png)

## 1. Contexte et objectif

Les cartes Global Forest Change (Hansen et al., 2013) donnent, pour chaque pixel de 30 m de la planète, le couvert arboré de 2000 et l'année où il a été perdu. C'est très précis, mais très lourd : environ 100 Go de tuiles pour le monde entier. On ne peut ni les ouvrir dans un navigateur, ni les explorer facilement.

La question du projet : comment résumer ces cartes à l'échelle mondiale pour pouvoir les explorer dans un navigateur, sans fausser les surfaces ?

Objectifs :
1. agréger les pixels en hexagones sans perdre de surface en route ;
2. vérifier le résultat avec des chiffres publiés par ailleurs ;
3. faire une interface où l'on choisit une période, et où l'on compare les régions et les pays.

## 2. Données

| Données | Source | Utilisation |
|---|---|---|
| treecover2000 | Hansen/UMD/Google/USGS/NASA, version GFC-2025-v1.13 | couvert arboré en 2000, en % (végétation de plus de 5 m) |
| lossyear | même source | 0 = pas de perte, 1 à 25 = perte en 2001 à 2025 |
| Pays | Natural Earth, 1:50m (domaine public) | rattachement des hexagones à un pays |

Les données Hansen sont sous licence CC BY 4.0. Il y a 280 tuiles de 10 x 10 degrés qui ont une couche de perte. Les autres sont de l'océan.

## 3. Méthode

3.1. Sélection des pixels. Je ne garde que les pixels dont le couvert dépasse 30 % en 2000. Avec ce seuil, je retrouve les totaux de Global Forest Watch (partie 4).

3.2. Surface des pixels. Un pixel fait 0,00025 degré de côté, donc sa surface dépend de la latitude. Pour une ligne de pixels entre les latitudes φ1 et φ2, sur une sphère de rayon R = 6 371 007 m, de même surface que l'ellipsoïde WGS84 :

surface = R² × Δλ × |sin φ1 − sin φ2|

3.3. Agrégation en deux temps. Passer 1,6 milliard de pixels par tuile dans H3 prendrait trop de temps. Je regroupe donc d'abord les pixels en cellules de 0,05 degré (200 x 200 pixels), en sommant la forêt de 2000 et la perte de chaque année. Chaque cellule va ensuite dans l'hexagone H3 de résolution 4 (environ 1 770 km²) qui contient son centre. La résolution 3 (environ 12 400 km²) est la somme des hexagones enfants. Elle sert pour la vue du monde.

3.4. Traitement par flux. Les tuiles sont téléchargées une par une, agrégées puis supprimées, pendant que la suivante se télécharge. Il n'y a jamais plus de deux tuiles sur le disque. Les tropiques passent en premier. Le traitement des 280 tuiles a pris 116 minutes sur un PC portable.

3.5. Pays. Chaque hexagone est rattaché au pays qui contient son centre, ou au pays le plus proche si le centre tombe dans la mer.

3.6. Visualisation. Le site utilise React, deck.gl (H3HexagonLayer) et MapLibre. Pour que le changement de période soit instantané, chaque hexagone garde la somme cumulée de ses pertes : la perte de l'année a à l'année b vaut cumul[b+1] − cumul[a]. Les couleurs suivent des septiles : chaque couleur regroupe environ un septième des hexagones.

## 4. Résultats

Vérification avec les chiffres publiés par Global Forest Watch :

| | Ce projet | Global Forest Watch |
|---|---|---|
| Perte 2001-2024 | 517,4 Mha | 517 Mha |
| Perte en 2001 | 13,4 Mha | 13,4 Mha |
| Perte en 2024 | 29,6 Mha | 29,6 Mha |

Les chiffres tombent juste : l'agrégation ne perd pas de surface.

Sur toute la période 2001-2025, on compte 3 995 Mha de couvert arboré en 2000 et 543 Mha perdus, soit 13,6 %. La perte annuelle passe d'environ 16 Mha par an en 2001-2005 à environ 26 Mha par an en 2021-2025. Le maximum est de 29,7 Mha, en 2016.

Les pays qui ont perdu le plus de surface :

| Pays | Perte 2001-2025 | Couvert en 2000 | Part perdue |
|---|---|---|---|
| Russie | 91,7 Mha | 758 Mha | 12,1 % |
| Brésil | 76,5 Mha | 522 Mha | 14,6 % |
| Canada | 68,6 Mha | 416 Mha | 16,5 % |
| États-Unis | 51,0 Mha | 279 Mha | 18,3 % |
| Indonésie | 33,3 Mha | 162 Mha | 20,6 % |
| République démocratique du Congo | 22,4 Mha | 199 Mha | 11,3 % |
| Chine | 13,6 Mha | 164 Mha | 8,3 % |
| Bolivie | 10,7 Mha | 65 Mha | 16,6 % |
| Malaisie | 9,7 Mha | 30 Mha | 32,8 % |
| Australie | 9,6 Mha | 42 Mha | 22,7 % |

## 5. Limites

- La perte de couvert arboré n'est pas forcément de la déforestation. Elle compte aussi les coupes forestières qui repoussent, les incendies et les tempêtes. C'est pour ça que la Russie arrive devant le Brésil et que le Canada est troisième : une grande partie de leur perte vient des feux et de l'exploitation forestière. Le jeu de données ne dit pas pourquoi les arbres ont disparu.
- Les auteurs préviennent que les années ne sont pas parfaitement comparables. Les capteurs ont changé (Landsat 8 à partir de 2013) et il y a beaucoup plus d'images qu'au début des années 2000. La hausse entre le début et la fin de la période vient donc peut-être en partie d'une meilleure détection.
- Une cellule de 0,05 degré va entièrement dans l'hexagone de son centre. Au bord des hexagones, un peu de surface passe donc chez le voisin. Le total ne change pas, mais la carte est un peu lissée.
- Un hexagone sur une frontière compte entièrement pour un seul pays. Pour les petits pays, les chiffres sont donc approximatifs.
- Les septiles montrent où la perte est relativement la plus forte, et pas des seuils fixes. Les classes changent quand on change de période.

## 6. Reproduire

Python 3.11 ou plus :

```
pip install -r requirements.txt
python pipeline/lancer_pipeline.py      # environ 2 h, environ 100 Go téléchargés, reprend où il s'est arrêté
python pipeline/exporter_web.py         # écrit les JSON dans web/public/data
```

Site, avec Node 18 ou plus :

```
cd web
npm install
npm run dev
```

Les JSON du site sont déjà dans `web/public/data` : on peut lancer le site sans refaire le pipeline. À chaque push sur `main`, le site est reconstruit et publié sur GitHub Pages (`.github/workflows/site.yml`).

## 7. Organisation du dépôt

```
pipeline/
  agreger_tuile.py     une tuile Hansen -> hexagones H3 (forêt 2000 et perte par an)
  lancer_pipeline.py   télécharge, agrège et supprime les 280 tuiles, les tropiques d'abord
  exporter_web.py      fusionne les tuiles, ajoute la résolution 3 et les pays, écrit les JSON
web/
  src/App.jsx          carte deck.gl et fond de carte MapLibre
  src/Panneau.jsx      commandes, chiffre clé, graphique annuel, classement, légende
  src/donnees.js       chargement et sommes cumulées
  src/couleurs.js      échelles de couleur et septiles
  public/data/         hexagones et résumés produits par le pipeline
docs/apercu.png        capture du site
```

## Références

- Hansen, M. C., Potapov, P. V., Moore, R., Hancher, M., Turubanova, S. A., Tyukavina, A., Thau, D., Stehman, S. V., Goetz, S. J., Loveland, T. R., Kommareddy, A., Egorov, A., Chini, L., Justice, C. O., Townshend, J. R. G. (2013). High-Resolution Global Maps of 21st-Century Forest Cover Change. Science 342, 850-853. Données : https://glad.earthengine.app/view/global-forest-change
- Global Forest Watch / WRI, Indicators of Forest Extent : https://gfr.wri.org/
- H3, grille hexagonale hiérarchique : https://h3geo.org/
- Natural Earth : https://www.naturalearthdata.com/
- Fond de carte : © CARTO, © OpenStreetMap
