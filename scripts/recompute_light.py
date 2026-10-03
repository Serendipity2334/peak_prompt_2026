#!/usr/bin/env python3
"""Ricalcola light/shadow.

luce  = bianco / rosso / grigio chiaro
ombra = blu / nero / grigio scuro

Il blu conta sempre come ombra, anche se è luminoso.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DARK = 0.42  # nero / grigio scuro → ombra
LIGHT = 0.58  # bianco / grigio chiaro → luce (se non blu)


def load_rgb(path: Path, max_side: int = 720) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    scale = min(1.0, max_side / max(w, h))
    if scale < 1:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32) / 255.0


def load_mask_ink(path: Path, shape: tuple[int, int], kind: str) -> np.ndarray:
    if not path.is_file():
        return np.zeros(shape, dtype=bool)
    im = Image.open(path).convert("RGBA")
    im = im.resize((shape[1], shape[0]), Image.NEAREST)
    a = np.asarray(im, dtype=np.float32) / 255.0
    r, g, b, alpha = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    if kind == "red":
        return (r > 0.35) & (r > g + 0.08) & (r > b + 0.08) & (alpha > 0.1)
    return (b > 0.35) & (b > r + 0.08) & (b > g + 0.05) & (alpha > 0.1)


def classify_rgb(arr: np.ndarray, red_ink=None, blue_ink=None) -> dict:
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)

    is_blue = (b > r + 0.06) & (b > g + 0.04) & (b > 0.12) & (sat > 0.04)
    is_red = (r > g + 0.06) & (r > b + 0.06) & (r > 0.12) & (sat > 0.04)
    is_dark = luma < DARK  # nero / grigio scuro
    is_bright = luma >= LIGHT  # bianco / grigio chiaro

    # mid grigio: sotto 0.5 → ombra, sopra → luce
    mid = ~is_dark & ~is_bright & ~is_blue & ~is_red
    light = (is_bright & ~is_blue) | is_red | (mid & (luma >= 0.5))
    shadow = is_dark | is_blue | (mid & (luma < 0.5))

    # priorità: blu = ombra, rosso = luce
    light = light & ~is_blue
    shadow = shadow | is_blue
    light = light | is_red
    shadow = shadow & ~is_red

    if red_ink is not None:
        light = light | red_ink
        shadow = shadow & ~red_ink
    if blue_ink is not None:
        shadow = shadow | blue_ink
        light = light & ~blue_ink
    if red_ink is not None and blue_ink is not None:
        both = red_ink & blue_ink
        light = light | both
        shadow = shadow & ~both

    # niente overlap
    conflict = light & shadow
    light = light & ~conflict
    shadow = shadow | conflict

    n = max(int(luma.size), 1)
    light_f = float(light.sum() / n)
    shadow_f = float(shadow.sum() / n)
    # residui mid non classificati → ombra (toni scuri/ambigui)
    leftover = 1.0 - light_f - shadow_f
    if leftover > 0:
        shadow_f += leftover
    s = light_f + shadow_f
    if s > 0:
        light_f, shadow_f = light_f / s, shadow_f / s

    # soglie B/N che riproducono le frazioni
    flat = np.sort(luma.ravel())
    thr_low = float(flat[min(len(flat) - 1, int(shadow_f * len(flat)))]) if shadow_f > 0 else 0.0
    thr_high = float(flat[max(0, int((1.0 - light_f) * len(flat) - 1))]) if light_f > 0 else 1.0
    if thr_high < thr_low:
        thr_high = thr_low

    return {
        "luma": round(float(luma.mean()), 4),
        "light": round(light_f, 4),
        "shadow": round(shadow_f, 4),
        "neutral": 0.0,
        "thrLow": round(thr_low, 4),
        "thrHigh": round(thr_high, 4),
    }


def update_photos() -> int:
    path = ROOT / "assets/data/percorso.json"
    data = json.loads(path.read_text())
    photos = data["photos"]
    for ph in photos:
        # colore originale: cattura blu/rosso della scena
        rgb = load_rgb(ROOT / ph["image"])
        stem = Path(ph["image"]).stem
        red = load_mask_ink(
            ROOT / f"assets/images/livelli_rosso_blu/{stem}_rosso.png", rgb.shape[:2], "red"
        )
        blue = load_mask_ink(
            ROOT / f"assets/images/livelli_rosso_blu/{stem}_blu.png", rgb.shape[:2], "blue"
        )
        st = classify_rgb(rgb, red, blue)
        ph.update(
            {
                "luma": st["luma"],
                "light": st["light"],
                "shadow": st["shadow"],
                "neutral": st["neutral"],
                "thrLow": st["thrLow"],
                "thrHigh": st["thrHigh"],
            }
        )
    ranked = sorted(photos, key=lambda p: (p["light"], p["luma"], p["id"]))
    for i, p in enumerate(ranked, start=1):
        p["lightRank"] = i
    data["route"]["notes"] = (
        "Track da Wikiloc (GPX), tagliata alle 16:40. Quote lisciate (media mobile). "
        "In galleria il GPS è meno preciso. Orari 27 e 28 stimati. "
        "light/shadow: luce = bianco/rosso/grigio chiaro; "
        "ombra = blu/nero/grigio scuro (blu sempre ombra, anche se luminoso). "
        "lightRank: da più buia (1) a più luminosa (30), per light."
    )
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")

    assets_data = ROOT / "assets-data.json"
    if assets_data.is_file():
        ad = json.loads(assets_data.read_text())
        for m in ad.get("photos", []):
            stem = Path(m["src"]).stem if m.get("src") else None
            match = next((p for p in photos if Path(p["image"]).stem == stem), None)
            if not match:
                continue
            m["luma"] = match["luma"]
            m["light"] = match["light"]
            m["shadow"] = match["shadow"]
            m["neutral"] = match["neutral"]
        assets_data.write_text(json.dumps(ad, indent=2) + "\n")
    return len(photos)


def update_videos() -> int:
    manifest_path = ROOT / ".cache/videos/manifest.json"
    if not manifest_path.is_file():
        return 0
    manifest = json.loads(manifest_path.read_text())
    for v in manifest:
        tpath = ROOT / ".cache/thumbs" / Path(v["thumb"]).name
        if not tpath.is_file():
            continue
        st = classify_rgb(load_rgb(tpath))
        v["light"] = st["light"]
        v["shadow"] = st["shadow"]
        v["neutral"] = st["neutral"]
        v["luma"] = st["luma"]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return len(manifest)


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else "all"
    if mode in ("all", "photos"):
        print(f"photos: {update_photos()}")
    if mode in ("all", "videos"):
        print(f"videos: {update_videos()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
