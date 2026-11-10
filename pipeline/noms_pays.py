# Noms des pays pour la vue en relief du site : un point par pays, la ou Natural Earth place son
# etiquette (LABEL_X, LABEL_Y), avec le zoom a partir duquel Natural Earth conseille de l'ecrire
# (MIN_LABEL) : les grands pays apparaissent d'abord, les petits quand on s'approche.
# Une ligne : [nom, longitude, latitude, zoom minimal].
# Lancer depuis la racine du projet : python pipeline/noms_pays.py
import json
from pathlib import Path

import geopandas as gpd

RACINE = Path(__file__).resolve().parent.parent
SHP = RACINE / "data" / "natural_earth" / "ne_50m_admin_0_countries.shp"  # telecharge par exporter_web.py
SORTIE = RACINE / "web" / "public" / "data" / "noms.json"

# noms officiels trop longs pour une etiquette : on garde le nom courant
NOMS_COURTS = {
    "CHN": "Chine",
    "COD": "RD Congo",
    "COG": "Congo",
    "CAF": "Centrafrique",
}
# le glacier de Siachen est une zone disputee, pas un pays
EXCLUS = {"KAS"}

pays = gpd.read_file(SHP)
lignes = []
for p in pays.itertuples():
    if p.ADM0_A3 in EXCLUS:
        continue
    nom = NOMS_COURTS.get(p.ADM0_A3) or p.NAME_FR or p.NAME
    nom = nom[0].upper() + nom[1:]  # « îles Vierges britanniques » -> « Îles Vierges britanniques »
    lignes.append([nom, round(p.LABEL_X, 2), round(p.LABEL_Y, 2), float(p.MIN_LABEL)])

lignes.sort(key=lambda l: (l[3], l[0]))
SORTIE.write_text(json.dumps(lignes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(lignes)} noms -> {SORTIE}")
