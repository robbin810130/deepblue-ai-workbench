const yaml = require('js-yaml');
const fs = require('fs');

const doc = yaml.load(fs.readFileSync('tmp/uploads/物料匹配_分离记忆库_新.yml', 'utf8'));
const nodes = doc.workflow.graph.nodes;

const mergeNode = nodes.find(n => n.id === 'node_merge_retrieval');
if (mergeNode) {
  mergeNode.data.outputs.merged.type = 'object'; // Return a single object per iteration
  mergeNode.data.code = `import re

def main(arg1, arg2):
    # arg1 是标准库的结果列表，arg2 是记忆库的结果列表
    merged_text = ""
    
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
                # 将其伪装成原先 xlsx 库的 JSON 风格，追加到合并文本的最前面
                fake_json = f'"itemno":"{no_match.group(1).strip()}";"itemname":"{name_match.group(1).strip()}";"descript":"{spec_val}"'
                merged_text += fake_json + "\\n\\n"
                
    # 追加标准库结果 (arg1)
    if isinstance(arg1, list):
        for item in arg1:
            merged_text += str(item.get("content", "")) + "\\n\\n"
        
    # 返回单一的字典对象，保证 Iteration 拍平后依然是 1:1 的数组
    return {"merged": {"content": merged_text}}`;
}

// 确保下游节点的类型匹配
const iterNode = nodes.find(n => n.id === '1774602869023');
if (iterNode) {
    iterNode.data.output_type = 'object'; // 因为我们每次循环输出一个 object
}

fs.writeFileSync('tmp/uploads/物料匹配_分离记忆库_完美版.yml', yaml.dump(doc));
console.log('Successfully generated PERFECT DSL!');
