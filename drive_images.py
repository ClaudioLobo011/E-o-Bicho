# -*- coding: utf-8 -*-
"""Integração com a API do Google Drive para vincular imagens de produtos.

Este módulo oferece funções para localizar a pasta de imagens de um produto
no Google Drive (por EAN), listar seus arquivos e persistir o vínculo no banco
utilizando IDs do Drive em vez de caminhos de sistema de arquivos.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple
import logging
import os
from datetime import datetime
from threading import RLock

logger = logging.getLogger(__name__)

# ================== CONFIG ==================
IMAGENS_PARENT_FOLDER_ID = os.getenv("IMAGENS_PARENT_FOLDER_ID", "PASTE_IMAGENS_PARENT_FOLDER_ID_HERE")
PRODUCT_COLLECTION_NAME = os.getenv("PRODUCT_COLLECTION_NAME", "products")
DRIVE_IMAGES_FIELD = os.getenv("PRODUCT_DRIVE_IMAGES_FIELD", "driveImages")
DRIVE_IMAGES_UPDATED_AT_FIELD = os.getenv(
    "PRODUCT_DRIVE_IMAGES_UPDATED_AT_FIELD", f"{DRIVE_IMAGES_FIELD}UpdatedAt"
)
# ============================================

_folder_id_cache: Dict[str, str] = {}
_cache_lock = RLock()


def _drive_list(drive, **kwargs):
    kwargs.setdefault("supportsAllDrives", True)
    kwargs.setdefault("includeItemsFromAllDrives", True)
    kwargs.setdefault("corpora", "allDrives")
    kwargs.setdefault("spaces", "drive")
    kwargs.setdefault("pageSize", 1000)
    resp = drive.files().list(**kwargs).execute()
    return resp.get("files", []), resp.get("nextPageToken")


def _find_folders_by_name_in_parent(drive, parent_id: str, name: str) -> List[dict]:
    escaped_name = name.replace("'", "\\'")
    q = (
        f"'{parent_id}' in parents and trashed=false and "
        f"mimeType='application/vnd.google-apps.folder' and "
        f"name='{escaped_name}'"
    )
    fields = (
        "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, "
        "parents, owners(displayName), driveId)"
    )
    results: List[dict] = []
    page_token: Optional[str] = None
    while True:
        files, page_token = _drive_list(
            drive,
            q=q,
            fields=fields,
            pageToken=page_token,
            orderBy="modifiedTime desc",
        )
        results.extend(files)
        if not page_token:
            break
    return results


def resolve_ean_folder_id(drive, ean: str, parent_id: str = IMAGENS_PARENT_FOLDER_ID) -> Optional[str]:
    if not ean:
        logger.warning("[EAN %s] Código de barras inválido para resolver pasta.", ean)
        return None

    with _cache_lock:
        cached = _folder_id_cache.get(ean)
    if cached:
        return cached

    folders = _find_folders_by_name_in_parent(drive, parent_id, ean)
    if not folders:
        logger.warning("[EAN %s] Pasta não encontrada em parent drive://%s.", ean, parent_id)
        return None

    if len(folders) > 1:
        logger.warning(
            "[EAN %s] %d pastas com o mesmo nome; usando a mais recente (modifiedTime desc).",
            ean,
            len(folders),
        )

    folder_id = folders[0]["id"]
    with _cache_lock:
        _folder_id_cache[ean] = folder_id
    logger.info("[EAN %s] Pasta resolvida: drive://%s", ean, folder_id)
    return folder_id


def list_images_in_folder(drive, folder_id: str) -> List[dict]:
    if not folder_id:
        return []

    q = (
        f"'{folder_id}' in parents and trashed=false and "
        f"(mimeType contains 'image/' or mimeType='application/vnd.google-apps.shortcut')"
    )
    fields = "nextPageToken, files(id, name, mimeType, shortcutDetails(targetId, targetMimeType))"

    seen_ids: Dict[str, dict] = {}
    page_token: Optional[str] = None

    while True:
        files, page_token = _drive_list(
            drive,
            q=q,
            fields=fields,
            pageToken=page_token,
            orderBy="name",
        )
        for entry in files:
            if not isinstance(entry, dict):
                continue
            mime = (entry.get("mimeType") or "").strip()
            name = (entry.get("name") or "").strip()
            if mime == "application/vnd.google-apps.shortcut":
                shortcut = entry.get("shortcutDetails") or {}
                target_id = (shortcut.get("targetId") or "").strip()
                target_mime = (shortcut.get("targetMimeType") or "").strip()
                if target_id and target_mime.lower().startswith("image/"):
                    seen_ids[target_id] = {
                        "id": target_id,
                        "name": name or target_id,
                        "mimeType": target_mime,
                    }
            else:
                if mime.lower().startswith("image/"):
                    file_id = entry.get("id")
                    if not file_id:
                        continue
                    seen_ids[file_id] = {
                        "id": file_id,
                        "name": name or file_id,
                        "mimeType": mime,
                    }
        if not page_token:
            break

    items = list(seen_ids.values())
    items.sort(key=lambda x: (x.get("name") or "").casefold())
    return items


def _generate_sequenced_names(ean: str, n: int) -> List[str]:
    return [f"{ean}-{i}" for i in range(1, n + 1)]


# ====== PONTOS DE INTEGRAÇÃO COM O SEU BD ======

def _get_mongo_collection(db_conn):
    collection = None
    try:
        from pymongo.collection import Collection
        from pymongo.database import Database
    except ImportError:  # pragma: no cover - pymongo pode não estar instalado
        Collection = Database = None  # type: ignore[assignment]

    if Collection and isinstance(db_conn, Collection):
        return db_conn
    if Database and isinstance(db_conn, Database):
        return db_conn.get_collection(PRODUCT_COLLECTION_NAME)

    if hasattr(db_conn, "find_one") and hasattr(db_conn, "update_one"):
        return db_conn
    if hasattr(db_conn, "get_collection"):
        try:
            return db_conn.get_collection(PRODUCT_COLLECTION_NAME)
        except Exception:  # pragma: no cover - depende da integração
            return None
    return None


def _coerce_object_id(value):
    if value is None:
        return None
    try:
        from bson import ObjectId  # type: ignore

        if isinstance(value, ObjectId):  # pragma: no cover - depende da lib externa
            return value
        try:
            return ObjectId(str(value))
        except Exception:
            return value
    except ImportError:  # pragma: no cover - pymongo não instalado
        return value


def find_product_by_ean(db_conn, ean: str) -> Optional[Tuple[str, str]]:
    if not ean:
        return None

    if db_conn is None:
        logger.error("Conexão com o banco não foi fornecida para busca de produto.")
        return None

    if hasattr(db_conn, "find_product_by_ean") and callable(db_conn.find_product_by_ean):
        return db_conn.find_product_by_ean(ean)

    if callable(db_conn):
        return db_conn("find_product_by_ean", ean)

    collection = _get_mongo_collection(db_conn)
    if collection is not None:
        try:
            doc = collection.find_one(
                {"$or": [{"codbarras": ean}, {"ean": ean}]},
                {"_id": 1, "nome": 1},
            )
        except Exception as exc:  # pragma: no cover
            logger.error("Falha ao consultar produto %s no MongoDB: %s", ean, exc)
            return None
        if not doc:
            return None
        product_id = doc.get("_id")
        product_name = doc.get("nome", "")
        return str(product_id), str(product_name or "")

    if isinstance(db_conn, dict):
        entry = db_conn.get(ean)
        if not entry:
            return None
        if isinstance(entry, tuple) and len(entry) >= 2:
            return str(entry[0]), str(entry[1])
        if isinstance(entry, dict):
            return str(entry.get("id")), str(entry.get("nome", ""))
        return str(entry), ""

    logger.error(
        "Nenhuma estratégia compatível para localizar produto pelo EAN foi encontrada."
    )
    return None


def link_images_to_product(db_conn, product_id: int, sequenced: Sequence[Tuple[str, str]]):
    if db_conn is None:
        logger.error("Conexão com o banco não foi fornecida para vincular imagens.")
        return

    if hasattr(db_conn, "link_images_to_product") and callable(db_conn.link_images_to_product):
        db_conn.link_images_to_product(product_id, sequenced)
        return

    if callable(db_conn):
        db_conn("link_images_to_product", product_id, sequenced)
        return

    collection = _get_mongo_collection(db_conn)
    if collection is not None:
        payload = [
            {"sequence": seq, "fileId": file_id}
            for seq, file_id in sequenced
            if seq and file_id
        ]
        try:
            identifier = _coerce_object_id(product_id)
            update = {
                "$set": {
                    DRIVE_IMAGES_FIELD: payload,
                    DRIVE_IMAGES_UPDATED_AT_FIELD: datetime.utcnow(),
                }
            }
            result = collection.update_one({"_id": identifier}, update)
            if not getattr(result, "matched_count", 0):  # pragma: no cover
                logger.warning(
                    "Produto %s não encontrado ao atualizar imagens no MongoDB.", product_id
                )
        except Exception as exc:  # pragma: no cover
            logger.error(
                "Falha ao atualizar imagens do produto %s no MongoDB: %s", product_id, exc
            )
        return

    if isinstance(db_conn, dict):
        db_conn[str(product_id)] = list(sequenced)
        return

    raise RuntimeError(
        "Não foi possível determinar como persistir as imagens no banco de dados."
    )


# ================== ORQUESTRADOR ==================

def process_ean_images(drive, db_conn, ean: str) -> bool:
    prod = find_product_by_ean(db_conn, ean)
    if not prod:
        logger.warning("[EAN %s] Produto não encontrado no BD.", ean)
        return False

    product_id, product_name = prod
    folder_id = resolve_ean_folder_id(drive, ean, IMAGENS_PARENT_FOLDER_ID)
    if not folder_id:
        logger.warning(
            "[EAN %s] Pasta do EAN inexistente no Drive — nada a vincular.",
            ean,
        )
        return False

    files = list_images_in_folder(drive, folder_id)
    if not files:
        logger.info(
            "[EAN %s] Nenhuma imagem encontrada nas pastas esperadas (Compras/C_Produto/Imagens/%s - drive://%s).",
            ean,
            ean,
            folder_id,
        )
        return False

    logger.info(
        "[EAN %s] %d imagem(ns) localizada(s) em Compras/C_Produto/Imagens/%s (drive).",
        ean,
        len(files),
        ean,
    )

    seq_names = _generate_sequenced_names(ean, len(files))
    sequenced = list(zip(seq_names, [f["id"] for f in files]))

    link_images_to_product(db_conn, product_id, sequenced)

    logger.info(
        "[EAN %s] Vinculadas %d imagem(ns) ao produto #%s (%s). Pasta: drive://%s",
        ean,
        len(files),
        product_id,
        product_name,
        folder_id,
    )
    return True


# ================== CACHE OPCIONAL ==================

def warmup_ean_folder_cache(drive, parent_id: str = IMAGENS_PARENT_FOLDER_ID):
    q = (
        f"'{parent_id}' in parents and trashed=false and "
        f"mimeType='application/vnd.google-apps.folder'"
    )
    fields = "nextPageToken, files(id, name, mimeType, modifiedTime)"
    page_token: Optional[str] = None
    total = 0
    while True:
        files, page_token = _drive_list(
            drive,
            q=q,
            fields=fields,
            pageToken=page_token,
            orderBy="name",
        )
        for entry in files:
            name = (entry.get("name") or "").strip()
            folder_id = entry.get("id")
            if not name or not folder_id:
                continue
            with _cache_lock:
                if name not in _folder_id_cache:
                    _folder_id_cache[name] = folder_id
                    total += 1
        if not page_token:
            break
    logger.info("[CACHE] Aquecido com %d pastas (parent drive://%s).", total, parent_id)


def clear_folder_cache():
    with _cache_lock:
        _folder_id_cache.clear()


__all__ = [
    "IMAGENS_PARENT_FOLDER_ID",
    "PRODUCT_COLLECTION_NAME",
    "DRIVE_IMAGES_FIELD",
    "resolve_ean_folder_id",
    "list_images_in_folder",
    "_generate_sequenced_names",
    "find_product_by_ean",
    "link_images_to_product",
    "process_ean_images",
    "warmup_ean_folder_cache",
    "clear_folder_cache",
]
