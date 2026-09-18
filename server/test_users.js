

async function testUsers() {
    try {
        const res = await fetch('http://127.0.0.1:8081/api/knowledge/users');
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Body:", text);
    } catch (e) {
        console.error(e);
    }
}
testUsers();
