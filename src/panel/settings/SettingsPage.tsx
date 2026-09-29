/**
 * 设置页壳：模型配置表单（baseUrl / apiKey / model / temperature / maxTokens），
 * 本期不持久化、提交按钮禁用；Obsidian 配置区占位。
 */
import { useState } from 'react';
import { OBSIDIAN } from '../../config';

interface ModelFormState {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperatureOutline: string;
  temperatureQa: string;
  maxTokens: string;
}

const INITIAL_MODEL_FORM: ModelFormState = {
  baseUrl: '',
  apiKey: '',
  model: '',
  temperatureOutline: '0.2',
  temperatureQa: '0.4',
  maxTokens: '4096',
};

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<ModelFormState>(INITIAL_MODEL_FORM);

  const update = (field: keyof ModelFormState) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  return (
    <div className="settings">
      <header className="settings-header">
        <h3>设置</h3>
        <button type="button" className="btn" onClick={onClose}>
          返回
        </button>
      </header>

      <section className="settings-section">
        <h4>模型配置</h4>
        <label className="field">
          <span>接口地址</span>
          <input
            type="text"
            placeholder="https://…"
            value={form.baseUrl}
            onChange={update('baseUrl')}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            placeholder="sk-…"
            value={form.apiKey}
            onChange={update('apiKey')}
          />
        </label>
        <label className="field">
          <span>模型</span>
          <input
            type="text"
            placeholder="模型标识"
            value={form.model}
            onChange={update('model')}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>temperature（大纲）</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperatureOutline}
              onChange={update('temperatureOutline')}
            />
          </label>
          <label className="field">
            <span>temperature（问答）</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperatureQa}
              onChange={update('temperatureQa')}
            />
          </label>
        </div>
        <label className="field">
          <span>maxTokens</span>
          <input
            type="number"
            min="1"
            value={form.maxTokens}
            onChange={update('maxTokens')}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled>
          保存（待后续 SPEC 接入持久化）
        </button>
      </section>

      <section className="settings-section">
        <h4>Obsidian 配置</h4>
        <p className="settings-hint">待 SPEC-06 实现：Local REST API 地址 / 密钥 / 笔记根目录</p>
        <label className="field">
          <span>接口地址</span>
          <input type="text" defaultValue={OBSIDIAN.baseUrl} disabled />
        </label>
        <label className="field">
          <span>API Key</span>
          <input type="password" placeholder="待配置" disabled />
        </label>
        <label className="field">
          <span>笔记根目录</span>
          <input type="text" placeholder="待配置" disabled />
        </label>
      </section>
    </div>
  );
}
