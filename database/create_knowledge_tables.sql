CREATE TABLE IF NOT EXISTS sys_knowledge_documents (
    id VARCHAR(50) PRIMARY KEY,                   
    dify_document_id VARCHAR(100) NOT NULL,       
    file_name VARCHAR(255) NOT NULL,              
    tenant_id VARCHAR(50) NOT NULL,               
    visibility VARCHAR(20) NOT NULL,              
    parse_status VARCHAR(20) NOT NULL,            
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_visibility ON sys_knowledge_documents(tenant_id, visibility);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dify_document_id ON sys_knowledge_documents(dify_document_id);
