"""完整工具响应存入 GridFS；任务节点和模型上下文仅保存有界预览。"""

import json

from mongoengine import Document, StringField, DictField, IntField, FileField


class ToolExecutionResult(Document):
    task_id = StringField(required=True)
    query = StringField()
    tool = StringField()
    params = DictField()
    method = StringField()
    url = StringField()
    status_code = IntField()
    response_length = IntField()
    record_count = IntField(null=True)
    body = FileField()
    meta = {'indexes': ['task_id']}


def save_tool_result(task_id, query, tool, params, response):
    text = response.text
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        data = None
    result = ToolExecutionResult(
        task_id=task_id, query=query, tool=tool.name_for_human, params=params,
        method=tool.method.upper(), url=response.url or f'{tool.api_url}{tool.path}',
        status_code=response.status_code, response_length=len(text),
        record_count=len(data) if isinstance(data, list) else None,
    )
    result.body.put(text.encode('utf-8'), content_type='text/plain; charset=utf-8')
    try:
        result.save()
    except Exception:
        result.body.delete()
        raise
    return {
        'result_id': str(result.id), 'result_task_id': task_id,
        'response_length': result.response_length, 'record_count': result.record_count,
        'status_code': result.status_code, 'method': result.method, 'url': result.url,
    }


def register_tool_result_routes(app, require_permission, task_manager):
    from flask import jsonify, request

    @app.route('/api_task_node_result', methods=['POST'])
    @require_permission
    def get_task_node_result():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict) or not data.get('task_id') or 'node_id' not in data:
            return jsonify({'error': '需要 task_id 和 node_id'}), 400
        task = task_manager.get_task_by_id(data['task_id'])
        if task is None:
            return jsonify({'error': '任务不存在'}), 404
        node = next((item for item in task.nodes if str(item['id']) == str(data['node_id'])), None)
        if node is None:
            return jsonify({'error': '节点不存在'}), 404
        if not node.get('result_id'):
            return jsonify({'error': '此历史节点未保存完整响应，仅可查看当时保留的结果'}), 404
        result = ToolExecutionResult.objects(id=node['result_id'], task_id=task.task_id).first()
        if result is None or not result.body.grid_id:
            return jsonify({'error': '完整响应不存在'}), 404
        return jsonify({
            'query': result.query, 'tool': result.tool, 'params': result.params,
            'method': result.method, 'url': result.url, 'status_code': result.status_code,
            'response_length': result.response_length, 'record_count': result.record_count,
            'result': result.body.read().decode('utf-8'), 'complete': True,
        })
