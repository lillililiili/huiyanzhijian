/**
 * 现场边缘采集端（Edge Agent）主导出入口
 */

export * from './edge-buffer';
export * from './sync-engine';
export * from './edge-agent';
export * from './opmac-driver';

// 如果通过命令行直接执行该文件，则作为常驻后台守护进程运行
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  console.log('[EdgeAgent] Starting field edge acquisition daemon...');
  const { EdgeAgent } = await import('./edge-agent');
  const agent = new EdgeAgent({
    sqlitePath: process.env.EDGE_SQLITE_PATH || 'apps/device-edge/db/edge_buffer.sqlite',
    syncConfig: {
      platformUrl: process.env.PLATFORM_URL || 'http://localhost:4192',
      deviceToken: process.env.DEVICE_TOKEN,
    },
  });

  agent.start();
  console.log('[EdgeAgent] Field edge acquisition daemon running. Press Ctrl+C to stop.');

  const shutdown = async () => {
    console.log('[EdgeAgent] Shutting down daemon...');
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
