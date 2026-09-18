const yaml = require('js-yaml');
const fs = require('fs');

const doc = yaml.load(fs.readFileSync('tmp/uploads/物料匹配_分离记忆库_完美版.yml', 'utf8'));
const nodes = doc.workflow.graph.nodes;

const mergeNode = nodes.find(n => n.id === 'node_merge_retrieval');
if (mergeNode) {
  // Add arg3 to variables
  if (!mergeNode.data.variables.some(v => v.variable === 'arg3')) {
      mergeNode.data.variables.push({
          variable: 'arg3',
          value_selector: ['1774602869023', 'item'],
          value_type: 'string' // Could be object, python code handles both
      });
  }

  mergeNode.data.code = `import re
import json

def main(arg1, arg2, arg3):
    # arg1: 标准库结果
    # arg2: 记忆库结果
    # arg3: 当前迭代的源数据 item
    
    # 1. 尝试从当前迭代 item (arg3) 中提取本次真实的 OCR 识别名称和规格
    current_ocr_name = ""
    current_ocr_spec = ""
    if isinstance(arg3, dict):
        current_ocr_name = str(arg3.get("itemname", ""))
        current_ocr_spec = str(arg3.get("descript", ""))
    elif isinstance(arg3, str):
        try:
            parsed = json.loads(arg3)
            current_ocr_name = str(parsed.get("itemname", ""))
            current_ocr_spec = str(parsed.get("descript", ""))
        except:
            nm = re.search(r'"itemname"\\s*:\\s*"([^"]+)"', arg3)
            sm = re.search(r'"descript"\\s*:\\s*"([^"]+)"', arg3)
            if nm: current_ocr_name = nm.group(1)
            if sm: current_ocr_spec = sm.group(1)
            
    merged_text = ""
    
    # 2. 优先处理记忆库结果 (arg2) —— 增加严格校验（Strict Validation）
    if isinstance(arg2, list) and current_ocr_name:
        for item in arg2:
            content = str(item.get("content", ""))
            
            # 提取记忆库中的原始 OCR 记录
            ocr_record_match = re.search(r'OCR识别：([^\\n]+)', content)
            if ocr_record_match:
                ocr_record = ocr_record_match.group(1)
                
                # 【核心过滤逻辑】：记忆库里的 OCR 记录，必须完全包含当前的 itemname
                # 为了更严谨，如果当前有 spec(规格)，也要求包含
                is_valid = current_ocr_name in ocr_record
                if current_ocr_spec and current_ocr_spec not in ocr_record:
                    is_valid = False
                    
                if is_valid:
                    # 只有严格匹配，才允许伪装并置顶
                    no_match = re.search(r'纠错物料编码：([^\\n]+)', content)
                    name_match = re.search(r'纠错物料名称：([^\\n]+)', content)
                    spec_match = re.search(r'纠错规格：([^\\n]+)', content)
                    
                    if no_match and name_match:
                        spec_val = spec_match.group(1).strip() if spec_match else ""
                        fake_json = f'"itemno":"{no_match.group(1).strip()}";"itemname":"{name_match.group(1).strip()}";"descript":"{spec_val}"'
                        merged_text += fake_json + "\\n\\n"
                        break # 命中一条最优纠错即可，忽略其他相似干扰项
                        
    # 3. 追加标准库结果 (arg1)
    if isinstance(arg1, list):
        for item in arg1:
            merged_text += str(item.get("content", "")) + "\\n\\n"
        
    # 返回单一的字典对象，保证 Iteration 拍平后依然是 1:1 的数组
    return {"merged": {"content": merged_text}}`;
}

fs.writeFileSync('tmp/uploads/物料匹配_分离记忆库_严格过滤版.yml', yaml.dump(doc));
console.log('Successfully generated STRICT DSL!');
