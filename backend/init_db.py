"""
Database Initialization & Column Verification Module for StockInsight

Ensures PostgreSQL database 'trading_db' exists, and verifies that all 13 required tables
and their respective columns exist. If any table or column is missing, it is created automatically.
"""

import sys
import logging
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

TABLE_DEFINITIONS = [
    {
        "table": "nifty_750",
        "create": """
            CREATE TABLE IF NOT EXISTS nifty_750 (
                id          SERIAL PRIMARY KEY,
                stock_name  TEXT,
                symbol      VARCHAR(50),
                stock_link  TEXT,
                price       VARCHAR(50),
                market_cap  VARCHAR(100),
                updated_at  TIMESTAMP DEFAULT NOW()
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("stock_name", "TEXT"),
            ("symbol", "VARCHAR(50)"),
            ("stock_link", "TEXT"),
            ("price", "VARCHAR(50)"),
            ("market_cap", "VARCHAR(100)"),
            ("updated_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "trades",
        "create": """
            CREATE TABLE IF NOT EXISTS trades (
                id            SERIAL PRIMARY KEY,
                trade_date    VARCHAR(50),
                person        TEXT,
                designation   TEXT,
                buy_sell      VARCHAR(10),
                quantity      VARCHAR(50),
                price         VARCHAR(50),
                value_lacs    VARCHAR(50),
                mode          TEXT,
                percent       VARCHAR(50),
                symbol        VARCHAR(50),
                trade_type    VARCHAR(50),
                scraped_at    TIMESTAMP DEFAULT NOW()
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("trade_date", "VARCHAR(50)"),
            ("person", "TEXT"),
            ("designation", "TEXT"),
            ("buy_sell", "VARCHAR(10)"),
            ("quantity", "VARCHAR(50)"),
            ("price", "VARCHAR(50)"),
            ("value_lacs", "VARCHAR(50)"),
            ("mode", "TEXT"),
            ("percent", "VARCHAR(50)"),
            ("symbol", "VARCHAR(50)"),
            ("trade_type", "VARCHAR(50)"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "shareholding_pattern",
        "create": """
            CREATE TABLE IF NOT EXISTS shareholding_pattern (
                id               SERIAL PRIMARY KEY,
                symbol           VARCHAR(50)   NOT NULL,
                period           VARCHAR(20)   NOT NULL,
                period_type      VARCHAR(10)   NOT NULL DEFAULT 'quarterly',
                promoters        VARCHAR(10),
                fiis             VARCHAR(10),
                diis             VARCHAR(10),
                public           VARCHAR(10),
                num_shareholders VARCHAR(20),
                market_cap       VARCHAR(30),
                scraped_at       TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unique_shp_symbol_period UNIQUE (symbol, period, period_type)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("symbol", "VARCHAR(50)"),
            ("period", "VARCHAR(20)"),
            ("period_type", "VARCHAR(10) DEFAULT 'quarterly'"),
            ("promoters", "VARCHAR(10)"),
            ("fiis", "VARCHAR(10)"),
            ("diis", "VARCHAR(10)"),
            ("public", "VARCHAR(10)"),
            ("num_shareholders", "VARCHAR(20)"),
            ("market_cap", "VARCHAR(30)"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "financial_metrics",
        "create": """
            CREATE TABLE IF NOT EXISTS financial_metrics (
                id                  SERIAL PRIMARY KEY,
                symbol              VARCHAR(50) UNIQUE NOT NULL,
                q_last_period       VARCHAR(100),
                q_prev_period       VARCHAR(100),
                q_last_period_prev_month VARCHAR(100),
                q_sales_last_period VARCHAR(100),
                q_sales_prev_period VARCHAR(100),
                q_sales_last_period_prev_month VARCHAR(100),
                q_sales_growth_1    VARCHAR(100),
                q_sales_growth_2    VARCHAR(100),
                q_sales_yoy_growth  VARCHAR(100),
                q_opm_1             VARCHAR(100),
                q_opm_2             VARCHAR(100),
                fy_last_period      VARCHAR(100),
                fy_prev_period      VARCHAR(100),
                pl_sales_1          VARCHAR(100),
                pl_sales_2          VARCHAR(100),
                pl_opm_1            VARCHAR(100),
                pl_opm_2            VARCHAR(100),
                nt_profit_1         VARCHAR(100),
                nt_profit_2         VARCHAR(100),
                operating_profit_1  VARCHAR(100),
                operating_profit_2  VARCHAR(100),
                roe_1               VARCHAR(100),
                roe_2               VARCHAR(100),
                roce_1              VARCHAR(100),
                roce_2              VARCHAR(100),
                scraped_at          TIMESTAMP DEFAULT NOW()
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("symbol", "VARCHAR(50)"),
            ("q_last_period", "VARCHAR(100)"),
            ("q_prev_period", "VARCHAR(100)"),
            ("q_last_period_prev_month", "VARCHAR(100)"),
            ("q_sales_last_period", "VARCHAR(100)"),
            ("q_sales_prev_period", "VARCHAR(100)"),
            ("q_sales_last_period_prev_month", "VARCHAR(100)"),
            ("q_sales_growth_1", "VARCHAR(100)"),
            ("q_sales_growth_2", "VARCHAR(100)"),
            ("q_sales_yoy_growth", "VARCHAR(100)"),
            ("q_opm_1", "VARCHAR(100)"),
            ("q_opm_2", "VARCHAR(100)"),
            ("fy_last_period", "VARCHAR(100)"),
            ("fy_prev_period", "VARCHAR(100)"),
            ("pl_sales_1", "VARCHAR(100)"),
            ("pl_sales_2", "VARCHAR(100)"),
            ("pl_opm_1", "VARCHAR(100)"),
            ("pl_opm_2", "VARCHAR(100)"),
            ("nt_profit_1", "VARCHAR(100)"),
            ("nt_profit_2", "VARCHAR(100)"),
            ("operating_profit_1", "VARCHAR(100)"),
            ("operating_profit_2", "VARCHAR(100)"),
            ("roe_1", "VARCHAR(100)"),
            ("roe_2", "VARCHAR(100)"),
            ("roce_1", "VARCHAR(100)"),
            ("roce_2", "VARCHAR(100)"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "compounded_growth",
        "create": """
            CREATE TABLE IF NOT EXISTS compounded_growth (
                id            SERIAL PRIMARY KEY,
                symbol        VARCHAR(50)   NOT NULL,
                metric_title  VARCHAR(100)  NOT NULL,
                period        VARCHAR(50)   NOT NULL,
                value         VARCHAR(50),
                scraped_at    TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unique_cg_symbol_metric_period UNIQUE (symbol, metric_title, period)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("symbol", "VARCHAR(50)"),
            ("metric_title", "VARCHAR(100)"),
            ("period", "VARCHAR(50)"),
            ("value", "VARCHAR(50)"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "stock_history",
        "create": """
            CREATE TABLE IF NOT EXISTS stock_history (
                id                SERIAL PRIMARY KEY,
                symbol            VARCHAR(50)   NOT NULL,
                trade_date        DATE          NOT NULL,
                open              NUMERIC(14,4),
                high              NUMERIC(14,4),
                low               NUMERIC(14,4),
                close             NUMERIC(14,4),
                volume            BIGINT,
                scraped_at        TIMESTAMP     DEFAULT NOW(),
                CONSTRAINT unique_stock_date UNIQUE (symbol, trade_date)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("symbol", "VARCHAR(50)"),
            ("trade_date", "DATE"),
            ("open", "NUMERIC(14,4)"),
            ("high", "NUMERIC(14,4)"),
            ("low", "NUMERIC(14,4)"),
            ("close", "NUMERIC(14,4)"),
            ("volume", "BIGINT"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "global_index_history",
        "create": """
            CREATE TABLE IF NOT EXISTS global_index_history (
                id                SERIAL PRIMARY KEY,
                index_name        VARCHAR(100) NOT NULL,
                exact_index_name  VARCHAR(100),
                region            VARCHAR(50),
                trade_date        DATE NOT NULL,
                open              NUMERIC(14,4),
                high              NUMERIC(14,4),
                low               NUMERIC(14,4),
                close             NUMERIC(14,4),
                volume            BIGINT,
                scraped_at        TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unique_index_date UNIQUE (index_name, trade_date)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("index_name", "VARCHAR(100)"),
            ("exact_index_name", "VARCHAR(100)"),
            ("region", "VARCHAR(50)"),
            ("trade_date", "DATE"),
            ("open", "NUMERIC(14,4)"),
            ("high", "NUMERIC(14,4)"),
            ("low", "NUMERIC(14,4)"),
            ("close", "NUMERIC(14,4)"),
            ("volume", "BIGINT"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "sectoral_activity",
        "create": """
            CREATE TABLE IF NOT EXISTS sectoral_activity (
                id            SERIAL PRIMARY KEY,
                sector        VARCHAR(100)  NOT NULL,
                period        VARCHAR(30)   NOT NULL,
                period_type   VARCHAR(20)   NOT NULL,
                amount        NUMERIC(14,2),
                amount_cr     NUMERIC(14,2),
                scraped_at    TIMESTAMP     DEFAULT NOW(),
                CONSTRAINT unique_sector_period UNIQUE (sector, period, period_type)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("sector", "VARCHAR(100)"),
            ("period", "VARCHAR(30)"),
            ("period_type", "VARCHAR(20)"),
            ("amount", "NUMERIC(14,2)"),
            ("amount_cr", "NUMERIC(14,2)"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "fii_dii_cash",
        "create": """
            CREATE TABLE IF NOT EXISTS fii_dii_cash (
                id            SERIAL PRIMARY KEY,
                period        VARCHAR(50)   NOT NULL,
                period_type   VARCHAR(20)   NOT NULL,
                fii_buy       NUMERIC(14,2),
                fii_sell      NUMERIC(14,2),
                fii_net       NUMERIC(14,2),
                dii_buy       NUMERIC(14,2),
                dii_sell      NUMERIC(14,2),
                dii_net       NUMERIC(14,2),
                scraped_at    TIMESTAMP     DEFAULT NOW(),
                CONSTRAINT unique_cash_period UNIQUE (period, period_type)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("period", "VARCHAR(50)"),
            ("period_type", "VARCHAR(20)"),
            ("fii_buy", "NUMERIC(14,2)"),
            ("fii_sell", "NUMERIC(14,2)"),
            ("fii_net", "NUMERIC(14,2)"),
            ("dii_buy", "NUMERIC(14,2)"),
            ("dii_sell", "NUMERIC(14,2)"),
            ("dii_net", "NUMERIC(14,2)"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "commodity_history",
        "create": """
            CREATE TABLE IF NOT EXISTS commodity_history (
                id           SERIAL PRIMARY KEY,
                name         VARCHAR(100) NOT NULL,
                symbol       VARCHAR(50)  NOT NULL,
                category     VARCHAR(100),
                trade_date   DATE         NOT NULL,
                open         NUMERIC(14, 4),
                high         NUMERIC(14, 4),
                low          NUMERIC(14, 4),
                close        NUMERIC(14, 4),
                volume       BIGINT,
                scraped_at   TIMESTAMP DEFAULT NOW(),
                CONSTRAINT unique_commodity_date UNIQUE (symbol, trade_date)
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("name", "VARCHAR(100)"),
            ("symbol", "VARCHAR(50)"),
            ("category", "VARCHAR(100)"),
            ("trade_date", "DATE"),
            ("open", "NUMERIC(14, 4)"),
            ("high", "NUMERIC(14, 4)"),
            ("low", "NUMERIC(14, 4)"),
            ("close", "NUMERIC(14, 4)"),
            ("volume", "BIGINT"),
            ("scraped_at", "TIMESTAMP DEFAULT NOW()"),
        ]
    },
    {
        "table": "watchlist_groups",
        "create": """
            CREATE TABLE IF NOT EXISTS watchlist_groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("name", "VARCHAR(100)"),
            ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ]
    },
    {
        "table": "watchlist",
        "create": """
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
        """,
        "columns": [
            ("id", "SERIAL"),
            ("symbol", "VARCHAR(50)"),
            ("stock_name", "VARCHAR(255)"),
            ("group_name", "VARCHAR(100)"),
            ("price", "VARCHAR(50)"),
            ("market_cap", "VARCHAR(50)"),
            ("change", "VARCHAR(50)"),
            ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ]
    },
    {
        "table": "users",
        "create": """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                emp_code VARCHAR(50),
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'User',
                status VARCHAR(50) NOT NULL DEFAULT 'Active',
                last_active VARCHAR(100) DEFAULT 'Just now',
                avatar_bg VARCHAR(50) DEFAULT 'bg-purple-600',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """,
        "columns": [
            ("id", "SERIAL"),
            ("emp_code", "VARCHAR(50)"),
            ("name", "VARCHAR(255)"),
            ("email", "VARCHAR(255)"),
            ("role", "VARCHAR(50)"),
            ("status", "VARCHAR(50)"),
            ("last_active", "VARCHAR(100)"),
            ("avatar_bg", "VARCHAR(50)"),
            ("created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
        ]
    }
]


def ensure_database_exists():
    """Ensure database 'trading_db' exists on PostgreSQL server."""
    try:
        # Connect to default postgres DB
        conn = psycopg2.connect(
            dbname="postgres",
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"],
            host=DB_CONFIG["host"],
            port=DB_CONFIG["port"]
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (DB_CONFIG["dbname"],))
            exists = cur.fetchone()
            if not exists:
                print(f"[+] Database '{DB_CONFIG['dbname']}' does not exist. Creating database...")
                cur.execute(f'CREATE DATABASE "{DB_CONFIG["dbname"]}";')
                print(f"[+] Database '{DB_CONFIG['dbname']}' created successfully.")
        conn.close()
    except Exception as e:
        print(f"[!] Database existence check warning: {e}")


def verify_and_create_tables():
    """Verifies that all 13 required tables and their respective columns exist in trading_db."""
    ensure_database_exists()

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = True
        cur = conn.cursor()

        print("[+] Checking database schema and required tables...")
        created_count = 0
        column_added_count = 0

        for t_info in TABLE_DEFINITIONS:
            table_name = t_info["table"]

            # 1. Check if table exists
            cur.execute("""
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s;
            """, (table_name,))
            table_exists = cur.fetchone()

            if not table_exists:
                print(f"  [+] Creating missing table: '{table_name}'...")
                cur.execute(t_info["create"])
                created_count += 1
            else:
                # 2. Check each required column in table
                for col_name, col_type in t_info["columns"]:
                    if col_name == "id":
                        continue
                    cur.execute("""
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_schema = 'public' AND table_name = %s AND column_name = %s;
                    """, (table_name, col_name))
                    col_exists = cur.fetchone()

                    if not col_exists:
                        print(f"  [+] Adding missing column '{col_name}' to table '{table_name}'...")
                        # Remove NOT NULL / UNIQUE / DEFAULT constraints for simple ALTER ADD COLUMN
                        clean_type = col_type.split("NOT NULL")[0].split("UNIQUE")[0].strip()
                        alter_sql = f'ALTER TABLE "{table_name}" ADD COLUMN IF NOT EXISTS "{col_name}" {clean_type};'
                        cur.execute(alter_sql)
                        column_added_count += 1

        cur.close()
        conn.close()
        print(f"[+] Database Schema Check Completed! ({created_count} tables created, {column_added_count} columns verified/added)\n")

    except Exception as e:
        print(f"[!] Database schema verification error: {e}")


if __name__ == "__main__":
    verify_and_create_tables()
