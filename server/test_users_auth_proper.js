

async function testUsers() {
    try {
        const loginRes = await fetch('http://127.0.0.1:8081/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: '1' }) // assuming password is 1 or something else, wait...
        });
        const loginData = await loginRes.json();
        if (!loginData.success) {
            console.error("Login failed:", loginData);
            return;
        }
        console.log("Logged in:", loginData.token);
        
        const res = await fetch('http://127.0.0.1:8081/api/knowledge/users', {
            headers: {
                'Authorization': 'Bearer ' + loginData.token
            }
        });
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Body:", text);
    } catch (e) {
        console.error(e);
    }
}
testUsers();
