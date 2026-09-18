import pyodbc
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json
import warnings
import os
from dotenv import load_dotenv


warnings.filterwarnings('ignore')


# -------------------------- 1. SQL Server数据库连接配置（必改！） --------------------------
load_dotenv()
DB_CONN_STR = (
    f"DRIVER={os.getenv('DB_DRIVER')};"
    f"SERVER={os.getenv('DB_SERVER')};"
    f"DATABASE={os.getenv('DB_DATABASE')};"
    f"UID={os.getenv('DB_UID')};"
    f"PWD={os.getenv('DB_PWD')};"
    # "Encrypt=no;"
    # "TrustServerCertificate=yes;"
    "LoginTimeout=30;"  # 增加登录超时容忍度
)


# -------------------------- 2. 加载SQL数据（优化：先拉原始数据+调试，再轻量清洗） --------------------------
def load_data_from_sql():
    """执行SQL拉取数据：关联主表+明细表+客户表，汇总明细表实际金额，轻量清洗+调试"""
    # 核心修改：嵌入关联3张表的SQL Server语句，汇总明细表fAmount为实际提货总金额
    sql = """SELECT 
        s.fInterId    AS 出库单ID,
        s.fBillNo     AS 出库单号,
        s.fDate       AS 实际提货日期,
        s.fCustId     AS 客户ID,
        -- 汇总明细表fAmount作为实际提货总金额（替代主表全0的fAllAmount）
        SUM(ISNULL(e.fAmount, 0.0)) AS 提货总金额,
        s.fSaleType   AS 销售类型,
        s.fStatus     AS 单据状态,
        c.fName       AS 客户名称,
        c.fRegionText AS 客户所属区域
    FROM t_BillStockSale s
    -- 关联明细表：主表与明细表唯一关联键fInterId
    LEFT JOIN t_BillStockSaleEntry e 
        ON s.fInterId = e.fInterId
    -- 关联客户表：主表客户ID关联客户表唯一标识
    LEFT JOIN t_Customer c 
        ON s.fCustId = c.fItemId
    -- 分组：所有非聚合字段必须加入GROUP BY，保证数据唯一
    GROUP BY 
        s.fInterId, s.fBillNo, s.fDate, s.fCustId,
        s.fSaleType, s.fStatus, c.fName, c.fRegionText
    -- 按提货日期倒序，最新数据在前
    ORDER BY s.fDate DESC;"""
    # 执行SQL（增加异常捕获，保留原调试逻辑）
    try:
        conn = pyodbc.connect(DB_CONN_STR)
        print("✅ SQL Server数据库连接成功")
        # 先执行原始SQL，查看未过滤的原始数据量（关键调试！）
        df_original = pd.read_sql(sql, conn)
        print(f"📊 SQL原始查询结果：总记录数={len(df_original)}条（关联主表+明细表+客户表，未过滤）")
        if len(df_original) == 0:
            conn.close()
            raise Exception("SQL查询原始记录数为0！请检查表名/字段名/关联关系是否正确")

        # 轻量数据清洗（保留原逻辑，仅做类型转换+空值填充）
        df = df_original.copy()
        df['实际提货日期'] = pd.to_datetime(df['实际提货日期'], errors='coerce')
        df['提货总金额'] = pd.to_numeric(df['提货总金额'], errors='coerce').fillna(0)

        # 打印清洗前各关键字段的空值/0值情况（调试用，查看实际金额是否生效）
        print(f"🔍 清洗前调试信息：")
        print(f"   - 客户ID空值数：{df['客户ID'].isna().sum()}")
        print(f"   - 提货日期空值数：{df['实际提货日期'].isna().sum()}")
        print(f"   - 提货金额0值数：{len(df[df['提货总金额'] == 0])}")
        print(f"   - 提货金额非0数：{len(df[df['提货总金额'] > 0])}")  # 新增：查看有效金额数据量

        # 宽松过滤：仅过滤「客户ID和提货日期同时为空」的极端无效数据
        df = df[~(df['客户ID'].isna() & df['实际提货日期'].isna())]
        conn.close()

        # 最终有效数据统计
        valid_orders = len(df)
        valid_customers = df['客户ID'].nunique() if not df['客户ID'].isna().all() else 0
        print(
            f"✅ 数据加载完成：有效订单{valid_orders}条，涉及客户{valid_customers}个，有效金额订单{len(df[df['提货总金额'] > 0])}条")
        return df

    except Exception as e:
        raise ConnectionError(f"❌ 数据加载失败：{str(e)}") from e


