from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

from ..tools.invoice_extract import parse_invoice_text, parse_number

SAMPLE_TEXT = """FACTURA FISCALA
Seria VTD nr. 004512   Data emiterii: 03.11.2026
Furnizor: VET DISTRIBUTIE SRL        Cumparator: CLINICA VETORA SRL
CIF: RO12345678
Nr. Denumire produs UM Cant. Pret unitar Valoare TVA
1 Bravecto 500mg caine 10-20kg buc 10 85,50 855,00 21% 179,55
2 Seringa 5ml set 100 0,45 45,00 21% 9,45
3. AMX-2231 Amoxicilina 250 mg fl 3 1.250,00 3.750,00 9 337,50
Total 4.650,00
"""

# Layout of the distributor invoices (name above the numeric row, lot/expiry, discount rows).
CITYVET_TEXT = """CITYVET PET & FARM SRL                                   Seria/Nr :             CTVETF 6039
FACTURA FISCALA
C.I.F.:  RO30340950
Sediul:  Strada Porii 148                                 Cumparator:       CERI IMPEX SRL
                                                          C.I.F.:      RO9103140
     Numar document            Cota TVA         Data(zz-ll-aaaa)               Valoare
      CTVETF 6039                Taxabil           03-11-2026                  943,50
Nr.       Denumirea produselor sau a serviciilor            UM           Cantitate       Pret unitar       Valoare           Valoare
crt.                                                                                     (fara TVA)                            TVA
          GOSBI ORIGINAL DOG ADULT 12kg
1                                          Lot:2603077 Exp:              BUC              3,00           174,00           522,00            57,42
          30.09.2027, Cod HS: 230910
2         Discount 25%                                                   BUC             -3,00            43,50           -130,50           -14,36
          GOSBI ORIGINAL DOG BABY 12Kg
3                                          Lot:2602159 Exp:              BUC              3,00           184,00           552,00            60,72
          31.08.2027Lot:2602159 Exp: 31.08.2027, Cod HS: 230910
4         Discount 25%                                                   BUC             -3,00            46,00           -138,00           -15,18
           Total discount:-268,50                                                Total Cota TVA11%                      805,50            88,61
"""


class TestInvoiceParser(TransactionCase):
    def test_parse_number(self):
        self.assertEqual(parse_number("1.234,56"), 1234.56)
        self.assertEqual(parse_number("1,234.56"), 1234.56)
        self.assertEqual(parse_number("0,45"), 0.45)
        self.assertIsNone(parse_number("abc"))

    def test_parse_invoice_text(self):
        res = parse_invoice_text(SAMPLE_TEXT)
        self.assertEqual(res["invoice_number"], "VTD 004512")
        self.assertEqual(res["invoice_date"], "2026-11-03")
        self.assertEqual(res["supplier_name"], "VET DISTRIBUTIE SRL")
        self.assertEqual(res["supplier_vat"], "RO12345678")
        self.assertEqual(len(res["lines"]), 3)
        first = res["lines"][0]
        self.assertEqual(first["product_name"], "Bravecto 500mg caine 10-20kg")
        self.assertEqual((first["quantity"], first["price_unit"], first["vat_rate"]), (10.0, 85.5, 21.0))
        self.assertEqual(res["lines"][2]["product_code"], "AMX-2231")

    def test_parse_distributor_layout(self):
        res = parse_invoice_text(CITYVET_TEXT)
        self.assertEqual(res["invoice_number"], "CTVETF 6039")
        self.assertEqual(res["invoice_date"], "2026-11-03")
        self.assertEqual(res["supplier_name"], "CITYVET PET & FARM SRL")
        self.assertEqual(res["supplier_vat"], "RO30340950")
        self.assertEqual(res["customer_name"], "CERI IMPEX SRL")
        self.assertEqual(res["customer_vat"], "RO9103140")
        self.assertEqual(len(res["lines"]), 2, "discount rows must be merged, not added as lines")
        first, second = res["lines"]
        self.assertEqual(first["product_name"], "GOSBI ORIGINAL DOG ADULT 12kg")
        self.assertEqual((first["quantity"], first["price_unit"], first["discount_amount"]), (3.0, 174.0, 130.5))
        self.assertEqual((first["lot_number"], first["expiry_date"], first["vat_rate"]), ("2603077", "2027-09-30", 11.0))
        self.assertEqual(second["product_name"], "GOSBI ORIGINAL DOG BABY 12Kg")
        self.assertEqual(second["expiry_date"], "2027-08-31")


