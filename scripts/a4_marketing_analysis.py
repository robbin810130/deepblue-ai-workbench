import os
import warnings
import urllib.parse
import json
from datetime import datetime

from sqlalchemy import create_engine, text
import pandas as pd
from dotenv import load_dotenv

# --- 初始化 ---
warnings.filterwarnings('ignore')
load_dotenv()

# --- 数据库连接配置 ---
DB_CONN_STR = (
    f"DRIVER={os.getenv('DB_DRIVER')};"
    f"SERVER={os.getenv('DB_SERVER')};"
    f"DATABASE={os.getenv('DB_DATABASE')};"
    f"UID={os.getenv('DB_UID')};"
    f"PWD={os.getenv('DB_PWD')};"
    "LoginTimeout=30;"
)

connection_url = f"mssql+pyodbc:///?odbc_connect={urllib.parse.quote_plus(DB_CONN_STR)}"
engine = create_engine(connection_url)

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
                 e.fPrice            AS cost_price
          FROM t_BillStockSale h
                   INNER JOIN t_BillStockSaleEntry e ON h.fInterId = e.fInterId
                   INNER JOIN t_IcItem item ON e.fItemId = item.fItemId
                   INNER JOIN t_Customer cus ON h.fCustId = cus.fItemId
          WHERE h.fCancellation = 0
            AND h.fStatus >= 1
            AND item.fProClass IN ('13728','13729');
          """

def get_quarter(month: int) -> int:
    return (month - 1) // 3 + 1

def process_marketing_analysis():
    try:
        print("正在从数据库获取销售数据...")
        with engine.connect() as connection:
            df = pd.read_sql(text(RAW_SQL), connection)

        if df.empty:
            print("警告: 数据库未返回任何数据")
            return {
                "monthly_volume_matrix": [],
                "quarterly_volume_matrix": [],
                "monthly_revenue_matrix": [],
                "quarterly_revenue_matrix": [],
                "category_breakdown": [],
                "meta_info": {"msg": "No data found", "query_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            }

        print(f"成功获取 {len(df)} 条记录，开始进行营销多维分析处理...")

        # 数据预处理
        df['fYear'] = df['fYear'].astype(int)
        df['fPeriod'] = df['fPeriod'].astype(int)
        df['fQty'] = pd.to_numeric(df['fQty'], errors='coerce').fillna(0)
        df['fSaleAmount'] = pd.to_numeric(df['fSaleAmount'], errors='coerce').fillna(0)
        df['cost_price'] = pd.to_numeric(df['cost_price'], errors='coerce').fillna(0)
        df['gross_profit'] = df['fSaleAmount'] - (df['fQty'] * df['cost_price'])

        pro_class_map = {'13728': '奶酪', '13729': '果冻'}
        df['product_group'] = df['fProClass'].astype(str).str.strip().map(pro_class_map).fillna('其他')

        df['period_date'] = pd.to_datetime(
            df['fYear'].astype(str) + '-' + df['fPeriod'].astype(str) + '-01'
        )
        df['quarter_idx'] = df['fPeriod'].apply(get_quarter)
        df['abs_quarter'] = df['fYear'] * 4 + df['quarter_idx']

        # 获取时间基准
        now = datetime.now()
        current_year = now.year
        current_month = now.month
        current_quarter = get_quarter(current_month)

        # ==============================================================================
        # 1. 销量/销售额月度表处理
        # ==============================================================================
        current_month_start = pd.Timestamp(year=current_year, month=current_month, day=1)
        start_month_date = current_month_start - pd.DateOffset(months=12)

        monthly_df = df[
            (df['period_date'] >= start_month_date) &
            (df['period_date'] <= current_month_start)
        ].copy()

        # 生成最近13个月排序好的月份字段
        monthly_cols = []
        temp_date = start_month_date
        while temp_date <= current_month_start:
            col_name = f"{temp_date.year % 100}.{temp_date.month}"
            monthly_cols.append(col_name)
            temp_date += pd.DateOffset(months=1)

        monthly_df['display_period'] = monthly_df.apply(
            lambda x: f"{x['fYear'] % 100}.{x['fPeriod']}", axis=1
        )

        # SKU 筛选 (Top 80% 销售量贡献)
        sku_qty_stats = monthly_df.groupby('fItemId')['fQty'].sum().sort_values(ascending=False)
        total_qty = sku_qty_stats.sum()
        top_skus = []
        if total_qty > 0:
            cumulative_qty = sku_qty_stats.cumsum()
            cumulative_perc = cumulative_qty / total_qty
            cutoff_idx = cumulative_perc.searchsorted(0.8, side='right')
            cutoff_idx = min(cutoff_idx, len(sku_qty_stats) - 1)
            top_skus = sku_qty_stats.index[:cutoff_idx + 1].tolist()
        else:
            top_skus = sku_qty_stats.index.tolist()

        # 过滤 Top SKU
        monthly_df_filtered = monthly_df[monthly_df['fItemId'].isin(top_skus)].copy()

        # 汇总毛利率和均价信息
        sku_summary = monthly_df_filtered.groupby('fItemId').agg(
            sum_qty=('fQty', 'sum'),
            sum_sales=('fSaleAmount', 'sum'),
            sum_gp=('gross_profit', 'sum')
        )
        sku_summary['avg_price'] = (sku_summary['sum_sales'] / sku_summary['sum_qty']).fillna(0).round(2)
        sku_summary['gross_margin'] = (sku_summary['sum_gp'] / sku_summary['sum_sales']).fillna(0).round(4)
        
        # 1.1 月销量矩阵
        monthly_volume_pivot = pd.pivot_table(
            monthly_df_filtered,
            values='fQty',
            index=['fItemId', 'fName', 'product_group'],
            columns='display_period',
            aggfunc='sum',
            fill_value=0
        ).reindex(columns=monthly_cols, fill_value=0).round(0).reset_index()

        monthly_volume_pivot.rename(columns={'fItemId': 'sku_id', 'fName': 'product_name'}, inplace=True)
        monthly_volume_pivot['gross_margin'] = monthly_volume_pivot['sku_id'].map(sku_summary['gross_margin'].to_dict())
        monthly_volume_pivot['avg_price'] = monthly_volume_pivot['sku_id'].map(sku_summary['avg_price'].to_dict())
        monthly_volume_pivot['total_qty'] = monthly_volume_pivot[monthly_cols].sum(axis=1)
        monthly_volume_pivot.sort_values('total_qty', ascending=False, inplace=True)
        
        # 1.2 月销售额矩阵
        monthly_revenue_pivot = pd.pivot_table(
            monthly_df_filtered,
            values='fSaleAmount',
            index=['fItemId', 'fName', 'product_group'],
            columns='display_period',
            aggfunc='sum',
            fill_value=0
        ).reindex(columns=monthly_cols, fill_value=0).round(2).reset_index()

        monthly_revenue_pivot.rename(columns={'fItemId': 'sku_id', 'fName': 'product_name'}, inplace=True)
        monthly_revenue_pivot['gross_margin'] = monthly_revenue_pivot['sku_id'].map(sku_summary['gross_margin'].to_dict())
        monthly_revenue_pivot['avg_price'] = monthly_revenue_pivot['sku_id'].map(sku_summary['avg_price'].to_dict())
        monthly_revenue_pivot['total_revenue'] = monthly_revenue_pivot[monthly_cols].sum(axis=1)
        monthly_revenue_pivot.sort_values('total_revenue', ascending=False, inplace=True)

        # ==============================================================================
        # 2. 季度表处理
        # ==============================================================================
        current_abs_quarter = current_year * 4 + current_quarter
        start_abs_quarter = current_abs_quarter - 4

        quarterly_df = df[
            (df['abs_quarter'] >= start_abs_quarter) &
            (df['abs_quarter'] <= current_abs_quarter)
        ].copy()

        # 生成最近5个季度列表
        quarterly_cols = []
        for abs_q in range(start_abs_quarter, current_abs_quarter + 1):
            y = (abs_q - 1) // 4
            q = (abs_q - 1) % 4 + 1
            col_name = f"{y % 100}-Q{q}"
            quarterly_cols.append(col_name)

        quarterly_df['display_quarter'] = quarterly_df.apply(
            lambda x: f"{x['fYear'] % 100}-Q{x['quarter_idx']}", axis=1
        )
        
        quarterly_df_filtered = quarterly_df[quarterly_df['fItemId'].isin(top_skus)].copy()
        
        # 2.1 季销量矩阵
        quarterly_volume_pivot = pd.pivot_table(
            quarterly_df_filtered,
            values='fQty',
            index=['fItemId', 'fName', 'product_group'],
            columns='display_quarter',
            aggfunc='sum',
            fill_value=0
        ).reindex(columns=quarterly_cols, fill_value=0).round(0).reset_index()
        
        quarterly_volume_pivot.rename(columns={'fItemId': 'sku_id', 'fName': 'product_name'}, inplace=True)
        quarterly_volume_pivot['gross_margin'] = quarterly_volume_pivot['sku_id'].map(sku_summary['gross_margin'].to_dict())
        quarterly_volume_pivot['avg_price'] = quarterly_volume_pivot['sku_id'].map(sku_summary['avg_price'].to_dict())
        quarterly_volume_pivot['total_qty'] = quarterly_volume_pivot[quarterly_cols].sum(axis=1)
        quarterly_volume_pivot.sort_values('total_qty', ascending=False, inplace=True)

        # 2.2 季销售额矩阵
        quarterly_revenue_pivot = pd.pivot_table(
            quarterly_df_filtered,
            values='fSaleAmount',
            index=['fItemId', 'fName', 'product_group'],
            columns='display_quarter',
            aggfunc='sum',
            fill_value=0
        ).reindex(columns=quarterly_cols, fill_value=0).round(2).reset_index()
        
        quarterly_revenue_pivot.rename(columns={'fItemId': 'sku_id', 'fName': 'product_name'}, inplace=True)
        quarterly_revenue_pivot['gross_margin'] = quarterly_revenue_pivot['sku_id'].map(sku_summary['gross_margin'].to_dict())
        quarterly_revenue_pivot['avg_price'] = quarterly_revenue_pivot['sku_id'].map(sku_summary['avg_price'].to_dict())
        quarterly_revenue_pivot['total_revenue'] = quarterly_revenue_pivot[quarterly_cols].sum(axis=1)
        quarterly_revenue_pivot.sort_values('total_revenue', ascending=False, inplace=True)

        # ==============================================================================
        # 3. 类别占比分析 (Category Breakdown)
        # ==============================================================================
        cat_df = monthly_df_filtered.groupby('product_group').agg(
            volume=('fQty', 'sum'),
            revenue=('fSaleAmount', 'sum')
        ).reset_index()
        
        total_vol = cat_df['volume'].sum()
        total_rev = cat_df['revenue'].sum()
        
        category_breakdown = []
        for _, row in cat_df.iterrows():
            category_breakdown.append({
                "category": row['product_group'],
                "volume": int(row['volume']),
                "revenue": round(float(row['revenue']), 2),
                "vol_percentage": round(float(row['volume'] / total_vol * 100), 2) if total_vol > 0 else 0,
                "rev_percentage": round(float(row['revenue'] / total_rev * 100), 2) if total_rev > 0 else 0
            })

        print("销量与销售额数据处理完成！")
        return {
            "monthly_volume_matrix": monthly_volume_pivot.to_dict(orient='records'),
            "monthly_revenue_matrix": monthly_revenue_pivot.to_dict(orient='records'),
            "quarterly_volume_matrix": quarterly_volume_pivot.to_dict(orient='records'),
            "quarterly_revenue_matrix": quarterly_revenue_pivot.to_dict(orient='records'),
            "category_breakdown": category_breakdown,
            "meta_info": {
                "query_time": now.strftime("%Y-%m-%d %H:%M:%S"),
                "sku_filter": "Top 80% Revenue/Volume Contributors",
                "volume_unit": "箱/千克",
                "revenue_unit": "元 (CNY)",
                "monthly_columns": monthly_cols,
                "quarterly_columns": quarterly_cols
            }
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    data = process_marketing_analysis()
    if data:
        output_file = "marketing_analysis_data.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False, default=str)
        print(f"数据已导出到: {output_file}")
