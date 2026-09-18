import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function testDifyHierarchical() {
    try {
        const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
        const API_KEY = process.env.DIFY_KNOWLEDGE_API_KEY;
        const API_BASE_URL = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';

        const url = `${API_BASE_URL}/datasets/${datasetId}/document/create_by_file`;
        const formData = new FormData();
        const buffer = fs.readFileSync('server/test_upload.txt');
        const blob = new Blob([buffer], { type: 'text/plain' });
        formData.append('file', blob, 'test_hierarchical.txt');
        
        const processData = {
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
        formData.append('data', JSON.stringify(processData));

        console.log("Sending payload:", JSON.stringify(processData, null, 2));

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${API_KEY}` },
            body: formData
        });

        const json = await res.json();
        console.log("Response:", JSON.stringify(json, null, 2));

        if (json.batch) {
            console.log("Polling indexing status for batch:", json.batch);
            setTimeout(async () => {
                const statusRes = await fetch(`${API_BASE_URL}/datasets/${datasetId}/documents/${json.document.id}`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` }
                });
                console.log("Status:", await statusRes.text());
            }, 5000);
        }

    } catch (e) {
        console.error("Test Error:", e.message);
    }
}
testDifyHierarchical();
