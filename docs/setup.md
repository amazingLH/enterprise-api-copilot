# 配置与本地运行

## 服务依赖

推荐Python 3.11和Node.js LTS。先准备MongoDB与Milvus，再配置模型、启动后端和前端。Milvus Standalone容器通常需要配套etcd与对象存储，应确认整个服务组就绪。

常用端口：MongoDB `27017`、Milvus `19530`、后端`5001`、前端`3000`。端口映射更改后同步应用配置，并为数据库与索引保留持久化数据卷。

## 后端环境

```bash
python -m venv backend/.venv
# Windows PowerShell
backend/.venv/Scripts/Activate.ps1
# Linux/macOS改用 source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
```

复制`backend/.env.example`为`backend/.env`，后端工作目录设为`backend`。配置由[utils/config.py](../backend/utils/config.py)通过`load_dotenv`读取，名称大小写与代码一致。

## 环境变量

| 变量 | 默认/要求 | 用途 |
| --- | --- | --- |
| `SECRET_KEY` | 必填 | 本地生成的JWT签名密钥 |
| `model_api_key` | 必填，可回退到`DASHSCOPE_API_KEY` | 聊天和远端Embedding凭据 |
| `model_base_url` | 未填时回退代码内兼容地址 | OpenAI兼容API根地址 |
| `model_name` | `deepseek-v3` | 账号有权限的聊天模型ID |
| `sim_api_key` | 必填 | DashScope重排凭据 |
| `model_temperature` / `model_top_p` | `0.01` / `0.01` | 采样参数 |
| `mongo_host` / `mongo_port` / `mongo_db` | `127.0.0.1` / `27017` / `tools` | 业务数据库 |
| `milvus_uri` / `milvus_db_name` | 本机`19530` / `tool_db` | 向量服务与库名 |
| `local_mode` | 代码默认`1`，示例设为`0` | 为`1`时覆盖部分地址为本机默认值 |
| `topK` | `5` | 候选选择数量 |
| `milvus_similarity_threshold` | `0.35` | 第一层粗召回阈值 |
| `api_result_max_length` | `30000` | 大响应预览和摘要相关限制 |
| `ENHANCED_HUMAN_FEEDBACK` | `1` | 完整反馈意图识别 |

生成随机签名密钥：

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

[RemoteEmbeddingModel](../backend/models/remote_embedding_model.py)复用聊天兼容客户端配置，请求固定Embedding模型`text-embedding-v3`。聊天可用不代表Embedding权限也可用。切换模型或维度后应重建匹配索引。`model_base_url`应为API根地址，不应重复追加聊天路径。

`judge_*`属于可选开发质量分析配置，不是主业务启动条件。循环参数的声明与实际使用差异见[系统架构](architecture.md)。

## 启动

```bash
cd backend
python app.py
```

另开终端，在仓库`frontend`目录运行：

```bash
npm ci
npm start
```

[baseRoot.js](../frontend/src/api/baseRoot.js)默认指向`http://localhost:5001`。文件中的`COPILOT_BACK_BASE_URL`不是Create React App默认暴露的`REACT_APP_*`变量；自定义地址时应修改该文件，或先接入符合构建约定的变量，不能只在环境中添加一个不会注入浏览器的名称。

## 账号与工具导入

通过页面注册登录。普通用户默认只有登录、退出、任务提交和状态查询等权限；目录维护需要管理权限。初次配置在用户管理层授权指定账号，不应向所有注册用户默认开放目录管理。

上传到`/upload_tool`的文件必须是JSON。核对`servers[0].url`、操作说明、参数位置与类型、`components.schemas`及请求体`$ref`，数值等类型应满足当前解析器所需的`format`。导入后检查必填性与操作风险标记，再确认MongoDB和Milvus目录一致。

## 任务请求示例

请求头携带`Authorization: Bearer <token>`，向`POST /api_planning`发送：

```json
{
  "query": "查询指定供应商的商品信息",
  "contexts": [],
  "isCopilot": true,
  "isContext": false,
  "contextNumber": 6
}
```

取得`task_id`后，向`POST /api_task_status`发送`{"task_id":"任务编号"}`。状态为`100`时，向`/api_planning`发送`{"taskId":"同一编号","query":"立即执行"}`，也可提交改参或取消要求。

原始响应由`POST /api_task_node_result`读取，载荷为`task_id`与`node_id`，无需重新调用模型。

## 故障排查

| 现象 | 优先检查 |
| --- | --- |
| 缺少配置 | `.env`位置、工作目录、大小写和必填凭据 |
| 模型401/404 | 账号权限、地域、兼容根地址与模型ID |
| 聊天正常但检索失败 | Embedding权限、Milvus库名和维度 |
| 修改地址无效 | `local_mode`覆盖和前端实际编译配置 |
| 工具上传403 | 用户权限与接口授权名 |
| 导入字段异常 | `$ref`、说明、`format`和组件结构 |
| 确认后不变化 | 当前任务状态、后台日志、外部API阻塞 |
| 节点无完整返回 | 是否为原始响应功能加入前的历史节点 |

默认后端绑定本机。公开部署前需补资源归属、管理端保护、请求限额、执行超时和业务幂等。
