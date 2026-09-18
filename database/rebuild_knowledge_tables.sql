DROP TABLE IF EXISTS sys_knowledge_documents;

CREATE TABLE sys_knowledge_documents (
    id VARCHAR(50) PRIMARY KEY,                   
    dataset_id VARCHAR(100) NOT NULL,
    dify_document_id VARCHAR(100) NOT NULL,       
    file_name VARCHAR(255) NOT NULL,              
    tenant_id VARCHAR(50) NOT NULL,               
    visibility VARCHAR(20) NOT NULL,              
    parse_status VARCHAR(20) NOT NULL,
    authorized_users TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tenant_dataset_visibility ON sys_knowledge_documents(tenant_id, dataset_id, visibility);
CREATE UNIQUE INDEX idx_dify_document_id ON sys_knowledge_documents(dify_document_id);
