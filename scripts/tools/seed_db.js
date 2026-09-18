import pool from './db.js';

const seedData = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('开始插入初始数据...');

    // 1. 新闻关键词
    const newsKeywords = [
        ['科技前沿', 'AI大模型', 1], ['科技前沿', '半导体', 2], ['科技前沿', '商业航天', 3], ['科技前沿', '仿生机器人', 4], ['科技前沿', '低空经济', 5], ['科技前沿', '量子计算', 6],
        ['金融资本', '宏观政策', 1], ['金融资本', '投融资', 2], ['金融资本', 'IPO动态', 3], ['金融资本', '股市纵览', 4], ['金融资本', '数字货币', 5], ['金融资本', '美联储', 6],
        ['行业聚焦', '美妆', 1], ['行业聚焦', '服饰', 2], ['行业聚焦', '食品', 3], ['行业聚焦', '电商出海', 4], ['行业聚焦', '跨境贸易', 5],
        ['地域资讯', '粤港澳大湾区', 1], ['地域资讯', '汕头', 2], ['地域资讯', '广州', 3], ['地域资讯', '深圳', 4], ['地域资讯', '香港', 5], ['地域资讯', '长三角', 6], ['地域资讯', '海外市场', 7],
        ['热点人物', '马斯克', 1], ['热点人物', '黄仁勋', 2], ['热点人物', '库克', 3], ['热点人物', '雷军', 4], ['热点人物', '奥特曼(Sam Altman)', 5]
    ];
    for (const [group, kw, order] of newsKeywords) {
        await client.query(`INSERT INTO ref_news_keywords (group_name, keyword, sort_order, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [group, kw, order]);
    }

    // 2. 产品类别
    const productTypes = [
        ['beauty_rnd', '清透粉底液', 1], ['beauty_rnd', '持妆粉底液', 2], ['beauty_rnd', '高遮瑕粉底液', 3],
        ['market', '口红', 1], ['market', '粉饼', 2], ['market', '粉底液', 3], ['market', '眼影', 4], ['market', '面膜', 5], ['market', '精华', 6], ['market', '卸妆产品', 7]
    ];
    for (const [mod, name, order] of productTypes) {
        await client.query(`INSERT INTO ref_product_types (module, name, sort_order, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [mod, name, order]);
    }

    // 3. 目标市场
    const targetMarkets = [
        ['beauty_rnd', '欧盟', 1], ['beauty_rnd', '马来西亚', 2], ['beauty_rnd', '印尼', 3], ['beauty_rnd', '东南亚', 4]
    ];
    for (const [mod, name, order] of targetMarkets) {
        await client.query(`INSERT INTO ref_target_markets (module, name, sort_order, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [mod, name, order]);
    }

    // 4. 用户痛点标签
    const painPoints = [
        ['清爽', 1], ['控油', 2], ['哑光', 3], ['高遮瑕', 4], ['不闷痘', 5], ['抗汗防水', 6], ['日常持妆', 7], ['自然提亮', 8]
    ];
    for (const [name, order] of painPoints) {
        await client.query(`INSERT INTO ref_pain_point_tags (name, sort_order, is_active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`, [name, order]);
    }

    // 5. 认证
    const certs = [
        ['BPOM 清真', '印尼', 1], ['REACH 合规', '欧盟', 2], ['无认证', '全球', 3]
    ];
    for (const [name, region, order] of certs) {
        await client.query(`INSERT INTO ref_certifications (name, region, sort_order, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [name, region, order]);
    }

    // 6. 目标语种
    const languages = [
        ['en', '英语', '🇬🇧', 1], ['id', '印尼语', '🇮🇩', 2], ['vi', '越南语', '🇻🇳', 3], ['th', '泰语', '🇹🇭', 4]
    ];
    for (const [code, name, emoji, order] of languages) {
        await client.query(`INSERT INTO ref_languages (code, name, flag_emoji, sort_order, is_active) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING`, [code, name, emoji, order]);
    }

    // 7. 目标平台
    const platforms = [
        ['TikTok', '短视频/直播带货', 1], ['Shopee', '电商平台', 2], ['Lazada', '电商平台', 3]
    ];
    for (const [name, desc, order] of platforms) {
        await client.query(`INSERT INTO ref_platforms (name, description, label, sort_order, is_active) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING`, [name, desc, desc, order]);
    }

    // 8. 营销风格
    const styles = [
        ['种草风格', 1], ['专业风格', 2], ['平价风格', 3]
    ];
    for (const [name, order] of styles) {
        await client.query(`INSERT INTO ref_marketing_styles (name, sort_order, is_active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`, [name, order]);
    }

    await client.query('COMMIT');
    console.log('所有初始数据插入成功！');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('插入失败：', e);
  } finally {
    client.release();
    process.exit(0);
  }
};

seedData();
