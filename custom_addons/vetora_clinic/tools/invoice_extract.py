"""Extract goods lines from supplier invoices (PDF text or scanned image/PDF).

Pure Python (no Odoo imports) so it can be unit-tested standalone.

Pipeline:
    1. ``extract_text(data, filename)`` -> (text, method)
       - text PDFs: pypdf (already shipped with Odoo)
       - scanned PDFs / images: OCR with pytesseract (optional; only used if
         installed on the server together with the ``tesseract`` binary, and
         pdf2image/poppler for scanned PDFs)
    2. ``parse_invoice_text(text)`` -> dict with header fields and lines.

Line detection is heuristic: a line is accepted as a goods line when it ends
with numbers among which three consecutive values satisfy
``quantity * unit_price ~= value``. Everything extracted is meant to be
reviewed by the user before the invoice is confirmed.
"""

import io
import logging
import re
import unicodedata

_logger = logging.getLogger(__name__)

# Minimum amount of text (chars) to consider a PDF "text based"; below that we try OCR.
MIN_TEXT_CHARS = 40

UOM_TOKENS = {
    "buc", "buc.", "bucata", "bucati", "bucăți", "bucată", "pcs", "pc", "u", "unit",
    "cut", "cut.", "cutie", "cutii", "set", "seturi", "fl", "fl.", "flacon", "flacoane",
    "kg", "g", "gr", "mg", "l", "ml", "litri", "litru", "m", "ml.", "pach", "pachet",
    "pachete", "amp", "amp.", "fiola", "fiole", "tub", "tuburi", "doza", "doze", "cp",
    "cpr", "tb", "tab", "plic", "plicuri", "sac", "saci", "rola", "role", "per", "pereche",
}

# Romanian / generic number: 1.234,56 | 1234,56 | 1,234.56 | 1234.56 | 12
_NUM_RE = re.compile(r"^-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:[.,]\d+)?$")
_VAT_RE = re.compile(r"^(\d{1,2}(?:[.,]\d+)?)\s*%$")
_DATE_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_CUI_RE = re.compile(
    r"(?:C\.?\s?U\.?\s?I\.?|C\.?\s?I\.?\s?F\.?|cod\s+fiscal|cod\s+de\s+[iî]nregistrare(?:\s+fiscal[aă])?)"
    r"\s*[:.]?\s*((?:RO)?\s?\d{2,10})",
    re.IGNORECASE,
)
_INVOICE_NO_RE = re.compile(
    r"(?:factur[aă](?:\s+fiscal[aă])?\s*(?:nr\.?|num[aă]r)?|nr\.?\s*factur[aă]|invoice\s*(?:no\.?|number)?)"
    r"\s*[:.]?\s*(?:seria\s*[:.]?\s*([A-Z]{1,6})\s*)?(?:nr\.?\s*[:.]?\s*)?([A-Z]{0,6}[\s-]?\d[\w/-]*)",
    re.IGNORECASE,
)
_SERIES_NO_RE = re.compile(
    r"seria\s*[:.]?\s*([A-Z]{1,6})\s*,?\s*nr\.?\s*[:.]?\s*(\d[\w/-]*)", re.IGNORECASE
)
_SUPPLIER_RE = re.compile(r"^\s*(?:furnizor|v[aâ]nz[aă]tor|prestator|supplier|seller)\b\s*[:.]?\s*(.*)$", re.IGNORECASE)
_TOTAL_WORDS = ("total", "subtotal", "tva", "de plata", "de plată", "sold", "achitat", "discount", "transport")


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def _is_pdf(data, filename):
    return data[:5] == b"%PDF-" or (filename or "").lower().endswith(".pdf")


def _pdf_text(data):
    try:
        from pypdf import PdfReader  # Odoo >= 17 ships pypdf
    except ImportError:  # pragma: no cover - very old environments
        from PyPDF2 import PdfReader  # type: ignore
    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages:
        try:
            try:
                parts.append(page.extract_text(extraction_mode="layout") or "")
            except TypeError:
                parts.append(page.extract_text() or "")
        except Exception as e:  # noqa: BLE001 - broken page, keep going
            _logger.warning("PDF page text extraction failed: %s", e)
    return "\n".join(parts)


def _ocr_images(images):
    import pytesseract  # optional dependency

    texts = []
    for img in images:
        try:
            texts.append(pytesseract.image_to_string(img, lang="ron+eng", config="--psm 6"))
        except pytesseract.TesseractError:
            texts.append(pytesseract.image_to_string(img, config="--psm 6"))
    return "\n".join(texts)


