@echo off
echo 正在尝试添加防火墙规则以允许局域网访问...
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [权限检查] 已获得管理员权限
) else (
    echo [权限检查] 需要管理员权限！请右键点击本脚本，选择"以管理员身份运行"
    pause
    exit
)

echo.
echo [1/2] 允许 Node.js 通过防火墙...
netsh advfirewall firewall add rule name="Node.js Web Server" dir=in action=allow protocol=TCP localport=8081 profile=private,public,domain
netsh advfirewall firewall add rule name="Node.js Backend API" dir=in action=allow protocol=TCP localport=3001 profile=private,public,domain

echo.
echo [2/2] 规则添加完成！
echo.
echo 现在请尝试重新运行 npm run dev:all
echo 您的局域网访问地址是: http://192.168.2.60:8081
echo.
pause
