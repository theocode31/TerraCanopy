import json
from pathlib import Path

import geopandas as gpd

RACINE = Path(__file__).resolve().parent.parent
SHP = RACINE / "data" / "natural_earth" / "ne_50m_admin_0_countries.shp"
SORTIE = RACINE / "web" / "public" / "data" / "noms.json"

NOMS_COURTS = {
    "CHN": "Chine",
    "COD": "RD Congo",
    "COG": "Congo",
    "CAF": "Centrafrique",
}
EXCLUS = {"KAS"}

pays = gpd.read_file(SHP)
lignes = []
for p in pays.itertuples():
    if p.ADM0_A3 in EXCLUS:
        continue
    nom = NOMS_COURTS.get(p.ADM0_A3) or p.NAME_FR or p.NAME
    nom = nom[0].upper() + nom[1:]
    lignes.append([nom, round(p.LABEL_X, 2), round(p.LABEL_Y, 2), float(p.MIN_LABEL)])

lignes.sort(key=lambda l: (l[3], l[0]))
SORTIE.write_text(json.dumps(lignes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(lignes)} noms -> {SORTIE}")
