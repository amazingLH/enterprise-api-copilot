import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NodeDetails from './NodeDetails';
import { TaskNodeResultApi } from '../../api/agent';

jest.mock('../../api/agent', () => ({ TaskNodeResultApi: jest.fn() }));

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

afterEach(() => jest.clearAllMocks());

test('node detail shows full records with paging and downloads the complete response', async () => {
  const records = Array.from({ length: 12 }, (_, index) => ({ id: `order-${index + 1}`, supplierId: 2356 }));
  const raw = JSON.stringify(records);
  TaskNodeResultApi.mockResolvedValue({ data: {
    complete: true, query: '查询供应商2356配送的订单', tool: '订单查询',
    params: { supplierId: 2356 }, result: raw, record_count: 12, response_length: raw.length,
  } });
  URL.createObjectURL = jest.fn().mockReturnValue('blob:download');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<NodeDetails node={{ id: '1', result_id: 'saved', result_task_id: 'task-test' }} onClose={() => {}} />);
  expect(await screen.findByText('查询供应商2356配送的订单')).toBeInTheDocument();
  expect(screen.getByText('order-1')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('2'));
  expect(await screen.findByText('order-12')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /下载完整结果 JSON/ }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  const blob = URL.createObjectURL.mock.calls[0][0];
  expect(blob.size).toBe(new Blob([raw]).size);
  const downloadedText = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  expect(downloadedText).toBe(raw);
  expect(click).toHaveBeenCalledTimes(1);
  click.mockRestore();
});

test('historical preview is visible and cannot be downloaded as a complete result', () => {
  render(<NodeDetails node={{ id: '0', task_description: '历史查询', result: JSON.stringify('已截取的结果'), params: '{}' }} onClose={() => {}} />);
  expect(screen.getByText('历史查询')).toBeInTheDocument();
  expect(screen.getByText('已截取的结果')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /下载完整结果 JSON/ })).toBeDisabled();
  expect(TaskNodeResultApi).not.toHaveBeenCalled();
});
