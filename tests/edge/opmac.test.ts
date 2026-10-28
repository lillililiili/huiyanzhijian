import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOpmacRegisters,
  parseOpmacRTUFrame,
  buildOpmacRTUResponse,
  calculatePositionFromPulses,
} from '../../apps/device-edge/opmac-driver';
import { validateMeasurement } from './schema-validator';

test('Opmac diameter gauge driver: normal measurement parsing', () => {
  const meta = {
    deviceId: 'HY-BY-01',
    captureSessionId: 'SESS-BY-01',
    dataEnvironment: 'REAL' as const,
  };

  // 正常数据：X=40.00mm (4000), Y=40.20mm (4020), Avg=40.10mm (4010), Diff=0.20mm (20), Status=0
  // 脉冲数：200000 脉冲 * 0.0005 = 100.0000m
  const regs = [4010, 4000, 4020, 20, 0];
  const payload = parseOpmacRegisters(regs, 100, 200000, meta, '2026-10-28T10:00:00.000000Z');

  assert.equal(payload.device_id, 'HY-BY-01');
  assert.equal(payload.data_environment, 'REAL');
  assert.equal(payload.data_status, 'VALID');
  assert.equal(payload.position_m, '100.0000');
  assert.equal(payload.values[0].metric_code, 'OVALITY');
  assert.equal(payload.values[0].unit, '%');

  // 计算验证：200 * |40 - 40.2| / 80.2 = 40 / 80.2 ≈ 0.498753% <= 8.0% (PASS)
  assert.equal(payload.values[0].value, '0.498753');
  assert.equal(payload.values[0].source_quality_result, 'PASS');
  assert.equal(payload.raw_payload?.diff_abs_mm, 0.2);

  // 校验符合平台 1.0 Measurement Schema
  const valid = validateMeasurement(payload);
  assert.equal(valid, true, JSON.stringify(validateMeasurement.errors));
});

test('Opmac diameter gauge driver: anomaly exceeding threshold', () => {
  const meta = {
    deviceId: 'HY-BY-01',
    captureSessionId: 'SESS-BY-01',
    dataEnvironment: 'REAL' as const,
  };

  // 严重超限：X=40.00mm, Y=48.00mm (差8mm), Avg=44.00mm
  // 计算：200 * 8 / 88 = 1600 / 88 ≈ 18.181818% > 8.0% (FAIL)
  const regs = [4400, 4000, 4800, 800, 1];
  const payload = parseOpmacRegisters(regs, 101, 200200, meta, '2026-10-28T10:00:01.000000Z');

  assert.equal(payload.values[0].value, '18.181818');
  assert.equal(payload.values[0].source_quality_result, 'FAIL');
  assert.equal(validateMeasurement(payload), true);
});

test('Opmac diameter gauge driver: empty / beam blocked detection', () => {
  const meta = {
    deviceId: 'HY-BY-01',
    captureSessionId: 'SESS-BY-01',
    dataEnvironment: 'REAL' as const,
  };

  // 空料/无电缆：外径接近0 (X=0.2mm, Y=0.1mm), status=4 (无物体)
  const regs = [15, 20, 10, 10, 4];
  const payload = parseOpmacRegisters(regs, 102, 0, meta, '2026-10-28T10:00:02.000000Z');

  assert.equal(payload.data_status, 'MISSING');
  assert.equal(payload.values[0].value, null);
  assert.equal(payload.values[0].source_quality_result, 'NOT_EVALUATED');
  assert.equal(payload.values[0].reason_code, 'BEAM_BLOCKED_OR_NO_CABLE');
  assert.equal(validateMeasurement(payload), true);
});

test('Opmac pulse encoder meter conversion calculation', () => {
  // 1 脉冲 = 0.0005 m
  assert.equal(calculatePositionFromPulses(0), '0.0000');
  assert.equal(calculatePositionFromPulses(2000), '1.0000');
  assert.equal(calculatePositionFromPulses(123456), '61.7280');
  // 自定义脉冲系数（如 0.001 m/pulse）
  assert.equal(calculatePositionFromPulses(500, 0.001), '0.5000');
  // 负脉冲安全保护
  assert.equal(calculatePositionFromPulses(-10), '0.0000');
});