# -------------------------- 3. 客户分析智能体（增加空数据前置拦截） --------------------------
class CustomerAnalysisAgent:
    def __init__(self, df):
        self.df = df
        self.analysis_date = datetime.now()
        self.rfm_df = None
        self.stability_df = None
        self.risk_df = None
        self.final_result_df = None
        # 前置检查：无有效数据直接标记
        self.has_valid_data = len(df) > 0 and df['客户ID'].nunique() > 0

    def calculate_rfm(self):
        if not self.has_valid_data:
            self.rfm_df = pd.DataFrame()
            return
        # 按客户聚合计算RFM原始指标
        rfm = self.df.groupby('客户ID').agg({
            '实际提货日期': lambda x: (self.analysis_date - x.max()).days,  # R：最近提货天数
            '出库单ID': 'nunique',  # F：提货频次（按出库单计数）
            '提货总金额': 'sum'  # M：总提货金额
        }).reset_index()
        rfm.columns = ['客户ID', 'R_最近提货天数', 'F_提货频次', 'M_总提货金额']

        # 增加rfm非空判断
        if len(rfm) == 0:
            self.rfm_df = pd.DataFrame()
            return

        # -------------------------- 核心修复：处理全相同值+动态分箱 --------------------------
        # 初始化评分字段为None（原3分→改为空，无计算依据则为空）
        rfm['R_评分'] = None
        rfm['F_评分'] = None
        rfm['M_评分'] = None

        # 1. 处理R_最近提货天数评分（反向：天数越少分越高，有离散度才赋值，否则保留None）
        if rfm['R_最近提货天数'].nunique() > 1:  # 有离散度才分箱
            qcut_bins_r = min(5, rfm['R_最近提货天数'].nunique())  # 分箱数不超过唯一值数量
            if qcut_bins_r >= 2:  # 分箱数≥2才执行分箱
                rfm['R_评分'] = pd.qcut(
                    rfm['R_最近提货天数'],
                    qcut_bins_r,
                    labels=list(range(qcut_bins_r, 0, -1)),  # 反向标签：天数少→分高
                    duplicates='drop'
                ).astype(object)  # 改为object类型，支持None值

        # 2. 处理F_提货频次评分（正向：频次越多分越高，有离散度才赋值，否则保留None）
        if rfm['F_提货频次'].nunique() > 1:
            qcut_bins_f = min(5, rfm['F_提货频次'].nunique())
            if qcut_bins_f >= 2:
                # 用rank避免重复值导致分箱失败，结果改为object类型支持None
                rfm['F_评分'] = pd.qcut(
                    rfm['F_提货频次'].rank(method='first'),
                    qcut_bins_f,
                    labels=list(range(1, qcut_bins_f + 1))  # 正向标签：频次多→分高
                ).astype(object)

        # 3. 处理M_总提货金额评分（正向：金额越多分越高，重点兼容全0值）
        if rfm['M_总提货金额'].nunique() > 1:  # 有非0且离散的金额才分箱
            qcut_bins_m = min(5, rfm['M_总提货金额'].nunique())
            if qcut_bins_m >= 2:
                rfm['M_评分'] = pd.qcut(
                    rfm['M_总提货金额'],
                    qcut_bins_m,
                    labels=list(range(1, qcut_bins_m + 1)),
                    duplicates='drop'
                ).astype(object)
        # 全0/全相同金额：保留None（原1分→改为空，无价值则无评分）

        # 计算RFM总分（仅当R/F/M评分均非空时计算，否则为None）
        rfm['RFM总分'] = rfm.apply(
            lambda row: row['R_评分'] + row['F_评分'] + row['M_评分']
            if pd.notna(row['R_评分']) and pd.notna(row['F_评分']) and pd.notna(row['M_评分'])
            else None,
            axis=1
        )

        # 优化分层逻辑：仅当RFM总分非空时分层，否则为None（适配全0金额场景）
        def customer_level(score):
            if pd.isna(score):
                return None
            if score >= 12:
                return '核心客户'
            elif score >= 9:
                return '重要客户'
            elif score >= 6:
                return '普通客户'
            else:
                return '低价值客户'  # 替换原"潜在客户"，适配全0金额场景

        rfm['客户分层'] = rfm['RFM总分'].apply(customer_level)
        self.rfm_df = rfm
        print("✅ RFM模型评分+客户分层完成（兼容全0金额场景，缺失数据置空）")

    def calculate_stability(self, months=12, min_orders=10):
        """
        计算订单变异系数CV和需求稳定性（修复KeyError：保证订单变异系数CV字段始终存在）
        :param months: 统计近N个月数据
        :param min_orders: 单客户最小有效订单数（不足则置空CV，可灵活调整）
        """
        if not self.has_valid_data or len(self.rfm_df) == 0:
            # 无数据时：初始化空DataFrame，显式指定3个字段，避免后续键缺失
            self.stability_df = pd.DataFrame(columns=['客户ID', '订单变异系数CV', '需求稳定性'])
            return

        # 1. 筛选近N个月数据，过滤无效日期，提取年月维度（避免日期格式错误）
        start = self.analysis_date - timedelta(days=months * 30)
        df_filter = self.df[
            (self.df['实际提货日期'] >= start) &
            (self.df['实际提货日期'].notna())  # 过滤空日期，避免后续年月提取报错
            ].copy()

        # 提前返回：无近N个月有效数据时，初始化全客户的空值DataFrame
        if len(df_filter) == 0:
            self.stability_df = self.rfm_df[['客户ID']].copy()
            self.stability_df['订单变异系数CV'] = None  # 显式赋值，保证字段存在
            self.stability_df['需求稳定性'] = None
            print(f"🔍 CV计算调试：近{months}个月无有效提货数据，所有客户CV置空")
            return

        # 2. 提取年月维度（转为字符串，避免period类型序列化问题）
        df_filter['年月'] = df_filter['实际提货日期'].dt.strftime('%Y-%m')

        # 3. 统计单客户近N个月订单数，筛选有效客户（订单数≥min_orders）
        cust_order_count = df_filter.groupby('客户ID').size().reset_index(name='order_count')
        valid_cust = cust_order_count[cust_order_count['order_count'] >= min_orders]['客户ID'].tolist()
        df_valid = df_filter[df_filter['客户ID'].isin(valid_cust)]

        # 4. 调试信息：打印核心统计，快速定位问题
        total_analysis_cust = len(self.rfm_df)
        total_filter_cust = len(cust_order_count)
        valid_cust_num = len(valid_cust)
        print(
            f"🔍 CV计算调试：近{months}个月涉及客户{total_filter_cust}个 | 订单数≥{min_orders}的有效客户{valid_cust_num}个 | 总分析客户{total_analysis_cust}个")

        # 5. 初始化全量客户的CV结果表（核心修复：显式创建2个字段，避免KeyError）
        self.stability_df = self.rfm_df[['客户ID']].copy()
        self.stability_df['订单变异系数CV'] = None  # 强制创建字段，赋值为None
        self.stability_df['需求稳定性'] = None  # 强制创建字段，赋值为None

        # 6. 仅对有效客户计算CV和需求稳定性
        if valid_cust_num > 0 and len(df_valid) > 0:
            # 按客户+年月聚合：计算每月提货总金额
            monthly_amount = df_valid.groupby(['客户ID', '年月'])['提货总金额'].sum().reset_index()
            # 计算每个有效客户的月金额均值、标准差
            cust_stats = monthly_amount.groupby('客户ID')['提货总金额'].agg(
                mean='mean',
                std='std'
            ).reset_index()
            # 计算变异系数CV：均值>0时计算（避免分母为0），否则置空
            cust_stats['订单变异系数CV'] = np.where(
                cust_stats['mean'] > 0,
                (cust_stats['std'] / cust_stats['mean']).round(4),
                None
            )

            # 定义需求稳定性判定规则
            def judge_stability(cv):
                if pd.isna(cv):
                    return None
                if cv < 0.5:
                    return '非常稳定'
                elif cv < 1.0:
                    return '稳定'
                elif cv < 1.5:
                    return '一般'
                else:
                    return '不稳定'

            # 判定需求稳定性
            cust_stats['需求稳定性'] = cust_stats['订单变异系数CV'].apply(judge_stability)

            # 7. 将有效客户的计算结果更新到全量表（核心修复：指定合并方式，保留原索引）
            self.stability_df = self.stability_df.merge(
                cust_stats[['客户ID', '订单变异系数CV', '需求稳定性']],
                on='客户ID',
                how='left',
                suffixes=('', '_new')  # 避免字段重名覆盖
            )
            # 处理重名字段：若合并后出现新字段，替换原空值（兜底逻辑）
            if '订单变异系数CV_new' in self.stability_df.columns:
                self.stability_df['订单变异系数CV'] = self.stability_df['订单变异系数CV_new']
                self.stability_df['需求稳定性'] = self.stability_df['需求稳定性_new']
                self.stability_df = self.stability_df.drop(columns=['订单变异系数CV_new', '需求稳定性_new'])

        # 最终结果：保证仅保留3个核心字段，无多余列
        self.stability_df = self.stability_df[['客户ID', '订单变异系数CV', '需求稳定性']]
        # 调试日志：打印有效CV计算结果
        valid_cv_num = len(self.stability_df[self.stability_df['订单变异系数CV'].notna()])
        print(f"✅ CV计算完成：{valid_cv_num}个客户生成有效订单变异系数CV | 其余客户CV置空")

    def calculate_risk(self, warn_days=90, danger_days=180):
        if not self.has_valid_data or len(self.rfm_df) == 0:
            # 仅保留客户ID、流失风险等级，移除R_最近提货天数
            self.risk_df = pd.DataFrame(columns=['客户ID', '流失风险等级'])
            return
        # 仅复制客户ID，不再复制R_最近提货天数
        risk = self.rfm_df[['客户ID']].copy()
        # 从rfm_df中取R_最近提货天数用于判定风险，不存入risk_df
        r_days = self.rfm_df['R_最近提货天数']

        def risk_lev(x):
            if pd.isna(x):
                return None
            if x >= danger_days:
                return '高危流失'
            elif x >= warn_days:
                return '预警流失'
            else:
                return '低风险'

        risk['流失风险等级'] = r_days.apply(risk_lev)
        # 最终risk_df仅含2个字段，无R_最近提货天数
        self.risk_df = risk

    def integrate_result(self):
        if not self.has_valid_data or len(self.rfm_df) == 0:
            self.final_result_df = pd.DataFrame()
            return
        # 原结果整合逻辑不变，先完成所有表连接
        cust_base = self.df[['客户ID', '客户名称', '客户所属区域']].drop_duplicates('客户ID', keep='first')
        final = cust_base.merge(self.rfm_df, on='客户ID', how='left')
        final = final.merge(self.stability_df, on='客户ID', how='left')
        final = final.merge(self.risk_df, on='客户ID', how='left')  # 此时已无R_最近提货天数_y

        # 填充字典：保留原有逻辑，移除流失预警建议（已删除）
        fill_na = {
            'R_最近提货天数': None, 'F_提货频次': None, 'M_总提货金额': None,
            'R_评分': None, 'F_评分': None, 'M_评分': None, 'RFM总分': None,
            '客户分层': None, '订单变异系数CV': None, '需求稳定性': None,
            '流失风险等级': None
        }
        final = final.fillna(fill_na).round(4)

        # 核心：若存在R_最近提货天数_x（兼容旧逻辑兜底），重命名为原始字段名并删除冗余
        if 'R_最近提货天数_x' in final.columns:
            final.rename(columns={'R_最近提货天数_x': 'R_最近提货天数'}, inplace=True)
            # 若仍有_y字段（兜底），直接删除
            if 'R_最近提货天数_y' in final.columns:
                final.drop(columns=['R_最近提货天数_y'], inplace=True)

        self.final_result_df = final

    def run_analysis(self):
        """执行全流程分析：前置拦截空数据，避免后续报错"""
        if not self.has_valid_data:
            print("❌ 无有效分析数据！终止客户分析流程")
            return pd.DataFrame()
        print("🚀 开始执行客户分析全流程...")
        self.calculate_rfm()
        self.calculate_stability()
        self.calculate_risk()
        self.integrate_result()
        print("✅ 客户分析全流程执行完成（所有缺失数据已置空）")
        return self.final_result_df


