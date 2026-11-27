import { Box, Building2, Camera, MapPin } from 'lucide-react';
import {
  formatNumberFa,
  PROPERTY_ASSET_KIND_LABELS_FA,
  PROPERTY_ASSET_STATUS_META,
  PROPERTY_TYPE_LABELS_FA,
  toPersianDigits,
  type OrderPropertySummary,
} from '@homental/shared';

export function PropertySummaryCard({ summary }: { summary?: OrderPropertySummary | null }) {
  if (!summary) return null;

  return (
    <section className="space-y-2 rounded-xl border border-primary-100 bg-primary-50/40 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-extrabold text-primary-950">
          <Building2 size={14} className="text-primary-700" />
          پروفایل مکان و مستندات محل: {summary.title}
        </p>
        <span className="chip bg-white !py-0.5 text-[11px] font-bold text-primary-800">
          {PROPERTY_TYPE_LABELS_FA[summary.propertyType]}
        </span>
      </div>

      <p className="flex items-start gap-1.5 text-slate-600">
        <MapPin size={13} className="mt-0.5 shrink-0 text-primary-600" />
        {summary.address}
      </p>

      {(summary.defaultDimensionsJson?.areaM2 ||
        summary.defaultDimensionsJson?.ceilingHeightCm ||
        summary.notes) ? (
        <div className="space-y-1 rounded-lg bg-white/80 p-2 text-slate-600">
          <div className="flex flex-wrap gap-3 font-bold">
            {summary.defaultDimensionsJson?.areaM2 ? (
              <span className="tabular-fa">
                متراژ: {formatNumberFa(Number(summary.defaultDimensionsJson.areaM2))} مترمربع
              </span>
            ) : null}
            {summary.defaultDimensionsJson?.ceilingHeightCm ? (
              <span className="tabular-fa">
                ارتفاع سقف: {formatNumberFa(Number(summary.defaultDimensionsJson.ceilingHeightCm))}{' '}
                سانتی‌متر
              </span>
            ) : null}
          </div>
          {summary.notes ? <p>یادداشت مشتری: {summary.notes}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-white !py-0.5 text-[11px] font-bold text-slate-700">
          <Camera size={12} />
          {toPersianDigits(summary.mediaCount)} مستندات محل
        </span>
        <span
          className={`chip !py-0.5 text-[11px] font-bold ${
            summary.hasReady3dModel
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          <Box size={12} />
          {summary.hasReady3dModel ? 'مدل سه‌بعدی آماده' : 'بدون مدل سه‌بعدی آماده'}
        </span>
      </div>

      {summary.mediaAssets.length > 0 ? (
        <ul className="space-y-1">
          {summary.mediaAssets.map((asset) => {
            const statusMeta = PROPERTY_ASSET_STATUS_META[asset.status];
            return (
              <li
                key={asset.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px]"
              >
                <span className="font-bold text-slate-700">
                  {PROPERTY_ASSET_KIND_LABELS_FA[asset.kind]}
                </span>
                <span className={`chip !py-0 text-[10px] font-bold ${statusMeta.className}`}>
                  {statusMeta.labelFa}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
