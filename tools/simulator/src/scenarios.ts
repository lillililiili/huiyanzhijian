// Independent golden input values; never import platform rule/evaluation code.
import { buildOpmac170A2DObservation } from './device-model';

export const SCENARIO_PERFECT = 'SCENARIO_PERFECT';
export const SCENARIO_OVERLAP_DEFECT = 'SCENARIO_OVERLAP_DEFECT';
export const SCENARIO_GAP_GLITCH = 'SCENARIO_GAP_GLITCH';
export const SCENARIO_OVALITY_OUT_OF_BOUNDS = 'SCENARIO_OVALITY_OUT_OF_BOUNDS';
export const SCENARIO_SENSOR_BLOCKED = 'SCENARIO_SENSOR_BLOCKED';

export interface IndustrialScenarioPreset {
  id: string;
  name: string;
  description: string;
  data_status: 'VALID' | 'MISSING' | 'INVALID';
  reason_code?: string;
  values: {
    SHIELD_OVERLAP_RATE: string | null;
    WIRE_GAP: string | null;
    OVALITY: string | null;
  };
}

export const INDUSTRIAL_SCENARIOS: Record<string, IndustrialScenarioPreset> = {
  [SCENARIO_PERFECT]: {
    id: SCENARIO_PERFECT,
    name: '黄金合格盘',
    description: '三项指标均处于黄金合格中段（搭盖率 15%, 间隙 1.5mm, 不圆度 3%）',
    data_status: 'VALID',
    values: {
      SHIELD_OVERLAP_RATE: '15.0000000000',
      WIRE_GAP: '1.5000000000',
      OVALITY: '3.0000000000',
    },
  },
  [SCENARIO_OVERLAP_DEFECT]: {
    id: SCENARIO_OVERLAP_DEFECT,
    name: '金属屏蔽搭盖开缝缺陷',
    description: '铜带屏蔽层开缝漏包，搭盖率严重不足，掉至 6%~8%（参考限值≥10%）',
    data_status: 'VALID',
    values: {
      SHIELD_OVERLAP_RATE: '7.2000000000',
      WIRE_GAP: '1.5000000000',
      OVALITY: '3.0000000000',
    },
  },
  [SCENARIO_GAP_GLITCH]: {
    id: SCENARIO_GAP_GLITCH,
    name: '铜丝间隙毛刺超标',
    description: '铜丝局部翘起散丝，相邻间隙出现 3.5mm~4.2mm 异常（参考限值≤3.0mm）',
    data_status: 'VALID',
    values: {
      SHIELD_OVERLAP_RATE: '15.0000000000',
      WIRE_GAP: '3.8500000000',
      OVALITY: '3.0000000000',
    },
  },
  [SCENARIO_OVALITY_OUT_OF_BOUNDS]: {
    id: SCENARIO_OVALITY_OUT_OF_BOUNDS,
    name: '绝缘挤出失圆',
    description: '绝缘或护套挤出严重失圆，百分比不圆度达到 10%~12%（参考限值≤8.0%）',
    data_status: 'VALID',
    values: {
      SHIELD_OVERLAP_RATE: '15.0000000000',
      WIRE_GAP: '1.5000000000',
      OVALITY: '11.5000000000',
    },
  },
  [SCENARIO_SENSOR_BLOCKED]: {
    id: SCENARIO_SENSOR_BLOCKED,
    name: '光电遮挡空料',
    description: '现场探头光路被遮挡或无物体空料，数值为 null，标记 MISSING 状态',
    data_status: 'MISSING',
    reason_code: 'OPTICAL_SENSOR_BLOCKED',
    values: {
      SHIELD_OVERLAP_RATE: null,
      WIRE_GAP: null,
      OVALITY: null,
    },
  },
};

const scenarioAliases: Record<string, string> = {
  perfect: SCENARIO_PERFECT,
  overlap_defect: SCENARIO_OVERLAP_DEFECT,
  gap_glitch: SCENARIO_GAP_GLITCH,
  ovality_out_of_bounds: SCENARIO_OVALITY_OUT_OF_BOUNDS,
  sensor_blocked: SCENARIO_SENSOR_BLOCKED,
};

const fixtures: Record<string, { unit: string; normal: string; boundary: string; over: string; method: string; raw: string }> = {
  SHIELD_OVERLAP_RATE: { unit: '%', normal: '12.5000000001', boundary: '10', over: '9.9999999999', method: 'test-dg', raw: 'overlap-sim.v1' },
  WIRE_GAP: { unit: 'mm', normal: '1.25', boundary: '3', over: '3.0000000001', method: 'test-jx', raw: 'wire-gap-sim.v1' },
  OVALITY: { unit: '%', normal: '5.5', boundary: '8', over: '8.0000000001', method: 'test-by', raw: 'diameter-aux-sim.v1' },
};

function buildOvalityObservation(value: string | null, dataStatus: 'VALID' | 'MISSING' | 'INVALID') {
  if (dataStatus !== 'VALID' || value === null) {
    const obs = buildOpmac170A2DObservation({
      diameterXMm: 0,
      diameterYMm: 0,
      dataStatus: dataStatus === 'VALID' ? 'INVALID' : dataStatus,
      referenceDiameterMm: 40.0,
    });
    return {
      protocol: 'MODBUS_RTU',
      instrument_model: 'Opmac-170AL2-2D',
      slave_address: 1,
      register_base: '0x0200 (40513-40518) / 0x0041 (40066-40070)',
      status_word: (obs.registers as any)['0x0200_status_word'],
      axis_count: 2,
      observation: obs,
    };
  }

  const p = Number(value);
  const delta = p * 0.4;
  const x = 40.0 + delta / 2;
  const y = 40.0 - delta / 2;
  const obs = buildOpmac170A2DObservation({
    diameterXMm: x,
    diameterYMm: y,
    dataStatus: 'VALID',
    posX: 8,
    posY: -14,
    referenceDiameterMm: 40.0,
    abnormal: p > 8.0,
  });

  return {
    protocol: 'MODBUS_RTU',
    instrument_model: 'Opmac-170AL2-2D',
    slave_address: 1,
    register_base: '0x0200 (40513-40518) / 0x0041 (40066-40070)',
    status_word: '0x0002',
    axis_count: 2,
    observation: obs,
  };
}

