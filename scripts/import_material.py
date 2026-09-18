#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导入物料编码.xlsx 到 t_jy_material 表
用法: python scripts/import_material.py
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import openpyxl
import psycopg2

DB_CONFIG = {
    "host": "39.108.221.22",
    "port": 9800,
    "database": "dify_memory",
    "user": "postgres",
    "password": "difyai123456"
}

EXCEL_PATH = r"d:\my-web-os\tmp\uploads\物料编码.xlsx"

def main():
    print("[1/4] 读取 Excel 文件...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb.active

    rows = list(ws.iter_rows(min_row=2, values_only=True))  # 跳过表头
    print(f"      共 {len(rows)} 条物料记录")

    print("[2/4] 连接数据库...")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    print("[3/4] 建表（幂等）并清空旧数据...")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS t_jy_material (
            id          SERIAL PRIMARY KEY,
            itemno      VARCHAR(64)  NOT NULL,
            itemname    VARCHAR(128) NOT NULL,
            descript    VARCHAR(256),
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_jy_material_itemno ON t_jy_material (itemno);
    """)
    conn.commit()

    cur.execute("TRUNCATE TABLE t_jy_material RESTART IDENTITY;")
    conn.commit()

    print("[4/4] 导入数据...")
    inserted = 0
    for row in rows:
        itemno, itemname, descript = row
        if not itemno and not itemname:
            continue
        cur.execute(
            "INSERT INTO t_jy_material (itemno, itemname, descript) VALUES (%s, %s, %s)",
            (
                str(itemno).strip() if itemno else '',
                str(itemname).strip() if itemname else '',
                str(descript).strip() if descript else None
            )
        )
        inserted += 1

    conn.commit()
    cur.close()
    conn.close()

    print(f"[完成] 共插入 {inserted} 条记录到 t_jy_material 表。")

if __name__ == "__main__":
    main()
