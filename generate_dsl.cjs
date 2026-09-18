const yaml = require('js-yaml');
const fs = require('fs');
const doc = yaml.load(fs.readFileSync('tmp/uploads/物料匹配_带记忆库_最新.yml', 'utf8'));

const nodes = doc.workflow.graph.nodes;
const edges = doc.workflow.graph.edges;

const n1 = nodes.find(n => n.id === '1774658018056');
n1.data.dataset_ids = ['piLhdE6mSxwzIHdk6dMOj1QAklXWwtr8aNWNki8hIld0jE4eYLmHw4zglJLvUgH5'];
n1.data.title = '知识检索_标准库';

const n2 = JSON.parse(JSON.stringify(n1));
n2.id = 'node_memory_retrieval';
n2.data.dataset_ids = ['17482fe4-8818-4570-9cf6-7d30d14de84f'];
n2.data.title = '知识检索_纠错库';
n2.position.y += 120;
n2.positionAbsolute.y += 120;
nodes.push(n2);

const mergeNode = {
  id: 'node_merge_retrieval',
  type: 'custom',
  data: {
    title: '合并检索结果',
    type: 'code',
    code: 'def main(arg1, arg2):\n    s1 = str(arg1) if arg1 else ""\n    s2 = str(arg2) if arg2 else ""\n    return {"merged": s2 + "\\n" + s1}',
    code_language: 'python3',
    outputs: {
      merged: { children: null, type: 'string' }
    },
    variables: [
      { variable: 'arg1', value_selector: ['1774658018056', 'result'], value_type: 'string' },
      { variable: 'arg2', value_selector: ['node_memory_retrieval', 'result'], value_type: 'string' }
    ],
    selected: false,
    isInIteration: true
  },
  parentId: '1774602869023',
  position: { x: n1.position.x + 300, y: n1.position.y },
  positionAbsolute: { x: n1.positionAbsolute.x + 300, y: n1.positionAbsolute.y },
  height: 100,
  width: 242,
  zIndex: 1002
};
nodes.push(mergeNode);

const iterNode = nodes.find(n => n.id === '1774602869023');
iterNode.data.output_selector = ['node_merge_retrieval', 'merged'];

edges.push(
  {
    id: 'start_to_n2',
    source: '1774602869023start',
    target: 'node_memory_retrieval',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'custom',
    data: {
      isInIteration: true,
      iteration_id: '1774602869023',
      sourceType: 'iteration-start',
      targetType: 'knowledge-retrieval'
    },
    zIndex: 1002
  },
  {
    id: 'n1_to_merge',
    source: '1774658018056',
    target: 'node_merge_retrieval',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'custom',
    data: {
      isInIteration: true,
      iteration_id: '1774602869023',
      sourceType: 'knowledge-retrieval',
      targetType: 'code'
    },
    zIndex: 1002
  },
  {
    id: 'n2_to_merge',
    source: 'node_memory_retrieval',
    target: 'node_merge_retrieval',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'custom',
    data: {
      isInIteration: true,
      iteration_id: '1774602869023',
      sourceType: 'knowledge-retrieval',
      targetType: 'code'
    },
    zIndex: 1002
  }
);

fs.writeFileSync('tmp/uploads/物料匹配_分离记忆库_新.yml', yaml.dump(doc));
console.log('Successfully generated new DSL!');