export function record(run: any, sequence: number, sampleTime?: string) {
  const a = JSON.parse(run.assignment);
  const f = fixtures[a.metric_code];
  if (!f) throw Error('Unsupported metric');

  const normalizedScenario = scenarioAliases[run.scenario] || run.scenario;
  const industrialPreset = INDUSTRIAL_SCENARIOS[normalizedScenario];

  const position = (BigInt(sequence) / 10n).toString() + '.' + (BigInt(sequence) % 10n).toString();
  const time = sampleTime || new Date().toISOString();

  if (industrialPreset) {
    const isMissing = industrialPreset.data_status === 'MISSING';
    const value = industrialPreset.values[a.metric_code as keyof typeof industrialPreset.values];

    return {
      record_id: run.id + '-' + sequence,
      device_id: run.device_id,
      capture_session_id: run.capture_session,
      capture_sequence: String(sequence),
      source_record_id: null,
      source_session_id: null,
      source_sequence: null,
      sample_kind: 'NEW_SAMPLE',
      task_id: a.task_id || null,
      binding_id: a.binding_id || null,
      binding_version: a.binding_version !== undefined && a.binding_version !== null ? String(a.binding_version) : null,
      sample_time: time,
      time_source: 'SIMULATOR',
      position_m: isMissing ? null : position,
      position_quality: isMissing ? 'UNKNOWN' : 'KNOWN',
      position_segment_id: isMissing ? null : run.id + '-segment',
      source_type: 'DEVICE',
      data_environment: 'SIMULATED',
      data_status: isMissing ? 'MISSING' : 'VALID',
      recipe_version_id: a.recipe_version_id || null,
      values: [
        {
          metric_code: a.metric_code,
          value,
          unit: f.unit,
          data_status: isMissing ? 'MISSING' : 'VALID',
          source_quality_result: 'NOT_EVALUATED',
          method_id: f.method,
          window: { kind: 'INSTANT', definition_id: null, start: null, end: null, position_from_m: null, position_to_m: null },
          reason_code: isMissing ? (industrialPreset.reason_code || 'SIMULATED_MISSING') : null,
        },
      ],
      raw: {
        schema_version: f.raw,
        data: {
          scenario: run.scenario,
          preset_id: industrialPreset.id,
          preset_name: industrialPreset.name,
          seed: String(run.seed),
          fixture_version: 'b1-v1',
          provided_scalar: value,
          notice: 'SIMULATED; no physical instrument or length-accuracy claim',
          ...(a.metric_code === 'OVALITY' ? buildOvalityObservation(value, isMissing ? 'MISSING' : 'VALID') : {}),
        },
      },
      evidence_refs: [],
    };
  }

  // 原有经典场景逻辑（mixed, normal, boundary, over, invalid）
  const scenario = run.scenario === 'mixed' ? ['normal', 'boundary', 'over', 'invalid'][(sequence - 1 + run.seed) % 4] : run.scenario;
  const invalid = scenario === 'invalid';
  const value = invalid ? null : scenario === 'boundary' ? f.boundary : scenario === 'over' ? f.over : f.normal;

  return {
    record_id: run.id + '-' + sequence,
    device_id: run.device_id,
    capture_session_id: run.capture_session,
    capture_sequence: String(sequence),
    source_record_id: null,
    source_session_id: null,
    source_sequence: null,
    sample_kind: 'NEW_SAMPLE',
    task_id: a.task_id || null,
    binding_id: a.binding_id || null,
    binding_version: a.binding_version !== undefined && a.binding_version !== null ? String(a.binding_version) : null,
    sample_time: time,
    time_source: 'SIMULATOR',
    position_m: invalid ? null : position,
    position_quality: invalid ? 'UNKNOWN' : 'KNOWN',
    position_segment_id: invalid ? null : run.id + '-segment',
    source_type: 'DEVICE',
    data_environment: 'SIMULATED',
    data_status: invalid ? 'INVALID' : 'VALID',
    recipe_version_id: a.recipe_version_id || null,
    values: [
      {
        metric_code: a.metric_code,
        value,
        unit: f.unit,
        data_status: invalid ? 'INVALID' : 'VALID',
        source_quality_result: 'NOT_EVALUATED',
        method_id: f.method,
        window: { kind: 'INSTANT', definition_id: null, start: null, end: null, position_from_m: null, position_to_m: null },
        reason_code: invalid ? 'SIMULATED_INVALID' : null,
      },
    ],
    raw: {
      schema_version: f.raw,
      data: {
        scenario,
        seed: String(run.seed),
        fixture_version: 'b1-v1',
        provided_scalar: value,
        notice: 'SIMULATED; no physical instrument or length-accuracy claim',
        ...(a.metric_code === 'OVALITY' ? buildOvalityObservation(value, invalid ? 'INVALID' : 'VALID') : {}),
      },
    },
    evidence_refs: [],
  };
}
