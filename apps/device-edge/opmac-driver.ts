/**
 * 共久/Opmac 双轴测径仪 Modbus RTU 原始报文解析与双口径（% / mm）换算器
 * 遵循 SPEC_测径仪信号与算法换算规范.md
 */

import { calculateModbusCRC16, verifyModbusCRC16 } from '../../adapters/inspur/inspur-driver';

export interface EdgeMetadata {
  deviceId: string;
  captureSessionId: string;
  dataEnvironment: 'REAL' | 'SIMULATED';
  pulseCoefficient?: number; // 脉冲到米换算系数，默认 0.0005 m/pulse
  recipeVersionId?: string | null;
  taskId?: string | null;
  bindingId?: string | null;
  bindingVersion?: string | null;
  positionSegmentId?: string | null;
  rawSchemaVersion?: string;
}

export interface IngestionMeasurementValue {
  metric_code: 'OVALITY';
  value: string | null;
  unit: string;
  data_status: 'VALID' | 'INVALID' | 'MISSING';
  source_quality_result: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  method_id?: string | null;
  window: {
    kind: 'INSTANT' | 'TIME' | 'POSITION' | 'DEVICE_DEFINED';
    definition_id: string | null;
    start: string | null;
    end: string | null;
    position_from_m: string | null;
    position_to_m: string | null;
  };
  reason_code?: string | null;
}

export interface EdgeIngestionPayload {
  record_id: string;
  device_id: string;
  capture_session_id: string;
  capture_sequence: string;
  source_record_id: string | null;
  source_session_id: string | null;
  source_sequence: string | null;
  sample_kind: 'NEW_SAMPLE' | 'READ_SNAPSHOT';
  task_id: string | null;
  binding_id: string | null;
  binding_version: string | null;
  sample_time: string;
  time_source: 'DEVICE' | 'ADAPTER' | 'SIMULATOR';
  position_m: string | null;
  position_quality: 'KNOWN' | 'UNKNOWN' | 'INVALID';
  position_segment_id: string | null;
  source_type: 'DEVICE' | 'DERIVED';
  data_environment: 'REAL' | 'SIMULATED';
  data_status: 'VALID' | 'INVALID' | 'MISSING';
  recipe_version_id: string | null;
  values: IngestionMeasurementValue[];
  raw: {
    schema_version: string;
    data: Record<string, unknown>;
  };
  evidence_refs: string[];
  raw_payload?: Record<string, unknown>;
}

/**
 * 脉冲编码器计米换算（默认系数 0.0005 m/pulse，即每转 1000 脉冲对应 0.500 米线轮）
 */
export function calculatePositionFromPulses(pulseCount: number, coefficient: number = 0.0005): string {
  if (pulseCount < 0) {
    return '0.0000';
  }
  return (pulseCount * coefficient).toFixed(4);
}

/**
 * 构建 Opmac 测径仪 Modbus RTU 响应报文
 */
export function buildOpmacRTUResponse(slaveId: number, regs: number[]): Buffer {
  const byteCount = regs.length * 2;
  const buf = Buffer.alloc(3 + byteCount + 2);
  buf.writeUInt8(slaveId, 0);
  buf.writeUInt8(0x03, 1);
  buf.writeUInt8(byteCount, 2);
  for (let i = 0; i < regs.length; i++) {
    buf.writeUInt16BE(regs[i] & 0xffff, 3 + i * 2);
  }
  const crc = calculateModbusCRC16(buf.subarray(0, 3 + byteCount));
  buf.writeUInt8(crc & 0xff, 3 + byteCount);
  buf.writeUInt8((crc >> 8) & 0xff, 3 + byteCount + 1);
  return buf;
}

/**
 * 转换解析后的测径仪数据为平台标准接入 Payload
 */
