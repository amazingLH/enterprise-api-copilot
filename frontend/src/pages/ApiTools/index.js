import { Table, Button, Modal, Progress, Upload, message } from 'antd';
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { useState, useEffect, useRef } from 'react';
import { ToolsApi, DeleteAllToolApi, UploadToolApi, DeleteOneToolApi } from '../../api/agent';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);
const initialOperation = {
  open: false,
  kind: '',
  status: 'success',
  title: '',
  description: '',
  current: 0,
  total: 0,
  percent: 0,
};

const getErrorMessage = (error, fallback) => (
  error?.response?.data?.error
  || error?.response?.data?.message
  || error?.message
  || fallback
);

const countToolsInOpenApi = (document) => {
  if (!document || typeof document.paths !== 'object' || document.paths === null) {
    throw new Error('JSON 文件中缺少有效的 paths 字段');
  }

  return Object.values(document.paths).reduce((total, pathItem) => {
    if (!pathItem || typeof pathItem !== 'object') return total;
    return total + Object.keys(pathItem).filter(method => HTTP_METHODS.has(method.toLowerCase())).length;
  }, 0);
};

export default function ApiTools() {
  const [data, setData] = useState([]);
  const [operation, setOperation] = useState(initialOperation);
  const uploadToolCounts = useRef(new Map());

  const handleGetAllData = async () => {
    try {
      const res = await ToolsApi();
      if (res.status === 200) {
        const results = res.data.results || [];
        setData(results);
        return results;
      }
    } catch (err) {
      console.log(err);
    }
    return null;
	};

  useEffect(() => {
    handleGetAllData();
  }, []);

  const updateOperation = (values) => {
    setOperation(previous => ({ ...previous, ...values }));
  };

  const deleteAllTools = async () => {
    const existingCount = data.length;
    setOperation({
      ...initialOperation,
      open: true,
      kind: 'clear',
      status: 'active',
      title: '正在清空工具',
      description: `正在清空 ${existingCount} 个工具，请稍候…`,
      total: existingCount,
    });

    try {
      const response = await DeleteAllToolApi();
      const deletedCount = response.data?.deleted_count ?? existingCount;
      setData([]);
      setOperation({
        ...initialOperation,
        open: true,
        kind: 'clear',
        status: 'success',
        title: '清空成功',
        description: `已成功清空 ${deletedCount} 个工具。`,
        current: deletedCount,
        total: deletedCount,
        percent: 100,
      });
      handleGetAllData();
    } catch (error) {
      setOperation({
        ...initialOperation,
        open: true,
        kind: 'clear',
        status: 'exception',
        title: '清空失败',
        description: getErrorMessage(error, '清空工具时发生未知错误'),
        total: existingCount,
      });
    }
  };

  const validateUploadFile = async (file) => {
    const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
    if (!isJson) {
      setOperation({
        ...initialOperation,
        open: true,
        kind: 'upload',
        status: 'exception',
        title: '上传失败',
        description: '仅支持 JSON 格式文件。',
      });
      return Upload.LIST_IGNORE;
    }

    try {
      const document = JSON.parse(await file.text());
      const toolCount = countToolsInOpenApi(document);
      if (toolCount === 0) {
        throw new Error('JSON 文件中没有可上传的 API 工具');
      }
      uploadToolCounts.current.set(file.uid, toolCount);
      return true;
    } catch (error) {
      setOperation({
        ...initialOperation,
        open: true,
        kind: 'upload',
        status: 'exception',
        title: '上传失败',
        description: getErrorMessage(error, 'JSON 文件解析失败'),
      });
      return Upload.LIST_IGNORE;
    }
  };

  const uploadAllTools = async ({ file, onSuccess, onError }) => {
    const total = uploadToolCounts.current.get(file.uid) || 0;
    const existingToolKeys = new Set(data.map(tool => String(tool.key)));
    setOperation({
      ...initialOperation,
      open: true,
      kind: 'upload',
      status: 'active',
      title: '正在上传工具',
      description: '正在上传文件…',
      total,
    });

    try {
      const response = await UploadToolApi(file, (event) => {
        const uploadPercent = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
        const percent = Math.min(uploadPercent, 99);
        const current = total ? Math.min(Math.floor((percent / 100) * total), total - 1) : 0;
        updateOperation({
          current,
          total,
          percent,
          description: uploadPercent >= 100 ? '文件已上传，服务器正在写入工具库…' : '正在上传文件…',
        });
      });

      const uploadedCount = response.data?.uploaded_count ?? total;
      setOperation({
        ...initialOperation,
        open: true,
        kind: 'upload',
        status: 'success',
        title: '上传成功',
        description: `已成功上传 ${uploadedCount} 个工具。`,
        current: uploadedCount,
        total: uploadedCount,
        percent: 100,
      });
      handleGetAllData();
      uploadToolCounts.current.delete(file.uid);
      onSuccess?.(response.data);
    } catch (error) {
      const refreshedTools = await handleGetAllData();
      const persistedCount = Array.isArray(refreshedTools)
        ? refreshedTools.filter(tool => !existingToolKeys.has(String(tool.key))).length
        : (error?.response?.data?.uploaded_count || 0);
      const isPartialSuccess = persistedCount > 0;
      const progressPercent = total ? Math.min(Math.round((persistedCount / total) * 100), 100) : 0;
      setOperation({
        ...initialOperation,
        open: true,
        kind: 'upload',
        status: 'exception',
        title: isPartialSuccess ? '上传部分完成' : '上传失败',
        description: isPartialSuccess
          ? `已有 ${persistedCount} 个工具写入数据库，但向量索引未确认成功，这些工具可能暂时无法被智能调用。`
          : getErrorMessage(error, '上传工具时发生未知错误'),
        current: persistedCount,
        total,
        percent: progressPercent,
      });
      uploadToolCounts.current.delete(file.uid);
      onError?.(error);
    }
  };
  

  // 表格列配置
  const columns = [
    { title: '序号', dataIndex: 'index' },
    { title: 'API名称', dataIndex: 'name' },
    { title: 'API描述', dataIndex: 'description' },
    { title: '请求参数', dataIndex: 'params' },{ title: '请求方法', dataIndex: 'method' },
    { 
      title: '操作',
      render: (_, record) => (
        <>
          <Button danger icon={<DeleteOutlined />} onClick={() => {
           DeleteOneToolApi({"ids":[record.key]}).then(res=>{
            if(res.status === 200){
              handleGetAllData();
              message.success('删除成功');
            }
           }).catch(err=>{
            console.log(err);
            message.error('删除失败');
           })


          }} />
        </>
      )
    }
  ];

  return (
    <div className="api-tools-page">
      <div className="table-header">
        <h3 className="neon-title">API 工具管理</h3>
        <div className="toolbar-right">
          <Button 
            danger
            className="danger-btn"
            loading={operation.open && operation.kind === 'clear' && operation.status === 'active'}
            disabled={operation.open && operation.status === 'active'}
            onClick={deleteAllTools}
            style={{ marginRight: 16 }}
          >
            清空所有工具
          </Button>
          <Upload
            name="file"
            customRequest={uploadAllTools}
            showUploadList={false}
            beforeUpload={validateUploadFile}
          >
            <Button 
              type="primary" 
              className="upload-btn"
              icon={<UploadOutlined />}
              loading={operation.open && operation.kind === 'upload' && operation.status === 'active'}
              disabled={operation.open && operation.status === 'active'}
            >
              上传所有工具
            </Button>
          </Upload>
        </div>
      </div>
      
      <Table
        columns={columns}
        dataSource={data}
        bordered
        pagination={true}
        className="api-table"
        rowClassName={() => 'table-row'}
      />
      <Modal
        open={operation.open}
        title={operation.title}
        closable={operation.status !== 'active'}
        maskClosable={operation.status !== 'active'}
        keyboard={operation.status !== 'active'}
        onCancel={() => operation.status !== 'active' && setOperation(initialOperation)}
        footer={operation.status === 'active' ? null : (
          <Button type="primary" onClick={() => setOperation(initialOperation)}>知道了</Button>
        )}
      >
        <p>{operation.description}</p>
        {operation.kind === 'upload' && operation.total > 0 && (
          <Progress
            percent={operation.percent}
            status={operation.status}
            format={() => `${operation.current}/${operation.total}`}
          />
        )}
        {operation.kind === 'clear' && operation.status !== 'active' && (
          <p>清空数量：{operation.current} 个</p>
        )}
      </Modal>
    </div>
  );
};
