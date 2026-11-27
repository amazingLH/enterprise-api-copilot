from entity import Tool
from models import LargeLanguageModel
from prompt import PromptModelHub, QwenModelPromptHub, create_prompt_hub
from tools import ToolManager
from utils import logger
from pydantic import ValidationError
from .pydantic_bridge import build_pydantic_model

class ParamExtractionHub:
    """
    ParamExtractionHub 类的初始化方法。

    该方法用于初始化 ParamExtractionHub 类的实例，设置大语言模型、提示模型中心，
    并保存模型名称、温度和采样概率等参数。

    参数:
    model (str): 使用的大语言模型名称。
    temperature (float): 用于控制生成文本随机性的温度参数，值越高输出越随机。
    top_p (float): 核采样概率，用于控制生成文本时的词汇选择范围。

    属性:
    LargeLanguageModel (LargeLanguageModel): 大语言模型实例。
    PromptModelHub (PromptModelHub): 提示词中心实例。
    model (str): 使用的大语言模型名称。
    temperature (float): 温度参数。
    top_p (float): 核采样概率。
    """

    def __init__(self, model, temperature, top_p, api_url, api_key):
        self.LargeLanguageModel = LargeLanguageModel(api_url, api_key)
        self.PromptModelHub = create_prompt_hub(model)
        self.model = model
        self.temperature = temperature
        self.top_p = top_p


    def validate_params(self, tool: Tool, extractionParam):
        """验证提取的参数是否符合工具请求体的要求。

        先做缺失检查，再做 Pydantic 类型校验和自动类型转换。
        缺失字段（含空字符串）从参数字典中剔除并走补充链路，不触发重试；
        这样空串不会被 Pydantic 当作非法整数/浮点数而抛错，正确提取的值也能保留。

        参数:
            tool (Tool): 工具实例，包含请求体信息。
            extractionParam (dict): 提取的参数，键为参数名，值为参数值。

        返回:
            tuple: (校验后的参数字典, 缺失参数列表)
        """
        # Step 1: 缺失检查（不走 Pydantic，缺失走补充而非重试）
        # 必须先于类型校验执行：空字符串 "supplierId": "" 对 int 字段来说，
        # Pydantic 会抛 ValidationError，而系统约定"空串 = 缺失"。
        # 若让空串先进 Pydantic，重试 3 次全部因类型错误失败，兜底降级时连
        # 正确提取的值（quantity=10 等）也会被一并丢弃。
        missing_param = []
        valid_param = {}
        for target_param in tool.request_body:
            value = extractionParam.get(target_param.name, None)
            if value is None:
                if target_param.required:
                    missing_param.append(target_param)
                    logger.debug(f"已添加[{tool.tool_id} - {tool.operationId}] 缺失参数：{target_param.name}")
            elif isinstance(value, str) and len(value) == 0:
                # 空字符串按缺失处理，不进入类型校验，不进入参数字典
                missing_param.append(target_param)
                logger.debug(f"已添加[{tool.tool_id} - {tool.operationId}] 缺失参数（空字符串）：{target_param.name}")
            else:
                valid_param[target_param.name] = value

        # Step 2: Pydantic 类型校验 + 类型转换（只对剩余非空字段）
        #运行时动态构造一个 Pydantic 模型类。
        # tool.request_body 是当前工具的参数定义列表（每个参数有 name、type、required 等属性）。
        # build_pydantic_model() 遍历这些参数定义，用 pydantic.create_model() 动态创建一个类。
        # 例如工具有 productId: string 和 quantity: integer 两个参数，它就等价于手写了：
        # class DynamicToolParam(BaseModel):
        #     productId: str
        #     quantity: int
        model_cls = build_pydantic_model(tool.request_body)
        # 把 LLM 输出的原始 dict（剔除空串后）传入 Pydantic 模型，触发类型校验和自动转换。
        # valid_param 是 LLM 解析后得到的 dict，
        # 例如 {"productId": "A001", "quantity": "20"}——注意 quantity 的值是字符串 "20"，不是整数。
        # Pydantic 在实例化时会自动做两件事：
        # 类型转换："20" → 20（字符串自动转整数）、"true" → True、123 → "123"（整数转字符串）
        # 类型校验：如果值无法转换（如 quantity: "abc"），抛出 ValidationError
        # 如果校验失败，这里的 ValidationError 会被外层 extraction_params_with_retry() 捕获，进入重试循环让 LLM 重新生成。
        validated = model_cls(**valid_param)
        # 把 Pydantic 实例"倒回"普通 dict，供后续代码使用。
        # model_dump() 是 Pydantic v2 的导出方法
        converted = validated.model_dump(by_alias=True)

        return converted, missing_param


    def extraction_params_with_retry(self, query, tool: Tool, max_retries: int = 3):
        """
        带重试机制的参数提取。解析失败时将原始输出 + 错误信息作为上下文重试。

        三层防线：
        1. Prompt 约束（原有）
        2. 解析重试（新增，最多 3 次，低温修正）
        3. 兜底降级（标记所有必填参数为缺失）
        """
        last_error = None
        last_output = None

        for attempt in range(max_retries):
            prompt = self.PromptModelHub.gen_get_all_parameters_prompt(query, tool.request_body)

            if attempt > 0 and last_error:
                correction_prompt = f"""
                    Your previous response was:
                    ---
                    {last_output[:800]}
                    ---
                    
                    It failed to parse. Error: {last_error}
                    
                    Please output ONLY a valid JSON object matching the required schema.
                    Do NOT include markdown code blocks (no ```json), explanations, or any other text.
                    The output must start with "{{" and end with "}}".
                    """
                full_prompt = prompt + "\n\n" + correction_prompt
                model_output = self.LargeLanguageModel.chat_completions(
                    full_prompt, self.model, 0.0, self.top_p
                )
            else:
                model_output = self.LargeLanguageModel.chat_completions(
                    prompt, self.model, self.temperature, self.top_p
                )

            last_output = model_output

            if model_output is None or len(model_output.strip()) == 0:
                last_error = "Model returned empty response"
                continue

            results = self.PromptModelHub.post_process_get_all_parameter_result(model_output, tool)

            if results is None:
                last_error = "post_process returned None"
                continue

            if len(results) == 0:
                last_error = "No valid JSON object found in response"
                continue

            try:
                validated_params, missing_param = self.validate_params(tool, results)
            except ValidationError as e:
                last_error = f"Pydantic validation failed: {e}"
                last_output = model_output
                continue
            return validated_params, missing_param

        logger.error(
            f"参数提取重试{max_retries}次均失败，"
            f"query={query[:100]}, tool={tool.name_for_human}, last_error={last_error}"
        )
        all_required = [p for p in tool.request_body if p.required]
        return {}, all_required

    def extraction_params(self, query, tool: Tool):
        """
        提取工具参数。此函数根据用户查询和工具信息，
        使用大语言模型生成提取参数的提示，并通过模型生成提取参数的结果。
        内部委托到带重试的新实现。
        参数:
            query (str): 用户查询字符串。
            tool (Tool): 工具实例，包含请求体信息。
        返回:
            元组: (提取的参数<键为参数名，值为参数值>,经检查后缺失的参数)
        """
        return self.extraction_params_with_retry(query, tool, max_retries=3)

    # 保留原实现作为参考
    def _extraction_params_no_retry(self, query, tool: Tool):
        request_body = tool.request_body
        prompt = self.PromptModelHub.gen_get_all_parameters_prompt(query, request_body)
        model_output = self.LargeLanguageModel.chat_completions(prompt, self.model, self.temperature, self.top_p)
        logger.debug(f"提取工具参数模型输出：{model_output}")
        results = self.PromptModelHub.post_process_get_all_parameter_result(model_output, tool)
        converted, missing_param = self.validate_params(tool, results)
        return converted, missing_param