import { METRICS } from "../domain/metrics";
import type { InspectionRecord } from "../domain/types";
import { Empty } from "./Empty";
import { date, fmt } from "./format";

export function InspectionFigure({ record }: { record: InspectionRecord | null | undefined }) {
  if (!record) return <Empty text="暂无关联图像" />;
  const metric = METRICS[record.metric];
  const caption = record.metric === "by"
    ? "仅表示 X / Y 双向测量；不表示全周重建，计算口径待确认。"
    : record.metric === "dg"
      ? "边界线用于解释量测位置；搭盖宽度、节距与搭盖率独立记录。"
      : "标注为当前记录的局部间隙示例；判定采用该记录平均间隙。";
  return (
    <>
      <div className="inspection">
        <img src={record.image || metric.image} alt={`${metric.name}演示图像`} />
        {record.metric === "dg" ? (
          <>
            <div className="measure-seam" />
            <div className="measure-dimension">搭盖宽度 {fmt(record.aux?.overlapWidth)} mm</div>
            <div className="pitch-dimension">节距 {fmt(record.aux?.pitch)} mm</div>
            <span className="image-value">搭盖率 {fmt(record.value)} %</span>
          </>
        ) : null}
        {record.metric === "jx" ? (
          <div className="wire-measures">
            {(record.aux?.localGaps ?? []).map((gap, index) => (
              <span key={index}>{fmt(gap)} mm</span>
            ))}
          </div>
        ) : null}
        {record.metric === "by" ? (
          <>
            <div className="dimension-x">X 方向 {fmt(record.aux?.xDiameter)} mm</div>
            <div className="dimension-y">Y {fmt(record.aux?.yDiameter)} mm</div>
          </>
        ) : null}
        <span className="image-caption">AI 生成演示图 · 非现场实测</span>
      </div>
      <div className="inspection-meta">
        <span>{record.id} · {date(record.time).slice(-8)}</span>
        <span>{fmt(record.meter, 1)} m</span>
      </div>
      <p className="small muted">{caption}</p>
    </>
  );
}