# -------------------------- 4. 生成JSON数据 --------------------------
def generate_analysis_json(final_df):
    if final_df.empty:
        return json.dumps({"error": "无有效分析数据，无法生成结果"}, ensure_ascii=False, indent=4)
    analysis_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # 🔴 核心：移除建议字段，仅保留核心分析数据
    drop_cols = ['流失预警建议', '定制化订货建议']  # 待删除的建议字段
    keep_cols = [col for col in final_df.columns if col not in drop_cols]
    df_core = final_df[keep_cols].copy()

    # 分析概览（不变，基于核心数据统计）
    overview = {
        "分析基准时间": analysis_date,
        "参与分析客户总数": len(df_core),
        "客户分层分布": df_core['客户分层'].value_counts().to_dict(),
        "需求稳定性分布": df_core[df_core['需求稳定性'] != '无数据']['需求稳定性'].value_counts().to_dict(),
        "流失风险分布": df_core[df_core['流失风险等级'] != '无数据']['流失风险等级'].value_counts().to_dict(),
        "核心分析维度": ["RFM模型评分", "订单变异系数CV稳定性", "流失风险预警"],
        "说明": "流失预警建议、定制化订货建议由LLM基于本数据后续生成"
    }

    # 提取精简版表头（无建议字段）
    customer_header = df_core.columns.tolist()
    # 转换为纯值二维数组（保留null/数值/字符串原始类型，无任何键名）
    customer_data = df_core.values.tolist()

    # 整合最终优化结构
    final_json = {
        "analysis_overview": overview,
        "customer_analysis_header": customer_header,
        "customer_analysis_data": customer_data
    }

    # 生成JSON（ensure_ascii=False保留中文，indent=2精简缩进更省Token，可按需改4）
    return json.dumps(final_json, ensure_ascii=False, indent=2)


# -------------------------- 5. 主函数（执行入口） --------------------------
if __name__ == '__main__':
    try:
        # 步骤1：加载SQL数据（带调试信息）
        raw_data = load_data_from_sql()
        # 步骤2：初始化分析智能体
        analysis_agent = CustomerAnalysisAgent(raw_data)
        # 步骤3：执行分析（有空数据拦截）
        final_result_df = analysis_agent.run_analysis()
        # 步骤4：生成JSON
        analysis_json = generate_analysis_json(final_result_df)
        # 步骤5：输出JSON（传给大模型）
        print("\n==================== 客户分析结果-JSON格式 ====================")
        print(analysis_json)
    except Exception as e:
        print(f"\n❌ 程序执行失败：{str(e)}")
        # 无数据时返回标准化错误JSON，供大模型识别
        error_json = json.dumps({"code": -1, "msg": f"执行失败：{str(e)}", "data": None}, ensure_ascii=False, indent=4)
        print("标准化错误JSON：", error_json)