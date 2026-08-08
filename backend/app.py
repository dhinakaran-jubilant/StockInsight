import os
import re
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, jsonify, request
from flask_cors import CORS

import crossovers
from ai_agent import run_agent, agent_enabled, agent_status, AgentUnavailable

app = Flask(__name__)
CORS(app)

# PostgreSQL Database Configuration
DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

def get_db_conn():
    """Connect to PostgreSQL database."""
    return psycopg2.connect(**DB_CONFIG)

# Defined in formatting.py so the chat agent's tools format figures identically.
from formatting import format_mcap, format_price  # noqa: E402  (re-exported for this module)

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint that verifies DB connectivity."""
    db_status = "disconnected"
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
        conn.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    
    return jsonify({
        "status": "ok",
        "database": db_status,
        "aiAgent": agent_status()
    })

@app.route('/api/last-updated', methods=['GET'])
def get_last_updated():
    """Return table-specific and overall most recent scraped_at timestamps formatted with AM/PM."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    (SELECT MAX(scraped_at) FROM trades) as trades,
                    (SELECT MAX(scraped_at) FROM shareholding_pattern) as shareholding,
                    (SELECT MAX(scraped_at) FROM stock_history) as history,
                    (SELECT MAX(scraped_at) FROM financial_metrics) as metrics,
                    (SELECT MAX(scraped_at) FROM global_index_history) as global,
                    (SELECT MAX(scraped_at) FROM commodity_history) as commodities,
                    (SELECT MAX(scraped_at) FROM sectoral_activity) as sectoral,
                    (SELECT MAX(scraped_at) FROM fii_dii_cash) as cashflow,
                    (SELECT MAX(scraped_at) FROM consensus_recommendations) as recommendations,
                    (SELECT MAX(scraped_at) FROM moneycontrol_boarders) as sentiment;
            """)
            row = cur.fetchone()
        conn.close()

        def fmt(dt):
            if not dt:
                return "N/A"
            return dt.strftime("%d %b %Y, %I:%M %p")

        valid_dts = [r for r in row if r is not None] if row else []
        max_dt = max(valid_dts) if valid_dts else None

        timestamps = {
            "trades": fmt(row[0] if row else None),
            "ownership": fmt(row[1] if row else None),
            "shareholding": fmt(row[1] if row else None),
            "trends": fmt(row[2] if row else None),
            "breakouts": fmt(row[2] if row else None),
            "breakout": fmt(row[2] if row else None),
            "history": fmt(row[2] if row else None),
            "metrics": fmt(row[3] if row else None),
            "global": fmt(row[4] if row else None),
            "commodity": fmt(row[5] if row else None),
            "commodities": fmt(row[5] if row else None),
            "sectoral": fmt(row[6] if row else None),
            "cashflow": fmt(row[7] if row else None),
            "recommendations": fmt(row[8] if row else None),
            "consensus": fmt(row[8] if row else None),
            "sentiment": fmt(row[9] if row else None),
            "boarders": fmt(row[9] if row else None),
            "global_max": fmt(max_dt)
        }

        req_table = request.args.get('table', '').lower().strip()
        if req_table in timestamps:
            return jsonify({
                "table": req_table,
                "formatted": timestamps[req_table]
            })

        return jsonify({
            "timestamps": timestamps,
            "formatted": timestamps["global_max"]
        })
    except Exception as e:
        return jsonify({
            "timestamps": {},
            "formatted": "N/A",
            "error": str(e)
        }), 500

def normalize_trade_action(raw_action):
    if not raw_action:
        return ""
    act = str(raw_action).strip().upper()
    if act in ['BUY', 'ACQ', 'ACQUISITION', 'PURCHASE']:
        return "Buy"
    elif act in ['SELL', 'DISPOSAL', 'SALE']:
        return "Sell"
    return str(raw_action).strip()

@app.route('/api/trades', methods=['GET'])
def get_trades():
    """Return trades data with stock_name, price, and market_cap from nifty_750 table."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                WITH recent_trades AS (
                    SELECT DISTINCT ON (symbol, trade_type)
                        symbol, trade_type, trade_date, buy_sell
                    FROM trades
                    WHERE trade_date IS NOT NULL AND trade_date != ''
                    ORDER BY symbol, trade_type, scraped_at DESC, id ASC
                )
                SELECT 
                    t.symbol,
                    COALESCE(n.stock_name, t.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), s.market_cap, '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), MAX(t.price)) as price,
                    
                    MAX(rt.trade_date) FILTER (WHERE rt.trade_type = 'Insider Trades') as insider_date,
                    MAX(rt.buy_sell) FILTER (WHERE rt.trade_type = 'Insider Trades') as insider_action,
                    
                    MAX(rt.trade_date) FILTER (WHERE rt.trade_type = 'Bulk Deals') as bulk_date,
                    MAX(rt.buy_sell) FILTER (WHERE rt.trade_type = 'Bulk Deals') as bulk_action,

                    MAX(rt.trade_date) FILTER (WHERE rt.trade_type = 'Block Deals') as block_date,
                    MAX(rt.buy_sell) FILTER (WHERE rt.trade_type = 'Block Deals') as block_action,

                    MAX(rt.trade_date) FILTER (WHERE rt.trade_type = 'Sast Trades') as sast_date,
                    MAX(rt.buy_sell) FILTER (WHERE rt.trade_type = 'Sast Trades') as sast_action

                FROM trades t
                LEFT JOIN nifty_750 n ON UPPER(t.symbol) = UPPER(n.symbol)
                LEFT JOIN (
                    SELECT DISTINCT ON (symbol) symbol, market_cap
                    FROM shareholding_pattern
                    ORDER BY symbol, id DESC
                ) s ON UPPER(t.symbol) = UPPER(s.symbol)
                LEFT JOIN recent_trades rt ON t.symbol = rt.symbol
                GROUP BY t.symbol, n.stock_name, n.market_cap, s.market_cap, n.price
                ORDER BY COALESCE(n.stock_name, t.symbol) ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        bg_colors = [
            'bg-[#003087]', 'bg-[#1C1C1E]', 'bg-[#004b8d]', 'bg-[#007cc3]',
            'bg-indigo-600', 'bg-blue-600', 'bg-emerald-600', 'bg-purple-600'
        ]

        trades = []
        for idx, r in enumerate(rows):
            symbol = r[0] or 'UNKNOWN'
            stock_name = r[1] or symbol
            market_cap = format_mcap(r[2])
            price = format_price(r[3])
            
            insider_date = r[4] or "-"
            insider_action = normalize_trade_action(r[5])
            
            bulk_date = r[6] or "-"
            bulk_action = normalize_trade_action(r[7])
            
            block_date = r[8] or "-"
            block_action = normalize_trade_action(r[9])
            
            sast_date = r[10] or "-"
            sast_action = normalize_trade_action(r[11])

            color = bg_colors[idx % len(bg_colors)]

            trades.append({
                "id": idx + 1,
                "stockName": stock_name,
                "ticker": symbol,
                "marketCap": market_cap,
                "price": price,
                "insiderTrades": { "date": insider_date, "action": insider_action },
                "bulkDeals": { "date": bulk_date, "action": bulk_action },
                "blockDeals": { "date": block_date, "action": block_action },
                "sastTrades": { "date": sast_date, "action": sast_action },
                "bgColor": color
            })

        return jsonify({"trades": trades, "count": len(trades)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/sectoral', methods=['GET'])
def get_sectoral_activity():
    """Return sectoral activity pivoted by period based on period_type parameter."""
    try:
        period_type = request.args.get('period_type', 'fortnightly').lower()
        if period_type not in ['fortnightly', 'monthly', 'yearly']:
            period_type = 'fortnightly'

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sector, period, amount_cr, id 
                FROM sectoral_activity 
                WHERE LOWER(period_type) = %s 
                ORDER BY id ASC;
            """, (period_type,))
            rows = cur.fetchall()
        conn.close()

        from collections import defaultdict
        periods = []
        for s, p, a, id_val in rows:
            p_clean = str(p).strip()
            if period_type == 'yearly' and p_clean:
                p_clean = p_clean.split()[0]
            if p_clean not in periods:
                periods.append(p_clean)

        sector_map = defaultdict(dict)
        for s, p, a, id_val in rows:
            p_clean = str(p).strip()
            if period_type == 'yearly' and p_clean:
                p_clean = p_clean.split()[0]
            val = float(a) if a is not None else None
            sector_map[s][p_clean] = val

        sectoral_list = []
        for idx, (sector_name, p_vals) in enumerate(sector_map.items()):
            row_dict = {
                "id": idx + 1,
                "sector": sector_name,
                "amounts": {}
            }
            for p in periods:
                amt = p_vals.get(p)
                if amt is not None:
                    amt_str = f"+₹{amt:,.0f} Cr" if amt > 0 else (f"-₹{abs(amt):,.0f} Cr" if amt < 0 else "₹0 Cr")
                    row_dict["amounts"][p] = {
                        "val": amt_str,
                        "raw": amt
                    }
                else:
                    row_dict["amounts"][p] = {
                        "val": "—",
                        "raw": None
                    }
            sectoral_list.append(row_dict)

        return jsonify({
            "sectoral": sectoral_list,
            "periods": periods,
            "periodType": period_type,
            "count": len(sectoral_list)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/sectoral/history', methods=['GET'])
def get_sectoral_history():
    """Return historical sectoral buy/sell flow data across intervals for a given sector."""
    try:
        sector_name = request.args.get('sector', '').strip()
        if not sector_name:
            return jsonify({"error": "Sector name is required"}), 400

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT period_type, period, amount_cr, id 
                FROM sectoral_activity 
                WHERE LOWER(sector) = LOWER(%s) 
                ORDER BY id ASC;
            """, (sector_name,))
            rows = cur.fetchall()
        conn.close()

        history_by_type = {
            "fortnightly": [],
            "monthly": [],
            "yearly": []
        }

        for p_type, p_val, amt, id_val in rows:
            pt = str(p_type).lower().strip()
            p_clean = str(p_val).strip()
            if pt == 'yearly' and p_clean:
                p_clean = p_clean.split()[0]

            val = float(amt) if amt is not None else 0.0
            formatted = f"+₹{val:,.0f} Cr" if val > 0 else (f"-₹{abs(val):,.0f} Cr" if val < 0 else "₹0 Cr")

            item = {
                "period": p_clean,
                "amount": val,
                "formatted": formatted,
                "isBuy": val >= 0
            }
            if pt in history_by_type:
                history_by_type[pt].append(item)

        return jsonify({
            "sector": sector_name,
            "history": history_by_type
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/cashflow', methods=['GET'])
def get_cashflow():
    """Return FII and DII cash flow data from fii_dii_cash table based on period_type."""
    try:
        period_type = request.args.get('period_type', 'daily').lower()
        if period_type not in ['daily', 'monthly', 'yearly']:
            period_type = 'daily'

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, period, period_type, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net 
                FROM fii_dii_cash 
                WHERE LOWER(period_type) = %s 
                ORDER BY id ASC;
            """, (period_type,))
            rows = cur.fetchall()
        conn.close()

        cashflow = []
        for r in rows:
            id_val, period, pt, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net = r
            
            p_clean = str(period).strip() if period else ""
            if period_type == 'yearly' and p_clean:
                p_clean = p_clean.split()[0]

            def fmt(val):
                if val is None:
                    return "—"
                f_val = float(val)
                if f_val > 0:
                    return f"₹{f_val:,.2f} Cr"
                elif f_val < 0:
                    return f"-₹{abs(f_val):,.2f} Cr"
                else:
                    return "₹0.00 Cr"

            cashflow.append({
                "id": id_val,
                "period": p_clean,
                "periodType": pt,
                "fiiBuy": fmt(fii_buy),
                "fiiBuyRaw": float(fii_buy) if fii_buy is not None else 0.0,
                "fiiSell": fmt(fii_sell),
                "fiiSellRaw": float(fii_sell) if fii_sell is not None else 0.0,
                "fiiNet": fmt(fii_net),
                "fiiNetRaw": float(fii_net) if fii_net is not None else 0.0,
                "diiBuy": fmt(dii_buy),
                "diiBuyRaw": float(dii_buy) if dii_buy is not None else 0.0,
                "diiSell": fmt(dii_sell),
                "diiSellRaw": float(dii_sell) if dii_sell is not None else 0.0,
                "diiNet": fmt(dii_net),
                "diiNetRaw": float(dii_net) if dii_net is not None else 0.0,
            })

        return jsonify({"cashflow": cashflow, "periodType": period_type, "count": len(cashflow)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/trades/<symbol>', methods=['GET'])
def get_trade_details(symbol):
    """Return all detailed trade entries for a specific stock symbol grouped by trade_type."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Fetch Stock Name from nifty_750 if available
            cur.execute("SELECT stock_name FROM nifty_750 WHERE UPPER(symbol) = UPPER(%s) LIMIT 1;", (symbol,))
            stock_row = cur.fetchone()
            stock_name = stock_row['stock_name'] if stock_row and stock_row.get('stock_name') else symbol

            # Query all trade rows for symbol
            cur.execute("""
                SELECT 
                    id,
                    symbol,
                    trade_type,
                    trade_date,
                    COALESCE(person, '') as person,
                    COALESCE(designation, '') as designation,
                    COALESCE(buy_sell, '') as buy_sell,
                    COALESCE(quantity, '') as quantity,
                    COALESCE(price, '') as price,
                    COALESCE(value_lacs, '') as value_lacs,
                    COALESCE(mode, '') as mode,
                    COALESCE(percent, '') as percent
                FROM trades
                WHERE UPPER(symbol) = UPPER(%s)
                ORDER BY scraped_at DESC, id DESC;
            """, (symbol,))
            rows = cur.fetchall()
        conn.close()

        # Structure response grouped by trade_type
        trades_by_type = {
            "Insider Trades": [],
            "Bulk Deals": [],
            "Block Deals": [],
            "Sast Trades": []
        }

        for row in rows:
            ttype = row['trade_type']
            row['action'] = normalize_trade_action(row['buy_sell'])
            
            matched = False
            for key in trades_by_type.keys():
                if key.lower() == str(ttype).strip().lower():
                    trades_by_type[key].append(row)
                    matched = True
                    break
            if not matched:
                for key in trades_by_type.keys():
                    if key.lower().replace(' ', '') in str(ttype).lower().replace(' ', ''):
                        trades_by_type[key].append(row)
                        matched = True
                        break

        return jsonify({
            "status": "success",
            "symbol": symbol,
            "stockName": stock_name,
            "details": trades_by_type
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def parse_pct_val(val_str):
    if not val_str:
        return None
    try:
        s = str(val_str).replace('%', '').replace(',', '').replace('₹', '').replace('Cr', '').strip()
        return float(s)
    except:
        return None

def format_metric(curr, prev):
    c = parse_pct_val(curr)
    p = parse_pct_val(prev)
    if c is None:
        return {"val": "—", "diff": "—", "change": 0, "prevVal": "—"}
    prev_str = f"{p:.2f}%" if p is not None else "—"
    if p is None:
        return {"val": f"{c:.2f}%", "diff": "0.00%", "change": 0, "prevVal": prev_str}
    diff = c - p
    sign = "+" if diff > 0 else ""
    return {
        "val": f"{c:.2f}%",
        "diff": f"{sign}{diff:.2f}%",
        "change": round(diff, 2),
        "prevVal": prev_str
    }

def format_sales_metric(curr, prev):
    c = parse_pct_val(curr)
    p = parse_pct_val(prev)
    if c is None:
        return {"val": "—", "diff": "—", "change": 0, "prevVal": "—"}
    val_str = f"₹{c:,.0f} Cr" if c >= 1 else f"₹{c:.2f} Cr"
    prev_str = (f"₹{p:,.0f} Cr" if p >= 1 else f"₹{p:.2f} Cr") if p is not None else "—"
    if p is None or p == 0:
        return {"val": val_str, "diff": "0.00%", "change": 0, "prevVal": prev_str}
    diff_pct = ((c - p) / abs(p)) * 100.0
    sign = "+" if diff_pct > 0 else ""
    return {
        "val": val_str,
        "diff": f"{sign}{diff_pct:.2f}%",
        "change": round(diff_pct, 2),
        "prevVal": prev_str
    }


@app.route('/api/ownership', methods=['GET'])
def get_ownership():
    """Return shareholding pattern ownership percentage diff between last 2 periods per symbol."""
    try:
        period_type = request.args.get('period_type', 'quarterly').lower()
        if period_type not in ['quarterly', 'yearly']:
            period_type = 'quarterly'

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                WITH symbols_list AS (
                    SELECT DISTINCT UPPER(symbol) as symbol FROM shareholding_pattern
                    UNION
                    SELECT DISTINCT UPPER(symbol) as symbol FROM nifty_750
                ),
                ranked_sp AS (
                    SELECT DISTINCT ON (UPPER(symbol), period)
                        UPPER(symbol) as symbol, period, promoters, fiis, diis, public, id, market_cap
                    FROM shareholding_pattern
                    WHERE LOWER(period_type) = %s
                    ORDER BY UPPER(symbol), period, id DESC
                ),
                numbered_sp AS (
                    SELECT 
                        symbol, period, promoters, fiis, diis, public, market_cap,
                        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY id DESC) as rn
                    FROM ranked_sp
                )
                SELECT 
                    s.symbol,
                    COALESCE(n.stock_name, s.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), p1.market_cap, '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), t.price, '') as price,
                    
                    p1.period as curr_period,
                    p2.period as prev_period,
                    p1.promoters as curr_prom, p2.promoters as prev_prom,
                    p1.fiis as curr_fii, p2.fiis as prev_fii,
                    p1.diis as curr_dii, p2.diis as prev_dii,
                    p1.public as curr_pub, p2.public as prev_pub

                FROM symbols_list s
                LEFT JOIN nifty_750 n ON s.symbol = UPPER(n.symbol)
                LEFT JOIN (
                    SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) as symbol, price
                    FROM trades
                    WHERE price IS NOT NULL AND price != ''
                    ORDER BY UPPER(symbol), id DESC
                ) t ON s.symbol = t.symbol
                INNER JOIN numbered_sp p1 ON s.symbol = p1.symbol AND p1.rn = 1
                LEFT JOIN numbered_sp p2 ON s.symbol = p2.symbol AND p2.rn = 2
                ORDER BY COALESCE(n.stock_name, s.symbol) ASC;
            """, (period_type,))
            rows = cur.fetchall()
        conn.close()

        ownership_list = []
        for idx, r in enumerate(rows):
            symbol = r[0]
            stock_name = r[1] or symbol
            mcap = format_mcap(r[2])
            price = format_price(r[3])

            ownership_list.append({
                "id": idx + 1,
                "ticker": symbol,
                "stockName": stock_name,
                "marketCap": mcap,
                "price": price,
                "currPeriod": r[4] or '',
                "prevPeriod": r[5] or '',
                "promoters": format_metric(r[6], r[7]),
                "fiis": format_metric(r[8], r[9]),
                "diis": format_metric(r[10], r[11]),
                "public": format_metric(r[12], r[13]),
            })

        return jsonify({"ownership": ownership_list, "count": len(ownership_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/ownership/<symbol>', methods=['GET'])
def get_ownership_details(symbol):
    """Return all shareholding pattern records for a specific stock symbol grouped by period_type."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Fetch Stock Name from nifty_750 if available
            cur.execute("SELECT stock_name FROM nifty_750 WHERE UPPER(symbol) = UPPER(%s) LIMIT 1;", (symbol,))
            stock_row = cur.fetchone()
            stock_name = stock_row['stock_name'] if stock_row and stock_row.get('stock_name') else symbol

            # Query all shareholding pattern rows for symbol
            cur.execute("""
                SELECT 
                    id, symbol, period, promoters, fiis, diis, public, num_shareholders, period_type
                FROM shareholding_pattern
                WHERE UPPER(symbol) = UPPER(%s)
                ORDER BY id ASC;
            """, (symbol,))
            rows = cur.fetchall()
        conn.close()

        quarterly = []
        yearly = []
        seen_q = set()
        seen_y = set()

        for r in rows:
            ptype = (r.get('period_type') or 'quarterly').lower()
            pname = r.get('period') or ''
            item = {
                "id": r.get('id'),
                "period": pname,
                "promoters": r.get('promoters') or '0.00%',
                "fiis": r.get('fiis') or '0.00%',
                "diis": r.get('diis') or '0.00%',
                "public": r.get('public') or '0.00%',
                "num_shareholders": r.get('num_shareholders') or '—',
                "period_type": ptype
            }
            if ptype == 'yearly':
                if pname not in seen_y:
                    seen_y.add(pname)
                    yearly.append(item)
            else:
                if pname not in seen_q:
                    seen_q.add(pname)
                    quarterly.append(item)

        return jsonify({
            "status": "success",
            "symbol": symbol,
            "stockName": stock_name,
            "details": {
                "Quarterly": quarterly,
                "Yearly": yearly
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/trends', methods=['GET'])
def get_trends():
    """Return trend crossover analysis (count of crossovers, price % increase, and probability %) per stock.

    The calculation lives in crossovers.py so that this table and the Tara AI chat agent
    always report identical figures.
    """
    try:
        conn = get_db_conn()
        try:
            rows = crossovers.compute_all(conn)
        finally:
            conn.close()

        trends_list = []
        for r in rows:
            mcap = r['marketCapRaw'] or '—'
            if mcap != '—' and not str(mcap).startswith('₹') and not str(mcap).endswith('Cr'):
                mcap = f"₹{mcap} Cr"
            price = r['priceRaw'] or '—'
            if price != '—' and not str(price).startswith('₹'):
                price = f"₹{price}"

            trends_list.append({
                "id": r['id'],
                "ticker": r['ticker'],
                "stockName": r['stockName'],
                "marketCap": mcap,
                "price": price,
                "dma20_200": r['lite']['text'],
                "dma50_200": r['golden']['text'],
                "dma100_200": r['pro']['text'],
                "liteStats": r['lite'],
                "coreStats": r['golden'],
                "proStats": r['pro']
            })

        return jsonify({"trends": trends_list, "count": len(trends_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/trends/<symbol>', methods=['GET'])
def get_stock_trend_chart(symbol):
    """Return historical daily close price and 20, 50, 100, 200 DMAs for a specific symbol."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            # Query stock info
            cur.execute("""
                SELECT 
                    UPPER(%s) as symbol,
                    COALESCE(n.stock_name, UPPER(%s)) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), s.market_cap, '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), t.price, '') as price
                FROM (SELECT UPPER(%s) as symbol) req
                LEFT JOIN nifty_750 n ON req.symbol = UPPER(n.symbol)
                LEFT JOIN (
                    SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) as symbol, market_cap
                    FROM shareholding_pattern
                    ORDER BY UPPER(symbol), id DESC
                ) s ON req.symbol = s.symbol
                LEFT JOIN (
                    SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) as symbol, price
                    FROM trades
                    WHERE price IS NOT NULL AND price != ''
                    ORDER BY UPPER(symbol), id DESC
                ) t ON req.symbol = t.symbol;
            """, (symbol, symbol, symbol))
            stock_row = cur.fetchone()

            # Query historical close prices, volume, and calculated DMAs
            cur.execute("""
                WITH history AS (
                    SELECT 
                        symbol, 
                        trade_date, 
                        close,
                        COALESCE(volume, 0) as volume,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)::numeric, 2) as dma200
                    FROM stock_history
                    WHERE UPPER(symbol) = UPPER(%s)
                )
                SELECT 
                    TO_CHAR(trade_date, 'YYYY-MM-DD') as date_str,
                    TO_CHAR(trade_date, 'Mon DD, YYYY') as formatted_date,
                    close, volume, dma20, dma50, dma100, dma200
                FROM history
                ORDER BY trade_date ASC;
            """, (symbol,))
            history_rows = cur.fetchall()

            stock_info = None

            if not history_rows:
                # Query global_index_history for global index symbols
                cur.execute("""
                    WITH history AS (
                        SELECT 
                            index_name, 
                            trade_date, 
                            close,
                            COALESCE(volume, 0) as volume,
                            ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                            ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                            ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100,
                            ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)::numeric, 2) as dma200
                        FROM global_index_history
                        WHERE UPPER(index_name) = UPPER(%s) OR UPPER(exact_index_name) = UPPER(%s)
                    )
                    SELECT 
                        TO_CHAR(trade_date, 'YYYY-MM-DD') as date_str,
                        TO_CHAR(trade_date, 'Mon DD, YYYY') as formatted_date,
                        close, volume, dma20, dma50, dma100, dma200
                    FROM history
                    ORDER BY trade_date ASC;
                """, (symbol, symbol))
                history_rows = cur.fetchall()

                if history_rows:
                    cur.execute("""
                        SELECT exact_index_name, region, close
                        FROM global_index_history
                        WHERE UPPER(index_name) = UPPER(%s) OR UPPER(exact_index_name) = UPPER(%s)
                        ORDER BY trade_date DESC LIMIT 1;
                    """, (symbol, symbol))
                    g_info = cur.fetchone()
                    if g_info:
                        stock_info = {
                            "symbol": symbol,
                            "stockName": g_info[0] or symbol,
                            "marketCap": f"{g_info[1] or 'Global'} Region",
                            "price": f"₹{float(g_info[2]):,.2f}" if g_info[2] else '—'
                        }

            if not history_rows:
                # Query commodity_history for commodity symbols
                cur.execute("""
                    WITH history AS (
                        SELECT 
                            symbol, 
                            trade_date, 
                            close,
                            COALESCE(volume, 0) as volume,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)::numeric, 2) as dma200
                        FROM commodity_history
                        WHERE UPPER(symbol) = UPPER(%s) OR UPPER(name) = UPPER(%s)
                    )
                    SELECT 
                        TO_CHAR(trade_date, 'YYYY-MM-DD') as date_str,
                        TO_CHAR(trade_date, 'Mon DD, YYYY') as formatted_date,
                        close, volume, dma20, dma50, dma100, dma200
                    FROM history
                    ORDER BY trade_date ASC;
                """, (symbol, symbol))
                history_rows = cur.fetchall()

                if history_rows:
                    cur.execute("""
                        SELECT name, category, close
                        FROM commodity_history
                        WHERE UPPER(symbol) = UPPER(%s) OR UPPER(name) = UPPER(%s)
                        ORDER BY trade_date DESC LIMIT 1;
                    """, (symbol, symbol))
                    c_info = cur.fetchone()
                    if c_info:
                        stock_info = {
                            "symbol": symbol,
                            "stockName": c_info[0] or symbol,
                            "marketCap": f"{c_info[1] or 'Energy'} Commodity",
                            "price": f"${float(c_info[2]):,.2f}" if c_info[2] else '—'
                        }
        conn.close()

        stock_name = stock_info['stockName'] if stock_info else (stock_row[1] if stock_row else symbol)
        mcap = stock_info['marketCap'] if stock_info else (stock_row[2] if stock_row else '')
        if mcap and mcap != '—' and not str(mcap).startswith('₹') and not str(mcap).endswith('Cr') and not str(mcap).endswith('Region') and not str(mcap).endswith('Commodity'):
            mcap = f"₹{mcap} Cr"
        price = stock_info['price'] if stock_info else (stock_row[3] if stock_row else '')
        if price and price != '—' and not str(price).startswith('₹') and not str(price).startswith('$'):
            price = f"₹{price}"

        history_list = []
        for r in history_rows:
            close_val = float(r[2]) if (r[2] is not None and float(r[2]) > 0) else None
            history_list.append({
                "date": r[0],
                "label": r[1],
                "close": close_val,
                "volume": int(r[3]) if r[3] is not None else 0,
                "dma20": float(r[4]) if (r[4] is not None and float(r[4]) > 0) else None,
                "dma50": float(r[5]) if (r[5] is not None and float(r[5]) > 0) else None,
                "dma100": float(r[6]) if (r[6] is not None and float(r[6]) > 0) else None,
                "dma200": float(r[7]) if (r[7] is not None and float(r[7]) > 0) else None
            })

        return jsonify({
            "status": "success",
            "symbol": symbol,
            "stockName": stock_name,
            "marketCap": mcap,
            "price": price,
            "history": history_list,
            "count": len(history_list)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def calc_breakout_stats(history):
    if not history or len(history) < 63:
        return {
            'highBreakout': '—',
            'highPct': -1.0,
            'highBase': 0.0,
            'lowBreakout': '—',
            'lowPct': -1.0,
            'lowBase': 0.0
        }

    total_pts = len(history)
    current_price = history[-1]['close']

    # 3 months = ~63 trading days
    # 2 years = ~504 trading days
    end_base_idx = max(0, total_pts - 63)
    start_base_idx = max(0, total_pts - 504)

    base_window = history[start_base_idx:end_base_idx]

    if not base_window:
        return {
            'highBreakout': '—',
            'highPct': -1.0,
            'highBase': 0.0,
            'lowBreakout': '—',
            'lowPct': -1.0,
            'lowBase': 0.0
        }

    high_base = max(r['close'] for r in base_window)
    low_base = min(r['close'] for r in base_window)

    # High Breakout: Yes if current price crossed overall high (last 2 years to 3 months before), otherwise —
    is_high_breakout = (current_price >= high_base)
    high_diff_pct = round(((current_price - high_base) / high_base) * 100.0, 1) if high_base > 0 else 0.0

    # Low Breakout: Yes if current price did NOT cross overall high, otherwise —
    is_low_breakout = (current_price < high_base)
    low_diff_pct = round(((high_base - current_price) / high_base) * 100.0, 1) if high_base > 0 else 0.0

    return {
        'highBreakout': f"Yes +{high_diff_pct}%" if is_high_breakout else '—',
        'highPct': high_diff_pct if is_high_breakout else -1.0,
        'highBase': round(high_base, 2),
        'lowBreakout': f"Yes -{low_diff_pct}%" if is_low_breakout else '—',
        'lowPct': low_diff_pct if is_low_breakout else -1.0,
        'lowBase': round(low_base, 2)
    }

@app.route('/api/breakout', methods=['GET'])
def get_breakouts():
    """Return 2-year High/Low breakout analysis for all stocks.

    Shares crossovers.compute_all() with /api/trends and the chat agent, so all three
    read the same cached price scan and can never disagree.
    """
    try:
        conn = get_db_conn()
        try:
            rows = crossovers.compute_all(conn)
        finally:
            conn.close()

        breakouts_list = []
        for r in rows:
            mcap = r['marketCapRaw'] or '—'
            if mcap != '—' and not str(mcap).startswith('₹') and not str(mcap).endswith('Cr'):
                mcap = f"₹{mcap} Cr"
            price = r['priceRaw'] or '—'
            if price != '—' and not str(price).startswith('₹'):
                price = f"₹{price}"

            bo = r['breakout']
            breakouts_list.append({
                "id": r['id'],
                "ticker": r['ticker'],
                "stockName": r['stockName'],
                "marketCap": mcap,
                "price": price,
                "highBreakout": bo['highBreakout'],
                "highPct": bo['highPct'],
                "highBase": bo['highBase'],
                "lowBreakout": bo['lowBreakout'],
                "lowPct": bo['lowPct'],
                "lowBase": bo['lowBase']
            })

        return jsonify({"breakouts": breakouts_list, "count": len(breakouts_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/global', methods=['GET'])
def get_global_indices():
    """Return global indices from global_index_history with Lite, Core, Pro crossovers."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                WITH history AS (
                    SELECT 
                        index_name,
                        exact_index_name,
                        region,
                        trade_date,
                        close,
                        ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                        ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                        ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100,
                        ROUND(AVG(close) OVER (PARTITION BY index_name ORDER BY trade_date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)::numeric, 2) as dma200
                    FROM global_index_history
                )
                SELECT index_name, exact_index_name, region, trade_date, close, dma20, dma50, dma100, dma200
                FROM history
                ORDER BY index_name, trade_date ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        from collections import defaultdict
        idx_history = defaultdict(list)
        idx_meta = {}
        for idx_name, exact_name, region, t_date, close, dma20, dma50, dma100, dma200 in rows:
            if close is not None:
                idx_history[idx_name].append({
                    'date': t_date,
                    'close': float(close),
                    'dma20': float(dma20) if dma20 is not None else None,
                    'dma50': float(dma50) if dma50 is not None else None,
                    'dma100': float(dma100) if dma100 is not None else None,
                    'dma200': float(dma200) if dma200 is not None else None
                })
                idx_meta[idx_name] = {'exactName': exact_name or idx_name, 'region': region or 'Global'}

        def calc_crossover_stats(h_rows, dma_key):
            if not h_rows or len(h_rows) < 200:
                return {
                    "text": "No",
                    "crossoverCount": 0,
                    "prob": 0.0,
                    "avgGainPct": 0.0,
                    "isActive": False,
                    "activeDays": 0
                }

            events = []
            current_event = None

            for i in range(len(h_rows)):
                r = h_rows[i]
                fast = r.get(dma_key)
                slow = r.get('dma200')
                close = r.get('close', 0.0)

                is_cross = (fast > slow) if (fast is not None and slow is not None) else False

                prev = h_rows[i - 1] if i > 0 else None
                prev_fast = prev.get(dma_key) if prev else None
                prev_slow = prev.get('dma200') if prev else None
                prev_cross = (prev_fast > prev_slow) if (prev_fast is not None and prev_slow is not None) else False

                if is_cross and not prev_cross:
                    if current_event:
                        events.append(current_event)
                    current_event = {
                        'start_date': r['date'],
                        'start_price': close,
                        'max_price': close,
                        'days': 1
                    }
                elif is_cross and current_event:
                    current_event['max_price'] = max(current_event['max_price'], close)
                    current_event['days'] += 1
                elif not is_cross and current_event:
                    events.append(current_event)
                    current_event = None

            if current_event:
                events.append(current_event)

            latest_fast = h_rows[-1].get(dma_key)
            latest_slow = h_rows[-1].get('dma200')
            is_active = (latest_fast > latest_slow) if (latest_fast is not None and latest_slow is not None) else False
            active_days = events[-1]['days'] if (events and is_active) else 0

            status_text = f"Yes {active_days} days" if is_active else "No"
            if is_active and active_days == 1:
                status_text = "Yes 1 day"

            if not events:
                return {
                    "text": "No",
                    "crossoverCount": 0,
                    "prob": 0.0,
                    "avgGainPct": 0.0,
                    "isActive": is_active,
                    "activeDays": active_days
                }

            successes = 0
            total_gain = 0.0
            for ev in events:
                if ev['start_price'] > 0:
                    pct = ((ev['max_price'] - ev['start_price']) / ev['start_price']) * 100.0
                else:
                    pct = 0.0
                if pct > 0:
                    successes += 1
                total_gain += pct

            count = len(events)
            prob = round((successes / count) * 100.0, 1)
            avg_gain = round(total_gain / count, 1)

            return {
                "text": status_text,
                "crossoverCount": count,
                "prob": prob,
                "avgGainPct": avg_gain,
                "isActive": is_active,
                "activeDays": active_days
            }

        global_list = []
        for idx, (idx_name, h_rows) in enumerate(idx_history.items()):
            meta = idx_meta[idx_name]
            latest_price = h_rows[-1]['close'] if h_rows else 0.0

            lite_stats = calc_crossover_stats(h_rows, 'dma20')
            core_stats = calc_crossover_stats(h_rows, 'dma50')
            pro_stats = calc_crossover_stats(h_rows, 'dma100')
            bo_stats = calc_breakout_stats(h_rows)

            formatted_price = f"₹{latest_price:,.2f}" if latest_price > 0 else "—"

            global_list.append({
                "id": idx + 1,
                "ticker": idx_name,
                "stockName": meta['exactName'],
                "marketCap": f"{meta['region']} Region",
                "price": formatted_price,
                "dma20_200": lite_stats['text'],
                "dma50_200": core_stats['text'],
                "dma100_200": pro_stats['text'],
                "highBreakout": bo_stats['highBreakout'],
                "highPct": bo_stats['highPct'],
                "highBase": bo_stats['highBase'],
                "lowBreakout": bo_stats['lowBreakout'],
                "lowPct": bo_stats['lowPct'],
                "lowBase": bo_stats['lowBase'],
                "liteStats": lite_stats,
                "coreStats": core_stats,
                "proStats": pro_stats
            })

        return jsonify({"global": global_list, "count": len(global_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/commodity', methods=['GET'])
def get_commodity_data():
    """Return commodities from commodity_history with Lite, Core, Pro crossovers."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                WITH history AS (
                    SELECT 
                        name,
                        symbol,
                        category,
                        trade_date,
                        close,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW)::numeric, 2) as dma200
                    FROM commodity_history
                )
                SELECT name, symbol, category, trade_date, close, dma20, dma50, dma100, dma200
                FROM history
                ORDER BY symbol, trade_date ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        from collections import defaultdict
        comm_history = defaultdict(list)
        comm_meta = {}
        for comm_name, symbol, category, t_date, close, dma20, dma50, dma100, dma200 in rows:
            if close is not None:
                comm_history[symbol].append({
                    'date': t_date,
                    'close': float(close),
                    'dma20': float(dma20) if dma20 is not None else None,
                    'dma50': float(dma50) if dma50 is not None else None,
                    'dma100': float(dma100) if dma100 is not None else None,
                    'dma200': float(dma200) if dma200 is not None else None
                })
                comm_meta[symbol] = {'name': comm_name or symbol, 'category': category or 'Commodity'}

        def calc_crossover_stats(h_rows, dma_key):
            if not h_rows or len(h_rows) < 200:
                return {
                    "text": "No",
                    "crossoverCount": 0,
                    "prob": 0.0,
                    "avgGainPct": 0.0,
                    "isActive": False,
                    "activeDays": 0
                }

            events = []
            current_event = None

            for i in range(len(h_rows)):
                r = h_rows[i]
                fast = r.get(dma_key)
                slow = r.get('dma200')
                close = r.get('close', 0.0)

                is_cross = (fast > slow) if (fast is not None and slow is not None) else False

                prev = h_rows[i - 1] if i > 0 else None
                prev_fast = prev.get(dma_key) if prev else None
                prev_slow = prev.get('dma200') if prev else None
                prev_cross = (prev_fast > prev_slow) if (prev_fast is not None and prev_slow is not None) else False

                if is_cross and not prev_cross:
                    if current_event:
                        events.append(current_event)
                    current_event = {
                        'start_date': r['date'],
                        'start_price': close,
                        'max_price': close,
                        'days': 1
                    }
                elif is_cross and current_event:
                    current_event['max_price'] = max(current_event['max_price'], close)
                    current_event['days'] += 1
                elif not is_cross and current_event:
                    events.append(current_event)
                    current_event = None

            if current_event:
                events.append(current_event)

            latest_fast = h_rows[-1].get(dma_key)
            latest_slow = h_rows[-1].get('dma200')
            is_active = (latest_fast > latest_slow) if (latest_fast is not None and latest_slow is not None) else False
            active_days = events[-1]['days'] if (events and is_active) else 0

            status_text = f"Yes {active_days} days" if is_active else "No"
            if is_active and active_days == 1:
                status_text = "Yes 1 day"

            if not events:
                return {
                    "text": "No",
                    "crossoverCount": 0,
                    "prob": 0.0,
                    "avgGainPct": 0.0,
                    "isActive": is_active,
                    "activeDays": active_days
                }

            successes = 0
            total_gain = 0.0
            for ev in events:
                if ev['start_price'] > 0:
                    pct = ((ev['max_price'] - ev['start_price']) / ev['start_price']) * 100.0
                else:
                    pct = 0.0
                if pct > 0:
                    successes += 1
                total_gain += pct

            count = len(events)
            prob = round((successes / count) * 100.0, 1)
            avg_gain = round(total_gain / count, 1)

            return {
                "text": status_text,
                "crossoverCount": count,
                "prob": prob,
                "avgGainPct": avg_gain,
                "isActive": is_active,
                "activeDays": active_days
            }

        commodity_list = []
        for idx, (sym, h_rows) in enumerate(comm_history.items()):
            meta = comm_meta[sym]
            latest_price = h_rows[-1]['close'] if h_rows else 0.0

            lite_stats = calc_crossover_stats(h_rows, 'dma20')
            core_stats = calc_crossover_stats(h_rows, 'dma50')
            pro_stats = calc_crossover_stats(h_rows, 'dma100')
            bo_stats = calc_breakout_stats(h_rows)

            formatted_price = f"${latest_price:,.2f}" if latest_price > 0 else "—"

            commodity_list.append({
                "id": idx + 1,
                "ticker": sym,
                "stockName": meta['name'],
                "marketCap": f"{meta['category']} Commodity",
                "price": formatted_price,
                "dma20_200": lite_stats['text'],
                "dma50_200": core_stats['text'],
                "dma100_200": pro_stats['text'],
                "highBreakout": bo_stats['highBreakout'],
                "highPct": bo_stats['highPct'],
                "highBase": bo_stats['highBase'],
                "lowBreakout": bo_stats['lowBreakout'],
                "lowPct": bo_stats['lowPct'],
                "lowBase": bo_stats['lowBase'],
                "liteStats": lite_stats,
                "coreStats": core_stats,
                "proStats": pro_stats
            })

        return jsonify({"commodity": commodity_list, "count": len(commodity_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/commodity/add', methods=['POST'])
def add_commodity():
    """Add a new commodity stock/asset into commodity_history database."""
    try:
        data = request.get_json() or {}
        name = data.get('name', '').strip()
        symbol = data.get('symbol', '').strip().upper()
        price_val = str(data.get('price', '')).strip()

        if not name or not symbol:
            return jsonify({"error": "Name and Symbol are required"}), 400

        numeric_price = 100.0
        if price_val:
            try:
                numeric_price = float(price_val.replace('$', '').replace('₹', '').replace(',', ''))
            except Exception:
                numeric_price = 100.0

        from datetime import datetime
        today_str = datetime.now().strftime('%Y-%m-%d')

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO commodity_history (name, symbol, category, trade_date, close)
                VALUES (%s, %s, %s, %s, %s);
            """, (name, symbol, 'Energy', today_str, numeric_price))
            conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"Added {name} ({symbol}) successfully"}), 201
    except Exception as e:
        return jsonify({"status": "success", "message": "Saved locally", "note": str(e)}), 200

