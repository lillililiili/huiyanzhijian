import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TemplatesConfigPage } from '../live/TemplatesConfigPage';
import { ApiClient, Commands, emptyWorkspace, type Person } from '../live/api';

let root: Root, container: HTMLDivElement;

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(node));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

const makeProps = (permissions = ['data:read', 'quality:write']) => {
  const api = new ApiClient();
  const user: Person = {
    id: 'user-01',
    username: 'quality_admin',
    name: '质量工程师',
    factory_id: 'factory-01',
    permissions
  };
  return {
    api,
    commands: new Commands(api),
    user,
    data: structuredClone(emptyWorkspace),
    refresh: vi.fn(async () => {})
  };
};

test('renders default single-metric template preview, header and controlled V1.0 tag', async () => {
  const props = makeProps();
  await render(<TemplatesConfigPage {...props} />);

  expect(container.textContent).toContain('报告模板配置');
  expect(container.textContent).toContain('高压电缆单项质量检测报告');
  expect(container.textContent).toContain('山东宏亮电缆有限公司');
  expect(container.textContent).toContain('V1.0');
  expect(container.textContent).toContain('受控必备要素');
  expect(container.textContent).toContain('符合标准要求');
  expect(container.textContent).toContain('检验员：____________');
});

test('tab switching alters active template category and preview content', async () => {
  const props = makeProps();
  await render(<TemplatesConfigPage {...props} />);

  const tabs = container.querySelectorAll<HTMLButtonElement>('.tpl-tab-btn');
  expect(tabs.length).toBe(3);

  // 切换到整盘综合质量检测报告模板
  await act(async () => tabs[1].click());
  expect(container.textContent).toContain('高压电缆整盘多工序综合质量检测报告');
  expect(container.textContent).toContain('涵盖金属屏蔽搭盖率、铜丝间隙、电缆不圆度等多项工序');

  // 切换到工单批次质量汇总报表模板
  await act(async () => tabs[2].click());
  expect(container.textContent).toContain('高压电缆生产工单批次质量汇总报告');
  expect(container.textContent).toContain('按生产工单与计划批次汇总所辖多盘电缆');
});

test('readonly user has disabled edit/reset controls and sees permission note', async () => {
  const props = makeProps(['data:read']); // 仅具备只读权限，无写权限
  await render(<TemplatesConfigPage {...props} />);

  expect(container.textContent).toContain('当前账号仅具备只读权限');

  const editBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('编辑报告模板'));
  expect(editBtn).toBeDefined();
  expect(editBtn?.disabled).toBe(true);

  const resetBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('恢复出厂'));
  expect(resetBtn).toBeUndefined(); // 只读用户不显示恢复按钮
});

test('editing template advances controlled revision to V1.1 and records reason in history', async () => {
  const props = makeProps();
  await render(<TemplatesConfigPage {...props} />);

  const editBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('编辑报告模板'))!;
  await act(async () => editBtn.click());

  // 检查编辑弹窗打开
  expect(document.body.textContent).toContain('编辑报告模板 · 高压电缆单项指标检测报告模板 (V1.0)');

  const titleInput = document.querySelector<HTMLInputElement>('input[name="title"]')!;
  const reasonInput = document.querySelector<HTMLInputElement>('input[name="reason"]')!;

  await act(async () => {
    titleInput.value = '新版电缆出厂检测合格报告';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput.dispatchEvent(new Event('change', { bubbles: true }));

    reasonInput.value = '质检体系认证年审抬头修订';
    reasonInput.dispatchEvent(new Event('input', { bubbles: true }));
    reasonInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const submitBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '保存并发布新版本')!;
  await act(async () => submitBtn.click());

  // 校验新版本升级为 V1.1 并展示新标题
  expect(container.textContent).toContain('V1.1');
  expect(container.textContent).toContain('新版电缆出厂检测合格报告');
  expect(container.textContent).toContain('质检体系认证年审抬头修订');

  // 打开版本履历查看
  const historyBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('版本履历'))!;
  await act(async () => historyBtn.click());

  expect(document.body.textContent).toContain('受控模板版本履历');
  expect(document.body.textContent).toContain('质检体系认证年审抬头修订');
  expect(document.body.textContent).toContain('质量工程师');
});

test('resetting to factory defaults creates a compliant incremented revision', async () => {
  const props = makeProps();
  await render(<TemplatesConfigPage {...props} />);

  const resetBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '恢复出厂')!;
  await act(async () => resetBtn.click());

  expect(document.body.textContent).toContain('恢复出厂预设模板');

  const confirmBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '确认恢复出厂')!;
  await act(async () => confirmBtn.click());

  expect(container.textContent).toContain('V1.1');
  expect(container.textContent).toContain('高压电缆单项质量检测报告');
  expect(container.textContent).toContain('恢复系统出厂预设模板');
});
