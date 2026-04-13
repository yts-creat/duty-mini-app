# 值班签到小程序版（本地可运行）

## 功能
- 手机号 + 验证码 + 密码注册
- 手机号 + 密码登录
- 填写值班表（日期、开始时间、结束时间、说明）
- 签到必须匹配自己的值班安排
- 进站/出站均按班次前后 20 分钟校验

## 技术栈
- 后端：Node.js + Express + JWT + bcryptjs
- 前端：原生 HTML/CSS/JS（移动端风格）
- 数据：本地 JSON 文件（`data/db.json`）

## 启动方式
```bash
npm install
npm start
```

浏览器打开：`http://localhost:3000`

## 生产环境变量
- `NODE_ENV=production`
- `PORT=3000`
- `JWT_SECRET=请替换为高强度随机字符串`
- `DB_PATH=/tmp/db.json`
- `SMS_PROVIDER=mock`（演示）或 `tencent`（真实短信）

可参考 `.env.example`。

## 上线（Render，推荐）
1. 把项目推到 GitHub（仓库根目录包含 `Dockerfile` 和 `render.yaml`）。
2. 在 Render 新建 Web Service，选择你的 GitHub 仓库（官方文档：<https://render.com/docs/web-services>）。
3. Runtime 选 Docker，Render 会基于 `Dockerfile` 构建（官方文档：<https://render.com/docs/docker>）。
4. 环境变量里设置 `JWT_SECRET`（必须），`NODE_ENV=production`。
5. 部署完成后得到公网 URL，即可访问。

## 上线（Railway，备选）
1. 把项目推到 GitHub。
2. 在 Railway 新建项目并连接仓库。
3. 项目根目录有 `Dockerfile` 时会自动使用它构建（官方文档：<https://docs.railway.com/deploy/dockerfiles>）。
4. 设置环境变量 `JWT_SECRET`、`NODE_ENV=production` 后发布。

## 说明
- 当前验证码接口是演示模式：调用“获取验证码”后会直接在页面提示验证码，方便本地调试。
- 生产环境需要替换为真实短信服务（如阿里云短信、腾讯云短信等）。
- 当前默认使用 `data/db.json` 文件存储数据。若你部署到无持久化磁盘环境，重启后数据可能丢失，建议接入 MySQL/PostgreSQL。

## 真实短信（腾讯云）接入
1. 在腾讯云短信控制台申请并通过：
- `SmsSdkAppId`
- `签名`
- `短信模板`（建议两个变量：`{1}=验证码`，`{2}=过期分钟数`）
2. 在 Render 环境变量中设置：
- `SMS_PROVIDER=tencent`
- `SMS_TENCENT_SECRET_ID=...`
- `SMS_TENCENT_SECRET_KEY=...`
- `SMS_TENCENT_APP_ID=...`
- `SMS_TENCENT_SIGN_NAME=...`
- `SMS_TENCENT_TEMPLATE_ID=...`
- `SMS_TENCENT_REGION=ap-guangzhou`
3. 重新部署后，`/api/auth/send-code` 会真实下发短信到手机，不再在页面显示验证码。
