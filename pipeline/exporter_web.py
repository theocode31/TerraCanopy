# Rassemble les CSV de chaque tuile (hexagones de resolution 6) et prepare les fichiers du site.
# - un hexagone a cheval sur deux tuiles apparait dans deux CSV : on additionne ;
# - les resolutions 5 a 2 s'obtiennent en additionnant les enfants ;
# - chaque hexagone de resolution 6 est rattache au pays qui contient son centre (Natural Earth 1:50m),
#   ou au pays le plus proche si le centre tombe dans l'eau ; plus haut, c'est le pays de l'enfant
#   qui a le plus de foret ;
# - les resolutions 2 et 3 tiennent dans un fichier chacune. Les resolutions 4, 5 et 6 sont coupees
#   en paquets (un par parent 4 niveaux plus haut, 2 401 hexagones au plus) que le site charge
#   seulement quand on zoome dessus.
# Lancer depuis la racine du projet, apres lancer_pipeline.py : python pipeline/exporter_web.py
import io
import json
import shutil
import zipfile
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import requests
import shapely

from agreger_tuile import COLONNES_PERTE, PREMIERE_ANNEE, NB_ANNEES
from lancer_pipeline import VERSION, DOSSIER_H3

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_PAYS = RACINE / "data" / "natural_earth"
SORTIE = RACINE / "web" / "public" / "data"
URL_PAYS = "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"
FORET_MIN_HA = {2: 10, 3: 10, 4: 10, 5: 10, 6: 5}  # en dessous, le pourcentage perdu ne veut rien dire
COLONNES = ["foret_2000"] + COLONNES_PERTE


def charger_hexagones():
    fichiers = sorted(DOSSIER_H3.glob("*.csv.gz"))
    df = pd.concat([pd.read_csv(f) for f in fichiers], ignore_index=True)
    df = df.groupby("h3", as_index=False).sum()
    print(f"{len(fichiers)} tuiles, {len(df)} hexagones de resolution 6")
    return df, len(fichiers)


def charger_pays():
    shp = DOSSIER_PAYS / "ne_50m_admin_0_countries.shp"
    if not shp.exists():
        DOSSIER_PAYS.mkdir(parents=True, exist_ok=True)
        r = requests.get(URL_PAYS, timeout=120)
        r.raise_for_status()
        zipfile.ZipFile(io.BytesIO(r.content)).extractall(DOSSIER_PAYS)
    pays = gpd.read_file(shp)[["ADM0_A3", "NAME_FR", "NAME", "geometry"]]
    pays["nom"] = pays.NAME_FR.fillna(pays.NAME)
    return pays[["ADM0_A3", "nom", "geometry"]].rename(columns={"ADM0_A3": "code"})


def rattacher_pays(df, pays):
    points = gpd.GeoDataFrame(geometry=gpd.points_from_xy(df.lon, df.lat), crs="EPSG:4326")
    dedans = gpd.sjoin(points, pays, how="left", predicate="within")
    dedans = dedans[~dedans.index.duplicated()]
    code = dedans.code.copy()
    manquants = code.isna()
    if manquants.any():
        # centre dans la mer ou un lac : pays le plus proche (distance en degres, suffisant ici)
        proches = gpd.sjoin_nearest(points[manquants], pays, how="left")
        proches = proches[~proches.index.duplicated()]
        code[manquants] = proches.code
    return code.values


def niveau_parent(enfants, resolution):
    # additionne les enfants ; le pays est celui de l'enfant qui a le plus de foret
    parent = [h3.cell_to_parent(c, resolution) for c in enfants.h3]
    enfants = enfants.assign(parent=parent)
    sommes = enfants.groupby("parent")[COLONNES].sum()
    pays = enfants.sort_values("foret_2000").groupby("parent").pays.last()
    return sommes.assign(pays=pays).reset_index().rename(columns={"parent": "h3"})


