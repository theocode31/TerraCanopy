"""
Rassemble les CSV de chaque tuile et prepare les fichiers JSON du site.

- un hexagone a cheval sur deux tuiles apparait dans deux CSV : on additionne ;
- resolution 4 pour le zoom, resolution 3 (parents H3) pour la vue du monde ;
- chaque hexagone est rattache au pays qui contient son centre (Natural Earth 1:50m),
  ou au pays le plus proche si le centre tombe dans la mer ;
- les surfaces sont arrondies a l'hectare pour alleger les fichiers.

Lancer depuis la racine du projet, apres lancer_pipeline.py :
    python pipeline/exporter_web.py
"""
import io
import json
import zipfile
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import requests

from agreger_tuile import COLONNES_PERTE, PREMIERE_ANNEE, NB_ANNEES
from lancer_pipeline import VERSION

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_H3 = RACINE / "data" / "h3_par_tuile"
DOSSIER_PAYS = RACINE / "data" / "natural_earth"
SORTIE = RACINE / "web" / "public" / "data"
URL_PAYS = "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"
FORET_MIN_HA = 10  # en dessous, le pourcentage perdu ne veut rien dire


def charger_hexagones() -> pd.DataFrame:
    fichiers = sorted(DOSSIER_H3.glob("*.csv"))
    df = pd.concat([pd.read_csv(f) for f in fichiers], ignore_index=True)
    df = df.groupby("h3", as_index=False).sum()
    print(f"{len(fichiers)} tuiles, {len(df)} hexagones de resolution 4")
    return df[df.foret_2000 >= FORET_MIN_HA].reset_index(drop=True)


def charger_pays() -> gpd.GeoDataFrame:
    shp = DOSSIER_PAYS / "ne_50m_admin_0_countries.shp"
    if not shp.exists():
        DOSSIER_PAYS.mkdir(parents=True, exist_ok=True)
        r = requests.get(URL_PAYS, timeout=120)
        r.raise_for_status()
        zipfile.ZipFile(io.BytesIO(r.content)).extractall(DOSSIER_PAYS)
    pays = gpd.read_file(shp)[["ADM0_A3", "NAME_FR", "NAME", "geometry"]]
    pays["nom"] = pays.NAME_FR.fillna(pays.NAME)
    return pays[["ADM0_A3", "nom", "geometry"]].rename(columns={"ADM0_A3": "code"})


def rattacher_pays(df: pd.DataFrame, pays: gpd.GeoDataFrame) -> pd.Series:
    centres = [h3.cell_to_latlng(c) for c in df.h3]
    points = gpd.GeoDataFrame(
        geometry=gpd.points_from_xy([c[1] for c in centres], [c[0] for c in centres]), crs="EPSG:4326"
    )
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


def en_lignes(df: pd.DataFrame) -> list:
    """Format compact pour le navigateur : [h3, code pays, foret 2000, [pertes 2001..2025]]."""
    foret = df.foret_2000.round().astype(int).tolist()
    pertes = df[COLONNES_PERTE].round().astype(int).values.tolist()
    return [[h, p, f, l] for h, p, f, l in zip(df.h3, df.pays, foret, pertes)]


def ecrire_json(nom: str, contenu) -> None:
    chemin = SORTIE / nom
    chemin.write_text(json.dumps(contenu, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{chemin.name} : {chemin.stat().st_size / 1e6:.1f} Mo")


def main() -> None:
    SORTIE.mkdir(parents=True, exist_ok=True)
    res4 = charger_hexagones()
    pays = charger_pays()
    res4["pays"] = rattacher_pays(res4, pays)

    # resolution 3 : on additionne les enfants, le pays est celui qui a le plus de foret
    res4["parent"] = [h3.cell_to_parent(c, 3) for c in res4.h3]
    colonnes = ["foret_2000"] + COLONNES_PERTE
    res3 = res4.groupby("parent")[colonnes].sum()
    pays_parent = res4.sort_values("foret_2000").groupby("parent").pays.last()
    res3 = res3.assign(pays=pays_parent).reset_index().rename(columns={"parent": "h3"})

    # par pays : totaux et centre (moyenne des centres d'hexagones ponderee par la foret)
    latlng = np.array([h3.cell_to_latlng(c) for c in res4.h3])
    res4["lat"], res4["lon"] = latlng[:, 0], latlng[:, 1]
    noms = pays.drop_duplicates("code").set_index("code").nom
    par_pays = []
    for code, g in res4.groupby("pays"):
        poids = g.foret_2000 / g.foret_2000.sum()
        par_pays.append({
            "code": code,
            "nom": noms.get(code, code),
            "foret_2000": round(g.foret_2000.sum()),
            "pertes": g[COLONNES_PERTE].sum().round().astype(int).tolist(),
            "centre": [round(float((g.lon * poids).sum()), 3), round(float((g.lat * poids).sum()), 3)],
        })

    # frontieres simplifiees pour le site : la carte reste lisible meme sans le fond de carte en ligne
    frontieres = pays[["geometry"]].copy()
    frontieres["geometry"] = frontieres.geometry.boundary.simplify(0.05)
    (SORTIE / "frontieres.json").write_text(frontieres.to_json(drop_id=True), encoding="utf-8")

    ecrire_json("hex_res4.json", en_lignes(res4))
    ecrire_json("hex_res3.json", en_lignes(res3))
    ecrire_json("resume.json", {
        "version": VERSION,
        "annees": list(range(PREMIERE_ANNEE, PREMIERE_ANNEE + NB_ANNEES)),
        "foret_2000": round(res4.foret_2000.sum()),
        "pertes": res4[COLONNES_PERTE].sum().round().astype(int).tolist(),
        "nb_tuiles": len(list(DOSSIER_H3.glob("*.csv"))),
        "pays": sorted(par_pays, key=lambda p: -sum(p["pertes"])),
    })
    print(f"Foret 2000 (couvert > 30 %) : {res4.foret_2000.sum() / 1e6:.0f} Mha, "
          f"perte 2001-{PREMIERE_ANNEE + NB_ANNEES - 1} : {res4[COLONNES_PERTE].sum().sum() / 1e6:.0f} Mha")


if __name__ == "__main__":
    main()
