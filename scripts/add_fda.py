import os
import json
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DB_URL = "postgresql://dify_admin:Asdf.159753@39.108.221.22:9800/dify_memory"
engine = create_engine(DB_URL)
Session = sessionmaker(bind=engine)

data = [
    ("Bithionol", "硫双二氯酚", "全面禁用"),
    ("Mercury compounds", "汞化合物", "全面禁用（除了极少数眼部化妆品作为防腐剂，且上限为 0.0065%）"),
    ("Vinyl chloride", "氯乙烯", "全面禁用（作为气雾剂推进剂）"),
    ("Halogenated salicylanilides", "卤代水杨酰苯胺", "全面禁用"),
    ("Zirconium complexes", "锆络合物", "全面禁用（在气雾剂/喷雾类化妆品中）"),
    ("Chloroform", "氯仿/三氯甲烷", "全面禁用"),
    ("Methylene chloride", "二氯甲烷", "全面禁用"),
    ("Chlorofluorocarbon propellants", "氯氟烃推进剂", "全面禁用"),
    ("Prohibited cattle materials", "受限牛源材料", "全面禁用（防范疯牛病）")
]

def upsert_ingredient(session, inci_name, cn_name):
    sql = text("""
        INSERT INTO ingredients (inci_name, cn_name) 
        VALUES (:inci_name, :cn_name) 
        ON CONFLICT (inci_name) DO UPDATE 
        SET cn_name = COALESCE(ingredients.cn_name, EXCLUDED.cn_name)
        RETURNING id;
    """)
    result = session.execute(sql, {'inci_name': inci_name, 'cn_name': cn_name})
    return result.fetchone()[0]

def upsert_rule(session, ingredient_id, restriction_desc):
    sql = text("""
        INSERT INTO compliance_rules (ingredient_id, region, category, status, restrictions, source_file)
        SELECT :ingredient_id, 'USA', 'Banned', 'Prohibited', CAST(:restrictions AS JSONB), 'FDA 明确禁用成分清单'
        WHERE NOT EXISTS (
            SELECT 1 FROM compliance_rules 
            WHERE ingredient_id = :ingredient_id 
              AND region = 'USA' 
              AND category = 'Banned' 
              AND source_file = 'FDA 明确禁用成分清单'
        );
    """)
    res_str = json.dumps({'RESTRICTIONS': restriction_desc}, ensure_ascii=False)
    session.execute(sql, {
        'ingredient_id': ingredient_id,
        'restrictions': res_str
    })

def main():
    session = Session()
    try:
        for inci, cn, rest in data:
            ing_id = upsert_ingredient(session, inci, cn)
            upsert_rule(session, ing_id, rest)
            print(f"Inserted {inci}")
        session.commit()
        print("FDA explicit banned ingredients added successfully.")
    except Exception as e:
        session.rollback()
        print("Error:", e)
    finally:
        session.close()

if __name__ == '__main__':
    main()