def en_lignes(df):
    # format compact : [h3, code pays, foret 2000 (ha), [pertes 2001..2025 (ha)]]
    foret = df.foret_2000.round().astype(int).tolist()
    pertes = df[COLONNES_PERTE].round().astype(int).values.tolist()
    return [[h, p, f, l] for h, p, f, l in zip(df.h3, df.pays, foret, pertes)]


def ecrire_json(chemin, contenu):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(contenu, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def main():
    SORTIE.mkdir(parents=True, exist_ok=True)
    res6, nb_tuiles = charger_hexagones()
    latlng = np.array([h3.cell_to_latlng(c) for c in res6.h3])
    res6["lat"], res6["lon"] = latlng[:, 0], latlng[:, 1]
    pays = charger_pays()
    res6["pays"] = rattacher_pays(res6, pays)

    niveaux = {6: res6}
    for r in (5, 4, 3, 2):
        niveaux[r] = niveau_parent(niveaux[r + 1], r)

    # anciens fichiers (version planisphere) et anciens paquets
    for nom in ("hex_res3.json", "hex_res4.json", "frontieres.json"):
        (SORTIE / nom).unlink(missing_ok=True)
    for r in (4, 5, 6):
        shutil.rmtree(SORTIE / f"r{r}", ignore_errors=True)

    index = {}
    for r, df in niveaux.items():
        df = df[df.foret_2000 >= FORET_MIN_HA[r]]
        if r <= 3:
            ecrire_json(SORTIE / f"r{r}.json", en_lignes(df))
            print(f"resolution {r} : {len(df)} hexagones")
            continue
        paquet = df.h3.map(lambda c: h3.cell_to_parent(c, r - 4))
        index[r] = []
        for parent, g in df.groupby(paquet):
            ecrire_json(SORTIE / f"r{r}" / f"{parent}.json", en_lignes(g))
            index[r].append(parent)
        taille = sum(f.stat().st_size for f in (SORTIE / f"r{r}").iterdir()) / 1e6
        print(f"resolution {r} : {len(df)} hexagones, {len(index[r])} paquets, {taille:.0f} Mo")
    ecrire_json(SORTIE / "index.json", index)

    # pays : totaux et centre (moyenne des centres d'hexagones ponderee par la foret)
    noms = pays.drop_duplicates("code").set_index("code").nom
    par_pays = []
    for code, g in res6.groupby("pays"):
        poids = g.foret_2000 / g.foret_2000.sum()
        par_pays.append({
            "code": code,
            "nom": noms.get(code, code),
            "foret_2000": round(g.foret_2000.sum()),
            "pertes": g[COLONNES_PERTE].sum().round().astype(int).tolist(),
            "centre": [round(float((g.lon * poids).sum()), 3), round(float((g.lat * poids).sum()), 3)],
        })

    # terres pour le globe : polygones des pays simplifies, coordonnees au centieme de degre
    terres = pays[["geometry"]].copy()
    terres["geometry"] = shapely.set_precision(terres.geometry.simplify(0.03).values, 0.01)
    terres = terres[~terres.geometry.is_empty]
    (SORTIE / "terres.json").write_text(terres.to_json(drop_id=True), encoding="utf-8")

    ecrire_json(SORTIE / "resume.json", {
        "version": VERSION,
        "annees": list(range(PREMIERE_ANNEE, PREMIERE_ANNEE + NB_ANNEES)),
        "foret_2000": round(res6.foret_2000.sum()),
        "pertes": res6[COLONNES_PERTE].sum().round().astype(int).tolist(),
        "nb_tuiles": nb_tuiles,
        "pays": sorted(par_pays, key=lambda p: -sum(p["pertes"])),
    })
    print(f"Foret 2000 (couvert > 30 %) : {res6.foret_2000.sum() / 1e6:.1f} Mha, "
          f"perte 2001-2024 : {res6[COLONNES_PERTE[:-1]].sum().sum() / 1e6:.1f} Mha, "
          f"perte 2001-{PREMIERE_ANNEE + NB_ANNEES - 1} : {res6[COLONNES_PERTE].sum().sum() / 1e6:.1f} Mha")


if __name__ == "__main__":
    main()