def ocr_available():
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def extract_text(data, filename=None):
    """Return (text, method) where method is 'text', 'ocr' or 'none'."""
    if not data:
        return "", "none"
    if _is_pdf(data, filename):
        text = ""
        try:
            text = _pdf_text(data)
        except Exception as e:  # noqa: BLE001
            _logger.warning("PDF text extraction failed: %s", e)
        if len(text.strip()) >= MIN_TEXT_CHARS:
            return text, "text"
        # Scanned PDF -> OCR (needs pdf2image + poppler + tesseract)
        try:
            from pdf2image import convert_from_bytes

            images = convert_from_bytes(data, dpi=300)
            return _ocr_images(images), "ocr"
        except Exception as e:  # noqa: BLE001
            _logger.info("OCR for scanned PDF not available: %s", e)
            return text, "text" if text.strip() else "none"
    # Image (jpg/png/tiff...)
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        return _ocr_images([img]), "ocr"
    except Exception as e:  # noqa: BLE001
        _logger.info("OCR for image not available: %s", e)
        return "", "none"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_number(token):
    """Parse a Romanian or international formatted number. Return float or None."""
    if token is None:
        return None
    t = str(token).strip().replace(" ", "").replace(" ", "")
    t = t.rstrip(".")
    if not t or not re.match(r"^-?[\d.,]+$", t):
        return None
    if "," in t and "." in t:
        if t.rfind(",") > t.rfind("."):
            t = t.replace(".", "").replace(",", ".")  # 1.234,56
        else:
            t = t.replace(",", "")  # 1,234.56
    elif "," in t:
        # A single comma is a decimal comma (RO convention); several are thousands separators.
        t = t.replace(",", ".") if t.count(",") == 1 else t.replace(",", "")
    elif t.count(".") > 1:
        t = t.replace(".", "")  # 1.234.567
    try:
        return float(t)
    except ValueError:
        return None


def _close(a, b, rel=0.02, abs_tol=0.02):
    return abs(a - b) <= max(abs_tol, rel * max(abs(a), abs(b)))


