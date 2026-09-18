import bcrypt from 'bcryptjs';

// 获取命令行传入的明文密码参数
const plainTextPassword = process.argv[2];

if (!plainTextPassword) {
    console.log('❌ 请提供需要加密的明文密码！');
    console.log('💡 用法: node generate_hash.js <你的新密码>');
    process.exit(1);
}

// 生成盐并混淆加密
const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(plainTextPassword, salt);

console.log('\n✅ 密码加密成功！\n');
console.log('明文密码:', plainTextPassword);
console.log('加密结果:', hash);
console.log('\n👉 请将上方以 $2a$ 开头的【加密结果】复制，并直接粘贴替换 require/users.json 中对应的 password 字段即可。');
