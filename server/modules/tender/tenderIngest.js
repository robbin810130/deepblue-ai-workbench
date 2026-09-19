/**
 * 招标检索 · 结果入库（从 server.js runTenderSearchDify 抽出，D4 试点迁移 XO-02）
 *
 * 三路共用：
 *   1. 旧直连路径（runTenderSearchDify，cron 与旧路由仍走这里）
 *   2. D4 试点路径（/api/tender-search/run 经 legacyBridge 走任务中心）
 *
 * 职责：把 Dify workflow 输出解析为 items → 按 bid_no/bid_id 去重 → 批量写入
 * sys_tender_results。字段映射与旧实现逐字一致，行为零变化。
 */

import pool from '../../db.js';

/**
 * 从 Dify workflow 输出中提取结构化 items（四种情况逐级回落，旧实现原样）。
 * @param {object} outputs Dify data.outputs
 * @returns {{ items: Array<object>, message: string }}
 */
export function extractTenderItems(outputs) {
    let structuredData = {};

    // 情况1：outputs 本身包含 items 数组
    if (outputs.items || outputs.top_items) {
        structuredData = outputs;
    }
    // 情况2：outputs 中的某个字段值是 JSON 字符串（包含 items）
    if (!structuredData.items && typeof outputs === 'object') {
        for (const val of Object.values(outputs || {})) {
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (parsed.items || parsed.top_items) { structuredData = parsed; break; }
                } catch (e) { /* 非 JSON，跳过 */ }
            }
        }
    }
    // 情况3：从 markdown JSON 代码块提取
    if (!structuredData.items) {
        const outputStr = typeof outputs === 'string' ? outputs : JSON.stringify(outputs);
        const m = outputStr.match(/```json\s*\n([\s\S]*?)\n```/);
        if (m) { try { structuredData = JSON.parse(m[1]); } catch (e) { /* 忽略 */ } }
    }

    const items = structuredData.items || structuredData.top_items || [];
    return { items, message: structuredData.message || '检索完成' };
}

/**
 * items 去重并批量入库。
 * @param {Array<object>} rawItems Dify 返回的 items（兼容 top_items）
 * @returns {Promise<{insertedCount:number, skippedCount:number}>}
 */
export async function ingestTenderItems(rawItems) {
    let insertedCount = 0;
    let skippedCount = 0;
    if (!rawItems || rawItems.length === 0) return { insertedCount, skippedCount };

    const batchId = 'BATCH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const cols = ['batch_id','bid_id','bid_no','bid_type','bid_process','bidder_name','project_name','biz_type','project_amount','channel_type','region','bidder_count','budget_amount','file_acquire_time','file_acquire_method','bid_doc_fee','deadline','bid_method','source_site','link','candidate_names','winning_company','winning_amount','announcement_date'];
    const placeholders = cols.map((_, i) => '$' + (i + 1)).join(',');
    const sql = 'INSERT INTO sys_tender_results (' + cols.join(',') + ') VALUES (' + placeholders + ')';

    // 查询已存在的 bid_no 和 bid_id，用于去重（优先 bid_no，回退 bid_id）
    const nonEmptyBidNos = rawItems.map(item => String(item.bid_no || '').trim()).filter(id => id);
    const nonEmptyBidIds = rawItems.map(item => String(item.bid_id || '').trim()).filter(id => id);
    let existingBidNos = new Set();
    let existingBidIds = new Set();
    if (nonEmptyBidNos.length > 0) {
        const existRes = await pool.query('SELECT bid_no FROM sys_tender_results WHERE bid_no = ANY($1)', [nonEmptyBidNos]);
        existingBidNos = new Set(existRes.rows.map(r => r.bid_no));
    }
    if (nonEmptyBidIds.length > 0) {
        const existRes = await pool.query('SELECT bid_id FROM sys_tender_results WHERE bid_id = ANY($1)', [nonEmptyBidIds]);
        existingBidIds = new Set(existRes.rows.map(r => r.bid_id));
    }

    for (const item of rawItems) {
        const bidNo = String(item.bid_no || '').trim();
        const bidId = String(item.bid_id || '').trim();
        // 如果 bid_no 非空且已存在，跳过；否则如果 bid_id 非空且已存在，跳过
        if (bidNo && existingBidNos.has(bidNo)) {
            skippedCount++;
            continue;
        }
        if (!bidNo && bidId && existingBidIds.has(bidId)) {
            skippedCount++;
            continue;
        }
        // 字段映射：Dify 字段名 → 数据库字段名
        const vals = [
            batchId,
            String(item.bid_id || '').slice(0, 200),
            String(item.bid_no || '').slice(0, 200),
            parseInt(item.bid_type) || 0,
            parseInt(item.bid_process) || 0,
            String(item.bidder_name || '').slice(0, 500),
            String(item.project_name || '').slice(0, 500),
            String(item.business_type || item.biz_type || '').slice(0, 100),        // business_type → biz_type
            String(item.project_amount || '').slice(0, 200),
            String(item.channel_type || '').slice(0, 100),
            String(item.region || '').slice(0, 200),
            parseInt(item.shortlisted_count) || parseInt(item.bidder_count) || 0,   // shortlisted_count → bidder_count
            String(item.budget_amount || '').slice(0, 200),
            String(item.doc_period || item.file_acquire_time || '').slice(0, 100),  // doc_period → file_acquire_time
            String(item.doc_method || item.file_acquire_method || '').slice(0, 200), // doc_method → file_acquire_method
            String(item.doc_fee || item.bid_doc_fee || '').slice(0, 100),           // doc_fee → bid_doc_fee
            String(item.bid_deadline || item.deadline || '').slice(0, 100),         // bid_deadline → deadline
            String(item.bid_method || '').slice(0, 100),
            String(item.source_website || item.source_site || '').slice(0, 200),    // source_website → source_site
            String(item.bid_url || item.link || '').slice(0, 1000),                  // bid_url → link
            JSON.stringify(item.candidate_names || item.candidate_names || []),       // candidate_names
            String(item.winning_company || '').slice(0, 500),
            String(item.winning_amount || '').slice(0, 200),
            String(item.announcement_date || '').slice(0, 100)
        ];
        try { await pool.query(sql, vals); insertedCount++; } catch (e) { console.warn('[招标检索] 插入失败:', e.message); }
    }
    console.log(`[招标检索] 已入库 ${insertedCount} 条, 跳过重复 ${skippedCount} 条, batch_id=${batchId}`);
    return { insertedCount, skippedCount };
}

/**
 * outputs → 解析 + 入库 → 旧响应形状（一步到位）。
 * @param {object} outputs Dify data.outputs（或归一化输出）
 */
export async function ingestTenderOutputs(outputs) {
    const { items, message } = extractTenderItems(outputs);
    console.log(`[招标检索] 完成, items: ${items.length}`);
    const { insertedCount, skippedCount } = await ingestTenderItems(items);
    return {
        success: true,
        message,
        items_count: insertedCount,
        skipped_count: skippedCount,
        items,
    };
}
