# 开发、接口与验证

## 代码阅读顺序

从[app.py](../backend/app.py)的`mesh_query`和`process_init_task`理解异步受理，再看[任务实体](../backend/entity/task_entity.py)、[状态常量](../backend/utils/const.py)、[规划器](../backend/apis/api_planning_hub.py)、[工具选择](../backend/apis/api_selection_hub.py)、[参数提取](../backend/param_extraction/param_extraction_hub.py)、[HTTP执行](../backend/tools/tool_use_hub.py)和[原始结果](../backend/tasks/tool_result_store.py)。

前端从[API封装](../frontend/src/api/agent.js)进入[对话页面](../frontend/src/pages/Coplilot/index.js)，再看[节点详情](../frontend/src/pages/Coplilot/NodeDetails.js)，对应提交、轮询、确认与原文读取。

## 接口契约

| 接口 | 输入 | 用途 |
| --- | --- | --- |
| `POST /register_user` | 账号、密码与确认字段 | 创建普通账号 |
| `POST /login_user` | 账号与密码 | 取得访问令牌 |
| `GET /get_all_tools` | Bearer令牌 | 工具列表 |
| `POST /upload_tool` | JSON文件及管理权限 | 导入与索引 |
| `POST /api_planning` | 新任务字段，或`taskId`＋反馈 | 返回任务编号 |
| `POST /api_task_status` | `task_id` | 状态、节点、边及输出 |
| `POST /api_task_node_result` | `task_id`、`node_id` | 原始响应及请求元数据 |

已有任务反馈使用`taskId`，查询状态使用`task_id`。接口200表示已受理，不表示业务任务已完成。任务`-1`同时用于完成与停止，需要结合输出判断原因。

## 功能检查矩阵

| 场景 | 检查证据 |
| --- | --- |
| 单步只读查询 | 候选、最终工具、参数、确认状态和真实返回 |
| 多步依赖 | 后一步的ID是否来自前一步实际数据 |
| 无工具匹配 | 明确停止，没有任意URL调用 |
| 参数缺失 | 停止或要求补充，不编造字段 |
| 改参后确认 | 未修改字段保留，新参数重新校验和确认 |
| 取消、无关输入 | 取消终止，无关输入不当作批准 |
| 4xx/5xx或非JSON | 原始状态码、正文和最终说明一致 |
| 大响应 | GridFS保留完整正文，详情下载不被摘要截断 |
| 重复无进展调用 | 触发循环规则，日志能解释原因 |
| 未登录或无权限 | 401/403与授权范围一致 |

写操作使用独立测试API与可重建数据。外部调用超时后，先核对业务结果，再决定重试。

## 指标口径

已有开发记录：21个工具、37个任务用例，工具选择F1为`0.9905`，必填参数完整率和类型正确率均为`100%`；另有8个带预期停止原因的用例全部通过。

F1综合工具选择的精确率和召回率，不是订单创建成功率。必填完整性、类型检查也不能替代库存、价格和归属约束。停止用例只检查指定路径，不能推出所有循环都已覆盖。

公开源码当前未附带对应完整后端评测数据集，因此上述数值作为历史开发记录保留。新增评测应同时保存模型、目录版本、输入、预期、实际轨迹、错误分类和统计方法，避免只保存最终分数。

## 扩展方式

新增工具先明确用途、参数和副作用，说明中写清何时用与何时不用。导入后分别检查粗召回、重排、最终选择与参数校验。新增参数类型需同步解析、校验和请求组装；新增反馈意图需同步常量、后处理、规划分支及界面提示。

可靠性改进先补显式HTTP超时、任务owner和确认原子认领，再增加业务幂等；之后才将线程池迁移到持久化队列。增加线程数或引入Redis并不会自动解决重复副作用。
