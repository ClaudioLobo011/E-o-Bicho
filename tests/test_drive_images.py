import types
import unittest

import drive_images as di


class FakeDrive:
    def __init__(self, pages):
        self._pages = pages
        self.calls = []

    def files(self):
        return self

    def list(self, **kwargs):
        self.calls.append(kwargs)
        token = kwargs.get("pageToken")
        if token is None:
            page = self._pages[0]
        else:
            page = self._pages[token]
        return FakeExecute(page)


class FakeExecute:
    def __init__(self, response):
        self._response = response

    def execute(self):
        return self._response


class FakeCollection:
    def __init__(self):
        self._docs = {}
        self._updates = {}

    def find_one(self, query, projection):
        for value in query["$or"]:
            key, expected = next(iter(value.items()))
            for doc in self._docs.values():
                if doc.get(key) == expected:
                    return {"_id": doc["_id"], "nome": doc.get("nome")}
        return None

    def update_one(self, flt, payload):
        identifier = flt.get("_id")
        if identifier in self._docs:
            self._updates[identifier] = payload
            return types.SimpleNamespace(matched_count=1)
        return types.SimpleNamespace(matched_count=0)

    def insert(self, _id, nome, **extra):
        self._docs[_id] = {"_id": _id, "nome": nome, **extra}


class FakeDB:
    def __init__(self, collection):
        self.collection = collection

    def get_collection(self, name):
        return self.collection


class DriveImagesTestCase(unittest.TestCase):
    def setUp(self):
        di.clear_folder_cache()

    def test_resolve_folder_uses_cache(self):
        drive = FakeDrive([
            {
                "files": [
                    {"id": "folder-123", "name": "789"},
                ],
                "nextPageToken": None,
            }
        ])

        folder_id_first = di.resolve_ean_folder_id(drive, "789", "parent")
        folder_id_second = di.resolve_ean_folder_id(drive, "789", "parent")

        self.assertEqual(folder_id_first, "folder-123")
        self.assertEqual(folder_id_second, "folder-123")
        self.assertEqual(len(drive.calls), 1)

    def test_list_images_handles_shortcuts_and_pagination(self):
        drive = FakeDrive(
            [
                {
                    "files": [
                        {
                            "id": "1",
                            "name": "IMG_A.JPG",
                            "mimeType": "image/jpeg",
                        },
                        {
                            "id": "2",
                            "name": "atalho",
                            "mimeType": "application/vnd.google-apps.shortcut",
                            "shortcutDetails": {
                                "targetId": "real-5",
                                "targetMimeType": "image/webp",
                            },
                        },
                    ],
                    "nextPageToken": 1,
                },
                {
                    "files": [
                        {
                            "id": "3",
                            "name": "ignored",
                            "mimeType": "application/pdf",
                        },
                        {
                            "id": "4",
                            "name": "IMG_B.HEIC",
                            "mimeType": "image/heic",
                        },
                    ],
                    "nextPageToken": None,
                },
            ]
        )

        items = di.list_images_in_folder(drive, "folder-123")
        ids = [item["id"] for item in items]

        self.assertEqual(ids, ["real-5", "1", "4"])

    def test_process_ean_images_links_in_collection(self):
        collection = FakeCollection()
        collection.insert("abc123", "Produto Teste", codbarras="789")
        db = FakeDB(collection)

        drive = FakeDrive(
            [
                {
                    "files": [
                        {"id": "img1", "name": "IMG1.JPG", "mimeType": "image/jpeg"},
                        {"id": "img2", "name": "IMG2.JPG", "mimeType": "image/jpeg"},
                    ],
                    "nextPageToken": None,
                }
            ]
        )

        success = di.process_ean_images(drive, db, "789")

        self.assertTrue(success)
        self.assertIn("abc123", collection._updates)
        payload = collection._updates["abc123"]["$set"][di.DRIVE_IMAGES_FIELD]
        self.assertEqual(
            payload,
            [
                {"sequence": "789-1", "fileId": "img1"},
                {"sequence": "789-2", "fileId": "img2"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
