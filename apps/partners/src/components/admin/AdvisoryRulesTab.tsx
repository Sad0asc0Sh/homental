'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Sparkles, X } from 'lucide-react';
import { api, ApiError, type AdminAdvisoryRule, type ServiceKey } from '@homental/api-client';
import { toLatinDigits, toPersianDigits } from '@homental/shared';

const PILLAR_FA: Record<string, { labelFa: string; className: string }> = {
  PHYSICAL: { labelFa: 'موانع فیزیکی', className: 'bg-sky-50 text-sky-700' },
  INTRUSION: { labelFa: 'هشدار نفوذ', className: 'bg-amber-50 text-amber-700' },
  MONITORING: { labelFa: 'دیده‌بانی', className: 'bg-emerald-50 text-emerald-700' },
};

const LOCATION_TYPES = ['APARTMENT', 'VILLA', 'SHOP', 'PARKING', 'WAREHOUSE'] as const;
const SERVICE_KEYS: Array<{ value: '' | ServiceKey; labelFa: string }> = [
  { value: '', labelFa: 'بدون سرویس پیشنهادی' },
  { value: 'ALARM', labelFa: 'دزدگیر اماکن' },
  { value: 'CCTV', labelFa: 'دوربین مداربسته' },
  { value: 'ELECTRIC_SHUTTER', labelFa: 'کرکره برقی' },
  { value: 'PARKING_JACK', labelFa: 'جک پارکینگی' },
];

const DEFAULT_CONDITION_JSON = JSON.stringify(
  {
    and: [
      { '==': [{ var: 'locationType' }, 'SHOP'] },
      { '!=': [{ var: 'services.ALARM.active' }, true] },
    ],
  },
  null,
  2,
);

