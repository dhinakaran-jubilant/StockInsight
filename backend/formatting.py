"""Shared display formatters for rupee prices and market caps.

Used by the REST endpoints and by the chat agent's tool output. The agent matters most:
a local model asked to convert 161201.84 crore into lakh crore gets it wrong by factors
of 100, so every figure it sees should arrive pre-formatted and ready to copy verbatim.
"""


def format_mcap(mcap_raw):
    """'161201.84' -> '₹1.61L Cr';  '5272.62' -> '₹5,272.62 Cr'."""
    if not mcap_raw or mcap_raw == '—':
        return '—'
    s = str(mcap_raw).replace('₹', '').replace('Cr', '').replace(',', '').strip()
    try:
        val = float(s)
    except (TypeError, ValueError):
        return f"₹{mcap_raw} Cr" if not str(mcap_raw).startswith('₹') else str(mcap_raw)
    if val >= 100000:                     # a lakh crore or more
        return f"₹{val / 100000.0:.2f}L Cr"
    return f"₹{val:,.2f} Cr"


def format_price(price_raw):
    """'1102.3' -> '₹1,102.30'."""
    if not price_raw or price_raw == '—':
        return '—'
    s = str(price_raw).replace('₹', '').replace('$', '').replace(',', '').strip()
    try:
        return f"₹{float(s):,.2f}"
    except (TypeError, ValueError):
        if str(price_raw).startswith('₹') or str(price_raw).startswith('$'):
            return str(price_raw)
        return f"₹{price_raw}"