def normalize_key(text):
    """Normalize a product name/code to an aggregation key."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^a-zA-Z0-9]+", " ", t).strip().lower()
    return re.sub(r"\s+", " ", t)


def _split_tokens(line):
    # Note: thousands separated by spaces ("1 234,56") are not supported on purpose:
    # they are indistinguishable from adjacent columns in extracted text.
    return re.sub(r"[|;\t]+", " ", line).split()


_LOT_RE = re.compile(r"\bLot\s*[:.]?\s*([A-Za-z0-9/-]+)", re.IGNORECASE)
_EXP_RE = re.compile(r"\bExp(?:\.|ir[aă]|iry)?\s*[:.]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})", re.IGNORECASE)
_LINE_NOISE_RE = re.compile(
    r"\bLot\s*[:.]?\s*[A-Za-z0-9/-]*|\bExp(?:\.|ir[aă]|iry)?\s*[:.]?(?:\s*\d{1,2}[./-]\d{1,2}[./-]\d{4})?"
    r"|\bCod\s+HS\s*[:.]?\s*\d*|\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b",
    re.IGNORECASE,
)
_LETTER_RE = re.compile(r"[A-Za-zĂÂÎȘȚăâîșțŞŢşţ]")
_DISCOUNT_RE = re.compile(r"^\s*(?:\d{1,3}[.)]?\s+)?(?:discount|reducere|rabat|bonificat)", re.IGNORECASE)
_HEADER_HINTS = ("denumire", "cantitate", "pret unitar", "pret unit", "valoare", "crt", "um ")
_ITEMS_END_RE = re.compile(r"^\s*(?:total|subtotal|semnatura|semnătura|modalitate de plat)", re.IGNORECASE)
_SERIES_SLASH_NO_RE = re.compile(r"Seria\s*/\s*Nr\.?\s*[:.]?\s*([A-Z]{1,10})\s*[- ]?\s*(\d[\w/-]*)", re.IGNORECASE)
_BUYER_RE = re.compile(r"(?:cump[aă]r[aă]tor|client|beneficiar)\s*[:.]\s*(.+)$", re.IGNORECASE)
_VAT_DEFAULT_RE = re.compile(r"Cota\s*TVA\s*[:.]?\s*(\d{1,2})\s*%", re.IGNORECASE)


def _clean_name(text):
    text = _LINE_NOISE_RE.sub(" ", text or "")
    text = re.sub(r"\s+", " ", text).strip(" ,;:-|")
    return text


def _has_letters(text):
    return bool(text and _LETTER_RE.search(text))


def parse_line(line):
    """Try to parse one text line into a goods line dict; return None if not a goods line.

    The returned ``product_name`` may be empty when the name is printed on a
    separate line (layout where the row only holds index, lot and numbers);
    ``parse_invoice_text`` fills it from the surrounding lines.
    """
    raw = line.strip()
    if len(raw) < 5:
        return None
    low = normalize_key(raw)
    if any(low.startswith(w) for w in _TOTAL_WORDS if w != "discount"):
        return None
    tokens = _split_tokens(raw)
    if len(tokens) < 4:
        return None

    # Collect trailing numeric / VAT tokens.
    trailing = []  # list of (index, value, is_vat)
    i = len(tokens) - 1
    while i >= 0:
        tok = tokens[i]
        vat = _VAT_RE.match(tok)
        if vat:
            trailing.append((i, parse_number(vat.group(1)), True))
        elif tok == "%" and i > 0 and parse_number(tokens[i - 1]) is not None:
            trailing.append((i - 1, parse_number(tokens[i - 1]), True))
            i -= 1
        else:
            val = parse_number(tok) if _NUM_RE.match(tok) else None
            if val is None:
                break
            trailing.append((i, val, False))
        i -= 1
    trailing.reverse()
    if len(trailing) < 3:
        return None

    nums = [(idx, v) for idx, v, is_vat in trailing if not is_vat]
    vat_rate = next((v for _, v, is_vat in trailing if is_vat), None)

    found = None
    for k in range(len(nums) - 2):
        qty, price, value = nums[k][1], nums[k + 1][1], nums[k + 2][1]
        if qty != 0 and price >= 0 and _close(qty * price, value):
            found = (k, qty, price, value)
            break
    if not found:
        return None
    k, qty, price, value = found

    # A plain number right after the value may be the VAT rate (followed by the VAT amount).
    if vat_rate is None and k + 4 < len(nums):
        cand = nums[k + 3][1]
        if cand in (0, 5, 9, 11, 19, 20, 21, 24, 27) and _close(value * cand / 100.0, nums[k + 4][1]):
            vat_rate = cand

    name_tokens = tokens[:nums[k][0]]
    uom = None
    if name_tokens and name_tokens[-1].lower().strip(".") in {u.strip(".") for u in UOM_TOKENS}:
        uom = name_tokens.pop().upper() if name_tokens[-1].isupper() else name_tokens.pop()
    # Leading row index ("1", "1.", "1)")
    if name_tokens and re.match(r"^\d{1,3}[.)]?$", name_tokens[0]):
        name_tokens = name_tokens[1:]
    code = None
    if (
        len(name_tokens) > 1
        and re.match(r"^[A-Z0-9][A-Z0-9._/-]{3,}$", name_tokens[0])
        and any(c.isdigit() for c in name_tokens[0])
        and not _LOT_RE.match(name_tokens[0])
    ):
        code = name_tokens.pop(0)
    own_text = " ".join(name_tokens)
    name = _clean_name(own_text)
    if name and not _has_letters(name):
        name = ""
    lot = _LOT_RE.search(own_text)
    exp = _EXP_RE.search(own_text)
    return {
        "product_code": code,
        "product_name": name,
        "uom": uom,
        "quantity": qty,
        "price_unit": price,
        "amount": value,
        "vat_rate": vat_rate,
        "discount_amount": 0.0,
        "lot_number": lot.group(1) if lot else None,
        "expiry_date": _parse_date(exp.group(1)) if exp else None,
        "is_discount": bool(_DISCOUNT_RE.match(raw)) or qty < 0,
    }


def _parse_date(text):
    m = _DATE_RE.search(text or "")
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= d <= 31 and 1 <= mo <= 12:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    m = _ISO_DATE_RE.search(text or "")
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def _first_column(text):
    return re.split(r"\s{3,}", text.strip())[0].strip(" :")


def _parse_header(text, lines, result):
    m = _SERIES_SLASH_NO_RE.search(text) or _SERIES_NO_RE.search(text)
    if m:
        result["invoice_number"] = f"{m.group(1).upper()} {m.group(2)}"
    else:
        m = _INVOICE_NO_RE.search(text)
        if m and any(c.isdigit() for c in m.group(2)):
            series, number = m.group(1), m.group(2).strip()
            result["invoice_number"] = f"{series.upper()} {number}" if series else number

    # Date: on a line mentioning "data", or on the line just below such a header line.
    for idx, ln in enumerate(lines):
        if re.search(r"\bdata\b|\bdate\b|emiter", ln, re.IGNORECASE):
            d = _parse_date(re.sub(r"\(?zz[-./]ll[-./]aaaa\)?", "", ln, flags=re.IGNORECASE))
            if not d and idx + 1 < len(lines):
                d = _parse_date(lines[idx + 1])
            if d:
                result["invoice_date"] = d
                break
    if not result["invoice_date"]:
        result["invoice_date"] = _parse_date(text)

    vats = [re.sub(r"\s+", "", v).upper() for v in _CUI_RE.findall(text)]
    if vats:
        result["supplier_vat"] = vats[0]
    if len(vats) > 1 and vats[1] != vats[0]:
        result["customer_vat"] = vats[1]

    for idx, ln in enumerate(lines):
        sm = _SUPPLIER_RE.match(ln)
        if sm:
            name = re.split(r"\s{3,}|cump[aă]r[aă]tor|client|beneficiar", sm.group(1), flags=re.IGNORECASE)[0].strip(" :")
            if not name and idx + 1 < len(lines):
                name = _first_column(lines[idx + 1])
            if name:
                result["supplier_name"] = name[:128]
                break
    if not result["supplier_name"]:
        for ln in lines[:15]:
            m2 = re.search(r"([A-Z0-9ĂÂÎȘȚ][\w.&\- ]{2,80}?\s(?:S\.?R\.?L\.?|S\.?A\.?|SRL-D|PFA|I\.?I\.?))(?=\s|$)", ln)
            if m2:
                result["supplier_name"] = m2.group(1).strip()
                break

    for ln in lines:
        bm = _BUYER_RE.search(ln)
        if bm:
            buyer = _first_column(bm.group(1))
            if _has_letters(buyer):
                result["customer_name"] = buyer[:128]
                break

    vm = _VAT_DEFAULT_RE.search(text)
    if vm:
        result["default_vat_rate"] = float(vm.group(1))


def parse_invoice_text(text):
    """Parse invoice text into header fields and goods lines.

    Returns a dict with keys: invoice_number, invoice_date, supplier_name,
    supplier_vat, customer_name, customer_vat, default_vat_rate, lines.
    Discount rows are merged into the preceding product line (discount_amount),
    so quantities in the registry are not reduced by them.
    """
    result = {
        "invoice_number": None,
        "invoice_date": None,
        "supplier_name": None,
        "supplier_vat": None,
        "customer_name": None,
        "customer_vat": None,
        "default_vat_rate": None,
        "lines": [],
    }
    if not text:
        return result
    lines = [ln for ln in text.splitlines() if ln.strip()]
    _parse_header(text, lines, result)

    items = []
    pending_name = None  # last free-text line seen since the previous item (name printed above the row)
    last_item = None
    after_item = False  # the line right after an item may be a continuation (lot / expiry / HS code)
    for ln in lines:
        parsed = parse_line(ln)
        if parsed:
            if parsed["is_discount"]:
                if last_item is not None:
                    last_item["discount_amount"] = round(last_item["discount_amount"] + abs(parsed["amount"]), 2)
                pending_name, after_item = None, False
                continue
            if not parsed["product_name"]:
                if not pending_name:
                    continue  # numbers without any product name: not a goods line
                parsed["product_name"] = pending_name
            items.append(parsed)
            last_item, pending_name, after_item = parsed, None, True
            continue

        stripped = ln.strip()
        if _ITEMS_END_RE.match(stripped):
            pending_name, after_item = None, False
            continue
        low = stripped.lower()
        is_continuation = after_item and (
            _LOT_RE.search(stripped) or _EXP_RE.search(stripped) or re.match(r"^\d{1,2}[./-]\d{1,2}[./-]\d{4}", stripped)
            or "cod hs" in low
        )
        if is_continuation and last_item is not None:
            if not last_item["lot_number"]:
                lot = _LOT_RE.search(stripped)
                last_item["lot_number"] = lot.group(1) if lot else None
            if not last_item["expiry_date"]:
                last_item["expiry_date"] = _parse_date(stripped)
            after_item = False
            continue
        after_item = False
        if any(h in low for h in _HEADER_HINTS) or ":" in stripped[:25]:
            pending_name = None
            continue
        name = _clean_name(_first_column(stripped))
        pending_name = name if _has_letters(name) and len(name) >= 3 else None

    for it in items:
        if it["vat_rate"] is None and result["default_vat_rate"] is not None:
            it["vat_rate"] = result["default_vat_rate"]
        it.pop("is_discount", None)
    result["lines"] = items
    return result