class TestSupplierInvoice(TransactionCase):
    def _make_invoice(self, number="F1", lines=None):
        return self.env["vet.supplier.invoice"].create({
            "name": number,
            "supplier_name": "VET DISTRIBUTIE SRL",
            "invoice_date": "2026-11-03",
            "line_ids": [(0, 0, vals) for vals in (lines or [
                {"product_name": "Seringa 5ml", "quantity": 100, "price_unit": 0.45},
            ])],
        })

    def test_amount_and_key(self):
        inv = self._make_invoice(lines=[
            {"product_name": "Seringă  5ml", "quantity": 2, "price_unit": 1.5},
            {"product_code": "amx-2231", "product_name": "Amoxicilina", "quantity": 1, "price_unit": 10},
        ])
        self.assertAlmostEqual(inv.amount_untaxed, 13.0)
        self.assertEqual(inv.line_ids[0].product_key, "name:seringa 5ml")
        self.assertEqual(inv.line_ids[1].product_key, "code:amx 2231")

    def test_confirm_workflow(self):
        inv = self._make_invoice()
        inv.action_confirm()
        self.assertEqual(inv.state, "confirmed")
        with self.assertRaises(ValidationError):
            inv.unlink()
        dup = self._make_invoice()
        with self.assertRaises(ValidationError):
            dup.action_confirm()

    def test_discount_reduces_value_not_quantity(self):
        inv = self._make_invoice(lines=[
            {"product_name": "Gosbi Lamb", "quantity": 3, "price_unit": 190, "discount_amount": 142.5},
        ])
        self.assertAlmostEqual(inv.line_ids.amount, 427.5)
        self.assertAlmostEqual(inv.line_ids.quantity, 3)

    def test_catalog_matching(self):
        Catalog = self.env["vet.goods.product"]
        exact = Catalog.create({"name": "GOSBI ORIGINAL DOG BABY 12Kg ", "internal_code": "GOS6", "producer": "GOSBI PETFOOD SA"})
        Catalog.create({"name": "Gosbi Exclusive Lamb Mini 7kg", "internal_code": "GOS78", "producer": "GOSBI PETFOOD SA"})
        inv = self._make_invoice(lines=[
            {"product_name": "Gosbi Original Dog Baby 12kg", "quantity": 1, "price_unit": 1},
            {"product_name": "Gosbi Exclusive Lamb Mini 7 kg", "quantity": 1, "price_unit": 1},
            {"product_name": "Something else", "quantity": 1, "price_unit": 1},
            {"product_code": "gos6", "product_name": "Other name", "quantity": 1, "price_unit": 1},
        ])
        inv.line_ids.action_match_catalog()
        l1, l2, l3, l4 = inv.line_ids
        self.assertEqual(l1.catalog_id, exact)
        self.assertEqual(l2.catalog_id.internal_code, "GOS78")
        self.assertFalse(l3.catalog_id)
        self.assertEqual(l4.catalog_id, exact)
        self.assertEqual(l1.producer, "GOSBI PETFOOD SA")

    def test_catalog_import_xlsx(self):
        import io

        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["06.10.2026"])
        ws.append(["CATEGORIE", "Cod INTERN", "COD EAN", "Denumire", "Pret", "TVA", "Pret cu TVA", "COD VAMAL"])
        ws.append(["GOSBI PETFOOD SA", "GOS4", "8436566800372", "GOSBI ORIGINAL DOG ADULT 12kg", 174, "11%", 193.14, "23091090"])
        ws.append(["KORMOTECH ", "KOR108", 4820215360000, "KITTIX ADULT CATS with beef - Bax 24X 85G", 30, "11%", 33.3, "23091090"])
        ws.append([None, None, None, None, None, None, None, None])
        buf = io.BytesIO()
        wb.save(buf)
        Catalog = self.env["vet.goods.product"]
        res = Catalog.import_xlsx(buf.getvalue())
        self.assertEqual((res["created"], res["updated"]), (2, 0))
        gos = Catalog.search([("internal_code", "=", "GOS4")])
        self.assertEqual((gos.producer, gos.price, gos.vat_rate, gos.ean), ("GOSBI PETFOOD SA", 174.0, 11.0, "8436566800372"))
        self.assertEqual(Catalog.search([("internal_code", "=", "KOR108")]).producer, "KORMOTECH")
        res = Catalog.import_xlsx(buf.getvalue())
        self.assertEqual((res["created"], res["updated"]), (0, 2))

    def test_confirm_requires_lines(self):
        inv = self._make_invoice()
        inv.line_ids.unlink()
        with self.assertRaises(ValidationError):
            inv.action_confirm()
