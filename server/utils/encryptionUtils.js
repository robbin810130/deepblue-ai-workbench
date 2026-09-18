// ============================================================
// server/utils/encryptionUtils.js — AES-256-GCM 凭证加密/解密工具
// ============================================================
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;       // 初始化向量长度
const TAG_LENGTH = 16;      // 认证标签长度
const KEY_LENGTH = 32;      // 256 bit

/**
 * 从环境变量获取加密密钥（64 位 hex = 32 字节）
 * 若未配置则使用默认开发密钥（生产环境务必配置 EQ_ENCRYPTION_KEY）
 */
function getKey() {
    const envKey = process.env.EQ_ENCRYPTION_KEY;
    if (envKey && envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
        return Buffer.from(envKey, 'hex');
    }
    // 开发环境回退：使用固定哈希生成密钥
    return crypto.createHash('sha256').update(envKey || 'eq-dev-default-key-change-in-production').digest();
}

/**
 * AES-256-GCM 加密
 * @param {string} plaintext - 明文
 * @returns {string} 密文字符串，格式：iv:authTag:ciphertext（均为 hex 编码，用 : 分隔）
 */
export function encrypt(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
        throw new Error('加密输入必须为非空字符串');
    }
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // 格式：iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * AES-256-GCM 解密
 * @param {string} ciphertextStr - 密文字符串（格式：iv:authTag:ciphertext）
 * @returns {string} 解密后的明文
 */
export function decrypt(ciphertextStr) {
    if (!ciphertextStr || typeof ciphertextStr !== 'string') {
        throw new Error('解密输入必须为非空字符串');
    }
    const parts = ciphertextStr.split(':');
    if (parts.length !== 3) {
        throw new Error('密文格式无效');
    }
    const [ivHex, tagHex, encryptedHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * 计算文件 SHA-256 校验值
 * @param {Buffer} fileBuffer - 文件内容
 * @returns {string} hex 格式的 SHA-256 哈希
 */
export function computeChecksum(fileBuffer) {
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}
