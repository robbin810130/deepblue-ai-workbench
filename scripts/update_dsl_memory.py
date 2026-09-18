import yaml

dsl_path = r'd:\my-web-os\tmp\uploads\物料匹配&报价审核__0723copy.yml'
out_path = r'd:\my-web-os\tmp\uploads\物料匹配_带记忆库_最新.yml'

with open(dsl_path, 'r', encoding='utf-8') as f:
    data = yaml.safe_load(f)

for node in data.get('workflow', {}).get('graph', {}).get('nodes', []):
    if node.get('data', {}).get('type') == 'knowledge-retrieval':
        if '17482fe4-8818-4570-9cf6-7d30d14de84f' not in node['data']['dataset_ids']:
            node['data']['dataset_ids'].append('17482fe4-8818-4570-9cf6-7d30d14de84f')

    if node.get('data', {}).get('title') == 'LLM_专业报价建议':
        prompt_templates = node.get('data', {}).get('prompt_template', [])
        for prompt in prompt_templates:
            if prompt.get('role') == 'system':
                text = prompt.get('text', '')
                insert_idx = text.find('====================\n【强制规则！必须严格遵守】')
                if insert_idx != -1 and '纠错记忆优先规则' not in text:
                    new_rules = """【纠错记忆优先规则（最高优先级）】
若知识库检索结果（{{#context#}}）中存在来源为"纠错记忆库"的记录，且客户名称与当前客户匹配，
则将该记录的物料作为 match_1（首选），并在 quote_suggestion 中标注"✅ 历史记忆匹配"。
纠错记忆库的结果权重高于普通物料知识库，不得被普通知识库的结果覆盖。

"""
                    text = text[:insert_idx + 21] + "\n" + new_rules + text[insert_idx + 21:]
                    prompt['text'] = text

with open(out_path, 'w', encoding='utf-8') as f:
    yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

print('Updated DSL saved to 物料匹配_带记忆库_最新.yml')
