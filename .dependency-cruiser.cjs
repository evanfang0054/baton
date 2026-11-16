/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-no-node-builtins',
      severity: 'error',
      comment: 'packages/core 必须是纯函数层，不得依赖 Node 内置模块',
      from: { path: '^packages/core' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-no-apps',
      severity: 'error',
      comment: 'packages/core 不得依赖 apps',
      from: { path: '^packages/core' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-no-daemon',
      severity: 'error',
      comment: 'web 不得依赖 daemon',
      from: { path: '^apps/web' },
      to: { path: '^apps/daemon' },
    },
    {
      name: 'web-no-node-builtins',
      severity: 'error',
      comment: 'web 不得依赖 Node 内置模块',
      from: { path: '^apps/web' },
      to: { dependencyTypes: ['core'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/|(^|/)node_modules/|(^|/)migrations/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
}
