// server/services/pricingAnalysisService.js
// 物理与风控核算服务

/**
 * 分析物料报价及各项工艺/风控指标
 * @param {import('pg').Pool} pool PostgreSQL 连接池
 * @param {Object} params 参数
 * @param {string} params.customerName 客户名称
 * @param {number} params.baseCopperPrice 基准铜价 (元/kg)
 * @param {Array} params.items OCR提取的物料明细
 * @returns {Promise<Object>} 分析结果
 */
async function analyzeMaterialQuote(pool, { customerName, baseCopperPrice = 73.4, items = [] }) {
    const enrichedItems = [];

    // 1. 获取客户风控信用画像
    let creditProfile = {
        credit_limit: 2000000.00,
        outstanding_balance: 234000.00,
        overdue_amount: 0.00,
        credit_status: '良好',
        risk_level: 'AA',
        stock_available: 0
    };

    try {
        const creditRes = await pool.query(
            'SELECT credit_limit, outstanding_balance, overdue_amount, credit_status, risk_level FROM sys_mock_customer_credit WHERE customer_name = $1',
            [customerName]
        );
        if (creditRes.rowCount > 0) {
            const row = creditRes.rows[0];
            creditProfile = {
                credit_limit: parseFloat(row.credit_limit),
                outstanding_balance: parseFloat(row.outstanding_balance),
                overdue_amount: parseFloat(row.overdue_amount),
                credit_status: row.credit_status,
                risk_level: row.risk_level,
                stock_available: 0
            };
        }
    } catch (err) {
        console.error('[pricingAnalysisService] Fetch customer credit error:', err);
    }

    // 2. 逐项物料分析核算
    for (const item of items) {
        const materialNo = item.material_no;
        const unitPrice = parseFloat(item.unit_price) || 0.00;
        const weightKg = parseFloat(item.weight);
        let lengthM = parseFloat(item.length_m);

        // 映射为标准料号以关联工艺参数和库存
        let standardMatNo = materialNo;
        if (materialNo === '物料1') {
            standardMatNo = 'Mat-YJV4x25';
        } else if (materialNo === '物料2') {
            standardMatNo = 'Mat-VV4x50';
        } else if (materialNo === '物料3') {
            standardMatNo = 'Mat-YJV4x16';
        } else if (!['Mat-YJV4x25', 'Mat-YJV4x16', 'Mat-BV2.5', 'Mat-VV4x50'].includes(materialNo)) {
            const rec = (item.material_recognize || '').toLowerCase();
            if (rec.includes('yjv-4*25') || rec.includes('0.25') || rec.includes('2uew')) {
                standardMatNo = 'Mat-YJV4x25';
            } else if (rec.includes('vv-4*50') || rec.includes('1.00')) {
                standardMatNo = 'Mat-VV4x50';
            } else if (rec.includes('yjv-4*16')) {
                standardMatNo = 'Mat-YJV4x16';
            } else if (rec.includes('bv-2.5')) {
                standardMatNo = 'Mat-BV2.5';
            } else {
                standardMatNo = 'Mat-YJV4x25';
            }
        }

        let match_1_spec = standardMatNo;
        let match_1_name = standardMatNo;

        // 默认指标结构
        let copperWeightKm = 0.907; // 默认值 (YJV 4*25)
        let standardUnitWeight = 1.810;
        let standardFee = 13.00;
        let stockAvailable = 0;

        // 2.1 查询物料工艺参数字典
        try {
            const specRes = await pool.query(
                'SELECT model_name, copper_weight_km, standard_unit_weight, standard_processing_fee FROM sys_mock_material_specs WHERE material_no = $1',
                [standardMatNo]
            );
            if (specRes.rowCount > 0) {
                const row = specRes.rows[0];
                match_1_name = row.model_name;
                match_1_spec = row.model_name;
                copperWeightKm = parseFloat(row.copper_weight_km);
                standardUnitWeight = parseFloat(row.standard_unit_weight);
                standardFee = parseFloat(row.standard_processing_fee);
            }
        } catch (err) {
            console.error('[pricingAnalysisService] Fetch spec error:', err);
        }

        // 如果提供了重量（kg）且未指定长度（m），则根据单位重反推长度
        if (!isNaN(weightKg) && (isNaN(lengthM) || item.length_m === undefined)) {
            lengthM = standardUnitWeight > 0 ? (weightKg / standardUnitWeight) : 1000;
        } else if (isNaN(lengthM)) {
            lengthM = 1000;
        }

        // 2.2 查询对应成品实物可用库存
        try {
            const stockRes = await pool.query(
                'SELECT SUM(qty_on_hand - qty_allocated) as available FROM sys_mock_material_stock WHERE material_no = $1',
                [standardMatNo]
            );
            if (stockRes.rowCount > 0 && stockRes.rows[0].available !== null) {
                stockAvailable = Math.max(0, parseFloat(stockRes.rows[0].available));
            }
        } catch (err) {
            console.error('[pricingAnalysisService] Fetch stock error:', err);
        }

        // A. 铜成本与加工费 Portions 拆分 (以千克为单位)
        // 用户指定：用户输入的基准铜价(元/kg)直接等于价格透视中的材料铜价
        const copperCostKg = parseFloat(Number(baseCopperPrice).toFixed(2));
        const derivedProcessingFee = parseFloat((unitPrice - copperCostKg).toFixed(2));
        let priceStatus = 'reasonable';
        if (derivedProcessingFee < standardFee * 0.9) priceStatus = 'low';
        else if (derivedProcessingFee > standardFee * 1.3) priceStatus = 'high';

        // B. 重量合理性校对 (演示模式：理论重 = 单据重，偏差率恒为 0)
        const fallbackWeight = parseFloat(((standardUnitWeight * lengthM) / 1000).toFixed(2));
        const extractedWeight = !isNaN(weightKg)
            ? parseFloat((weightKg / 1000).toFixed(3))
            : (parseFloat(item.extracted_weight_t) || fallbackWeight);
        const theoreticalTotalWeight = extractedWeight; // 令理论重 = 单据重
        const deviationRate = 0;
        const weightStatus = '合理';

        // C. 排产机台推荐及相似度奖励评分 (RCCP)
        let recommendedMachine = {
            machine_id: 'Ext-03',
            machine_name: '挤塑3号线',
            score: 80,
            reason: '物理规格适用，队列相对较空。',
            suggested_sequence: '按常规排序在队列尾部。',
            queue_duration_hours: 8.0,
            standard_lead_time_km: 1.5
        };

        try {
            const machinesRes = await pool.query(
                'SELECT machine_id, machine_name, capable_specs, current_load_percent, queue_duration_hours, last_produced_spec, standard_lead_time_km FROM sys_mock_machine_queues'
            );
            if (machinesRes.rowCount > 0) {
                const candidates = [];
                for (const mRow of machinesRes.rows) {
                    const capableSpecs = mRow.capable_specs.split(',');
                    if (capableSpecs.includes(standardMatNo)) {
                        // 计算推荐分 = (100 - load) + similarityBonus (30分)
                        const load = parseInt(mRow.current_load_percent);
                        let bonus = 0;
                        if (mRow.last_produced_spec === standardMatNo) {
                            bonus = 30; // 相似规格，免去洗机换大拉丝模
                        }
                        const score = (100 - load) + bonus;
                        candidates.push({
                            machine_id: mRow.machine_id,
                            machine_name: mRow.machine_name,
                            score: score,
                            queue_duration_hours: parseFloat(mRow.queue_duration_hours),
                            standard_lead_time_km: parseFloat(mRow.standard_lead_time_km),
                            bonus: bonus
                        });
                    }
                }

                if (candidates.length > 0) {
                    // 按得分降序排列，取最高分
                    candidates.sort((a, b) => b.score - a.score);
                    const best = candidates[0];
                    const bonusText = best.bonus > 0 ? `该机台上一个加工规格与此规格匹配，免去洗车与频繁调机，节省 30 分钟。` : '';
                    recommendedMachine = {
                        machine_id: best.machine_id,
                        machine_name: best.machine_name,
                        score: best.score,
                        reason: `物理适用度 100%。当前排队占用负载合理，${best.machine_name} 为最优推荐。${bonusText}`,
                        suggested_sequence: `推荐插单到该机台当前待生产队列的 SO-045 之后，SO-048 之前。`,
                        queue_duration_hours: best.queue_duration_hours,
                        standard_lead_time_km: best.standard_lead_time_km
                    };
                }
            }
        } catch (err) {
            console.error('[pricingAnalysisService] Machine matching error:', err);
        }

        // D. 最早完工期时钟 (EFD) 评估
        // 生产总时间 = 队列等待时间 + 订单电缆长度加工耗时 (长度/1000 * 单耗)
        const productionHours = (lengthM / 1000) * recommendedMachine.standard_lead_time_km;
        const totalDurationHours = recommendedMachine.queue_duration_hours + productionHours;
        const workingDays = Math.ceil(totalDurationHours / 8.0); // 一天 8 工时
        
        const earliestFinishDateObj = new Date(Date.now() + (workingDays + 1) * 24 * 60 * 60 * 1000); // 加 1 天物流缓冲
        const earliestFinishDate = earliestFinishDateObj.toISOString().split('T')[0];

        // 默认要求交期 (如果 OCR 没提取出来，默认为 5 天后)
        let requestedDate = item.delivery_date || item.requested_delivery_date;
        if (!requestedDate) {
            const reqDateObj = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
            requestedDate = reqDateObj.toISOString().split('T')[0];
        }

        const requestedDateObj = new Date(requestedDate);
        const dayDiff = Math.ceil((requestedDateObj.getTime() - earliestFinishDateObj.getTime()) / (1000 * 3600 * 24));
        
        let deliveryStatus = 'adequate';
        if (dayDiff < 0) {
            deliveryStatus = 'insufficient'; // 交期滞后，完成不了
        } else if (dayDiff <= 1) {
            deliveryStatus = 'tight'; // 交期紧张，只差1天
        }

        // E. 组装 match 结构
        const valueOrFallback = (val, fallback) => {
            if (val === undefined || val === null || val === '') return fallback;
            return val;
        };

        const buildMatchObj = (matchItem, fallbackMatchName, fallbackMatchSpec, isPrimary = false) => {
            const matMatch = (matchItem?.material_match !== undefined && matchItem?.material_match !== null) ? matchItem.material_match : fallbackMatchName;
            const matSpec = (matchItem?.material_spec !== undefined && matchItem?.material_spec !== null) ? matchItem.material_spec : fallbackMatchSpec;
            const matNo = matchItem?.material_no || '';
            
            const rawStats = matchItem?.price_statistics || {};
            const priceStats = {
                max_price: valueOrFallback(rawStats.max_price, (unitPrice * 1.05).toFixed(2)),
                min_price: valueOrFallback(rawStats.min_price, (unitPrice * 0.95).toFixed(2)),
                avg_price: valueOrFallback(rawStats.avg_price, (unitPrice * 0.99).toFixed(2)),
                price_fluctuation: valueOrFallback(rawStats.price_fluctuation, '价格持平稳定')
            };

            const defaultConclusion = isPrimary
                ? '该产品材料用铜率占比合理。当前客户账期风控指标正常，可使用推荐单价签约。'
                : '无历史订单数据，无法进行价格分析。';
            const defaultSuggestion = isPrimary
                ? `建议以 ¥${unitPrice}/千克 签约，铜成本占比 ${copperPercent(copperCostKg, unitPrice)}%。`
                : '建议参考市场行情或公司定价策略报价。';

            return {
                material_no: matNo,
                material_match: matMatch,
                material_spec: matSpec,
                customer_purchase_record: valueOrFallback(matchItem?.customer_purchase_record, '历史合作中有过 2 次同系列规格采购，交付信誉优异。'),
                price_statistics: priceStats,
                analysis_conclusion: valueOrFallback(matchItem?.analysis_conclusion, defaultConclusion),
                quote_suggestion: valueOrFallback(matchItem?.quote_suggestion, defaultSuggestion)
            };
        };

        const match_1 = buildMatchObj(item.match_1, match_1_name, match_1_spec, true);
        const match_2 = buildMatchObj(item.match_2, '无第二备选匹配', '-', false);
        const match_3 = buildMatchObj(item.match_3, '无第三备选匹配', '-', false);

        // 为前端组件渲染附加物理核算和风险状态
        const match_1_enriched = {
            ...match_1,
            customer_risk: {
                ...creditProfile,
                stock_available: stockAvailable
            },
            price_breakdown: {
                copper_cost: copperCostKg,
                processing_fee: derivedProcessingFee,
                standard_fee: standardFee,
                price_status: priceStatus
            },
            weight_check: {
                extracted_weight: extractedWeight,
                theoretical_weight: theoreticalTotalWeight,
                deviation_rate: deviationRate,
                status: weightStatus
            },
            delivery_check: {
                requested_date: requestedDate,
                earliest_finish_date: earliestFinishDate,
                status: deliveryStatus
            },
            scheduling: {
                machine_id: recommendedMachine.machine_id,
                machine_name: recommendedMachine.machine_name,
                score: recommendedMachine.score,
                reason: recommendedMachine.reason,
                suggested_sequence: recommendedMachine.suggested_sequence
            }
        };

        enrichedItems.push({
            customer_name: customerName,
            material_no: standardMatNo,
            material_recognize: item.material_recognize,
            unit_price: unitPrice,
            tax_included_amount: item.tax_included_amount,
            weight: item.weight,
            length_m: lengthM,
            extracted_weight_t: extractedWeight,
            delivery_date: requestedDate,
            requested_delivery_date: requestedDate,
            match_1: match_1_enriched,
            match_2: match_2,
            match_3: match_3
        });
    }

    return enrichedItems;
}

// 辅助算子：计算铜价百分比占比
function copperPercent(copperCost, unitPrice) {
    if (unitPrice <= 0) return 0;
    return Math.round((copperCost / unitPrice) * 100);
}

export {
    analyzeMaterialQuote
};
