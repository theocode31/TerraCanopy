"""
Telecharge les tuiles Hansen une par une, les agrege en hexagones, puis les supprime.

Toute la planete fait environ 100 Go de tuiles (lossyear + treecover2000), donc on ne
garde jamais plus de deux tuiles sur le disque : celle qu'on traite et la suivante,
qui se telecharge pendant ce temps.

On commence par les tropiques, ou se trouve l'essentiel de la deforestation : si le
calcul s'arrete en route, la carte a deja le plus important.
Le script reprend ou il s'est arrete (les tuiles deja faites sont sautees).

Lancer depuis la racine du projet :
    python pipeline/lancer_pipeline.py
    python pipeline/lancer_pipeline.py 00N_060W 10S_060W   (seulement ces tuiles)
"""
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from agreger_tuile import agreger_tuile, NB_ANNEES

VERSION = "GFC-2025-v1.13"
BASE_URL = f"https://storage.googleapis.com/earthenginepartners-hansen/{VERSION}"
RACINE = Path(__file__).resolve().parent.parent
DOSSIER_TUILES = RACINE / "data" / "tuiles_tmp"
DOSSIER_H3 = RACINE / "data" / "h3_par_tuile"
ESPACE_MIN_GO = 3.0


def lister_tuiles() -> list[str]:
    """Les tuiles qui ont une couche lossyear (279 sur 504 : le reste est de l'ocean)."""
    r = requests.get(f"{BASE_URL}/lossyear.txt", timeout=60)
    r.raise_for_status()
    tuiles = [ligne.strip().rsplit("_lossyear_", 1)[1].removesuffix(".tif")
              for ligne in r.text.splitlines() if ligne.strip()]
    # "10S_060W" : coin en haut a gauche a 10 degres sud, le centre est 5 degres plus bas
    def latitude_centre(tuile):
        lat = int(tuile[:2]) * (1 if tuile[2] == "N" else -1)
        return abs(lat - 5)
    return sorted(tuiles, key=latitude_centre)


def url_couche(couche: str, tuile: str) -> str:
    return f"{BASE_URL}/Hansen_{VERSION}_{couche}_{tuile}.tif"


def telecharger(url: str, chemin: Path, essais: int = 4) -> Path:
    if chemin.exists():
        return chemin
    partiel = chemin.with_suffix(".part")
    for essai in range(1, essais + 1):
        try:
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(partiel, "wb") as f:
                    for bloc in r.iter_content(chunk_size=8 * 1024 * 1024):
                        f.write(bloc)
            partiel.rename(chemin)
            return chemin
        except (requests.RequestException, OSError) as e:
            print(f"  echec du telechargement ({essai}/{essais}) : {e}", flush=True)
            time.sleep(10 * essai)
    raise RuntimeError(f"impossible de telecharger {url}")


def telecharger_tuile(tuile: str) -> tuple[Path, Path]:
    perte = telecharger(url_couche("lossyear", tuile), DOSSIER_TUILES / f"lossyear_{tuile}.tif")
    couvert = telecharger(url_couche("treecover2000", tuile), DOSSIER_TUILES / f"treecover2000_{tuile}.tif")
    return perte, couvert


def espace_libre_go() -> float:
    return shutil.disk_usage(RACINE).free / 1e9


def main() -> None:
    DOSSIER_TUILES.mkdir(parents=True, exist_ok=True)
    DOSSIER_H3.mkdir(parents=True, exist_ok=True)
    tuiles = sys.argv[1:] or lister_tuiles()
    a_faire = [t for t in tuiles if not (DOSSIER_H3 / f"{t}.csv").exists()]
    print(f"{len(tuiles)} tuiles, {len(tuiles) - len(a_faire)} deja faites, {len(a_faire)} a faire", flush=True)

    echecs = []
    debut_total = time.time()
    with ThreadPoolExecutor(max_workers=1) as pool:
        suivante = pool.submit(telecharger_tuile, a_faire[0]) if a_faire else None
        for i, tuile in enumerate(a_faire):
            if espace_libre_go() < ESPACE_MIN_GO:
                print(f"Arret : moins de {ESPACE_MIN_GO} Go libres sur le disque.", flush=True)
                break
            try:
                perte, couvert = suivante.result()
            except Exception as e:
                echecs.append(tuile)
                print(f"{tuile} : {e}", flush=True)
                perte = couvert = None
            # la tuile d'apres se telecharge pendant qu'on calcule celle-ci
            suivante = pool.submit(telecharger_tuile, a_faire[i + 1]) if i + 1 < len(a_faire) else None
            if perte is None:
                continue

            debut = time.time()
            try:
                df, max_annee = agreger_tuile(perte, couvert)
                if max_annee > NB_ANNEES:
                    print(f"  attention : lossyear monte a {max_annee} dans {tuile}", flush=True)
                df.to_csv(DOSSIER_H3 / f"{tuile}.csv", index=False)
                print(f"[{i + 1}/{len(a_faire)}] {tuile} : {len(df)} hexagones, "
                      f"foret 2000 = {df.foret_2000.sum() / 1e6:.2f} Mha, {time.time() - debut:.0f} s "
                      f"(total {(time.time() - debut_total) / 60:.0f} min, {espace_libre_go():.1f} Go libres)", flush=True)
            except Exception as e:
                echecs.append(tuile)
                print(f"{tuile} : erreur de calcul : {e}", flush=True)
            finally:
                perte.unlink(missing_ok=True)
                couvert.unlink(missing_ok=True)

    print(f"Termine. {len(echecs)} tuile(s) en echec : {', '.join(echecs) or 'aucune'}", flush=True)


if __name__ == "__main__":
    main()
