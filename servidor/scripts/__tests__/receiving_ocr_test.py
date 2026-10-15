"""Regression tests for table grouping; no OCR packages or models required."""
import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "receiving-ocr.py"
SPEC = importlib.util.spec_from_file_location("receiving_ocr", SCRIPT)
OCR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OCR)


def box(x, y, width, height=20, slope=-0.04):
    return [[x, y], [x + width, y + width * slope],
            [x + width, y + height + width * slope], [x, y + height]]


class ReceivingOcrGeometryTests(unittest.TestCase):
    def test_slanted_rows_keep_codes_and_prices_with_their_product(self):
        # Right-hand cells overlap the preceding left-hand row in raw y order.
        # A plain y sort silently associates the wrong product, code and price.
        boxes = [box(0, 50, 400), box(600, 26, 80), box(800, 18, 90),
                 box(0, 80, 400), box(600, 56, 80), box(800, 48, 90)]
        texts = ["1 UN PRODUTO A", "11111", "9,90",
                 "2 UN PRODUTO B", "22222", "4,00"]
        rows = OCR.group_text_rows(boxes, texts, [0.9] * len(texts))
        self.assertEqual([row["text"] for row in rows],
                         ["1 UN PRODUTO A 11111 9,90", "2 UN PRODUTO B 22222 4,00"])

    def test_empty_detection_produces_no_invented_rows(self):
        self.assertEqual(OCR.group_text_rows([], [], []), [])

    def test_candidate_detection_accepts_item_quantity_unit(self):
        self.assertIsNotNone(OCR.PRODUCT_START.match("54 1 CX RATOEIRA ADESIVA COLA RATO C/50"))

    def test_document_total_is_not_a_product_candidate(self):
        self.assertIsNone(OCR.PRODUCT_START.match("Valor Total 10.002,81"))


if __name__ == "__main__":
    unittest.main()
