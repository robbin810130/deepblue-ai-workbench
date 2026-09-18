const yaml = require('js-yaml');
const fs = require('fs');

const doc = yaml.load(fs.readFileSync('tmp/uploads/物料匹配_分离记忆库_新.yml', 'utf8'));
const nodes = doc.workflow.graph.nodes;

const mergeNode = nodes.find(n => n.id === 'node_merge_retrieval');
if (mergeNode) {
  mergeNode.data.outputs.merged.type = 'array[object]';
  mergeNode.data.code = `import re

def main(arg1, arg2):
    res = []
    
    # 优先处理记忆库结果 (arg2)
    if isinstance(arg2, list):
        for item in arg2:
            content = str(item.get("content", ""))
            
            # 提取记忆库特有的纯文本格式
            no_match = re.search(r'纠错物料编码：([^\\n]+)', content)
            name_match = re.search(r'纠错物料名称：([^\\n]+)', content)
            spec_match = re.search(r'纠错规格：([^\\n]+)', content)
            
            if no_match and name_match:
                spec_val = spec_match.group(1).strip() if spec_match else ""
                # 将其伪装成原先 xlsx 库的 JSON 风格，骗过下游的正则提取
                fake_json = f'"itemno":"{no_match.group(1).strip()}";"itemname":"{name_match.group(1).strip()}";"descript":"{spec_val}"'
                res.append({"content": fake_json})
            else:
                res.append(item)
                
    # 接着追加标准库结果 (arg1)
    if isinstance(arg1, list):
        res.extend(arg1)
        
    return {"merged": res}`;
}

fs.writeFileSync('tmp/uploads/物料匹配_分离记忆库_终版.yml', yaml.dump(doc));
console.log('Successfully generated final DSL!');