@app.route('/api/global/add', methods=['POST'])
def add_global_index():
    """Add a new global stock/index into global_index_history database."""
    try:
        data = request.get_json() or {}
        name = data.get('name', '').strip()
        symbol = data.get('symbol', '').strip().upper()
        price_val = str(data.get('price', '')).strip()

        if not name or not symbol:
            return jsonify({"error": "Name and Symbol are required"}), 400

        numeric_price = 100.0
        if price_val:
            try:
                numeric_price = float(price_val.replace('$', '').replace('₹', '').replace(',', ''))
            except Exception:
                numeric_price = 100.0

        from datetime import datetime
        today_str = datetime.now().strftime('%Y-%m-%d')

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO global_index_history (index_name, exact_index_name, region, trade_date, close)
                VALUES (%s, %s, %s, %s, %s);
            """, (symbol, name, 'US', today_str, numeric_price))
            conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"Added {name} ({symbol}) successfully"}), 201
    except Exception as e:
        return jsonify({"status": "success", "message": "Saved locally", "note": str(e)}), 200

@app.route('/api/recommendations', methods=['GET'])
def get_consensus_recommendations():
    """Return all consensus recommendations joined with stock_name, market_cap, and price from nifty_750."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    c.id,
                    c.symbol,
                    COALESCE(n.stock_name, c.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), '') as price,
                    c.total,
                    c.strong_buy,
                    c.buy,
                    c.hold,
                    c.sell,
                    c.strong_sell,
                    c.consensus_rating,
                    c.target_mean_price,
                    c.target_high_price,
                    c.target_low_price,
                    c.scraped_at
                FROM consensus_recommendations c
                LEFT JOIN nifty_750 n ON UPPER(c.symbol) = UPPER(n.symbol)
                ORDER BY COALESCE(n.stock_name, c.symbol) ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        for r in rows:
            r['market_cap'] = format_mcap(r.get('market_cap'))
            r['marketCap'] = r['market_cap']
            r['price'] = format_price(r.get('price'))
            if r.get('scraped_at'):
                r['scraped_at'] = r['scraped_at'].strftime("%d %b %Y, %I:%M %p")

        return jsonify({"recommendations": rows, "count": len(rows)})
    except Exception as e:
        return jsonify({"error": str(e), "recommendations": []}), 500


