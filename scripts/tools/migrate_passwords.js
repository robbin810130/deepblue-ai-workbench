import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const usersPath = path.join(__dirname, 'require', 'users.json');

async function migratePasswords() {
    if (!fs.existsSync(usersPath)) {
        console.log('users.json 不存在');
        return;
    }

    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    let modified = false;

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        // 如果密码没有经过 bcrypt 加密 (通常 $2a$ 开头)
        if (!user.password.startsWith('$2a$') && !user.password.startsWith('$2b$')) {
            console.log(`Migrating password for user: ${user.username}`);
            // 使用同步或异步皆可，脚本用同步就行
            const salt = bcrypt.genSaltSync(10);
            user.password = bcrypt.hashSync(user.password, salt);
            modified = true;
        }
    }

    if (modified) {
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 4), 'utf8');
        console.log('迁移完毕，所有的用户明文密码均已被加密。');
    } else {
        console.log('无需迁移，密码均以受保护形式存在。');
    }
}

migratePasswords();
