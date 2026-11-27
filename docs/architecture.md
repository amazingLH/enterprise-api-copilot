# 系统架构与执行机制

## 模块分层

[app.py](../backend/app.py)接收请求、检查权限并提交线程池；[ApiPlanningHub](../backend/apis/api_planning_hub.py)决定当前任务做什么；[ToolUseHub](../backend/tools/tool_use_hub.py)组装HTTP请求；[TaskManager](../backend/tasks/task_manager.py)记录状态；React通过轮询展示变化。

线程池使接口能立即返回，但不是持久化队列。任务状态已保存，不代表进程内尚未执行的Future会在服务重启后自动恢复。

## 工具目录与索引

[ToolManager.upload_file](../backend/tools/tool_manager.py)读取OpenAPI JSON中的`servers[0].url`、`paths`和`components.schemas`。每个操作转成工具对象，记录名称、说明、方法、路径与参数。参数包含位置、类型、枚举及格式。

MongoDB保存完整定义，Milvus检索工具ID，再回MongoDB取执行信息。工具说明决定语义检索质量，参数Schema决定提取和校验依据，两者需要同步维护。

导入器针对特定OpenAPI结构实现：请求体经`application/json`下的`$ref`解析；参数需要描述和类型，部分非字符串类型需要`format`。解析到的参数当前均被标为必填，`isValidate`根据操作中文名称推断。它不是完整OpenAPI规范实现，接入新目录必须检查导入后的定义。

## 工具选择的三个阶段

[ApiSelectionHub](../backend/apis/api_selection_hub.py)先向Milvus请求`topK × 2`个工具，第一层按相似度阈值检查无结果情况。默认`topK=5`、阈值`0.35`。然后调用工具管理器的重排路径，最后由LLM在候选中精选。

Rerank把工具名称与说明拼成候选文本，调用DashScope TextReRank。重排路径会再次进行候选检索，并非原样复用上一层列表。重排异常时保留原候选顺序，完全没有相关工具时结束规划。

向量召回负责覆盖相关工具，重排优化顺序，模型结合任务语义做最后选择。这些分数不是业务执行成功概率；工具选对也不等于参数与权限都正确。

## 参数链路与HTTP执行

[ParamExtractionHub](../backend/param_extraction/param_extraction_hub.py)返回已提取参数及缺失项。规划器为缺失项生成补充查询，如先根据名称查询ID，再回到创建操作；补不齐则返回停止原因。

补齐后运行[ParameterValidator](../backend/param_extraction/parameter_validator.py)，检查必填、空值、类型、枚举、字符串长度及规则。另有模型侧异常调用判断。程序校验约束结构，模型判断提供语义信号，两者都不能替代库存、对象归属等业务规则。

执行器按`path`替换路径参数、按`query`拼接查询、按`requestBody`组织JSON，再调用`requests.request`。当前HTTP调用没有统一显式超时，外部服务长时间不返回会占用线程。生产化改造应同时增加连接/读取超时、业务幂等与调用结果核对。

## 任务状态与人工反馈

[Task](../backend/entity/task_entity.py)保存原始需求、当前需求、子任务描述、待确认工具与参数、节点、边和反馈日志。

| 状态 | 值 | 含义 |
| --- | --- | --- |
| 初始化 | `0` | 创建后尚未规划 |
| 运行中 | `1` | 正在规划、执行或处理反馈 |
| 等待确认 | `100` | 主操作与参数已持久化，等待输入 |
| 结束 | `-1` | 正常完成或停止；原因看输出和图标题 |

进入等待确认后线程可以返回。反馈携带原`taskId`提交到`/api_planning`，后台重新读取任务并续接。分类包括`confirm`、`abort`、`correct_params`、`correct_tool`、`clarify`、`unrelated`和`unclear`。

改参只合并原有参数键，之后重新校验并要求确认；换工具重新选择与提取；无关输入不作为批准。`version`递增和`feedback_log`提供追踪记录，但保存未使用预期版本条件更新，因此当前没有数据库CAS或多实例确认去重保证。

## 多步续接和循环检测

[GenerateTaskHub](../backend/tasks/generate_task_hub.py)判断单步/多步任务。执行后把真实响应与节点上下文交给后续规划，生成下一子任务或汇总。

`_not_loop_validate`默认最多15步，检查最近4次中同一工具和结果重复至少3次、连续3次调用同工具，以及长度2或3的重复工具序列。配置文件虽声明`max_task_steps`和`loop_detection_window`，该方法仍存在默认参数与固定窗口；改变环境变量前需确认实际调用接线。

检测可能停止合法重复查询。新增分页、批处理或状态轮询时，应引入进度标识和参数差异，不只比较工具名称。

## 原始响应、摘要与界面

[ToolExecutionResult](../backend/tasks/tool_result_store.py)记录任务、工具、参数、实际URL、方法、状态码、长度和列表记录数，正文写入GridFS。图节点持有`result_id`；详情接口按任务和节点找回原始响应。

模型主要使用预览和摘要。完整结果能下载，不表示模型看过所有记录；截断后再摘要会丢失部分信息，核对业务结论时应查看原文。[NodeDetails](../frontend/src/pages/Coplilot/NodeDetails.js)提供详情与下载。

前端轮询`nodes`、`edges`和`systemOutput`，当前不通过SSE接收任务变化。图展示的是调用过程，不是知识图谱推理引擎。

## 权限与扩展

令牌同时经过JWT与进程内会话缓存校验，权限装饰器按接口函数名授权。完整结果读取复用任务查询权限。任务模型目前没有用户owner字段，接口权限不能替代多租户资源隔离。

数据库事务不能包住外部HTTP副作用。扩展顺序应先补任务归属、原子认领、批准版本、幂等记录与业务对账，再引入持久化队列和水平扩展。
