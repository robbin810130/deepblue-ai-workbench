import os
import warnings
import urllib.parse
import json
from datetime import datetime
from typing import List, Dict, Any

from sqlalchemy import create_engine, text
import pandas as pd
from dotenv import load_dotenv

# --- 初始化 ---
warnings.filterwarnings('ignore')
load_dotenv()

# --- 数据库连接配置 ---
# 使用 pyodbc 原生连接字符串格式
DB_CONN_STR = (
    f"DRIVER={os.getenv('DB_DRIVER')};"
    f"SERVER={os.getenv('DB_SERVER')};"
    f"DATABASE={os.getenv('DB_DATABASE')};"
    f"UID={os.getenv('DB_UID')};"
    f"PWD={os.getenv('DB_PWD')};"
    "LoginTimeout=30;"
)

# --- 数据库连接引擎 ---
# SQLAlchemy 必须使用 odbc_connect 参数来通过 URL 传递原生连接字符串
# 使用 quote_plus 对连接字符串进行 URL 编码
connection_url = f"mssql+pyodbc:///?odbc_connect={urllib.parse.quote_plus(DB_CONN_STR)}"
engine = create_engine(connection_url)

# --- 核心 SQL 语句 ---
RAW_SQL = """
          SELECT h.fBillNo,
                 h.fDate,
                 h.fYear,
                 h.fPeriod,
                 cus.fName           AS cust_name,
                 item.fItemId,
                 item.fName,
                 item.fProClass,
                 e.fQty,
                 e.fSaleAmount,
                 e.fPrice            AS cost_price,
                 bom.min_create_date as fCreateDate
          FROM t_BillStockSale h
                   INNER JOIN t_BillStockSaleEntry e ON h.fInterId = e.fInterId
                   INNER JOIN t_IcItem item ON e.fItemId = item.fItemId
                   INNER JOIN t_Customer cus ON h.fCustId = cus.fItemId
                   LEFT JOIN (SELECT fProductId, MIN(fCreateDate) as min_create_date \
                              FROM t_Bom \
                              GROUP BY fProductId) bom ON item.fItemId = bom.fProductId
          WHERE h.fCancellation = 0
            AND h.fStatus >= 1
            AND item.fProClass IN ('13728','13729'); \
          """


def get_quarter(month: int) -> int:
    """根据月份计算季度 (1-3->1, 4-6->2, ...)"""
    return (month - 1) // 3 + 1


