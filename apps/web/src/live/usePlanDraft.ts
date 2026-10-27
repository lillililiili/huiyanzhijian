import {useState} from 'react';
import {ApiError, type ApiClient, type Person} from './api';

type Item = Record<string, unknown>;
type Draft = {name: string; items: Item[]; labels: Record<string,string>; pendingKey?: string};
const empty = (): Draft => ({name:'',items:[],labels:{}});
export const planDraftKey = (user: Pick<Person,'id'|'factory_id'>) => `huiyan:plan-draft:v1:${encodeURIComponent(user.factory_id)}:${encodeURIComponent(user.id)}`;

function read(key: string): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (value && typeof value.name === 'string' && Array.isArray(value.items) && value.items.length <= 50 &&
      value.items.every((item: Item) => item && typeof item.spool_id === 'string' && typeof item.device_id === 'string') &&
      (!value.pendingKey || typeof value.pendingKey === 'string')) {
      return {...value, labels:value.labels && typeof value.labels === 'object' ? value.labels : {}};
    }
  } catch { /* Unavailable storage must not crash a business page. */ }
  return empty();
}

export function usePlanDraft(user: Person) {
  const key = planDraftKey(user);
  const [draft,setDraft] = useState(() => user.permissions.includes('task:write') ? read(key) : empty());
  const [storageError,setStorageError] = useState('');
  function update(next: Draft, required = false) {
    try { sessionStorage.setItem(key,JSON.stringify(next)); setStorageError(''); }
    catch {
      const message = '浏览器无法保存草稿，请保持此页打开；保存计划前需允许当前站点使用会话存储。';
      setStorageError(message);
      if (required) throw Error(message);
    }
    setDraft(next);
  }
  async function save(api: ApiClient) {
    if (!draft.name.trim() || !draft.items.length) throw Error('请填写计划名称并添加执行项');
    const pending = {...draft,pendingKey:draft.pendingKey || crypto.randomUUID()};
    // Persist before sending: refreshing after a lost response must reuse this exact request.
    update(pending,true);
    try {
      const result = await api.request<{id:string}>('/plans',{name:pending.name.trim(),items:pending.items},{'Idempotency-Key':pending.pendingKey});
      // Keep the acknowledged request on storage failure; retrying the same key is safe.
      sessionStorage.removeItem(key);
      setDraft(empty());
      return result;
    } catch (error) {
      if (error instanceof ApiError && [400,403,404,422].includes(error.status)) update({...pending,pendingKey:undefined});
      throw error;
    }
  }
  return {draft,update,save,storageError};
}