export function toPlatformPayload(
  parsed: {
    isValid: boolean;
    dxMm: number;
    dyMm: number;
    avgMm: number;
    diffMm: number;
    statusWord: number;
    pos1: number;
    pos2: number;
    pulseCount: number;
    coeff: number;
  },
  meta: EdgeMetadata,
  seq: number,
  sampleTime: string = new Date().toISOString()
): EdgeIngestionPayload {
  const { isValid, dxMm, dyMm, avgMm, diffMm, statusWord, pos1, pos2, pulseCount, coeff } = parsed;
  const posM = calculatePositionFromPulses(pulseCount, coeff);

  let ovalityPct: string | null = null;
  let qualityResult: 'PASS' | 'FAIL' | 'NOT_EVALUATED' = 'NOT_EVALUATED';
  const majorAxis = isValid ? Math.max(dxMm, dyMm) : 0;
  const minorAxis = isValid ? Math.min(dxMm, dyMm) : 0;
  const axisRatio = isValid && minorAxis > 0 ? majorAxis / minorAxis : (isValid ? 1 : 0);

  if (isValid) {
    // 统一百分比公式：200 * |X - Y| / (X + Y)
    const pct = (200 * Math.abs(dxMm - dyMm)) / (dxMm + dyMm);
    ovalityPct = pct.toFixed(6);

    // 参考限值 <= 8.0%
    qualityResult = pct <= 8.0 ? 'PASS' : 'FAIL';
  }

  const segmentId = isValid ? (meta.positionSegmentId || 'SEG-01') : null;

  const observation = {
    diameter_x_mm: isValid ? dxMm.toFixed(6) : '0',
    diameter_y_mm: isValid ? dyMm.toFixed(6) : '0',
    major_axis_mm: isValid ? majorAxis.toFixed(6) : '0',
    minor_axis_mm: isValid ? minorAxis.toFixed(6) : '0',
    average_diameter_mm: isValid ? avgMm.toFixed(6) : '0',
    ovality_difference_mm: isValid ? diffMm.toFixed(6) : '0',
    axis_ratio_f: isValid ? axisRatio.toFixed(6) : '0',
    axis_pairs: [
      {
        group_no: 1,
        axis_code: 'X',
        angle_a_deg: 0,
        angle_b_deg: 180,
        angle_label: '0°—180°',
        diameter_mm: isValid ? dxMm.toFixed(6) : '0',
        position_offset: isValid ? pos1 : 0,
      },
      {
        group_no: 2,
        axis_code: 'Y',
        angle_a_deg: 90,
        angle_b_deg: 270,
        angle_label: '90°—270°',
        diameter_mm: isValid ? dyMm.toFixed(6) : '0',
        position_offset: isValid ? pos2 : 0,
      },
    ],
    registers: {
      '0x0200_status_word': '0x' + (statusWord & 0xffff).toString(16).padStart(4, '0'),
      '0x0201_avg_diameter_001mm': isValid ? Math.round(avgMm * 100) : 0,
      '0x0202_axis1_diameter_001mm': isValid ? Math.round(dxMm * 100) : 0,
      '0x0203_axis1_position': isValid ? pos1 : 0,
      '0x0204_axis2_diameter_001mm': isValid ? Math.round(dyMm * 100) : 0,
      '0x0205_axis2_position': isValid ? pos2 : 0,
    },
  };

  const rawData: Record<string, unknown> = {
    protocol: 'MODBUS_RTU',
    instrument_model: 'Opmac-170A-2D',
    slave_address: 1,
    register_base: '0x0200 (40513-40518)',
    status_word: '0x' + (statusWord & 0xffff).toString(16).padStart(4, '0'),
    axis_count: 2,
    observation,
    diameter_avg_mm: Number(avgMm.toFixed(2)),
    diameter_x_mm: Number(dxMm.toFixed(2)),
    diameter_y_mm: Number(dyMm.toFixed(2)),
    diff_abs_mm: Number(diffMm.toFixed(2)),
    pulse_count: pulseCount,
    pulse_coefficient: coeff,
  };

  const payload: EdgeIngestionPayload = {
    record_id: `${meta.deviceId}-${meta.captureSessionId}-${seq}`,
    device_id: meta.deviceId,
    capture_session_id: meta.captureSessionId,
    capture_sequence: String(seq),
    source_record_id: null,
    source_session_id: null,
    source_sequence: null,
    sample_kind: 'NEW_SAMPLE',
    task_id: meta.taskId || null,
    binding_id: meta.bindingId || null,
    binding_version: meta.bindingVersion || null,
    sample_time: sampleTime,
    time_source: 'DEVICE',
    position_m: isValid ? posM : null,
    position_quality: isValid ? 'KNOWN' : 'UNKNOWN',
    position_segment_id: segmentId,
    source_type: 'DEVICE',
    data_environment: meta.dataEnvironment,
    data_status: isValid ? 'VALID' : 'MISSING',
    recipe_version_id: meta.recipeVersionId || null,
    values: [
      {
        metric_code: 'OVALITY',
        value: ovalityPct,
        unit: '%',
        data_status: isValid ? 'VALID' : 'MISSING',
        source_quality_result: qualityResult,
        method_id: 'BY-V1.0',
        window: {
          kind: 'INSTANT',
          definition_id: null,
          start: null,
          end: null,
          position_from_m: null,
          position_to_m: null,
        },
        reason_code: isValid ? null : 'BEAM_BLOCKED_OR_NO_CABLE',
      },
    ],
    raw: {
      schema_version: meta.rawSchemaVersion || 'diameter-aux-sim.v1',
      data: rawData,
    },
    evidence_refs: [],
  };

  // 保留非枚举 raw_payload 属性，兼容原有业务访问
  Object.defineProperty(payload, 'raw_payload', {
    value: rawData,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return payload;
}

/**
 * 解析 Opmac 测径仪 Modbus 寄存器
 * 支持 6 个标准寄存器 (0x0200~0x0205, Opmac 170A-2D) 或 5 个历史寄存器
 * @param regs 寄存器数组
 * @param pulseCount 当前累加编码器脉冲数
 */
export function parseOpmacRegisters(
  regs: number[],
  seq: number,
  pulseCount: number,
  meta: EdgeMetadata,
  sampleTime: string = new Date().toISOString()
): EdgeIngestionPayload {
  if (!regs || regs.length < 5) {
    throw new Error(`Invalid register buffer length for Opmac: expected >= 5, got ${regs?.length}`);
  }

  let statusWord: number;
  let dAvgRaw: number;
  let dXRaw: number;
  let dYRaw: number;
  let diffAbsRaw: number;
  let pos1: number = 0;
  let pos2: number = 0;

  if (regs.length >= 6) {
    // 标准 Opmac 170A-2D 寄存器表 (0x0200~0x0205)
    statusWord = regs[0];
    dAvgRaw = regs[1];
    dXRaw = regs[2];
    pos1 = regs[3] > 32767 ? regs[3] - 65536 : regs[3];
    dYRaw = regs[4];
    pos2 = regs[5] > 32767 ? regs[5] - 65536 : regs[5];
    diffAbsRaw = Math.abs(dXRaw - dYRaw);
  } else {
    // 兼容历史 5 寄存器模式: [D_AVG, D_X, D_Y, DIFF_ABS, STATUS_WORD]
    dAvgRaw = regs[0];
    dXRaw = regs[1];
    dYRaw = regs[2];
    diffAbsRaw = regs[3];
    statusWord = regs[4];
    pos1 = 8;
    pos2 = -14;
  }

  const dxMm = dXRaw / 100;
  const dyMm = dYRaw / 100;
  const diffMm = diffAbsRaw / 100;
  const avgMm = dAvgRaw / 100;

  const coeff = meta.pulseCoefficient !== undefined ? meta.pulseCoefficient : 0.0005;

  // 空料/无物体/光路遮挡检测 (外径小于 1mm 或状态字提示无物体/异常)
  const isBeamBlockedOrEmpty =
    (statusWord & 0x04) !== 0 ||
    (statusWord & 0x40) !== 0 ||
    statusWord === 0x0042 ||
    dxMm < 1.0 ||
    dyMm < 1.0;
  const isValid = !isBeamBlockedOrEmpty && (dxMm + dyMm) > 0;

  return toPlatformPayload(
    {
      isValid,
      dxMm,
      dyMm,
      avgMm,
      diffMm,
      statusWord,
      pos1,
      pos2,
      pulseCount,
      coeff,
    },
    meta,
    seq,
    sampleTime
  );
}

export function parseOpmac170A2DRegisters(
  regs: number[],
  seq: number,
  pulseCount: number,
  meta: EdgeMetadata,
  sampleTime?: string
): EdgeIngestionPayload {
  return parseOpmacRegisters(regs, seq, pulseCount, meta, sampleTime);
}

/**
 * 直接解析 Opmac 测径仪 Modbus RTU 原始报文
 */
export function parseOpmacRTUFrame(
  frame: Uint8Array | Buffer,
  seq: number,
  pulseCount: number,
  meta: EdgeMetadata,
  sampleTime?: string
): EdgeIngestionPayload {
  if (!frame || frame.length < 5) {
    throw new Error(`FRAME_TOO_SHORT: Expected at least 5 bytes, got ${frame?.length || 0}`);
  }

  if (!verifyModbusCRC16(frame)) {
    throw new Error('CRC_CHECK_FAILED: Opmac Modbus RTU CRC16 checksum mismatch');
  }

  const funcCode = frame[1];
  if ((funcCode & 0x80) !== 0) {
    const excCode = frame[2];
    throw new Error(`MODBUS_EXCEPTION: Function code 0x${funcCode.toString(16)}, Exception code 0x${excCode.toString(16)}`);
  }

  const byteCount = frame[2];
  if (byteCount !== frame.length - 5) {
    throw new Error(`BYTE_COUNT_MISMATCH: Declared ${byteCount} bytes, actual payload is ${frame.length - 5}`);
  }

  const regCount = Math.floor(byteCount / 2);
  const regs: number[] = [];
  for (let i = 0; i < regCount; i++) {
    regs.push((frame[3 + i * 2] << 8) | frame[3 + i * 2 + 1]);
  }

  return parseOpmacRegisters(regs, seq, pulseCount, meta, sampleTime);
}