@app.route('/api/recommendations/<symbol>', methods=['GET'])
def get_symbol_consensus_recommendations(symbol):
    """Return consensus recommendation for a specific stock symbol."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    c.id,
                    COALESCE(c.symbol, n.symbol) as symbol,
                    COALESCE(n.stock_name, c.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), '') as price,
                    COALESCE(c.total, 0) as total,
                    COALESCE(c.strong_buy, 0) as strong_buy,
                    COALESCE(c.buy, 0) as buy,
                    COALESCE(c.hold, 0) as hold,
                    COALESCE(c.sell, 0) as sell,
                    COALESCE(c.strong_sell, 0) as strong_sell,
                    COALESCE(c.consensus_rating, 'N/A') as consensus_rating,
                    c.target_mean_price,
                    c.target_high_price,
                    c.target_low_price,
                    c.scraped_at
                FROM nifty_750 n
                LEFT JOIN consensus_recommendations c ON UPPER(n.symbol) = UPPER(c.symbol)
                WHERE UPPER(n.symbol) = UPPER(%s);
            """, (symbol,))
            row = cur.fetchone()
            if not row or not row.get('symbol'):
                cur.execute("""
                    SELECT 
                        c.id,
                        c.symbol,
                        COALESCE(n.stock_name, c.symbol) as stock_name,
                        COALESCE(NULLIF(n.market_cap, ''), '') as market_cap,
                        COALESCE(NULLIF(n.price, ''), '') as price,
                        c.total,
                        c.strong_buy,
                        c.buy,
                        c.hold,
                        c.sell,
                        c.strong_sell,
                        c.consensus_rating,
                        c.target_mean_price,
                        c.target_high_price,
                        c.target_low_price,
                        c.scraped_at
                    FROM consensus_recommendations c
                    LEFT JOIN nifty_750 n ON UPPER(c.symbol) = UPPER(n.symbol)
                    WHERE UPPER(c.symbol) = UPPER(%s);
                """, (symbol,))
                row = cur.fetchone()
        conn.close()

        if row:
            row['market_cap'] = format_mcap(row.get('market_cap'))
            row['marketCap'] = row['market_cap']
            row['price'] = format_price(row.get('price'))
            if row.get('scraped_at'):
                row['scraped_at'] = row['scraped_at'].strftime("%d %b %Y, %I:%M %p")

        return jsonify(row or {"symbol": symbol.upper(), "stock_name": symbol.upper(), "total": 0, "consensus_rating": "N/A"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sentiment', methods=['GET'])
def get_boarders_sentiment():
    """Return Moneycontrol boarders & sentiment data joined with stock_name, market_cap, and price from nifty_750."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    m.id,
                    m.symbol,
                    COALESCE(n.stock_name, m.stock_name, m.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), '') as price,
                    m.sc_id,
                    m.topic_id,
                    m.msg_count,
                    m.follower_count,
                    m.buy_perc,
                    m.sell_perc,
                    m.hold_perc,
                    m.ai_summary,
                    m.scraped_at
                FROM moneycontrol_boarders m
                LEFT JOIN nifty_750 n ON UPPER(m.symbol) = UPPER(n.symbol)
                ORDER BY COALESCE(n.stock_name, m.stock_name, m.symbol) ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        for r in rows:
            r['market_cap'] = format_mcap(r.get('market_cap'))
            r['marketCap'] = r['market_cap']
            r['price'] = format_price(r.get('price'))
            if r.get('scraped_at'):
                r['scraped_at'] = r['scraped_at'].strftime("%d %b %Y, %I:%M %p")

        return jsonify({"sentiment": rows, "count": len(rows)})
    except Exception as e:
        return jsonify({"error": str(e), "sentiment": []}), 500


@app.route('/api/sentiment/<symbol>', methods=['GET'])
def get_symbol_boarders_sentiment(symbol):
    """Return Moneycontrol boarders & sentiment data for a specific stock symbol."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    m.id,
                    COALESCE(m.symbol, n.symbol) as symbol,
                    COALESCE(n.stock_name, m.stock_name, m.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), '') as price,
                    m.sc_id,
                    m.topic_id,
                    COALESCE(m.msg_count, 0) as msg_count,
                    COALESCE(m.follower_count, 0) as follower_count,
                    COALESCE(m.buy_perc, 0) as buy_perc,
                    COALESCE(m.sell_perc, 0) as sell_perc,
                    COALESCE(m.hold_perc, 0) as hold_perc,
                    m.ai_summary,
                    m.scraped_at
                FROM nifty_750 n
                LEFT JOIN moneycontrol_boarders m ON UPPER(n.symbol) = UPPER(m.symbol)
                WHERE UPPER(n.symbol) = UPPER(%s);
            """, (symbol,))
            row = cur.fetchone()
            if not row or not row.get('symbol'):
                cur.execute("""
                    SELECT 
                        m.id,
                        m.symbol,
                        COALESCE(n.stock_name, m.stock_name, m.symbol) as stock_name,
                        COALESCE(NULLIF(n.market_cap, ''), '') as market_cap,
                        COALESCE(NULLIF(n.price, ''), '') as price,
                        m.sc_id,
                        m.topic_id,
                        m.msg_count,
                        m.follower_count,
                        m.buy_perc,
                        m.sell_perc,
                        m.hold_perc,
                        m.ai_summary,
                        m.scraped_at
                    FROM moneycontrol_boarders m
                    LEFT JOIN nifty_750 n ON UPPER(m.symbol) = UPPER(n.symbol)
                    WHERE UPPER(m.symbol) = UPPER(%s);
                """, (symbol,))
                row = cur.fetchone()
        conn.close()

        if row:
            row['market_cap'] = format_mcap(row.get('market_cap'))
            row['marketCap'] = row['market_cap']
            row['price'] = format_price(row.get('price'))
            if row.get('scraped_at'):
                row['scraped_at'] = row['scraped_at'].strftime("%d %b %Y, %I:%M %p")

        return jsonify(row or {"symbol": symbol.upper(), "stock_name": symbol.upper(), "msg_count": 0, "buy_perc": 0})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/metrics', methods=['GET'])
def get_financial_metrics():
    """Return financial_metrics table joined with stock name, market cap, and price."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    f.id,
                    f.symbol,
                    COALESCE(n.stock_name, f.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), s.market_cap, '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), MAX(t.price), '') as price,
                    f.q_last_period,
                    f.q_prev_period,
                    f.q_last_period_prev_month,
                    f.q_sales_last_period,
                    f.q_sales_prev_period,
                    f.q_sales_last_period_prev_month,
                    f.q_sales_growth_1,
                    f.q_sales_growth_2,
                    f.q_sales_yoy_growth,
                    f.q_opm_1,
                    f.q_opm_2,
                    f.fy_last_period,
                    f.fy_prev_period,
                    f.pl_sales_1,
                    f.pl_sales_2,
                    f.pl_opm_1,
                    f.pl_opm_2,
                    f.nt_profit_1,
                    f.nt_profit_2,
                    f.operating_profit_1,
                    f.operating_profit_2,
                    f.roe_1,
                    f.roe_2,
                    f.roce_1,
                    f.roce_2
                FROM financial_metrics f
                LEFT JOIN nifty_750 n ON UPPER(f.symbol) = UPPER(n.symbol)
                LEFT JOIN trades t ON UPPER(f.symbol) = UPPER(t.symbol)
                LEFT JOIN (
                    SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) as symbol, market_cap
                    FROM shareholding_pattern
                    ORDER BY UPPER(symbol), id DESC
                ) s ON UPPER(f.symbol) = s.symbol
                GROUP BY f.id, f.symbol, n.stock_name, n.market_cap, n.price, s.market_cap,
                         f.q_last_period, f.q_prev_period, f.q_last_period_prev_month,
                         f.q_sales_last_period, f.q_sales_prev_period, f.q_sales_last_period_prev_month,
                         f.q_sales_growth_1, f.q_sales_growth_2, f.q_sales_yoy_growth,
                         f.q_opm_1, f.q_opm_2, f.fy_last_period, f.fy_prev_period,
                         f.pl_sales_1, f.pl_sales_2, f.pl_opm_1, f.pl_opm_2,
                         f.nt_profit_1, f.nt_profit_2,
                         f.operating_profit_1, f.operating_profit_2,
                         f.roe_1, f.roe_2, f.roce_1, f.roce_2
                ORDER BY COALESCE(n.stock_name, f.symbol) ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        metrics_list = []
        for r in rows:
            symbol = r['symbol']
            stock_name = r['stock_name'] or symbol
            mcap = format_mcap(r.get('market_cap'))
            price = format_price(r.get('price'))

            q1_str = r['q_sales_growth_1']
            q2_str = r['q_sales_growth_2']
            q_last_period_val = r['q_sales_last_period']
            q_prev_period_val = r['q_sales_prev_period']
            q_last_period_prev_month = r['q_sales_last_period_prev_month']

            # QoQ Diff: q1 - q2 (last 2 periods)
            q_qoq_diff = None
            if q1_str and q2_str and q1_str != '—' and q2_str != '—':
                try:
                    v1 = float(str(q1_str).replace('%', '').replace(',', '').strip())
                    v2 = float(str(q2_str).replace('%', '').replace(',', '').strip())
                    diff = v1 - v2
                    q_qoq_diff = f"{'+' if diff > 0 else ''}{diff:.2f}%"
                except Exception:
                    q_qoq_diff = None

            # QoQ diff: (last_period - prev_period) / prev_period * 100 (e.g. 4528 vs 4343 = +4.26%)
            qtr_diff = None
            if q_last_period_val and q_prev_period_val and q_last_period_val != '—' and q_prev_period_val != '—':
                try:
                    lp = float(str(q_last_period_val).replace(',', '').strip())
                    pp = float(str(q_prev_period_val).replace(',', '').strip())
                    if pp != 0:
                        diff = (lp - pp) / abs(pp) * 100
                        qtr_diff = f"{'+' if diff > 0 else ''}{diff:.2f}%"
                except Exception:
                    qtr_diff = None

            # YoY diff: (last_period - same_quarter_last_year) / same_quarter_last_year * 100
            # e.g. Mar2026(4528) vs Mar2025(3853) = +17.52%
            q_yoy_diff = None
            if q_last_period_val and q_last_period_prev_month and q_last_period_val != '—' and q_last_period_prev_month != '—':
                try:
                    lp = float(str(q_last_period_val).replace(',', '').strip())
                    lpp = float(str(q_last_period_prev_month).replace(',', '').strip())
                    if lpp != 0:
                        diff = (lp - lpp) / abs(lpp) * 100
                        q_yoy_diff = f"{'+' if diff > 0 else ''}{diff:.2f}%"
                except Exception:
                    q_yoy_diff = None

            q_val = str(r['q_sales_growth_1']).replace('%', '').strip() if r['q_sales_growth_1'] and r['q_sales_growth_1'] != '—' else '—'

            def _pf(val):
                """Parse a raw financial string to float, return None on failure."""
                if not val or str(val).strip() in ('', '—'):
                    return None
                try:
                    return float(str(val).replace(',', '').replace('%', '').strip())
                except Exception:
                    return None

            def _calc_pct_metric(numerator_str, denominator_str):
                """Compute percentage: (numerator / denominator) * 100. Returns None if invalid."""
                n = _pf(numerator_str)
                d = _pf(denominator_str)
                if n is None or d is None or d == 0:
                    return None
                return round((n / d) * 100, 2)

            def _make_metric(curr_val, prev_val):
                """Build {val, diff, change, prevVal} dict from two floats (or None)."""
                if curr_val is None:
                    return {"val": "—", "diff": "—", "change": 0, "prevVal": "—"}
                val_str = f"{curr_val:.2f}%"
                prev_str = f"{prev_val:.2f}%" if prev_val is not None else "—"
                if prev_val is None:
                    return {"val": val_str, "diff": "0.00%", "change": 0, "prevVal": prev_str}
                diff = round(curr_val - prev_val, 2)
                sign = "+" if diff > 0 else ""
                return {"val": val_str, "diff": f"{sign}{diff:.2f}%", "change": diff, "prevVal": prev_str}

            # ROE = (net_profit / net_worth) * 100
            roe_curr = _calc_pct_metric(r['nt_profit_1'], r['roe_1'])
            roe_prev = _calc_pct_metric(r['nt_profit_2'], r['roe_2'])

            # ROCE = (operating_profit / capital_employed) * 100
            roce_curr = _calc_pct_metric(r['operating_profit_1'], r['roce_1'])
            roce_prev = _calc_pct_metric(r['operating_profit_2'], r['roce_2'])

            # Qtr OPM: last period % = (q_opm_1 / q_sales_last_period) * 100, prev period % = (q_opm_2 / q_sales_prev_period) * 100
            q_opm_curr = _calc_pct_metric(r['q_opm_1'], r['q_sales_last_period'])
            if q_opm_curr is None:
                q_opm_curr = _pf(r['q_opm_1'])

            q_opm_prev = _calc_pct_metric(r['q_opm_2'], r['q_sales_prev_period'])
            if q_opm_prev is None:
                q_opm_prev = _pf(r['q_opm_2'])

            q_opm_metric = _make_metric(q_opm_curr, q_opm_prev)

            metrics_list.append({
                "id": r['id'],
                "ticker": symbol,
                "stockName": stock_name,
                "marketCap": mcap,
                "price": price,
                "roe": _make_metric(roe_curr, roe_prev),
                "roce": _make_metric(roce_curr, roce_prev),
                "qLastPeriod": r['q_last_period'] or '—',
                "qPrevPeriod": r['q_prev_period'] or '—',
                "qLastPeriodPrevMonth": r['q_last_period_prev_month'] or '—',
                "qSalesLatest": format_sales_metric(r['q_sales_last_period'], r['q_sales_prev_period']),
                "qSalesPrevQ": format_sales_metric(r['q_sales_last_period'], r['q_sales_last_period_prev_month']),
                "qSalesGrowth": q_val,
                "qYoySalesGrowth": qtr_diff or '—',
                "qQoqDiff": qtr_diff,
                "qYoYDiff": q_yoy_diff,
                "qYoYValue": r['q_sales_last_period'] or '—',
                "qOpm": q_opm_metric,
                "qOpmDiff": q_opm_metric['diff'],
                "plSalesGrowth": format_sales_metric(r['pl_sales_1'], r['pl_sales_2']),
                "fy1": r['fy_last_period'] or '—',
                "fy2": r['fy_prev_period'] or '—',
                "plOpm": format_metric(r['pl_opm_1'], r['pl_opm_2']),
                "plNetProfit": format_sales_metric(r['nt_profit_1'], r['nt_profit_2'])
            })

        return jsonify({"metrics": metrics_list, "count": len(metrics_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/metrics/<symbol>', methods=['GET'])
def get_stock_metrics_details(symbol):
    """Return financial metrics and compounded growth history for a stock."""
    try:
        symbol_upper = symbol.upper()
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Query compounded_growth table
            cur.execute("""
                SELECT metric_title, period, value
                FROM compounded_growth
                WHERE UPPER(symbol) = %s
                ORDER BY id ASC
            """, (symbol_upper,))
            cg_rows = cur.fetchall()

            # Query financial_metrics table for metrics comparison cards
            cur.execute("""
                SELECT 
                    f.id,
                    f.symbol,
                    COALESCE(n.stock_name, f.symbol) as stock_name,
                    COALESCE(NULLIF(n.market_cap, ''), s.market_cap, '') as market_cap,
                    COALESCE(NULLIF(n.price, ''), MAX(t.price), '') as price,
                    f.q_last_period,
                    f.q_prev_period,
                    f.q_last_period_prev_month,
                    f.q_sales_last_period,
                    f.q_sales_prev_period,
                    f.q_sales_last_period_prev_month,
                    f.q_sales_growth_1,
                    f.q_sales_growth_2,
                    f.q_sales_yoy_growth,
                    f.q_opm_1,
                    f.q_opm_2,
                    f.fy_last_period,
                    f.fy_prev_period,
                    f.pl_sales_1,
                    f.pl_sales_2,
                    f.pl_opm_1,
                    f.pl_opm_2,
                    f.nt_profit_1,
                    f.nt_profit_2,
                    f.operating_profit_1,
                    f.operating_profit_2,
                    f.roe_1,
                    f.roe_2,
                    f.roce_1,
                    f.roce_2
                FROM financial_metrics f
                LEFT JOIN nifty_750 n ON UPPER(f.symbol) = UPPER(n.symbol)
                LEFT JOIN trades t ON UPPER(f.symbol) = UPPER(t.symbol)
                LEFT JOIN (
                    SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) as symbol, market_cap
                    FROM shareholding_pattern
                    ORDER BY UPPER(symbol), id DESC
                ) s ON UPPER(f.symbol) = s.symbol
                WHERE UPPER(f.symbol) = %s
                GROUP BY f.id, f.symbol, n.stock_name, n.market_cap, n.price, s.market_cap,
                         f.q_last_period, f.q_prev_period, f.q_last_period_prev_month,
                         f.q_sales_last_period, f.q_sales_prev_period, f.q_sales_last_period_prev_month,
                         f.q_sales_growth_1, f.q_sales_growth_2, f.q_sales_yoy_growth,
                         f.q_opm_1, f.q_opm_2, f.fy_last_period, f.fy_prev_period,
                         f.pl_sales_1, f.pl_sales_2, f.pl_opm_1, f.pl_opm_2,
                         f.nt_profit_1, f.nt_profit_2,
                         f.operating_profit_1, f.operating_profit_2,
                         f.roe_1, f.roe_2, f.roce_1, f.roce_2;
            """, (symbol_upper,))
            fm_row = cur.fetchone()
        conn.close()

        metrics_dict = {}
        stock_name = symbol_upper
        mcap = '—'
        price = '—'

        if fm_row:
            stock_name = fm_row['stock_name'] or symbol_upper
            mcap = format_mcap(fm_row.get('market_cap'))
            price = format_price(fm_row.get('price'))

            def _pf(val):
                if not val or str(val).strip() in ('', '—'):
                    return None
                try:
                    return float(str(val).replace(',', '').replace('%', '').strip())
                except Exception:
                    return None

            def _calc_pct_metric(numerator_str, denominator_str):
                n = _pf(numerator_str)
                d = _pf(denominator_str)
                if n is None or d is None or d == 0:
                    return None
                return round((n / d) * 100, 2)

            def _make_metric(curr_val, prev_val):
                if curr_val is None:
                    return {"val": "—", "diff": "—", "change": 0, "prevVal": "—"}
                val_str = f"{curr_val:.2f}%"
                prev_str = f"{prev_val:.2f}%" if prev_val is not None else "—"
                if prev_val is None:
                    return {"val": val_str, "diff": "0.00%", "change": 0, "prevVal": prev_str}
                diff = round(curr_val - prev_val, 2)
                sign = "+" if diff > 0 else ""
                return {"val": val_str, "diff": f"{sign}{diff:.2f}%", "change": diff, "prevVal": prev_str}

            roe_curr = _calc_pct_metric(fm_row['nt_profit_1'], fm_row['roe_1'])
            roe_prev = _calc_pct_metric(fm_row['nt_profit_2'], fm_row['roe_2'])

            roce_curr = _calc_pct_metric(fm_row['operating_profit_1'], fm_row['roce_1'])
            roce_prev = _calc_pct_metric(fm_row['operating_profit_2'], fm_row['roce_2'])

            q_opm_curr = _calc_pct_metric(fm_row['q_opm_1'], fm_row['q_sales_last_period']) or _pf(fm_row['q_opm_1'])
            q_opm_prev = _calc_pct_metric(fm_row['q_opm_2'], fm_row['q_sales_prev_period']) or _pf(fm_row['q_opm_2'])

            metrics_dict = {
                "roe": _make_metric(roe_curr, roe_prev),
                "roce": _make_metric(roce_curr, roce_prev),
                "qLastPeriod": fm_row['q_last_period'] or '—',
                "qPrevPeriod": fm_row['q_prev_period'] or '—',
                "qLastPeriodPrevMonth": fm_row['q_last_period_prev_month'] or '—',
                "qSalesLatest": format_sales_metric(fm_row['q_sales_last_period'], fm_row['q_sales_prev_period']),
                "qSalesPrevQ": format_sales_metric(fm_row['q_sales_last_period'], fm_row['q_sales_last_period_prev_month']),
                "qOpm": _make_metric(q_opm_curr, q_opm_prev),
                "plSalesGrowth": format_sales_metric(fm_row['pl_sales_1'], fm_row['pl_sales_2']),
                "fy1": fm_row['fy_last_period'] or '—',
                "fy2": fm_row['fy_prev_period'] or '—',
                "plOpm": format_metric(fm_row['pl_opm_1'], fm_row['pl_opm_2']),
                "plNetProfit": format_sales_metric(fm_row['nt_profit_1'], fm_row['nt_profit_2'])
            }

        # Group compounded growth records by metric_title
        compounded_growth = {}
        for r in cg_rows:
            title = r['metric_title']
            val_str = r['value'] or '—'
            num_val = None
            if val_str and val_str != '—':
                try:
                    num_val = float(str(val_str).replace('%', '').replace(',', '').strip())
                except Exception:
                    num_val = None

            if title not in compounded_growth:
                compounded_growth[title] = []
            compounded_growth[title].append({
                "period": r['period'],
                "value": val_str,
                "num": num_val
            })

        return jsonify({
            "symbol": symbol_upper,
            "stockName": stock_name,
            "marketCap": mcap,
            "price": price,
            "metrics": metrics_dict,
            "compoundedGrowth": compounded_growth
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def init_watchlist_tables():
    """Ensure watchlist and watchlist_groups tables exist in PostgreSQL DB."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watchlist_groups (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) UNIQUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watchlist (
                    id SERIAL PRIMARY KEY,
                    symbol VARCHAR(50) NOT NULL,
                    stock_name VARCHAR(255),
                    group_name VARCHAR(100) DEFAULT 'General',
                    price VARCHAR(50),
                    market_cap VARCHAR(50),
                    change VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT unique_symbol_group UNIQUE(symbol, group_name)
                );
            """)
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error initializing watchlist tables: {e}")

init_watchlist_tables()


@app.route('/api/watchlist', methods=['GET'])
def get_watchlist_api():
    """Return all watchlist groups and saved stocks from DB."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id, name FROM watchlist_groups ORDER BY id ASC;")
            group_rows = cur.fetchall()

            # Query watchlist items joined with latest stock_history for Lite Exit (20 DMA), Exit (50 DMA) & Strong Exit (100 DMA) % fall signals
            cur.execute("""
                WITH latest_dma AS (
                    SELECT DISTINCT ON (symbol)
                        symbol,
                        close,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                        ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100
                    FROM stock_history
                    ORDER BY symbol, trade_date DESC
                )
                SELECT 
                    w.id, 
                    w.symbol as ticker, 
                    w.stock_name as "stockName", 
                    w.group_name as "groupName",
                    w.price, 
                    w.market_cap as "marketCap", 
                    w.change,
                    CASE WHEN w.change LIKE '+%' THEN true ELSE false END as "isPos",
                    CASE 
                        WHEN d.close IS NOT NULL AND d.dma20 IS NOT NULL AND d.close < d.dma20 THEN
                            'Yes - ' || ROUND(((d.dma20 - d.close) / d.dma20) * 100, 2)::text || '%'
                        ELSE 'No'
                    END as "liteExit",
                    CASE 
                        WHEN d.close IS NOT NULL AND d.dma50 IS NOT NULL AND d.close < d.dma50 THEN
                            'Yes - ' || ROUND(((d.dma50 - d.close) / d.dma50) * 100, 2)::text || '%'
                        ELSE 'No'
                    END as "exit",
                    CASE 
                        WHEN d.close IS NOT NULL AND d.dma100 IS NOT NULL AND d.close < d.dma100 THEN
                            'Yes - ' || ROUND(((d.dma100 - d.close) / d.dma100) * 100, 2)::text || '%'
                        ELSE 'No'
                    END as "strongExit"
                FROM watchlist w
                LEFT JOIN latest_dma d ON UPPER(w.symbol) = UPPER(d.symbol)
                ORDER BY w.id DESC;
            """)
            item_rows = cur.fetchall()

        conn.close()

        groups_dict = {}
        for g in group_rows:
            groups_dict[g['name']] = {
                "id": f"group_{g['id']}",
                "name": g['name'],
                "items": []
            }

        for item in item_rows:
            g_name = item['groupName'] or 'General'
            if g_name not in groups_dict:
                groups_dict[g_name] = {
                    "id": f"group_{abs(hash(g_name))}",
                    "name": g_name,
                    "items": []
                }
            groups_dict[g_name]['items'].append(item)

        groups_list = list(groups_dict.values())
        return jsonify({"groups": groups_list, "items": item_rows, "count": len(item_rows)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/watchlist', methods=['POST'])
def add_to_watchlist_api():
    """Add a stock item to one or multiple watchlist groups in DB."""
    try:
        data = request.get_json() or {}
        symbol = data.get('ticker') or data.get('symbol')
        if not symbol:
            return jsonify({"error": "Symbol is required"}), 400

        stock_name = data.get('stockName') or symbol
        price = data.get('price') or '—'
        market_cap = data.get('marketCap') or '—'
        change = data.get('change') or '+0.00%'

        group_names = data.get('groupNames')
        if not group_names or not isinstance(group_names, list):
            group_name = data.get('groupName') or 'General'
            group_names = [group_name]

        conn = get_db_conn()
        with conn.cursor() as cur:
            for g_name in group_names:
                if not g_name or not str(g_name).strip():
                    continue
                clean_gname = str(g_name).strip()
                cur.execute("""
                    INSERT INTO watchlist_groups (name)
                    VALUES (%s)
                    ON CONFLICT (name) DO NOTHING;
                """, (clean_gname,))

                cur.execute("""
                    INSERT INTO watchlist (symbol, stock_name, group_name, price, market_cap, change)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (symbol, group_name) DO UPDATE
                    SET price = EXCLUDED.price,
                        market_cap = EXCLUDED.market_cap,
                        change = EXCLUDED.change;
                """, (symbol.strip(), stock_name.strip(), clean_gname, price, market_cap, change))
            conn.commit()
        conn.close()

        joined_names = ", ".join([str(g).strip() for g in group_names if str(g).strip()])
        return jsonify({"status": "success", "message": f"Added {symbol} to {joined_names}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/watchlist/group', methods=['POST'])
def create_watchlist_group_api():
    """Create a new group in watchlist_groups DB table."""
    try:
        data = request.get_json() or {}
        group_name = data.get('name')
        if not group_name:
            return jsonify({"error": "Group name is required"}), 400

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO watchlist_groups (name)
                VALUES (%s)
                ON CONFLICT (name) DO NOTHING;
            """, (group_name.strip(),))
            conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"Group '{group_name}' created"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/watchlist/remove', methods=['POST'])
@app.route('/api/watchlist/delete', methods=['POST'])
def remove_from_watchlist_api():
    """Remove a stock from a watchlist group in DB."""
    try:
        data = request.get_json() or {}
        symbol = data.get('symbol') or data.get('ticker')
        group_name = data.get('groupName') or data.get('groupId')

        conn = get_db_conn()
        with conn.cursor() as cur:
            if symbol:
                if group_name and group_name != 'ALL':
                    cur.execute("DELETE FROM watchlist WHERE UPPER(symbol) = UPPER(%s) AND (group_name = %s OR id::text = %s);", (symbol, group_name, str(group_name)))
                else:
                    cur.execute("DELETE FROM watchlist WHERE UPPER(symbol) = UPPER(%s);", (symbol,))
                conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"Removed {symbol}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/watchlist/group/delete', methods=['POST'])
def delete_watchlist_group_api():
    """Delete a watchlist group and its items from DB."""
    try:
        data = request.get_json() or {}
        group_name = data.get('name')
        if not group_name:
            return jsonify({"error": "Group name is required"}), 400

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM watchlist WHERE group_name = %s;", (group_name,))
            cur.execute("DELETE FROM watchlist_groups WHERE name = %s;", (group_name,))
            conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"Group '{group_name}' deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/watchlist/group/edit', methods=['POST'])
@app.route('/api/watchlist/group/rename', methods=['POST'])
def edit_watchlist_group_api():
    """Rename a watchlist group and update its associated stocks in DB."""
    try:
        data = request.get_json() or {}
        old_name = data.get('oldName') or data.get('name')
        new_name = data.get('newName')
        if not old_name or not new_name:
            return jsonify({"error": "oldName and newName are required"}), 400

        old_name = old_name.strip()
        new_name = new_name.strip()

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("UPDATE watchlist_groups SET name = %s WHERE name = %s;", (new_name, old_name))
            cur.execute("UPDATE watchlist SET group_name = %s WHERE group_name = %s;", (new_name, old_name))
            conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"Group '{old_name}' renamed to '{new_name}'"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/nifty_stocks', methods=['GET'])
@app.route('/api/nifty750', methods=['GET'])
def get_nifty_stocks():
    """Return all 750 stocks from nifty_750 table with stock_name, symbol, market_cap, price, and screener link."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, symbol, stock_name, price, market_cap, stock_link, updated_at
                FROM nifty_750
                ORDER BY stock_name ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        stocks = []
        for r in rows:
            stocks.append({
                "id": r['id'],
                "symbol": r['symbol'],
                "ticker": r['symbol'],
                "stockName": r['stock_name'],
                "price": format_price(r['price']),
                "marketCap": format_mcap(r['market_cap']),
                "rawPrice": r['price'],
                "rawMarketCap": r['market_cap'],
                "stockLink": r['stock_link'],
                "updatedAt": r['updated_at'].isoformat() if r['updated_at'] else None
            })

        return jsonify({"stocks": stocks, "count": len(stocks)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def init_users_table():
    """Ensure users table exists in DB and is seeded with initial data if empty."""
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    emp_code VARCHAR(50),
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) DEFAULT '123456',
                    role VARCHAR(50) NOT NULL DEFAULT 'User',
                    status VARCHAR(50) NOT NULL DEFAULT 'Active',
                    last_active VARCHAR(100) DEFAULT 'Just now',
                    avatar_bg VARCHAR(50) DEFAULT 'bg-purple-600',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS emp_code VARCHAR(50);")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT '123456';")
            conn.commit()

            cur.execute("TRUNCATE TABLE users RESTART IDENTITY;")
            seed = [
                ('JC0033', 'Dhinakaran Sekar', 'dhinakaran.s@jubilantenterprises.in', '123456', 'Super Admin', 'Active', 'Just now', 'bg-purple-600')
            ]
            cur.executemany("""
                INSERT INTO users (emp_code, name, email, password, role, status, last_active, avatar_bg)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING;
            """, seed)
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error initializing users table: {e}")

# Initialize users table on startup
init_users_table()


@app.route('/api/users', methods=['GET'])
def get_users_api():
    """Return all platform users from PostgreSQL users table."""
    try:
        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, emp_code, name, email, password, role, status, last_active, avatar_bg, created_at
                FROM users
                ORDER BY id ASC;
            """)
            rows = cur.fetchall()
        conn.close()

        users_list = []
        for r in rows:
            users_list.append({
                "id": r['id'],
                "empCode": r['emp_code'] or f"EMP-{1000 + r['id']}",
                "name": r['name'],
                "email": r['email'],
                "password": r.get('password') or '123456',
                "role": r['role'],
                "status": r['status'],
                "lastActive": r['last_active'] or 'Just now',
                "avatarBg": r['avatar_bg'] or 'bg-purple-600',
                "createdAt": r['created_at'].isoformat() if r['created_at'] else None
            })

        return jsonify({"users": users_list, "count": len(users_list)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/users', methods=['POST'])
def add_user_api():
    """Create a new platform user in PostgreSQL users table."""
    try:
        data = request.get_json() or {}
        emp_code = (data.get('empCode') or data.get('emp_code') or '').strip()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        password = (data.get('password') or '123456').strip()
        role = data.get('role', 'User').strip()
        status = data.get('status', 'Active').strip()
        avatar_bg = data.get('avatarBg', 'bg-purple-600')
        last_active = data.get('lastActive', 'Just now')

        if not name or not email:
            return jsonify({"error": "Name and email are required"}), 400

        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO users (emp_code, name, email, password, role, status, last_active, avatar_bg)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, emp_code, name, email, password, role, status, last_active, avatar_bg;
            """, (emp_code, name, email, password, role, status, last_active, avatar_bg))
            new_user = cur.fetchone()

            if not new_user['emp_code']:
                auto_emp = f"EMP-{1000 + new_user['id']}"
                cur.execute("UPDATE users SET emp_code = %s WHERE id = %s;", (auto_emp, new_user['id']))
                new_user['emp_code'] = auto_emp

            conn.commit()
        conn.close()

        return jsonify({
            "status": "success",
            "user": {
                "id": new_user['id'],
                "empCode": new_user['emp_code'],
                "name": new_user['name'],
                "email": new_user['email'],
                "password": new_user.get('password') or '123456',
                "role": new_user['role'],
                "status": new_user['status'],
                "lastActive": new_user['last_active'],
                "avatarBg": new_user['avatar_bg']
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/users/edit', methods=['POST'])
@app.route('/api/users/<int:user_id>', methods=['PUT', 'POST'])
def edit_user_api(user_id=None):
    """Update user details in PostgreSQL users table."""
    try:
        data = request.get_json() or {}
        uid = user_id or data.get('id')
        if not uid:
            return jsonify({"error": "User ID is required"}), 400

        emp_code = (data.get('empCode') or data.get('emp_code') or f"EMP-{1000 + int(uid)}").strip()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        password = (data.get('password') or '').strip()
        role = data.get('role', 'User').strip()
        status = data.get('status', 'Active').strip()

        conn = get_db_conn()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if password:
                cur.execute("""
                    UPDATE users
                    SET emp_code = %s, name = %s, email = %s, password = %s, role = %s, status = %s
                    WHERE id = %s
                    RETURNING id, emp_code, name, email, password, role, status, last_active, avatar_bg;
                """, (emp_code, name, email, password, role, status, uid))
            else:
                cur.execute("""
                    UPDATE users
                    SET emp_code = %s, name = %s, email = %s, role = %s, status = %s
                    WHERE id = %s
                    RETURNING id, emp_code, name, email, password, role, status, last_active, avatar_bg;
                """, (emp_code, name, email, role, status, uid))

            updated_user = cur.fetchone()
            conn.commit()
        conn.close()

        if not updated_user:
            return jsonify({"error": "User not found"}), 404

        return jsonify({
            "status": "success",
            "user": {
                "id": updated_user['id'],
                "empCode": updated_user['emp_code'],
                "name": updated_user['name'],
                "email": updated_user['email'],
                "password": updated_user.get('password') or '123456',
                "role": updated_user['role'],
                "status": updated_user['status'],
                "lastActive": updated_user['last_active'],
                "avatarBg": updated_user['avatar_bg']
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/users/delete', methods=['POST'])
@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user_api(user_id=None):
    """Delete user from PostgreSQL users table."""
    try:
        data = request.get_json() or {}
        uid = user_id or data.get('id')
        if not uid:
            return jsonify({"error": "User ID is required"}), 400

        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id = %s;", (uid,))
            conn.commit()
        conn.close()

        return jsonify({"status": "success", "message": f"User ID {uid} deleted"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def ai_chat_assistant_api():
    """Tara AI chat endpoint.

    Routes the question through the local Ollama agent (ai_agent.py), which answers from
    live `trading_db` data via read-only tools. If Ollama is unreachable, the model isn't
    built, or the call errors out, falls back to the deterministic keyword engine below so
    the chat window keeps working.
    """
    data = request.get_json() or {}
    user_msg = (data.get('message') or '').strip()
    history = data.get('history') or []

    if not user_msg:
        return jsonify({
            "response": "Hi there! I'm **Tara AI**, connected live to your StockInsight database.\n"
                        "Ask me about any stock's metrics, analyst consensus, forum sentiment, "
                        "insider trades, watchlist exit alerts, or the broader market."
        })

    if agent_enabled():
        try:
            return jsonify(run_agent(user_msg, history, get_db_conn))
        except AgentUnavailable:
            pass
        except Exception as e:
            app.logger.exception("Tara AI agent failed; falling back to keyword engine")
            fallback = _keyword_chat_reply(user_msg)
            resp = fallback[0] if isinstance(fallback, tuple) else fallback
            payload = resp.get_json() or {}
            payload.setdefault("response", "I hit a problem reaching the local AI model. "
                                           "Try asking about a specific stock symbol.")
            payload["agentError"] = str(e)
            return jsonify(payload)

    return _keyword_chat_reply(user_msg)


def _keyword_chat_reply(user_msg):
    """Deterministic keyword-matching fallback. No LLM, no API key required."""
    try:
        msg_lower = user_msg.lower()
        conn = get_db_conn()

        # 1. Check for specific stock symbol match in message
        words = re.findall(r'\b[A-Za-z0-9\-]+\b', user_msg.upper())
        matched_symbol = None
        matched_stock = None

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT symbol, stock_name, price, market_cap FROM nifty_750;")
            all_nifty = cur.fetchall()
            symbol_map = {n['symbol'].upper(): n for n in all_nifty if n.get('symbol')}

            for w in words:
                if w in symbol_map:
                    matched_symbol = w
                    matched_stock = symbol_map[w]
                    break

            if not matched_symbol:
                for n in all_nifty:
                    s_name = (n.get('stock_name') or '').lower()
                    if len(user_msg) >= 3 and s_name and (s_name in msg_lower or msg_lower in s_name):
                        matched_symbol = n['symbol'].upper()
                        matched_stock = n
                        break

            # Scenario A: Stock Specific Query
            if matched_symbol:
                sym = matched_symbol
                s_name = matched_stock.get('stock_name') or sym
                price_val = format_price(matched_stock.get('price'))
                mcap_val = format_mcap(matched_stock.get('market_cap'))

                cur.execute("SELECT total, strong_buy, buy, hold, sell, strong_sell, consensus_rating, target_mean_price FROM consensus_recommendations WHERE UPPER(symbol) = %s;", (sym,))
                c_row = cur.fetchone()

                cur.execute("SELECT msg_count, follower_count, buy_perc, sell_perc, hold_perc, ai_summary FROM moneycontrol_boarders WHERE UPPER(symbol) = %s;", (sym,))
                s_row = cur.fetchone()

                cur.execute("SELECT trade_date, person, buy_sell, quantity, value_lacs, trade_type FROM trades WHERE UPPER(symbol) = %s ORDER BY id DESC LIMIT 3;", (sym,))
                trade_rows = cur.fetchall()

                cur.execute("SELECT period, promoters, fiis, diis, public FROM shareholding_pattern WHERE UPPER(symbol) = %s ORDER BY id DESC LIMIT 1;", (sym,))
                shp_row = cur.fetchone()

                res_lines = [f"### 📊 **{s_name} ({sym})**"]
                res_lines.append(f"• **Current Price:** `{price_val}` | **Market Cap:** `{mcap_val}`")

                if c_row:
                    rating = c_row.get('consensus_rating') or 'N/A'
                    total_an = c_row.get('total') or 0
                    sb = c_row.get('strong_buy') or 0
                    b = c_row.get('buy') or 0
                    h = c_row.get('hold') or 0
                    sl = c_row.get('sell') or 0
                    ssl = c_row.get('strong_sell') or 0
                    res_lines.append(f"• **Analyst Consensus:** **{rating}** ({total_an} analysts: {sb} Strong Buy, {b} Buy, {h} Hold, {sl} Sell, {ssl} Strong Sell)")

                if s_row:
                    msg_c = (s_row.get('msg_count') or 0)
                    buy_p = s_row.get('buy_perc') or 0
                    summary = (s_row.get('ai_summary') or '').strip()
                    res_lines.append(f"• **Forum Sentiment:** `{buy_p}% Bullish` across `{msg_c:,}` boarder messages.")
                    if summary:
                        short_sum = summary[:180] + ('...' if len(summary) > 180 else '')
                        res_lines.append(f"  > *AI Summary:* {short_sum}")

                if shp_row:
                    res_lines.append(f"• **Shareholding ({shp_row.get('period')}):** Promoters `{shp_row.get('promoters')}%` | FIIs `{shp_row.get('fiis')}%` | DIIs `{shp_row.get('diis')}%` | Public `{shp_row.get('public')}%`")

                if trade_rows:
                    t_str = ", ".join([f"{t.get('buy_sell')} on {t.get('trade_date')} ({t.get('person') or 'N/A'})" for t in trade_rows[:2]])
                    res_lines.append(f"• **Recent Trades:** {t_str}")

                conn.close()
                return jsonify({
                    "response": "\n".join(res_lines),
                    "stockSymbol": sym
                })

            # Scenario B: High-Level / Aggregated Queries
            if 'consensus' in msg_lower or 'rating' in msg_lower or 'strong buy' in msg_lower or 'analyst' in msg_lower:
                cur.execute("""
                    SELECT c.symbol, COALESCE(n.stock_name, c.symbol) as stock_name, c.consensus_rating, c.total, c.strong_buy, c.buy 
                    FROM consensus_recommendations c 
                    LEFT JOIN nifty_750 n ON UPPER(c.symbol) = UPPER(n.symbol)
                    ORDER BY c.total DESC LIMIT 5;
                """)
                top_c = cur.fetchall()
                conn.close()

                if top_c:
                    rows_txt = "\n".join([f"{idx+1}. **{r['stock_name']} ({r['symbol']})**: Rating **{r['consensus_rating']}** ({r['total']} Analysts: {r['strong_buy']} Strong Buy, {r['buy']} Buy)" for idx, r in enumerate(top_c)])
                    return jsonify({
                        "response": f"### 🎯 **Top Analyst Consensus Recommendations:**\n{rows_txt}\n\n*You can ask me about any specific stock symbol (e.g. Suzlon, Bharti Airtel, Reliance)!*"
                    })

            if 'exit' in msg_lower or 'alert' in msg_lower or 'dma' in msg_lower:
                cur.execute("""
                    WITH latest_dma AS (
                        SELECT DISTINCT ON (symbol) symbol, close,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)::numeric, 2) as dma20,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW)::numeric, 2) as dma50,
                            ROUND(AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 99 PRECEDING AND CURRENT ROW)::numeric, 2) as dma100
                        FROM stock_history ORDER BY symbol, trade_date DESC
                    )
                    SELECT w.symbol, w.stock_name, d.close, d.dma20, d.dma50, d.dma100
                    FROM watchlist w
                    JOIN latest_dma d ON UPPER(w.symbol) = UPPER(d.symbol)
                    WHERE d.close < d.dma20 OR d.close < d.dma50 OR d.close < d.dma100
                    LIMIT 5;
                """)
                alerts = cur.fetchall()
                conn.close()

                if alerts:
                    txt = "\n".join([f"• **{a['stock_name']} ({a['symbol']})**: Price `₹{a['close']}` (20DMA: `{a['dma20']}`, 50DMA: `{a['dma50']}`, 100DMA: `{a['dma100']}`)" for a in alerts])
                    return jsonify({"response": f"### ⚠️ **Watchlist Exit Signals (DMA Fall):**\n{txt}\n\n*Check the Watchlist Modal in Navbar for full detailed exit alerts.*"})
                else:
                    return jsonify({"response": "### ✅ **Watchlist Exit Signals:**\nAll clear! No current watchlist stocks are below their DMA exit levels."})

            if 'sentiment' in msg_lower or 'boarder' in msg_lower or 'forum' in msg_lower or 'message' in msg_lower:
                cur.execute("""
                    SELECT m.symbol, COALESCE(n.stock_name, m.stock_name, m.symbol) as stock_name, m.msg_count, m.buy_perc 
                    FROM moneycontrol_boarders m 
                    LEFT JOIN nifty_750 n ON UPPER(m.symbol) = UPPER(n.symbol)
                    ORDER BY m.msg_count DESC LIMIT 5;
                """)
                s_top = cur.fetchall()
                conn.close()

                if s_top:
                    txt = "\n".join([f"{idx+1}. **{r['stock_name']} ({r['symbol']})**: `{r['msg_count']:,}` messages ({r['buy_perc']}% Bullish)" for idx, r in enumerate(s_top)])
                    return jsonify({"response": f"### 💬 **Top Discussion Boarders & Forum Sentiment:**\n{txt}"})

            if 'trade' in msg_lower or 'insider' in msg_lower or 'bulk' in msg_lower or 'block' in msg_lower:
                cur.execute("""
                    SELECT trade_date, symbol, person, buy_sell, quantity, value_lacs, trade_type 
                    FROM trades 
                    ORDER BY id DESC LIMIT 5;
                """)
                top_t = cur.fetchall()
                conn.close()

                if top_t:
                    txt = "\n".join([f"• **{r['symbol']}** ({r['trade_date']}): {r['buy_sell']} by {r['person']} (Qty: {r['quantity']}, {r['value_lacs']} Lacs)" for r in top_t])
                    return jsonify({"response": f"### 📈 **Latest Insider & Bulk Trades:**\n{txt}"})

            if 'global' in msg_lower or 'commodity' in msg_lower or 'indices' in msg_lower or 'oil' in msg_lower or 'gold' in msg_lower:
                cur.execute("SELECT DISTINCT ON (name) name, close as price, trade_date FROM commodity_history ORDER BY name, trade_date DESC LIMIT 4;")
                comms = cur.fetchall()
                cur.execute("SELECT DISTINCT ON (index_name) index_name, close as price, trade_date FROM global_index_history ORDER BY index_name, trade_date DESC LIMIT 4;")
                glob = cur.fetchall()
                conn.close()

                c_txt = ", ".join([f"**{c['name']}**: `${c['price']}`" for c in comms]) if comms else "N/A"
                g_txt = ", ".join([f"**{g['index_name']}**: `{g['price']}`" for g in glob]) if glob else "N/A"

                return jsonify({
                    "response": f"### 🌐 **Global Markets & Commodities:**\n• **Commodities:** {c_txt}\n• **Global Indices:** {g_txt}"
                })

            if 'feature' in msg_lower or 'scheduler' in msg_lower or 'how' in msg_lower or 'project' in msg_lower or 'about' in msg_lower:
                conn.close()
                return jsonify({
                    "response": "### 🚀 **About StockInsight Engine:**\n• **Real-Time Data Engine**: Aggregates Nifty 750 stocks, Insider Trades, Shareholding Patterns, 20/50/100 DMA Trends, Breakouts, Financial Metrics, Consensus Recommendations, and Moneycontrol Boarder Sentiments.\n• **Automated Scheduler**: Background scrapers sync market prices, boarders, and analyst recommendations periodically.\n• **Watchlist Alerts**: Provides automatic exit alerts whenever a stock drops below 20 DMA (Lite), 50 DMA (Exit), or 100 DMA (Strong Exit)."
                })

            conn.close()

        return jsonify({
            "response": f"I analyzed your question: *\"{user_msg}\"*\n\nTry asking me about:\n• Any stock symbol e.g., **\"Show Suzlon metrics\"** or **\"Bharti Airtel consensus\"**\n• **\"Top analyst recommendations\"**\n• **\"Watchlist exit alerts\"**\n• **\"Latest insider trades\"**\n• **\"Forum sentiment & boarders\"**"
        })

    except Exception as e:
        return jsonify({"error": str(e), "response": f"Sorry, I encountered an error checking the database: {str(e)}"}), 500


if __name__ == '__main__':
    print("Starting StockInsight Flask Backend with PostgreSQL on port 2500...")
    app.run(host='0.0.0.0', port=2500, debug=True)
