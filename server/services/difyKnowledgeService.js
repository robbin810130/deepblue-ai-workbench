import fs from 'fs';

const getHeaders = () => ({
    'Authorization': `Bearer ${process.env.DIFY_KNOWLEDGE_API_KEY}`
});

const getBaseUrl = () => {
    return process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
};

const getDatasetId = (datasetId) => {
    // 映射前端传来的场景标识到实际的 Dify Dataset UUID
    if (datasetId === 'company_rules') {
        return process.env.DIFY_KNOWLEDGE_DATASET_ID;
    }
    if (datasetId === 'tender_knowledge') {
        return process.env.DIFY_TENDER_KNOWLEDGE_DATASET_ID;
    }
    // 未来如果新增产品知识库，可以继续在这里增加映射
    // if (datasetId === 'product_knowledge') return process.env.DIFY_PRODUCT_DATASET_ID;
    
    return process.env.DIFY_KNOWLEDGE_DATASET_ID;
};

async function callWithHeaders(url, options) {
    const headers = getHeaders();
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Dify error: ${res.status} ${errText}`);
    }
    return await res.json();
}

export const difyKnowledgeService = {
    async createByFile(filePath, fileName, tenantId, datasetId, mimeType, processMode) {
        const url = `${getBaseUrl()}/datasets/${getDatasetId(datasetId)}/document/create_by_file`;
        const formData = new FormData();
        const buffer = fs.readFileSync(filePath);
        const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
        formData.append('file', blob, fileName);

        // 构建分段配置：processMode='custom' 时使用简单配置，否则使用分层分段
        let processData;
        if (processMode === 'custom') {
            processData = {
                indexing_technique: "high_quality",
                process_rule: {
                    mode: "custom",
                    rules: {
                        pre_processing_rules: [
                            { id: "remove_extra_spaces", enabled: true },
                            { id: "remove_urls_emails", enabled: false }
                        ],
                        segmentation: {
                            separator: "\n\n",
                            max_tokens: 1024,
                            chunk_overlap: 50
                        }
                    }
                }
            };
        } else {
            processData = {
                indexing_technique: "high_quality",
                process_rule: {
                    mode: "hierarchical",
                    rules: {
                        pre_processing_rules: [
                            { id: "remove_extra_spaces", enabled: true },
                            { id: "remove_urls_emails", enabled: false }
                        ],
                        segmentation: {
                            separator: "\n\n",
                            max_tokens: 1024,
                            chunk_overlap: 50
                        },
                        parent_mode: "paragraph",
                        subchunk_segmentation: {
                            separator: "\n",
                            max_tokens: 512,
                            chunk_overlap: 0
                        }
                    }
                },
                doc_form: "hierarchical_model"
            };
        }
        formData.append('data', JSON.stringify(processData));

        const res = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: formData
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Dify upload error: ${res.status} ${errText}`);
        }

        const json = await res.json();
        return json;
    },

    async getIndexingStatus(documentId, datasetId) {
        const url = `${getBaseUrl()}/datasets/${getDatasetId(datasetId)}/documents/${documentId}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Dify get status error: ${res.status} ${errText}`);
        }

        return await res.json();
    },

    async deleteDocument(documentId, datasetId) {
        const url = `${getBaseUrl()}/datasets/${getDatasetId(datasetId)}/documents/${documentId}`;
        const res = await fetch(url, {
            method: 'DELETE',
            headers: getHeaders()
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Dify delete error: ${res.status} ${errText}`);
        }

        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch(e) {
            return { result: 'success', text };
        }
    },

    async updateByFile(documentId, filePath, fileName, datasetId, mimeType) {
        const url = `${getBaseUrl()}/datasets/${getDatasetId(datasetId)}/documents/${documentId}/update_by_file`;
        const formData = new FormData();
        const buffer = fs.readFileSync(filePath);
        const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
        formData.append('file', blob, fileName);
        
        const res = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: formData
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Dify update error: ${res.status} ${errText}`);
        }

        return await res.json();
    },

    /**
     * 知识检索（召回原文片段，用于知识库「知识问答」的来源引用）
     *
     * 用 dataset API key 调用官方 retrieve 端点，不产生生成式回答，
     * 因此**不需要**额外的问答类应用凭据 —— 任何配好知识库 key 的环境都能用。
     */
    async retrieve(query, datasetId, topK = 4) {
        const url = `${getBaseUrl()}/datasets/${getDatasetId(datasetId)}/retrieve`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { ...getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                retrieval_model: {
                    search_method: 'semantic_search',
                    reranking_enable: false,
                    top_k: topK,
                    score_threshold_enabled: false
                }
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Dify retrieve error: ${res.status} ${errText}`);
        }

        const json = await res.json();
        const records = Array.isArray(json?.records) ? json.records : [];
        return records.map((r) => ({
            document_name: r?.segment?.document?.name || r?.segment?.document_name || '未命名文档',
            segment: r?.segment?.content || '',
            score: typeof r?.score === 'number' ? r.score : null
        }));
    }
};
