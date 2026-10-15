"""Local document OCR. No catalog lookup, correction, stock change or network access.

Install the pinned requirements in ../.receiving-ocr-local and run --prepare once.
The request path only uses preinstalled models. stdout is exactly one JSON object.
"""
import argparse
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import statistics
import sys
import time


MODEL_NAMES = (
    "PP-OCRv6_det_small.onnx",
    "PP-OCRv6_rec_small.onnx",
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
)
DEFAULT_MODEL_DIR = Path(__file__).resolve().parent.parent / ".receiving-ocr-local" / "models"
PRODUCT_START = re.compile(
    r"^\s*(?:\d{1,4}\s+)?\d+(?:[.,]\d+)?\s+(?:UN|UM|UND|CX|PC|PÇ|PCT|KT|KIT|KG|FD|SC|LT)\b\s*\S{3,}",
    re.IGNORECASE,
)


def prepare_models(model_dir):
    import rapidocr
    source = Path(rapidocr.__file__).resolve().parent / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name in MODEL_NAMES:
        original = source / name
        if not original.is_file():
            raise RuntimeError("O pacote local não contém os modelos de OCR necessários.")
        target = model_dir / name
        shutil.copyfile(original, target)
        hashes[name] = hashlib.sha256(target.read_bytes()).hexdigest()
    (model_dir / "manifest.json").write_text(
        json.dumps({"rapidocr": "3.10.0", "sha256": hashes}, indent=2), encoding="utf-8"
    )
    return {"ready": True, "provider": "rapidocr-local-v6", "models": hashes}


def group_text_rows(boxes, texts, scores):
    """Preserve recognized text; deskew local baselines before joining table cells.

    Simply sorting by y joins prices to the next product on a curved photograph.
    Wide neighboring text boxes estimate the local slope without assuming any
    supplier template, column positions or page size.
    """
    blocks = []
    for box, text, score in zip(boxes, texts, scores):
        if not text or len(blocks) >= 2000:
            continue
        x = sum(float(point[0]) for point in box) / 4
        y = sum(float(point[1]) for point in box) / 4
        width = max(float(point[0]) for point in box) - min(float(point[0]) for point in box)
        height = math.dist(box[0], box[3])
        slope = ((box[1][1] - box[0][1]) + (box[2][1] - box[3][1])) / max(
            1, (box[1][0] - box[0][0]) + (box[2][0] - box[3][0])
        )
        blocks.append({"x": x, "y": y, "h": height, "w": width,
                       "a": float(slope), "t": str(text), "s": float(score)})
    if not blocks:
        return []
    median_height = statistics.median(block["h"] for block in blocks)
    x_reference = statistics.median(block["x"] for block in blocks)
    for block in blocks:
        neighbors = [other for other in blocks
                     if abs(other["y"] - block["y"]) < median_height * 7
                     and other["w"] > median_height * 10]
        slope = statistics.median(other["a"] for other in neighbors) if neighbors else 0
        block["v"] = block["y"] - slope * (block["x"] - x_reference)
    rows = []
    for block in sorted(blocks, key=lambda item: item["v"]):
        match, distance = None, float("inf")
        for row in rows:
            delta = abs(statistics.median(other["v"] for other in row) - block["v"])
            tolerance = min(block["h"], statistics.median(other["h"] for other in row)) * 0.55
            if (delta < tolerance and delta < distance
                    and not any(abs(other["x"] - block["x"]) < median_height * 0.4 for other in row)):
                match, distance = row, delta
        if match is None:
            rows.append([block])
        else:
            match.append(block)
    rows.sort(key=lambda row: statistics.mean(block["v"] for block in row))
    return [{"text": " ".join(block["t"] for block in sorted(row, key=lambda item: item["x"])),
             "confidence": round(statistics.mean(block["s"] for block in row) * 100, 2)}
            for row in rows]


