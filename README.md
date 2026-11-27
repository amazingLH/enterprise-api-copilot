# Enterprise API Copilot

自然语言查找和调用业务 API，执行前展示待确认操作。Flask 和 React 构建应用，MongoDB 记录工具与任务，Milvus 检索工具定义，GridFS 保存原始返回。

## 本地运行

导入一个有访问权限的 OpenAPI 定义。请求需连接支持聊天、Embedding 与 Rerank 的模型服务，以及自己的业务 API。MongoDB 与 Milvus 宿主地址在后端配置。

在 `backend` 创建 Python 3.11 虚拟环境。复制 `.env.example` 为 `.env` 后填写本地服务与密钥，按需导出为进程环境变量。签名密钥请在本地独立生成。

```sh
pip install -r requirements.txt
python app.py
```

在 `frontend` 安装依赖并启动开发服务。根据本机环境配置后端地址，后端示例端口为 5001。

```sh
npm ci
npm start
```
