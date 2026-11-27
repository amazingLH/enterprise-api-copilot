import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Space, Spin, Table, Tabs } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { TaskNodeResultApi } from '../../api/agent';

export const decodeValue = (value) => {
  let decoded = value;
  for (let index = 0; index < 2 && typeof decoded === 'string'; index += 1) {
    try { decoded = JSON.parse(decoded); } catch { break; }
  }
  return decoded;
};

export const formatValue = (value) => (
  typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
);

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export default function NodeDetails({ node, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDetail(null);
    setError('');
    if (!node?.result_id || !node?.result_task_id) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    TaskNodeResultApi({ task_id: node.result_task_id, node_id: node.id }, controller.signal)
      .then(response => {
        if (!controller.signal.aborted) setDetail(response.data);
      })
      .catch(requestError => {
        if (!controller.signal.aborted) {
          setError(requestError.response?.data?.error || '完整结果加载失败，请关闭详情后重试');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [node]);

  const result = detail ? decodeValue(detail.result) : decodeValue(node?.result);
  const rows = Array.isArray(result) ? result : null;
  const keys = rows ? Array.from(new Set(rows.flatMap(row => (
    row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : ['value']
  )))) : [];
  const columns = keys.map(key => ({
    title: key, key, width: 160,
    render: (_, row) => formatValue(row.record && typeof row.record === 'object' && !Array.isArray(row.record) ? row.record[key] : row.record),
  }));
  const complete = Boolean(detail?.complete);
  const params = detail?.params ?? decodeValue(node?.params);
  const download = () => {
    if (!complete) return;
    let isJson = true;
    try { JSON.parse(detail.result); } catch { isJson = false; }
    const url = URL.createObjectURL(new Blob([detail.result], { type: `${isJson ? 'application/json' : 'text/plain'};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tool-result-${node.result_task_id}-${node.id}.${isJson ? 'json' : 'txt'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const preStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '55vh', overflow: 'auto', background: '#fafafa', padding: 12 };

  return (
    <Drawer title="工具执行详情" open={Boolean(node)} onClose={onClose} width="min(100vw, 960px)" destroyOnHidden>
      {node && (
        <Spin spinning={loading}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="实际查询">{detail?.query || node.task_description || node.name}</Descriptions.Item>
              <Descriptions.Item label="调用工具">{detail?.tool || node.label || node.group}</Descriptions.Item>
              <Descriptions.Item label="请求参数"><pre style={{ ...preStyle, margin: 0 }}>{formatValue(params)}</pre></Descriptions.Item>
              {(detail?.method || node.method) && <Descriptions.Item label="请求方法">{detail?.method || node.method}</Descriptions.Item>}
              {(detail?.url || node.url) && <Descriptions.Item label="接口地址">{detail?.url || node.url}</Descriptions.Item>}
              {(detail?.status_code || node.status_code) && <Descriptions.Item label="HTTP 状态">{detail?.status_code || node.status_code}</Descriptions.Item>}
              <Descriptions.Item label="返回数量">{complete && rows ? `${rows.length} 条` : (node.record_count != null ? `${node.record_count} 条` : '非列表结果或历史记录未统计')}</Descriptions.Item>
            </Descriptions>
            {error && <Alert type="error" showIcon message={error} />}
            {!loading && !complete && <Alert type="warning" showIcon message="以下为节点保留的历史结果或模型预览，可能已截取；没有完整响应时不提供完整下载。历史记录无法自动补回被截取的内容，请重新执行查询。" />}
            {complete && <Alert type="success" showIcon message={`完整响应已保存，共 ${detail.response_length} 个字符。下方可查看全部结果；模型摘要使用的预览可能被截取，不影响查看与下载。`} />}
            <Button type="primary" icon={<DownloadOutlined />} disabled={!complete || loading} onClick={download}>下载完整结果 JSON</Button>
            <Tabs key={`${node.result_task_id || 'legacy'}-${node.id}`} items={[
              {
                key: 'records', label: complete ? '完整结果明细' : '保留的结果',
                children: rows ? <Table
                  size="small" columns={columns}
                  dataSource={rows.map((row, index) => ({ record: row, index }))}
                  rowKey="index"
                  pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 条` }}
                  scroll={{ x: Math.max(600, columns.length * 160) }}
                /> : <pre style={preStyle}>{formatValue(result)}</pre>,
              },
              { key: 'raw', label: complete ? '完整原始响应' : '原始预览', children: <pre style={preStyle}>{detail?.result ?? formatValue(result)}</pre> },
            ]} />
          </Space>
        </Spin>
      )}
    </Drawer>
  );
}
