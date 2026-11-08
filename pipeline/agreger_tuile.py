# Agregation d'une tuile Hansen (10 x 10 degres, pixels de 30 m) en hexagones H3 de resolution 6.
# Pour chaque pixel ou le couvert de 2000 depasse 30 %, sa surface va dans la foret de 2000 de son
# hexagone, et dans la perte de l'annee donnee par lossyear (1 = 2001 ... 25 = 2025) s'il y en a une.
# On ne passe pas les 1,6 milliard de pixels dans H3 : on les regroupe d'abord en cellules de
# 0,01 degre (40 x 40 pixels, environ 1,1 km), puis chaque cellule va dans l'hexagone qui contient
# son centre. Un hexagone de resolution 6 fait environ 36 km2, soit une trentaine de cellules.
import numpy as np
import pandas as pd
import rasterio
import h3
from rasterio.windows import Window

SEUIL_COUVERT = 30          # couvert de 2000 en %, on garde les pixels au-dessus
RESOLUTION_H3 = 6           # environ 36 km2 par hexagone
PIXELS_PAR_CELLULE = 40     # 40 pixels de 0,00025 degre = 0,01 degre
PREMIERE_ANNEE = 2001
NB_ANNEES = 25              # version GFC-2025-v1.13 : pertes de 2001 a 2025
RAYON_TERRE = 6371007.2     # sphere de meme surface que l'ellipsoide WGS84 (m)

COLONNES_PERTE = [f"perte_{PREMIERE_ANNEE + i}" for i in range(NB_ANNEES)]


def surface_lignes_ha(transform, premiere_ligne, nb_lignes):
    # surface d'un pixel pour chaque ligne : 30 m de large a l'equateur, beaucoup moins vers les poles
    lat_haut = transform.f + np.arange(premiere_ligne, premiere_ligne + nb_lignes) * transform.e
    lat_bas = lat_haut + transform.e
    largeur = np.radians(transform.a)
    surface_m2 = RAYON_TERRE**2 * largeur * np.abs(np.sin(np.radians(lat_haut)) - np.sin(np.radians(lat_bas)))
    return surface_m2 / 10000.0


def agreger_tuile(chemin_perte, chemin_couvert, resolution=RESOLUTION_H3, p=PIXELS_PAR_CELLULE):
    # renvoie une ligne par hexagone (foret_2000 et pertes en ha) et la plus grande valeur
    # de lossyear vue, pour verifier qu'elle ne depasse pas 25
    with rasterio.open(chemin_perte) as perte_src, rasterio.open(chemin_couvert) as couvert_src:
        if perte_src.transform != couvert_src.transform or perte_src.shape != couvert_src.shape:
            raise ValueError("lossyear et treecover2000 ne sont pas sur la meme grille")
        t = perte_src.transform
        hauteur, largeur = perte_src.shape
        nb_cellules = largeur // p
        max_annee = 0
        cellules, blocs = [], []

        for debut in range(0, hauteur, p):
            nb = min(p, hauteur - debut)
            fenetre = Window(0, debut, largeur, nb)
            couvert = couvert_src.read(1, window=fenetre)
            foret = couvert > SEUIL_COUVERT
            if not foret.any():
                continue
            perte = perte_src.read(1, window=fenetre)

            lignes, colonnes = np.nonzero(foret)
            annee = perte[lignes, colonnes].astype(np.int64)  # 0 = pas de perte
            max_annee = max(max_annee, int(annee.max()))
            annee = np.minimum(annee, NB_ANNEES)
            surface = surface_lignes_ha(t, debut, nb)[lignes]

            # colonne 0 = foret restee debout, colonnes 1 a 25 = perte de l'annee
            cle = (colonnes // p) * (NB_ANNEES + 1) + annee
            somme = np.bincount(cle, weights=surface, minlength=nb_cellules * (NB_ANNEES + 1))
            somme = somme.reshape(nb_cellules, NB_ANNEES + 1)

            avec_foret = np.nonzero(somme.sum(axis=1) > 0)[0]
            lat = t.f + (debut + nb / 2) * t.e
            lons = t.c + (avec_foret * p + p / 2) * t.a
            cellules.extend(h3.latlng_to_cell(lat, lon, resolution) for lon in lons)
            blocs.append(somme[avec_foret])

    if not cellules:
        return pd.DataFrame(columns=["h3", "foret_2000"] + COLONNES_PERTE), max_annee

    valeurs = np.vstack(blocs)
    df = pd.DataFrame(valeurs[:, 1:], columns=COLONNES_PERTE)
    df.insert(0, "foret_2000", valeurs.sum(axis=1))  # foret de 2000 = restee debout + perdue
    df.insert(0, "h3", cellules)
    return df.groupby("h3", as_index=False).sum(), max_annee


if __name__ == "__main__":
    import sys
    import time
    debut = time.time()
    df, max_annee = agreger_tuile(sys.argv[1], sys.argv[2])
    print(f"{len(df)} hexagones, foret 2000 = {df.foret_2000.sum() / 1e6:.3f} Mha, "
          f"perte 2001-2025 = {df[COLONNES_PERTE].sum().sum() / 1e6:.4f} Mha, "
          f"lossyear max = {max_annee}, {time.time() - debut:.0f} s")