def process_sales_data():
    """
    获取并处理销售数据，返回透视后的宽表字典结果
    """
    try:
        print("正在从数据库获取数据...")
        # 1. 从数据库读取数据到 Pandas DataFrame
        with engine.connect() as connection:
            df = pd.read_sql(text(RAW_SQL), connection)

        if df.empty:
            print("警告: 数据库未返回任何数据")
            return {
                "monthly_matrix": [],
                "quarterly_matrix": [],
                "meta_info": {"msg": "No data found"}
            }

        print(f"成功获取 {len(df)} 条记录，正在处理...")

        # 2. 数据预处理
        df['fYear'] = df['fYear'].astype(int)
        df['fPeriod'] = df['fPeriod'].astype(int)

        # 新增：映射产品线分类
        pro_class_map = {'13728': '奶酪', '13729': '果冻'}
        df['product_group'] = df['fProClass'].astype(str).str.strip().map(pro_class_map).fillna('其他')

        # 新增：计算单笔记录毛利 = 销售额 - (数量 * 单位成本)
        df['cost_price'] = pd.to_numeric(df['cost_price'], errors='coerce').fillna(0)
        df['fSaleAmount'] = pd.to_numeric(df['fSaleAmount'], errors='coerce').fillna(0)
        df['fQty'] = pd.to_numeric(df['fQty'], errors='coerce').fillna(0)
        df['gross_profit'] = df['fSaleAmount'] - (df['fQty'] * df['cost_price'])

        # 创建一个 period_date (每月1号) 用于月度计算和排序
        df['period_date'] = pd.to_datetime(
            df['fYear'].astype(str) + '-' + df['fPeriod'].astype(str) + '-01'
        )

        # 计算季度相关列
        df['quarter_idx'] = df['fPeriod'].apply(get_quarter)
        df['abs_quarter'] = df['fYear'] * 4 + df['quarter_idx']

        # 3. 获取当前时间基准
        now = datetime.now()
        # 如需测试特定时间可取消注释:
        # now = datetime(2026, 2, 10)

        current_year = now.year
        current_month = now.month
        current_quarter = get_quarter(current_month)

        # ==============================================================================
        # 4. 月度表处理 (Pivot Matrix)
        # ==============================================================================

        # 4.1 确定时间范围 (当前月往前推12个月)
        current_month_start = pd.Timestamp(year=current_year, month=current_month, day=1)
        start_month_date = current_month_start - pd.DateOffset(months=12)

        # 4.2 过滤数据
        monthly_df = df[
            (df['period_date'] >= start_month_date) &
            (df['period_date'] <= current_month_start)
            ].copy()

        # 4.3 生成排序好的列名列表 (保证 25.10 在 25.2 后面)
        # 生成逻辑：遍历时间范围，生成 ['25.2', '25.3', ..., '26.1', '26.2']
        monthly_cols = []
        temp_date = start_month_date
        while temp_date <= current_month_start:
            # 格式化为 "YY.M" (例如 25.2)
            col_name = f"{temp_date.year % 100}.{temp_date.month}"
            monthly_cols.append(col_name)
            temp_date += pd.DateOffset(months=1)

        # 为数据添加显示用的列名列
        monthly_df['display_period'] = monthly_df.apply(
            lambda x: f"{x['fYear'] % 100}.{x['fPeriod']}", axis=1
        )

        # 4.4 Top 80% 筛选逻辑 (基于该时间段的总销售额)
        print("\n正在进行 Top 80% 销售额 SKU 筛选...")
        sku_sales_stats = monthly_df.groupby('fItemId')['fSaleAmount'].sum().sort_values(ascending=False)
        total_sales = sku_sales_stats.sum()
        top_skus = []

        if total_sales > 0:
            cumulative_sales = sku_sales_stats.cumsum()
            cumulative_perc = cumulative_sales / total_sales
            cutoff_idx = cumulative_perc.searchsorted(0.8, side='right')
            cutoff_idx = min(cutoff_idx, len(sku_sales_stats) - 1)
            top_skus = sku_sales_stats.index[:cutoff_idx + 1].tolist()

            print(f"  - 总 SKU 数: {len(sku_sales_stats)}")
            print(f"  - 筛选后 SKU 数 (Top 80%): {len(top_skus)}")
            print(f"  - 筛选保留了前 {cutoff_idx + 1} 个 SKU")
        else:
            print("  - 警告: 该时间段内无销售额")

        # 应用筛选
        monthly_df_filtered = monthly_df[monthly_df['fItemId'].isin(top_skus)].copy()

        # 4.5 数据透视 (Pivot) -> 生成宽表
        # Index: SKU信息, Columns: 时间周期, Values: 销售额 (fSaleAmount)
        monthly_pivot = pd.pivot_table(
            monthly_df_filtered,
            values='fSaleAmount',
            index=['fItemId', 'fName', 'product_group'],
            columns='display_period',
            aggfunc='sum',
            fill_value=0
        )

        # 4.6 重新索引列以确保时间顺序正确，并补全可能缺失的月份（填0）
        monthly_pivot = monthly_pivot.reindex(columns=monthly_cols, fill_value=0)

        # 保留两位小数
        monthly_pivot = monthly_pivot.round(2)

        # 重置索引，让 fItemId 和 fName 变回普通列
        monthly_pivot.reset_index(inplace=True)

        # 归集计算该 SKU 近一年整体的毛利率(Gross Margin) 供大模型分析
        sku_gp = monthly_df_filtered.groupby('fItemId').agg(
            sum_sales=('fSaleAmount', 'sum'),
            sum_gp=('gross_profit', 'sum')
        )
        sku_gp['gm_rate'] = (sku_gp['sum_gp'] / sku_gp['sum_sales']).fillna(0).round(4)
        monthly_pivot['gross_margin'] = monthly_pivot['fItemId'].map(sku_gp['gm_rate'].to_dict())

        # 重命名列以符合前端展示习惯 (可选)
        monthly_pivot.rename(columns={'fItemId': 'sku_id', 'fName': 'product_name'}, inplace=True)

        # 4.7 按近一年销量排序 (从高到低)
        # 计算所有月份的总销量作为排序依据
        monthly_pivot['total_sales'] = monthly_pivot[monthly_cols].sum(axis=1)
        monthly_pivot.sort_values('total_sales', ascending=False, inplace=True)
        monthly_pivot.drop('total_sales', axis=1, inplace=True)  # 删除辅助列
        monthly_pivot.reset_index(drop=True, inplace=True)  # 重置索引
        print(f"\n[月度表] 已按近一年销量从高到低排序")

        # ==============================================================================
        # 5. 季度表处理 (Pivot Matrix)
        # ==============================================================================

        # 5.1 确定季度范围 (当前季度往前推4个季度)
        current_abs_quarter = current_year * 4 + current_quarter
        start_abs_quarter = current_abs_quarter - 4

        # 5.2 过滤数据
        quarterly_df = df[
            (df['abs_quarter'] >= start_abs_quarter) &
            (df['abs_quarter'] <= current_abs_quarter)
            ].copy()

        # 5.3 生成排序好的列名列表
        # 生成逻辑：计算绝对季度值对应的显示名 ['25-Q1', '25-Q2'...]
        quarterly_cols = []
        for abs_q in range(start_abs_quarter, current_abs_quarter + 1):
            y = (abs_q - 1) // 4
            q = (abs_q - 1) % 4 + 1
            col_name = f"{y % 100}-Q{q}"
            quarterly_cols.append(col_name)

        # 为数据添加显示用的列名列
        quarterly_df['display_quarter'] = quarterly_df.apply(
            lambda x: f"{x['fYear'] % 100}-Q{x['quarter_idx']}", axis=1
        )

        # 5.4 应用同样的 SKU 筛选 (保持两个表 SKU 一致)
        quarterly_df_filtered = quarterly_df[quarterly_df['fItemId'].isin(top_skus)].copy()

        # 5.5 数据透视 (Pivot)
        quarterly_pivot = pd.pivot_table(
            quarterly_df_filtered,
            values='fSaleAmount',
            index=['fItemId', 'fName', 'product_group'],
            columns='display_quarter',
            aggfunc='sum',
            fill_value=0
        )

        # 5.6 重新索引列并重置索引
        quarterly_pivot = quarterly_pivot.reindex(columns=quarterly_cols, fill_value=0)

        # 保留两位小数
        quarterly_pivot = quarterly_pivot.round(2)

        quarterly_pivot.reset_index(inplace=True)

        # 归集季度毛利率
        q_sku_gp = quarterly_df_filtered.groupby('fItemId').agg(
            sum_sales=('fSaleAmount', 'sum'),
            sum_gp=('gross_profit', 'sum')
        )
        q_sku_gp['gm_rate'] = (q_sku_gp['sum_gp'] / q_sku_gp['sum_sales']).fillna(0).round(4)
        quarterly_pivot['gross_margin'] = quarterly_pivot['fItemId'].map(q_sku_gp['gm_rate'].to_dict())

        quarterly_pivot.rename(columns={'fItemId': 'sku_id', 'fName': 'product_name'}, inplace=True)

        # 5.7 按季度总销量排序 (从高到低)
        # 计算所有季度的总销量作为排序依据
        quarterly_pivot['total_sales'] = quarterly_pivot[quarterly_cols].sum(axis=1)
        quarterly_pivot.sort_values('total_sales', ascending=False, inplace=True)
        quarterly_pivot.drop('total_sales', axis=1, inplace=True)  # 删除辅助列
        quarterly_pivot.reset_index(drop=True, inplace=True)  # 重置索引
        print(f"[季度表] 已按季度总销量从高到低排序")

        # ----------------------------------------
        # 6. 构造返回结果
        # ----------------------------------------

        # 打印筛选后的行数 (即 SKU 数量)
        print(f"\n[统计信息]")
        print(f"  - 筛选后月度表行数 (SKU数): {len(monthly_pivot)}")
        print(f"  - 筛选后季度表行数 (SKU数): {len(quarterly_pivot)}")

        result = {
            "monthly_matrix": monthly_pivot.to_dict(orient='records'),
            "quarterly_matrix": quarterly_pivot.to_dict(orient='records'),
            "meta_info": {
                "query_time": now.strftime("%Y-%m-%d %H:%M:%S"),
                "sku_filter": "Top 80% Revenue Contributors",
                "value_unit": "Sales Amount (销售额)",
                "monthly_columns": monthly_cols,  # 前端可参考此列表渲染表头顺序
                "quarterly_columns": quarterly_cols
            }
        }
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    # 执行处理
    data = process_sales_data()

    if data:
        # 将结果保存为 JSON 文件
        output_file = "sales_analysis_matrix.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False, default=str)

        print("-" * 30)
        print(f"处理完成！结果已保存至: {output_file}")
        print("-" * 30)