export function AdvisoryRulesTab() {
  const [rules, setRules] = useState<AdminAdvisoryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { priority: string; suggestedActionFa: string }>>({});
  const [savedId, setSavedId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({
    code: '',
    pillar: 'INTRUSION',
    priority: '20',
    appliesToLocationTypes: ['SHOP'] as string[],
    conditionJson: DEFAULT_CONDITION_JSON,
    suggestedActionFa: '',
    suggestedServiceKey: '' as '' | ServiceKey,
    suggestedConfigJson: '{}',
    scoreImpactJson: '{"intrusion": 25}',
  });

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api.adminAdvisoryRules()
      .then((rows) => {
        setRules(rows);
        const initial: Record<string, { priority: string; suggestedActionFa: string }> = {};
        for (const r of rows) {
          initial[r.id] = { priority: String(r.priority), suggestedActionFa: r.suggestedActionFa };
        }
        setDrafts(initial);
      })
      .catch((err: Error) =>
        setError(err instanceof ApiError ? err.message : 'خطا در دریافت قوانین مشاوره.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleActive = async (rule: AdminAdvisoryRule) => {
    setBusyId(rule.id);
    setError(null);
    try {
      await api.updateAdvisoryRule(rule.id, { isActive: !rule.isActive });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تغییر وضعیت قانون.');
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (ruleId: string) => {
    const draft = drafts[ruleId];
    if (!draft) return;
    setBusyId(ruleId);
    setError(null);
    setSavedId(null);
    try {
      await api.updateAdvisoryRule(ruleId, {
        priority: Number(toLatinDigits(draft.priority)),
        suggestedActionFa: draft.suggestedActionFa.trim(),
      });
      setSavedId(ruleId);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در ذخیره قانون.');
    } finally {
      setBusyId(null);
    }
  };

  const createRule = async () => {
    setModalError(null);
    let condition: Record<string, unknown>;
    let suggestedConfig: Record<string, unknown> | undefined;
    let scoreImpact: Record<string, unknown> | undefined;
    try {
      condition = JSON.parse(newRule.conditionJson) as Record<string, unknown>;
    } catch {
      setModalError('فرمت JSON شرط (condition) نامعتبر است.');
      return;
    }
    try {
      const parsedConfig = JSON.parse(newRule.suggestedConfigJson || '{}') as Record<string, unknown>;
      suggestedConfig = Object.keys(parsedConfig).length > 0 ? parsedConfig : undefined;
    } catch {
      setModalError('فرمت JSON پیکربندی پیشنهادی نامعتبر است.');
      return;
    }
    try {
      scoreImpact = JSON.parse(newRule.scoreImpactJson || '{}') as Record<string, unknown>;
    } catch {
      setModalError('فرمت JSON امتیازدهی (scoreImpact) نامعتبر است.');
      return;
    }

    setBusyId('create');
    try {
      await api.createAdvisoryRule({
        code: newRule.code.trim().toUpperCase(),
        pillar: newRule.pillar,
        priority: Number(toLatinDigits(newRule.priority || '100')),
        appliesToLocationTypes: newRule.appliesToLocationTypes,
        condition,
        suggestedActionFa: newRule.suggestedActionFa.trim(),
        suggestedServiceKey: newRule.suggestedServiceKey || undefined,
        suggestedConfig,
        scoreImpact,
      });
      setShowAdd(false);
      setNewRule({
        code: '',
        pillar: 'INTRUSION',
        priority: '20',
        appliesToLocationTypes: ['SHOP'],
        conditionJson: DEFAULT_CONDITION_JSON,
        suggestedActionFa: '',
        suggestedServiceKey: '',
        suggestedConfigJson: '{}',
        scoreImpactJson: '{"intrusion": 25}',
      });
      reload();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : 'خطا در ثبت قانون جدید.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && rules.length === 0) {
    return (
      <div className="card flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Sparkles size={14} className="text-primary-600" />
          قوانین JSON-Logic برای کشف خودکار شکاف‌های امنیتی ({toPersianDigits(rules.length)} قانون)
        </p>
        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setShowAdd(true);
          }}
          className="btn-primary !px-3 !py-1.5 text-xs"
        >
          <Plus size={14} />
          افزودن قانون جدید
        </button>
      </div>

      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}

      <div className="space-y-3">
        {rules.map((rule) => {
          const pillarMeta = PILLAR_FA[rule.pillar] ?? {
            labelFa: rule.pillar,
            className: 'bg-slate-100 text-slate-600',
          };
          const draft = drafts[rule.id] ?? {
            priority: String(rule.priority),
            suggestedActionFa: rule.suggestedActionFa,
          };
          const dirty =
            draft.priority !== String(rule.priority) ||
            draft.suggestedActionFa !== rule.suggestedActionFa;

          return (
            <section key={rule.id} className="card space-y-3">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-xs font-extrabold text-primary-950">
                    {rule.code}
                  </span>
                  <span className={`chip !px-2.5 !py-0.5 text-[11px] font-bold ${pillarMeta.className}`}>
                    {pillarMeta.labelFa}
                  </span>
                  {rule.suggestedServiceKey ? (
                    <span className="chip bg-slate-100 !px-2 !py-0.5 text-[10px] font-bold text-slate-600">
                      پیشنهاد: {rule.suggestedServiceKey}
                    </span>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={busyId === rule.id}
                  onClick={() => void toggleActive(rule)}
                  className={`chip text-xs font-bold ${
                    rule.isActive
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border border-slate-200 bg-slate-100 text-slate-500'
                  }`}
                >
                  {rule.isActive ? 'فعال' : 'غیرفعال'}
                </button>
              </header>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">اولویت</label>
                  <input
                    dir="ltr"
                    value={draft.priority}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [rule.id]: { ...draft, priority: e.target.value },
                      }))
                    }
                    className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold focus:border-primary-400 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-[11px] font-bold text-slate-500">
                    متن پیشنهاد فارسی برای مشتری
                  </label>
                  <textarea
                    rows={2}
                    value={draft.suggestedActionFa}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [rule.id]: { ...draft, suggestedActionFa: e.target.value },
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs leading-5 focus:border-primary-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer font-bold text-slate-600">
                    شرط JSON-Logic ({rule.appliesToLocationTypes.join(', ') || 'همه مکان‌ها'})
                  </summary>
                  <pre
                    dir="ltr"
                    className="mt-2 max-w-full overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] text-emerald-300"
                  >
                    {JSON.stringify(rule.condition, null, 2)}
                  </pre>
                </details>

                <div className="flex items-center gap-2">
                  {savedId === rule.id ? (
                    <span className="text-[11px] font-bold text-emerald-600">ذخیره شد</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={busyId === rule.id || !dirty}
                    onClick={() => void saveEdit(rule.id)}
                    className="btn-primary !px-3 !py-1.5 text-xs"
                  >
                    {busyId === rule.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <>
                        <Save size={13} />
                        ذخیره
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Add Rule Modal */}
      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => busyId !== 'create' && setShowAdd(false)}
        >
          <div
            className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">افزودن قانون جدید JSON-Logic</h3>
              <button type="button" onClick={() => setShowAdd(false)} aria-label="بستن">
                <X size={16} className="text-slate-400" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                dir="ltr"
                value={newRule.code}
                onChange={(e) => setNewRule({ ...newRule, code: e.target.value })}
                placeholder="CODE_UPPERCASE"
                className="col-span-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
              />
              <input
                dir="ltr"
                value={newRule.priority}
                onChange={(e) => setNewRule({ ...newRule, priority: e.target.value })}
                placeholder="اولویت"
                className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={newRule.pillar}
                onChange={(e) => setNewRule({ ...newRule, pillar: e.target.value })}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
              >
                <option value="PHYSICAL">موانع فیزیکی (PHYSICAL)</option>
                <option value="INTRUSION">هشدار نفوذ (INTRUSION)</option>
                <option value="MONITORING">دیده‌بانی (MONITORING)</option>
              </select>
              <select
                value={newRule.suggestedServiceKey}
                onChange={(e) =>
                  setNewRule({ ...newRule, suggestedServiceKey: e.target.value as '' | ServiceKey })
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
              >
                {SERVICE_KEYS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.labelFa}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {LOCATION_TYPES.map((loc) => {
                const active = newRule.appliesToLocationTypes.includes(loc);
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() =>
                      setNewRule((prev) => ({
                        ...prev,
                        appliesToLocationTypes: active
                          ? prev.appliesToLocationTypes.filter((x) => x !== loc)
                          : [...prev.appliesToLocationTypes, loc],
                      }))
                    }
                    className={`chip text-[11px] ${
                      active
                        ? 'border border-primary-400 bg-primary-50 font-bold text-primary-800'
                        : 'border border-slate-200 text-slate-500'
                    }`}
                  >
                    {loc}
                  </button>
                );
              })}
            </div>

            <textarea
              rows={2}
              value={newRule.suggestedActionFa}
              onChange={(e) => setNewRule({ ...newRule, suggestedActionFa: e.target.value })}
              placeholder="متن پیشنهاد فارسی (حداقل ۵ کاراکتر)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />

            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">
                شرط JSON-Logic (condition)
              </label>
              <textarea
                dir="ltr"
                rows={4}
                value={newRule.conditionJson}
                onChange={(e) => setNewRule({ ...newRule, conditionJson: e.target.value })}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-left text-[11px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  پیکربندی پیشنهادی (JSON)
                </label>
                <input
                  dir="ltr"
                  value={newRule.suggestedConfigJson}
                  onChange={(e) => setNewRule({ ...newRule, suggestedConfigJson: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-left text-[11px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  تأثیر امتیاز (scoreImpact JSON)
                </label>
                <input
                  dir="ltr"
                  value={newRule.scoreImpactJson}
                  onChange={(e) => setNewRule({ ...newRule, scoreImpactJson: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-left text-[11px]"
                />
              </div>
            </div>

            {modalError ? (
              <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">{modalError}</p>
            ) : null}

            <button
              type="button"
              disabled={busyId === 'create' || !newRule.code || newRule.suggestedActionFa.trim().length < 5}
              onClick={() => void createRule()}
              className="btn-primary w-full"
            >
              {busyId === 'create' ? <Loader2 size={15} className="animate-spin" /> : 'ثبت قانون جدید'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
