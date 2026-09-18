import os
import re
import json
import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ==========================================
# 数据库配置示例 (也可以通过环境变量传入)
# ==========================================
# 请根据实际环境修改以下连接信息
# 格式: postgresql://[用户名]:[密码]@[主机]:[端口]/[数据库名]
DB_URL = os.environ.get('DATABASE_URL', 'postgresql://dify_admin:Asdf.159753@39.108.221.22:9800/dify_memory')

def create_tables(session):
    print("初始化数据库表...")
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS ingredients (
            id SERIAL PRIMARY KEY,
            inci_name VARCHAR UNIQUE,
            cn_name VARCHAR,
            cas_no VARCHAR
        );
        CREATE TABLE IF NOT EXISTS compliance_rules (
            id SERIAL PRIMARY KEY,
            ingredient_id INT REFERENCES ingredients(id),
            region VARCHAR,
            category VARCHAR,
            status VARCHAR,
            restrictions JSONB,
            source_file VARCHAR
        );
    """))
    session.commit()

def upsert_ingredient(session, inci_name, cn_name=None, cas_no=None):
    if pd.isna(inci_name) or str(inci_name).strip() == '':
        return None
    
    inci_name = str(inci_name).strip()
    cn_name = str(cn_name).strip() if pd.notna(cn_name) else None
    cas_no = str(cas_no).strip() if pd.notna(cas_no) else None

    sql = text("""
        INSERT INTO ingredients (inci_name, cn_name, cas_no) 
        VALUES (:inci_name, :cn_name, :cas_no) 
        ON CONFLICT (inci_name) DO UPDATE 
        SET cn_name = COALESCE(ingredients.cn_name, EXCLUDED.cn_name),
            cas_no = COALESCE(ingredients.cas_no, EXCLUDED.cas_no)
        RETURNING id;
    """)
    result = session.execute(sql, {'inci_name': inci_name, 'cn_name': cn_name, 'cas_no': cas_no})
    return result.fetchone()[0]

def upsert_rule(session, ingredient_id, region, category, status, restrictions, source_file):
    if not ingredient_id:
        return
    sql = text("""
        INSERT INTO compliance_rules (ingredient_id, region, category, status, restrictions, source_file)
        SELECT :ingredient_id, :region, :category, :status, CAST(:restrictions AS JSONB), :source_file
        WHERE NOT EXISTS (
            SELECT 1 FROM compliance_rules 
            WHERE ingredient_id = :ingredient_id 
              AND region = :region 
              AND category = :category 
              AND source_file = :source_file
        );
    """)
    res_str = json.dumps(restrictions, ensure_ascii=False) if restrictions else None
    session.execute(sql, {
        'ingredient_id': ingredient_id, 
        'region': region, 
        'category': category, 
        'status': status, 
        'restrictions': res_str,
        'source_file': source_file
    })

def extract_inci_name_from_fda(color_name, other_names):
    """从 FDA 色素表的 Other names 中提取核心 INCI 作为主键，优先提取类似 CI 75470 的编号"""
    if pd.notna(other_names):
        # 匹配 CI 加数字的模式，忽略大小写和中间可能存在的空格
        match = re.search(r'(CI\s*\d+)', str(other_names), re.IGNORECASE)
        if match:
            # 格式化并返回如: CI 75470
            return re.sub(r'\s+', ' ', match.group(1).upper()).strip()
        
        # 如果没有 CI 号，取第一个逗号前的词
        return str(other_names).split(',')[0].strip()
    
    return str(color_name).strip() if pd.notna(color_name) else None

def process_file_1(session, filepath):
    print(f"正在处理: {filepath}")
    df = pd.read_excel(filepath)
    for _, row in df.iterrows():
        cn_name = row['中文名称'] if '中文名称' in df.columns else row.iloc[1]
        inci_name = row['英文名称'] if '英文名称' in df.columns else row.iloc[2]
        
        ing_id = upsert_ingredient(session, inci_name, cn_name=cn_name)
        if ing_id:
            upsert_rule(
                session, ing_id, 
                region='China', 
                category='Banned', 
                status='Prohibited', 
                restrictions=None, 
                source_file='化妆品禁用原料目录.xlsx'
            )
    session.commit()

def process_file_2(session, filepath):
    print(f"正在处理: {filepath}")
    df = pd.read_excel(filepath)
    for _, row in df.iterrows():
        # 处理可能包含换行符的长列名，直接通过索引获取
        cn_name = row.iloc[1] 
        inci_name = row.iloc[2] 
        
        ing_id = upsert_ingredient(session, inci_name, cn_name=cn_name)
        if ing_id:
            upsert_rule(
                session, ing_id, 
                region='China', 
                category='Plant', 
                status='Prohibited', 
                restrictions=None, 
                source_file='化妆品禁用植（动）物原料目录.xlsx'
            )
    session.commit()

def process_file_3(session, filepath):
    print(f"正在处理: {filepath}")
    df = pd.read_excel(filepath)
    
    # 获取所有的列，以防列名带有额外空格
    cols = df.columns.tolist()
    cas_col = next((c for c in cols if 'CAS' in str(c)), cols[0])
    color_col = next((c for c in cols if 'Color' in str(c)), cols[1] if len(cols)>1 else None)
    use_col = next((c for c in cols if 'Use' in str(c)), cols[2] if len(cols)>2 else None)
    rest_col = next((c for c in cols if 'RESTRICTIONS' in str(c).upper()), cols[3] if len(cols)>3 else None)
    other_col = next((c for c in cols if 'Other name' in str(c)), cols[4] if len(cols)>4 else None)

    for _, row in df.iterrows():
        cas_no = row[cas_col] if cas_col else None
        color_name = row[color_col] if color_col else None
        other_names = row[other_col] if other_col else None
        use_val = row[use_col] if use_col else None
        restrictions_val = row[rest_col] if rest_col else None
        
        inci_name = extract_inci_name_from_fda(color_name, other_names)
        
        # 构建 restrictions JSONB
        restrictions_dict = {
            'Use': str(use_val).strip() if pd.notna(use_val) else None,
            'RESTRICTIONS': str(restrictions_val).strip() if pd.notna(restrictions_val) else None
        }
        
        ing_id = upsert_ingredient(session, inci_name, cas_no=cas_no)
        if ing_id:
            upsert_rule(
                session, ing_id, 
                region='USA', 
                category='Colorant', 
                status='Restricted', # 默认色素为限制使用
                restrictions=restrictions_dict, 
                source_file='FDA 的色素专表.xlsx'
            )
    session.commit()

def main():
    base_dir = r'd:\my-web-os\excel'
    file1 = os.path.join(base_dir, '化妆品禁用原料目录.xlsx')
    file2 = os.path.join(base_dir, '化妆品禁用植（动）物原料目录.xlsx')
    file3 = os.path.join(base_dir, 'FDA 的色素专表.xlsx')

    engine = create_engine(DB_URL)
    SessionManager = sessionmaker(bind=engine)
    session = SessionManager()

    try:
        create_tables(session)
        
        if os.path.exists(file1): process_file_1(session, file1)
        if os.path.exists(file2): process_file_2(session, file2)
        if os.path.exists(file3): process_file_3(session, file3)
            
        print("所有数据导入成功！")
    except Exception as e:
        session.rollback()
        print(f"发生错误: {e}")
    finally:
        session.close()

if __name__ == "__main__":
    main()
