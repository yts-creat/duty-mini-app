# 创业网值班签到系统（周值班表识别版）

## 功能
- 手机号 + 密码注册登录（注册需填写部门）
- 注册/登录页同屏展示公共看板（无需登录可查看）
- 顶部展示创业网 Logo
- 上传固定格式值班表截图并识别值班信息（可编辑后导入）
- OCR 识别弱时会自动生成完整周模板，支持手工补齐后导入
- 每个成员只看到自己本周匹配的值班时段并签到
- 进站/出站按班次前后 20 分钟校验
- 每条签到可填写工作备注
- 支持记录加班开始时间、加班时长、加班备注
- 公共看板查看所有人员签到状态与加班信息
- 公共看板支持导出 CSV 统计
- 每次导入新值班表会自动清空历史签到/加班数据

## 技术栈
- 后端：Node.js + Express + JWT + bcryptjs + tesseract.js
- 前端：原生 HTML/CSS/JS（响应式）
- 数据：本地 JSON（`data/db.json`）

## 本地运行
```bash
npm install
npm start
```

打开：`http://localhost:3000`

## 环境变量
- `NODE_ENV=production`
- `PORT=3000`
- `JWT_SECRET=请替换为高强度随机字符串`
- `DB_PATH=/tmp/db.json`（Render 推荐）

参考文件：`.env.example`

## Render 部署
1. 代码推送到 GitHub。
2. Render 新建 Web Service，连接仓库。
3. Runtime 选 Docker（仓库已包含 `Dockerfile`、`render.yaml`）。
4. 配置环境变量 `JWT_SECRET`、`NODE_ENV=production`。
5. 完成部署后使用 `https://xxx.onrender.com` 访问。

## 说明
- 截图识别依赖 OCR，建议上传清晰、完整、正向截图，导入前请在页面里人工校对。
- 当前数据存储为文件，若平台磁盘非持久化，服务重启后可能丢失数据；生产建议改为数据库。