def extract(image_path, model_dir):
    # Imports stay lazy so --help and the pure grouping function work without OCR packages.
    import cv2
    import numpy as np
    from PIL import Image, ImageOps
    from rapidocr import RapidOCR
    from rapidocr.utils.download_file import DownloadFile

    for name in MODEL_NAMES:
        if not (model_dir / name).is_file():
            raise RuntimeError("Modelos de OCR não preparados. Execute receiving-ocr.py --prepare na instalação.")

    def no_download(*_args, **_kwargs):
        raise RuntimeError("Download de modelos desativado durante a leitura. Refaça a preparação local.")

    DownloadFile.run = no_download
    cv2.setNumThreads(2)
    with Image.open(image_path) as opened:
        if opened.width * opened.height > 40000000:
            raise ValueError("A imagem excede o limite de 40 megapixels.")
        oriented = ImageOps.exif_transpose(opened).convert("RGB")
        oriented.thumbnail((2600, 2600))
        source = cv2.cvtColor(np.asarray(oriented), cv2.COLOR_RGB2BGR)
    engine = RapidOCR(params={
        "Global.text_score": 0.3,
        "Global.max_side_len": 2800,
        "Global.log_level": "error",
        "Det.limit_side_len": 2400,
        "Det.limit_type": "max",
        "Det.model_path": str(model_dir / MODEL_NAMES[0]),
        "Rec.model_path": str(model_dir / MODEL_NAMES[1]),
        "Cls.model_path": str(model_dir / MODEL_NAMES[2]),
        "EngineConfig.onnxruntime.intra_op_num_threads": 2,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })
    detection = engine(source, use_cls=False, use_rec=False)
    boxes = detection.boxes if detection.boxes is not None else []
    vertical = sum(np.linalg.norm(box[0] - box[3]) > np.linalg.norm(box[0] - box[1]) * 2 for box in boxes)
    horizontal = sum(np.linalg.norm(box[0] - box[1]) > np.linalg.norm(box[0] - box[3]) * 2 for box in boxes)
    angles = [270, 90, 0, 180] if vertical > horizontal else [0, 180, 270, 90]
    best = None
    for angle in angles:
        current = np.ascontiguousarray(np.rot90(source, k=(360 - angle) // 90)) if angle else source
        current = cv2.GaussianBlur(current, (3, 3), 0.6)
        factor = min(2.0, 2800 / max(current.shape[:2]))
        if factor != 1:
            current = cv2.resize(current, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        result = engine(current, use_cls=True, use_rec=True)
        rows = group_text_rows(result.boxes if result.boxes is not None else [],
                               result.txts or [], result.scores or [])
        candidates = sum(bool(PRODUCT_START.match(row["text"])) for row in rows)
        confidence = statistics.mean(row["confidence"] for row in rows) if rows else 0
        rank = (candidates, confidence)
        if best is None or rank > best["rank"]:
            best = {"rank": rank, "rows": rows, "rotation": angle,
                    "confidence": confidence, "candidateRows": candidates}
        if candidates >= 3:
            break
    warnings = ["Leitura automática para rascunho. Confira nomes, códigos, quantidades e valores na foto antes de aplicar.",
                "A confiança do OCR não comprova que os números estejam corretos. Produtos e embalagens precisam de confirmação."]
    if best["candidateRows"] < 3:
        warnings.append("Poucas linhas de produtos foram identificadas. Envie uma foto mais próxima ou complemente a lista manualmente.")
    return {"rawText": "\n".join(row["text"] for row in best["rows"])[:120000],
            "confidence": round(best["confidence"], 2), "rotation": best["rotation"],
            "provider": "rapidocr-local-v6", "candidateRows": best["candidateRows"],
            "requiresReview": True, "warnings": warnings}


def main():
    parser = argparse.ArgumentParser(description="OCR local de romaneios para revisão humana.")
    parser.add_argument("image", nargs="?")
    parser.add_argument("--models", default=os.environ.get("RECEIVING_OCR_MODELS", str(DEFAULT_MODEL_DIR)))
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    model_dir = Path(args.models).resolve()
    started = time.monotonic()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if args.prepare:
                output = prepare_models(model_dir)
            elif args.image:
                output = extract(Path(args.image).resolve(), model_dir)
            else:
                raise ValueError("Informe a imagem ou use --prepare.")
        output["elapsedSeconds"] = round(time.monotonic() - started, 3)
        print(json.dumps(output, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)[:500]}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
