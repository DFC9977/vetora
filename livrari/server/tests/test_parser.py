from app.invoice_extract import parse_invoice_text, parse_number

CITYVET_TEXT = """CITYVET PET & FARM SRL                                   Seria/Nr :             CTVETF 6039
FACTURA FISCALA
C.I.F.:  RO30340950
Sediul:  Strada Porii 148                                 Cumparator:       CERI IMPEX SRL
                                                          C.I.F.:      RO9103140
                                                          Livrare:     Str. Exemplu, Nr. 1, Jud. Satu Mare,
IBAN RON:      RO81BACX0000002111112000                   Telefon:     0740000000
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
Telefon:  0766063646    , Web:   www.ctvet.ro
"""

SIMPLE_TEXT = """FACTURA FISCALA
Seria VTD nr. 004512   Data emiterii: 03.11.2026
Furnizor: VET DISTRIBUTIE SRL        Cumparator: CLINICA TEST SRL
CIF: RO12345678
1 Bravecto 500mg caine 10-20kg buc 10 85,50 855,00 21% 179,55
2 Seringa 5ml set 100 0,45 45,00 21% 9,45
3. AMX-2231 Amoxicilina 250 mg fl 3 1.250,00 3.750,00 9 337,50
Total 4.650,00
"""


def test_parse_number():
    assert parse_number("1.234,56") == 1234.56
    assert parse_number("1,234.56") == 1234.56
    assert parse_number("0,45") == 0.45
    assert parse_number("-3,00") == -3.0
    assert parse_number("abc") is None


def test_distributor_layout():
    r = parse_invoice_text(CITYVET_TEXT)
    assert r["invoice_number"] == "CTVETF 6039"
    assert r["invoice_date"] == "2026-11-03"
    assert r["supplier_name"] == "CITYVET PET & FARM SRL"
    assert r["supplier_vat"] == "RO30340950"
    assert r["customer_name"] == "CERI IMPEX SRL"
    assert r["customer_vat"] == "RO9103140"
    assert r["delivery_address"] == "Str. Exemplu, Nr. 1, Jud. Satu Mare"
    assert r["customer_phone"] == "0740000000"
    assert len(r["lines"]) == 2  # discount rows merged
    a, b = r["lines"]
    assert (a["product_name"], a["quantity"], a["price_unit"], a["discount_amount"]) == (
        "GOSBI ORIGINAL DOG ADULT 12kg", 3.0, 174.0, 130.5)
    assert (a["lot_number"], a["expiry_date"], a["vat_rate"], a["uom"]) == ("2603077", "2027-09-30", 11.0, "BUC")
    assert (b["product_name"], b["expiry_date"]) == ("GOSBI ORIGINAL DOG BABY 12Kg", "2027-08-31")


def test_simple_layout():
    r = parse_invoice_text(SIMPLE_TEXT)
    assert (r["invoice_number"], r["supplier_name"], r["customer_name"]) == (
        "VTD 004512", "VET DISTRIBUTIE SRL", "CLINICA TEST SRL")
    names = [(ln["product_name"], ln["quantity"], ln["vat_rate"]) for ln in r["lines"]]
    assert names == [("Bravecto 500mg caine 10-20kg", 10.0, 21.0), ("Seringa 5ml", 100.0, 21.0), ("Amoxicilina 250 mg", 3.0, 9.0)]
    assert r["lines"][2]["product_code"] == "AMX-2231"