test('Opmac Modbus RTU binary frame parsing and bad frame interception', () => {
  const meta = {
    deviceId: 'HY-BY-01',
    captureSessionId: 'SESS-OPMAC-RTU',
    dataEnvironment: 'REAL' as const,
  };

  const regs = [4010, 4000, 4020, 20, 0];
  const frame = buildOpmacRTUResponse(1, regs);

  const payload = parseOpmacRTUFrame(frame, 105, 300000, meta);
  assert.equal(payload.position_m, '150.0000');
  assert.equal(payload.values[0].value, '0.498753');
  assert.equal(payload.values[0].source_quality_result, 'PASS');

  // 坏帧：CRC 错误
  const corrupted = Buffer.from(frame);
  corrupted[corrupted.length - 1] ^= 0xaa;
  assert.throws(
    () => parseOpmacRTUFrame(corrupted, 106, 0, meta),
    /CRC_CHECK_FAILED/
  );

  // 坏帧：过短
  assert.throws(
    () => parseOpmacRTUFrame(Buffer.from([0x01, 0x03, 0x02]), 107, 0, meta),
    /FRAME_TOO_SHORT/
  );
});

test('Opmac 170A-2D standard 6-register Modbus RTU real frame instance parsing (01 03 0C 0002 2EC4 330A 0008 2A7F FFE6 6BE8)', () => {
  const meta = {
    deviceId: 'HY-BY-01',
    captureSessionId: 'SESS-OPMAC-170A2D',
    dataEnvironment: 'REAL' as const,
  };

  // 真实测试帧: 12字节 6个寄存器
  // 01 03 0C 0002 2EC4 330A 0008 2A7F FFE6 6BE8
  // 状态字: 0x0002 (双轴正常)
  // 平均外径: 0x2EC4 = 11972 -> 119.72mm
  // 1轴直径(X): 0x330A = 13066 -> 130.66mm
  // 1轴位置: 0x0008 = 8mm
  // 2轴直径(Y): 0x2A7F = 10879 -> 108.79mm
  // 2轴位置: 0xFFE6 = -26mm
  const realFrame = Buffer.from('01030C00022EC4330A00082A7FFFE66BE8', 'hex');

  // 脉冲数 400000 -> 200.0000m
  const payload = parseOpmacRTUFrame(realFrame, 201, 400000, meta, '2026-10-28T12:00:00.000000Z');

  assert.equal(payload.device_id, 'HY-BY-01');
  assert.equal(payload.data_environment, 'REAL');
  assert.equal(payload.data_status, 'VALID');
  assert.equal(payload.position_m, '200.0000');
  assert.equal(payload.values[0].metric_code, 'OVALITY');
  assert.equal(payload.values[0].unit, '%');

  // 计算验证：200 * |130.66 - 108.79| / (130.66 + 108.79) = 4374 / 239.45 ≈ 18.266862%
  assert.equal(payload.values[0].value, '18.266862');
  // 18.27% > 8.0% (FAIL)
  assert.equal(payload.values[0].source_quality_result, 'FAIL');

  // 验证 observation 标准结构与 +180° 对向轴距
  const obs = payload.raw.data.observation as any;
  assert.ok(obs, 'observation must exist');
  assert.equal(obs.diameter_x_mm, '130.660000');
  assert.equal(obs.diameter_y_mm, '108.790000');
  assert.equal(obs.major_axis_mm, '130.660000');
  assert.equal(obs.minor_axis_mm, '108.790000');
  assert.equal(obs.ovality_difference_mm, '21.870000');
  assert.equal(obs.axis_ratio_f, '1.201030');

  // 验证对向角度 (0°—180° 与 90°—270°)
  assert.equal(obs.axis_pairs.length, 2);
  assert.deepEqual(obs.axis_pairs[0], {
    group_no: 1,
    axis_code: 'X',
    angle_a_deg: 0,
    angle_b_deg: 180,
    angle_label: '0°—180°',
    diameter_mm: '130.660000',
    position_offset: 8,
  });
  assert.deepEqual(obs.axis_pairs[1], {
    group_no: 2,
    axis_code: 'Y',
    angle_a_deg: 90,
    angle_b_deg: 270,
    angle_label: '90°—270°',
    diameter_mm: '108.790000',
    position_offset: -26,
  });

  // 验证寄存器快照
  assert.deepEqual(obs.registers, {
    '0x0200_status_word': '0x0002',
    '0x0201_avg_diameter_001mm': 11972,
    '0x0202_axis1_diameter_001mm': 13066,
    '0x0203_axis1_position': 8,
    '0x0204_axis2_diameter_001mm': 10879,
    '0x0205_axis2_position': -26,
  });

  // 验证符合平台契约 Schema
  assert.equal(validateMeasurement(payload), true, JSON.stringify(validateMeasurement.errors));
});
