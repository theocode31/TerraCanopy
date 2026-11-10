import numpy as np
import pandas as pd
import rasterio
import h3
from rasterio.windows import Window

SEUIL_COUVERT = 30
RESOLUTION_H3 = 6
PIXELS_PAR_CELLULE = 40
PREMIERE_ANNEE = 2001
NB_ANNEES = 25
RAYON_TERRE = 6371007.2

COLONNES_PERTE = [f"perte_{PREMIERE_ANNEE + i}" for i in range(NB_ANNEES)]


def surface_lignes_ha(transform, premiere_ligne, nb_lignes):
    lat_haut = transform.f + np.arange(premiere_ligne, premiere_ligne + nb_lignes) * transform.e
    lat_bas = lat_haut + transform.e
    largeur = np.radians(transform.a)
    surface_m2 = RAYON_TERRE**2 * largeur * np.abs(np.sin(np.radians(lat_haut)) - np.sin(np.radians(lat_bas)))
    return surface_m2 / 10000.0


def agreger_tuile(chemin_perte, chemin_couvert, resolution=RESOLUTION_H3, p=PIXELS_PAR_CELLULE):
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
            annee = perte[lignes, colonnes].astype(np.int64)
            max_annee = max(max_annee, int(annee.max()))
            annee = np.minimum(annee, NB_ANNEES)
            surface = surface_lignes_ha(t, debut, nb)[lignes]

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
    df.insert(0, "foret_2000", valeurs.sum(axis=1))
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
