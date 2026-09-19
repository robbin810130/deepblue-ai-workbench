/**
 * materialQuote 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import pool from '../db.js';

export function segMaterialQuote1(app, __ctx) {
app.post('/api/material-quote/sync-erp', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const { customerName, copperPriceType = '现货价', copperBasePrice = 73.4, items } = req.body;
        if (!customerName || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: '缺少订单必要参数' });
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(100 + Math.random() * 900);
        const orderId = `SO-${dateStr}${randomNum}`;

        await client.query('BEGIN');

        for (const item of items) {
            let materialNo = item.material_no;
            // 映射为标准料号以关联工艺参数、可用库存和机台并满足外键约束
            if (materialNo === '物料1') {
                materialNo = 'Mat-YJV4x25';
            } else if (materialNo === '物料2') {
                materialNo = 'Mat-VV4x50';
            } else if (materialNo === '物料3') {
                materialNo = 'Mat-YJV4x16';
            } else if (!['Mat-YJV4x25', 'Mat-YJV4x16', 'Mat-BV2.5', 'Mat-VV4x50'].includes(materialNo)) {
                materialNo = 'Mat-YJV4x25';
            }

            const qty = parseFloat(item.qty) || 1000.00;
            const unitPrice = parseFloat(item.unit_price) || 0.00;
            
            let unitWeight = 1.0;
            try {
                const specRes = await client.query('SELECT standard_unit_weight FROM sys_mock_material_specs WHERE material_no = $1', [materialNo]);
                if (specRes.rowCount > 0 && specRes.rows[0].standard_unit_weight) {
                    unitWeight = parseFloat(specRes.rows[0].standard_unit_weight);
                }
            } catch (err) {
                console.error('[server] Fetch spec weight error:', err);
            }
            const totalAmount = parseFloat((qty * unitWeight * unitPrice).toFixed(2));

            // A. 查询成品备货库存表，按照 FOR UPDATE 锁定，并尝试进行占用/锁库
            const stockRes = await client.query(
                `SELECT id, qty_on_hand, qty_allocated, warehouse_name 
                 FROM sys_mock_material_stock 
                 WHERE material_no = $1 
                 ORDER BY (qty_on_hand - qty_allocated) DESC 
                 FOR UPDATE`,
                [materialNo]
            );

            let remainingQtyToAllocate = qty;
            if (stockRes.rowCount > 0) {
                for (const row of stockRes.rows) {
                    if (remainingQtyToAllocate <= 0) break;
                    const onHand = parseFloat(row.qty_on_hand);
                    const allocated = parseFloat(row.qty_allocated);
                    const available = onHand - allocated;

                    if (available > 0) {
                        const allocateAmt = Math.min(remainingQtyToAllocate, available);
                        await client.query(
                            'UPDATE sys_mock_material_stock SET qty_allocated = qty_allocated + $1 WHERE id = $2',
                            [allocateAmt, row.id]
                        );
                        remainingQtyToAllocate -= allocateAmt;
                    }
                }
            }

            // B. 针对该物料料号，智能识别适用的机台队列负载 (选取出空闲度最高且能力适用的机台进行分配)
            let assignedMachine = 'Ext-03';
            const machineRes = await client.query(
                'SELECT machine_id, machine_name, capable_specs, current_load_percent, last_produced_spec FROM sys_mock_machine_queues'
            );
            if (machineRes.rowCount > 0) {
                const candidates = [];
                for (const mRow of machineRes.rows) {
                    const capableSpecs = mRow.capable_specs.split(',');
                    if (capableSpecs.includes(materialNo)) {
                        const load = parseInt(mRow.current_load_percent);
                        let bonus = 0;
                        if (mRow.last_produced_spec === materialNo) {
                            bonus = 30;
                        }
                        candidates.push({
                            machine_id: mRow.machine_id,
                            score: (100 - load) + bonus
                        });
                    }
                }
                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.score - a.score);
                    assignedMachine = candidates[0].machine_id;
                }
            }

            // C. 评估计算交期
            const leadTimeRes = await client.query(
                'SELECT queue_duration_hours, standard_lead_time_km FROM sys_mock_machine_queues WHERE machine_id = $1',
                [assignedMachine]
            );
            let totalHours = 8.0;
            if (leadTimeRes.rowCount > 0) {
                const row = leadTimeRes.rows[0];
                const queueHours = parseFloat(row.queue_duration_hours);
                const leadSpeed = parseFloat(row.standard_lead_time_km);
                totalHours = queueHours + (qty / 1000.0) * leadSpeed;
            }
            const workingDays = Math.ceil(totalHours / 8.0);
            const deliveryDateObj = new Date(Date.now() + (workingDays + 1) * 24 * 60 * 60 * 1000);
            const deliveryDate = deliveryDateObj.toISOString().split('T')[0];

            // D. 插入记录到 sys_mock_erp_orders 表
            await client.query(
                `INSERT INTO sys_mock_erp_orders (id, customer_name, material_no, qty, unit_price, total_amount, delivery_date, copper_price_type, copper_base_price, machine_assigned)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [orderId, customerName, materialNo, qty, unitPrice, totalAmount, deliveryDate, copperPriceType, parseFloat(copperBasePrice), assignedMachine]
            );
        }

        await client.query('COMMIT');
        logger.info(`[material-quote] 一键同步 ERP 成功。已生成订单号: ${orderId}，已进行锁定并扣减库存。`);
        res.json({ success: true, orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[material-quote] ERP Sync error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
})
}
