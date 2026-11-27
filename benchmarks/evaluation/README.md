# 评测协议与结果汇总

本模块固定评测范围、记录结构和统计口径。评测范围是输入配置，测量结果由逐条观察记录计算；本模块不内置准确率、F1或模型评分常量。

## 数据来源与执行边界

汇总器只读取带原始证据文件引用的JSONL记录，不调用模型、不向业务接口写入，也不发送邮件。每次报告保存输入文件、协议和证据文件的SHA-256指纹。源记录仍需来自实际评测执行，文件存在与哈希一致不能单独证明记录内容正确。

`scope_complete`只表示记录数量与范围配置匹配，不代表所有任务通过。零分母输出null；缺少原始证据、重复ID或不合法分数会终止汇总。使用`--strict-scope`要求完整覆盖配置范围。

## 运行

在仓库根目录使用Python 3.11及以上版本运行。仅使用标准库，不依赖数据库或模型凭据。

```bash
python benchmarks/evaluation/aggregate_metrics.py --project copilot --records PATH_TO_RECORDS --output PATH_TO_REPORT
python -m unittest discover -s benchmarks/evaluation -p "test_*.py" -v
```

Copilot另外传入`--inventory`指定与本次实验一致的工具Schema目录。DeepResearch工程回归传入`--junit`指定同次pytest执行生成的JUnit XML；计数由唯一测试ID与执行状态计算。

## 所有记录共同字段

| 字段 | 含义 |
| --- | --- |
| record_id | 全局唯一的观察记录编号 |
| kind | 观察类型，见各项目说明 |
| case_id | 固定测试用例或引用核验单元编号 |
| source_artifact | 相对JSONL文件的原始请求/响应、工具轨迹或审计文件路径；文件必须存在且非空 |

将原始记录和生成的结果存放在受控目录，公开前清理凭据、候选人资料、邮件和内部知识正文。仓库不要求上传私有实验材料。

## Copilot评测范围

| 项目 | 协议数量 | 计数单位 |
| --- | --- | --- |
| 业务工具目录 | 46 | 唯一可调用operationId，附输入Schema |
| 任务 | 110 | 独立任务请求 |
| 预期停止子集 | 41 | 包含在任务集合内，不另加到任务总数 |

任务分层与停止原因组见`protocol.json`。`inventory.current.json`是从现有OpenAPI文件逐项提取的工具目录，其数量由文件计算；工具目录覆盖检查按实际清单执行，不通过修改数量字段扩充工具。

### 任务记录

`kind=task`，包含`expected_tools`、`actual_tools`、`tool_calls`及`is_stop_case`。工具名集合去重后计算每任务F1，再对存在期望或实际工具的任务等权平均；预期与实际都无工具的场景不加入工具选择F1，由停止指标单独评价。

每次`tool_calls`包含`tool_id`、`extraction_attempted`与`parameters`。工具Schema目录为对象数组，每个对象包含`tool_id`、`required`和`properties`；每个属性声明JSON类型。

必填参数完整率按已进入提取阶段的必填字段机会统计，空参数对象仍计缺失。类型正确率按被检查参数值统计，JSON布尔值不作为整数，未知字段或类型显式报错。零分母不当作100%。这与旧评估函数跳过空参数或缺Schema的口径不同，报告之间需固定同一协议版本比较。

### 停止记录

当`is_stop_case=true`时，另外记录`expected_stop_reason`、`actual_stop_reason`、`status`及`unauthorized_side_effects`。停止原因一致、状态为stopped且未授权副作用为0才判通过，不仅检查回答中有没有停止说明。

```bash
python benchmarks/evaluation/aggregate_metrics.py --project copilot --records observations.jsonl --inventory benchmarks/evaluation/inventory.current.json --output report.json
```
